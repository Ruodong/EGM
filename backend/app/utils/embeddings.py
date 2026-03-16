"""Embedding utilities for Ask EGM RAG."""

from __future__ import annotations

import hashlib
import json
import logging
from typing import Optional

from openai import OpenAI
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings

logger = logging.getLogger(__name__)


def _get_embedding_client() -> Optional[OpenAI]:
    """Return OpenAI client for embeddings, or None if not configured."""
    if not settings.EMBEDDING_BASE_URL or not settings.EMBEDDING_API_KEY:
        return None
    return OpenAI(
        base_url=settings.EMBEDDING_BASE_URL,
        api_key=settings.EMBEDDING_API_KEY,
    )


def generate_embedding(text_input: str) -> Optional[list[float]]:
    """Generate an embedding vector for the given text. Returns None if not configured."""
    client = _get_embedding_client()
    if not client:
        return None
    try:
        resp = client.embeddings.create(
            model=settings.EMBEDDING_MODEL,
            input=text_input,
            dimensions=settings.EMBEDDING_DIMENSIONS,
        )
        return resp.data[0].embedding
    except Exception as e:
        logger.error("Embedding generation failed: %s", e)
        return None


def content_hash(text_input: str) -> str:
    """SHA-256 hash of content for change detection."""
    return hashlib.sha256(text_input.encode()).hexdigest()[:32]


async def build_review_summary(db: AsyncSession, domain_review_id: str) -> Optional[str]:
    """Build a text summary of a domain review for embedding.

    Returns None if the review is not found.
    """
    # Get review + request info
    row = (await db.execute(text("""
        SELECT dr.domain_code, dr.status, dr.outcome,
               gr.request_id, gr.title, gr.project_name, gr.project_proj_type,
               gr.project_description, gr.product_software_type,
               gr.product_end_user, gr.user_region, gr.third_party_vendor,
               gr.business_unit, gr.description AS gov_description,
               dn.domain_name
        FROM domain_review dr
        JOIN governance_request gr ON dr.request_id = gr.id
        LEFT JOIN domain_registry dn ON dr.domain_code = dn.domain_code
        WHERE dr.id = :rid
    """), {"rid": domain_review_id})).mappings().first()

    if not row:
        return None

    r = dict(row)
    parts = []
    parts.append(f"Domain: {r.get('domain_name') or r['domain_code']}")
    parts.append(f"Status: {r['status']}")
    if r.get("outcome"):
        parts.append(f"Outcome: {r['outcome']}")
    parts.append(f"Request: {r.get('request_id')} - {r.get('title') or ''}")
    parts.append(f"Project: {r.get('project_name') or 'N/A'} ({r.get('project_proj_type') or 'N/A'})")
    if r.get("gov_description"):
        parts.append(f"Description: {r['gov_description']}")
    if r.get("product_software_type"):
        parts.append(f"Software: {r['product_software_type']}")
    if r.get("third_party_vendor"):
        parts.append(f"Vendor: {r['third_party_vendor']}")
    if r.get("business_unit"):
        parts.append(f"BU: {r['business_unit']}")
    if r.get("product_end_user"):
        eu = r["product_end_user"]
        parts.append(f"End Users: {', '.join(eu) if isinstance(eu, list) else eu}")
    if r.get("user_region"):
        ur = r["user_region"]
        parts.append(f"Regions: {', '.join(ur) if isinstance(ur, list) else ur}")

    # Questionnaire answers (compact)
    q_rows = (await db.execute(text("""
        SELECT t.question_text, rqr.answer
        FROM request_questionnaire_response rqr
        JOIN domain_questionnaire_template t ON rqr.template_id = t.id
        WHERE rqr.request_id = (SELECT request_id FROM domain_review WHERE id = :rid)
          AND rqr.domain_code = :dc
          AND t.is_active = TRUE
        ORDER BY t.sort_order, t.question_no
    """), {"rid": domain_review_id, "dc": r["domain_code"]})).mappings().all()

    if q_rows:
        parts.append("\nQuestionnaire:")
        for q in q_rows:
            answer = q.get("answer")
            if isinstance(answer, str):
                try:
                    answer = json.loads(answer)
                except (json.JSONDecodeError, TypeError):
                    pass
            if isinstance(answer, dict):
                val = answer.get("value", "")
                if isinstance(val, list):
                    val = ", ".join(val)
                answer_str = str(val or "N/A")
            else:
                answer_str = str(answer) if answer else "N/A"
            parts.append(f"Q: {q['question_text']} A: {answer_str}")

    return "\n".join(parts)


async def upsert_review_embedding(db: AsyncSession, domain_review_id: str) -> bool:
    """Generate and store embedding for a domain review.

    Returns True if embedding was created/updated, False otherwise.
    Skips if embedding config is not set or content hasn't changed.
    """
    if not _get_embedding_client():
        return False

    summary = await build_review_summary(db, domain_review_id)
    if not summary:
        return False

    c_hash = content_hash(summary)

    # Check if existing embedding has same content
    existing = (await db.execute(text("""
        SELECT content_hash FROM ask_egm_review_embedding
        WHERE domain_review_id = :rid
    """), {"rid": domain_review_id})).scalar()

    if existing == c_hash:
        return False  # No change

    # Get domain_code
    domain_code = (await db.execute(text(
        "SELECT domain_code FROM domain_review WHERE id = :rid"
    ), {"rid": domain_review_id})).scalar()

    if not domain_code:
        return False

    # Generate embedding
    vec = generate_embedding(summary)
    if not vec:
        return False

    vec_str = "[" + ",".join(str(v) for v in vec) + "]"

    # Upsert
    await db.execute(text("""
        INSERT INTO ask_egm_review_embedding
            (domain_review_id, domain_code, content_hash, content_summary, embedding)
        VALUES (:rid, :dc, :hash, :summary, CAST(:vec AS public.vector))
        ON CONFLICT (domain_review_id) DO UPDATE SET
            content_hash = EXCLUDED.content_hash,
            content_summary = EXCLUDED.content_summary,
            embedding = EXCLUDED.embedding,
            update_at = NOW()
    """), {
        "rid": domain_review_id,
        "dc": domain_code,
        "hash": c_hash,
        "summary": summary,
        "vec": vec_str,
    })
    await db.commit()
    return True


async def find_similar_reviews(
    db: AsyncSession,
    domain_review_id: str,
    domain_code: str,
    query_text: str,
    top_k: int = 5,
) -> list[dict]:
    """Find the most similar historical reviews in the same domain.

    Returns a list of dicts with keys: domain_review_id, content_summary, similarity.
    Returns empty list if embedding is not configured.
    """
    vec = generate_embedding(query_text)
    if not vec:
        return []

    vec_str = "[" + ",".join(str(v) for v in vec) + "]"

    rows = (await db.execute(text("""
        SELECT domain_review_id, content_summary,
               1 - (embedding <=> CAST(:vec AS public.vector)) AS similarity
        FROM ask_egm_review_embedding
        WHERE domain_code = :dc
          AND domain_review_id != :rid
        ORDER BY embedding <=> CAST(:vec AS public.vector)
        LIMIT :k
    """), {
        "vec": vec_str,
        "dc": domain_code,
        "rid": domain_review_id,
        "k": top_k,
    })).mappings().all()

    return [
        {
            "domain_review_id": str(r["domain_review_id"]),
            "content_summary": r["content_summary"],
            "similarity": round(float(r["similarity"]), 4),
        }
        for r in rows
    ]
