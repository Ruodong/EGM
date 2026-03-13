# Plan: Database-Driven RBAC Permission System

**Task**: Migrate the existing hardcoded role-permission mapping (`ROLE_PERMISSIONS` dict in `backend/app/auth/rbac.py`) to a database-driven permission system. Admins should be able to dynamically configure permissions per role via a Settings UI, eliminating the need for code changes when adding new permissions.

---

## Phase 1: Impact Assessment

### Step 1.0 -- Understand & Explore

**What is being changed**: The entire RBAC permission resolution system. Currently, `backend/app/auth/rbac.py` defines a hardcoded Python dictionary `ROLE_PERMISSIONS` that maps each `Role` enum value to a `dict[str, list[str]]` of resource-scope pairs. Every API request flows through `require_permission()` or `require_role()` dependencies, which call `check_permission()` against this static dict. The `build_permission_list()` function is called during authentication (in `providers.py`) to populate the `AuthUser.permissions` flat list, which is sent to the frontend via `/api/auth/me`.

**Current architecture** (files explored):

| File | Role in Current System |
|------|----------------------|
| `backend/app/auth/rbac.py` | Hardcoded `ROLE_PERMISSIONS` dict; `check_permission()` and `build_permission_list()` functions |
| `backend/app/auth/dependencies.py` | `require_permission()` and `require_role()` FastAPI dependency factories; call `_check_permission()` from rbac.py |
| `backend/app/auth/models.py` | `Role` enum (5 values: admin, governance_lead, domain_reviewer, requestor, viewer); `AuthUser` Pydantic model with `permissions: list[str]` field |
| `backend/app/auth/providers.py` | `DevAuthProvider` and `KeycloakAuthProvider` both call `build_permission_list(role)` to populate `AuthUser.permissions` on every request |
| `backend/app/auth/middleware.py` | `AuthMiddleware` calls provider.authenticate(), which sets `request.state.user` |
| `backend/app/auth/__init__.py` | Re-exports: `AuthUser`, `Role`, `check_permission`, `get_current_user`, `require_auth`, `require_role`, `require_permission` |
| `backend/app/routers/auth.py` | `/api/auth/me` and `/api/auth/permissions` endpoints return `user.permissions` list to frontend |
| `frontend/src/lib/auth-context.tsx` | `AuthProvider` fetches `/api/auth/me`, stores `permissions: string[]`; `hasPermission()` checks `"resource:scope"` strings client-side |
| `frontend/src/components/layout/Sidebar.tsx` | Uses `hasPermission()` to conditionally render nav items |
| `frontend/src/lib/constants.ts` | `NavItem` interface has `requiredResource`/`requiredScope` for permission gating |

**Consumers of `require_permission()`** -- 13 routers, ~55 endpoint decorators:
- `governance_requests.py` (8 endpoints: governance_request read/write)
- `intake.py` (7 endpoints: intake read/write, intake_template read/write)
- `domain_reviews.py` (6 endpoints: domain_review read/write)
- `domain_registry.py` (4 endpoints: domain_registry read, admin write)
- `dispatch_rules.py` (4 endpoints: dispatch_rule read, admin write)
- `dispatcher.py` (1 endpoint: governance_request write)
- `info_requests.py` (4 endpoints: info_supplement_request read/write)
- `projects.py` (2 endpoints: governance_request read)
- `dashboard.py` (2 endpoints: dashboard read)
- `progress.py` (1 endpoint: progress read)
- `audit_log.py` (1 endpoint: audit_log read)
- `user_authorization.py` (6 endpoints: user_authorization read, admin role-gated)

**Consumers of `require_role()`** -- Used in admin-only endpoints as a direct role check:
- `intake.py` (3 endpoints: template create/update/delete)
- `domain_registry.py` (3 endpoints: create/update/delete)
- `dispatch_rules.py` (3 endpoints: create/update/delete)
- `user_authorization.py` (3 endpoints: role assign/update/delete)

**Implementation approaches considered**:

1. **Full DB-driven with caching (Recommended)**: New `role_permission` table stores permission rows. `check_permission()` queries DB (with in-memory cache + TTL). Admin CRUD endpoints + Settings UI for editing. Keep hardcoded dict as fallback/seed data.
   - Pros: Clean, fully dynamic, admin self-service
   - Cons: Highest effort; needs cache invalidation; migration risk

2. **DB-driven with application startup load**: Load all permissions into memory at app startup and on admin changes. Avoids per-request DB queries.
   - Pros: Same performance as current; simpler cache logic (reload on change)
   - Cons: Need signal mechanism to reload across workers; stale during hot-reload

3. **JSON config file instead of DB**: Move permissions to a JSON file that admin edits via UI, saved to disk.
   - Pros: Simple, no schema change
   - Cons: Not transactional, no audit trail, multi-instance deployment problems

**Recommended approach**: Option 1 (Full DB-driven with caching). This aligns with the existing pattern where `user_role` is already DB-driven, and fits naturally into the Settings admin UI.

### Step 1.1 -- Gather Context

**Dependency graph** (from `_DEPENDENCIES.json`):
- The `auth` feature entry lists `routers: ["auth.py"]`, `tables: []`, `frontendPaths: []`
- `globalFiles` includes `backend/app/auth/` -- confirming this is global infrastructure
- The `user-authorization` feature lists `tables: ["user_role"]`, `routers: ["user_authorization.py"]`
- No existing edges from/to `auth` feature (but every feature implicitly depends on it)

**Feature docs read**:
- `governance-requests.md` -- No RBAC-specific ACs; uses `require_permission` as infrastructure
- `intake-scoping.md` -- AC-14: "All endpoints enforce RBAC via require_permission or require_role"
- `domain-dispatch.md` -- AC-16: "All endpoints enforce RBAC -- admin-only for write operations on rules and domains"
- `project-linking.md` -- No RBAC-specific ACs

### Step 1.2 -- Classify Impact Level

**Impact Level: L4 (Global)**

Rationale:
- Changes shared infrastructure: `backend/app/auth/rbac.py`, `backend/app/auth/dependencies.py`, `backend/app/auth/providers.py`
- `backend/app/auth/` is listed in `_DEPENDENCIES.json` `globalFiles`
- Affects ALL 13 routers (every endpoint using `require_permission` or `require_role`)
- Adds new DB table used by the auth system (which is used by all features)
- Changes the `/api/auth/me` response pipeline (affects all frontend permission checks)
- Requires new Settings UI and new API endpoints

### Step 1.3 -- Classify Risk Level

**Risk Level: High**

Rationale:
- Changes RBAC permissions, which is explicitly called out as a High risk signal
- Modifies the core `check_permission()` function that guards every endpoint
- Any regression here would break authorization across the entire application
- Requires migration script to seed the new `role_permission` table
- Changes how `build_permission_list()` works, affecting both auth providers
- Existing test assertions (34 tests in `test_rbac.py` + `test_user_authorization.py`) depend on specific permission behavior

### Step 1.4 -- Decision Matrix

**L4 (Global) x High Risk = Pause: full chain**

### Step 1.5 -- Output Assessment

```
## Impact Assessment
**Feature**: Database-Driven RBAC Permissions
**Impact Level**: L4 (Global) -- Changes shared auth infrastructure (backend/app/auth/) used by all 13 routers
**Risk Level**: High -- Modifies core permission check logic, RBAC permissions, requires data migration
**Decision**: Pause for full chain review

### Affected Features
| Feature | Relationship | Specific Impact |
|---------|-------------|-----------------|
| auth | Direct | Core permission check logic rewritten to use DB queries |
| governance-requests | guard (implicit) | All 8 endpoints use require_permission("governance_request", ...) |
| intake-scoping | guard (implicit) | All 7 endpoints use require_permission("intake", ...) / require_role |
| domain-dispatch | guard (implicit) | All 15 endpoints across 4 routers use require_permission / require_role |
| project-linking | guard (implicit) | 2 endpoints use require_permission("governance_request", "read") |
| user-authorization | Direct + guard | Uses require_permission + require_role; will gain new permission config UI |
| dashboard | guard (implicit) | 2 endpoints use require_permission("dashboard", "read") |
| audit-log | guard (implicit) | 1 endpoint uses require_permission("audit_log", "read") |
| progress | guard (implicit) | 1 endpoint uses require_permission("progress", "read") |

### Schema Changes
- [x] New table: `role_permission` (role, resource, scope)
- [x] Migration script required: Yes -- seed table from existing ROLE_PERMISSIONS dict
- [x] New table: Optional `permission_audit_log` or reuse existing `audit_log`

### Affected Acceptance Criteria
> intake-scoping.md AC-14: "All endpoints enforce RBAC via require_permission or require_role"
> --> This change modifies HOW permissions are resolved (DB vs dict) but the enforcement mechanism (require_permission dependency) remains the same. AC still holds if DB-driven permissions produce the same results.

> domain-dispatch.md AC-16: "All endpoints enforce RBAC -- admin-only for write operations on rules and domains"
> --> Same as above. The admin role check via require_role(Role.ADMIN) is unchanged. The permission checks via require_permission will now resolve from DB instead of dict.

> governance-requests.md: No RBAC-specific ACs found.
> project-linking.md: No RBAC-specific ACs found.

### Affected API Contracts
- `GET /api/auth/me` -- Response shape unchanged (still returns `permissions: string[]`), but values now sourced from DB
- `GET /api/auth/permissions` -- Same as above
- New: `GET /api/role-permissions` -- List all role-permission mappings
- New: `GET /api/role-permissions/{role}` -- Get permissions for a specific role
- New: `PUT /api/role-permissions/{role}` -- Update permissions for a role (admin only)
- New: `GET /api/role-permissions/resources` -- List all known resources and scopes

### Test Impact
- **Existing tests needing updates**: `api-tests/test_auth.py` (tests that assert specific permission strings may need adjustment if DB seeding order differs); `api-tests/test_rbac.py` (all 18 tests depend on permission matrix behavior -- must pass identically after migration)
- **New tests needed**: `api-tests/test_role_permissions.py` (CRUD for permission config); E2E tests for the new Settings > Permission Management page
- **Risk mitigation**: Run full test suite after migration to verify zero behavioral change

### Full Dependency Chain
auth (directly affected -- core permission resolution rewritten)
  +-- governance-requests (require_permission guard)
  |     +-- intake-scoping (FK + status_write to governance-requests)
  |     +-- domain-dispatch (FK + status_write to governance-requests)
  |     +-- project-linking (FK to governance-requests)
  +-- intake-scoping (require_permission guard)
  +-- domain-dispatch (require_permission guard)
  |     +-- domain_registry (require_role guard)
  |     +-- dispatch_rules (require_role guard)
  |     +-- domain_reviews (require_permission guard)
  |     +-- info_requests (require_permission guard)
  +-- user-authorization (require_permission + require_role guard; new UI added)
  +-- dashboard (require_permission guard)
  +-- audit-log (require_permission guard)
  +-- progress (require_permission guard)
```

### Step 1.6 -- Gate

**Decision: Pause for full chain review.** This is a High Risk + L4 Global change. The full dependency chain, affected ACs, schema changes, and API contracts would be presented to the user for approval before proceeding.

---

## Phase 2: Feature Documentation

### Step 2.1 -- Create Feature Doc

Would create: `docs/features/rbac-permissions.md`

**Planned content:**

```markdown
# Feature: Database-Driven RBAC Permissions

**Status**: Draft
**Date**: 2026-03-11
**Spec Version**: 1

## Impact Assessment
(Paste from Phase 1 above)

## Summary
Replaces the hardcoded Python dictionary `ROLE_PERMISSIONS` in `backend/app/auth/rbac.py` with a
database-driven permission system. A new `role_permission` table stores resource-scope pairs per
role. Admin users can manage permissions through a new Settings > Permission Management page,
enabling dynamic permission configuration without code deployments.

## Affected Files

### Backend
- `backend/app/auth/rbac.py` -- Rewrite check_permission() and build_permission_list() to query DB (with cache)
- `backend/app/auth/dependencies.py` -- No structural changes; require_permission() still calls check_permission()
- `backend/app/auth/providers.py` -- build_permission_list() now queries DB; both providers affected
- `backend/app/auth/__init__.py` -- May export new cache-invalidation helper
- `backend/app/routers/role_permissions.py` -- NEW: CRUD endpoints for permission management
- `backend/app/main.py` -- Register new role_permissions router

### Frontend
- `frontend/src/app/(sidebar)/settings/permissions/page.tsx` -- NEW: Permission management UI
- `frontend/src/app/(sidebar)/settings/page.tsx` -- Add "Permission Management" card
- `frontend/src/lib/constants.ts` -- Add nav item for permission management under Settings

### Database
- `scripts/schema.sql` -- Add role_permission table
- `scripts/migrate_rbac_to_db.py` -- NEW: Migration script to seed table from ROLE_PERMISSIONS dict

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/role-permissions` | List all role-permission mappings (admin only) |
| GET | `/api/role-permissions/{role}` | Get permissions for a specific role |
| PUT | `/api/role-permissions/{role}` | Replace all permissions for a role (admin only) |
| GET | `/api/role-permissions/resources` | List all known resource-scope combinations |
| POST | `/api/role-permissions/reset` | Reset a role's permissions to factory defaults (admin only) |

## Database Tables

### `role_permission` (NEW)
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID PK | DEFAULT gen_random_uuid() |
| role | VARCHAR NOT NULL | One of: admin, governance_lead, domain_reviewer, requestor, viewer |
| resource | VARCHAR NOT NULL | e.g., "governance_request", "intake", "dashboard" |
| scope | VARCHAR NOT NULL | e.g., "read", "write", "assign", "execute" |
| created_by | VARCHAR | Audit field |
| created_at | TIMESTAMP | DEFAULT NOW() |
| UNIQUE(role, resource, scope) | | Prevents duplicate permission entries |

## UI Behavior

### Permission Management Page (`/settings/permissions`)
1. Page header: "Permission Management" with description text
2. Role selector tabs or dropdown: admin | governance_lead | domain_reviewer | requestor | viewer
3. For the selected role, display a table/grid:
   - Rows = resources (governance_request, intake, domain_review, etc.)
   - Columns = scopes (read, write, assign, execute)
   - Each cell is a checkbox (checked = permission granted)
4. Admin role shows all checkboxes checked and disabled (wildcard, cannot be modified)
5. "Save Changes" button submits the full permission set via PUT
6. "Reset to Defaults" button restores the hardcoded factory defaults
7. Success/error toast notifications on save
8. Changes take effect immediately (cache is invalidated on save)
9. Audit log entry written on each permission change

### Error States
- Non-admin users cannot access the page (403 or hidden from nav)
- Attempting to modify admin role permissions returns 400
- Invalid role name returns 404

## Acceptance Criteria

- [ ] AC-1: A new `role_permission` table exists with columns: id, role, resource, scope, created_by, created_at
- [ ] AC-2: Migration script seeds the table with all permissions from the existing ROLE_PERMISSIONS dict
- [ ] AC-3: `check_permission()` resolves permissions from the DB instead of the hardcoded dict
- [ ] AC-4: Permission lookups use an in-memory cache with configurable TTL (default 60s)
- [ ] AC-5: Cache is invalidated when permissions are updated via the API
- [ ] AC-6: `build_permission_list()` returns the same format as before (list of "resource:scope" strings)
- [ ] AC-7: The existing hardcoded ROLE_PERMISSIONS dict is retained as DEFAULT_PERMISSIONS for fallback/reset
- [ ] AC-8: `GET /api/role-permissions` returns all role-permission mappings (admin only)
- [ ] AC-9: `GET /api/role-permissions/{role}` returns permissions for a specific role
- [ ] AC-10: `PUT /api/role-permissions/{role}` replaces all permissions for a role (admin only)
- [ ] AC-11: Modifying admin role permissions is rejected with 400
- [ ] AC-12: `GET /api/role-permissions/resources` returns all known resource-scope pairs
- [ ] AC-13: `POST /api/role-permissions/reset` restores a role to factory default permissions (admin only)
- [ ] AC-14: Permission changes are recorded in the audit_log table
- [ ] AC-15: All existing RBAC test cases (test_rbac.py) pass without modification after migration
- [ ] AC-16: The Settings page shows a "Permission Management" card (admin only)
- [ ] AC-17: The permission management page displays a role selector and resource-scope checkbox grid
- [ ] AC-18: Saving permission changes via the UI updates the DB and invalidates the cache
- [ ] AC-19: The "Reset to Defaults" button restores factory permissions for the selected role
- [ ] AC-20: Non-admin users cannot access the permission management endpoints (403)
```

### Step 2.2 -- Update Dependency Graph

Would update `docs/features/_DEPENDENCIES.json`:

1. **Update the `auth` feature entry** to include the new table and router:
```json
"auth": {
  "doc": "docs/features/rbac-permissions.md",
  "tables": ["role_permission"],
  "routers": ["auth.py", "role_permissions.py"],
  "frontendPaths": [
    "frontend/src/app/(sidebar)/settings/permissions/"
  ]
}
```

2. **Add a new edge** from `auth` to `user-authorization`:
```json
{
  "from": "auth",
  "to": "user-authorization",
  "type": "guard",
  "detail": "role_permission table defines what each role assigned via user_role can access"
}
```

3. **Update `sharedTables`**: No change needed since `role_permission` is owned solely by `auth`.

4. **`globalFiles`** already includes `backend/app/auth/` which covers the modified files.

---

## Phase 3: Implementation

### Step 3.0 -- Implementation Strategy (L4 change)

**Phased delivery** (4 independently testable phases):

#### Phase A: Schema + Migration (DB layer)
1. Add `role_permission` table to `scripts/schema.sql`
2. Create migration script `scripts/migrate_rbac_to_db.py` that:
   - Reads the existing `ROLE_PERMISSIONS` dict
   - Inserts all role-resource-scope combinations into `role_permission`
   - Is idempotent (uses INSERT ... ON CONFLICT DO NOTHING)
3. Run migration against `egm_local` on port 5433
4. **System state**: DB has permissions data, but code still reads from dict. Fully working.

#### Phase B: Backend -- DB-driven permission resolution (core change)
1. Rename `ROLE_PERMISSIONS` to `DEFAULT_PERMISSIONS` (factory defaults / fallback)
2. Add `_permission_cache` module-level dict with TTL tracking
3. Rewrite `check_permission()` to:
   - Check cache first
   - On cache miss, query `role_permission` table
   - If DB query fails or returns no rows AND role has no DB entries, fall back to `DEFAULT_PERMISSIONS`
   - Cache result with timestamp
4. Rewrite `build_permission_list()` similarly
5. Add `invalidate_permission_cache(role=None)` function
6. **System state**: Permission checks now use DB. All existing behavior identical (data was seeded from same dict). Full fallback if DB is down.

#### Phase C: Backend -- Admin API endpoints
1. Create `backend/app/routers/role_permissions.py` with endpoints:
   - `GET /api/role-permissions` -- list all (grouped by role)
   - `GET /api/role-permissions/resources` -- list known resources/scopes
   - `GET /api/role-permissions/{role}` -- get for one role
   - `PUT /api/role-permissions/{role}` -- replace permissions for a role
   - `POST /api/role-permissions/reset` -- reset to defaults
2. Register router in `backend/app/main.py`
3. All write endpoints call `invalidate_permission_cache()`
4. All write endpoints write to `audit_log`
5. **System state**: Admin API available; no frontend yet. All prior behavior preserved.

#### Phase D: Frontend -- Permission Management UI
1. Create `frontend/src/app/(sidebar)/settings/permissions/page.tsx`
2. Add "Permission Management" card to `frontend/src/app/(sidebar)/settings/page.tsx`
3. Add nav item to `frontend/src/lib/constants.ts` under Settings children
4. **System state**: Full feature complete.

**Backward compatibility**:
- `DEFAULT_PERMISSIONS` dict retained as fallback
- `check_permission()` signature unchanged: `check_permission(role, resource, scope) -> bool`
- `build_permission_list()` signature unchanged: `build_permission_list(role) -> list[str]`
- `require_permission()` and `require_role()` unchanged -- they just call check_permission
- `/api/auth/me` response shape unchanged
- Frontend `hasPermission()` works identically (same string format)

**Rollback plan**:
- **Code-level**: Revert `check_permission()` to read from `DEFAULT_PERMISSIONS` dict (one-line change)
- **Migration-level**: `DROP TABLE role_permission;` (no other tables depend on it)
- **Deployment-level**: Could add `RBAC_USE_DB=true/false` env var as a feature flag during rollout

### Step 3.1 -- Code Changes (Detailed)

#### 3.1.1 `scripts/schema.sql` -- Add table
```sql
-- ===================================================
-- I: Role Permissions (DB-driven RBAC)
-- ===================================================

CREATE TABLE IF NOT EXISTS role_permission (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role            VARCHAR NOT NULL,
    resource        VARCHAR NOT NULL,
    scope           VARCHAR NOT NULL,
    created_by      VARCHAR,
    created_at      TIMESTAMP DEFAULT NOW(),
    UNIQUE(role, resource, scope)
);
```

#### 3.1.2 `scripts/migrate_rbac_to_db.py` -- NEW migration script
- Import `ROLE_PERMISSIONS` from the renamed `DEFAULT_PERMISSIONS`
- Connect to `egm_local` on port 5433
- For each role, for each resource, for each scope: INSERT with ON CONFLICT DO NOTHING
- Special handling for admin wildcard: expand `"*": ["*"]` into explicit entries for all known resources/scopes, PLUS keep a `"*": "*"` sentinel row
- Print summary of rows inserted

#### 3.1.3 `backend/app/auth/rbac.py` -- Core rewrite

Current file (99 lines) would be restructured to approximately:

```python
"""RBAC permission resolution -- DB-driven with in-memory cache."""
from __future__ import annotations

import time
import logging
from typing import Optional

from app.auth.models import Role

logger = logging.getLogger("egm.rbac")

# Factory defaults -- used for seeding, reset, and fallback
DEFAULT_PERMISSIONS: dict[Role, dict[str, list[str]]] = {
    # ... exact copy of current ROLE_PERMISSIONS ...
}

# In-memory cache: {role_value: {"permissions": {resource: [scopes]}, "ts": float}}
_cache: dict[str, dict] = {}
_CACHE_TTL: int = 60  # seconds

def invalidate_permission_cache(role: Optional[str] = None):
    """Clear cached permissions. If role is None, clear all."""
    if role:
        _cache.pop(role, None)
    else:
        _cache.clear()

async def _load_permissions_from_db(role: Role) -> dict[str, list[str]] | None:
    """Query role_permission table for a role's permissions."""
    from app.database import AsyncSessionLocal
    from sqlalchemy import text

    try:
        async with AsyncSessionLocal() as session:
            rows = (await session.execute(
                text("SELECT resource, scope FROM role_permission WHERE role = :role"),
                {"role": role.value},
            )).mappings().all()

            if not rows:
                return None  # No DB entries; caller should use fallback

            perms: dict[str, list[str]] = {}
            for row in rows:
                resource = row["resource"]
                scope = row["scope"]
                perms.setdefault(resource, []).append(scope)
            return perms
    except Exception as exc:
        logger.warning("DB permission lookup failed for %s: %s", role.value, exc)
        return None  # Fallback to defaults on DB error

def _get_cached_permissions(role: Role) -> dict[str, list[str]] | None:
    """Return cached permissions if still valid, else None."""
    entry = _cache.get(role.value)
    if entry and (time.monotonic() - entry["ts"]) < _CACHE_TTL:
        return entry["permissions"]
    return None

def _set_cached_permissions(role: Role, perms: dict[str, list[str]]):
    """Store permissions in cache."""
    _cache[role.value] = {"permissions": perms, "ts": time.monotonic()}

async def _resolve_permissions(role: Role) -> dict[str, list[str]]:
    """Get permissions for role: cache -> DB -> fallback."""
    cached = _get_cached_permissions(role)
    if cached is not None:
        return cached

    db_perms = await _load_permissions_from_db(role)
    if db_perms is not None:
        _set_cached_permissions(role, db_perms)
        return db_perms

    # Fallback to hardcoded defaults
    fallback = DEFAULT_PERMISSIONS.get(role, {})
    _set_cached_permissions(role, fallback)
    return fallback

# --- Sync wrappers for non-async contexts ---
# (The check_permission function needs to become async,
#  or use a sync DB query, or pre-load at authentication time)

# PREFERRED APPROACH: Load permissions at authentication time (in providers.py)
# and store on AuthUser, so check_permission remains sync.

def check_permission(role: Role, resource: str, scope: str,
                     permissions: dict[str, list[str]] | None = None) -> bool:
    """Return True if role has scope on resource.

    If permissions dict is provided (pre-loaded), use it.
    Otherwise fall back to DEFAULT_PERMISSIONS (for backward compat).
    """
    perms = permissions or DEFAULT_PERMISSIONS.get(role, {})

    # Wildcard role (admin)
    if "*" in perms and ("*" in perms["*"] or scope in perms["*"]):
        return True

    allowed_scopes = perms.get(resource, [])
    return "*" in allowed_scopes or scope in allowed_scopes

async def build_permission_list(role: Role) -> list[str]:
    """Return flat list like ["governance_request:read", ...] for role.
    Now async -- queries DB with caching.
    """
    perms = await _resolve_permissions(role)
    result: list[str] = []
    for resource, scopes in perms.items():
        for scope in scopes:
            result.append(f"{resource}:{scope}")
    return result

def build_permission_list_sync(role: Role,
                                permissions: dict[str, list[str]] | None = None) -> list[str]:
    """Sync version using pre-loaded permissions dict."""
    perms = permissions or DEFAULT_PERMISSIONS.get(role, {})
    result: list[str] = []
    for resource, scopes in perms.items():
        for scope in scopes:
            result.append(f"{resource}:{scope}")
    return result
```

**Key design decision**: Rather than making `check_permission()` async (which would require changing all ~55 endpoint decorators), the preferred approach is:
1. Load permissions from DB during authentication (in `providers.py` -- already async)
2. Store the loaded permissions dict on the `AuthUser` object
3. `check_permission()` remains synchronous, using the pre-loaded permissions
4. This means permissions are resolved once per request (at auth time), not per-endpoint-check

#### 3.1.4 `backend/app/auth/models.py` -- Add field to AuthUser

```python
class AuthUser(BaseModel):
    id: str
    name: str
    email: str
    role: Role
    permissions: list[str] = []
    _permissions_dict: dict[str, list[str]] = {}  # Internal: pre-loaded from DB
```

Or, more practically, store the dict as a private attribute and use it in check_permission.

#### 3.1.5 `backend/app/auth/providers.py` -- Load permissions from DB

Both `DevAuthProvider.authenticate()` and `KeycloakAuthProvider.authenticate()` currently call `build_permission_list(role)`. These would change to:

```python
from app.auth.rbac import build_permission_list  # now async

# In authenticate():
permissions_list = await build_permission_list(role)
# (build_permission_list internally resolves from DB with cache)
```

Since `build_permission_list` becomes async, and the providers' `authenticate()` methods are already async, this is a clean change.

#### 3.1.6 `backend/app/auth/dependencies.py` -- Update require_permission

The `require_permission` dependency needs access to the resolved permissions. Two options:

**Option A (Minimal change)**: Since `AuthUser.permissions` is already populated at auth time, `require_permission` can check the flat list directly:

```python
def require_permission(resource: str, scope: str = "read") -> Callable:
    async def _check(user: AuthUser = Depends(get_current_user)) -> AuthUser:
        target = f"{resource}:{scope}"
        if "*:*" in user.permissions or target in user.permissions or f"{resource}:*" in user.permissions:
            return user
        raise HTTPException(status_code=403, detail=f"No permission: {resource}:{scope}")
    return _check
```

This eliminates the dependency on `check_permission()` entirely for runtime checks, relying on the pre-loaded permissions list on `AuthUser`. This is cleaner and avoids any sync/async issues.

**Option B**: Keep calling `check_permission()` but pass the pre-loaded dict. Less clean.

**Recommended: Option A.** It simplifies the dependency, is already the pattern the frontend uses, and the permissions list is authoritative (loaded from DB at auth time).

#### 3.1.7 `backend/app/routers/role_permissions.py` -- NEW router

```python
"""Role Permission Management -- Admin endpoints for DB-driven RBAC."""
router = APIRouter()

# GET "" -- list all permissions grouped by role
# GET "/resources" -- list all known resources and scopes
# GET "/{role}" -- get permissions for one role
# PUT "/{role}" -- replace permissions for one role
# POST "/reset" -- reset one role to factory defaults

# All write endpoints: require_role(Role.ADMIN)
# All endpoints: write audit_log on changes
# All write endpoints: call invalidate_permission_cache()
```

Detailed endpoint specifications:

**GET /api/role-permissions**
- Auth: `require_role(Role.ADMIN)`
- Returns: `{ "data": { "admin": {"*": ["*"]}, "governance_lead": {...}, ... } }`

**GET /api/role-permissions/resources**
- Auth: `require_role(Role.ADMIN)`
- Returns: `{ "resources": ["governance_request", "intake", ...], "scopes": ["read", "write", "assign", "execute"] }`
- Sources the list from `DEFAULT_PERMISSIONS` (all known resource-scope pairs)

**GET /api/role-permissions/{role}**
- Auth: `require_role(Role.ADMIN)`
- Returns: `{ "role": "governance_lead", "permissions": {"governance_request": ["read", "write"], ...} }`

**PUT /api/role-permissions/{role}**
- Auth: `require_role(Role.ADMIN)`
- Body: `{ "permissions": {"governance_request": ["read", "write"], "intake": ["read"], ...} }`
- Rejects if role == "admin" (400: "Cannot modify admin permissions")
- Transaction: DELETE all existing + INSERT new rows
- Calls `invalidate_permission_cache(role)`
- Writes audit_log entry with old and new permission sets

**POST /api/role-permissions/reset**
- Auth: `require_role(Role.ADMIN)`
- Body: `{ "role": "governance_lead" }`
- Rejects if role == "admin"
- Replaces DB permissions with `DEFAULT_PERMISSIONS[role]`
- Calls `invalidate_permission_cache(role)`

#### 3.1.8 `backend/app/main.py` -- Register router

Add import and `app.include_router(role_permissions.router, prefix="/api/role-permissions", tags=["Role Permissions"])`.

#### 3.1.9 Frontend -- Settings page update

Add to `settingsItems` array in `frontend/src/app/(sidebar)/settings/page.tsx`:
```typescript
{ label: 'Permission Management', href: '/settings/permissions', description: 'Configure resource permissions for each EGM role' },
```

#### 3.1.10 Frontend -- Nav constants update

Add to Settings children in `frontend/src/lib/constants.ts`:
```typescript
{ label: 'Permission Management', href: '/settings/permissions', icon: Shield },
```

#### 3.1.11 Frontend -- Permission Management Page (NEW)

`frontend/src/app/(sidebar)/settings/permissions/page.tsx`

Key UI components:
- Role tabs: `['governance_lead', 'domain_reviewer', 'requestor', 'viewer']` (admin tab shown but disabled/read-only)
- Resource-scope grid: Fetched from `GET /api/role-permissions/resources`
- Checkbox matrix: Fetched from `GET /api/role-permissions/{selectedRole}`
- Save button: `PUT /api/role-permissions/{selectedRole}`
- Reset button: `POST /api/role-permissions/reset`
- Uses `@tanstack/react-query` for data fetching (consistent with existing pages)
- Uses existing `api` wrapper from `@/lib/api`

### Step 3.2 -- Update Test Map

Add to `scripts/test-map.json`:

```json
{
  "backend/app/routers/role_permissions.py": {
    "api": ["api-tests/test_role_permissions.py"],
    "e2e": []
  },
  "frontend/src/app/(sidebar)/settings/permissions/": {
    "api": [],
    "e2e": ["e2e-tests/permissions.spec.ts"]
  }
}
```

Update the wildcard entry for `backend/app/auth/` (already exists, maps to `test_auth.py` and `test_rbac.py`). Also add mapping to the new `test_role_permissions.py`:

```json
{
  "backend/app/auth/rbac.py": {
    "api": ["api-tests/test_auth.py", "api-tests/test_rbac.py", "api-tests/test_role_permissions.py"],
    "e2e": []
  }
}
```

### Step 3.3 -- Automatic Verification

The PostToolUse hook will automatically run affected tests after every Edit/Write. Key test files that will be triggered:
- Editing `backend/app/auth/rbac.py` triggers `test_auth.py` + `test_rbac.py` (via wildcard `backend/app/auth/`)
- Editing `backend/app/routers/role_permissions.py` triggers `test_role_permissions.py`
- Editing any frontend settings file triggers `e2e-tests/settings.spec.ts`

---

## Phase 4: Testing

### Step 4.1 -- API Tests

#### 4.1.1 `api-tests/test_role_permissions.py` -- NEW

```python
# --- Permission CRUD (admin only) ---
def test_list_all_permissions()                  # AC-8: GET returns all roles with permissions
def test_list_resources()                        # AC-12: GET /resources returns resource + scope lists
def test_get_permissions_for_role()              # AC-9: GET /{role} returns correct permissions
def test_get_permissions_for_admin()             # AC-9: admin role returns wildcard
def test_get_permissions_invalid_role()           # 404 for nonexistent role

def test_update_permissions_for_role()           # AC-10: PUT replaces permissions
def test_update_permissions_verify_effective()    # AC-3, AC-5: After update, check_permission uses new values
def test_update_admin_permissions_rejected()      # AC-11: 400 when trying to modify admin
def test_update_permissions_empty_set()           # AC-10: Can set empty permissions (lock out role)

def test_reset_permissions_to_defaults()         # AC-13: POST /reset restores factory defaults
def test_reset_admin_rejected()                  # AC-11: Cannot reset admin

def test_permission_change_audit_logged()        # AC-14: audit_log entry written

# --- RBAC enforcement ---
def test_viewer_cannot_list_permissions()         # AC-20: 403
def test_requestor_cannot_update_permissions()    # AC-20: 403
def test_governance_lead_cannot_update_permissions() # AC-20: 403

# --- Cache behavior ---
def test_permission_update_takes_effect_immediately() # AC-5: After PUT, subsequent auth/me reflects new permissions
```

#### 4.1.2 `api-tests/test_rbac.py` -- Existing (NO MODIFICATIONS)

All 18 existing tests must pass without modification. This is the critical regression safety net (AC-15):
- `test_requestor_can_create_request`
- `test_requestor_can_list_requests`
- `test_requestor_cannot_create_domain`
- `test_requestor_cannot_create_dispatch_rule`
- `test_requestor_cannot_create_template`
- `test_reviewer_can_list_reviews`
- `test_reviewer_can_read_requests`
- `test_reviewer_cannot_create_request`
- `test_reviewer_cannot_create_domain`
- `test_reviewer_cannot_delete_dispatch_rule`
- `test_viewer_can_read_requests`
- `test_viewer_cannot_create_request`
- `test_viewer_cannot_write_intake`
- `test_viewer_cannot_search_employees`
- `test_requestor_cannot_read_user_authorization`
- `test_governance_lead_can_read_user_authorization`
- `test_governance_lead_cannot_assign_role`
- `test_viewer_cannot_deactivate_domain`
- `test_requestor_cannot_deactivate_domain`

#### 4.1.3 `api-tests/test_auth.py` -- Existing (NO MODIFICATIONS)

All 5 existing tests must pass:
- `test_auth_me`
- `test_auth_permissions`
- `test_switch_role_to_requestor`
- `test_switch_role_to_reviewer`
- `test_switch_role_invalid_falls_back`

#### 4.1.4 `api-tests/test_user_authorization.py` -- Existing (NO MODIFICATIONS)

All 20 existing tests must pass without modification.

### Step 4.2 -- E2E Tests

#### 4.2.1 `e2e-tests/permissions.spec.ts` -- NEW

```typescript
test.describe('Permission Management', () => {
  test('settings page shows Permission Management card', async ({ page }) => {
    // AC-16: Navigate to /settings, verify card exists
  });

  test('page loads with role tabs and permission grid', async ({ page }) => {
    // AC-17: Navigate to /settings/permissions, verify role selector and grid
  });

  test('selecting a role shows its permissions', async ({ page }) => {
    // AC-17: Click different role tabs, verify grid updates
  });

  test('admin role shows all checked and disabled', async ({ page }) => {
    // AC-17: Admin tab shows read-only full permissions
  });

  test('saving permission changes shows success toast', async ({ page }) => {
    // AC-18: Modify a checkbox, click Save, verify toast
  });

  test('reset to defaults button works', async ({ page }) => {
    // AC-19: Click Reset, verify permissions restored
  });
});
```

#### 4.2.2 Existing E2E tests -- NO MODIFICATIONS expected

- `e2e-tests/settings.spec.ts` -- Should still pass (settings page still loads)
- `e2e-tests/user-authorization.spec.ts` -- Should still pass (unrelated to permission config)
- All other E2E tests -- Should still pass (frontend permission checking logic unchanged)

### Step 4.3 -- Run Affected Tests

After implementation, run in order:

```bash
# 1. Run migration
python3 scripts/migrate_rbac_to_db.py

# 2. Verify core auth tests pass (regression check)
python3 -m pytest api-tests/test_auth.py -v --tb=short

# 3. Verify all RBAC tests pass (regression check -- CRITICAL)
python3 -m pytest api-tests/test_rbac.py -v --tb=short

# 4. Run new permission management tests
python3 -m pytest api-tests/test_role_permissions.py -v --tb=short

# 5. Run user authorization tests (regression)
python3 -m pytest api-tests/test_user_authorization.py -v --tb=short

# 6. Run new E2E tests
npx playwright test e2e-tests/permissions.spec.ts --reporter=list

# 7. Run existing settings E2E (regression)
npx playwright test e2e-tests/settings.spec.ts --reporter=list
```

---

## Phase 5: Verification & Completion

### Step 5.1 -- Update Feature Doc

1. Check off all acceptance criteria (AC-1 through AC-20) as tests pass
2. Fill in Test Coverage section with exact test function names and AC mappings
3. Fill in Test Map Entries section
4. Set Status to "Implemented"

### Step 5.2 -- Run Full Test Suite

```bash
# Full API test suite (86+ existing + ~15 new = ~101 tests)
python3 -m pytest api-tests/ -v --tb=short

# Full E2E test suite (24+ existing + ~6 new = ~30 tests)
npx playwright test --reporter=list
```

**Expected outcome**: All tests pass with zero regressions. The DB-driven permissions produce identical behavior to the hardcoded dict because the migration script seeded the exact same data.

### Step 5.3 -- Final Checklist

- [ ] Impact Assessment completed (Phase 1) -- L4 Global, High Risk, Full Chain review
- [ ] Feature doc created: `docs/features/rbac-permissions.md` with all 20 ACs (Phase 2)
- [ ] Dependency graph updated: `auth` feature entry updated with new table/router/path (Phase 2.2)
- [ ] Code implemented (Phase 3):
  - [ ] `role_permission` table added to `scripts/schema.sql`
  - [ ] Migration script `scripts/migrate_rbac_to_db.py` created and run
  - [ ] `backend/app/auth/rbac.py` rewritten with DB-driven resolution + cache
  - [ ] `backend/app/auth/providers.py` updated to use async `build_permission_list`
  - [ ] `backend/app/auth/dependencies.py` updated to check pre-loaded permissions list
  - [ ] `backend/app/routers/role_permissions.py` created with 5 endpoints
  - [ ] `backend/app/main.py` updated to register new router
  - [ ] Frontend permission management page created
  - [ ] Frontend settings page and nav constants updated
- [ ] Test map updated for new files (Phase 3.2)
- [ ] API tests written and passing: `test_role_permissions.py` (~15 tests) (Phase 4.1)
- [ ] E2E tests written and passing: `permissions.spec.ts` (~6 tests) (Phase 4.2)
- [ ] All existing tests pass without modification:
  - [ ] `test_rbac.py` (18 tests) -- CRITICAL regression gate
  - [ ] `test_auth.py` (5 tests)
  - [ ] `test_user_authorization.py` (20 tests)
- [ ] Feature doc status set to "Implemented" (Phase 5.1)
- [ ] Full test suite passing: ~101 API tests + ~30 E2E tests (Phase 5.2)

---

## Risk Mitigation Summary

| Risk | Mitigation |
|------|-----------|
| Permission resolution becomes async, breaking sync callers | Load permissions at auth time (in providers.py, already async); store on AuthUser; check_permission reads from pre-loaded data |
| Cache staleness after admin updates | Explicit cache invalidation on PUT/POST endpoints; 60s TTL as safety net |
| DB unavailable during permission check | Fallback to DEFAULT_PERMISSIONS dict; log warning |
| Migration corrupts permissions | Migration is idempotent (ON CONFLICT DO NOTHING); uses same data as hardcoded dict; can be re-run safely |
| Admin accidentally locks themselves out | Admin role (`*:*` wildcard) cannot be modified via API (400 rejection) |
| Breaking existing API contracts | Response shapes unchanged; require_permission/require_role signatures unchanged |
| Full test suite regression | Existing test_rbac.py (18 tests) is the primary regression gate; must pass without modification |

---

## File Change Summary

| File | Action | Description |
|------|--------|-------------|
| `scripts/schema.sql` | MODIFY | Add `role_permission` table definition |
| `scripts/migrate_rbac_to_db.py` | CREATE | Migration script to seed permissions from hardcoded dict |
| `backend/app/auth/rbac.py` | MODIFY | Rewrite to DB-driven with cache; rename dict to DEFAULT_PERMISSIONS |
| `backend/app/auth/dependencies.py` | MODIFY | Check pre-loaded permissions list on AuthUser |
| `backend/app/auth/providers.py` | MODIFY | Use async build_permission_list |
| `backend/app/auth/models.py` | MODIFY | Possibly add _permissions_dict field to AuthUser |
| `backend/app/auth/__init__.py` | MODIFY | Export invalidate_permission_cache |
| `backend/app/routers/role_permissions.py` | CREATE | New router: permission management CRUD |
| `backend/app/main.py` | MODIFY | Register role_permissions router |
| `frontend/src/app/(sidebar)/settings/page.tsx` | MODIFY | Add Permission Management card |
| `frontend/src/app/(sidebar)/settings/permissions/page.tsx` | CREATE | Permission management UI |
| `frontend/src/lib/constants.ts` | MODIFY | Add Permission Management nav item |
| `scripts/test-map.json` | MODIFY | Add mappings for new files |
| `docs/features/rbac-permissions.md` | CREATE | Feature documentation |
| `docs/features/_DEPENDENCIES.json` | MODIFY | Update auth feature entry |
| `api-tests/test_role_permissions.py` | CREATE | New API tests (~15 tests) |
| `e2e-tests/permissions.spec.ts` | CREATE | New E2E tests (~6 tests) |

**Total files**: 17 (7 modified, 6 created, 4 new test/doc files)
