"""Governance Requests router — CRUD + lifecycle."""
from __future__ import annotations

from datetime import date as dt_date, timedelta
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.database import get_db
from app.utils.pagination import PaginationParams, paginated_response
from app.utils.filters import multi_value_condition
from app.utils.audit import write_audit
from app.auth import require_permission, get_current_user, AuthUser

router = APIRouter()

ALLOWED_SORT = {"request_id", "title", "status", "priority", "create_at", "update_at", "requestor"}


def _map(r: dict) -> dict:
    return {
        "id": str(r["id"]),
        "requestId": r["request_id"],
        "title": r["title"],
        "description": r.get("description"),
        "projectId": r.get("project_id"),
        "projectName": r.get("project_name"),  # from LEFT JOIN project
        "requestor": r["requestor"],
        "requestorName": r.get("requestor_name"),
        "organization": r.get("organization"),
        "status": r["status"],
        "overallVerdict": r.get("overall_verdict"),
        "priority": r.get("priority"),
        "targetDate": r["target_date"].isoformat() if r.get("target_date") else None,
        "completedAt": r["completed_at"].isoformat() if r.get("completed_at") else None,
        "createBy": r.get("create_by"),
        "createAt": r["create_at"].isoformat() if r.get("create_at") else None,
        "updateAt": r["update_at"].isoformat() if r.get("update_at") else None,
    }


@router.get("", dependencies=[Depends(require_permission("governance_request", "read"))])
async def list_requests(
    status: str | None = Query(None),
    priority: str | None = Query(None),
    requestor: str | None = Query(None),
    search: str | None = Query(None),
    dateFrom: str | None = Query(None),
    dateTo: str | None = Query(None),
    pg: PaginationParams = Depends(),
    db: AsyncSession = Depends(get_db),
):
    conditions: list[str] = []
    params: dict = {}

    if status:
        conditions.append(multi_value_condition("gr.status", "status", status, params))
    if priority:
        conditions.append(multi_value_condition("gr.priority", "priority", priority, params))
    if requestor:
        params["requestor"] = f"%{requestor}%"
        conditions.append("(gr.requestor ILIKE :requestor OR gr.requestor_name ILIKE :requestor)")
    if search:
        params["search"] = f"%{search}%"
        conditions.append("(gr.request_id ILIKE :search OR gr.title ILIKE :search)")
    if dateFrom:
        params["date_from"] = dt_date.fromisoformat(dateFrom)
        conditions.append("gr.create_at >= :date_from")
    if dateTo:
        params["date_to"] = dt_date.fromisoformat(dateTo) + timedelta(days=1)
        conditions.append("gr.create_at < :date_to")

    where = (" WHERE " + " AND ".join(conditions)) if conditions else ""

    # Count
    count_sql = f"SELECT COUNT(*) FROM governance_request gr{where}"
    total = (await db.execute(text(count_sql), params)).scalar() or 0

    # Sort
    sort_col = pg.sort_field if pg.sort_field in ALLOWED_SORT else "create_at"
    sort_dir = "ASC" if pg.sort_order and pg.sort_order.upper() == "ASC" else "DESC"

    data_sql = f"""
        SELECT gr.*, p.project_name
        FROM governance_request gr
        LEFT JOIN project p ON p.project_id = gr.project_id
        {where}
        ORDER BY gr.{sort_col} {sort_dir}
        LIMIT :limit OFFSET :offset
    """
    params["limit"] = pg.page_size
    params["offset"] = pg.offset

    rows = (await db.execute(text(data_sql), params)).mappings().all()
    return paginated_response([_map(dict(r)) for r in rows], total, pg.page, pg.page_size)


@router.get("/filter-options", dependencies=[Depends(require_permission("governance_request", "read"))])
async def filter_options(db: AsyncSession = Depends(get_db)):
    statuses = (await db.execute(text("SELECT DISTINCT status FROM governance_request ORDER BY status"))).scalars().all()
    priorities = (await db.execute(text("SELECT DISTINCT priority FROM governance_request ORDER BY priority"))).scalars().all()
    return {"statuses": statuses, "priorities": priorities}


@router.get("/{request_id}", dependencies=[Depends(require_permission("governance_request", "read"))])
async def get_request(request_id: str, db: AsyncSession = Depends(get_db)):
    row = (await db.execute(text(
        "SELECT gr.*, p.project_name FROM governance_request gr "
        "LEFT JOIN project p ON p.project_id = gr.project_id "
        "WHERE gr.request_id = :id OR gr.id::text = :id"
    ), {"id": request_id})).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Governance request not found")
    return _map(dict(row))


@router.post("", dependencies=[Depends(require_permission("governance_request", "write"))])
async def create_request(body: dict, user: AuthUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    # Validate projectId if provided
    project_id = body.get("projectId") or None
    if project_id:
        exists = (await db.execute(text(
            "SELECT 1 FROM project WHERE project_id = :pid"
        ), {"pid": project_id})).scalar()
        if not exists:
            raise HTTPException(status_code=400, detail=f"Project '{project_id}' not found")

    # Generate next request_id using PostgreSQL sequence (atomic, no race condition)
    seq = (await db.execute(text("SELECT nextval('gr_seq')"))).scalar()
    new_id = f"GR-{seq:06d}"

    sql = text("""
        INSERT INTO governance_request (request_id, title, description, project_id,
            requestor, requestor_name, organization, status, priority, target_date, create_by, update_by)
        VALUES (:request_id, :title, :description, :project_id,
            :requestor, :requestor_name, :organization, 'Draft', :priority, :target_date, :create_by, :create_by)
        RETURNING *, (SELECT project_name FROM project WHERE project_id = governance_request.project_id) AS project_name
    """)
    row = (await db.execute(sql, {
        "request_id": new_id,
        "title": body.get("title", ""),
        "description": body.get("description"),
        "project_id": project_id,
        "requestor": user.id,
        "requestor_name": user.name,
        "organization": body.get("organization") or None,
        "priority": body.get("priority", "Normal"),
        "target_date": body.get("targetDate") or None,
        "create_by": user.id,
    })).mappings().first()
    await write_audit(db, "governance_request", str(row["id"]), "created", user.id,
                      new_value={"requestId": new_id, "title": body.get("title", "")})
    await db.commit()
    return _map(dict(row))


@router.put("/{request_id}", dependencies=[Depends(require_permission("governance_request", "write"))])
async def update_request(request_id: str, body: dict, user: AuthUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    # Validate projectId if being updated
    if "projectId" in body:
        pid = body["projectId"] or None
        if pid:
            exists = (await db.execute(text(
                "SELECT 1 FROM project WHERE project_id = :pid"
            ), {"pid": pid})).scalar()
            if not exists:
                raise HTTPException(status_code=400, detail=f"Project '{pid}' not found")

    sets: list[str] = []
    params: dict = {"id": request_id, "update_by": user.id}

    for field, col in [
        ("title", "title"), ("description", "description"),
        ("projectId", "project_id"), ("organization", "organization"), ("priority", "priority"),
        ("targetDate", "target_date"),
    ]:
        if field in body:
            sets.append(f"{col} = :{col}")
            val = body[field]
            if col in ("target_date", "project_id", "organization") and val == "":
                val = None
            params[col] = val

    if not sets:
        raise HTTPException(status_code=400, detail="No fields to update")

    sets.append("update_by = :update_by")
    sets.append("update_at = NOW()")

    sql = text(
        f"UPDATE governance_request SET {', '.join(sets)} "
        f"WHERE request_id = :id OR id::text = :id "
        f"RETURNING *, (SELECT project_name FROM project WHERE project_id = governance_request.project_id) AS project_name"
    )
    row = (await db.execute(sql, params)).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Not found")
    await db.commit()
    return _map(dict(row))


@router.put("/{request_id}/submit", dependencies=[Depends(require_permission("governance_request", "write"))])
async def submit_request(request_id: str, user: AuthUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    row = (await db.execute(text(
        "UPDATE governance_request SET status = 'Submitted', update_by = :user, update_at = NOW() "
        "WHERE (request_id = :id OR id::text = :id) AND status = 'Draft' "
        "RETURNING *, (SELECT project_name FROM project WHERE project_id = governance_request.project_id) AS project_name"
    ), {"id": request_id, "user": user.id})).mappings().first()
    if not row:
        raise HTTPException(status_code=400, detail="Can only submit Draft requests")
    await write_audit(db, "governance_request", str(row["id"]), "submitted", user.id,
                      old_value={"status": "Draft"}, new_value={"status": "Submitted"})
    await db.commit()
    return _map(dict(row))


@router.put("/{request_id}/verdict", dependencies=[Depends(require_permission("governance_request", "write"))])
async def record_verdict(request_id: str, body: dict, user: AuthUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    verdict = body.get("verdict")
    if verdict not in ("Approved", "Approved with Conditions", "Rejected", "Deferred"):
        raise HTTPException(status_code=400, detail="Invalid verdict")

    # Resolve the governance request UUID
    gr = (await db.execute(text(
        "SELECT id FROM governance_request WHERE (request_id = :id OR id::text = :id) AND status = 'In Review'"
    ), {"id": request_id})).scalar()
    if not gr:
        raise HTTPException(status_code=400, detail="Request not found or not in 'In Review' status")
    gr_uuid = str(gr)

    # Guard: all domain reviews must be complete
    incomplete = (await db.execute(text(
        "SELECT COUNT(*) FROM domain_review WHERE request_id = :rid "
        "AND status NOT IN ('Review Complete', 'Waived')"
    ), {"rid": gr_uuid})).scalar() or 0
    if incomplete > 0:
        raise HTTPException(status_code=400, detail=f"{incomplete} domain review(s) still incomplete")

    # Guard: no open ISRs
    open_isrs = (await db.execute(text(
        "SELECT COUNT(*) FROM info_supplement_request WHERE request_id = :rid "
        "AND status IN ('Open', 'Acknowledged')"
    ), {"rid": gr_uuid})).scalar() or 0
    if open_isrs > 0:
        raise HTTPException(status_code=400, detail=f"{open_isrs} open information request(s)")

    row = (await db.execute(text(
        "UPDATE governance_request SET status = 'Completed', overall_verdict = :verdict, "
        "completed_at = NOW(), update_by = :user, update_at = NOW() "
        "WHERE id = :id "
        "RETURNING *, (SELECT project_name FROM project WHERE project_id = governance_request.project_id) AS project_name"
    ), {"id": gr_uuid, "verdict": verdict, "user": user.id})).mappings().first()
    await write_audit(db, "governance_request", gr_uuid, "verdict_recorded", user.id,
                      old_value={"status": "In Review"}, new_value={"status": "Completed", "verdict": verdict})
    await db.commit()
    return _map(dict(row))


@router.delete("/{request_id}", dependencies=[Depends(require_permission("governance_request", "write"))])
async def delete_request(request_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(text(
        "DELETE FROM governance_request WHERE (request_id = :id OR id::text = :id) AND status = 'Draft'"
    ), {"id": request_id})
    if result.rowcount == 0:
        raise HTTPException(status_code=400, detail="Can only delete Draft requests")
    await db.commit()
    return {"deleted": True}
