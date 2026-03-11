"""Audit Log router — read-only viewer for system audit entries."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.database import get_db
from app.utils.pagination import PaginationParams, paginated_response
from app.auth import require_permission

router = APIRouter()


def _map(r: dict) -> dict:
    return {
        "id": str(r["id"]),
        "entityType": r["entity_type"],
        "entityId": str(r["entity_id"]) if r.get("entity_id") else None,
        "action": r["action"],
        "oldValue": r.get("old_value"),
        "newValue": r.get("new_value"),
        "performedBy": r.get("performed_by"),
        "performedAt": r["performed_at"].isoformat() if r.get("performed_at") else None,
    }


@router.get("", dependencies=[Depends(require_permission("audit_log", "read"))])
async def list_audit_entries(
    entity_type: str | None = Query(None),
    action: str | None = Query(None),
    performed_by: str | None = Query(None),
    pg: PaginationParams = Depends(),
    db: AsyncSession = Depends(get_db),
):
    conditions, params = [], {}
    if entity_type:
        params["et"] = entity_type
        conditions.append("entity_type = :et")
    if action:
        params["act"] = action
        conditions.append("action = :act")
    if performed_by:
        params["pb"] = performed_by
        conditions.append("performed_by = :pb")

    where = (" WHERE " + " AND ".join(conditions)) if conditions else ""

    total = (await db.execute(text(f"SELECT COUNT(*) FROM audit_log{where}"), params)).scalar() or 0

    params["limit"] = pg.page_size
    params["offset"] = pg.offset
    rows = (await db.execute(text(
        f"SELECT * FROM audit_log{where} ORDER BY performed_at DESC LIMIT :limit OFFSET :offset"
    ), params)).mappings().all()

    return paginated_response([_map(dict(r)) for r in rows], total, pg.page, pg.page_size)
