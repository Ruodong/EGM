"""Dispatch Rules router — manage project characteristic tags and Rule-Domain matrix."""
from __future__ import annotations

import json
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.database import get_db
from app.auth import require_permission, require_role, require_auth, Role, get_current_user, AuthUser

router = APIRouter()


# ── Mapping helpers ──────────────────────────────────────────────

def _map_rule(r: dict) -> dict:
    return {
        "id": str(r["id"]),
        "ruleCode": r["rule_code"],
        "ruleName": r["rule_name"],
        "description": r.get("description"),
        "parentRuleCode": r.get("parent_rule_code"),
        "sortOrder": r.get("sort_order", 0),
        "isActive": r.get("is_active", True),
        "isMandatory": r.get("is_mandatory", False),
        "createBy": r.get("create_by"),
        "createAt": r["create_at"].isoformat() if r.get("create_at") else None,
        "updateBy": r.get("update_by"),
        "updateAt": r["update_at"].isoformat() if r.get("update_at") else None,
    }


# ── Rule CRUD ───────────────────────────────────────────────────

@router.get(
    "/",
    dependencies=[Depends(require_auth)],
)
async def list_rules(
    includeInactive: bool = Query(False),
    db: AsyncSession = Depends(get_db),
):
    """List all dispatch rules with their domain relationships."""
    where = "" if includeInactive else "WHERE cr.is_active = TRUE"

    rows = (await db.execute(text(f"""
        SELECT cr.*,
               COALESCE(parent.sort_order, cr.sort_order) AS group_sort,
               CASE WHEN cr.parent_rule_code IS NULL THEN 0 ELSE 1 END AS level
        FROM dispatch_rule cr
        LEFT JOIN dispatch_rule parent ON cr.parent_rule_code = parent.rule_code
        {where}
        ORDER BY group_sort, level, cr.sort_order, cr.rule_code
    """))).mappings().all()

    # Fetch domain relationships for each rule
    domain_rows = (await db.execute(text("""
        SELECT crd.rule_id, crd.domain_code, crd.relationship
        FROM dispatch_rule_domain crd
        JOIN domain_registry dr ON crd.domain_code = dr.domain_code AND dr.is_active = TRUE
    """))).mappings().all()

    # Group domains by rule_id
    domains_by_rule: dict[str, list[dict]] = {}
    for dr in domain_rows:
        rid = str(dr["rule_id"])
        if rid not in domains_by_rule:
            domains_by_rule[rid] = []
        domains_by_rule[rid].append({
            "domainCode": dr["domain_code"],
            "relationship": dr["relationship"],
        })

    # Fetch exclusion relationships
    excl_rows = (await db.execute(text(
        "SELECT rule_code, excluded_rule_code FROM dispatch_rule_exclusion"
    ))).mappings().all()
    exclusions_by_rule: dict[str, list[str]] = {}
    for ex in excl_rows:
        exclusions_by_rule.setdefault(ex["rule_code"], []).append(ex["excluded_rule_code"])

    # Fetch dependency relationships
    dep_rows = (await db.execute(text(
        "SELECT rule_code, required_rule_code FROM dispatch_rule_dependency"
    ))).mappings().all()
    dependencies_by_rule: dict[str, list[str]] = {}
    for dep in dep_rows:
        dependencies_by_rule.setdefault(dep["rule_code"], []).append(dep["required_rule_code"])

    result = []
    for r in rows:
        rule = _map_rule(dict(r))
        rule["domains"] = domains_by_rule.get(rule["id"], [])
        rule["exclusions"] = exclusions_by_rule.get(rule["ruleCode"], [])
        rule["dependencies"] = dependencies_by_rule.get(rule["ruleCode"], [])
        result.append(rule)

    return {"data": result}


# ── Matrix (must be before /{code} to avoid route conflict) ─────

@router.get(
    "/matrix",
    dependencies=[Depends(require_permission("dispatch_rule", "read"))],
)
async def get_matrix(db: AsyncSession = Depends(get_db)):
    """Return the full Rule × Domain matrix."""
    # Active rules (ordered: parents first, then children)
    rules = (await db.execute(text("""
        SELECT cr.id, cr.rule_code, cr.rule_name, cr.description, cr.parent_rule_code, cr.is_mandatory,
               COALESCE(parent.sort_order, cr.sort_order) AS group_sort,
               CASE WHEN cr.parent_rule_code IS NULL THEN 0 ELSE 1 END AS level
        FROM dispatch_rule cr
        LEFT JOIN dispatch_rule parent ON cr.parent_rule_code = parent.rule_code
        WHERE cr.is_active = TRUE
        ORDER BY group_sort, level, cr.sort_order, cr.rule_code
    """))).mappings().all()

    # Active domains
    domains = (await db.execute(text("""
        SELECT domain_code, domain_name
        FROM domain_registry
        WHERE is_active = TRUE
        ORDER BY domain_code
    """))).mappings().all()

    # All relationships
    rels = (await db.execute(text("""
        SELECT cr.rule_code, crd.domain_code, crd.relationship
        FROM dispatch_rule_domain crd
        JOIN dispatch_rule cr ON crd.rule_id = cr.id AND cr.is_active = TRUE
        JOIN domain_registry dr ON crd.domain_code = dr.domain_code AND dr.is_active = TRUE
    """))).mappings().all()

    # Build matrix dict: { ruleCode: { domainCode: relationship } }
    matrix: dict[str, dict[str, str]] = {}
    for rel in rels:
        rc = rel["rule_code"]
        if rc not in matrix:
            matrix[rc] = {}
        matrix[rc][rel["domain_code"]] = rel["relationship"]

    # Fill in 'out' for any missing combinations
    for rule in rules:
        rc = rule["rule_code"]
        if rc not in matrix:
            matrix[rc] = {}
        for domain in domains:
            dc = domain["domain_code"]
            if dc not in matrix[rc]:
                matrix[rc][dc] = "out"

    # Fetch exclusion relationships
    excl_rows = (await db.execute(text(
        "SELECT rule_code, excluded_rule_code FROM dispatch_rule_exclusion"
    ))).mappings().all()
    exclusions: dict[str, list[str]] = {}
    for ex in excl_rows:
        exclusions.setdefault(ex["rule_code"], []).append(ex["excluded_rule_code"])

    # Fetch dependency relationships
    dep_rows = (await db.execute(text(
        "SELECT rule_code, required_rule_code FROM dispatch_rule_dependency"
    ))).mappings().all()
    dependencies: dict[str, list[str]] = {}
    for dep in dep_rows:
        dependencies.setdefault(dep["rule_code"], []).append(dep["required_rule_code"])

    return {
        "rules": [{"ruleCode": r["rule_code"], "ruleName": r["rule_name"], "description": r.get("description"), "parentRuleCode": r.get("parent_rule_code"), "isMandatory": r.get("is_mandatory", False)} for r in rules],
        "domains": [{"domainCode": d["domain_code"], "domainName": d["domain_name"]} for d in domains],
        "matrix": matrix,
        "exclusions": exclusions,
        "dependencies": dependencies,
    }


@router.put("/matrix", dependencies=[Depends(require_permission("dispatch_rule", "write"))])
async def save_matrix(
    body: dict,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Batch save the entire Rule-Domain matrix (full replacement)."""
    matrix = body.get("matrix", {})
    if not matrix:
        raise HTTPException(status_code=400, detail="matrix is required")

    # Delete all existing relationships for active rules
    await db.execute(text("""
        DELETE FROM dispatch_rule_domain
        WHERE rule_id IN (SELECT id FROM dispatch_rule WHERE is_active = TRUE)
    """))

    # Insert new relationships
    for rule_code, domain_map in matrix.items():
        # Look up rule_id
        rule_row = (await db.execute(text(
            "SELECT id FROM dispatch_rule WHERE rule_code = :code AND is_active = TRUE"
        ), {"code": rule_code})).mappings().first()
        if not rule_row:
            continue

        for domain_code, relationship in domain_map.items():
            if relationship not in ("in", "out"):
                continue
            await db.execute(text("""
                INSERT INTO dispatch_rule_domain (rule_id, domain_code, relationship, create_by)
                VALUES (:rid, :dc, :rel, :user)
                ON CONFLICT (rule_id, domain_code) DO UPDATE SET relationship = EXCLUDED.relationship
            """), {
                "rid": rule_row["id"],
                "dc": domain_code,
                "rel": relationship,
                "user": user.id,
            })

    await db.commit()

    # Audit log
    await db.execute(text("""
        INSERT INTO audit_log (entity_type, action, new_value, performed_by)
        VALUES ('dispatch_rule_domain', 'save_matrix', CAST(:val AS jsonb), :user)
    """), {
        "val": json.dumps({"ruleCount": len(matrix)}),
        "user": user.id,
    })
    await db.commit()

    return {"message": "Matrix saved successfully"}


# ── Exclusions (must be before /{code} to avoid route conflict) ──

@router.put("/exclusions", dependencies=[Depends(require_permission("dispatch_rule", "write"))])
async def save_exclusions(
    body: dict,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Batch save mutual exclusion relationships (full replacement).

    Body: { "exclusions": [ { "ruleCode": "A", "excludedRuleCode": "B" }, ... ] }
    Stores both directions (A→B and B→A) automatically.
    """
    pairs = body.get("exclusions", [])

    # Validate all rule codes exist and are active
    all_codes = set()
    for p in pairs:
        rc = p.get("ruleCode", "").strip()
        ex = p.get("excludedRuleCode", "").strip()
        if not rc or not ex:
            raise HTTPException(status_code=400, detail="Each exclusion needs ruleCode and excludedRuleCode")
        if rc == ex:
            raise HTTPException(status_code=400, detail=f"A rule cannot exclude itself: {rc}")
        all_codes.add(rc)
        all_codes.add(ex)

    if all_codes:
        existing = (await db.execute(text(
            "SELECT rule_code, parent_rule_code FROM dispatch_rule WHERE rule_code = ANY(:codes) AND is_active = TRUE"
        ), {"codes": list(all_codes)})).mappings().all()
        found = {r["rule_code"]: r["parent_rule_code"] for r in existing}
        missing = all_codes - set(found.keys())
        if missing:
            raise HTTPException(status_code=400, detail=f"Rules not found or inactive: {', '.join(missing)}")

        # Validate: level-1 can only exclude level-1, level-2 can only exclude siblings
        for p in pairs:
            rc, ex = p["ruleCode"].strip(), p["excludedRuleCode"].strip()
            rc_parent = found.get(rc)
            ex_parent = found.get(ex)
            if rc_parent is None and ex_parent is not None:
                raise HTTPException(status_code=400, detail=f"Cannot exclude across levels: {rc} (level-1) vs {ex} (level-2)")
            if rc_parent is not None and ex_parent is None:
                raise HTTPException(status_code=400, detail=f"Cannot exclude across levels: {rc} (level-2) vs {ex} (level-1)")
            if rc_parent is not None and ex_parent is not None and rc_parent != ex_parent:
                raise HTTPException(status_code=400, detail=f"Level-2 rules can only exclude siblings: {rc} (parent={rc_parent}) vs {ex} (parent={ex_parent})")

    # Full replacement: delete all, re-insert both directions
    await db.execute(text("DELETE FROM dispatch_rule_exclusion"))

    for p in pairs:
        rc, ex = p["ruleCode"].strip(), p["excludedRuleCode"].strip()
        # Insert both directions
        await db.execute(text("""
            INSERT INTO dispatch_rule_exclusion (rule_code, excluded_rule_code, create_by)
            VALUES (:rc, :ex, :user)
            ON CONFLICT (rule_code, excluded_rule_code) DO NOTHING
        """), {"rc": rc, "ex": ex, "user": user.id})
        await db.execute(text("""
            INSERT INTO dispatch_rule_exclusion (rule_code, excluded_rule_code, create_by)
            VALUES (:ex, :rc, :user)
            ON CONFLICT (rule_code, excluded_rule_code) DO NOTHING
        """), {"rc": rc, "ex": ex, "user": user.id})

    await db.commit()

    # Audit log
    await db.execute(text("""
        INSERT INTO audit_log (entity_type, action, new_value, performed_by)
        VALUES ('dispatch_rule_exclusion', 'save_exclusions', CAST(:val AS jsonb), :user)
    """), {
        "val": json.dumps({"pairCount": len(pairs)}),
        "user": user.id,
    })
    await db.commit()

    return {"message": f"Saved {len(pairs)} exclusion pairs"}


# ── Dependencies (must be before /{code} to avoid route conflict) ──

@router.put("/dependencies", dependencies=[Depends(require_permission("dispatch_rule", "write"))])
async def save_dependencies(
    body: dict,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Batch save dependency relationships (full replacement).

    Body: { "dependencies": [ { "ruleCode": "A", "requiredRuleCode": "B" }, ... ] }
    Unidirectional: A depends on B does NOT mean B depends on A.
    Multiple entries for the same ruleCode = OR semantics (any one satisfies).
    """
    pairs = body.get("dependencies", [])

    # Validate all rule codes exist and are active
    all_codes = set()
    for p in pairs:
        rc = p.get("ruleCode", "").strip()
        req = p.get("requiredRuleCode", "").strip()
        if not rc or not req:
            raise HTTPException(status_code=400, detail="Each dependency needs ruleCode and requiredRuleCode")
        if rc == req:
            raise HTTPException(status_code=400, detail=f"A rule cannot depend on itself: {rc}")
        all_codes.add(rc)
        all_codes.add(req)

    if all_codes:
        existing = (await db.execute(text(
            "SELECT rule_code FROM dispatch_rule WHERE rule_code = ANY(:codes) AND is_active = TRUE"
        ), {"codes": list(all_codes)})).scalars().all()
        found = set(existing)
        missing = all_codes - found
        if missing:
            raise HTTPException(status_code=400, detail=f"Rules not found or inactive: {', '.join(missing)}")

    # Full replacement: delete all, re-insert
    await db.execute(text("DELETE FROM dispatch_rule_dependency"))

    for p in pairs:
        rc, req = p["ruleCode"].strip(), p["requiredRuleCode"].strip()
        await db.execute(text("""
            INSERT INTO dispatch_rule_dependency (rule_code, required_rule_code, create_by)
            VALUES (:rc, :req, :user)
            ON CONFLICT (rule_code, required_rule_code) DO NOTHING
        """), {"rc": rc, "req": req, "user": user.id})

    await db.commit()

    # Audit log
    await db.execute(text("""
        INSERT INTO audit_log (entity_type, action, new_value, performed_by)
        VALUES ('dispatch_rule_dependency', 'save_dependencies', CAST(:val AS jsonb), :user)
    """), {
        "val": json.dumps({"pairCount": len(pairs)}),
        "user": user.id,
    })
    await db.commit()

    return {"message": f"Saved {len(pairs)} dependency pairs"}


# ── Reorder (must be before /{code} to avoid route conflict) ────

@router.put("/reorder", dependencies=[Depends(require_permission("dispatch_rule", "write"))])
async def reorder_rules(
    body: dict,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Reorder rules by updating sort_order values.

    Body: { "orders": [ { "ruleCode": "AI", "sortOrder": 1 }, ... ] }
    """
    orders = body.get("orders", [])
    if not orders:
        raise HTTPException(status_code=400, detail="orders array is required")

    for item in orders:
        code = item.get("ruleCode")
        sort = item.get("sortOrder")
        if code is None or sort is None:
            continue
        await db.execute(text("""
            UPDATE dispatch_rule SET sort_order = :sort, update_by = :user, update_at = NOW()
            WHERE rule_code = :code
        """), {"code": code, "sort": sort, "user": user.id})

    await db.commit()

    # Audit log
    await db.execute(text("""
        INSERT INTO audit_log (entity_type, action, new_value, performed_by)
        VALUES ('dispatch_rule', 'reorder', CAST(:val AS jsonb), :user)
    """), {
        "val": json.dumps({"count": len(orders)}),
        "user": user.id,
    })
    await db.commit()

    return {"message": f"Reordered {len(orders)} rules"}


# ── Single Rule (after /matrix to avoid route conflict) ─────────

@router.get(
    "/{code}",
    dependencies=[Depends(require_permission("dispatch_rule", "read"))],
)
async def get_rule(code: str, db: AsyncSession = Depends(get_db)):
    """Get a single dispatch rule with its domain relationships."""
    row = (await db.execute(text("""
        SELECT * FROM dispatch_rule WHERE rule_code = :code
    """), {"code": code})).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Dispatch rule not found")

    rule = _map_rule(dict(row))

    # Domain relationships
    doms = (await db.execute(text("""
        SELECT crd.domain_code, crd.relationship
        FROM dispatch_rule_domain crd
        JOIN domain_registry dr ON crd.domain_code = dr.domain_code AND dr.is_active = TRUE
        WHERE crd.rule_id = :rid
    """), {"rid": row["id"]})).mappings().all()

    rule["domains"] = [{"domainCode": d["domain_code"], "relationship": d["relationship"]} for d in doms]
    return rule


@router.post("/", dependencies=[Depends(require_permission("dispatch_rule", "write"))])
async def create_rule(
    body: dict,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new dispatch rule."""
    rule_code = body.get("ruleCode", "").strip().upper()
    rule_name = body.get("ruleName", "").strip()
    parent_rule_code = body.get("parentRuleCode")
    if isinstance(parent_rule_code, str):
        parent_rule_code = parent_rule_code.strip().upper() or None

    if not rule_code or not rule_name:
        raise HTTPException(status_code=400, detail="ruleCode and ruleName are required")

    # Check duplicate
    existing = (await db.execute(text(
        "SELECT id FROM dispatch_rule WHERE rule_code = :code"
    ), {"code": rule_code})).mappings().first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Rule code '{rule_code}' already exists")

    # Validate parent if provided (must exist, be active, and be a level-1 rule)
    if parent_rule_code:
        parent = (await db.execute(text(
            "SELECT parent_rule_code FROM dispatch_rule WHERE rule_code = :code AND is_active = TRUE"
        ), {"code": parent_rule_code})).mappings().first()
        if not parent:
            raise HTTPException(status_code=400, detail=f"Parent rule '{parent_rule_code}' not found or inactive")
        if parent["parent_rule_code"] is not None:
            raise HTTPException(status_code=400, detail="Cannot nest more than 2 levels deep")

    is_mandatory = bool(body.get("isMandatory", False))

    row = (await db.execute(text("""
        INSERT INTO dispatch_rule (rule_code, rule_name, description, parent_rule_code, sort_order, is_mandatory, create_by, update_by)
        VALUES (:code, :name, :desc, :parent, :sort, :mandatory, :user, :user)
        RETURNING *
    """), {
        "code": rule_code,
        "name": rule_name,
        "desc": body.get("description", "").strip() or None,
        "parent": parent_rule_code,
        "sort": body.get("sortOrder", 0),
        "mandatory": is_mandatory,
        "user": user.id,
    })).mappings().first()
    await db.commit()

    # Audit log
    await db.execute(text("""
        INSERT INTO audit_log (entity_type, entity_id, action, new_value, performed_by)
        VALUES ('dispatch_rule', :id, 'create_rule', CAST(:val AS jsonb), :user)
    """), {
        "id": row["id"],
        "val": json.dumps({"ruleCode": rule_code, "ruleName": rule_name}),
        "user": user.id,
    })
    await db.commit()

    return _map_rule(dict(row))


@router.put("/{code}", dependencies=[Depends(require_permission("dispatch_rule", "write"))])
async def update_rule(
    code: str,
    body: dict,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update an existing dispatch rule."""
    current = (await db.execute(text(
        "SELECT * FROM dispatch_rule WHERE rule_code = :code"
    ), {"code": code})).mappings().first()
    if not current:
        raise HTTPException(status_code=404, detail="Dispatch rule not found")

    rule_name = body.get("ruleName", current["rule_name"]).strip()
    description = body.get("description", current.get("description"))
    if isinstance(description, str):
        description = description.strip() or None
    sort_order = body.get("sortOrder", current.get("sort_order", 0))

    # Handle parentRuleCode update
    parent_rule_code = current.get("parent_rule_code")
    if "parentRuleCode" in body:
        parent_rule_code = body["parentRuleCode"]
        if isinstance(parent_rule_code, str):
            parent_rule_code = parent_rule_code.strip().upper() or None

        if parent_rule_code:
            # Validate parent exists, is active, and is level-1
            parent = (await db.execute(text(
                "SELECT parent_rule_code FROM dispatch_rule WHERE rule_code = :code AND is_active = TRUE"
            ), {"code": parent_rule_code})).mappings().first()
            if not parent:
                raise HTTPException(status_code=400, detail=f"Parent rule '{parent_rule_code}' not found or inactive")
            if parent["parent_rule_code"] is not None:
                raise HTTPException(status_code=400, detail="Cannot nest more than 2 levels deep")

            # Check this rule doesn't have children (would create depth > 2)
            children = (await db.execute(text(
                "SELECT 1 FROM dispatch_rule WHERE parent_rule_code = :code LIMIT 1"
            ), {"code": code})).scalar()
            if children:
                raise HTTPException(status_code=400, detail="Cannot set parent on a rule that has children")

    is_mandatory = bool(body.get("isMandatory", current.get("is_mandatory", False)))

    row = (await db.execute(text("""
        UPDATE dispatch_rule
        SET rule_name = :name, description = :desc, parent_rule_code = :parent,
            sort_order = :sort, is_mandatory = :mandatory, update_by = :user, update_at = NOW()
        WHERE rule_code = :code
        RETURNING *
    """), {
        "code": code,
        "name": rule_name,
        "desc": description,
        "parent": parent_rule_code,
        "sort": sort_order,
        "mandatory": is_mandatory,
        "user": user.id,
    })).mappings().first()
    await db.commit()

    # Audit log
    await db.execute(text("""
        INSERT INTO audit_log (entity_type, entity_id, action, old_value, new_value, performed_by)
        VALUES ('dispatch_rule', :id, 'update_rule', CAST(:old AS jsonb), CAST(:new AS jsonb), :user)
    """), {
        "id": row["id"],
        "old": json.dumps({"ruleName": current["rule_name"]}),
        "new": json.dumps({"ruleName": rule_name}),
        "user": user.id,
    })
    await db.commit()

    return _map_rule(dict(row))


@router.delete("/{code}", dependencies=[Depends(require_permission("dispatch_rule", "write"))])
async def toggle_rule_active(
    code: str,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Toggle a dispatch rule's is_active status (soft delete)."""
    current = (await db.execute(text(
        "SELECT * FROM dispatch_rule WHERE rule_code = :code"
    ), {"code": code})).mappings().first()
    if not current:
        raise HTTPException(status_code=404, detail="Dispatch rule not found")

    new_active = not current["is_active"]
    await db.execute(text("""
        UPDATE dispatch_rule SET is_active = :active, update_by = :user, update_at = NOW()
        WHERE rule_code = :code
    """), {"code": code, "active": new_active, "user": user.id})
    await db.commit()

    # Audit log
    await db.execute(text("""
        INSERT INTO audit_log (entity_type, entity_id, action, old_value, new_value, performed_by)
        VALUES ('dispatch_rule', :id, 'toggle_rule', CAST(:old AS jsonb), CAST(:new AS jsonb), :user)
    """), {
        "id": current["id"],
        "old": json.dumps({"isActive": current["is_active"]}),
        "new": json.dumps({"isActive": new_active}),
        "user": user.id,
    })
    await db.commit()

    return {"message": f"Rule {code} is now {'active' if new_active else 'inactive'}"}
