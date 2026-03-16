"""Ask EGM — AI-assisted review analysis (OpenAI-compatible LLM + RAG)."""

from __future__ import annotations

import json
import os
import logging
from typing import AsyncGenerator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_permission, get_current_user, AuthUser
from app.config import settings
from app.database import get_db
from app.utils.embeddings import find_similar_reviews, upsert_review_embedding

logger = logging.getLogger(__name__)

router = APIRouter()

# ── LLM configuration (read from pydantic Settings which loads .env) ────────


def _get_openai_client():
    """Lazy-init OpenAI-compatible client."""
    from openai import OpenAI
    if not settings.LLM_BASE_URL or not settings.LLM_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="LLM is not configured. Set LLM_BASE_URL and LLM_API_KEY environment variables.",
        )
    return OpenAI(
        base_url=settings.LLM_BASE_URL,
        api_key=settings.LLM_API_KEY,
    )


# ── Helpers ──────────────────────────────────────────────────────────────────

async def _build_system_prompt(db: AsyncSession, domain_review_id: str) -> str:
    """Collect all context for the domain review and build a system prompt."""

    # 1. Get domain review + request info
    review_row = (await db.execute(text("""
        SELECT dr.id, dr.domain_code, dr.status, dr.outcome, dr.reviewer, dr.reviewer_name,
               gr.id AS request_uuid, gr.request_id, gr.title AS gov_title,
               gr.project_name, gr.project_code, gr.project_proj_type,
               gr.project_description, gr.project_pm, gr.project_pm_itcode,
               gr.project_dt_lead, gr.project_it_lead,
               gr.project_start_date, gr.project_go_live_date,
               gr.product_software_type, gr.product_end_user, gr.user_region,
               gr.third_party_vendor,
               gr.requestor, gr.requestor_name, gr.business_unit,
               gr.gov_project_type, gr.description AS gov_description,
               dn.domain_name AS domain_name
        FROM domain_review dr
        JOIN governance_request gr ON dr.request_id = gr.id
        LEFT JOIN domain_registry dn ON dr.domain_code = dn.domain_code
        WHERE dr.id = :rid
    """), {"rid": domain_review_id})).mappings().first()

    if not review_row:
        raise HTTPException(status_code=404, detail="Domain review not found")

    r = dict(review_row)
    request_uuid = str(r["request_uuid"])
    domain_code = r["domain_code"]

    # 2. Questionnaire responses (requestor answers for this domain)
    q_rows = (await db.execute(text("""
        SELECT t.section, t.question_no, t.question_text, t.answer_type,
               rqr.answer
        FROM request_questionnaire_response rqr
        JOIN domain_questionnaire_template t ON rqr.template_id = t.id
        WHERE rqr.request_id = :req_id
          AND rqr.domain_code = :dc
          AND t.is_active = TRUE
        ORDER BY t.sort_order, t.question_no
    """), {"req_id": request_uuid, "dc": domain_code})).mappings().all()

    # 3. Action items + feedback
    action_rows = (await db.execute(text("""
        SELECT a.action_no, a.title, a.description, a.priority, a.action_type,
               a.status, a.assignee_name, a.id AS action_id
        FROM review_action a
        WHERE a.domain_review_id = :rid
        ORDER BY a.action_no
    """), {"rid": domain_review_id})).mappings().all()

    feedback_by_action: dict[str, list[dict]] = {}
    if action_rows:
        action_ids = [str(a["action_id"]) for a in action_rows]
        fb_rows = (await db.execute(text("""
            SELECT action_id, round_no, feedback_type, content, created_by_name
            FROM review_action_feedback
            WHERE action_id = ANY(:ids)
            ORDER BY create_at
        """), {"ids": action_ids})).mappings().all()
        for fb in fb_rows:
            aid = str(fb["action_id"])
            feedback_by_action.setdefault(aid, []).append(dict(fb))

    # ── Build prompt ────────────────────────────────────────────────────

    parts: list[str] = []
    parts.append(
        'You are "Ask EGM", an AI assistant helping governance reviewers analyze compliance review requests.\n'
        "You MUST ONLY answer questions directly related to the current domain review context provided below.\n"
        "If the user asks about topics unrelated to this governance review, politely decline and suggest they ask about this review instead.\n"
        "Provide thorough, professional analysis. Answer in the same language as the user's question.\n"
    )

    # Project / Request info
    parts.append("## Current Review Context")
    parts.append(f"- **Domain**: {r.get('domain_name') or domain_code}")
    parts.append(f"- **Review Status**: {r.get('status')}")
    if r.get("outcome"):
        parts.append(f"- **Outcome**: {r['outcome']}")
    parts.append(f"- **Reviewer**: {r.get('reviewer_name') or r.get('reviewer') or 'N/A'}")
    parts.append("")

    parts.append("## Project Information")
    parts.append(f"- **Request ID**: {r.get('request_id')}")
    parts.append(f"- **Title**: {r.get('gov_title') or 'N/A'}")
    parts.append(f"- **Description**: {r.get('gov_description') or 'N/A'}")
    parts.append(f"- **Project Name**: {r.get('project_name') or 'N/A'}")
    parts.append(f"- **Project Type**: {r.get('project_proj_type') or r.get('gov_project_type') or 'N/A'}")
    parts.append(f"- **Business Unit**: {r.get('business_unit') or 'N/A'}")
    parts.append(f"- **Requestor**: {r.get('requestor_name') or r.get('requestor')}")
    parts.append(f"- **Project Manager**: {r.get('project_pm') or 'N/A'}")
    if r.get("product_software_type"):
        parts.append(f"- **Software Type**: {r['product_software_type']}")
    if r.get("third_party_vendor"):
        parts.append(f"- **Third Party Vendor**: {r['third_party_vendor']}")
    if r.get("product_end_user"):
        parts.append(f"- **End Users**: {', '.join(r['product_end_user']) if isinstance(r['product_end_user'], list) else r['product_end_user']}")
    if r.get("user_region"):
        parts.append(f"- **Regions**: {', '.join(r['user_region']) if isinstance(r['user_region'], list) else r['user_region']}")
    parts.append("")

    # Questionnaire
    if q_rows:
        parts.append("## Questionnaire Responses")
        current_section = None
        for q in q_rows:
            section = q.get("section") or "General"
            if section != current_section:
                parts.append(f"\n### {section}")
                current_section = section
            answer_data = q.get("answer")
            if isinstance(answer_data, str):
                try:
                    answer_data = json.loads(answer_data)
                except (json.JSONDecodeError, TypeError):
                    pass
            if isinstance(answer_data, dict):
                val = answer_data.get("value", "")
                if isinstance(val, list):
                    val = ", ".join(val)
                other = answer_data.get("otherText", "")
                desc = answer_data.get("descriptionText", "")
                answer_str = str(val or "(no answer)")
                if other:
                    answer_str += f" (Other: {other})"
                if desc:
                    answer_str += f" — {desc}"
            else:
                answer_str = str(answer_data) if answer_data else "(no answer)"
            parts.append(f"**Q{q['question_no']}. {q['question_text']}**")
            parts.append(f"A: {answer_str}")
        parts.append("")

    # Action items
    if action_rows:
        parts.append("## Action Items")
        for a in action_rows:
            aid = str(a["action_id"])
            parts.append(f"\n### Action #{a.get('action_no', '?')}: {a['title']} [{a['status']}]")
            parts.append(f"- Priority: {a['priority']}, Type: {a['action_type']}")
            if a.get("description"):
                parts.append(f"- Description: {a['description']}")
            if a.get("assignee_name"):
                parts.append(f"- Assignee: {a['assignee_name']}")
            fbs = feedback_by_action.get(aid, [])
            if fbs:
                parts.append("- Feedback:")
                for fb in fbs:
                    role_label = "Reviewer" if fb["feedback_type"] == "follow_up" else "Assignee"
                    parts.append(f"  - [{role_label}] {fb['content']}")
        parts.append("")

    # 4. Similar historical reviews (RAG)
    try:
        # Build a query from current review context for similarity search
        current_summary_parts = [
            r.get("domain_name") or domain_code,
            r.get("gov_title") or "",
            r.get("gov_description") or "",
            r.get("project_proj_type") or "",
            r.get("product_software_type") or "",
        ]
        query_text = " ".join(p for p in current_summary_parts if p)
        similar = await find_similar_reviews(
            db, domain_review_id, domain_code, query_text, top_k=5
        )
        if similar:
            parts.append("## Similar Historical Reviews in This Domain")
            parts.append("The following are past reviews in the same domain that may be relevant for reference:\n")
            for i, s in enumerate(similar, 1):
                parts.append(f"### Similar Case #{i} (similarity: {s['similarity']})")
                # Show compact summary (first 500 chars)
                summary_preview = s["content_summary"][:500]
                if len(s["content_summary"]) > 500:
                    summary_preview += "..."
                parts.append(summary_preview)
                parts.append("")
    except Exception as e:
        logger.warning("RAG similar review lookup failed (non-fatal): %s", e)

    return "\n".join(parts)


# ── Request / response models ───────────────────────────────────────────────

class ChatRequest(BaseModel):
    message: str


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get(
    "/{domain_review_id}/history",
    dependencies=[Depends(require_permission("review_action", "read"))],
)
async def get_history(
    domain_review_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Return conversation history for a domain review."""
    rows = (await db.execute(text("""
        SELECT id, role, content, create_by, create_at
        FROM ask_egm_conversation
        WHERE domain_review_id = :rid
        ORDER BY create_at
    """), {"rid": domain_review_id})).mappings().all()
    return {
        "data": [
            {
                "id": str(r["id"]),
                "role": r["role"],
                "content": r["content"],
                "createBy": r["create_by"],
                "createAt": r["create_at"].isoformat() if r["create_at"] else None,
            }
            for r in rows
        ]
    }


@router.delete(
    "/{domain_review_id}/history",
    dependencies=[Depends(require_permission("review_action", "read"))],
)
async def clear_history(
    domain_review_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Delete all conversation history for a domain review."""
    await db.execute(text("""
        DELETE FROM ask_egm_conversation WHERE domain_review_id = :rid
    """), {"rid": domain_review_id})
    await db.commit()
    return {"ok": True}


@router.post(
    "/{domain_review_id}/chat",
    dependencies=[Depends(require_permission("review_action", "read"))],
)
async def chat(
    domain_review_id: str,
    body: ChatRequest,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Send a message and receive a streaming AI response (SSE)."""

    user_message = body.message.strip()
    if not user_message:
        raise HTTPException(status_code=422, detail="Message cannot be empty")

    # 0. Validate LLM is configured (fail fast)
    client = _get_openai_client()

    # 1. Build system prompt with context
    system_prompt = await _build_system_prompt(db, domain_review_id)

    # 1b. Auto-update embedding for current review (non-blocking, best-effort)
    try:
        await upsert_review_embedding(db, domain_review_id)
    except Exception as e:
        logger.debug("Auto-embed skipped: %s", e)
        await db.rollback()

    # 2. Save user message
    await db.execute(text("""
        INSERT INTO ask_egm_conversation (domain_review_id, role, content, create_by)
        VALUES (:rid, 'user', :content, :uid)
    """), {"rid": domain_review_id, "content": user_message, "uid": user.id})
    await db.commit()

    # 3. Load conversation history (including the message we just saved)
    history_rows = (await db.execute(text("""
        SELECT role, content FROM ask_egm_conversation
        WHERE domain_review_id = :rid
        ORDER BY create_at
    """), {"rid": domain_review_id})).mappings().all()

    messages = [{"role": "system", "content": system_prompt}]
    for h in history_rows:
        messages.append({"role": h["role"], "content": h["content"]})

    # 4. Stream from LLM

    async def sse_generator() -> AsyncGenerator[str, None]:
        full_response = ""
        try:
            stream = client.chat.completions.create(
                model=settings.LLM_MODEL,
                messages=messages,
                stream=True,
                temperature=settings.LLM_TEMPERATURE,
                top_p=settings.LLM_TOP_P,
                max_tokens=4096,
            )
            for chunk in stream:
                if chunk.choices and chunk.choices[0].delta.content:
                    token = chunk.choices[0].delta.content
                    full_response += token
                    # SSE format
                    yield f"data: {json.dumps({'token': token})}\n\n"

            # Signal completion
            yield f"data: {json.dumps({'done': True})}\n\n"

        except Exception as e:
            logger.error("Ask EGM streaming error: %s", e, exc_info=True)
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
        finally:
            # Save assistant response to DB (use a new session to avoid issues)
            if full_response:
                try:
                    from app.database import AsyncSessionLocal
                    async with AsyncSessionLocal() as save_db:
                        await save_db.execute(text("""
                            INSERT INTO ask_egm_conversation (domain_review_id, role, content, create_by)
                            VALUES (:rid, 'assistant', :content, 'ask-egm')
                        """), {"rid": domain_review_id, "content": full_response})
                        await save_db.commit()
                except Exception as save_err:
                    logger.error("Failed to save assistant response: %s", save_err)

    return StreamingResponse(
        sse_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )

@router.post(
    "/{domain_review_id}/embedding",
    dependencies=[Depends(require_permission("review_action", "read"))],
)
async def sync_embedding(
    domain_review_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Generate/update the embedding for a domain review (for RAG)."""
    ok = await upsert_review_embedding(db, domain_review_id)
    return {"ok": ok, "message": "Embedding updated" if ok else "No change or embedding not configured"}


@router.post(
    "/embeddings/sync-all",
    dependencies=[Depends(require_permission("review_action", "read"))],
)
async def sync_all_embeddings(
    db: AsyncSession = Depends(get_db),
):
    """Sync embeddings for all domain reviews that have terminal status."""
    rows = (await db.execute(text("""
        SELECT id FROM domain_review
        WHERE status IN ('Approved', 'Approved with Exception', 'Not Passed', 'Complete')
    """))).scalars().all()

    created = 0
    skipped = 0
    for rid in rows:
        try:
            ok = await upsert_review_embedding(db, str(rid))
            if ok:
                created += 1
            else:
                skipped += 1
        except Exception as e:
            logger.warning("Failed to sync embedding for %s: %s", rid, e)
            skipped += 1

    return {"total": len(rows), "created": created, "skipped": skipped}
