"""Dispatch Rules router — admin CRUD for dispatch rules."""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.database import get_db
from app.auth import require_permission, require_role, Role

router = APIRouter()


def _map(r: dict) -> dict:
    return {
        "id": str(r["id"]),
        "ruleName": r["rule_name"],
        "domainCode": r["domain_code"],
        "conditionType": r["condition_type"],
        "conditionField": r.get("condition_field"),
        "conditionOperator": r.get("condition_operator"),
        "conditionValue": r.get("condition_value"),
        "priority": r.get("priority", 0),
        "isActive": r.get("is_active", True),
    }


@router.get("", dependencies=[Depends(require_permission("dispatch_rule", "read"))])
async def list_rules(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(text(
        "SELECT * FROM dispatch_rule ORDER BY priority DESC, rule_name"
    ))).mappings().all()
    return {"data": [_map(dict(r)) for r in rows]}


@router.post("", dependencies=[Depends(require_role(Role.ADMIN))])
async def create_rule(body: dict, db: AsyncSession = Depends(get_db)):
    row = (await db.execute(text("""
        INSERT INTO dispatch_rule (rule_name, domain_code, condition_type,
            condition_field, condition_operator, condition_value, priority)
        VALUES (:rule_name, :domain_code, :condition_type,
            :condition_field, :condition_operator, CAST(:condition_value AS jsonb), :priority)
        RETURNING *
    """), {
        "rule_name": body["ruleName"],
        "domain_code": body["domainCode"],
        "condition_type": body.get("conditionType", "scoping_answer"),
        "condition_field": body.get("conditionField"),
        "condition_operator": body.get("conditionOperator", "equals"),
        "condition_value": json.dumps(body["conditionValue"]) if body.get("conditionValue") else None,
        "priority": body.get("priority", 0),
    })).mappings().first()
    await db.commit()
    return _map(dict(row))


@router.put("/{rule_id}", dependencies=[Depends(require_role(Role.ADMIN))])
async def update_rule(rule_id: str, body: dict, db: AsyncSession = Depends(get_db)):
    sets, params = [], {"id": rule_id}
    for field, col in [
        ("ruleName", "rule_name"), ("domainCode", "domain_code"),
        ("conditionType", "condition_type"), ("conditionField", "condition_field"),
        ("conditionOperator", "condition_operator"), ("priority", "priority"),
        ("isActive", "is_active"),
    ]:
        if field in body:
            sets.append(f"{col} = :{col}")
            params[col] = body[field]
    if "conditionValue" in body:
        sets.append("condition_value = CAST(:condition_value AS jsonb)")
        params["condition_value"] = json.dumps(body["conditionValue"]) if body["conditionValue"] else None

    if not sets:
        raise HTTPException(status_code=400, detail="No fields to update")

    row = (await db.execute(text(
        f"UPDATE dispatch_rule SET {', '.join(sets)} WHERE id = :id RETURNING *"
    ), params)).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Rule not found")
    await db.commit()
    return _map(dict(row))


@router.delete("/{rule_id}", dependencies=[Depends(require_role(Role.ADMIN))])
async def delete_rule(rule_id: str, db: AsyncSession = Depends(get_db)):
    """Soft-delete: set is_active = false."""
    row = (await db.execute(text(
        "UPDATE dispatch_rule SET is_active = false WHERE id = :id RETURNING id"
    ), {"id": rule_id})).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Rule not found")
    await db.commit()
    return {"ok": True}
