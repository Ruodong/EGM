"""Domain Questionnaire router — reviewer-side questionnaire responses.

Uses the existing domain_questionnaire_response table for reviewer answers.
Templates are filtered to audience='reviewer' only.
"""
from __future__ import annotations

import json
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.database import get_db
from app.auth import require_permission, get_current_user, AuthUser

router = APIRouter()


def _map_response(r: dict) -> dict:
    return {
        "id": str(r["id"]),
        "domainReviewId": str(r["domain_review_id"]),
        "templateId": str(r["template_id"]),
        "answer": r["answer"],
    }


async def _get_review(db: AsyncSession, review_id: str) -> dict:
    """Look up a domain review, raise 404 if not found."""
    row = (await db.execute(text(
        "SELECT * FROM domain_review WHERE id = :id"
    ), {"id": review_id})).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Domain review not found")
    return dict(row)


@router.get("/templates/{domain_review_id}", dependencies=[Depends(require_permission("domain_review", "read"))])
async def get_reviewer_templates(
    domain_review_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Get active reviewer questionnaire templates for a domain review."""
    review = await _get_review(db, domain_review_id)
    domain_code = review["domain_code"]

    # Get default description box title from system_config
    default_title_row = (await db.execute(text(
        "SELECT value FROM system_config WHERE key = 'questionnaire.descriptionBoxDefaultTitle'"
    ))).scalars().first()
    default_desc_title = default_title_row or "Justify your answer below"

    rows = (await db.execute(text("""
        SELECT * FROM domain_questionnaire_template
        WHERE domain_code = :dc AND is_active = true AND audience = 'reviewer'
        ORDER BY sort_order, question_no
    """), {"dc": domain_code})).mappings().all()

    questions = []
    for r in rows:
        questions.append({
            "id": str(r["id"]),
            "section": r.get("section") or None,
            "questionNo": r["question_no"],
            "questionText": r["question_text"],
            "questionDescription": r.get("question_description"),
            "answerType": r.get("answer_type", "textarea"),
            "options": r.get("options"),
            "isRequired": r.get("is_required", False),
            "sortOrder": r.get("sort_order", 0),
            "dependency": r.get("dependency"),
            "hasDescriptionBox": r.get("has_description_box", False),
            "descriptionBoxTitle": r.get("description_box_title") or default_desc_title,
            "questionTextZh": r.get("question_text_zh"),
            "questionDescriptionZh": r.get("question_description_zh"),
            "optionsZh": r.get("options_zh"),
            "descriptionBoxTitleZh": r.get("description_box_title_zh"),
            "questionImages": r.get("question_images"),
        })

    return {"data": questions}


@router.get("/{domain_review_id}", dependencies=[Depends(require_permission("domain_review", "read"))])
async def get_responses(
    domain_review_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Get saved reviewer questionnaire responses for a domain review."""
    await _get_review(db, domain_review_id)

    rows = (await db.execute(text(
        "SELECT * FROM domain_questionnaire_response WHERE domain_review_id = :rid"
    ), {"rid": domain_review_id})).mappings().all()

    return {"data": [_map_response(dict(r)) for r in rows]}


@router.post("/{domain_review_id}", dependencies=[Depends(require_permission("domain_review", "write"))])
async def save_responses(
    domain_review_id: str,
    body: dict,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Batch upsert reviewer questionnaire responses for a domain review."""
    review = await _get_review(db, domain_review_id)

    # Only allow saving when review is in Accept status
    if review["status"] != "Accept":
        raise HTTPException(status_code=400, detail="Can only save reviewer answers when review is in Accept status")

    responses = body.get("responses", [])
    if not responses:
        raise HTTPException(status_code=400, detail="responses array is required")

    results = []
    for resp in responses:
        tid = resp.get("templateId")
        answer = resp.get("answer")
        if not tid:
            continue

        row = (await db.execute(text("""
            INSERT INTO domain_questionnaire_response (domain_review_id, template_id, answer, create_by, update_by)
            VALUES (:rid, :tid, CAST(:answer AS jsonb), :user, :user)
            ON CONFLICT (domain_review_id, template_id) DO UPDATE
            SET answer = CAST(:answer AS jsonb), update_by = :user, update_at = NOW()
            RETURNING *
        """), {
            "rid": domain_review_id,
            "tid": tid,
            "answer": json.dumps(answer) if answer is not None else None,
            "user": user.id,
        })).mappings().first()
        if row:
            results.append(_map_response(dict(row)))

    await db.commit()
    return {"data": results}
