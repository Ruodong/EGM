"""Domain Reviews router — per-request, per-domain review lifecycle."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.database import get_db
from app.utils.pagination import PaginationParams, paginated_response
from app.utils.audit import write_audit
from app.auth import require_permission, get_current_user, AuthUser

router = APIRouter()


def _map(r: dict) -> dict:
    result = {
        "id": str(r["id"]),
        "requestId": str(r["request_id"]),
        "domainCode": r["domain_code"],
        "status": r["status"],
        "reviewer": r.get("reviewer"),
        "reviewerName": r.get("reviewer_name"),
        "outcome": r.get("outcome"),
        "outcomeNotes": r.get("outcome_notes"),
        "externalRefId": r.get("external_ref_id"),
        "commonDataUpdatedAt": r["common_data_updated_at"].isoformat() if r.get("common_data_updated_at") else None,
        "startedAt": r["started_at"].isoformat() if r.get("started_at") else None,
        "completedAt": r["completed_at"].isoformat() if r.get("completed_at") else None,
        "createAt": r["create_at"].isoformat() if r.get("create_at") else None,
    }
    # Optional joined fields
    if "domain_name" in r:
        result["domainName"] = r["domain_name"]
    if "gov_request_id" in r:
        result["govRequestId"] = r["gov_request_id"]
    return result


@router.get("", dependencies=[Depends(require_permission("domain_review", "read"))])
async def list_reviews(
    request_id: str | None = Query(None, alias="request_id"),
    domainCode: str | None = Query(None),
    status: str | None = Query(None),
    reviewer: str | None = Query(None),
    pg: PaginationParams = Depends(),
    db: AsyncSession = Depends(get_db),
):
    conditions, params = [], {}

    # Filter by request_id param (supports both UUID and GR-XXXXXX)
    if request_id:
        params["rid"] = request_id
        conditions.append("(dr.request_id::text = :rid OR gr.request_id = :rid)")
    if domainCode:
        params["dc"] = domainCode
        conditions.append("dr.domain_code = :dc")
    if status:
        params["st"] = status
        conditions.append("dr.status = :st")
    if reviewer:
        params["rev"] = reviewer
        conditions.append("dr.reviewer = :rev")

    where = (" WHERE " + " AND ".join(conditions)) if conditions else ""

    base_from = (
        "FROM domain_review dr "
        "LEFT JOIN domain_registry dreg ON dreg.domain_code = dr.domain_code "
        "LEFT JOIN governance_request gr ON gr.id = dr.request_id"
    )

    total = (await db.execute(text(f"SELECT COUNT(*) {base_from}{where}"), params)).scalar() or 0

    params["limit"] = pg.page_size
    params["offset"] = pg.offset
    rows = (await db.execute(text(
        f"SELECT dr.*, dreg.domain_name, gr.request_id AS gov_request_id "
        f"{base_from}{where} ORDER BY dr.create_at DESC LIMIT :limit OFFSET :offset"
    ), params)).mappings().all()

    return paginated_response([_map(dict(r)) for r in rows], total, pg.page, pg.page_size)


@router.get("/{review_id}", dependencies=[Depends(require_permission("domain_review", "read"))])
async def get_review(review_id: str, db: AsyncSession = Depends(get_db)):
    row = (await db.execute(text(
        "SELECT * FROM domain_review WHERE id = :id"
    ), {"id": review_id})).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Domain review not found")
    return _map(dict(row))


@router.put("/{review_id}/assign", dependencies=[Depends(require_permission("domain_review", "write"))])
async def assign_reviewer(review_id: str, body: dict = {}, user: AuthUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    reviewer = body.get("reviewer", user.id)
    reviewer_name = body.get("reviewerName", user.name)
    row = (await db.execute(text(
        "UPDATE domain_review SET reviewer = :reviewer, reviewer_name = :name, "
        "status = 'Assigned', update_by = :user, update_at = NOW() "
        "WHERE id = :id RETURNING *"
    ), {
        "id": review_id,
        "reviewer": reviewer,
        "name": reviewer_name,
        "user": user.id,
    })).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Not found")
    await db.commit()
    return _map(dict(row))


@router.put("/{review_id}/start", dependencies=[Depends(require_permission("domain_review", "write"))])
async def start_review(review_id: str, user: AuthUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    row = (await db.execute(text(
        "UPDATE domain_review SET status = 'In Progress', started_at = NOW(), "
        "update_by = :user, update_at = NOW() WHERE id = :id RETURNING *"
    ), {"id": review_id, "user": user.id})).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Not found")
    await db.commit()
    return _map(dict(row))


@router.put("/{review_id}/complete", dependencies=[Depends(require_permission("domain_review", "write"))])
async def complete_review(review_id: str, body: dict, user: AuthUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    outcome = body.get("outcome")
    if outcome not in ("Approved", "Approved with Conditions", "Rejected", "Deferred"):
        raise HTTPException(status_code=400, detail="Invalid outcome")

    row = (await db.execute(text(
        "UPDATE domain_review SET status = 'Review Complete', outcome = :outcome, "
        "outcome_notes = :notes, completed_at = NOW(), update_by = :user, update_at = NOW() "
        "WHERE id = :id RETURNING *"
    ), {
        "id": review_id, "outcome": outcome,
        "notes": body.get("outcomeNotes"), "user": user.id,
    })).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Not found")
    await write_audit(db, "domain_review", review_id, "completed", user.id,
                      new_value={"outcome": outcome, "domainCode": row["domain_code"]})
    await db.commit()
    return _map(dict(row))


@router.put("/{review_id}/waive", dependencies=[Depends(require_permission("domain_review", "write"))])
async def waive_review(review_id: str, user: AuthUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    row = (await db.execute(text(
        "UPDATE domain_review SET status = 'Waived', update_by = :user, update_at = NOW() "
        "WHERE id = :id RETURNING *"
    ), {"id": review_id, "user": user.id})).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Not found")
    await db.commit()
    return _map(dict(row))
