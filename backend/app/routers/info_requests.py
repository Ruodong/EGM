"""Info Supplement Request router — feedback loop from domain reviewers."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.database import get_db
from app.utils.audit import write_audit
from app.auth import require_permission, get_current_user, AuthUser

router = APIRouter()


async def _resolve_request_uuid(db: AsyncSession, request_id: str) -> str:
    """Resolve a business ID (GR-xxxxxx) or UUID string to the governance_request UUID."""
    gr = (await db.execute(text(
        "SELECT id FROM governance_request WHERE request_id = :id OR id::text = :id"
    ), {"id": request_id})).scalar()
    if not gr:
        raise HTTPException(status_code=404, detail="Governance request not found")
    return str(gr)


def _map(r: dict) -> dict:
    return {
        "id": str(r["id"]),
        "requestId": str(r["request_id"]),
        "domainReviewId": str(r["domain_review_id"]),
        "requester": r["requester"],
        "category": r.get("category"),
        "fieldReference": str(r["field_reference"]) if r.get("field_reference") else None,
        "description": r["description"],
        "priority": r.get("priority", "Normal"),
        "status": r["status"],
        "resolutionNote": r.get("resolution_note"),
        "resolvedBy": r.get("resolved_by"),
        "resolvedAt": r["resolved_at"].isoformat() if r.get("resolved_at") else None,
        "createBy": r.get("create_by"),
        "createAt": r["create_at"].isoformat() if r.get("create_at") else None,
    }


@router.get("", dependencies=[Depends(require_permission("info_supplement_request", "read"))])
async def list_isrs(
    request_id: str | None = Query(None, alias="request_id"),
    domainReviewId: str | None = Query(None),
    status: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    conditions, params = [], {}
    if request_id:
        rid = await _resolve_request_uuid(db, request_id)
        params["rid"] = rid
        conditions.append("request_id = :rid")
    if domainReviewId:
        params["drid"] = domainReviewId
        conditions.append("domain_review_id = :drid")
    if status:
        params["st"] = status
        conditions.append("status = :st")

    where = (" WHERE " + " AND ".join(conditions)) if conditions else ""
    rows = (await db.execute(text(
        f"SELECT * FROM info_supplement_request{where} ORDER BY create_at DESC"
    ), params)).mappings().all()
    return {"data": [_map(dict(r)) for r in rows]}


@router.post("", dependencies=[Depends(require_permission("info_supplement_request", "write"))])
async def create_isr(body: dict, user: AuthUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rid = await _resolve_request_uuid(db, body["requestId"])

    # Validate that domainReviewId actually belongs to this request
    drid = body.get("domainReviewId")
    if drid:
        belongs = (await db.execute(text(
            "SELECT 1 FROM domain_review WHERE id = :drid AND request_id = :rid"
        ), {"drid": drid, "rid": rid})).scalar()
        if not belongs:
            raise HTTPException(
                status_code=400,
                detail="Domain review does not belong to this governance request",
            )

    row = (await db.execute(text("""
        INSERT INTO info_supplement_request (request_id, domain_review_id, requester,
            category, field_reference, description, priority, status, create_by, update_by)
        VALUES (:rid, :drid, :requester, :category, :field_ref, :desc, :priority, 'Open', :user, :user)
        RETURNING *
    """), {
        "rid": rid,
        "drid": body["domainReviewId"],
        "requester": user.id,
        "category": body.get("category"),
        "field_ref": body.get("fieldReference"),
        "desc": body["description"],
        "priority": body.get("priority", "Normal"),
        "user": user.id,
    })).mappings().first()

    # NOTE: Status is no longer changed to "Info Requested". The governance
    # request stays in its current status (In Progress) while ISRs are open.

    await write_audit(db, "info_supplement_request", str(row["id"]), "created", user.id,
                      new_value={"requestId": rid, "category": body.get("category"), "description": body["description"]})

    await db.commit()
    return _map(dict(row))


@router.put("/{isr_id}/acknowledge", dependencies=[Depends(require_permission("info_supplement_request", "write"))])
async def acknowledge_isr(isr_id: str, user: AuthUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    row = (await db.execute(text(
        "UPDATE info_supplement_request SET status = 'Acknowledged', update_by = :user, update_at = NOW() "
        "WHERE id = :id AND status = 'Open' RETURNING *"
    ), {"id": isr_id, "user": user.id})).mappings().first()
    if not row:
        raise HTTPException(status_code=400, detail="ISR not found or not in Open status")
    await db.commit()
    return _map(dict(row))


@router.put("/{isr_id}/resolve", dependencies=[Depends(require_permission("info_supplement_request", "write"))])
async def resolve_isr(isr_id: str, body: dict, user: AuthUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    row = (await db.execute(text(
        "UPDATE info_supplement_request SET status = 'Resolved', resolution_note = :note, "
        "resolved_by = :user, resolved_at = NOW(), update_by = :user, update_at = NOW() "
        "WHERE id = :id RETURNING *"
    ), {"id": isr_id, "note": body.get("resolutionNote"), "user": user.id})).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="ISR not found")

    # Notify domain reviews by updating common_data_updated_at (skip terminal reviews)
    await db.execute(text(
        "UPDATE domain_review SET common_data_updated_at = NOW() "
        "WHERE request_id = :rid AND status NOT IN ('Approved', 'Approved with Exception', 'Not Passed')"
    ), {"rid": str(row["request_id"])})

    # NOTE: Status is no longer toggled between "Info Requested" and "In Review".
    # The governance request stays "In Progress" throughout the ISR lifecycle.

    await db.commit()
    return _map(dict(row))
