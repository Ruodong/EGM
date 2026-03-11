"""Projects router — read-only, synced from EAM."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.database import get_db
from app.auth import require_permission

router = APIRouter()


def _map(r: dict) -> dict:
    return {
        "id": r["id"],
        "projectId": r["project_id"],
        "projectName": r.get("project_name"),
        "type": r.get("type"),
        "status": r.get("status"),
        "pm": r.get("pm"),
        "pmItcode": r.get("pm_itcode"),
        "dtLead": r.get("dt_lead"),
        "dtLeadItcode": r.get("dt_lead_itcode"),
        "itLead": r.get("it_lead"),
        "itLeadItcode": r.get("it_lead_itcode"),
        "startDate": r.get("start_date"),
        "goLiveDate": r.get("go_live_date"),
        "endDate": r.get("end_date"),
        "aiRelated": r.get("ai_related"),
        "source": r.get("source"),
    }


@router.get("", dependencies=[Depends(require_permission("governance_request", "read"))])
async def list_projects(
    search: str | None = Query(None),
    pageSize: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    conditions: list[str] = []
    params: dict = {}

    if search:
        params["search"] = f"%{search}%"
        conditions.append("(project_id ILIKE :search OR project_name ILIKE :search)")

    where = (" WHERE " + " AND ".join(conditions)) if conditions else ""

    count = (await db.execute(text(f"SELECT COUNT(*) FROM project{where}"), params)).scalar() or 0

    params["limit"] = pageSize
    rows = (await db.execute(text(
        f"SELECT * FROM project{where} ORDER BY project_id DESC LIMIT :limit"
    ), params)).mappings().all()

    return {"data": [_map(dict(r)) for r in rows], "total": count}


@router.get("/{project_id}", dependencies=[Depends(require_permission("governance_request", "read"))])
async def get_project(project_id: str, db: AsyncSession = Depends(get_db)):
    row = (await db.execute(text(
        "SELECT * FROM project WHERE project_id = :pid"
    ), {"pid": project_id})).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Project not found")
    return _map(dict(row))
