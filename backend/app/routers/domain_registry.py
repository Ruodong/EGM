"""Domain Registry router — manage governance domain definitions."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.database import get_db
from app.auth import require_permission, require_role, Role, get_current_user, AuthUser

router = APIRouter()


def _map(r: dict) -> dict:
    return {
        "id": str(r["id"]),
        "domainCode": r["domain_code"],
        "domainName": r["domain_name"],
        "description": r.get("description"),
        "integrationType": r["integration_type"],
        "externalBaseUrl": r.get("external_base_url"),
        "icon": r.get("icon"),
        "sortOrder": r.get("sort_order", 0),
        "isActive": r.get("is_active", True),
        "config": r.get("config"),
    }


@router.get("", dependencies=[Depends(require_permission("domain_registry", "read"))])
async def list_domains(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(text(
        "SELECT * FROM domain_registry WHERE is_active = true ORDER BY sort_order, domain_name"
    ))).mappings().all()
    return {"data": [_map(dict(r)) for r in rows]}


@router.get("/{code}", dependencies=[Depends(require_permission("domain_registry", "read"))])
async def get_domain(code: str, db: AsyncSession = Depends(get_db)):
    row = (await db.execute(text(
        "SELECT * FROM domain_registry WHERE domain_code = :code"
    ), {"code": code})).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Domain not found")
    return _map(dict(row))


@router.post("", dependencies=[Depends(require_role(Role.ADMIN))])
async def create_domain(body: dict, user: AuthUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    row = (await db.execute(text("""
        INSERT INTO domain_registry (domain_code, domain_name, description, integration_type,
            external_base_url, icon, sort_order, config)
        VALUES (:code, :name, :desc, :type, :url, :icon, :sort, CAST(:config AS jsonb))
        RETURNING *
    """), {
        "code": body["domainCode"],
        "name": body["domainName"],
        "desc": body.get("description"),
        "type": body.get("integrationType", "internal"),
        "url": body.get("externalBaseUrl"),
        "icon": body.get("icon"),
        "sort": body.get("sortOrder", 0),
        "config": str(body.get("config", "{}")) if body.get("config") else "{}",
    })).mappings().first()
    await db.commit()
    return _map(dict(row))


@router.put("/{code}", dependencies=[Depends(require_role(Role.ADMIN))])
async def update_domain(code: str, body: dict, db: AsyncSession = Depends(get_db)):
    sets, params = [], {"code": code}
    for field, col in [
        ("domainName", "domain_name"), ("description", "description"),
        ("integrationType", "integration_type"), ("externalBaseUrl", "external_base_url"),
        ("icon", "icon"), ("sortOrder", "sort_order"), ("isActive", "is_active"),
    ]:
        if field in body:
            sets.append(f"{col} = :{col}")
            params[col] = body[field]
    if not sets:
        raise HTTPException(status_code=400, detail="No fields to update")

    row = (await db.execute(text(
        f"UPDATE domain_registry SET {', '.join(sets)} WHERE domain_code = :code RETURNING *"
    ), params)).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Not found")
    await db.commit()
    return _map(dict(row))
