"""Questionnaire Template router — manage per-domain questionnaire templates."""
from __future__ import annotations

import json
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.database import get_db
from app.auth import require_permission, get_current_user, AuthUser, Role

router = APIRouter()


def _map(r: dict) -> dict:
    return {
        "id": str(r["id"]),
        "domainCode": r["domain_code"],
        "section": r.get("section"),
        "questionNo": r["question_no"],
        "questionText": r["question_text"],
        "questionDescription": r.get("question_description"),
        "answerType": r.get("answer_type", "textarea"),
        "options": r.get("options"),
        "isRequired": r.get("is_required", False),
        "sortOrder": r.get("sort_order", 0),
        "isActive": r.get("is_active", True),
        "dependency": r.get("dependency"),
        "hasDescriptionBox": r.get("has_description_box", False),
        "descriptionBoxTitle": r.get("description_box_title"),
        "questionTextZh": r.get("question_text_zh"),
        "questionDescriptionZh": r.get("question_description_zh"),
        "optionsZh": r.get("options_zh"),
        "descriptionBoxTitleZh": r.get("description_box_title_zh"),
        "questionImages": r.get("question_images"),
        "audience": r.get("audience", "requestor"),
    }


def _is_reviewer_only(user: AuthUser) -> bool:
    """True if user is domain_reviewer but NOT admin or governance_lead."""
    return (
        Role.DOMAIN_REVIEWER in user.roles
        and Role.ADMIN not in user.roles
        and Role.GOVERNANCE_LEAD not in user.roles
    )


def _check_domain_access(user: AuthUser, domain_code: str):
    """Raise 403 if domain_reviewer user is not assigned to this domain."""
    if _is_reviewer_only(user) and domain_code not in user.domain_codes:
        raise HTTPException(status_code=403, detail="Not assigned to this domain")


@router.get("", dependencies=[Depends(require_permission("domain_questionnaire", "read"))])
async def list_templates(
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List questionnaire templates grouped by internal domain."""
    # Get internal active domains
    domain_rows = (await db.execute(text(
        "SELECT domain_code, domain_name FROM domain_registry "
        "WHERE integration_type = 'internal' AND is_active = true "
        "ORDER BY domain_name"
    ))).mappings().all()

    # Filter by reviewer's assigned domains
    if _is_reviewer_only(user):
        domain_rows = [d for d in domain_rows if d["domain_code"] in user.domain_codes]

    codes = [d["domain_code"] for d in domain_rows]
    if not codes:
        return {"data": []}

    # Get all templates for those domains
    tmpl_rows = (await db.execute(text(
        "SELECT * FROM domain_questionnaire_template "
        "WHERE domain_code = ANY(:codes) "
        "ORDER BY domain_code, sort_order, question_no"
    ), {"codes": codes})).mappings().all()

    # Group by domain
    by_domain: dict[str, list[dict]] = {c: [] for c in codes}
    for r in tmpl_rows:
        by_domain.setdefault(r["domain_code"], []).append(_map(dict(r)))

    # Build response
    domain_map = {d["domain_code"]: d["domain_name"] for d in domain_rows}
    data = [
        {
            "domainCode": code,
            "domainName": domain_map.get(code, code),
            "templates": by_domain.get(code, []),
        }
        for code in codes
    ]
    return {"data": data}


@router.get("/{domain_code}", dependencies=[Depends(require_permission("domain_questionnaire", "read"))])
async def list_domain_templates(
    domain_code: str,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List templates for a specific domain."""
    _check_domain_access(user, domain_code)

    # Verify domain is internal
    domain = (await db.execute(text(
        "SELECT domain_code, domain_name, integration_type FROM domain_registry WHERE domain_code = :code"
    ), {"code": domain_code})).mappings().first()
    if not domain:
        raise HTTPException(status_code=404, detail="Domain not found")
    if domain["integration_type"] != "internal":
        raise HTTPException(status_code=400, detail="Only internal domains can have questionnaire templates")

    rows = (await db.execute(text(
        "SELECT * FROM domain_questionnaire_template WHERE domain_code = :code "
        "ORDER BY sort_order, question_no"
    ), {"code": domain_code})).mappings().all()
    return {"data": [_map(dict(r)) for r in rows]}


@router.post("", dependencies=[Depends(require_permission("domain_questionnaire", "write"))])
async def create_template(
    body: dict,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a questionnaire template question."""
    domain_code = body.get("domainCode")
    if not domain_code:
        raise HTTPException(status_code=400, detail="domainCode is required")
    _check_domain_access(user, domain_code)

    # Verify domain is internal
    domain = (await db.execute(text(
        "SELECT integration_type FROM domain_registry WHERE domain_code = :code AND is_active = true"
    ), {"code": domain_code})).mappings().first()
    if not domain:
        raise HTTPException(status_code=404, detail="Domain not found")
    if domain["integration_type"] != "internal":
        raise HTTPException(status_code=400, detail="Only internal domains can have questionnaire templates")

    answer_type = body.get("answerType", "textarea")
    if answer_type not in ("radio", "multiselect", "dropdown", "textarea", "text"):
        raise HTTPException(status_code=400, detail="answerType must be radio, multiselect, dropdown, textarea, or text")

    options = body.get("options")
    if answer_type in ("radio", "multiselect", "dropdown") and not options:
        raise HTTPException(status_code=400, detail="options are required for radio/multiselect/dropdown types")

    dependency = body.get("dependency")
    has_description_box = body.get("hasDescriptionBox", False)
    description_box_title = body.get("descriptionBoxTitle")
    options_zh = body.get("optionsZh")
    question_images = body.get("questionImages")

    audience = body.get("audience", "requestor")
    if audience not in ("requestor", "reviewer"):
        raise HTTPException(status_code=400, detail="audience must be 'requestor' or 'reviewer'")

    row = (await db.execute(text("""
        INSERT INTO domain_questionnaire_template
            (domain_code, section, question_no, question_text, question_description, answer_type, options,
             is_required, sort_order, dependency, has_description_box, description_box_title,
             question_text_zh, question_description_zh, options_zh, description_box_title_zh, question_images,
             audience)
        VALUES (:domain_code, :section, :question_no, :question_text, :question_description, :answer_type,
                CAST(:options AS jsonb), :is_required, :sort_order,
                CAST(:dependency AS jsonb), :has_description_box, :description_box_title,
                :question_text_zh, :question_description_zh,
                CAST(:options_zh AS jsonb), :description_box_title_zh, CAST(:question_images AS jsonb),
                :audience)
        RETURNING *
    """), {
        "domain_code": domain_code,
        "section": body.get("section"),
        "question_no": body.get("questionNo", 1),
        "question_text": body.get("questionText", ""),
        "question_description": body.get("questionDescription"),
        "answer_type": answer_type,
        "options": json.dumps(options) if options else None,
        "is_required": body.get("isRequired", False),
        "sort_order": body.get("sortOrder", 0),
        "dependency": json.dumps(dependency) if dependency else None,
        "has_description_box": has_description_box,
        "description_box_title": description_box_title or None,
        "question_text_zh": body.get("questionTextZh"),
        "question_description_zh": body.get("questionDescriptionZh"),
        "options_zh": json.dumps(options_zh) if options_zh else None,
        "description_box_title_zh": body.get("descriptionBoxTitleZh"),
        "question_images": json.dumps(question_images) if question_images else None,
        "audience": audience,
    })).mappings().first()
    await db.commit()
    return _map(dict(row))


@router.put("/reorder", dependencies=[Depends(require_permission("domain_questionnaire", "write"))])
async def reorder_templates(
    body: dict,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Reorder questionnaire template questions by updating sort_order."""
    orders = body.get("orders", [])
    if not orders:
        raise HTTPException(status_code=400, detail="orders array is required")

    # Verify all templates belong to domains the user can access
    tids = [item["id"] for item in orders if item.get("id")]
    if tids:
        rows = (await db.execute(text(
            "SELECT id, domain_code FROM domain_questionnaire_template WHERE id = ANY(:ids)"
        ), {"ids": tids})).mappings().all()
        for r in rows:
            _check_domain_access(user, r["domain_code"])

    for item in orders:
        tid = item.get("id")
        sort = item.get("sortOrder")
        if tid is None or sort is None:
            continue
        await db.execute(text(
            "UPDATE domain_questionnaire_template SET sort_order = :sort WHERE id = :id"
        ), {"id": tid, "sort": sort})
    await db.commit()
    return {"ok": True}


@router.put("/section-audience", dependencies=[Depends(require_permission("domain_questionnaire", "write"))])
async def update_section_audience(
    body: dict,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Batch update audience for all questions in a domain section."""
    domain_code = body.get("domainCode")
    section = body.get("section")
    audience = body.get("audience")

    if not domain_code:
        raise HTTPException(status_code=400, detail="domainCode is required")
    if audience not in ("requestor", "reviewer"):
        raise HTTPException(status_code=400, detail="audience must be 'requestor' or 'reviewer'")
    _check_domain_access(user, domain_code)

    if section is None:
        # Update questions with NULL section
        await db.execute(text(
            "UPDATE domain_questionnaire_template SET audience = :audience "
            "WHERE domain_code = :dc AND section IS NULL"
        ), {"audience": audience, "dc": domain_code})
    else:
        await db.execute(text(
            "UPDATE domain_questionnaire_template SET audience = :audience "
            "WHERE domain_code = :dc AND section = :section"
        ), {"audience": audience, "dc": domain_code, "section": section})
    await db.commit()
    return {"ok": True}


@router.put("/{template_id}", dependencies=[Depends(require_permission("domain_questionnaire", "write"))])
async def update_template(
    template_id: str,
    body: dict,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update a questionnaire template question."""
    existing = (await db.execute(text(
        "SELECT * FROM domain_questionnaire_template WHERE id = :id"
    ), {"id": template_id})).mappings().first()
    if not existing:
        raise HTTPException(status_code=404, detail="Template not found")

    _check_domain_access(user, existing["domain_code"])

    sets, params = [], {"id": template_id}
    for field, col in [
        ("section", "section"),
        ("questionNo", "question_no"),
        ("questionText", "question_text"),
        ("questionDescription", "question_description"),
        ("answerType", "answer_type"),
        ("isRequired", "is_required"),
        ("sortOrder", "sort_order"),
        ("hasDescriptionBox", "has_description_box"),
        ("descriptionBoxTitle", "description_box_title"),
        ("questionTextZh", "question_text_zh"),
        ("questionDescriptionZh", "question_description_zh"),
        ("descriptionBoxTitleZh", "description_box_title_zh"),
        ("audience", "audience"),
    ]:
        if field in body:
            sets.append(f"{col} = :{col}")
            params[col] = body[field]

    # JSONB fields need CAST
    for field, col in [
        ("options", "options"),
        ("dependency", "dependency"),
        ("optionsZh", "options_zh"),
        ("questionImages", "question_images"),
    ]:
        if field in body:
            sets.append(f"{col} = CAST(:{col} AS jsonb)")
            params[col] = json.dumps(body[field]) if body[field] else None

    if not sets:
        raise HTTPException(status_code=400, detail="No fields to update")

    row = (await db.execute(text(
        f"UPDATE domain_questionnaire_template SET {', '.join(sets)} WHERE id = :id RETURNING *"
    ), params)).mappings().first()
    await db.commit()
    return _map(dict(row))


@router.delete("/{template_id}", dependencies=[Depends(require_permission("domain_questionnaire", "write"))])
async def toggle_template_active(
    template_id: str,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Toggle a template question's is_active status."""
    existing = (await db.execute(text(
        "SELECT * FROM domain_questionnaire_template WHERE id = :id"
    ), {"id": template_id})).mappings().first()
    if not existing:
        raise HTTPException(status_code=404, detail="Template not found")

    _check_domain_access(user, existing["domain_code"])

    new_active = not existing["is_active"]
    row = (await db.execute(text(
        "UPDATE domain_questionnaire_template SET is_active = :active WHERE id = :id RETURNING *"
    ), {"id": template_id, "active": new_active})).mappings().first()
    await db.commit()
    return _map(dict(row))
