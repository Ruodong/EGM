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

    # Update governance request status to "In Progress"
    await db.execute(text(
        "UPDATE governance_request SET status = 'In Progress', update_by = :user, update_at = NOW() "
        "WHERE id = :rid"
    ), {"rid": str(gr), "user": user.id})

    await db.commit()
    return {"dispatched": created, "count": len(created)}
