"""Review Action Items router — CRUD, state transitions, and feedback.

Action item state machine:
  Created → Assigned (auto or manual)
  Assigned → Closed | Cancelled
  Created → Cancelled
  Any → Copy (creates new action in Created state)

Guard: Actions can only be created when domain_review.status = 'Accept'.
"""
from __future__ import annotations

from datetime import date as _date
from fastapi import APIRouter, Depends, Query, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.database import get_db
from app.utils.audit import write_audit
from app.utils.email import send_action_notification
from app.auth import require_permission, get_current_user, AuthUser, Role
from app.utils.access import assert_request_access

router = APIRouter()

VALID_PRIORITIES = ("High", "Medium", "Low")
VALID_TYPES = ("Mandatory", "Long Term")
TERMINAL_STATUSES = ("Closed", "Cancelled")


# ═══════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════

def _map_action(r: dict) -> dict:
    """Map a review_action DB row to camelCase response."""
    return {
        "id": str(r["id"]),
        "domainReviewId": str(r["domain_review_id"]),
        "actionNo": r.get("action_no"),
        "title": r["title"],
        "description": r.get("description"),
        "priority": r["priority"],
        "actionType": r["action_type"],
        "status": r["status"],
        "assignee": r.get("assignee"),
        "assigneeName": r.get("assignee_name"),
        "dueDate": r["due_date"].isoformat() if r.get("due_date") else None,
        "closedAt": r["closed_at"].isoformat() if r.get("closed_at") else None,
        "cancelledAt": r["cancelled_at"].isoformat() if r.get("cancelled_at") else None,
        "createBy": r.get("create_by"),
        "createByName": r.get("create_by_name"),
        "createAt": r["create_at"].isoformat() if r.get("create_at") else None,
        "updateBy": r.get("update_by"),
        "updateByName": r.get("update_by_name"),
        "updateAt": r["update_at"].isoformat() if r.get("update_at") else None,
    }


def _map_feedback(r: dict) -> dict:
    """Map a review_action_feedback DB row to camelCase response."""
    return {
        "id": str(r["id"]),
        "actionId": str(r["action_id"]),
        "roundNo": r["round_no"],
        "feedbackType": r["feedback_type"],
        "content": r["content"],
        "createdBy": r["created_by"],
        "createdByName": r.get("created_by_name"),
        "createAt": r["create_at"].isoformat() if r.get("create_at") else None,
    }


def _map_feedback_attachment(r: dict) -> dict:
    """Map a review_action_feedback_attachment DB row to camelCase response."""
    return {
        "id": str(r["id"]),
        "feedbackId": str(r["feedback_id"]),
        "actionId": str(r["action_id"]),
        "fileName": r["file_name"],
        "fileSize": r["file_size"],
        "contentType": r["content_type"],
        "createBy": r["create_by"],
        "createByName": r.get("create_by_name"),
        "createAt": r["create_at"].isoformat() if r.get("create_at") else None,
    }


async def _get_review(db: AsyncSession, review_id: str) -> dict:
    """Fetch domain_review row. Raises 404 if not found."""
    row = (await db.execute(text(
        "SELECT * FROM domain_review WHERE id = :id"
    ), {"id": review_id})).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Domain review not found")
    return dict(row)


async def _get_action(db: AsyncSession, action_id: str) -> dict:
    """Fetch review_action row. Raises 404 if not found."""
    row = (await db.execute(text(
        "SELECT * FROM review_action WHERE id = :id"
    ), {"id": action_id})).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Action item not found")
    return dict(row)


async def _check_action_write_access(user: AuthUser, review_row: dict):
    """Check that user can manage actions on this domain review.

    Admin: always allowed
    Governance Lead: always allowed
    Domain Reviewer: only if domain_code in user.domain_codes
    Requestor: NOT allowed
    """
    if Role.ADMIN in user.roles:
        return
    if Role.GOVERNANCE_LEAD in user.roles:
        return
    if Role.DOMAIN_REVIEWER in user.roles:
        if review_row["domain_code"] in user.domain_codes:
            return
        raise HTTPException(
            status_code=403,
            detail=f"Access denied: not assigned to domain '{review_row['domain_code']}'"
        )
    raise HTTPException(status_code=403, detail="Insufficient permissions")


async def _get_requestor_info(db: AsyncSession, review_row: dict) -> dict:
    """Get the requestor itcode and name for the governance request linked to this review."""
    gr = (await db.execute(text(
        "SELECT requestor, requestor_name FROM governance_request WHERE id = :rid"
    ), {"rid": str(review_row["request_id"])})).mappings().first()
    if not gr:
        return {"itcode": None, "name": None}
    return {"itcode": gr["requestor"], "name": gr["requestor_name"]}


async def _get_email(db: AsyncSession, itcode: str) -> str | None:
    """Look up email from employee_info."""
    row = (await db.execute(text(
        "SELECT email FROM employee_info WHERE itcode = :itcode"
    ), {"itcode": itcode})).mappings().first()
    return row["email"] if row else None


async def _next_action_no(db: AsyncSession, review_id: str) -> int:
    """Get the next action_no for a domain review."""
    result = (await db.execute(text(
        "SELECT COALESCE(MAX(action_no), 0) + 1 AS next_no FROM review_action WHERE domain_review_id = :rid"
    ), {"rid": review_id})).scalar()
    return result or 1


# ═══════════════════════════════════════════════════════
# List / Read endpoints
# ═══════════════════════════════════════════════════════

@router.get("", dependencies=[Depends(require_permission("review_action", "read"))])
async def list_actions(
    domainReviewId: str | None = Query(None),
    requestId: str | None = Query(None),
    assignee: str | None = Query(None),
    status: str | None = Query(None),
    domainCode: str | None = Query(None),
    search: str | None = Query(None),
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List action items with optional filters.

    Role-based visibility:
    - Admin / Governance Lead: see all actions
    - Domain Reviewer: only actions on their assigned domains
    - Requestor: only actions where they are the assignee
    """
    conditions = []
    params: dict = {}

    # ── Role-based scoping ──
    if Role.ADMIN not in user.roles and Role.GOVERNANCE_LEAD not in user.roles:
        if Role.DOMAIN_REVIEWER in user.roles and user.domain_codes:
            conditions.append("dr.domain_code = ANY(:user_domains)")
            params["user_domains"] = list(user.domain_codes)
        else:
            # Requestor — only see actions assigned to them
            conditions.append("ra.assignee = :user_id")
            params["user_id"] = user.id

    if domainReviewId:
        conditions.append("ra.domain_review_id = :drid")
        params["drid"] = domainReviewId
    if requestId:
        conditions.append("(dr.request_id::text = :rid OR gr.request_id = :rid)")
        params["rid"] = requestId
    if assignee:
        conditions.append("ra.assignee = :assignee")
        params["assignee"] = assignee
    if status:
        status_list = [s.strip() for s in status.split(",")]
        if len(status_list) == 1:
            conditions.append("ra.status = :st")
            params["st"] = status_list[0]
        else:
            conditions.append("ra.status = ANY(:st)")
            params["st"] = status_list
    if domainCode:
        dc_list = [d.strip() for d in domainCode.split(",")]
        if len(dc_list) == 1:
            conditions.append("dr.domain_code = :dc")
            params["dc"] = dc_list[0]
        else:
            conditions.append("dr.domain_code = ANY(:dc)")
            params["dc"] = dc_list
    if search:
        conditions.append(
            "(ra.title ILIKE :search OR gr.request_id ILIKE :search"
            " OR ra.assignee_name ILIKE :search OR gr.requestor_name ILIKE :search)"
        )
        params["search"] = f"%{search}%"

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    rows = (await db.execute(text(f"""
        SELECT ra.*, dr.domain_code, dreg.domain_name,
               gr.request_id AS gov_request_id, gr.requestor,
               gr.requestor_name AS gov_requestor_name,
               gr.title AS gov_title,
               lf.last_feedback_type
        FROM review_action ra
        JOIN domain_review dr ON dr.id = ra.domain_review_id
        JOIN domain_registry dreg ON dreg.domain_code = dr.domain_code
        JOIN governance_request gr ON gr.id = dr.request_id
        LEFT JOIN LATERAL (
            SELECT feedback_type AS last_feedback_type
            FROM review_action_feedback
            WHERE action_id = ra.id
            ORDER BY create_at DESC LIMIT 1
        ) lf ON true
        {where}
        ORDER BY ra.create_at DESC
    """), params)).mappings().all()

    result = []
    for r in rows:
        action = _map_action(dict(r))
        action["domainCode"] = r["domain_code"]
        action["domainName"] = r["domain_name"]
        action["govRequestId"] = r["gov_request_id"]
        action["govRequestorName"] = r.get("gov_requestor_name")
        action["govTitle"] = r.get("gov_title")
        # Pending side: only meaningful when status = Assigned
        if r["status"] == "Assigned":
            lft = r.get("last_feedback_type")
            action["pendingSide"] = "reviewer" if lft == "response" else "assignee"
        else:
            action["pendingSide"] = None
        result.append(action)

    return {"data": result}


@router.get("/by-request/{request_id}", dependencies=[Depends(require_permission("review_action", "read"))])
async def actions_by_request(
    request_id: str,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get all actions for a governance request, grouped by domain."""
    # Resolve request UUID from request_id string (EGQ format)
    gr = (await db.execute(text(
        "SELECT id FROM governance_request WHERE request_id = :rid OR id::text = :rid"
    ), {"rid": request_id})).mappings().first()
    if not gr:
        raise HTTPException(status_code=404, detail="Request not found")

    # Row-level access control
    await assert_request_access(db, user, str(gr["id"]))

    rows = (await db.execute(text("""
        SELECT ra.*, dr.domain_code, dreg.domain_name,
               lf.last_feedback_type
        FROM review_action ra
        JOIN domain_review dr ON dr.id = ra.domain_review_id
        JOIN domain_registry dreg ON dreg.domain_code = dr.domain_code
        LEFT JOIN LATERAL (
            SELECT feedback_type AS last_feedback_type
            FROM review_action_feedback
            WHERE action_id = ra.id
            ORDER BY create_at DESC LIMIT 1
        ) lf ON true
        WHERE dr.request_id = :rid
        ORDER BY dr.domain_code, ra.action_no
    """), {"rid": str(gr["id"])})).mappings().all()

    # Group by domain
    domains: dict = {}
    for r in rows:
        dc = r["domain_code"]
        if dc not in domains:
            domains[dc] = {
                "domainCode": dc,
                "domainName": r["domain_name"],
                "actions": [],
            }
        action = _map_action(dict(r))
        if r["status"] == "Assigned":
            lft = r.get("last_feedback_type")
            action["pendingSide"] = "reviewer" if lft == "response" else "assignee"
        else:
            action["pendingSide"] = None
        domains[dc]["actions"].append(action)

    return {"data": list(domains.values())}


@router.get("/{action_id}", dependencies=[Depends(require_permission("review_action", "read"))])
async def get_action(
    action_id: str,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get a single action item with its feedback history."""
    row = (await db.execute(text("""
        SELECT ra.*, dr.domain_code, dreg.domain_name,
               gr.request_id AS gov_request_id
        FROM review_action ra
        JOIN domain_review dr ON dr.id = ra.domain_review_id
        JOIN domain_registry dreg ON dreg.domain_code = dr.domain_code
        JOIN governance_request gr ON gr.id = dr.request_id
        WHERE ra.id = :id
    """), {"id": action_id})).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Action item not found")

    action = _map_action(dict(row))
    action["domainCode"] = row["domain_code"]
    action["domainName"] = row["domain_name"]
    action["govRequestId"] = row["gov_request_id"]

    # Fetch feedback
    feedback_rows = (await db.execute(text(
        "SELECT * FROM review_action_feedback WHERE action_id = :aid ORDER BY create_at"
    ), {"aid": action_id})).mappings().all()
    action["feedback"] = [_map_feedback(dict(f)) for f in feedback_rows]

    # Fetch email logs
    email_rows = (await db.execute(text(
        "SELECT * FROM review_action_email_log WHERE action_id = :aid ORDER BY sent_at"
    ), {"aid": action_id})).mappings().all()
    action["emailLogs"] = [{
        "id": str(e["id"]),
        "emailType": e["email_type"],
        "recipient": e["recipient"],
        "recipientEmail": e.get("recipient_email"),
        "subject": e.get("subject"),
        "sentAt": e["sent_at"].isoformat() if e.get("sent_at") else None,
        "status": e["status"],
    } for e in email_rows]

    return action


@router.get("/{action_id}/feedback", dependencies=[Depends(require_permission("review_action", "read"))])
async def get_feedback(
    action_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Get all feedback entries for an action item, including attachments."""
    # Verify action exists
    await _get_action(db, action_id)

    rows = (await db.execute(text(
        "SELECT * FROM review_action_feedback WHERE action_id = :aid ORDER BY create_at"
    ), {"aid": action_id})).mappings().all()

    # Fetch all feedback attachments for this action in one query
    att_rows = (await db.execute(text(
        "SELECT id, feedback_id, action_id, file_name, file_size, content_type, "
        "create_by, create_by_name, create_at "
        "FROM review_action_feedback_attachment WHERE action_id = :aid ORDER BY create_at"
    ), {"aid": action_id})).mappings().all()

    # Group attachments by feedback_id
    att_by_feedback: dict[str, list] = {}
    for a in att_rows:
        fid = str(a["feedback_id"])
        att_by_feedback.setdefault(fid, []).append(_map_feedback_attachment(dict(a)))

    result = []
    for r in rows:
        fb = _map_feedback(dict(r))
        fb["attachments"] = att_by_feedback.get(fb["id"], [])
        result.append(fb)

    return {"data": result}


# ═══════════════════════════════════════════════════════
# Create
# ═══════════════════════════════════════════════════════

@router.post("", dependencies=[Depends(require_permission("review_action", "write"))])
async def create_action(
    body: dict,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create an action item on a domain review.

    Guard: domain_review must be in 'Accept' status.
    If assignee provided (or default to requestor), auto-transitions to 'Assigned'.
    """
    domain_review_id = body.get("domainReviewId")
    if not domain_review_id:
        raise HTTPException(status_code=400, detail="domainReviewId is required")

    title = (body.get("title") or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="title is required")

    review = await _get_review(db, domain_review_id)

    # Guard: only Accept status
    if review["status"] != "Accept":
        raise HTTPException(
            status_code=400,
            detail=f"Actions can only be created when review is in 'Accept' status (current: '{review['status']}')"
        )

    await _check_action_write_access(user, review)

    priority = body.get("priority", "Medium")
    if priority not in VALID_PRIORITIES:
        raise HTTPException(status_code=400, detail=f"Invalid priority. Must be one of: {', '.join(VALID_PRIORITIES)}")

    action_type = body.get("actionType", "Mandatory")
    if action_type not in VALID_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid actionType. Must be one of: {', '.join(VALID_TYPES)}")

    # Resolve assignee — default to requestor
    assignee = body.get("assignee")
    assignee_name = body.get("assigneeName")
    if not assignee:
        requestor_info = await _get_requestor_info(db, review)
        assignee = requestor_info["itcode"]
        assignee_name = requestor_info["name"]

    # If assignee is provided, resolve name from employee_info if not given
    if assignee and not assignee_name:
        emp = (await db.execute(text(
            "SELECT name FROM employee_info WHERE itcode = :itcode"
        ), {"itcode": assignee})).mappings().first()
        if emp:
            assignee_name = emp["name"]

    # Auto-assign if we have an assignee
    status = "Assigned" if assignee else "Created"

    action_no = await _next_action_no(db, domain_review_id)

    due_date_str = body.get("dueDate")  # expects 'YYYY-MM-DD' string or None
    due_date = _date.fromisoformat(due_date_str) if due_date_str else None

    row = (await db.execute(text("""
        INSERT INTO review_action
            (domain_review_id, action_no, title, description, priority, action_type,
             status, assignee, assignee_name, due_date,
             create_by, create_by_name, update_by, update_by_name)
        VALUES (:drid, :action_no, :title, :desc, :priority, :action_type,
                :status, :assignee, :assignee_name, :due_date,
                :create_by, :create_by_name, :create_by, :create_by_name)
        RETURNING *
    """), {
        "drid": domain_review_id,
        "action_no": action_no,
        "title": title,
        "desc": body.get("description"),
        "priority": priority,
        "action_type": action_type,
        "status": status,
        "assignee": assignee,
        "assignee_name": assignee_name,
        "due_date": due_date,
        "create_by": user.id,
        "create_by_name": user.name,
    })).mappings().first()

    await write_audit(db, "review_action", str(row["id"]), "created", user.id,
                      new_value={"title": title, "status": status, "assignee": assignee,
                                 "dueDate": due_date_str, "domainCode": review["domain_code"]})

    # Send notification if assigned
    if status == "Assigned" and assignee:
        email = await _get_email(db, assignee)
        await send_action_notification(
            db, str(row["id"]), "assigned", assignee, email,
            f"[EGM] Action Item Assigned: {title}"
        )

    await db.commit()
    return _map_action(dict(row))


# ═══════════════════════════════════════════════════════
# Update fields
# ═══════════════════════════════════════════════════════

@router.put("/{action_id}", dependencies=[Depends(require_permission("review_action", "write"))])
async def update_action(
    action_id: str,
    body: dict,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update action item fields (title, description, priority, actionType)."""
    action = await _get_action(db, action_id)
    if action["status"] in TERMINAL_STATUSES:
        raise HTTPException(status_code=400, detail=f"Cannot update action in '{action['status']}' status")

    review = await _get_review(db, str(action["domain_review_id"]))
    await _check_action_write_access(user, review)

    updates = []
    params: dict = {"id": action_id, "user": user.id, "user_name": user.name}

    for field, col in [("title", "title"), ("description", "description"),
                       ("priority", "priority"), ("actionType", "action_type"),
                       ("dueDate", "due_date")]:
        if field in body:
            val = body[field]
            if field == "priority" and val not in VALID_PRIORITIES:
                raise HTTPException(status_code=400, detail=f"Invalid priority")
            if field == "actionType" and val not in VALID_TYPES:
                raise HTTPException(status_code=400, detail=f"Invalid actionType")
            if field == "dueDate" and val:
                val = _date.fromisoformat(val)
            updates.append(f"{col} = :{col}")
            params[col] = val

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    updates.append("update_by = :user")
    updates.append("update_by_name = :user_name")
    updates.append("update_at = NOW()")

    row = (await db.execute(text(f"""
        UPDATE review_action SET {', '.join(updates)} WHERE id = :id RETURNING *
    """), params)).mappings().first()

    await write_audit(db, "review_action", action_id, "updated", user.id,
                      new_value={k: body[k] for k in body if k in ("title", "description", "priority", "actionType")})
    await db.commit()
    return _map_action(dict(row))


# ═══════════════════════════════════════════════════════
# State transitions
# ═══════════════════════════════════════════════════════

@router.put("/{action_id}/assign", dependencies=[Depends(require_permission("review_action", "write"))])
async def assign_action(
    action_id: str,
    body: dict,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Assign an action: Created → Assigned."""
    action = await _get_action(db, action_id)
    if action["status"] != "Created":
        raise HTTPException(status_code=400, detail="Only 'Created' actions can be assigned")

    review = await _get_review(db, str(action["domain_review_id"]))
    await _check_action_write_access(user, review)

    assignee = body.get("assignee")
    if not assignee:
        raise HTTPException(status_code=400, detail="assignee is required")

    assignee_name = body.get("assigneeName")
    if not assignee_name:
        emp = (await db.execute(text(
            "SELECT name FROM employee_info WHERE itcode = :itcode"
        ), {"itcode": assignee})).mappings().first()
        if emp:
            assignee_name = emp["name"]

    row = (await db.execute(text("""
        UPDATE review_action
        SET status = 'Assigned', assignee = :assignee, assignee_name = :assignee_name,
            update_by = :user, update_by_name = :user_name, update_at = NOW()
        WHERE id = :id RETURNING *
    """), {
        "id": action_id, "assignee": assignee, "assignee_name": assignee_name,
        "user": user.id, "user_name": user.name,
    })).mappings().first()

    await write_audit(db, "review_action", action_id, "assigned", user.id,
                      new_value={"assignee": assignee, "domainCode": review["domain_code"]})

    email = await _get_email(db, assignee)
    await send_action_notification(
        db, action_id, "assigned", assignee, email,
        f"[EGM] Action Item Assigned: {action['title']}"
    )

    await db.commit()
    return _map_action(dict(row))


@router.put("/{action_id}/close", dependencies=[Depends(require_permission("review_action", "write"))])
async def close_action(
    action_id: str,
    body: dict = {},
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Close an action: Assigned → Closed."""
    action = await _get_action(db, action_id)
    if action["status"] != "Assigned":
        raise HTTPException(status_code=400, detail="Only 'Assigned' actions can be closed")

    review = await _get_review(db, str(action["domain_review_id"]))
    await _check_action_write_access(user, review)

    row = (await db.execute(text("""
        UPDATE review_action
        SET status = 'Closed', closed_at = NOW(),
            update_by = :user, update_by_name = :user_name, update_at = NOW()
        WHERE id = :id RETURNING *
    """), {"id": action_id, "user": user.id, "user_name": user.name})).mappings().first()

    await write_audit(db, "review_action", action_id, "closed", user.id,
                      new_value={"domainCode": review["domain_code"]})

    # Notify assignee
    if action.get("assignee"):
        email = await _get_email(db, action["assignee"])
        await send_action_notification(
            db, action_id, "closed", action["assignee"], email,
            f"[EGM] Action Item Closed: {action['title']}"
        )

    await db.commit()
    return _map_action(dict(row))


@router.put("/{action_id}/cancel", dependencies=[Depends(require_permission("review_action", "write"))])
async def cancel_action(
    action_id: str,
    body: dict = {},
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Cancel an action: Created|Assigned → Cancelled."""
    action = await _get_action(db, action_id)
    if action["status"] in TERMINAL_STATUSES:
        raise HTTPException(status_code=400, detail=f"Cannot cancel action in '{action['status']}' status")

    review = await _get_review(db, str(action["domain_review_id"]))
    await _check_action_write_access(user, review)

    row = (await db.execute(text("""
        UPDATE review_action
        SET status = 'Cancelled', cancelled_at = NOW(),
            update_by = :user, update_by_name = :user_name, update_at = NOW()
        WHERE id = :id RETURNING *
    """), {"id": action_id, "user": user.id, "user_name": user.name})).mappings().first()

    await write_audit(db, "review_action", action_id, "cancelled", user.id,
                      new_value={"domainCode": review["domain_code"]})
    await db.commit()
    return _map_action(dict(row))


# ═══════════════════════════════════════════════════════
# Copy
# ═══════════════════════════════════════════════════════

@router.post("/{action_id}/copy", dependencies=[Depends(require_permission("review_action", "write"))])
async def copy_action(
    action_id: str,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Copy an action: creates a new action with the same metadata, status=Created."""
    action = await _get_action(db, action_id)
    review = await _get_review(db, str(action["domain_review_id"]))
    await _check_action_write_access(user, review)

    # Guard: review must still be in Accept to create new actions
    if review["status"] != "Accept":
        raise HTTPException(
            status_code=400,
            detail=f"Cannot copy action: review is in '{review['status']}' status (must be 'Accept')"
        )

    action_no = await _next_action_no(db, str(action["domain_review_id"]))

    row = (await db.execute(text("""
        INSERT INTO review_action
            (domain_review_id, action_no, title, description, priority, action_type,
             status, assignee, assignee_name, due_date,
             create_by, create_by_name, update_by, update_by_name)
        VALUES (:drid, :action_no, :title, :desc, :priority, :action_type,
                'Assigned', :assignee, :assignee_name, :due_date,
                :create_by, :create_by_name, :create_by, :create_by_name)
        RETURNING *
    """), {
        "drid": str(action["domain_review_id"]),
        "action_no": action_no,
        "title": action["title"],
        "desc": action.get("description"),
        "priority": action["priority"],
        "action_type": action["action_type"],
        "assignee": action.get("assignee"),
        "assignee_name": action.get("assignee_name"),
        "due_date": action.get("due_date"),
        "create_by": user.id,
        "create_by_name": user.name,
    })).mappings().first()

    await write_audit(db, "review_action", str(row["id"]), "copied", user.id,
                      new_value={"copiedFrom": action_id, "title": action["title"],
                                 "domainCode": review["domain_code"]})

    # Send notification if assigned
    if action.get("assignee"):
        email = await _get_email(db, action["assignee"])
        await send_action_notification(
            db, str(row["id"]), "assigned", action["assignee"], email,
            f"[EGM] Action Item Assigned: {action['title']}"
        )

    await db.commit()
    return _map_action(dict(row))


# ═══════════════════════════════════════════════════════
# Feedback
# ═══════════════════════════════════════════════════════

@router.post("/{action_id}/feedback")
async def submit_feedback(
    action_id: str,
    body: dict,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Submit feedback on an action item.

    - Assignee submits 'response' type feedback (requires review_action:feedback permission)
    - Reviewer/Lead/Admin submits 'follow_up' type feedback (requires review_action:write permission)
    """
    action = await _get_action(db, action_id)
    if action["status"] in TERMINAL_STATUSES:
        raise HTTPException(status_code=400, detail=f"Cannot submit feedback on '{action['status']}' action")
    if action["status"] == "Created":
        raise HTTPException(status_code=400, detail="Action must be assigned before feedback can be submitted")

    review = await _get_review(db, str(action["domain_review_id"]))

    content = (body.get("content") or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="content is required")

    # Determine feedback type based on who is submitting
    is_assignee = (user.id == action.get("assignee"))
    has_write = (
        Role.ADMIN in user.roles
        or Role.GOVERNANCE_LEAD in user.roles
        or (Role.DOMAIN_REVIEWER in user.roles and review["domain_code"] in user.domain_codes)
    )

    if is_assignee:
        feedback_type = "response"
    elif has_write:
        feedback_type = "follow_up"
    else:
        raise HTTPException(status_code=403, detail="Not authorized to submit feedback on this action")

    # Calculate round_no
    if feedback_type == "response":
        # Each assignee response increments round_no
        last_round = (await db.execute(text(
            "SELECT COALESCE(MAX(round_no), 0) FROM review_action_feedback "
            "WHERE action_id = :aid AND feedback_type = 'response'"
        ), {"aid": action_id})).scalar() or 0
        round_no = last_round + 1
    else:
        # follow_up shares the same round as the last response
        last_round = (await db.execute(text(
            "SELECT COALESCE(MAX(round_no), 0) FROM review_action_feedback "
            "WHERE action_id = :aid AND feedback_type = 'response'"
        ), {"aid": action_id})).scalar() or 0
        round_no = max(last_round, 1)

    row = (await db.execute(text("""
        INSERT INTO review_action_feedback
            (action_id, round_no, feedback_type, content, created_by, created_by_name)
        VALUES (:aid, :round_no, :ftype, :content, :created_by, :created_by_name)
        RETURNING *
    """), {
        "aid": action_id,
        "round_no": round_no,
        "ftype": feedback_type,
        "content": content,
        "created_by": user.id,
        "created_by_name": user.name,
    })).mappings().first()

    # Bump update_at on the action for time-tracking analytics
    await db.execute(text(
        "UPDATE review_action SET update_at = NOW(), update_by = :user, update_by_name = :user_name "
        "WHERE id = :id"
    ), {"id": action_id, "user": user.id, "user_name": user.name})

    await write_audit(db, "review_action", action_id,
                      "feedback_response" if feedback_type == "response" else "feedback_follow_up",
                      user.id,
                      new_value={"roundNo": round_no, "feedbackType": feedback_type,
                                 "domainCode": review["domain_code"]})

    # Send notification to the other party
    if feedback_type == "response":
        # Notify the reviewer (action creator)
        reviewer = action.get("create_by")
        if reviewer:
            email = await _get_email(db, reviewer)
            await send_action_notification(
                db, action_id, "feedback_submitted", reviewer, email,
                f"[EGM] Feedback Received: {action['title']}"
            )
    else:
        # Notify the assignee
        assignee = action.get("assignee")
        if assignee:
            email = await _get_email(db, assignee)
            await send_action_notification(
                db, action_id, "follow_up", assignee, email,
                f"[EGM] Follow-up Required: {action['title']}"
            )

    await db.commit()
    return _map_feedback(dict(row))


# ═══════════════════════════════════════════════════════
# Attachments
# ═══════════════════════════════════════════════════════

async def _check_attachment_access(user: AuthUser, action_row: dict, review_row: dict):
    """Check that user can upload attachments on this action.

    Both reviewer and requestor (assignee) are allowed.
    Admin / Governance Lead: always allowed.
    Domain Reviewer: if domain_code in their domains.
    Requestor: if they are the assignee of this action.
    """
    if Role.ADMIN in user.roles or Role.GOVERNANCE_LEAD in user.roles:
        return
    if Role.DOMAIN_REVIEWER in user.roles and review_row["domain_code"] in user.domain_codes:
        return
    if user.id == action_row.get("assignee"):
        return
    raise HTTPException(status_code=403, detail="Not authorized to manage attachments on this action")


@router.post("/{action_id}/attachments", dependencies=[Depends(require_permission("review_action", "read"))])
async def upload_action_attachment(
    action_id: str,
    file: UploadFile,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Upload a file attachment to an action item."""
    action = await _get_action(db, action_id)
    review = await _get_review(db, str(action["domain_review_id"]))
    await _check_attachment_access(user, action, review)

    data = await file.read()
    row = (await db.execute(text("""
        INSERT INTO review_action_attachment
            (action_id, file_name, file_size, content_type, file_data, create_by, create_by_name)
        VALUES (:aid, :fname, :fsize, :ctype, :fdata, :user, :user_name)
        RETURNING id, file_name, file_size, content_type, create_by, create_by_name, create_at
    """), {
        "aid": action_id,
        "fname": file.filename or "untitled",
        "fsize": len(data),
        "ctype": file.content_type or "application/octet-stream",
        "fdata": data,
        "user": user.id,
        "user_name": user.name,
    })).mappings().first()

    await write_audit(db, "review_action", action_id, "attachment_uploaded", user.id,
                      new_value={"fileName": row["file_name"], "fileSize": row["file_size"]})
    await db.commit()
    return {
        "id": str(row["id"]),
        "fileName": row["file_name"],
        "fileSize": row["file_size"],
        "contentType": row["content_type"],
        "createBy": row["create_by"],
        "createByName": row["create_by_name"],
        "createAt": row["create_at"].isoformat() if row["create_at"] else None,
    }


@router.get("/{action_id}/attachments", dependencies=[Depends(require_permission("review_action", "read"))])
async def list_action_attachments(
    action_id: str,
    db: AsyncSession = Depends(get_db),
):
    """List all attachments for an action item (metadata only, no binary)."""
    await _get_action(db, action_id)
    rows = (await db.execute(text("""
        SELECT id, file_name, file_size, content_type, create_by, create_by_name, create_at
        FROM review_action_attachment WHERE action_id = :aid ORDER BY create_at
    """), {"aid": action_id})).mappings().all()
    return {"data": [{
        "id": str(r["id"]),
        "fileName": r["file_name"],
        "fileSize": r["file_size"],
        "contentType": r["content_type"],
        "createBy": r["create_by"],
        "createByName": r["create_by_name"],
        "createAt": r["create_at"].isoformat() if r["create_at"] else None,
    } for r in rows]}


@router.get("/{action_id}/attachments/{att_id}", dependencies=[Depends(require_permission("review_action", "read"))])
async def download_action_attachment(
    action_id: str,
    att_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Download an action attachment (returns binary file)."""
    row = (await db.execute(text("""
        SELECT file_name, content_type, file_data
        FROM review_action_attachment
        WHERE id = :att_id AND action_id = :aid
    """), {"att_id": att_id, "aid": action_id})).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Attachment not found")
    disposition = "inline" if row["content_type"].startswith("image/") else "attachment"
    return Response(
        content=bytes(row["file_data"]),
        media_type=row["content_type"],
        headers={"Content-Disposition": f'{disposition}; filename="{row["file_name"]}"'},
    )


@router.delete("/{action_id}/attachments/{att_id}", dependencies=[Depends(require_permission("review_action", "read"))])
async def delete_action_attachment(
    action_id: str,
    att_id: str,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete an action attachment. Only the uploader or admin/lead can delete."""
    action = await _get_action(db, action_id)

    # Fetch the attachment to check ownership
    att = (await db.execute(text(
        "SELECT id, create_by, file_name FROM review_action_attachment WHERE id = :att_id AND action_id = :aid"
    ), {"att_id": att_id, "aid": action_id})).mappings().first()
    if not att:
        raise HTTPException(status_code=404, detail="Attachment not found")

    # Only uploader or admin/lead can delete
    if att["create_by"] != user.id and Role.ADMIN not in user.roles and Role.GOVERNANCE_LEAD not in user.roles:
        raise HTTPException(status_code=403, detail="Can only delete your own attachments")

    await db.execute(text(
        "DELETE FROM review_action_attachment WHERE id = :att_id"
    ), {"att_id": att_id})

    await write_audit(db, "review_action", action_id, "attachment_deleted", user.id,
                      new_value={"fileName": att["file_name"]})
    await db.commit()
    return {"deleted": True}


# ═══════════════════════════════════════════════════════
# Feedback Attachments
# ═══════════════════════════════════════════════════════

async def _check_feedback_attachment_access(user: AuthUser, action_row: dict, review_row: dict):
    """Check that user can upload feedback attachments.

    Same rules as feedback submission:
    - Admin / Governance Lead: always allowed.
    - Domain Reviewer: if domain_code in their domains.
    - Requestor (assignee): allowed.
    """
    if Role.ADMIN in user.roles or Role.GOVERNANCE_LEAD in user.roles:
        return
    if Role.DOMAIN_REVIEWER in user.roles and review_row["domain_code"] in user.domain_codes:
        return
    if user.id == action_row.get("assignee"):
        return
    raise HTTPException(status_code=403, detail="Not authorized to manage feedback attachments")


@router.post("/{action_id}/feedback/{feedback_id}/attachments",
             dependencies=[Depends(require_permission("review_action", "read"))])
async def upload_feedback_attachment(
    action_id: str,
    feedback_id: str,
    file: UploadFile,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Upload a file attachment to a feedback entry."""
    action = await _get_action(db, action_id)
    review = await _get_review(db, str(action["domain_review_id"]))
    await _check_feedback_attachment_access(user, action, review)

    # Verify feedback belongs to this action
    fb = (await db.execute(text(
        "SELECT id FROM review_action_feedback WHERE id = :fid AND action_id = :aid"
    ), {"fid": feedback_id, "aid": action_id})).mappings().first()
    if not fb:
        raise HTTPException(status_code=404, detail="Feedback not found")

    data = await file.read()
    row = (await db.execute(text("""
        INSERT INTO review_action_feedback_attachment
            (feedback_id, action_id, file_name, file_size, content_type, file_data, create_by, create_by_name)
        VALUES (:fid, :aid, :fname, :fsize, :ctype, :fdata, :user, :user_name)
        RETURNING id, feedback_id, action_id, file_name, file_size, content_type, create_by, create_by_name, create_at
    """), {
        "fid": feedback_id,
        "aid": action_id,
        "fname": file.filename or "untitled",
        "fsize": len(data),
        "ctype": file.content_type or "application/octet-stream",
        "fdata": data,
        "user": user.id,
        "user_name": user.name,
    })).mappings().first()

    await write_audit(db, "review_action", action_id, "feedback_attachment_uploaded", user.id,
                      new_value={"feedbackId": feedback_id, "fileName": row["file_name"],
                                 "fileSize": row["file_size"]})
    await db.commit()
    return _map_feedback_attachment(dict(row))


@router.get("/{action_id}/feedback/{feedback_id}/attachments/{att_id}",
            dependencies=[Depends(require_permission("review_action", "read"))])
async def download_feedback_attachment(
    action_id: str,
    feedback_id: str,
    att_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Download a feedback attachment (returns binary file)."""
    row = (await db.execute(text("""
        SELECT file_name, content_type, file_data
        FROM review_action_feedback_attachment
        WHERE id = :att_id AND feedback_id = :fid AND action_id = :aid
    """), {"att_id": att_id, "fid": feedback_id, "aid": action_id})).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Feedback attachment not found")
    disposition = "inline" if row["content_type"].startswith("image/") else "attachment"
    return Response(
        content=bytes(row["file_data"]),
        media_type=row["content_type"],
        headers={"Content-Disposition": f'{disposition}; filename="{row["file_name"]}"'},
    )


@router.delete("/{action_id}/feedback/{feedback_id}/attachments/{att_id}",
               dependencies=[Depends(require_permission("review_action", "read"))])
async def delete_feedback_attachment(
    action_id: str,
    feedback_id: str,
    att_id: str,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a feedback attachment. Only the uploader or admin/lead can delete."""
    att = (await db.execute(text(
        "SELECT id, create_by, file_name FROM review_action_feedback_attachment "
        "WHERE id = :att_id AND feedback_id = :fid AND action_id = :aid"
    ), {"att_id": att_id, "fid": feedback_id, "aid": action_id})).mappings().first()
    if not att:
        raise HTTPException(status_code=404, detail="Feedback attachment not found")

    if att["create_by"] != user.id and Role.ADMIN not in user.roles and Role.GOVERNANCE_LEAD not in user.roles:
        raise HTTPException(status_code=403, detail="Can only delete your own attachments")

    await db.execute(text(
        "DELETE FROM review_action_feedback_attachment WHERE id = :att_id"
    ), {"att_id": att_id})

    await write_audit(db, "review_action", action_id, "feedback_attachment_deleted", user.id,
                      new_value={"feedbackId": feedback_id, "fileName": att["file_name"]})
    await db.commit()
    return {"deleted": True}
