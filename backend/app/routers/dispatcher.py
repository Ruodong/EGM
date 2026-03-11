"""Dispatcher router — execute dispatch rules to create domain reviews."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.database import get_db
from app.auth import require_permission, get_current_user, AuthUser

router = APIRouter()


@router.post("/execute/{request_id}", dependencies=[Depends(require_permission("governance_request", "write"))])
async def execute_dispatch(request_id: str, body: dict, user: AuthUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Create domain_review records for each triggered domain and update request status."""
    # Resolve the actual governance_request UUID
    gr = (await db.execute(text(
        "SELECT id FROM governance_request WHERE request_id = :id OR id::text = :id"
    ), {"id": request_id})).scalar()
    if not gr:
        raise HTTPException(status_code=404, detail="Governance request not found")

    domain_codes = body.get("domainCodes", [])
    if not domain_codes:
        # Auto-evaluate from scoping answers
        scoping_rows = (await db.execute(text("""
            SELECT ir.answer, it.triggers_domain
            FROM intake_response ir
            JOIN intake_template it ON it.id = ir.template_id
            WHERE ir.request_id = :rid AND it.section_type = 'scoping' AND it.triggers_domain IS NOT NULL
        """), {"rid": str(gr)})).mappings().all()

        triggered: set[str] = set()
        for r in scoping_rows:
            answer = r["answer"]
            triggers = r["triggers_domain"]
            if triggers and answer and str(answer).strip().lower() not in ("", "no", "false", "null", "n/a"):
                if isinstance(triggers, list):
                    triggered.update(triggers)
                elif isinstance(triggers, str):
                    triggered.update(t.strip() for t in triggers.split(","))

        # Also check dispatch rules (all types)
        rules = (await db.execute(text(
            "SELECT * FROM dispatch_rule WHERE is_active = true"
        ))).mappings().all()

        # Build lookup of scoping answers by template_id
        answer_by_template: dict[str, object] = {}
        all_responses = (await db.execute(text("""
            SELECT ir.template_id, ir.answer
            FROM intake_response ir
            JOIN intake_template it ON it.id = ir.template_id
            WHERE ir.request_id = :rid AND it.section_type = 'scoping'
        """), {"rid": str(gr)})).mappings().all()
        for resp in all_responses:
            answer_by_template[str(resp["template_id"])] = resp["answer"]

        for rule in rules:
            ct = rule["condition_type"]
            if ct == "always":
                triggered.add(rule["domain_code"])
            elif ct in ("scoping_answer", "field_value"):
                field = rule.get("condition_field")
                operator = rule.get("condition_operator", "equals")
                expected = rule.get("condition_value")
                if not field:
                    continue
                actual = answer_by_template.get(field)
                if actual is None:
                    continue
                actual_str = str(actual).strip().lower() if actual else ""
                expected_str = str(expected).strip().lower() if expected else ""
                match = False
                if operator == "equals":
                    match = actual_str == expected_str
                elif operator == "not_equals":
                    match = actual_str != expected_str
                elif operator == "contains":
                    match = expected_str in actual_str
                elif operator == "in":
                    if isinstance(expected, list):
                        match = actual_str in [str(v).strip().lower() for v in expected]
                elif operator == "gt":
                    try:
                        match = float(actual_str) > float(expected_str)
                    except (ValueError, TypeError):
                        pass
                elif operator == "lt":
                    try:
                        match = float(actual_str) < float(expected_str)
                    except (ValueError, TypeError):
                        pass
                if match:
                    triggered.add(rule["domain_code"])

        domain_codes = list(triggered)
        if not domain_codes:
            # If no scoping answers yet, dispatch all active domains
            all_domains = (await db.execute(text(
                "SELECT domain_code FROM domain_registry WHERE is_active = true"
            ))).scalars().all()
            domain_codes = list(all_domains)

    created = []
    for code in domain_codes:
        # Check domain exists
        domain = (await db.execute(text(
            "SELECT * FROM domain_registry WHERE domain_code = :code AND is_active = true"
        ), {"code": code})).mappings().first()
        if not domain:
            continue

        # Check if already exists
        existing = (await db.execute(text(
            "SELECT id FROM domain_review WHERE request_id = :rid AND domain_code = :code"
        ), {"rid": str(gr), "code": code})).scalar()
        if existing:
            continue

        row = (await db.execute(text("""
            INSERT INTO domain_review (request_id, domain_code, status, create_by, update_by)
            VALUES (:rid, :code, 'Pending', :user, :user)
            RETURNING *
        """), {"rid": str(gr), "code": code, "user": user.id})).mappings().first()
        if row:
            created.append({
                "id": str(row["id"]),
                "domainCode": row["domain_code"],
                "status": row["status"],
            })

    # Update governance request status to "In Review"
    await db.execute(text(
        "UPDATE governance_request SET status = 'In Review', update_by = :user, update_at = NOW() "
        "WHERE id = :rid"
    ), {"rid": str(gr), "user": user.id})

    await db.commit()
    return {"dispatched": created, "count": len(created)}
