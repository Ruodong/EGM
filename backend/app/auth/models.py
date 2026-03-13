"""Auth data models — AuthUser, Role enum."""
from __future__ import annotations

from enum import Enum
from typing import Optional
from pydantic import BaseModel, computed_field


class Role(str, Enum):
    """EGM user roles."""

    ADMIN = "admin"
    GOVERNANCE_LEAD = "governance_lead"
    DOMAIN_REVIEWER = "domain_reviewer"
    REQUESTOR = "requestor"


class AuthUser(BaseModel):
    """Authenticated user context injected into request.state."""

    id: str  # itcode / preferred_username
    name: str
    email: str
    roles: list[Role] = [Role.REQUESTOR]
    domain_codes: list[str] = []  # domain codes for domain_reviewer
    permissions: list[str] = []  # cached flat list, e.g. ["governance_request:read", ...]

    @computed_field  # type: ignore[misc]
    @property
    def role(self) -> Role:
        """Backward-compatible single role (highest-priority role)."""
        priority = [Role.ADMIN, Role.GOVERNANCE_LEAD, Role.DOMAIN_REVIEWER, Role.REQUESTOR]
        for r in priority:
            if r in self.roles:
                return r
        return Role.REQUESTOR
