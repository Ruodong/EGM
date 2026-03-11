"""Auth router — user info, permissions & token exchange API."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
import httpx

from app.auth.dependencies import get_current_user
from app.auth.models import AuthUser
from app.config import settings

router = APIRouter()


@router.get("/me")
async def auth_me(user: AuthUser = Depends(get_current_user)):
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "role": user.role.value,
        "permissions": user.permissions,
    }


@router.get("/permissions")
async def auth_permissions(user: AuthUser = Depends(get_current_user)):
    return {
        "role": user.role.value,
        "permissions": user.permissions,
    }


@router.post("/token")
async def exchange_token(body: dict):
    """Exchange an OIDC authorization code for an access token via Keycloak."""
    if settings.AUTH_DISABLED:
        raise HTTPException(status_code=400, detail="Auth is disabled in dev mode")

    code = body.get("code")
    redirect_uri = body.get("redirectUri")
    if not code or not redirect_uri:
        raise HTTPException(status_code=400, detail="code and redirectUri required")

    token_url = (
        f"{settings.KEYCLOAK_SERVER_URL.rstrip('/')}"
        f"/realms/{settings.KEYCLOAK_REALM}"
        f"/protocol/openid-connect/token"
    )

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(token_url, data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
            "client_id": settings.KEYCLOAK_CLIENT_ID,
            "client_secret": settings.KEYCLOAK_CLIENT_SECRET,
        })

    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Token exchange failed")

    data = resp.json()
    return {
        "accessToken": data["access_token"],
        "refreshToken": data.get("refresh_token"),
        "expiresIn": data.get("expires_in"),
    }
