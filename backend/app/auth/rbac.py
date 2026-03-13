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
        "domain_registry": ["read"],
        "domain_review": ["read", "write", "assign"],
        "domain_questionnaire": ["read", "write"],
        "dispatch_rule": ["read"],
        "review_action": ["read", "write"],
        "review_comment": ["read", "write"],
        "shared_artifact": ["read", "write"],
        "info_supplement_request": ["read", "write"],
        "user_authorization": ["read"],
        "progress": ["read"],
        "dashboard": ["read"],
        "report": ["read"],
        "audit_log": ["read"],
        "export": ["execute"],
    },
    Role.DOMAIN_REVIEWER: {
        "governance_request": ["read"],
        "intake": ["read"],
        "domain_review": ["read", "write"],
        "domain_questionnaire": ["read", "write"],
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
        "dispatch_rule": ["read"],
        "domain_review": ["read"],
        "review_action": ["read"],
        "shared_artifact": ["read"],
        "info_supplement_request": ["read", "write"],
        "progress": ["read"],
        "dashboard": ["read"],
    },
    Role.VIEWER: {
        "governance_request": ["read"],
        "intake": ["read"],
        "domain_review": ["read"],
        "review_action": ["read"],
        "shared_artifact": ["read"],
        "progress": ["read"],
        "dashboard": ["read"],
        "report": ["read"],
    },
}


# ---------------------------------------------------------------------------
# Check helpers
# ---------------------------------------------------------------------------

def check_permission(role: Role, resource: str, scope: str) -> bool:
    """Return True if *role* is allowed *scope* on *resource*."""
    perms = ROLE_PERMISSIONS.get(role, {})

    # Wildcard role (admin)
    if "*" in perms and ("*" in perms["*"] or scope in perms["*"]):
        return True

    allowed_scopes = perms.get(resource, [])
    return "*" in allowed_scopes or scope in allowed_scopes


def build_permission_list(role: Role) -> list[str]:
    """Return a flat list like ["governance_request:read", ...] for *role*."""
    perms = ROLE_PERMISSIONS.get(role, {})
    result: list[str] = []
    for resource, scopes in perms.items():
        for scope in scopes:
            result.append(f"{resource}:{scope}")
    return result
