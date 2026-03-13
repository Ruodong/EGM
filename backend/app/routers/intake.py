"""Governance Intake router — unified scoping + common questionnaire.

Combines Module B: scoping questions and common information collection
into a single intake flow backed by intake_template and intake_response tables.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.database import get_db
from app.auth import require_permission, require_role, Role, get_current_user, AuthUser

import json

router = APIRouter()


async def _resolve_request_uuid(db: AsyncSession, request_id: str) -> str:
    """Resolve a business ID (GR-xxxxxx) or UUID string to the governance_request UUID."""
    gr = (await db.execute(text(
        "SELECT id FROM governance_request WHERE request_id = :id OR id::text = :id"
    ), {"id": request_id})).scalar()
    if not gr:
        raise HTTPException(status_code=404, detail="Governance request not found")
    return str(gr)


# ---------------------------------------------------------------------------
# Templates
# ---------------------------------------------------------------------------

def _map_template(r: dict) -> dict:
    return {
        "id": str(r["id"]),
        "sectionType": r["section_type"],
        "section": r["section"],
        "questionNo": r["question_no"],
        "questionText": r["question_text"],
        "answerType": r["answer_type"],
        "options": r.get("options"),
        "isRequired": r.get("is_required", False),
        "helpText": r.get("help_text"),
        "triggersDomain": r.get("triggers_domain"),
        "sortOrder": r.get("sort_order", 0),
        "isActive": r.get("is_active", True),
    }


@router.get("/templates", dependencies=[Depends(require_permission("intake", "read"))])
async def list_templates(
    section_type: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    conditions = ["is_active = true"]
    params: dict = {}
    if section_type:
        conditions.append("section_type = :section_type")
        params["section_type"] = section_type

    where = " WHERE " + " AND ".join(conditions)
    rows = (await db.execute(
        text(f"SELECT * FROM intake_template{where} ORDER BY sort_order, question_no"),
        params,
    )).mappings().all()
    return {"data": [_map_template(dict(r)) for r in rows]}


# ---------------------------------------------------------------------------
# Responses
# ---------------------------------------------------------------------------

def _map_response(r: dict) -> dict:
    return {
        "id": str(r["id"]),
        "requestId": str(r["request_id"]),
        "templateId": str(r["template_id"]),
        "answer": r.get("answer"),
        "createBy": r.get("create_by"),
        "createAt": r["create_at"].isoformat() if r.get("create_at") else None,
        "updateAt": r["update_at"].isoformat() if r.get("update_at") else None,
    }


@router.get("/responses/{request_id}", dependencies=[Depends(require_permission("intake", "read"))])
async def get_responses(request_id: str, db: AsyncSession = Depends(get_db)):
    rid = await _resolve_request_uuid(db, request_id)
    rows = (await db.execute(text(
        "SELECT * FROM intake_response WHERE request_id = :rid ORDER BY create_at"
    ), {"rid": rid})).mappings().all()
    return {"data": [_map_response(dict(r)) for r in rows]}


@router.post("/responses", dependencies=[Depends(require_permission("intake", "write"))])
async def save_responses(body: dict, user: AuthUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Batch upsert intake responses for a governance request."""
    request_id = body.get("requestId")
    answers = body.get("answers", [])  # [{templateId, answer}, ...]

    if not request_id or not answers:
        raise HTTPException(status_code=400, detail="requestId and answers required")

    rid = await _resolve_request_uuid(db, request_id)

    change_reason = body.get("changeReason") or None  # optional ISR id (UUID) that triggered the change

    results = []
    for a in answers:
        tid = a["templateId"]
        new_answer = json.dumps(a["answer"])

        # Read old answer before upsert (for change log)
        old_row = (await db.execute(text(
            "SELECT answer FROM intake_response WHERE request_id = :rid AND template_id = :tid"
        ), {"rid": rid, "tid": tid})).mappings().first()
        old_answer = old_row["answer"] if old_row else None

        row = (await db.execute(text("""
            INSERT INTO intake_response (request_id, template_id, answer, create_by, update_by)
            VALUES (:rid, :tid, CAST(:answer AS jsonb), :user, :user)
            ON CONFLICT (request_id, template_id) DO UPDATE
            SET answer = CAST(:answer AS jsonb), update_by = :user, update_at = NOW()
            RETURNING *
        """), {
            "rid": rid,
            "tid": tid,
            "answer": new_answer,
            "user": user.id,
        })).mappings().first()
        if row:
            results.append(_map_response(dict(row)))

        # Write change log if the answer actually changed
        if old_row and json.dumps(old_answer) != new_answer:
            await db.execute(text("""
                INSERT INTO intake_change_log (request_id, template_id, old_answer, new_answer, change_reason, changed_by)
                VALUES (:rid, :tid, CAST(:old AS jsonb), CAST(:new AS jsonb), CAST(:reason AS uuid), :user)
            """), {
                "rid": rid,
                "tid": tid,
                "old": json.dumps(old_answer),
                "new": new_answer,
                "reason": change_reason,
                "user": user.id,
            })

    await db.commit()
    return {"data": results}


@router.post("/evaluate/{request_id}", dependencies=[Depends(require_permission("intake", "write"))])
async def evaluate_scoping(request_id: str, db: AsyncSession = Depends(get_db)):
    """Evaluate scoping answers against dispatch rules to determine applicable domains."""
    rid = await _resolve_request_uuid(db, request_id)
    # Get scoping responses
    responses = (await db.execute(text("""
        SELECT ir.template_id, ir.answer, it.triggers_domain
        FROM intake_response ir
        JOIN intake_template it ON it.id = ir.template_id
        WHERE ir.request_id = :rid AND it.section_type = 'scoping' AND it.triggers_domain IS NOT NULL
    """), {"rid": rid})).mappings().all()

    triggered_domains: set[str] = set()
    for r in responses:
        answer = r["answer"]
        triggers = r["triggers_domain"]
        # Simple logic: if answer is truthy / "Yes" / non-empty, trigger the domains
        if triggers and answer and str(answer).strip().lower() not in ("", "no", "false", "null", "n/a"):
            if isinstance(triggers, list):
                triggered_domains.update(triggers)
            elif isinstance(triggers, str):
                triggered_domains.update(t.strip() for t in triggers.split(","))

    # Update governance request status
    await db.execute(text(
        "UPDATE governance_request SET status = 'Scoping', update_at = NOW() "
        "WHERE id = :rid"
    ), {"rid": rid})

    await db.commit()
    return {"triggeredDomains": sorted(triggered_domains)}


# ---------------------------------------------------------------------------
# Change log (for ISR feedback loop)
# ---------------------------------------------------------------------------

@router.get("/changelog/{request_id}", dependencies=[Depends(require_permission("intake", "read"))])
async def get_changelog(request_id: str, db: AsyncSession = Depends(get_db)):
    rid = await _resolve_request_uuid(db, request_id)
    rows = (await db.execute(text("""
        SELECT cl.*, it.question_text, it.section
        FROM intake_change_log cl
        LEFT JOIN intake_template it ON it.id = cl.template_id
        WHERE cl.request_id = :rid
        ORDER BY cl.changed_at DESC
    """), {"rid": rid})).mappings().all()
    return {"data": [{
        "id": str(r["id"]),
        "templateId": str(r["template_id"]),
        "questionText": r.get("question_text"),
        "section": r.get("section"),
        "oldAnswer": r.get("old_answer"),
        "newAnswer": r.get("new_answer"),
        "changeReason": str(r["change_reason"]) if r.get("change_reason") else None,
        "changedBy": r.get("changed_by"),
        "changedAt": r["changed_at"].isoformat() if r.get("changed_at") else None,
    } for r in rows]}


# ---------------------------------------------------------------------------
# Admin: Template CRUD
# ---------------------------------------------------------------------------

@router.get("/templates/admin", dependencies=[Depends(require_permission("intake_template", "read"))])
async def list_templates_admin(
    section_type: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """List ALL templates including inactive ones (admin view)."""
    conditions: list[str] = []
    params: dict = {}
    if section_type:
        conditions.append("section_type = :section_type")
        params["section_type"] = section_type

    where = (" WHERE " + " AND ".join(conditions)) if conditions else ""
    rows = (await db.execute(
        text(f"SELECT * FROM intake_template{where} ORDER BY section_type, sort_order, question_no"),
        params,
    )).mappings().all()
    return {"data": [_map_template(dict(r)) for r in rows]}


@router.post("/templates", dependencies=[Depends(require_role(Role.ADMIN))])
async def create_template(body: dict, user: AuthUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    import json
    row = (await db.execute(text("""
        INSERT INTO intake_template (section_type, section, question_no, question_text,
            answer_type, options, is_required, help_text, triggers_domain, sort_order)
        VALUES (:section_type, :section, :question_no, :question_text,
            :answer_type, CAST(:options AS jsonb), :is_required, :help_text, :triggers_domain, :sort_order)
        RETURNING *
    """), {
        "section_type": body.get("sectionType", "common"),
        "section": body["section"],
        "question_no": body.get("questionNo", 1),
        "question_text": body["questionText"],
        "answer_type": body.get("answerType", "text"),
        "options": json.dumps(body["options"]) if body.get("options") else None,
        "is_required": body.get("isRequired", False),
        "help_text": body.get("helpText"),
        "triggers_domain": body.get("triggersDomain"),
        "sort_order": body.get("sortOrder", 0),
    })).mappings().first()
    await db.commit()
    return _map_template(dict(row))


@router.put("/templates/{template_id}", dependencies=[Depends(require_role(Role.ADMIN))])
async def update_template(template_id: str, body: dict, db: AsyncSession = Depends(get_db)):
    import json
    sets, params = [], {"id": template_id}
    field_map = [
        ("sectionType", "section_type"), ("section", "section"),
        ("questionNo", "question_no"), ("questionText", "question_text"),
        ("answerType", "answer_type"), ("isRequired", "is_required"),
        ("helpText", "help_text"), ("sortOrder", "sort_order"),
        ("isActive", "is_active"),
    ]
    for field, col in field_map:
        if field in body:
            sets.append(f"{col} = :{col}")
            params[col] = body[field]
    if "options" in body:
        sets.append("options = CAST(:options AS jsonb)")
        params["options"] = json.dumps(body["options"]) if body["options"] else None
    if "triggersDomain" in body:
        sets.append("triggers_domain = :triggers_domain")
        params["triggers_domain"] = body["triggersDomain"]

    if not sets:
        raise HTTPException(status_code=400, detail="No fields to update")

    row = (await db.execute(text(
        f"UPDATE intake_template SET {', '.join(sets)} WHERE id = :id RETURNING *"
    ), params)).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Template not found")
    await db.commit()
    return _map_template(dict(row))


@router.delete("/templates/{template_id}", dependencies=[Depends(require_role(Role.ADMIN))])
async def delete_template(template_id: str, db: AsyncSession = Depends(get_db)):
    """Soft-delete: set is_active = false."""
    row = (await db.execute(text(
        "UPDATE intake_template SET is_active = false WHERE id = :id RETURNING id"
    ), {"id": template_id})).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Template not found")
    await db.commit()
    return {"ok": True}
