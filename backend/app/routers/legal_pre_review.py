"""Legal Pre-Review — PoC integrating claude-for-legal/commercial-legal.

POST /api/domain-reviews/{id}/legal-pre-review
  Runs the `/commercial-legal:review` skill bundle as a system prompt
  against the EGM domain review's context (request + questionnaire + actions)
  and returns a draft memo. NOT persisted — the human reviewer adopts pieces
  manually via the existing review-action flow.
"""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_permission, get_current_user, AuthUser
from app.config import settings
from app.database import get_db
from app.routers.ask_egm import _check_review_access
from app.services.ai_review_analysis import _build_analysis_context, _build_context_text
from app.services.legal_plugin import build_legal_system_prompt, get_loaded_skill_names

logger = logging.getLogger(__name__)

router = APIRouter()


class LegalPreReviewResponse(BaseModel):
    draft: str
    model: str
    skillsUsed: list[str]
    domainCode: str
    plugin: str = "claude-for-legal/commercial-legal"


@router.post(
    "/{domain_review_id}/legal-pre-review",
    response_model=LegalPreReviewResponse,
    dependencies=[Depends(require_permission("review_action", "read"))],
)
async def generate_legal_pre_review(
    domain_review_id: str,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> LegalPreReviewResponse:
    """Generate an AI legal pre-review draft for this domain review.

    Access: same as Ask EGM — reviewer for this domain, requestor, or
    admin/governance-lead.
    """
    review = await _check_review_access(db, user, domain_review_id)

    ctx = await _build_analysis_context(db, domain_review_id)
    if ctx is None:
        raise HTTPException(status_code=404, detail="Domain review context not found")

    try:
        system_prompt = build_legal_system_prompt()
    except FileNotFoundError as e:
        raise HTTPException(status_code=503, detail=str(e))

    user_content = (
        "Generate the legal pre-review memo for the following EGM domain review. "
        "Follow the /commercial-legal:review workflow in PROVISIONAL mode.\n\n"
        + _build_context_text(ctx)
    )

    if not settings.LLM_BASE_URL or not settings.LLM_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="LLM is not configured. Set LLM_BASE_URL and LLM_API_KEY.",
        )

    def _call_sync():
        # Use sync OpenAI client run in a thread, mirroring
        # ai_review_analysis._llm_json_call_sync's pattern.
        from openai import OpenAI
        sync_client = OpenAI(base_url=settings.LLM_BASE_URL, api_key=settings.LLM_API_KEY)
        resp = sync_client.chat.completions.create(
            model=settings.LLM_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content},
            ],
            temperature=0.3,
            max_tokens=4096,
        )
        return resp.choices[0].message.content or ""

    try:
        loop = asyncio.get_event_loop()
        draft = await loop.run_in_executor(None, _call_sync)
    except Exception as e:
        logger.exception("Legal pre-review LLM call failed")
        raise HTTPException(status_code=502, detail=f"LLM call failed: {e}")

    return LegalPreReviewResponse(
        draft=draft,
        model=settings.LLM_MODEL,
        skillsUsed=get_loaded_skill_names(),
        domainCode=review["domain_code"],
    )
