"""Row-level access control helpers for governance requests.

Centralises the owner / domain check so that every endpoint touching a
governance request by ID enforces the same rules:

- admin / governance_lead → full access
- domain_reviewer → can access if request has a domain in their assigned list;
  cannot access Draft requests
- requestor → can only access their own requests
"""
from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import AuthUser, Role


def is_requestor_only(user: AuthUser) -> bool:
    """True if user has ONLY the Requestor role (no admin/lead/reviewer)."""
    return all(r == Role.REQUESTOR for r in user.roles)


def is_domain_reviewer_only(user: AuthUser) -> bool:
    """True when highest role is domain_reviewer (no admin/lead)."""
    return (
        Role.DOMAIN_REVIEWER in user.roles
        and Role.ADMIN not in user.roles
        and Role.GOVERNANCE_LEAD not in user.roles
    )


async def assert_request_access(
    db: AsyncSession,
    user: AuthUser,
    request_uuid: str,
    *,
    requestor: str | None = None,
    status: str | None = None,
) -> None:
    """Raise 403 if *user* is not allowed to access the governance request.

    Parameters
    ----------
    request_uuid : str
        Internal UUID of the governance request.
    requestor : str | None
        If the caller already has the ``requestor`` column value, pass it
        here to avoid an extra DB round-trip.  Same for *status*.
    """
    # Admin / governance lead — unrestricted
    if Role.ADMIN in user.roles or Role.GOVERNANCE_LEAD in user.roles:
        return

    # Lazy-load requestor + status when the caller didn't provide them
    if requestor is None or status is None:
        row = (await db.execute(text(
            "SELECT requestor, status FROM governance_request WHERE id = :rid"
        ), {"rid": request_uuid})).mappings().first()
        if not row:
            raise HTTPException(status_code=404, detail="Governance request not found")
        requestor = row["requestor"]
        status = row["status"]

    # Requestor-only → own requests only
    if is_requestor_only(user):
        if requestor != user.id:
            raise HTTPException(
                status_code=403,
                detail="Access denied: you can only access your own requests",
            )
        return

    # Domain reviewer → no Draft, must share at least one domain
    if is_domain_reviewer_only(user):
        if status == "Draft":
            raise HTTPException(status_code=403, detail="Access denied")
        req_domains = (await db.execute(text("""
            SELECT DISTINCT crd.domain_code
            FROM governance_request_rule grr
            JOIN dispatch_rule cr ON cr.rule_code = grr.rule_code AND cr.is_active = true
            JOIN dispatch_rule_domain crd ON crd.rule_id = cr.id AND crd.relationship = 'in'
            WHERE grr.request_id = :rid
        """), {"rid": request_uuid})).scalars().all()
        if not any(dc in user.domain_codes for dc in req_domains):
            raise HTTPException(
                status_code=403,
                detail="Access denied: request not in your assigned domains",
            )
