"""Domain Reviews router — per-request, per-domain review lifecycle.

New state machine (2026-03-14):
  Waiting for Accept → Accept (reviewer accepts)
  Waiting for Accept → Return for Additional Information (needs more info)
  Return for Additional Information → Waiting for Accept (requestor resubmits)
  Accept → Approved | Approved with Exception | Not Passed (terminal verdicts)
"""
from __future__ import annotations

from datetime import date as dt_date, timedelta
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.database import get_db
from app.utils.pagination import PaginationParams, paginated_response
from app.utils.audit import write_audit
from app.auth import require_permission, get_current_user, AuthUser, Role

router = APIRouter()

TERMINAL_STATUSES = ("Approved", "Approved with Exception", "Not Passed")


async def _check_domain_write_access(user: AuthUser, review_row: dict, allow_governance_lead: bool = True):
    """Check that the user has write access to this domain review.

    - Admin: always allowed
    - Governance Leader: allowed only if allow_governance_lead=True
    - Domain Reviewer: allowed only if review's domain_code is in user.domain_codes
    """
    if Role.ADMIN in user.roles:
        return

    if Role.GOVERNANCE_LEAD in user.roles:
        if allow_governance_lead:
            return
        raise HTTPException(
            status_code=403,
            detail="Governance leaders cannot modify review outcomes"
        )

    if Role.DOMAIN_REVIEWER in user.roles:
        if review_row["domain_code"] in user.domain_codes:
            return
        raise HTTPException(
            status_code=403,
            detail=f"Access denied: you are not assigned to domain '{review_row['domain_code']}'"
        )

    raise HTTPException(status_code=403, detail="Insufficient permissions")


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
        "returnReason": r.get("return_reason"),
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
    if "project_name" in r:
        result["projectName"] = r.get("project_name")
    if "requestor" in r:
        result["requestor"] = r.get("requestor")
    if "requestor_name" in r:
        result["requestorName"] = r.get("requestor_name")
    if "gov_status" in r:
        result["govStatus"] = r.get("gov_status")
    if "gov_create_at" in r:
        result["govCreateAt"] = r["gov_create_at"].isoformat() if r.get("gov_create_at") else None
    return result


def _is_requestor_only(user: AuthUser) -> bool:
    """True when the user only has the requestor role (no reviewer/lead/admin)."""
    return (
        Role.REQUESTOR in user.roles
        and Role.DOMAIN_REVIEWER not in user.roles
        and Role.ADMIN not in user.roles
        and Role.GOVERNANCE_LEAD not in user.roles
    )


def _is_domain_reviewer_only(user: AuthUser) -> bool:
    """True when highest role is domain_reviewer (no admin/lead)."""
    return (
        Role.DOMAIN_REVIEWER in user.roles
        and Role.ADMIN not in user.roles
        and Role.GOVERNANCE_LEAD not in user.roles
    )


async def _check_auto_complete(db: AsyncSession, request_id, user_id: str):
    """Check if all domain reviews for this request are in terminal states.
    If so, auto-transition the governance request to 'Complete'.
    Uses SELECT FOR UPDATE to prevent race conditions.
    """
    # Lock the governance request row
    gr = (await db.execute(text(
        "SELECT id, status FROM governance_request WHERE id = :rid FOR UPDATE"
    ), {"rid": str(request_id)})).mappings().first()
    if not gr or gr["status"] == "Complete":
        return  # Already complete or not found

    # Check all reviews
    review_counts = (await db.execute(text(
        "SELECT COUNT(*) AS total, "
        "COUNT(*) FILTER (WHERE status IN ('Approved', 'Approved with Exception', 'Not Passed')) AS terminal "
        "FROM domain_review WHERE request_id = :rid"
    ), {"rid": str(request_id)})).mappings().first()

    if review_counts["total"] > 0 and review_counts["total"] == review_counts["terminal"]:
        await db.execute(text(
            "UPDATE governance_request SET status = 'Complete', "
            "update_by = :user, update_at = NOW() WHERE id = :rid"
        ), {"rid": str(request_id), "user": user_id})
        await write_audit(db, "governance_request", str(request_id), "auto_completed", user_id,
                          new_value={"status": "Complete", "reason": "All domain reviews finalized"})


# ═══════════════════════════════════════════════════════
# Read endpoints
# ═══════════════════════════════════════════════════════

@router.get("", dependencies=[Depends(require_permission("domain_review", "read"))])
async def list_reviews(
    request_id: str | None = Query(None, alias="request_id"),
    domainCode: str | None = Query(None),
    status: str | None = Query(None),
    reviewer: str | None = Query(None),
    search: str | None = Query(None),
    requestor: str | None = Query(None),
    dateFrom: str | None = Query(None),
    dateTo: str | None = Query(None),
    pg: PaginationParams = Depends(),
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    conditions, params = [], {}

    # Requestors can only see reviews for their own requests
    if _is_requestor_only(user):
        params["requestor_id"] = user.itcode
        conditions.append("gr.requestor = :requestor_id")
    # Domain reviewers can only see reviews for their assigned domains
    elif _is_domain_reviewer_only(user):
        if user.domain_codes:
            params["reviewer_domains"] = user.domain_codes
            conditions.append("dr.domain_code = ANY(:reviewer_domains)")
        else:
            conditions.append("FALSE")

    if request_id:
        params["rid"] = request_id
        conditions.append("(dr.request_id::text = :rid OR gr.request_id = :rid)")
    if domainCode:
        dc_list = [d.strip() for d in domainCode.split(",")]
        if len(dc_list) == 1:
            params["dc"] = dc_list[0]
            conditions.append("dr.domain_code = :dc")
        else:
            params["dc"] = dc_list
            conditions.append("dr.domain_code = ANY(:dc)")
    if status:
        st_list = [s.strip() for s in status.split(",")]
        if len(st_list) == 1:
            params["st"] = st_list[0]
            conditions.append("dr.status = :st")
        else:
            params["st"] = st_list
            conditions.append("dr.status = ANY(:st)")
    if reviewer:
        params["rev"] = reviewer
        conditions.append("dr.reviewer = :rev")
    if search:
        params["search"] = f"%{search}%"
        conditions.append("(gr.request_id ILIKE :search OR gr.project_name ILIKE :search)")
    if requestor:
        params["requestor"] = f"%{requestor}%"
        conditions.append("(gr.requestor ILIKE :requestor OR gr.requestor_name ILIKE :requestor)")
    if dateFrom:
        params["date_from"] = dt_date.fromisoformat(dateFrom)
        conditions.append("gr.create_at >= :date_from")
    if dateTo:
        params["date_to"] = dt_date.fromisoformat(dateTo) + timedelta(days=1)
        conditions.append("gr.create_at < :date_to")

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
        f"SELECT dr.*, dreg.domain_name, gr.request_id AS gov_request_id, "
        f"gr.project_name, gr.requestor, gr.requestor_name, "
        f"gr.status AS gov_status, gr.create_at AS gov_create_at "
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


# ═══════════════════════════════════════════════════════
# State transition endpoints
# ═══════════════════════════════════════════════════════

@router.put("/{review_id}/accept", dependencies=[Depends(require_permission("domain_review", "write"))])
async def accept_review(review_id: str, body: dict = {}, user: AuthUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Accept a domain review: Waiting for Accept → Accept.
    Side effect: if request is Submitted, transitions to In Progress.
    """
    existing = (await db.execute(text(
        "SELECT * FROM domain_review WHERE id = :id"
    ), {"id": review_id})).mappings().first()
    if not existing:
        raise HTTPException(status_code=404, detail="Not found")
    if existing["status"] != "Waiting for Accept":
        raise HTTPException(status_code=400, detail="Review must be in 'Waiting for Accept' status to accept")
    await _check_domain_write_access(user, dict(existing), allow_governance_lead=True)

    row = (await db.execute(text(
        "UPDATE domain_review SET status = 'Accept', "
        "reviewer = :reviewer, reviewer_name = :reviewer_name, "
        "started_at = NOW(), update_by = :user, update_at = NOW() "
        "WHERE id = :id RETURNING *"
    ), {
        "id": review_id,
        "reviewer": user.id, "reviewer_name": user.name,
        "user": user.id,
    })).mappings().first()

    # Transition request from Submitted → In Progress on first Accept
    gr = (await db.execute(text(
        "SELECT status FROM governance_request WHERE id = :rid"
    ), {"rid": existing["request_id"]})).mappings().first()
    if gr and gr["status"] == "Submitted":
        await db.execute(text(
            "UPDATE governance_request SET status = 'In Progress', "
            "update_by = :user, update_at = NOW() WHERE id = :rid"
        ), {"rid": existing["request_id"], "user": user.id})
        await write_audit(db, "governance_request", str(existing["request_id"]),
                          "status_in_progress", user.id)

    await write_audit(db, "domain_review", review_id, "accepted", user.id,
                      new_value={"domainCode": row["domain_code"]})
    await db.commit()
    return _map(dict(row))


@router.put("/{review_id}/return", dependencies=[Depends(require_permission("domain_review", "write"))])
async def return_review(review_id: str, body: dict, user: AuthUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Return a review for additional information: Waiting for Accept → Return for Additional Information.
    Does NOT change governance request status.
    """
    existing = (await db.execute(text(
        "SELECT * FROM domain_review WHERE id = :id"
    ), {"id": review_id})).mappings().first()
    if not existing:
        raise HTTPException(status_code=404, detail="Not found")
    if existing["status"] != "Waiting for Accept":
        raise HTTPException(status_code=400, detail="Review must be in 'Waiting for Accept' status to return")
    await _check_domain_write_access(user, dict(existing), allow_governance_lead=True)

    reason = body.get("reason", "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="Return reason is required")

    row = (await db.execute(text(
        "UPDATE domain_review SET status = 'Return for Additional Information', "
        "return_reason = :reason, reviewer = :reviewer, reviewer_name = :reviewer_name, "
        "update_by = :user, update_at = NOW() "
        "WHERE id = :id RETURNING *"
    ), {
        "id": review_id, "reason": reason,
        "reviewer": user.id, "reviewer_name": user.name,
        "user": user.id,
    })).mappings().first()

    await write_audit(db, "domain_review", review_id, "returned", user.id,
                      new_value={"reason": reason, "domainCode": row["domain_code"]})
    await db.commit()
    return _map(dict(row))


@router.put("/{review_id}/resubmit", dependencies=[Depends(require_permission("governance_request", "write"))])
async def resubmit_review(review_id: str, body: dict = {}, user: AuthUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Resubmit after return: Return for Additional Information → Waiting for Accept.
    Called by the requestor after providing additional information.
    """
    existing = (await db.execute(text(
        "SELECT * FROM domain_review WHERE id = :id"
    ), {"id": review_id})).mappings().first()
    if not existing:
        raise HTTPException(status_code=404, detail="Not found")
    if existing["status"] != "Return for Additional Information":
        raise HTTPException(status_code=400, detail="Review must be in 'Return for Additional Information' status to resubmit")

    row = (await db.execute(text(
        "UPDATE domain_review SET status = 'Waiting for Accept', "
        "return_reason = NULL, update_by = :user, update_at = NOW() "
        "WHERE id = :id RETURNING *"
    ), {"id": review_id, "user": user.id})).mappings().first()

    await write_audit(db, "domain_review", review_id, "resubmitted", user.id,
                      new_value={"domainCode": row["domain_code"]})
    await db.commit()
    return _map(dict(row))


@router.put("/{review_id}/approve", dependencies=[Depends(require_permission("domain_review", "write"))])
async def approve_review(review_id: str, body: dict = {}, user: AuthUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Approve a review: Accept → Approved (terminal)."""
    existing = (await db.execute(text(
        "SELECT * FROM domain_review WHERE id = :id"
    ), {"id": review_id})).mappings().first()
    if not existing:
        raise HTTPException(status_code=404, detail="Not found")
    if existing["status"] != "Accept":
        raise HTTPException(status_code=400, detail="Review must be in 'Accept' status to approve")
    await _check_domain_write_access(user, dict(existing), allow_governance_lead=False)

    row = (await db.execute(text(
        "UPDATE domain_review SET status = 'Approved', "
        "completed_at = NOW(), update_by = :user, update_at = NOW() "
        "WHERE id = :id RETURNING *"
    ), {"id": review_id, "user": user.id})).mappings().first()

    await write_audit(db, "domain_review", review_id, "approved", user.id,
                      new_value={"domainCode": row["domain_code"]})
    await _check_auto_complete(db, existing["request_id"], user.id)
    await db.commit()
    return _map(dict(row))


@router.put("/{review_id}/approve-with-exception", dependencies=[Depends(require_permission("domain_review", "write"))])
async def approve_with_exception(review_id: str, body: dict = {}, user: AuthUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Approve with exception: Accept → Approved with Exception (terminal)."""
    existing = (await db.execute(text(
        "SELECT * FROM domain_review WHERE id = :id"
    ), {"id": review_id})).mappings().first()
    if not existing:
        raise HTTPException(status_code=404, detail="Not found")
    if existing["status"] != "Accept":
        raise HTTPException(status_code=400, detail="Review must be in 'Accept' status to approve with exception")
    await _check_domain_write_access(user, dict(existing), allow_governance_lead=False)

    row = (await db.execute(text(
        "UPDATE domain_review SET status = 'Approved with Exception', "
        "outcome_notes = :notes, completed_at = NOW(), update_by = :user, update_at = NOW() "
        "WHERE id = :id RETURNING *"
    ), {"id": review_id, "notes": body.get("outcomeNotes"), "user": user.id})).mappings().first()

    await write_audit(db, "domain_review", review_id, "approved_with_exception", user.id,
                      new_value={"domainCode": row["domain_code"], "outcomeNotes": body.get("outcomeNotes", "")})
    await _check_auto_complete(db, existing["request_id"], user.id)
    await db.commit()
    return _map(dict(row))


@router.put("/{review_id}/not-pass", dependencies=[Depends(require_permission("domain_review", "write"))])
async def not_pass_review(review_id: str, body: dict = {}, user: AuthUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Not pass a review: Accept → Not Passed (terminal)."""
    existing = (await db.execute(text(
        "SELECT * FROM domain_review WHERE id = :id"
    ), {"id": review_id})).mappings().first()
    if not existing:
        raise HTTPException(status_code=404, detail="Not found")
    if existing["status"] != "Accept":
        raise HTTPException(status_code=400, detail="Review must be in 'Accept' status to mark as not passed")
    await _check_domain_write_access(user, dict(existing), allow_governance_lead=False)

    row = (await db.execute(text(
        "UPDATE domain_review SET status = 'Not Passed', "
        "outcome_notes = :notes, completed_at = NOW(), update_by = :user, update_at = NOW() "
        "WHERE id = :id RETURNING *"
    ), {"id": review_id, "notes": body.get("outcomeNotes"), "user": user.id})).mappings().first()

    await write_audit(db, "domain_review", review_id, "not_passed", user.id,
                      new_value={"domainCode": row["domain_code"], "outcomeNotes": body.get("outcomeNotes", "")})
    await _check_auto_complete(db, existing["request_id"], user.id)
    await db.commit()
    return _map(dict(row))
