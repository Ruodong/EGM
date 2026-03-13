# Implementation Plan: Database-Driven RBAC Permission System

## Executive Summary

Convert EGM's hardcoded `ROLE_PERMISSIONS` dictionary in `backend/app/auth/rbac.py` into a database-driven permission system. Admins will be able to dynamically configure role permissions through a new Settings UI, eliminating code changes when permissions evolve.

**Estimated effort:** 5-7 development days across 5 phases
**Risk level:** HIGH -- auth is a global dependency; every router in the system depends on it

---

## 1. Impact Analysis

### 1.1 Current Architecture

The RBAC system is centralized in five files under `backend/app/auth/`:

| File | Purpose |
|------|---------|
| `rbac.py` | Hardcoded `ROLE_PERMISSIONS` dict mapping each `Role` to `{resource: [scopes]}`. Contains `check_permission()` and `build_permission_list()`. |
| `models.py` | `Role` enum (5 values: admin, governance_lead, domain_reviewer, requestor, viewer) and `AuthUser` Pydantic model with `permissions: list[str]` cache. |
| `dependencies.py` | FastAPI dependencies: `require_auth`, `require_role(Role.ADMIN)`, `require_permission("resource", "scope")`. These are used as `Depends()` in every router. |
| `providers.py` | `DevAuthProvider` and `KeycloakAuthProvider`. Both call `build_permission_list(role)` to populate `AuthUser.permissions`. Both also call `resolve_role_from_db()` which reads the existing `user_role` table. |
| `middleware.py` | `AuthMiddleware` that calls `provider.authenticate()` and injects `AuthUser` into `request.state`. |

### 1.2 Permission Check Flow (Current)

```
Request --> AuthMiddleware --> Provider.authenticate()
                                   |
                                   v
                          resolve_role_from_db() -> user_role table
                                   |
                                   v
                          build_permission_list(role) -> reads ROLE_PERMISSIONS dict
                                   |
                                   v
                          AuthUser(permissions=[...]) -> request.state.user
                                   |
                                   v
                          Router endpoint with Depends(require_permission("resource", "scope"))
                                   |
                                   v
                          check_permission(user.role, resource, scope) -> reads ROLE_PERMISSIONS dict
```

### 1.3 All Affected Routers (14 total, 13 with auth guards)

Every router uses at least one of `require_permission`, `require_role`, or `require_auth`:

| Router File | Permission Guards Used | Endpoint Count |
|-------------|----------------------|----------------|
| `governance_requests.py` | `require_permission("governance_request", "read/write")` | 8 |
| `intake.py` | `require_permission("intake", "read/write")`, `require_permission("intake_template", "read")`, `require_role(Role.ADMIN)` | 8 |
| `domain_reviews.py` | `require_permission("domain_review", "read/write")` | 6 |
| `dispatcher.py` | `require_permission("governance_request", "write")` | 1 |
| `dispatch_rules.py` | `require_permission("dispatch_rule", "read")`, `require_role(Role.ADMIN)` | 4 |
| `domain_registry.py` | `require_permission("domain_registry", "read")`, `require_role(Role.ADMIN)` | 5 |
| `info_requests.py` | `require_permission("info_supplement_request", "read/write")` | 4 |
| `dashboard.py` | `require_permission("dashboard", "read")` | 2 |
| `progress.py` | `require_permission("progress", "read")` | 1 |
| `audit_log.py` | `require_permission("audit_log", "read")` | 1 |
| `user_authorization.py` | `require_permission("user_authorization", "read")`, `require_role(Role.ADMIN)` | 6 |
| `auth.py` | `get_current_user` (no explicit permission guard) | 3 |
| `projects.py` | `require_permission("governance_request", "read")` | 2 |
| `health.py` | No auth (public path) | 2 |

**Total guarded endpoints: ~51**

### 1.4 Complete Resource-Scope Matrix (Current State from rbac.py)

Extracted from the `ROLE_PERMISSIONS` dictionary:

| Resource | Scopes | Roles That Have Access |
|----------|--------|----------------------|
| `governance_request` | read, write | admin(all), governance_lead(all), domain_reviewer(read), requestor(all), viewer(read) |
| `intake` | read, write | admin(all), governance_lead(all), requestor(all) |
| `intake_template` | read, write | admin(all), governance_lead(all) |
| `domain_registry` | read | admin(all), governance_lead |
| `domain_review` | read, write, assign | admin(all), governance_lead(all), domain_reviewer(read,write), requestor(read), viewer(read) |
| `domain_questionnaire` | read, write | admin(all), governance_lead(all), domain_reviewer(all) |
| `dispatch_rule` | read | admin(all), governance_lead |
| `review_action` | read, write | admin(all), governance_lead(all), domain_reviewer(all), requestor(read), viewer(read) |
| `review_comment` | read, write | admin(all), governance_lead(all), domain_reviewer(all) |
| `shared_artifact` | read, write | admin(all), governance_lead(all), domain_reviewer(all), requestor(read), viewer(read) |
| `info_supplement_request` | read, write | admin(all), governance_lead(all), domain_reviewer(all), requestor(all) |
| `user_authorization` | read | admin(all), governance_lead |
| `progress` | read | admin(all), governance_lead, domain_reviewer, requestor, viewer |
| `dashboard` | read | admin(all), governance_lead, domain_reviewer, requestor, viewer |
| `report` | read | admin(all), governance_lead, domain_reviewer, viewer |
| `audit_log` | read | admin(all), governance_lead |
| `export` | execute | admin(all), governance_lead, domain_reviewer |

**Total: 17 resources, 27 distinct resource-scope pairs, ~60 role-permission grant tuples (including admin's full set).**

### 1.5 Frontend Impact

| File | Impact |
|------|--------|
| `frontend/src/lib/auth-context.tsx` | `hasPermission()` reads `user.permissions` array from `/auth/me`. No change needed -- API response format is unchanged. |
| `frontend/src/lib/api.ts` | No change -- just an HTTP wrapper. |
| `frontend/src/app/(sidebar)/settings/page.tsx` | Add new "Role Permissions" card linking to new admin page. |
| `frontend/src/app/(sidebar)/settings/user-authorization/page.tsx` | No change -- manages user-to-role assignments, not role-to-permission mappings. |
| All other pages | No change -- they consume `hasPermission()` which remains unchanged. |

### 1.6 Test Impact

| Test File | Test Count | Risk Level | Notes |
|-----------|-----------|------------|-------|
| `api-tests/test_rbac.py` | 15 | HIGH | Verifies role-based 403 responses; must produce identical results from DB |
| `api-tests/test_auth.py` | 5 | HIGH | Asserts `"*:*" in data["permissions"]` for admin -- this changes |
| `api-tests/test_governance_requests.py` | ~15 | LOW | Uses admin role by default |
| `api-tests/test_domain_reviews.py` | ~10 | LOW | Uses admin role |
| `api-tests/test_intake.py` | ~10 | LOW | Uses admin role |
| `api-tests/test_dispatch.py` | ~10 | LOW | Uses admin role |
| `api-tests/test_user_authorization.py` | ~8 | LOW | Uses admin role |
| `api-tests/test_domains.py` | ~5 | LOW | Uses admin role |
| `api-tests/test_info_requests.py` | ~5 | LOW | Uses admin role |
| `api-tests/test_dashboard.py` | ~5 | LOW | Uses admin role |
| `api-tests/test_projects.py` | ~3 | LOW | Uses admin role |
| `e2e-tests/role-switcher.spec.ts` | ~3 | MEDIUM | Tests dev role switching |
| All other E2E tests | ~24 total | LOW | Run as admin by default |

---

## 2. Database Schema Design

### 2.1 New Tables

```sql
-- =====================================================
-- Role Definition Table
-- =====================================================
-- Records which roles exist in the system.
-- Replaces the Role enum as the source of truth for available roles.
-- The Python Role enum is KEPT for type safety and Keycloak mapping
-- but is validated against this table.

CREATE TABLE IF NOT EXISTS role_definition (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role_name       VARCHAR(50) NOT NULL UNIQUE,   -- 'admin', 'governance_lead', etc.
    display_name    VARCHAR(100) NOT NULL,          -- 'Admin', 'Governance Lead', etc.
    description     TEXT,
    is_system       BOOLEAN DEFAULT FALSE,          -- TRUE for built-in roles (cannot be deleted)
    is_active       BOOLEAN DEFAULT TRUE,
    sort_order      INT DEFAULT 0,
    create_by       VARCHAR,
    create_at       TIMESTAMP DEFAULT NOW(),
    update_by       VARCHAR,
    update_at       TIMESTAMP DEFAULT NOW()
);

-- =====================================================
-- Permission Definition Table (resource-scope catalog)
-- =====================================================
-- Enumerates all possible resource:scope pairs.
-- Admins can add new permission definitions without code changes.

CREATE TABLE IF NOT EXISTS permission_definition (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resource        VARCHAR(100) NOT NULL,       -- 'governance_request', 'intake', etc.
    scope           VARCHAR(50) NOT NULL,         -- 'read', 'write', 'assign', 'execute'
    display_name    VARCHAR(200),                 -- 'Governance Requests - Read'
    description     TEXT,
    category        VARCHAR(100),                 -- Grouping for UI: 'Governance', 'Domain Review', 'Admin'
    is_active       BOOLEAN DEFAULT TRUE,
    UNIQUE(resource, scope)
);

-- =====================================================
-- Role-Permission Mapping (the core junction table)
-- =====================================================
-- Each row grants one permission to one role.
-- Admin role gets explicit grants for every permission (no more wildcards).

CREATE TABLE IF NOT EXISTS role_permission (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role_name       VARCHAR(50) NOT NULL REFERENCES role_definition(role_name) ON DELETE CASCADE,
    permission_id   UUID NOT NULL REFERENCES permission_definition(id) ON DELETE CASCADE,
    granted_by      VARCHAR,
    granted_at      TIMESTAMP DEFAULT NOW(),
    UNIQUE(role_name, permission_id)
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_role_permission_role
    ON role_permission(role_name);
CREATE INDEX IF NOT EXISTS idx_role_permission_perm
    ON role_permission(permission_id);
CREATE INDEX IF NOT EXISTS idx_permission_def_resource_scope
    ON permission_definition(resource, scope);
```

### 2.2 Design Decisions

1. **`role_name` as VARCHAR FK instead of UUID:** The existing `user_role.role` column stores role names as VARCHAR strings (`'admin'`, `'viewer'`, etc.). Using `role_name` as the FK in `role_permission` keeps backward compatibility with `user_role` and avoids a data migration.

2. **No wildcard in DB:** The admin role currently uses `"*": ["*"]` in the hardcoded dict. In the DB-driven system, admin will have explicit entries for every permission. This is more verbose but eliminates wildcard-matching complexity and makes permission auditing straightforward.

3. **`permission_definition` as a catalog:** All grantable permissions are registered here, even if no router currently enforces them. This lets admins see the full permission landscape and pre-grant permissions for features under development.

4. **Keeping the `Role` Python enum:** The enum remains in `models.py` for type safety in Keycloak role mapping and dev-mode role switching. It becomes a validation source rather than a permission source. In a future phase, the enum could be replaced entirely by DB lookups if custom roles are needed.

5. **No FK from `user_role` to `role_definition`:** Adding this FK would require an `ALTER TABLE` migration on the existing `user_role` table. To minimize risk, we defer this to a follow-up change. The application layer validates role names against `role_definition` at write time.

### 2.3 Seed Data

The migration must populate all three tables with the exact data from `ROLE_PERMISSIONS` so there is zero behavior change at cutover time.

```sql
-- Seed role_definition (matches Python Role enum)
INSERT INTO role_definition (role_name, display_name, description, is_system, sort_order)
VALUES
    ('admin',           'Admin',           'Full system access',                              TRUE, 1),
    ('governance_lead', 'Governance Lead', 'Manages governance requests and review process',  TRUE, 2),
    ('domain_reviewer', 'Domain Reviewer', 'Reviews governance requests for assigned domains', TRUE, 3),
    ('requestor',       'Requestor',       'Creates and submits governance requests',          TRUE, 4),
    ('viewer',          'Viewer',          'Read-only access to governance data',              TRUE, 5)
ON CONFLICT (role_name) DO NOTHING;

-- Seed permission_definition (all 27 resource:scope pairs)
INSERT INTO permission_definition (resource, scope, display_name, category) VALUES
    ('governance_request',       'read',    'Governance Requests - Read',    'Governance'),
    ('governance_request',       'write',   'Governance Requests - Write',   'Governance'),
    ('intake',                   'read',    'Intake - Read',                 'Governance'),
    ('intake',                   'write',   'Intake - Write',                'Governance'),
    ('intake_template',          'read',    'Intake Templates - Read',       'Admin'),
    ('intake_template',          'write',   'Intake Templates - Write',      'Admin'),
    ('domain_registry',          'read',    'Domain Registry - Read',        'Domain Review'),
    ('domain_review',            'read',    'Domain Reviews - Read',         'Domain Review'),
    ('domain_review',            'write',   'Domain Reviews - Write',        'Domain Review'),
    ('domain_review',            'assign',  'Domain Reviews - Assign',       'Domain Review'),
    ('domain_questionnaire',     'read',    'Domain Questionnaires - Read',  'Domain Review'),
    ('domain_questionnaire',     'write',   'Domain Questionnaires - Write', 'Domain Review'),
    ('dispatch_rule',            'read',    'Dispatch Rules - Read',         'Admin'),
    ('review_action',            'read',    'Review Actions - Read',         'Domain Review'),
    ('review_action',            'write',   'Review Actions - Write',        'Domain Review'),
    ('review_comment',           'read',    'Review Comments - Read',        'Domain Review'),
    ('review_comment',           'write',   'Review Comments - Write',       'Domain Review'),
    ('shared_artifact',          'read',    'Shared Artifacts - Read',       'Domain Review'),
    ('shared_artifact',          'write',   'Shared Artifacts - Write',      'Domain Review'),
    ('info_supplement_request',  'read',    'Info Requests - Read',          'Governance'),
    ('info_supplement_request',  'write',   'Info Requests - Write',         'Governance'),
    ('user_authorization',       'read',    'User Authorization - Read',     'Admin'),
    ('progress',                 'read',    'Progress Tracker - Read',       'Governance'),
    ('dashboard',                'read',    'Dashboard - Read',              'Governance'),
    ('report',                   'read',    'Reports - Read',                'Governance'),
    ('audit_log',                'read',    'Audit Log - Read',              'Admin'),
    ('export',                   'execute', 'Export - Execute',              'Governance')
ON CONFLICT (resource, scope) DO NOTHING;

-- Seed role_permission: Admin gets ALL permissions
INSERT INTO role_permission (role_name, permission_id, granted_by)
SELECT 'admin', id, 'system_migration'
FROM permission_definition
ON CONFLICT DO NOTHING;

-- Seed role_permission: Governance Lead
INSERT INTO role_permission (role_name, permission_id, granted_by)
SELECT 'governance_lead', pd.id, 'system_migration'
FROM permission_definition pd
WHERE (pd.resource, pd.scope) IN (
    ('governance_request','read'), ('governance_request','write'),
    ('intake','read'), ('intake','write'),
    ('intake_template','read'), ('intake_template','write'),
    ('domain_registry','read'),
    ('domain_review','read'), ('domain_review','write'), ('domain_review','assign'),
    ('domain_questionnaire','read'), ('domain_questionnaire','write'),
    ('dispatch_rule','read'),
    ('review_action','read'), ('review_action','write'),
    ('review_comment','read'), ('review_comment','write'),
    ('shared_artifact','read'), ('shared_artifact','write'),
    ('info_supplement_request','read'), ('info_supplement_request','write'),
    ('user_authorization','read'),
    ('progress','read'), ('dashboard','read'),
    ('report','read'), ('audit_log','read'),
    ('export','execute')
)
ON CONFLICT DO NOTHING;

-- Seed role_permission: Domain Reviewer
INSERT INTO role_permission (role_name, permission_id, granted_by)
SELECT 'domain_reviewer', pd.id, 'system_migration'
FROM permission_definition pd
WHERE (pd.resource, pd.scope) IN (
    ('governance_request','read'),
    ('intake','read'),
    ('domain_review','read'), ('domain_review','write'),
    ('domain_questionnaire','read'), ('domain_questionnaire','write'),
    ('review_action','read'), ('review_action','write'),
    ('review_comment','read'), ('review_comment','write'),
    ('shared_artifact','read'), ('shared_artifact','write'),
    ('info_supplement_request','read'), ('info_supplement_request','write'),
    ('progress','read'), ('dashboard','read'),
    ('report','read'),
    ('export','execute')
)
ON CONFLICT DO NOTHING;

-- Seed role_permission: Requestor
INSERT INTO role_permission (role_name, permission_id, granted_by)
SELECT 'requestor', pd.id, 'system_migration'
FROM permission_definition pd
WHERE (pd.resource, pd.scope) IN (
    ('governance_request','read'), ('governance_request','write'),
    ('intake','read'), ('intake','write'),
    ('domain_review','read'),
    ('review_action','read'),
    ('shared_artifact','read'),
    ('info_supplement_request','read'), ('info_supplement_request','write'),
    ('progress','read'), ('dashboard','read')
)
ON CONFLICT DO NOTHING;

-- Seed role_permission: Viewer
INSERT INTO role_permission (role_name, permission_id, granted_by)
SELECT 'viewer', pd.id, 'system_migration'
FROM permission_definition pd
WHERE (pd.resource, pd.scope) IN (
    ('governance_request','read'),
    ('intake','read'),
    ('domain_review','read'),
    ('review_action','read'),
    ('shared_artifact','read'),
    ('progress','read'), ('dashboard','read'),
    ('report','read')
)
ON CONFLICT DO NOTHING;
```

---

## 3. Migration Strategy

### 3.1 Migration Script

**File:** `scripts/migration_db_driven_rbac.sql`

The migration is **additive-only** -- it creates new tables and inserts seed data. It does NOT drop, alter, or rename any existing table. This means the old hardcoded system continues to work if the migration runs before the code change.

Execution order:
1. Create `role_definition` table
2. Create `permission_definition` table
3. Create `role_permission` table + indexes
4. Seed all three tables

### 3.2 Zero-Downtime Cutover

The migration and code deployment can happen in either order:

- **Migration first, code later:** New tables exist but nobody reads them. Old code uses `ROLE_PERMISSIONS` dict. No behavior change.
- **Code first, migration later:** New code includes a fallback to the hardcoded dict when DB tables are empty or absent (detailed in Section 4).

**Recommended approach: Migration first, then deploy code.**

### 3.3 Verification Query

Run this after migration to confirm the seed data matches the hardcoded dict exactly:

```sql
-- Count permissions per role from DB
SELECT role_name, count(*) as perm_count
FROM role_permission
GROUP BY role_name
ORDER BY role_name;

-- Expected:
-- admin             27
-- domain_reviewer   18
-- governance_lead   27
-- requestor         11
-- viewer             8
```

---

## 4. Backend Changes

### 4.1 Modify `backend/app/auth/rbac.py` -- DB-Driven Permission Lookup

This is the core change. Replace the static `ROLE_PERMISSIONS` dict with:
1. An async function that queries the DB
2. An in-memory cache with 60-second TTL
3. A synchronous fallback to the hardcoded dict when cache is empty

**Key implementation details:**

```python
"""RBAC permission system for EGM -- database-driven with in-memory cache."""
from __future__ import annotations

import logging
import time
from sqlalchemy import text
from app.auth.models import Role

logger = logging.getLogger("egm.auth.rbac")

# -----------------------------------------------------------------------
# In-memory cache
# -----------------------------------------------------------------------
_cache: dict[str, set[tuple[str, str]]] = {}   # role_name -> {(resource, scope)}
_cache_ts: float = 0.0
_CACHE_TTL: int = 60  # seconds

# -----------------------------------------------------------------------
# Hardcoded fallback (exact copy of current ROLE_PERMISSIONS)
# Used ONLY when DB has no data (e.g., first boot before migration)
# -----------------------------------------------------------------------
_FALLBACK_PERMISSIONS: dict[Role, dict[str, list[str]]] = {
    Role.ADMIN: {"*": ["*"]},
    Role.GOVERNANCE_LEAD: {
        "governance_request": ["read", "write"],
        # ... (exact copy of current dict) ...
    },
    # ... all roles ...
}


async def _load_from_db() -> dict[str, set[tuple[str, str]]]:
    """Query role_permission + permission_definition tables."""
    from app.database import AsyncSessionLocal
    result: dict[str, set[tuple[str, str]]] = {}
    try:
        async with AsyncSessionLocal() as session:
            rows = (await session.execute(text("""
                SELECT rp.role_name, pd.resource, pd.scope
                FROM role_permission rp
                JOIN permission_definition pd ON pd.id = rp.permission_id
                WHERE pd.is_active = true
            """))).mappings().all()
            for row in rows:
                role = row["role_name"]
                result.setdefault(role, set()).add((row["resource"], row["scope"]))
    except Exception as exc:
        logger.warning("DB permission load failed: %s", exc)
    return result


async def refresh_cache() -> None:
    """Force-refresh the permission cache."""
    global _cache, _cache_ts
    loaded = await _load_from_db()
    if loaded:
        _cache = loaded
        _cache_ts = time.monotonic()
        logger.info("RBAC cache refreshed: %d roles", len(_cache))


async def _ensure_cache() -> None:
    """Populate/refresh cache if stale."""
    if _cache and (time.monotonic() - _cache_ts) < _CACHE_TTL:
        return
    await refresh_cache()


# -----------------------------------------------------------------------
# Async permission check (used by dependencies.py)
# -----------------------------------------------------------------------

async def check_permission_async(role_name: str, resource: str, scope: str) -> bool:
    """Check if role has permission. Uses DB cache, falls back to hardcoded dict."""
    await _ensure_cache()
    role_perms = _cache.get(role_name)
    if role_perms is not None:
        return (resource, scope) in role_perms
    # Fallback for unknown roles or empty cache
    return _check_fallback(role_name, resource, scope)


async def build_permission_list_async(role_name: str) -> list[str]:
    """Build flat permission list from DB cache."""
    await _ensure_cache()
    role_perms = _cache.get(role_name)
    if role_perms is not None:
        return sorted(f"{r}:{s}" for r, s in role_perms)
    # Fallback
    return _build_fallback_list(role_name)


# -----------------------------------------------------------------------
# Synchronous wrappers (backward compatibility)
# -----------------------------------------------------------------------

def check_permission(role: Role, resource: str, scope: str) -> bool:
    """Sync check -- uses cache if available, else hardcoded dict."""
    if _cache:
        role_perms = _cache.get(role.value, set())
        return (resource, scope) in role_perms
    return _check_fallback(role.value, resource, scope)


def build_permission_list(role: Role) -> list[str]:
    """Sync list -- uses cache if available, else hardcoded dict."""
    if _cache:
        role_perms = _cache.get(role.value, set())
        return sorted(f"{r}:{s}" for r, s in role_perms)
    return _build_fallback_list(role.value)


# -----------------------------------------------------------------------
# Fallback helpers
# -----------------------------------------------------------------------

def _check_fallback(role_name: str, resource: str, scope: str) -> bool:
    try:
        role = Role(role_name)
    except ValueError:
        return False
    perms = _FALLBACK_PERMISSIONS.get(role, {})
    if "*" in perms and ("*" in perms["*"] or scope in perms["*"]):
        return True
    return scope in perms.get(resource, []) or "*" in perms.get(resource, [])


def _build_fallback_list(role_name: str) -> list[str]:
    try:
        role = Role(role_name)
    except ValueError:
        return []
    perms = _FALLBACK_PERMISSIONS.get(role, {})
    return [f"{r}:{s}" for r, scopes in perms.items() for s in scopes]
```

### 4.2 Modify `backend/app/auth/dependencies.py`

Update `require_permission` to use the async DB-driven check:

```python
from app.auth.rbac import check_permission_async

def require_permission(resource: str, scope: str = "read") -> Callable:
    async def _check(user: AuthUser = Depends(get_current_user)) -> AuthUser:
        allowed = await check_permission_async(user.role.value, resource, scope)
        if not allowed:
            raise HTTPException(status_code=403, detail=f"No permission: {resource}:{scope}")
        return user
    return _check
```

The `require_role` and `require_auth` functions remain unchanged. The `require_role` function is still needed for endpoints that enforce role identity (e.g., only admin can create domains) rather than permission grants.

### 4.3 Modify `backend/app/auth/providers.py`

Both providers call `build_permission_list(role)` to populate `AuthUser.permissions`. Update to async:

```python
from app.auth.rbac import build_permission_list_async

# In DevAuthProvider.authenticate():
permissions = await build_permission_list_async(role.value)

# In KeycloakAuthProvider.authenticate():
permissions = await build_permission_list_async(role.value)
```

### 4.4 Add Cache Invalidation Endpoint

**In `backend/app/routers/auth.py`:**

```python
from app.auth.rbac import refresh_cache

@router.post("/refresh-permissions", dependencies=[Depends(require_role(Role.ADMIN))])
async def refresh_permissions_cache():
    """Force-refresh the RBAC permission cache after admin changes."""
    await refresh_cache()
    return {"message": "Permission cache refreshed"}
```

### 4.5 New Router: `backend/app/routers/role_permissions.py`

Full CRUD API for managing roles and their permissions:

```
GET    /role-permissions/roles                       -- List all role definitions with permission counts
GET    /role-permissions/roles/{role_name}            -- Get single role with full permission list
PUT    /role-permissions/roles/{role_name}            -- Update role display_name/description

GET    /role-permissions/permissions                  -- List all permission definitions, grouped by category
POST   /role-permissions/permissions                  -- Create new permission definition (resource + scope)
PUT    /role-permissions/permissions/{id}             -- Update permission display_name/category
DELETE /role-permissions/permissions/{id}             -- Soft-delete (is_active=false)

GET    /role-permissions/roles/{role_name}/permissions     -- List permissions granted to a role
PUT    /role-permissions/roles/{role_name}/permissions     -- Bulk-replace all permissions for a role
POST   /role-permissions/roles/{role_name}/permissions     -- Add single permission to role
DELETE /role-permissions/roles/{role_name}/permissions/{perm_id}  -- Remove single permission from role
```

**All endpoints require `require_role(Role.ADMIN)`.**

**The bulk-replace endpoint** (`PUT /roles/{name}/permissions`) is the primary mutation for the admin UI:
```json
// Request body:
{ "permissionIds": ["uuid-1", "uuid-2", "uuid-3"] }
```

This endpoint:
1. Deletes all existing `role_permission` rows for the given role
2. Inserts new rows for each provided permission ID
3. Writes an audit log entry with old and new permission sets
4. Calls `await refresh_cache()` to invalidate the in-memory cache

### 4.6 Register Router and Add Startup Warming in `main.py`

```python
from app.routers import role_permissions

app.include_router(
    role_permissions.router,
    prefix="/api/role-permissions",
    tags=["Role Permissions"],
)

@app.on_event("startup")
async def warmup_rbac_cache():
    from app.auth.rbac import refresh_cache
    await refresh_cache()
```

### 4.7 No Changes to Existing Router Files

**This is a critical property of the design.** None of the 13 existing router files need modification. They continue to use the exact same dependency injection pattern:

```python
@router.get("", dependencies=[Depends(require_permission("governance_request", "read"))])
```

The change is entirely behind the interface -- `require_permission` now checks the DB cache instead of the hardcoded dict.

Similarly, `require_role(Role.ADMIN)` still works because the `Role` enum remains, and roles are still assigned via the `user_role` table.

---

## 5. Frontend Changes

### 5.1 New Page: Role Permissions Management

**File:** `frontend/src/app/(sidebar)/settings/role-permissions/page.tsx`

**UI Design:**
- **Left panel:** List of roles (admin, governance_lead, etc.) as selectable cards, each showing permission count
- **Main panel:** Permission matrix for the selected role
  - Permissions grouped by category (Governance, Domain Review, Admin)
  - Each permission is a checkbox with display name
  - Check/uncheck to grant/revoke
- **Action bar:** "Save Changes" button, "Reset to Default" button
- System roles (`is_system=true`) show a warning badge but permissions are still editable
- Unsaved changes show a yellow indicator

**Key interactions:**
1. Select a role from the left panel
2. Load its current permissions via `GET /role-permissions/roles/{name}/permissions`
3. Load all available permissions via `GET /role-permissions/permissions`
4. Render checkboxes -- checked = granted, unchecked = not granted
5. On Save: call `PUT /role-permissions/roles/{name}/permissions` with the checked permission IDs
6. After save: call `POST /auth/refresh-permissions` to invalidate server cache
7. Show success toast

### 5.2 Update Settings Index Page

**File:** `frontend/src/app/(sidebar)/settings/page.tsx`

Add new card:
```typescript
{
  label: 'Role Permissions',
  href: '/settings/role-permissions',
  description: 'Configure which permissions each role has access to'
}
```

### 5.3 TypeScript Types

```typescript
interface RoleDefinition {
  id: string;
  roleName: string;
  displayName: string;
  description: string | null;
  isSystem: boolean;
  isActive: boolean;
  sortOrder: number;
  permissionCount: number;
}

interface PermissionDefinition {
  id: string;
  resource: string;
  scope: string;
  displayName: string | null;
  description: string | null;
  category: string | null;
  isActive: boolean;
}

interface RolePermissionGrant {
  id: string;
  roleName: string;
  permissionId: string;
  grantedBy: string | null;
  grantedAt: string | null;
}
```

### 5.4 No Changes to Auth Context

The `AuthProvider` in `auth-context.tsx` reads permissions from the `/auth/me` response:
```json
{ "id": "...", "role": "admin", "permissions": ["governance_request:read", ...] }
```

This response format is unchanged. The backend still returns a flat list of `"resource:scope"` strings -- the only difference is the source (DB instead of dict). The `hasPermission()` function continues to work without modification.

---

## 6. Testing Strategy

### 6.1 New API Tests

**File: `api-tests/test_role_permissions.py`** (~14 tests)

```
test_list_roles_returns_all_five              -- GET /role-permissions/roles
test_get_role_with_permission_count           -- GET /role-permissions/roles/admin
test_list_all_permissions                      -- GET /role-permissions/permissions, assert 27 entries
test_permissions_grouped_by_category           -- Categories: Governance, Domain Review, Admin
test_get_role_permissions_for_viewer           -- GET /role-permissions/roles/viewer/permissions, assert 8
test_bulk_update_permissions_succeeds          -- PUT /role-permissions/roles/viewer/permissions
test_bulk_update_invalidates_cache             -- After PUT, role immediately gains/loses access
test_add_single_permission_to_role             -- POST /role-permissions/roles/viewer/permissions
test_remove_single_permission_from_role        -- DELETE /role-permissions/roles/viewer/permissions/{id}
test_permission_change_affects_endpoint_access -- Add governance_request:write to viewer, verify 200
test_permission_removal_blocks_endpoint        -- Remove governance_request:read from viewer, verify 403
test_non_admin_cannot_manage_permissions       -- governance_lead gets 403 on all write endpoints
test_create_new_permission_definition          -- POST /role-permissions/permissions
test_refresh_cache_endpoint                    -- POST /auth/refresh-permissions, admin only
```

**File: `api-tests/test_rbac_db_driven.py`** (~15 tests)

Replicate every test from `test_rbac.py` to verify identical behavior under DB-driven RBAC:

```
test_requestor_can_create_request_db          -- Same logic as existing test
test_requestor_can_list_requests_db           -- ...
test_requestor_cannot_create_domain_db        -- Must still get 403
test_requestor_cannot_create_dispatch_rule_db -- Must still get 403
test_requestor_cannot_create_template_db      -- Must still get 403
test_reviewer_can_list_reviews_db             -- ...
test_reviewer_cannot_create_request_db        -- Must still get 403
test_reviewer_cannot_create_domain_db         -- Must still get 403
test_viewer_can_read_requests_db              -- ...
test_viewer_cannot_create_request_db          -- Must still get 403
test_viewer_cannot_search_employees_db        -- Must still get 403
test_requestor_cannot_read_user_auth_db       -- Must still get 403
test_governance_lead_can_read_user_auth_db    -- Must still get 200
test_governance_lead_cannot_assign_role_db    -- Must still get 403
test_viewer_cannot_deactivate_domain_db       -- Must still get 403
```

### 6.2 Modified Existing Tests

**`api-tests/test_auth.py`** -- One assertion change:

```python
# BEFORE (line 13):
assert "*:*" in data["permissions"]

# AFTER:
assert "governance_request:read" in data["permissions"]
assert "governance_request:write" in data["permissions"]
assert len(data["permissions"]) == 27  # admin has all permissions
```

This is the ONLY existing test file that needs modification.

### 6.3 E2E Test Additions

**In `e2e-tests/settings.spec.ts`** -- add new tests:

```typescript
test('role permissions page loads', async ({ page }) => {
  await page.goto('/settings/role-permissions');
  await expect(page.getByRole('heading', { name: /Role Permissions/i })).toBeVisible();
});

test('role permissions page shows roles list', async ({ page }) => {
  await page.goto('/settings/role-permissions');
  await expect(page.getByText('Admin')).toBeVisible();
  await expect(page.getByText('Viewer')).toBeVisible();
});
```

### 6.4 Regression Test Execution

After each phase, run the full suite:
```bash
python3 -m pytest api-tests/ -v --tb=short     # 86+ API tests
npx playwright test --reporter=list              # 24+ E2E tests
```

### 6.5 Test Map Updates

Add to `scripts/test-map.json`:
```json
"backend/app/routers/role_permissions.py": {
    "api": ["api-tests/test_role_permissions.py"],
    "e2e": []
},
"backend/app/auth/rbac.py": {
    "api": ["api-tests/test_auth.py", "api-tests/test_rbac.py", "api-tests/test_role_permissions.py"],
    "e2e": []
},
"frontend/src/app/(sidebar)/settings/role-permissions/": {
    "api": [],
    "e2e": ["e2e-tests/settings.spec.ts"]
}
```

---

## 7. Rollback Plan

### 7.1 Immediate Code Rollback

The new `rbac.py` contains a full `_FALLBACK_PERMISSIONS` dict identical to the current hardcoded data. Rolling back is:

1. Revert changes to `rbac.py`, `dependencies.py`, `providers.py`, `__init__.py`
2. Remove `role_permissions.py` router
3. Revert `main.py` to remove the new router and startup event
4. Revert `auth.py` to remove the `/refresh-permissions` endpoint

The new DB tables can remain -- they have no FKs to existing tables and are unused by old code.

### 7.2 Database Rollback

If table cleanup is desired:
```sql
DROP TABLE IF EXISTS role_permission;
DROP TABLE IF EXISTS permission_definition;
DROP TABLE IF EXISTS role_definition;
```

These tables have no dependencies from existing tables.

### 7.3 Feature Flag (Optional Extra Safety)

Add to `backend/app/config.py`:
```python
RBAC_DB_DRIVEN: bool = True  # Set to False to revert to hardcoded RBAC
```

Then in `rbac.py`, the async check would honor this flag:
```python
async def check_permission_async(role_name, resource, scope):
    if not settings.RBAC_DB_DRIVEN:
        return _check_fallback(role_name, resource, scope)
    await _ensure_cache()
    # ... DB-driven check ...
```

This allows deploying the code but keeping old behavior until the flag is flipped. The flag can be controlled via environment variable `RBAC_DB_DRIVEN=false`.

---

## 8. Phased Implementation Approach

### Phase 1: Database Schema + Migration (Day 1)

**Goal:** New tables exist, seeded with current permissions. Zero runtime behavior change.

**Tasks:**
- [ ] Create `scripts/migration_db_driven_rbac.sql` with CREATE TABLE + seed data
- [ ] Update `scripts/schema.sql` to include new table definitions
- [ ] Run migration against dev database
- [ ] Verify seed data correctness with verification query (Section 3.3)
- [ ] Verify existing tests still pass (sanity check -- nothing should change)

**Verification checkpoint:**
```bash
# DB verification
psql -h localhost -p 5433 -U postgres -d egm_local -c "
  SELECT role_name, count(*) FROM egm.role_permission GROUP BY role_name ORDER BY role_name;
"
# Expected: admin=27, domain_reviewer=18, governance_lead=27, requestor=11, viewer=8

# Code verification (no changes yet, existing tests must pass)
python3 -m pytest api-tests/test_auth.py api-tests/test_rbac.py -v --tb=short
```

### Phase 2: Backend Core -- DB-Driven Auth (Day 2-3)

**Goal:** Auth system reads permissions from DB with cache. Fallback to hardcoded dict if DB is empty.

**Tasks:**
- [ ] Rewrite `backend/app/auth/rbac.py` (async load, cache, fallback)
- [ ] Update `backend/app/auth/dependencies.py` (use `check_permission_async`)
- [ ] Update `backend/app/auth/providers.py` (use `build_permission_list_async`)
- [ ] Update `backend/app/auth/__init__.py` (export new async functions)
- [ ] Add startup cache warming in `backend/app/main.py`
- [ ] Optionally add `RBAC_DB_DRIVEN` feature flag to `backend/app/config.py`
- [ ] Fix `api-tests/test_auth.py` -- change `*:*` assertion to explicit permissions
- [ ] Run full API test suite

**Verification checkpoint:**
```bash
python3 -m pytest api-tests/ -v --tb=short   # All 86+ tests must pass
```

### Phase 3: Admin API + Cache Invalidation (Day 3-4)

**Goal:** Admin can read and modify permissions via REST API.

**Tasks:**
- [ ] Create `backend/app/routers/role_permissions.py` (full CRUD, ~10 endpoints)
- [ ] Add `POST /auth/refresh-permissions` endpoint in `auth.py`
- [ ] Register new router in `main.py`
- [ ] Write `api-tests/test_role_permissions.py` (~14 tests)
- [ ] Write `api-tests/test_rbac_db_driven.py` (~15 regression tests)
- [ ] Update `scripts/test-map.json`
- [ ] Add audit log entries for permission mutations

**Verification checkpoint:**
```bash
python3 -m pytest api-tests/ -v --tb=short   # All tests including new ones
```

### Phase 4: Frontend UI (Day 5-6)

**Goal:** Admin can manage permissions through the Settings UI.

**Tasks:**
- [ ] Create `frontend/src/app/(sidebar)/settings/role-permissions/page.tsx`
- [ ] Update `frontend/src/app/(sidebar)/settings/page.tsx` (add new card)
- [ ] Add E2E tests in `e2e-tests/settings.spec.ts`
- [ ] Update `scripts/test-map.json` for frontend paths

**Verification checkpoint:**
```bash
npx playwright test --reporter=list     # All E2E tests
python3 -m pytest api-tests/ -v         # Full API regression
```

### Phase 5: Cleanup + Documentation (Day 7)

**Goal:** Remove temporary scaffolding, document the new system.

**Tasks:**
- [ ] Remove feature flag if used (make DB-driven the permanent path)
- [ ] Decide whether to keep or remove `_FALLBACK_PERMISSIONS`
- [ ] Create feature doc `docs/features/role-permissions.md`
- [ ] Update `docs/features/_DEPENDENCIES.json` with new feature and edges
- [ ] Full test suite regression (API + E2E)
- [ ] Manual smoke test across all roles
- [ ] Update this plan with final status

---

## 9. Risk Mitigation

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Seed data doesn't match hardcoded dict | Medium | HIGH -- silent permission changes | Verification query in Phase 1; automated comparison test |
| DB connection failure blocks all auth | Low | CRITICAL -- all requests fail | Fallback to hardcoded dict when cache is empty and DB unreachable |
| Cache staleness after admin change | Medium | LOW -- max 60s delay | Explicit `refresh_cache()` call after every mutation; admin UI calls refresh endpoint |
| Performance regression from DB lookups | Very Low | MEDIUM -- adds latency | In-memory cache (60s TTL) means only 1 DB query per minute |
| Existing `test_auth.py` `*:*` assertion fails | Certain | LOW -- known fix | Admin now has explicit permissions; update assertion in Phase 2 |
| Frontend auth context breaks | Very Low | HIGH -- UI unusable | API response format is unchanged; `hasPermission()` logic unchanged |
| `require_role(Role.ADMIN)` stops working | None | HIGH | `Role` enum is unchanged; `require_role` checks `user.role`, not permissions |
| Race condition in cache refresh | Low | LOW -- stale data for 1 request | Cache is replaced atomically (dict assignment); worst case is one request sees stale data |

---

## 10. Files Changed Summary

### New Files (6)

| File | Purpose |
|------|---------|
| `scripts/migration_db_driven_rbac.sql` | Schema migration + seed data for 3 new tables |
| `backend/app/routers/role_permissions.py` | Admin CRUD API for role-permission management (~10 endpoints) |
| `api-tests/test_role_permissions.py` | API tests for new admin endpoints (~14 tests) |
| `api-tests/test_rbac_db_driven.py` | Regression tests confirming DB-driven RBAC matches old behavior (~15 tests) |
| `frontend/src/app/(sidebar)/settings/role-permissions/page.tsx` | Admin UI: role-permission matrix editor |
| `docs/features/role-permissions.md` | Feature specification document |

### Modified Files (12)

| File | Change Description |
|------|-------------------|
| `backend/app/auth/rbac.py` | Replace hardcoded dict with async DB query + in-memory cache + fallback |
| `backend/app/auth/dependencies.py` | `require_permission` uses `check_permission_async` instead of sync `_check_permission` |
| `backend/app/auth/providers.py` | Both providers use `build_permission_list_async` instead of sync `build_permission_list` |
| `backend/app/auth/__init__.py` | Export new async functions (`check_permission_async`, `build_permission_list_async`, `refresh_cache`) |
| `backend/app/main.py` | Register `role_permissions` router; add startup cache warming event |
| `backend/app/config.py` | (Optional) Add `RBAC_DB_DRIVEN` feature flag |
| `backend/app/routers/auth.py` | Add `POST /refresh-permissions` endpoint |
| `api-tests/test_auth.py` | Change admin permission assertion from `"*:*"` to explicit permission checks |
| `scripts/schema.sql` | Add `role_definition`, `permission_definition`, `role_permission` table definitions |
| `scripts/test-map.json` | Add mappings for new source and test files |
| `docs/features/_DEPENDENCIES.json` | Add `role-permissions` feature with dependency edges |
| `frontend/src/app/(sidebar)/settings/page.tsx` | Add "Role Permissions" settings card |

### Unchanged Files (verified)

- **All 13 existing router files** -- `governance_requests.py`, `intake.py`, `domain_reviews.py`, `dispatcher.py`, `dispatch_rules.py`, `domain_registry.py`, `info_requests.py`, `dashboard.py`, `progress.py`, `audit_log.py`, `user_authorization.py`, `projects.py`, `health.py`
- `backend/app/auth/middleware.py` -- no changes needed
- `backend/app/auth/models.py` -- `Role` enum and `AuthUser` model unchanged
- `frontend/src/lib/auth-context.tsx` -- API response format unchanged
- `frontend/src/lib/api.ts` -- HTTP wrapper unchanged
- `frontend/src/app/(sidebar)/settings/user-authorization/page.tsx` -- manages user-role, not role-permission
- All existing API test files except `test_auth.py`
- All existing E2E test files (new tests added to `settings.spec.ts`, no existing tests modified)

---

## 11. Dependency Graph Update

### Add to `features` in `_DEPENDENCIES.json`:

```json
"role-permissions": {
    "doc": "docs/features/role-permissions.md",
    "tables": ["role_definition", "permission_definition", "role_permission"],
    "routers": ["role_permissions.py"],
    "frontendPaths": [
        "frontend/src/app/(sidebar)/settings/role-permissions/"
    ]
}
```

### Add new edges:

```json
{
    "from": "role-permissions",
    "to": "auth",
    "type": "data_write",
    "detail": "role_permission table is read by auth middleware RBAC cache to enforce permissions on every request"
}
```

### Update `sharedTables`:

```json
"role_permission": ["role-permissions", "auth"]
```

---

## 12. Success Criteria

1. **All 86+ existing API tests pass** without modification (except the one `*:*` assertion in `test_auth.py`)
2. **All 24+ existing E2E tests pass** without modification
3. **New `test_role_permissions.py`** has 14+ passing tests covering full CRUD and cache behavior
4. **New `test_rbac_db_driven.py`** replicates all 15 existing RBAC tests and passes identically
5. **Admin can create a new permission definition** via Settings UI without any code deploy
6. **Admin can grant/revoke permissions** for any role and the change takes effect within one request (via explicit cache refresh)
7. **No code changes** are needed in any existing router when permission requirements change
8. **System falls back gracefully** to hardcoded permissions if new DB tables are empty
9. **Permission check latency** remains under 1ms (in-memory cache hit path)
10. **Full test suite** runs clean after all 5 phases complete
