"""RBAC permission matrix for EGM.

Each role maps to a dict of { resource: [scopes] }.
Admin uses a wildcard "*" for both resource and scope.
"""
from __future__ import annotations

from app.auth.models import Role


# ---------------------------------------------------------------------------
# Permission matrix
# ---------------------------------------------------------------------------

ROLE_PERMISSIONS: dict[Role, dict[str, list[str]]] = {
    Role.ADMIN: {
        "*": ["*"],  # full access
    },
    Role.GOVERNANCE_LEAD: {
        "governance_request": ["read", "write"],
        "intake": ["read", "write"],
        "intake_template": ["read", "write"],
        "domain_registry": ["read", "write"],
        "domain_review": ["read", "assign"],
        "domain_questionnaire": ["read", "write"],
        "dispatch_rule": ["read", "write"],
        "review_action": ["read", "write"],
        "review_comment": ["read", "write"],
        "shared_artifact": ["read", "write"],
        "info_supplement_request": ["read", "write"],
        "user_authorization": ["read", "write"],
        "progress": ["read"],
        "dashboard": ["read"],
        "report": ["read"],
        "audit_log": ["read"],
        "export": ["execute"],
    },
    Role.DOMAIN_REVIEWER: {
        "governance_request": ["read"],
        "intake": ["read"],
        "intake_template": ["read"],
        "domain_review": ["read", "write", "assign"],
        "domain_questionnaire": ["read", "write"],
        "dispatch_rule": ["read"],
        "review_action": ["read", "write"],
        "review_comment": ["read", "write"],
        "shared_artifact": ["read", "write"],
        "info_supplement_request": ["read", "write"],
        "progress": ["read"],
        "dashboard": ["read"],
        "report": ["read"],
        "export": ["execute"],
    },
    Role.REQUESTOR: {
        "governance_request": ["read", "write"],
        "intake": ["read", "write"],
        "domain_registry": ["read"],
        "domain_review": ["read"],
        "review_action": ["read"],
        "shared_artifact": ["read"],
        "info_supplement_request": ["read", "write"],
        "progress": ["read"],
        "dashboard": ["read"],
    },
}


# ---------------------------------------------------------------------------
# Check helpers
# ---------------------------------------------------------------------------

def check_permission(roles: Role | list[Role], resource: str, scope: str) -> bool:
    """Return True if any role in *roles* is allowed *scope* on *resource*.

    Accepts a single Role or a list of Roles for backward compatibility.
    """
    if isinstance(roles, Role):
        roles = [roles]

    for role in roles:
        perms = ROLE_PERMISSIONS.get(role, {})

        # Wildcard role (admin)
        if "*" in perms and ("*" in perms["*"] or scope in perms["*"]):
            return True

        allowed_scopes = perms.get(resource, [])
        if "*" in allowed_scopes or scope in allowed_scopes:
            return True

    return False


def build_permission_list(roles: Role | list[Role]) -> list[str]:
    """Return a flat deduplicated list like ["governance_request:read", ...].

    Accepts a single Role or a list of Roles for backward compatibility.
    """
    if isinstance(roles, Role):
        roles = [roles]

    seen: set[str] = set()
    result: list[str] = []
    for role in roles:
        perms = ROLE_PERMISSIONS.get(role, {})
        for resource, scopes in perms.items():
            for scope in scopes:
                key = f"{resource}:{scope}"
                if key not in seen:
                    seen.add(key)
                    result.append(key)
    return result
