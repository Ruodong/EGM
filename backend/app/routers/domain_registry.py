"""Domain Registry router — manage governance domain definitions."""
from __future__ import annotations

import json
from fastapi import APIRouter, Depends, HTTPException, Query
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
        "isActive": r.get("is_active", True),
        "config": r.get("config"),
    }


@router.get("", dependencies=[Depends(require_permission("domain_registry", "read"))])
async def list_domains(
    includeInactive: bool = Query(False, description="Include inactive domains"),
    db: AsyncSession = Depends(get_db),
):
    where = "" if includeInactive else "WHERE is_active = true"
    rows = (await db.execute(text(
        f"SELECT * FROM domain_registry {where} ORDER BY domain_name"
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
            external_base_url, icon, config)
        VALUES (:code, :name, :desc, :type, :url, :icon, CAST(:config AS jsonb))
        RETURNING *
    """), {
        "code": body["domainCode"],
        "name": body["domainName"],
        "desc": body.get("description"),
        "type": body.get("integrationType", "internal"),
        "url": body.get("externalBaseUrl"),
        "icon": body.get("icon"),
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
        ("icon", "icon"), ("isActive", "is_active"),
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


@router.delete("/{code}", dependencies=[Depends(require_role(Role.ADMIN))])
async def toggle_domain_active(
    code: str,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Toggle a domain's is_active status (active ↔ inactive)."""
    row = (await db.execute(text(
        "SELECT * FROM domain_registry WHERE domain_code = :code"
    ), {"code": code})).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Domain not found")

    old_active = row["is_active"]
    new_active = not old_active
    action = "activate" if new_active else "deactivate"

    await db.execute(text(
        "UPDATE domain_registry SET is_active = :active WHERE domain_code = :code"
    ), {"code": code, "active": new_active})
    await db.commit()

    # Audit log
    await db.execute(text("""
        INSERT INTO audit_log (entity_type, entity_id, action, old_value, new_value, performed_by)
        VALUES ('domain_registry', :id, :action, CAST(:old AS jsonb), CAST(:new AS jsonb), :user)
    """), {
        "id": row["id"],
        "action": action,
        "old": json.dumps({"domainCode": code, "isActive": old_active}),
        "new": json.dumps({"domainCode": code, "isActive": new_active}),
        "user": user.id,
    })
    await db.commit()

    return _map(dict((await db.execute(text(
        "SELECT * FROM domain_registry WHERE domain_code = :code"
    ), {"code": code})).mappings().first()))
