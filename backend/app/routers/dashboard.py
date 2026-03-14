"""Dashboard router — governance metrics & KPIs."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.database import get_db
from app.auth import require_permission

router = APIRouter()


@router.get("/stats", dependencies=[Depends(require_permission("dashboard", "read"))])
async def dashboard_stats(db: AsyncSession = Depends(get_db)):
    total = (await db.execute(text("SELECT COUNT(*) FROM governance_request"))).scalar() or 0
    by_status = (await db.execute(text(
        "SELECT status, COUNT(*) as cnt FROM governance_request GROUP BY status ORDER BY status"
    ))).mappings().all()
    review_counts = (await db.execute(text(
        "SELECT domain_code, status, COUNT(*) as cnt FROM domain_review GROUP BY domain_code, status"
    ))).mappings().all()

    return {
        "totalRequests": total,
        "byStatus": [{"status": r["status"], "count": r["cnt"]} for r in by_status],
        "reviewCounts": [{"domainCode": r["domain_code"], "status": r["status"], "count": r["cnt"]} for r in review_counts],
    }


@router.get("/home-stats", dependencies=[Depends(require_permission("dashboard", "read"))])
async def home_stats(db: AsyncSession = Depends(get_db)):
    total = (await db.execute(text("SELECT COUNT(*) FROM governance_request"))).scalar() or 0
    in_review = (await db.execute(text(
        "SELECT COUNT(*) FROM governance_request WHERE status = 'In Progress'"
    ))).scalar() or 0
    completed = (await db.execute(text(
        "SELECT COUNT(*) FROM governance_request WHERE status = 'Completed'"
    ))).scalar() or 0
    open_isrs = (await db.execute(text(
        "SELECT COUNT(*) FROM info_supplement_request WHERE status IN ('Open', 'Acknowledged')"
    ))).scalar() or 0

    return {
        "totalRequests": total,
        "inReview": in_review,
        "completed": completed,
        "openInfoRequests": open_isrs,
    }
