"""AI Review Analysis — automated 5-dimension domain review intelligence.

Endpoints:
  POST /{domain_review_id}/trigger — Trigger analysis (auto or manual)
  GET  /{domain_review_id}         — Get latest completed analysis
  GET  /{domain_review_id}/versions — List all versions
  GET  /{domain_review_id}/versions/{version} — Get specific version
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_permission, get_current_user, AuthUser, Role
from app.config import settings
from app.database import get_db

logger = logging.getLogger(__name__)


async def _check_review_access(
    db: AsyncSession, user: AuthUser, domain_review_id: str
) -> dict:
    """Verify user has access to this domain review's AI analysis.

    - Admin / Governance Lead: always allowed
    - Domain Reviewer: only if the review's domain_code is in user.domain_codes
    - Requestor: only if they own the governance request (read-only access)

    Returns the review lookup dict.  Raises 404 / 403 on failure.
    """
    row = (await db.execute(text("""
        SELECT dr.id, dr.domain_code, dr.request_id, gr.requestor
        FROM domain_review dr
        JOIN governance_request gr ON dr.request_id = gr.id
        WHERE dr.id = :rid
    """), {"rid": domain_review_id})).mappings().first()

    if not row:
        raise HTTPException(status_code=404, detail="Domain review not found")

    r = dict(row)

    if Role.ADMIN in user.roles:
        return r
    if Role.GOVERNANCE_LEAD in user.roles:
        return r
    if Role.DOMAIN_REVIEWER in user.roles and r["domain_code"] in (user.domain_codes or []):
        return r
    if Role.REQUESTOR in user.roles and r["requestor"] == user.id:
        return r

    raise HTTPException(
        status_code=403,
        detail="Access denied: you don't have permission for this domain review",
    )

router = APIRouter()


class TriggerRequest(BaseModel):
    triggerEvent: str = "manual"  # 'submit' | 'resubmit' | 'manual'
    dimensions: list[str] | None = None  # None = all 5


def _map(row: dict) -> dict:
    """Map DB row to camelCase API response."""
    return {
        "id": str(row["id"]),
        "domainReviewId": str(row["domain_review_id"]),
        "version": row["version"],
        "triggerEvent": row["trigger_event"],
        "triggerBy": row.get("trigger_by"),
        "status": row["status"],
        "contentHash": row.get("content_hash"),
        "changedDimensions": row.get("changed_dimensions"),
        "riskAssessment": row.get("risk_assessment"),
        "referenceCases": row.get("reference_cases"),
        "consistencyAnalysis": row.get("consistency_analysis"),
        "completenessAnalysis": row.get("completeness_analysis"),
        "accuracyAnalysis": row.get("accuracy_analysis"),
        "overallScore": row.get("overall_score"),
        "summary": row.get("summary"),
        "errorMessage": row.get("error_message"),
        "startedAt": row["started_at"].isoformat() if row.get("started_at") else None,
        "completedAt": row["completed_at"].isoformat() if row.get("completed_at") else None,
        "createAt": row["create_at"].isoformat() if row.get("create_at") else None,
    }


@router.post(
    "/{domain_review_id}/trigger",
    dependencies=[Depends(require_permission("domain_review", "read"))],
)
async def trigger_analysis(
    domain_review_id: str,
    body: TriggerRequest,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Trigger AI analysis for a domain review."""

    # Validate LLM is configured
    if not settings.LLM_BASE_URL or not settings.LLM_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="LLM is not configured. Set LLM_BASE_URL and LLM_API_KEY.",
        )

    # Object-level access check (also validates review exists)
    await _check_review_access(db, user, domain_review_id)

    # Run analysis in background task (returns immediately)
    import asyncio
    from app.services.ai_review_analysis import run_analysis
    from app.database import AsyncSessionLocal

    async def _bg_run():
        async with AsyncSessionLocal() as bg_db:
            try:
                await run_analysis(
                    db=bg_db,
                    domain_review_id=domain_review_id,
                    trigger_event=body.triggerEvent,
                    trigger_by=user.id,
                    dimensions=body.dimensions,
                )
            except Exception as e:
                logger.warning("Background analysis failed for %s: %s", domain_review_id, e)

    asyncio.create_task(_bg_run())

    return {
        "status": "running",
        "domainReviewId": domain_review_id,
        "triggerEvent": body.triggerEvent,
        "message": "Analysis started in background",
    }


@router.get(
    "/{domain_review_id}",
    dependencies=[Depends(require_permission("domain_review", "read"))],
)
async def get_latest_analysis(
    domain_review_id: str,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get the latest completed analysis for a domain review."""
    await _check_review_access(db, user, domain_review_id)
    row = (await db.execute(text("""
        SELECT * FROM ai_review_analysis
        WHERE domain_review_id = :rid AND status = 'completed'
        ORDER BY version DESC LIMIT 1
    """), {"rid": domain_review_id})).mappings().first()

    if not row:
        # Check if there's a running/pending one
        pending = (await db.execute(text("""
            SELECT * FROM ai_review_analysis
            WHERE domain_review_id = :rid AND status IN ('pending', 'running')
            ORDER BY version DESC LIMIT 1
        """), {"rid": domain_review_id})).mappings().first()
        if pending:
            return _map(dict(pending))
        return {"data": None, "message": "No analysis available"}

    return _map(dict(row))


@router.get(
    "/{domain_review_id}/versions",
    dependencies=[Depends(require_permission("domain_review", "read"))],
)
async def get_analysis_versions(
    domain_review_id: str,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all analysis versions for a domain review."""
    await _check_review_access(db, user, domain_review_id)
    rows = (await db.execute(text("""
        SELECT * FROM ai_review_analysis
        WHERE domain_review_id = :rid
        ORDER BY version DESC
    """), {"rid": domain_review_id})).mappings().all()

    return {"data": [_map(dict(r)) for r in rows]}


@router.get(
    "/{domain_review_id}/versions/{version}",
    dependencies=[Depends(require_permission("domain_review", "read"))],
)
async def get_analysis_version(
    domain_review_id: str,
    version: int,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get a specific version of the analysis."""
    await _check_review_access(db, user, domain_review_id)
    row = (await db.execute(text("""
        SELECT * FROM ai_review_analysis
        WHERE domain_review_id = :rid AND version = :ver
    """), {"rid": domain_review_id, "ver": version})).mappings().first()

    if not row:
        raise HTTPException(status_code=404, detail="Analysis version not found")

    return _map(dict(row))
