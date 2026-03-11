"""User Authorization router — search employees and manage role assignments."""
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


def _map_role(r: dict) -> dict:
    return {
        "id": str(r["id"]),
        "itcode": r["itcode"],
        "role": r["role"],
        "name": r.get("name"),
        "email": r.get("email"),
        "tier1Org": r.get("tier_1_org"),
        "tier2Org": r.get("tier_2_org"),
        "assignedBy": r.get("assigned_by"),
        "assignedAt": r["assigned_at"].isoformat() if r.get("assigned_at") else None,
        "updateBy": r.get("update_by"),
        "updateAt": r["update_at"].isoformat() if r.get("update_at") else None,
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


# ── Role CRUD ────────────────────────────────────────────────────

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
    """List all user role assignments with employee info."""
    offset = (page - 1) * pageSize

    where = ""
    params: dict = {"limit": pageSize, "offset": offset}
    if search.strip():
        where = "WHERE (e.itcode ILIKE :q OR e.name ILIKE :q)"
        params["q"] = f"%{search.strip()}%"

    # Count
    count_row = (await db.execute(text(f"""
        SELECT COUNT(*) AS cnt
        FROM user_role ur JOIN employee_info e ON ur.itcode = e.itcode
        {where}
    """), params)).mappings().first()
    total = count_row["cnt"] if count_row else 0

    # Data
    rows = (await db.execute(text(f"""
        SELECT ur.*, e.name, e.email, e.tier_1_org, e.tier_2_org
        FROM user_role ur
        JOIN employee_info e ON ur.itcode = e.itcode
        {where}
        ORDER BY ur.assigned_at DESC
        LIMIT :limit OFFSET :offset
    """), params)).mappings().all()

    return {
        "data": [_map_role(dict(r)) for r in rows],
        "total": total,
        "page": page,
        "pageSize": pageSize,
    }


@router.get(
    "/roles/{itcode}",
    dependencies=[Depends(require_permission("user_authorization", "read"))],
)
async def get_role(itcode: str, db: AsyncSession = Depends(get_db)):
    """Get a single user role assignment."""
    row = (await db.execute(text("""
        SELECT ur.*, e.name, e.email, e.tier_1_org, e.tier_2_org
        FROM user_role ur
        JOIN employee_info e ON ur.itcode = e.itcode
        WHERE ur.itcode = :itcode
    """), {"itcode": itcode})).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Role assignment not found")
    return _map_role(dict(row))


@router.post("/roles", dependencies=[Depends(require_role(Role.ADMIN))])
async def assign_role(
    body: dict,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Assign or update a role for a user. Upsert on itcode."""
    itcode = body.get("itcode", "").strip()
    role = body.get("role", "").strip()

    if not itcode or not role:
        raise HTTPException(status_code=400, detail="itcode and role are required")

    # Validate role value
    valid_roles = [r.value for r in Role]
    if role not in valid_roles:
        raise HTTPException(status_code=400, detail=f"Invalid role. Must be one of: {', '.join(valid_roles)}")

    # Verify employee exists
    emp = (await db.execute(text(
        "SELECT itcode FROM employee_info WHERE itcode = :itcode"
    ), {"itcode": itcode})).mappings().first()
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found in employee_info")

    # Upsert
    row = (await db.execute(text("""
        INSERT INTO user_role (itcode, role, assigned_by, assigned_at, update_by, update_at)
        VALUES (:itcode, :role, :assigned_by, NOW(), :assigned_by, NOW())
        ON CONFLICT (itcode) DO UPDATE SET
            role = EXCLUDED.role,
            update_by = EXCLUDED.update_by,
            update_at = NOW()
        RETURNING *
    """), {
        "itcode": itcode,
        "role": role,
        "assigned_by": user.id,
    })).mappings().first()
    await db.commit()

    # Audit log
    await db.execute(text("""
        INSERT INTO audit_log (entity_type, entity_id, action, new_value, performed_by)
        VALUES ('user_role', :id, 'assign_role', CAST(:new_val AS jsonb), :user)
    """), {
        "id": row["id"],
        "new_val": json.dumps({"itcode": itcode, "role": role}),
        "user": user.id,
    })
    await db.commit()

    # Return with employee info
    full_row = (await db.execute(text("""
        SELECT ur.*, e.name, e.email, e.tier_1_org, e.tier_2_org
        FROM user_role ur
        JOIN employee_info e ON ur.itcode = e.itcode
        WHERE ur.itcode = :itcode
    """), {"itcode": itcode})).mappings().first()

    return _map_role(dict(full_row))


@router.put("/roles/{itcode}", dependencies=[Depends(require_role(Role.ADMIN))])
async def update_role(
    itcode: str,
    body: dict,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update an existing role assignment."""
    role = body.get("role", "").strip()
    if not role:
        raise HTTPException(status_code=400, detail="role is required")

    valid_roles = [r.value for r in Role]
    if role not in valid_roles:
        raise HTTPException(status_code=400, detail=f"Invalid role. Must be one of: {', '.join(valid_roles)}")

    # Get current
    current = (await db.execute(text(
        "SELECT * FROM user_role WHERE itcode = :itcode"
    ), {"itcode": itcode})).mappings().first()
    if not current:
        raise HTTPException(status_code=404, detail="Role assignment not found")

    old_role = current["role"]

    row = (await db.execute(text("""
        UPDATE user_role SET role = :role, update_by = :user, update_at = NOW()
        WHERE itcode = :itcode RETURNING *
    """), {"itcode": itcode, "role": role, "user": user.id})).mappings().first()
    await db.commit()

    # Audit log
    await db.execute(text("""
        INSERT INTO audit_log (entity_type, entity_id, action, old_value, new_value, performed_by)
        VALUES ('user_role', :id, 'update_role', CAST(:old_val AS jsonb), CAST(:new_val AS jsonb), :user)
    """), {
        "id": row["id"],
        "old_val": json.dumps({"itcode": itcode, "role": old_role}),
        "new_val": json.dumps({"itcode": itcode, "role": role}),
        "user": user.id,
    })
    await db.commit()

    full_row = (await db.execute(text("""
        SELECT ur.*, e.name, e.email, e.tier_1_org, e.tier_2_org
        FROM user_role ur
        JOIN employee_info e ON ur.itcode = e.itcode
        WHERE ur.itcode = :itcode
    """), {"itcode": itcode})).mappings().first()

    return _map_role(dict(full_row))


@router.delete("/roles/{itcode}", dependencies=[Depends(require_role(Role.ADMIN))])
async def delete_role(
    itcode: str,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Remove a user's role assignment (reverts to default viewer)."""
    current = (await db.execute(text(
        "SELECT * FROM user_role WHERE itcode = :itcode"
    ), {"itcode": itcode})).mappings().first()
    if not current:
        raise HTTPException(status_code=404, detail="Role assignment not found")

    await db.execute(text(
        "DELETE FROM user_role WHERE itcode = :itcode"
    ), {"itcode": itcode})
    await db.commit()

    # Audit log
    await db.execute(text("""
        INSERT INTO audit_log (entity_type, entity_id, action, old_value, performed_by)
        VALUES ('user_role', :id, 'delete_role', CAST(:old_val AS jsonb), :user)
    """), {
        "id": current["id"],
        "old_val": json.dumps({"itcode": itcode, "role": current["role"]}),
        "user": user.id,
    })
    await db.commit()

    return {"message": f"Role removed for {itcode}"}
