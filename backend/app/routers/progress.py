"""Progress router — aggregated review status per governance request."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.database import get_db
from app.auth import require_permission

router = APIRouter()


@router.get("/{request_id}", dependencies=[Depends(require_permission("progress", "read"))])
async def get_progress(request_id: str, db: AsyncSession = Depends(get_db)):
    # Resolve governance request
    gr = (await db.execute(text(
        "SELECT * FROM governance_request WHERE request_id = :id OR id::text = :id"
    ), {"id": request_id})).mappings().first()
    if not gr:
        raise HTTPException(status_code=404, detail="Governance request not found")

    # Get all domain reviews
    reviews = (await db.execute(text(
        "SELECT * FROM domain_review WHERE request_id = :rid ORDER BY domain_code"
    ), {"rid": str(gr["id"])})).mappings().all()

    total = len(reviews)
    completed = sum(1 for r in reviews if r["status"] in ("Approved", "Approved with Exception", "Not Passed"))
    in_progress = sum(1 for r in reviews if r["status"] == "Accept")
    pending = sum(1 for r in reviews if r["status"] in ("Waiting for Accept", "Return for Additional Information"))

    return {
        "requestId": gr["request_id"],
        "status": gr["status"],
        "totalDomains": total,
        "completedDomains": completed,
        "inProgressDomains": in_progress,
        "pendingDomains": pending,
        "progressPercent": round(completed / total * 100) if total > 0 else 0,
        "domains": [{
            "reviewId": str(r["id"]),
            "domainCode": r["domain_code"],
            "status": r["status"],
            "reviewer": r.get("reviewer_name") or r.get("reviewer"),
        } for r in reviews],
    }
