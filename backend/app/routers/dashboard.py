"""Dashboard router — governance metrics & KPIs."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.database import get_db
from app.auth import require_permission
from app.auth.dependencies import get_current_user
from app.auth.models import AuthUser, Role

router = APIRouter()


def _requestor_filter(user: AuthUser) -> tuple[str, dict]:
    """Return (WHERE/AND clause, params) to scope queries for Requestor role."""
    if Role.ADMIN in user.roles or Role.GOVERNANCE_LEAD in user.roles or Role.DOMAIN_REVIEWER in user.roles:
        return ("", {})
    # Requestor — only see own requests
    return ("requestor = :uid", {"uid": user.id})


@router.get("/stats", dependencies=[Depends(require_permission("dashboard", "read"))])
async def dashboard_stats(
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    filt, params = _requestor_filter(user)
    where = f"WHERE {filt}" if filt else ""

    total = (await db.execute(text(f"SELECT COUNT(*) FROM governance_request {where}"), params)).scalar() or 0
    by_status = (await db.execute(text(
        f"SELECT status, COUNT(*) as cnt FROM governance_request {where} GROUP BY status ORDER BY status"
    ), params)).mappings().all()

    if filt:
        review_counts = (await db.execute(text(
            f"SELECT dr.domain_code, dr.status, COUNT(*) as cnt "
            f"FROM domain_review dr "
            f"JOIN governance_request gr ON dr.request_id = gr.id "
            f"WHERE gr.{filt} "
            f"GROUP BY dr.domain_code, dr.status"
        ), params)).mappings().all()
    else:
        review_counts = (await db.execute(text(
            "SELECT domain_code, status, COUNT(*) as cnt FROM domain_review GROUP BY domain_code, status"
        ))).mappings().all()

    return {
        "totalRequests": total,
        "byStatus": [{"status": r["status"], "count": r["cnt"]} for r in by_status],
        "reviewCounts": [{"domainCode": r["domain_code"], "status": r["status"], "count": r["cnt"]} for r in review_counts],
    }


@router.get("/pending-tasks", dependencies=[Depends(require_permission("dashboard", "read"))])
async def pending_tasks(
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    my_only: bool = Query(True, alias="myOnly"),
):
    """Items that need the current user's attention."""

    is_reviewer = (
        Role.ADMIN in user.roles
        or Role.GOVERNANCE_LEAD in user.roles
        or Role.DOMAIN_REVIEWER in user.roles
    )

    # ── Requestor section ──

    # 1) Domain reviews returned for additional info on requests the user owns
    returned_rows = (await db.execute(text(
        "SELECT dr.id AS review_id, gr.id AS gov_uuid, gr.request_id AS gov_request_id, "
        "       dr.domain_code, dg.domain_name, "
        "       dr.reviewer, dr.reviewer_name, "
        "       dr.return_reason, dr.update_at, "
        "       gr.project_name, gr.title AS gov_title "
        "FROM domain_review dr "
        "JOIN governance_request gr ON dr.request_id = gr.id "
        "LEFT JOIN domain_registry dg ON dr.domain_code = dg.domain_code "
        "WHERE dr.status = 'Return for Additional Information' "
        "  AND gr.requestor = :uid "
        "ORDER BY dr.update_at DESC"
    ), {"uid": user.id})).mappings().all()

    # 2) Action items assigned to the current user, pending on assignee side
    action_rows = (await db.execute(text(
        "SELECT ra.id, ra.action_no, ra.title, ra.description, "
        "       ra.priority, ra.action_type, ra.status, ra.due_date, "
        "       ra.create_by, ra.create_by_name, ra.create_at, ra.update_at, "
        "       ra.domain_review_id, "
        "       dr.domain_code, dg.domain_name, "
        "       gr.id AS gov_uuid, gr.request_id AS gov_request_id, "
        "       gr.project_name, gr.title AS gov_title, "
        "       lf.last_feedback_type, lf.last_feedback_at, "
        "       lf.last_feedback_content, lf.last_feedback_by_name "
        "FROM review_action ra "
        "JOIN domain_review dr ON ra.domain_review_id = dr.id "
        "JOIN governance_request gr ON dr.request_id = gr.id "
        "LEFT JOIN domain_registry dg ON dr.domain_code = dg.domain_code "
        "LEFT JOIN LATERAL ("
        "    SELECT feedback_type AS last_feedback_type, create_at AS last_feedback_at, "
        "           content AS last_feedback_content, created_by_name AS last_feedback_by_name "
        "    FROM review_action_feedback "
        "    WHERE action_id = ra.id "
        "    ORDER BY create_at DESC LIMIT 1"
        ") lf ON true "
        "WHERE ra.assignee = :uid "
        "  AND ra.status = 'Assigned' "
        "  AND (lf.last_feedback_type IS NULL OR lf.last_feedback_type != 'response') "
        "ORDER BY ra.update_at DESC"
    ), {"uid": user.id})).mappings().all()

    # ── Reviewer section (only for reviewer / admin / GL) ──

    reviewer_first_submit_rows: list = []
    reviewer_resubmitted_rows: list = []
    reviewer_pending_action_rows: list = []

    if is_reviewer:
        # Compute domain codes (used by first-submit and optionally by myOnly=false)
        domain_codes = user.domain_codes if user.domain_codes else []
        if Role.ADMIN in user.roles or Role.GOVERNANCE_LEAD in user.roles:
            all_dc = (await db.execute(text(
                "SELECT domain_code FROM domain_registry"
            ))).scalars().all()
            domain_codes = list(all_dc)

        # Determine reviewer filter: myOnly → dr.reviewer = uid, else → domain_codes
        if my_only:
            rev_filter = "dr.reviewer = :uid"
            rev_params: dict = {"uid": user.id}
        else:
            rev_filter = "dr.domain_code = ANY(:domain_codes)"
            rev_params = {"domain_codes": domain_codes}

        # 3a) Reviewer: first-time submissions waiting for acceptance
        #     return_reason IS NULL → never returned, first-time submit
        #     Always filtered by domain (not affected by myOnly)
        reviewer_first_submit_rows = (await db.execute(text(
            "SELECT dr.id AS review_id, gr.id AS gov_uuid, gr.request_id AS gov_request_id, "
            "       dr.domain_code, dg.domain_name, "
            "       dr.reviewer, dr.reviewer_name, "
            "       gr.requestor, gr.requestor_name, "
            "       gr.project_name, gr.title AS gov_title, dr.update_at "
            "FROM domain_review dr "
            "JOIN governance_request gr ON dr.request_id = gr.id "
            "LEFT JOIN domain_registry dg ON dr.domain_code = dg.domain_code "
            "WHERE dr.status = 'Waiting for Accept' "
            "  AND dr.return_reason IS NULL "
            "  AND dr.domain_code = ANY(:domain_codes) "
            "ORDER BY dr.update_at DESC"
        ), {"domain_codes": domain_codes})).mappings().all()

        # 3b) Reviewer: resubmitted reviews waiting for re-acceptance
        #     return_reason IS NOT NULL → previously returned, now resubmitted
        reviewer_resubmitted_rows = (await db.execute(text(
            "SELECT dr.id AS review_id, gr.id AS gov_uuid, gr.request_id AS gov_request_id, "
            "       dr.domain_code, dg.domain_name, "
            "       dr.reviewer, dr.reviewer_name, "
            "       gr.requestor, gr.requestor_name, "
            "       gr.project_name, gr.title AS gov_title, dr.update_at "
            "FROM domain_review dr "
            "JOIN governance_request gr ON dr.request_id = gr.id "
            "LEFT JOIN domain_registry dg ON dr.domain_code = dg.domain_code "
            f"WHERE dr.status = 'Waiting for Accept' "
            f"  AND dr.return_reason IS NOT NULL "
            f"  AND {rev_filter} "
            "ORDER BY dr.update_at DESC"
        ), rev_params)).mappings().all()

        # 4) Reviewer: action items where assignee responded, pending reviewer action
        reviewer_pending_action_rows = (await db.execute(text(
            "SELECT ra.id, ra.action_no, ra.title, ra.description, "
            "       ra.priority, ra.action_type, ra.status, ra.due_date, "
            "       ra.assignee, ra.assignee_name, "
            "       ra.create_by, ra.create_by_name, ra.create_at, ra.update_at, "
            "       ra.domain_review_id, "
            "       dr.domain_code, dg.domain_name, dr.reviewer, "
            "       gr.id AS gov_uuid, gr.request_id AS gov_request_id, "
            "       gr.project_name, gr.title AS gov_title, "
            "       lf.last_feedback_type, lf.last_feedback_at, "
            "       lf.last_feedback_content, lf.last_feedback_by_name "
            "FROM review_action ra "
            "JOIN domain_review dr ON ra.domain_review_id = dr.id "
            "JOIN governance_request gr ON dr.request_id = gr.id "
            "LEFT JOIN domain_registry dg ON dr.domain_code = dg.domain_code "
            "LEFT JOIN LATERAL ("
            "    SELECT feedback_type AS last_feedback_type, create_at AS last_feedback_at, "
            "           content AS last_feedback_content, created_by_name AS last_feedback_by_name "
            "    FROM review_action_feedback "
            "    WHERE action_id = ra.id "
            "    ORDER BY create_at DESC LIMIT 1"
            ") lf ON true "
            f"WHERE {rev_filter} "
            "  AND ra.status = 'Assigned' "
            "  AND lf.last_feedback_type = 'response' "
            "ORDER BY ra.update_at DESC"
        ), rev_params)).mappings().all()

    def _map_action_row(r: dict) -> dict:
        return {
            "id": r["id"],
            "actionNo": r["action_no"],
            "title": r["title"],
            "description": r["description"],
            "priority": r["priority"],
            "actionType": r["action_type"],
            "status": r["status"],
            "domainCode": r["domain_code"],
            "domainName": r["domain_name"],
            "domainReviewId": r["domain_review_id"],
            "govUuid": r["gov_uuid"],
            "govRequestId": r["gov_request_id"],
            "projectName": r["project_name"],
            "govTitle": r["gov_title"],
            "dueDate": r["due_date"].isoformat() if r.get("due_date") else None,
            "createBy": r["create_by"],
            "createByName": r["create_by_name"],
            "createAt": r["create_at"].isoformat() if r["create_at"] else None,
            "sendTime": r["update_at"].isoformat() if r["update_at"] else None,
            "lastFeedbackAt": r["last_feedback_at"].isoformat() if r["last_feedback_at"] else None,
            "lastFeedbackContent": r.get("last_feedback_content"),
            "lastFeedbackByName": r.get("last_feedback_by_name"),
        }

    return {
        "returnForAdditional": [
            {
                "reviewId": r["review_id"],
                "govUuid": r["gov_uuid"],
                "govRequestId": r["gov_request_id"],
                "domainCode": r["domain_code"],
                "domainName": r["domain_name"],
                "reviewerName": r["reviewer_name"] or r["reviewer"],
                "returnReason": r["return_reason"],
                "projectName": r["project_name"],
                "govTitle": r["gov_title"],
                "sendTime": r["update_at"].isoformat() if r["update_at"] else None,
            }
            for r in returned_rows
        ],
        "assignedActions": [_map_action_row(dict(r)) for r in action_rows],
        "reviewerFirstSubmit": [
            {
                "reviewId": r["review_id"],
                "govUuid": r["gov_uuid"],
                "govRequestId": r["gov_request_id"],
                "domainCode": r["domain_code"],
                "domainName": r["domain_name"],
                "reviewerName": r["reviewer_name"] or r["reviewer"],
                "requestorName": r["requestor_name"] or r["requestor"],
                "projectName": r["project_name"],
                "govTitle": r["gov_title"],
                "sendTime": r["update_at"].isoformat() if r["update_at"] else None,
            }
            for r in reviewer_first_submit_rows
        ],
        "reviewerResubmitted": [
            {
                "reviewId": r["review_id"],
                "govUuid": r["gov_uuid"],
                "govRequestId": r["gov_request_id"],
                "domainCode": r["domain_code"],
                "domainName": r["domain_name"],
                "reviewerName": r["reviewer_name"] or r["reviewer"],
                "requestorName": r["requestor_name"] or r["requestor"],
                "projectName": r["project_name"],
                "govTitle": r["gov_title"],
                "sendTime": r["update_at"].isoformat() if r["update_at"] else None,
            }
            for r in reviewer_resubmitted_rows
        ],
        "reviewerPendingActions": [
            {
                **_map_action_row(dict(r)),
                "assignee": r.get("assignee"),
                "assigneeName": r.get("assignee_name"),
            }
            for r in reviewer_pending_action_rows
        ],
    }


@router.get("/home-stats", dependencies=[Depends(require_permission("dashboard", "read"))])
async def home_stats(
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    filt, params = _requestor_filter(user)
    where = f"WHERE {filt}" if filt else ""
    and_clause = f"AND {filt}" if filt else ""

    total = (await db.execute(text(
        f"SELECT COUNT(*) FROM governance_request {where}"
    ), params)).scalar() or 0
    in_review = (await db.execute(text(
        f"SELECT COUNT(*) FROM governance_request WHERE status = 'In Progress' {and_clause}"
    ), params)).scalar() or 0
    completed = (await db.execute(text(
        f"SELECT COUNT(*) FROM governance_request WHERE status = 'Complete' {and_clause}"
    ), params)).scalar() or 0

    return {
        "totalRequests": total,
        "inReview": in_review,
        "completed": completed,
    }
