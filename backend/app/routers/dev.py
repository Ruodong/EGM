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


@router.post("/cleanup")
async def cleanup_test_data(db: AsyncSession = Depends(get_db)):
    """Delete all transactional test data and test-generated config rows.

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

    # 4. Reset the GR sequence so test IDs start fresh
    await db.execute(text("SELECT setval('gr_seq', 1, false)"))

    await db.commit()
    return {"cleaned": True, "deleted": deleted}
