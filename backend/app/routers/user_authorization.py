"""User Authorization router — search employees and manage multi-role assignments."""
from __future__ import annotations

import json
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.database import get_db
from app.auth import require_permission, require_role, Role, get_current_user, AuthUser

router = APIRouter()


# ── Mapping helpers ──────────────────────────────────────────────

def _map_employee(r: dict) -> dict:
    return {
        "itcode": r["itcode"],
        "name": r.get("name"),
        "email": r.get("email"),
        "jobRole": r.get("job_role"),
        "workerType": r.get("worker_type"),
        "country": r.get("country"),
        "primarySkill": r.get("primary_skill"),
        "skillLevel": r.get("skill_level"),
        "tier1Org": r.get("tier_1_org"),
        "tier2Org": r.get("tier_2_org"),
        "managerItcode": r.get("manager_itcode"),
        "managerName": r.get("manager_name"),
    }


# ── Employee search ──────────────────────────────────────────────

@router.get(
    "/employees",
    dependencies=[Depends(require_permission("user_authorization", "read"))],
)
async def search_employees(
    search: str = Query("", description="Search by itcode, name, or email"),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """Search employees in employee_info table (synced from EAM)."""
    if not search.strip():
        return {"data": []}

    q = f"%{search.strip()}%"
    rows = (await db.execute(text("""
        SELECT * FROM employee_info
        WHERE itcode ILIKE :q OR name ILIKE :q OR email ILIKE :q
        ORDER BY name
        LIMIT :limit
    """), {"q": q, "limit": limit})).mappings().all()

    return {"data": [_map_employee(dict(r)) for r in rows]}


# ── Role CRUD (multi-role) ───────────────────────────────────────

@router.get(
    "/roles",
    dependencies=[Depends(require_permission("user_authorization", "read"))],
)
async def list_roles(
    search: str = Query("", description="Filter by itcode or name"),
    page: int = Query(1, ge=1),
    pageSize: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """List all user role assignments grouped by user, with domain codes."""
    offset = (page - 1) * pageSize

    where = ""
    params: dict = {"limit": pageSize, "offset": offset}
    if search.strip():
        where = "WHERE (e.itcode ILIKE :q OR e.name ILIKE :q)"
        params["q"] = f"%{search.strip()}%"

    # Count unique users
    count_row = (await db.execute(text(f"""
        SELECT COUNT(DISTINCT ur.itcode) AS cnt
        FROM user_role ur JOIN employee_info e ON ur.itcode = e.itcode
        {where}
    """), params)).mappings().first()
    total = count_row["cnt"] if count_row else 0

    # Get distinct users (paginated)
    user_rows = (await db.execute(text(f"""
        SELECT DISTINCT ur.itcode, e.name, e.email, e.tier_1_org, e.tier_2_org,
               MIN(ur.assigned_at) AS first_assigned_at
        FROM user_role ur
        JOIN employee_info e ON ur.itcode = e.itcode
        {where}
        GROUP BY ur.itcode, e.name, e.email, e.tier_1_org, e.tier_2_org
        ORDER BY first_assigned_at DESC
        LIMIT :limit OFFSET :offset
    """), params)).mappings().all()

    if not user_rows:
        return {"data": [], "total": total, "page": page, "pageSize": pageSize}

    # Get all roles for these users
    itcodes = [r["itcode"] for r in user_rows]
    role_rows = (await db.execute(text("""
        SELECT ur.id, ur.itcode, ur.role, ur.assigned_by, ur.assigned_at,
               ur.update_by, ur.update_at,
               ab.name AS assigned_by_name
        FROM user_role ur
        LEFT JOIN employee_info ab ON ur.assigned_by = ab.itcode
        WHERE ur.itcode = ANY(:itcodes)
        ORDER BY ur.assigned_at
    """), {"itcodes": itcodes})).mappings().all()

    # Get domain codes for domain_reviewer roles
    dr_role_ids = [str(r["id"]) for r in role_rows if r["role"] == "domain_reviewer"]
    domain_map: dict[str, list[str]] = {}  # role_id → [domain_codes]
    if dr_role_ids:
        dc_rows = (await db.execute(text("""
            SELECT user_role_id, domain_code
            FROM user_role_domain
            WHERE user_role_id = ANY(:ids)
        """), {"ids": dr_role_ids})).mappings().all()
        for dc in dc_rows:
            rid = str(dc["user_role_id"])
            domain_map.setdefault(rid, []).append(dc["domain_code"])

    # Group roles by itcode
    roles_by_user: dict[str, list[dict]] = {}
    for r in role_rows:
        rid = str(r["id"])
        role_item = {
            "id": rid,
            "role": r["role"],
            "assignedBy": r["assigned_by"],
            "assignedByName": r.get("assigned_by_name"),
            "assignedAt": r["assigned_at"].isoformat() if r.get("assigned_at") else None,
            "updateBy": r.get("update_by"),
            "updateAt": r["update_at"].isoformat() if r.get("update_at") else None,
        }
        if r["role"] == "domain_reviewer":
            role_item["domainCodes"] = domain_map.get(rid, [])
        roles_by_user.setdefault(r["itcode"], []).append(role_item)

    data = []
    for u in user_rows:
        data.append({
            "itcode": u["itcode"],
            "name": u.get("name"),
            "email": u.get("email"),
            "tier1Org": u.get("tier_1_org"),
            "tier2Org": u.get("tier_2_org"),
            "roles": roles_by_user.get(u["itcode"], []),
        })

    return {
        "data": data,
        "total": total,
        "page": page,
        "pageSize": pageSize,
    }


@router.get(
    "/roles/{itcode}",
    dependencies=[Depends(require_permission("user_authorization", "read"))],
)
async def get_user_roles(itcode: str, db: AsyncSession = Depends(get_db)):
    """Get all role assignments for a single user."""
    # Employee info
    emp = (await db.execute(text("""
        SELECT * FROM employee_info WHERE itcode = :itcode
    """), {"itcode": itcode})).mappings().first()
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")

    # Roles
    role_rows = (await db.execute(text("""
        SELECT ur.id, ur.role, ur.assigned_by, ur.assigned_at,
               ur.update_by, ur.update_at,
               ab.name AS assigned_by_name
        FROM user_role ur
        LEFT JOIN employee_info ab ON ur.assigned_by = ab.itcode
        WHERE ur.itcode = :itcode
        ORDER BY ur.assigned_at
    """), {"itcode": itcode})).mappings().all()

    # Domain codes
    dr_ids = [str(r["id"]) for r in role_rows if r["role"] == "domain_reviewer"]
    domain_map: dict[str, list[str]] = {}
    if dr_ids:
        dc_rows = (await db.execute(text("""
            SELECT user_role_id, domain_code FROM user_role_domain
            WHERE user_role_id = ANY(:ids)
        """), {"ids": dr_ids})).mappings().all()
        for dc in dc_rows:
            domain_map.setdefault(str(dc["user_role_id"]), []).append(dc["domain_code"])

    roles = []
    for r in role_rows:
        rid = str(r["id"])
        item = {
            "id": rid,
            "role": r["role"],
            "assignedBy": r["assigned_by"],
            "assignedByName": r.get("assigned_by_name"),
            "assignedAt": r["assigned_at"].isoformat() if r.get("assigned_at") else None,
            "updateBy": r.get("update_by"),
            "updateAt": r["update_at"].isoformat() if r.get("update_at") else None,
        }
        if r["role"] == "domain_reviewer":
            item["domainCodes"] = domain_map.get(rid, [])
        roles.append(item)

    return {
        "itcode": itcode,
        "name": emp.get("name"),
        "email": emp.get("email"),
        "tier1Org": emp.get("tier_1_org"),
        "tier2Org": emp.get("tier_2_org"),
        "roles": roles,
    }


@router.post("/roles", dependencies=[Depends(require_permission("user_authorization", "write"))])
async def assign_role(
    body: dict,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Add a single role to a user. For domain_reviewer, domainCodes is required."""
    itcode = body.get("itcode", "").strip()
    role = body.get("role", "").strip()
    domain_codes = body.get("domainCodes", [])

    if not itcode or not role:
        raise HTTPException(status_code=400, detail="itcode and role are required")

    # Validate role value
    valid_roles = [r.value for r in Role]
    if role not in valid_roles:
        raise HTTPException(status_code=400, detail=f"Invalid role. Must be one of: {', '.join(valid_roles)}")

    # domain_reviewer requires domainCodes
    if role == "domain_reviewer" and not domain_codes:
        raise HTTPException(status_code=400, detail="domainCodes is required for domain_reviewer role")

    # domainCodes only allowed for domain_reviewer
    if role != "domain_reviewer" and domain_codes:
        raise HTTPException(status_code=400, detail="domainCodes is only allowed for domain_reviewer role")

    # Verify employee exists
    emp = (await db.execute(text(
        "SELECT itcode FROM employee_info WHERE itcode = :itcode"
    ), {"itcode": itcode})).mappings().first()
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found in employee_info")

    # Check if this exact (itcode, role) already exists
    existing = (await db.execute(text(
        "SELECT id FROM user_role WHERE itcode = :itcode AND role = :role"
    ), {"itcode": itcode, "role": role})).mappings().first()
    if existing:
        raise HTTPException(status_code=409, detail=f"User {itcode} already has role {role}")

    # Insert role
    row = (await db.execute(text("""
        INSERT INTO user_role (itcode, role, assigned_by, assigned_at, update_by, update_at)
        VALUES (:itcode, :role, :assigned_by, NOW(), :assigned_by, NOW())
        RETURNING *
    """), {
        "itcode": itcode,
        "role": role,
        "assigned_by": user.id,
    })).mappings().first()
    await db.commit()

    role_id = row["id"]

    # Insert domain codes for domain_reviewer
    if role == "domain_reviewer" and domain_codes:
        for dc in domain_codes:
            await db.execute(text("""
                INSERT INTO user_role_domain (user_role_id, domain_code, assigned_by)
                VALUES (:role_id, :dc, :user)
                ON CONFLICT (user_role_id, domain_code) DO NOTHING
            """), {"role_id": role_id, "dc": dc, "user": user.id})
        await db.commit()

    # Audit log
    await db.execute(text("""
        INSERT INTO audit_log (entity_type, entity_id, action, new_value, performed_by)
        VALUES ('user_role', :id, 'assign_role', CAST(:new_val AS jsonb), :user)
    """), {
        "id": role_id,
        "new_val": json.dumps({"itcode": itcode, "role": role, "domainCodes": domain_codes}),
        "user": user.id,
    })
    await db.commit()

    return {
        "id": str(role_id),
        "itcode": itcode,
        "role": role,
        "domainCodes": domain_codes if role == "domain_reviewer" else None,
        "message": f"Role {role} assigned to {itcode}",
    }


@router.put("/roles/{itcode}/{role}", dependencies=[Depends(require_permission("user_authorization", "write"))])
async def update_role_domains(
    itcode: str,
    role: str,
    body: dict,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update domain codes for a domain_reviewer role assignment."""
    if role != "domain_reviewer":
        raise HTTPException(status_code=400, detail="Only domain_reviewer roles can update domain codes")

    domain_codes = body.get("domainCodes", [])
    if not domain_codes:
        raise HTTPException(status_code=400, detail="domainCodes is required")

    # Get current role entry
    current = (await db.execute(text(
        "SELECT id FROM user_role WHERE itcode = :itcode AND role = :role"
    ), {"itcode": itcode, "role": role})).mappings().first()
    if not current:
        raise HTTPException(status_code=404, detail="Role assignment not found")

    role_id = current["id"]

    # Replace domain codes
    await db.execute(text(
        "DELETE FROM user_role_domain WHERE user_role_id = :role_id"
    ), {"role_id": role_id})

    for dc in domain_codes:
        await db.execute(text("""
            INSERT INTO user_role_domain (user_role_id, domain_code, assigned_by)
            VALUES (:role_id, :dc, :user)
            ON CONFLICT (user_role_id, domain_code) DO NOTHING
        """), {"role_id": role_id, "dc": dc, "user": user.id})

    await db.execute(text("""
        UPDATE user_role SET update_by = :user, update_at = NOW()
        WHERE id = :role_id
    """), {"role_id": role_id, "user": user.id})
    await db.commit()

    # Audit log
    await db.execute(text("""
        INSERT INTO audit_log (entity_type, entity_id, action, new_value, performed_by)
        VALUES ('user_role', :id, 'update_role_domains', CAST(:val AS jsonb), :user)
    """), {
        "id": role_id,
        "val": json.dumps({"itcode": itcode, "role": role, "domainCodes": domain_codes}),
        "user": user.id,
    })
    await db.commit()

    return {
        "id": str(role_id),
        "itcode": itcode,
        "role": role,
        "domainCodes": domain_codes,
        "message": f"Domain codes updated for {itcode} domain_reviewer",
    }


@router.delete("/roles/{itcode}/{role}", dependencies=[Depends(require_permission("user_authorization", "write"))])
async def delete_single_role(
    itcode: str,
    role: str,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Remove a specific role from a user. CASCADE deletes user_role_domain."""
    current = (await db.execute(text(
        "SELECT * FROM user_role WHERE itcode = :itcode AND role = :role"
    ), {"itcode": itcode, "role": role})).mappings().first()
    if not current:
        raise HTTPException(status_code=404, detail="Role assignment not found")

    await db.execute(text(
        "DELETE FROM user_role WHERE itcode = :itcode AND role = :role"
    ), {"itcode": itcode, "role": role})
    await db.commit()

    # Audit log
    await db.execute(text("""
        INSERT INTO audit_log (entity_type, entity_id, action, old_value, performed_by)
        VALUES ('user_role', :id, 'delete_role', CAST(:old_val AS jsonb), :user)
    """), {
        "id": current["id"],
        "old_val": json.dumps({"itcode": itcode, "role": role}),
        "user": user.id,
    })
    await db.commit()

    return {"message": f"Role {role} removed from {itcode}"}


@router.delete("/roles/{itcode}", dependencies=[Depends(require_permission("user_authorization", "write"))])
async def delete_all_roles(
    itcode: str,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Remove ALL role assignments for a user (reverts to default requestor)."""
    rows = (await db.execute(text(
        "SELECT * FROM user_role WHERE itcode = :itcode"
    ), {"itcode": itcode})).mappings().all()
    if not rows:
        raise HTTPException(status_code=404, detail="No role assignments found for user")

    await db.execute(text(
        "DELETE FROM user_role WHERE itcode = :itcode"
    ), {"itcode": itcode})
    await db.commit()

    # Audit log
    old_roles = [r["role"] for r in rows]
    await db.execute(text("""
        INSERT INTO audit_log (entity_type, action, old_value, performed_by)
        VALUES ('user_role', 'delete_all_roles', CAST(:old_val AS jsonb), :user)
    """), {
        "old_val": json.dumps({"itcode": itcode, "roles": old_roles}),
        "user": user.id,
    })
    await db.commit()

    return {"message": f"All roles removed for {itcode}"}
