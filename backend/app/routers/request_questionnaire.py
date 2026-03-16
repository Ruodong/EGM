"""Request Questionnaire router — pre-submit domain questionnaire responses."""
from __future__ import annotations

import json
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.database import get_db
from app.auth import require_permission, get_current_user, AuthUser

router = APIRouter()


async def _resolve_request_uuid(db: AsyncSession, request_id: str):
    """Resolve request_id (business ID or UUID) to internal UUID."""
    row = (await db.execute(text(
        "SELECT id FROM governance_request WHERE request_id = :id OR id::text = :id"
    ), {"id": request_id})).scalars().first()
    if not row:
        raise HTTPException(status_code=404, detail="Request not found")
    return row


def _map_response(r: dict) -> dict:
    return {
        "id": str(r["id"]),
        "requestId": str(r["request_id"]),
        "templateId": str(r["template_id"]),
        "domainCode": r["domain_code"],
        "answer": r["answer"],
    }


@router.get("/templates/{request_id}", dependencies=[Depends(require_permission("governance_request", "read"))])
async def get_templates_for_request(
    request_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Get active questionnaire templates for internal triggered domains of a request."""
    rid = await _resolve_request_uuid(db, request_id)

    # Find internal domains triggered by this request's rules
    domain_rows = (await db.execute(text("""
        SELECT DISTINCT dr.domain_code, dr.domain_name
        FROM governance_request_rule grr
        JOIN dispatch_rule cr ON cr.rule_code = grr.rule_code AND cr.is_active = true
        JOIN dispatch_rule_domain crd ON crd.rule_id = cr.id AND crd.relationship = 'in'
        JOIN domain_registry dr ON dr.domain_code = crd.domain_code
            AND dr.is_active = true AND dr.integration_type = 'internal'
        WHERE grr.request_id = :rid
        ORDER BY dr.domain_name
    """), {"rid": rid})).mappings().all()

    if not domain_rows:
        return {"data": []}

    codes = [d["domain_code"] for d in domain_rows]

    # Get active templates for those domains
    tmpl_rows = (await db.execute(text("""
        SELECT * FROM domain_questionnaire_template
        WHERE domain_code = ANY(:codes) AND is_active = true
        ORDER BY domain_code, sort_order, question_no
    """), {"codes": codes})).mappings().all()

    # Get default description box title from system_config
    default_title_row = (await db.execute(text(
        "SELECT value FROM system_config WHERE key = 'questionnaire.descriptionBoxDefaultTitle'"
    ))).scalars().first()
    default_desc_title = default_title_row or "Justify your answer below"

    # Group by domain
    by_domain: dict[str, list[dict]] = {c: [] for c in codes}
    for r in tmpl_rows:
        by_domain.setdefault(r["domain_code"], []).append({
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
        })

    domain_map = {d["domain_code"]: d["domain_name"] for d in domain_rows}
    data = [
        {
            "domainCode": code,
            "domainName": domain_map.get(code, code),
            "questions": by_domain.get(code, []),
        }
        for code in codes
        if by_domain.get(code)  # Only include domains that have questions
    ]
    return {"data": data}


@router.get("/{request_id}", dependencies=[Depends(require_permission("governance_request", "read"))])
async def get_responses(
    request_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Get saved questionnaire responses for a request."""
    rid = await _resolve_request_uuid(db, request_id)

    rows = (await db.execute(text(
        "SELECT * FROM request_questionnaire_response WHERE request_id = :rid ORDER BY domain_code"
    ), {"rid": rid})).mappings().all()

    return {"data": [_map_response(dict(r)) for r in rows]}


@router.post("/{request_id}", dependencies=[Depends(require_permission("governance_request", "write"))])
async def save_responses(
    request_id: str,
    body: dict,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Batch upsert questionnaire responses for a request."""
    rid = await _resolve_request_uuid(db, request_id)
    responses = body.get("responses", [])
    if not responses:
        raise HTTPException(status_code=400, detail="responses array is required")

    # Determine if we should track changes (post-submit statuses)
    gr_row = (await db.execute(text(
        "SELECT status FROM governance_request WHERE id = :rid"
    ), {"rid": rid})).mappings().first()
    track_changes = gr_row and gr_row["status"] in (
        "Submitted", "In Progress"
    )

    # Pre-fetch existing answers for change tracking
    old_answers: dict[str, dict] = {}
    if track_changes:
        existing = (await db.execute(text(
            "SELECT template_id, domain_code, answer FROM request_questionnaire_response "
            "WHERE request_id = :rid"
        ), {"rid": rid})).mappings().all()
        for row in existing:
            old_answers[str(row["template_id"])] = {
                "domain_code": row["domain_code"],
                "answer": row["answer"],
            }

    # Build a template_id → question_text lookup for meaningful field names
    tmpl_lookup: dict[str, str] = {}
    if track_changes:
        tmpl_ids = [resp.get("templateId") for resp in responses if resp.get("templateId")]
        if tmpl_ids:
            tmpl_rows = (await db.execute(text(
                "SELECT id, question_text FROM domain_questionnaire_template "
                "WHERE id = ANY(:ids)"
            ), {"ids": tmpl_ids})).mappings().all()
            tmpl_lookup = {str(r["id"]): r["question_text"] for r in tmpl_rows}

    results = []
    for resp in responses:
        tid = resp.get("templateId")
        domain_code = resp.get("domainCode")
        answer = resp.get("answer")
        if not tid or not domain_code:
            continue

        # Track changes before upsert
        if track_changes:
            old = old_answers.get(tid)
            old_val = old["answer"] if old else None
            new_val = answer
            # Compare as JSON strings for stable comparison
            old_json = json.dumps(old_val, sort_keys=True) if old_val is not None else "null"
            new_json = json.dumps(new_val, sort_keys=True) if new_val is not None else "null"
            if old_json != new_json:
                q_text = tmpl_lookup.get(tid, tid)
                field_name = f"questionnaire:{domain_code}:{q_text}"
                await db.execute(text("""
                    INSERT INTO governance_request_change_log
                        (request_id, field_name, old_value, new_value, changed_by)
                    VALUES (:rid, :field, CAST(:old AS jsonb), CAST(:new AS jsonb), :user)
                """), {
                    "rid": str(rid), "field": field_name,
                    "old": json.dumps(old_val), "new": json.dumps(new_val),
                    "user": user.id,
                })

        row = (await db.execute(text("""
            INSERT INTO request_questionnaire_response (request_id, template_id, domain_code, answer)
            VALUES (:rid, :tid, :domain_code, CAST(:answer AS jsonb))
            ON CONFLICT (request_id, template_id) DO UPDATE
            SET answer = CAST(:answer AS jsonb), update_at = NOW()
            RETURNING *
        """), {
            "rid": rid,
            "tid": tid,
            "domain_code": domain_code,
            "answer": json.dumps(answer) if answer is not None else None,
        })).mappings().first()
        if row:
            results.append(_map_response(dict(row)))

    await db.commit()
    return {"data": results}
