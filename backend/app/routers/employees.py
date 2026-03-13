"""Employees router — search employee_info for autocomplete."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.database import get_db
from app.auth import require_permission

router = APIRouter()


@router.get("/search", dependencies=[Depends(require_permission("governance_request", "read"))])
async def search_employees(
    q: str = Query(..., min_length=1),
    db: AsyncSession = Depends(get_db),
):
    """Search employees by itcode or name for autocomplete."""
    rows = (await db.execute(text("""
        SELECT itcode, name, email FROM employee_info
        WHERE itcode ILIKE :q OR name ILIKE :q
        ORDER BY name LIMIT 10
    """), {"q": f"%{q}%"})).mappings().all()
    return {"data": [dict(r) for r in rows]}
