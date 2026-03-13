"""Dev-only endpoints for test data cleanup."""
from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db

router = APIRouter()

# Seed rule codes — protected from cleanup
_SEED_RULES = "('INTERNAL','EXTERNAL','AI','PII','OPEN_SOURCE','INTERNAL_ONLY','EXTERNAL_USING')"
_SEED_LEVEL1_RULES = "('INTERNAL','EXTERNAL','AI','PII','OPEN_SOURCE')"

# Transactional tables — DELETE ALL rows (FK-safe order: children first).
_TRANSACTIONAL_TABLES = [
    "review_comment",
    "review_action",
    "domain_questionnaire_response",
    "shared_artifact",
    "info_supplement_request",
    "intake_change_log",
    "governance_request_attachment",
    "governance_request_rule",
    "intake_response",
    "domain_review",
    "audit_log",
    "governance_request",
]

# Config/seed tables — DELETE only test-generated rows (preserve seed data).
# Each entry: (table, WHERE clause to identify test rows)
_CONFIG_CLEANUP = [
    # dispatch_rule_exclusion for non-seed rules
    ("dispatch_rule_exclusion",
     f"rule_code NOT IN {_SEED_RULES} OR excluded_rule_code NOT IN {_SEED_RULES}"),
    # dispatch_rule_domain for non-seed rules
    ("dispatch_rule_domain",
     f"rule_id IN (SELECT id FROM dispatch_rule WHERE rule_code NOT IN {_SEED_RULES})"),
    # Test-created dispatch rules (children first, then parents)
    ("dispatch_rule",
     f"rule_code NOT IN {_SEED_RULES} AND parent_rule_code IS NOT NULL"),
    ("dispatch_rule",
     f"rule_code NOT IN {_SEED_RULES} AND parent_rule_code IS NULL"),
    # Test-created domains (fixtures use TEST_/TST_/E2E_ prefixes)
    ("domain_registry",
     "domain_code LIKE 'TEST\\_%' OR domain_code LIKE 'TST\\_%' OR domain_code LIKE 'E2E\\_%'"),
    # Test-created intake templates (seed rows have create_by IS NULL)
    ("intake_template",
     "id NOT IN (SELECT id FROM intake_template WHERE section_type IN ('scoping','common') AND is_active = TRUE AND sort_order <= 50)"),
]


@router.get("/users")
async def list_dev_users(db: AsyncSession = Depends(get_db)):
    """List all users with roles — no RBAC, for dev Switch User dropdown."""
    rows = (await db.execute(text("""
        SELECT ur.itcode, e.name, ur.role
        FROM user_role ur
        JOIN employee_info e ON ur.itcode = e.itcode
        ORDER BY ur.assigned_at DESC
    """))).mappings().all()
    return {"data": [dict(r) for r in rows]}


@router.post("/delete")
async def delete_specific_resources(body: dict, db: AsyncSession = Depends(get_db)):
    """Delete specific test-created resources by ID. FK-safe cascading deletes.

    Body fields (all optional arrays):
      governanceRequests: list of request_id strings (e.g. "GR-000001")
      dispatchRules: list of rule_code strings
      domains: list of domain_code strings
      intakeTemplates: list of template UUID strings
      userRoles: list of itcode strings
    """
    deleted = {}

    # 1. Governance requests (cascade handles most children)
    gr_ids = body.get("governanceRequests") or []
    if gr_ids:
        # Look up UUIDs from request_id strings
        rows = (await db.execute(text(
            "SELECT id FROM governance_request WHERE request_id = ANY(:ids)"
        ), {"ids": gr_ids})).scalars().all()
        uuids = list(rows)  # UUID objects
        if uuids:
            uuid_strs = [str(u) for u in uuids]
            # Delete audit_log entries (entity_id is VARCHAR, no FK cascade)
            r = await db.execute(text(
                "DELETE FROM audit_log WHERE entity_id = ANY(:ids)"
            ), {"ids": uuid_strs})
            deleted["audit_log"] = r.rowcount
            # Delete governance_request_rule (rule_code FK has no CASCADE)
            r = await db.execute(text(
                "DELETE FROM governance_request_rule WHERE request_id IN "
                "(SELECT id FROM governance_request WHERE request_id = ANY(:ids))"
            ), {"ids": gr_ids})
            deleted["governance_request_rule"] = r.rowcount
            # Delete governance_request (cascades to attachments, domain_review, intake_response, etc.)
            r = await db.execute(text(
                "DELETE FROM governance_request WHERE request_id = ANY(:ids)"
            ), {"ids": gr_ids})
            deleted["governance_request"] = r.rowcount

    # 2. Intake templates
    tmpl_ids = body.get("intakeTemplates") or []
    if tmpl_ids:
        # Clean up intake_response / intake_change_log referencing these templates (no CASCADE)
        await db.execute(text(
            "DELETE FROM intake_response WHERE template_id IN "
            "(SELECT id FROM intake_template WHERE id::text = ANY(:ids))"
        ), {"ids": tmpl_ids})
        await db.execute(text(
            "DELETE FROM intake_change_log WHERE template_id IN "
            "(SELECT id FROM intake_template WHERE id::text = ANY(:ids))"
        ), {"ids": tmpl_ids})
        r = await db.execute(text(
            "DELETE FROM intake_template WHERE id::text = ANY(:ids)"
        ), {"ids": tmpl_ids})
        deleted["intake_template"] = r.rowcount

    # 3. Dispatch rules (cascade handles domain, exclusion, dependency rows)
    rule_codes = body.get("dispatchRules") or []
    if rule_codes:
        # Clean up governance_request_rule references (no CASCADE on rule_code FK)
        await db.execute(text(
            "DELETE FROM governance_request_rule WHERE rule_code = ANY(:codes)"
        ), {"codes": rule_codes})
        # Delete children first (rules whose parent_rule_code is in the list)
        await db.execute(text(
            "DELETE FROM dispatch_rule WHERE parent_rule_code = ANY(:codes)"
        ), {"codes": rule_codes})
        # Delete the rules themselves
        r = await db.execute(text(
            "DELETE FROM dispatch_rule WHERE rule_code = ANY(:codes)"
        ), {"codes": rule_codes})
        deleted["dispatch_rule"] = r.rowcount

    # 4. Domains
    domain_codes = body.get("domains") or []
    if domain_codes:
        # Clean up dispatch_rule_domain references (domain_code is VARCHAR, not FK)
        await db.execute(text(
            "DELETE FROM dispatch_rule_domain WHERE domain_code = ANY(:codes)"
        ), {"codes": domain_codes})
        r = await db.execute(text(
            "DELETE FROM domain_registry WHERE domain_code = ANY(:codes)"
        ), {"codes": domain_codes})
        deleted["domain_registry"] = r.rowcount

    # 5. User roles
    itcodes = body.get("userRoles") or []
    if itcodes:
        r = await db.execute(text(
            "DELETE FROM user_role WHERE itcode = ANY(:codes)"
        ), {"codes": itcodes})
        deleted["user_role"] = r.rowcount

    await db.commit()
    return {"deleted": deleted}


@router.post("/cleanup")
async def cleanup_test_data(db: AsyncSession = Depends(get_db)):
    """Delete all transactional test data and test-generated config rows.

    NOTE: Deprecated for automated tests — use POST /dev/delete with specific IDs instead.
    Kept for manual developer cleanup during local development.

    Preserves seed data (domains EA/BIA/RAI/DATA_PRIVACY, rules INTERNAL/EXTERNAL/AI/PII/OPEN_SOURCE,
    seed intake templates, etc.). Safe to call repeatedly — idempotent.
    """
    deleted = {}

    # 1. Transactional tables — wipe everything
    for table in _TRANSACTIONAL_TABLES:
        result = await db.execute(text(f"DELETE FROM {table}"))
        deleted[table] = result.rowcount

    # 2. Config tables — only test-generated rows
    for table, where in _CONFIG_CLEANUP:
        result = await db.execute(text(f"DELETE FROM {table} WHERE {where}"))
        deleted[table] = deleted.get(table, 0) + result.rowcount

    # 3. Reset seed level-1 dispatch rules (clear any test parent assignments)
    await db.execute(text(
        f"UPDATE dispatch_rule SET parent_rule_code = NULL "
        f"WHERE rule_code IN {_SEED_LEVEL1_RULES} AND parent_rule_code IS NOT NULL"
    ))

    await db.commit()
    return {"cleaned": True, "deleted": deleted}
