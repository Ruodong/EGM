"""FastAPI dependency injection functions for auth.

Usage in routers:
    from app.auth import require_auth, require_role, require_permission, Role

    @router.get("", dependencies=[Depends(require_auth)])
    @router.post("", dependencies=[Depends(require_role(Role.ADMIN))])
    @router.put("/{id}", dependencies=[Depends(require_permission("governance_request", "write"))])
"""
from __future__ import annotations

from typing import Callable

from fastapi import Depends, HTTPException, Request

from app.auth.models import AuthUser, Role
from app.auth.rbac import check_permission as _check_permission
from app.config import settings


async def get_current_user(request: Request) -> AuthUser:
    """Retrieve the authenticated user from request.state."""
    user: AuthUser | None = getattr(request.state, "user", None)
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


async def require_auth(user: AuthUser = Depends(get_current_user)) -> AuthUser:
    """Dependency that simply requires authentication — any role allowed."""
    return user


def require_role(*roles: Role) -> Callable:
    """Return a dependency that requires the user to have one of *roles*."""

    async def _check(user: AuthUser = Depends(get_current_user)) -> AuthUser:
        if not any(r in user.roles for r in roles):
            raise HTTPException(
                status_code=403,
                detail=f"Insufficient role. Required: {[r.value for r in roles]}, have: {[r.value for r in user.roles]}",
            )
        return user

    return _check


def require_permission(resource: str, scope: str = "read") -> Callable:
    """Return a dependency that requires *scope* on *resource*."""

    async def _check(user: AuthUser = Depends(get_current_user)) -> AuthUser:
        if not _check_permission(user.roles, resource, scope):
            raise HTTPException(
                status_code=403,
                detail=f"No permission: {resource}:{scope}",
            )
        return user

    return _check
