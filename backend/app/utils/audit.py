"""Audit log writer utility."""
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text


async def write_audit(
    db: AsyncSession,
    entity_type: str,
    entity_id: str | None,
    action: str,
    performed_by: str,
    old_value: dict | None = None,
    new_value: dict | None = None,
) -> None:
    """Insert a row into the audit_log table."""
    import json
    await db.execute(text("""
        INSERT INTO audit_log (entity_type, entity_id, action, old_value, new_value, performed_by)
        VALUES (:et, :eid, :action, CAST(:old AS jsonb), CAST(:new AS jsonb), :by)
    """), {
        "et": entity_type,
        "eid": entity_id,
        "action": action,
        "old": json.dumps(old_value) if old_value else None,
        "new": json.dumps(new_value) if new_value else None,
        "by": performed_by,
    })
