"""Authentication providers — Dev mode & Keycloak."""
from __future__ import annotations

import abc
import logging
import time
from typing import Any

import httpx
from fastapi import Request
from sqlalchemy import text

from app.auth.models import AuthUser, Role
from app.auth.rbac import build_permission_list
from app.config import settings

logger = logging.getLogger("egm.auth")


async def resolve_roles_from_db(itcode: str) -> tuple[list[Role], list[str]]:
    """Look up a user's assigned roles and domain codes from the DB.

    Returns (roles, domain_codes).  Empty lists if no assignment exists.
    """
    from app.database import AsyncSessionLocal

    roles: list[Role] = []
    domain_codes: list[str] = []
    try:
        async with AsyncSessionLocal() as session:
            # Fetch all roles for this user
            rows = (await session.execute(
                text("SELECT id, role FROM egm.user_role WHERE itcode = :itcode"),
                {"itcode": itcode},
            )).mappings().all()
            role_ids: list[str] = []
            for row in rows:
                try:
                    roles.append(Role(row["role"]))
                    if row["role"] == "domain_reviewer":
                        role_ids.append(str(row["id"]))
                except ValueError:
                    pass

            # Fetch domain codes for domain_reviewer role entries
            if role_ids:
                dc_rows = (await session.execute(
                    text("SELECT domain_code FROM egm.user_role_domain WHERE user_role_id = ANY(:ids)"),
                    {"ids": role_ids},
                )).mappings().all()
                domain_codes = [r["domain_code"] for r in dc_rows]
    except Exception as exc:
        logger.warning("DB role lookup failed for %s: %s", itcode, exc)
    return roles, domain_codes


async def resolve_employee_info(itcode: str) -> tuple[str, str]:
    """Return (name, email) from employee_info for the given itcode.

    Falls back to (itcode, itcode@dev.local) if the employee is not found.
    """
    from app.database import AsyncSessionLocal

    try:
        async with AsyncSessionLocal() as session:
            row = (await session.execute(
                text("SELECT name, email FROM egm.employee_info WHERE itcode = :itcode"),
                {"itcode": itcode},
            )).mappings().first()
            if row:
                return row["name"], row["email"]
    except Exception as exc:
        logger.warning("Employee info lookup failed for %s: %s", itcode, exc)
    return itcode, f"{itcode}@dev.local"


class AuthProvider(abc.ABC):
    @abc.abstractmethod
    async def authenticate(self, request: Request) -> AuthUser | None: ...


class DevAuthProvider(AuthProvider):
    """Return a fixed dev user — used when AUTH_DISABLED=True."""

    # Display names for dev role switching
    _ROLE_NAMES: dict[Role, str] = {
        Role.ADMIN: "Admin User",
        Role.GOVERNANCE_LEAD: "Governance Lead",
        Role.DOMAIN_REVIEWER: "Domain Reviewer",
        Role.REQUESTOR: "Requestor",
    }

    async def authenticate(self, request: Request) -> AuthUser | None:
        # X-Dev-User: switch to a real user identity from employee_info + user_role
        dev_user = request.headers.get("X-Dev-User", "").strip()
        if dev_user:
            db_roles, domain_codes = await resolve_roles_from_db(dev_user)
            roles = db_roles if db_roles else [Role(settings.AUTH_DEV_ROLE)]
            name, email = await resolve_employee_info(dev_user)
            return AuthUser(
                id=dev_user,
                name=name,
                email=email,
                roles=roles,
                domain_codes=domain_codes,
                permissions=build_permission_list(roles),
            )

        # Allow role override via header in dev mode (highest priority)
        # Supports comma-separated roles: X-Dev-Role: requestor,domain_reviewer
        override = request.headers.get("X-Dev-Role", "").strip()
        if override:
            roles: list[Role] = []
            for part in override.split(","):
                part = part.strip()
                try:
                    roles.append(Role(part))
                except ValueError:
                    pass
            if not roles:
                roles = [Role(settings.AUTH_DEV_ROLE)]
            domain_codes = []
        else:
            # Check DB for assigned roles, fall back to dev default
            db_roles, domain_codes = await resolve_roles_from_db(settings.AUTH_DEV_USER)
            roles = db_roles if db_roles else [Role(settings.AUTH_DEV_ROLE)]

        name = self._ROLE_NAMES.get(roles[0], settings.AUTH_DEV_USER)
        return AuthUser(
            id=settings.AUTH_DEV_USER,
            name=name,
            email=f"{settings.AUTH_DEV_USER}@dev.local",
            roles=roles,
            domain_codes=domain_codes,
            permissions=build_permission_list(roles),
        )


class KeycloakAuthProvider(AuthProvider):
    """Decode Keycloak JWT and extract user identity."""

    _jwks_cache: dict[str, Any] = {}
    _jwks_cache_ts: float = 0
    _JWKS_TTL: int = 3600

    async def authenticate(self, request: Request) -> AuthUser | None:
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return None

        token = auth_header.removeprefix("Bearer ").strip()
        if not token:
            return None

        try:
            jwks = await self._fetch_jwks()
            payload = self._decode_token(token, jwks)
        except Exception as exc:
            raise ValueError(f"Invalid token: {exc}") from exc

        username = payload.get("preferred_username", "")
        email = payload.get("email", "")
        name = payload.get("name", username)

        # DB-assigned roles take priority over Keycloak JWT roles
        db_roles, domain_codes = await resolve_roles_from_db(username)
        if db_roles:
            roles = db_roles
        else:
            roles = [self._resolve_role(payload)]
            domain_codes = []

        return AuthUser(
            id=username,
            name=name,
            email=email,
            roles=roles,
            domain_codes=domain_codes,
            permissions=build_permission_list(roles),
        )

    async def _fetch_jwks(self) -> dict[str, Any]:
        now = time.monotonic()
        if self._jwks_cache and (now - self._jwks_cache_ts) < self._JWKS_TTL:
            return self._jwks_cache

        jwks_url = (
            f"{settings.KEYCLOAK_SERVER_URL.rstrip('/')}"
            f"/realms/{settings.KEYCLOAK_REALM}"
            f"/protocol/openid-connect/certs"
        )
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(jwks_url)
            resp.raise_for_status()
            jwks = resp.json()

        KeycloakAuthProvider._jwks_cache = jwks
        KeycloakAuthProvider._jwks_cache_ts = now
        return jwks

    def _decode_token(self, token: str, jwks: dict[str, Any]) -> dict:
        from jose import jwt as jose_jwt

        unverified_header = jose_jwt.get_unverified_header(token)
        kid = unverified_header.get("kid")

        rsa_key: dict = {}
        for key_data in jwks.get("keys", []):
            if key_data.get("kid") == kid:
                rsa_key = key_data
                break

        if not rsa_key:
            raise ValueError(f"No matching JWKS key found for kid={kid}")

        return jose_jwt.decode(
            token,
            rsa_key,
            algorithms=[settings.KEYCLOAK_ALGORITHMS],
            options={"verify_aud": False, "verify_exp": True},
        )

    def _resolve_role(self, payload: dict) -> Role:
        """Map Keycloak resource_access roles to EGM Role enum."""
        resource_access: dict = payload.get("resource_access", {})

        client_id = settings.KEYCLOAK_CLIENT_ID
        client_roles: list[str] = []
        if client_id and client_id in resource_access:
            client_roles = resource_access[client_id].get("roles", [])

        realm_roles: list[str] = payload.get("realm_access", {}).get("roles", [])
        all_roles = [r.upper() for r in client_roles + realm_roles]

        if "_SYS_ADMIN" in all_roles or "ADMIN" in all_roles or "SUPER_ADMIN" in all_roles:
            return Role.ADMIN
        if "GOVERNANCE_LEAD" in all_roles:
            return Role.GOVERNANCE_LEAD
        if "DOMAIN_REVIEWER" in all_roles:
            return Role.DOMAIN_REVIEWER
        if "REQUESTOR" in all_roles:
            return Role.REQUESTOR
        return Role.VIEWER


def get_auth_provider() -> AuthProvider:
    if settings.AUTH_DISABLED:
        return DevAuthProvider()
    return KeycloakAuthProvider()
