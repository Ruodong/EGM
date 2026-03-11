"""Auth data models — AuthUser, Role enum."""
from __future__ import annotations

from enum import Enum
from pydantic import BaseModel


class Role(str, Enum):
    """EGM user roles."""

    ADMIN = "admin"
    GOVERNANCE_LEAD = "governance_lead"
    DOMAIN_REVIEWER = "domain_reviewer"
    REQUESTOR = "requestor"
    VIEWER = "viewer"


class AuthUser(BaseModel):
    """Authenticated user context injected into request.state."""

    id: str  # itcode / preferred_username
    name: str
    email: str
    role: Role
    permissions: list[str] = []  # cached flat list, e.g. ["governance_request:read", ...]
