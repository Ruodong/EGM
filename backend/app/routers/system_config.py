"""System Configuration router — key-value application settings."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.database import get_db
from app.auth import require_role, Role

router = APIRouter()


@router.get("/{key}")
async def get_config(key: str, db: AsyncSession = Depends(get_db)):
    """Read a configuration value (public, no auth required)."""
    row = (await db.execute(
        text("SELECT value FROM system_config WHERE key = :key"),
        {"key": key},
    )).scalars().first()
    if row is None:
        raise HTTPException(status_code=404, detail="Config key not found")
    return {"key": key, "value": row}


@router.get("")
async def list_config(db: AsyncSession = Depends(get_db)):
    """List all configuration key-value pairs (public)."""
    rows = (await db.execute(
        text("SELECT key, value FROM system_config ORDER BY key")
    )).mappings().all()
    return {"data": [{"key": r["key"], "value": r["value"]} for r in rows]}


@router.put("/{key}", dependencies=[Depends(require_role(Role.ADMIN))])
async def update_config(
    key: str,
    body: dict,
    db: AsyncSession = Depends(get_db),
):
    """Update a configuration value (admin only)."""
    value = body.get("value")
    if value is None:
        raise HTTPException(status_code=400, detail="value is required")

    row = (await db.execute(
        text("UPDATE system_config SET value = :value WHERE key = :key RETURNING key, value"),
        {"key": key, "value": str(value)},
    )).mappings().first()
    if not row:
        # Insert if not exists
        row = (await db.execute(
            text("INSERT INTO system_config (key, value) VALUES (:key, :value) RETURNING key, value"),
            {"key": key, "value": str(value)},
        )).mappings().first()
    await db.commit()
    return {"key": row["key"], "value": row["value"]}
