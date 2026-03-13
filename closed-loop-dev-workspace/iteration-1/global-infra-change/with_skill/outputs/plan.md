# Implementation Plan: Database-Driven RBAC Permission System

**Date**: 2026-03-11
**Feature Slug**: `db-driven-rbac`
**Prepared by**: Closed-Loop Feature Development Skill (Phase 1-5)

---

## Phase 1: Impact Assessment

### Step 1.1 -- Gathered Context

#### Source Files Read

| File | Purpose | Key Findings |
|------|---------|-------------|
| `docs/features/_DEPENDENCIES.json` | Cross-feature dependency graph | `backend/app/auth/` is in `globalFiles`; auth feature has `doc: null`, no tables listed |
| `backend/app/auth/rbac.py` | Hardcoded permission matrix | `ROLE_PERMISSIONS` dict maps 5 `Role` enums to `{resource: [scopes]}`. Admin uses `"*": ["*"]` wildcard. Two helpers: `check_permission()` (sync), `build_permission_list()` (sync) |
| `backend/app/auth/models.py` | Auth data models | `Role` enum: ADMIN, GOVERNANCE_LEAD, DOMAIN_REVIEWER, REQUESTOR, VIEWER. `AuthUser` pydantic model with `permissions: list[str]` |
| `backend/app/auth/dependencies.py` | FastAPI DI functions | `require_permission(resource, scope)` calls sync `check_permission(user.role, resource, scope)`. `require_role(*roles)` checks `user.role in roles`. Both return 403 on failure. |
| `backend/app/auth/providers.py` | Auth providers (Dev + Keycloak) | Both providers call `build_permission_list(role)` to populate `AuthUser.permissions`. Both are async. `resolve_role_from_db()` queries `user_role` table. |
| `backend/app/auth/middleware.py` | Auth middleware | Calls `provider.authenticate(request)` on every non-public request. Sets `request.state.user`. |
| `backend/app/auth/__init__.py` | Module re-exports | Exports: `AuthUser`, `Role`, `check_permission`, `get_current_user`, `require_auth`, `require_role`, `require_permission` |
| `backend/app/routers/user_authorization.py` | Existing role CRUD | Manages `user_role` table (itcode -> role mapping). Uses `require_permission("user_authorization", "read")` and `require_role(Role.ADMIN)`. |
| `backend/app/routers/auth.py` | Auth endpoints | `GET /auth/me` returns `{id, name, email, role, permissions}`. `GET /auth/permissions` returns `{role, permissions}`. |
| `backend/app/main.py` | App entry point | 14 routers registered. Uses `AuthMiddleware`. |
| `backend/app/database.py` | DB engine | Async SQLAlchemy on `egm_local:5433`, schema `egm`. `AsyncSessionLocal` session factory. |
| `backend/app/config.py` | Settings | `AUTH_DISABLED`, `AUTH_DEV_USER`, `AUTH_DEV_ROLE` control dev-mode auth. |
| `scripts/schema.sql` | Full DB schema | 15 tables total. `user_role` table exists (id, itcode, role, assigned_by, assigned_at, update_by, update_at). No `role_permission` table. |
| `scripts/test-map.json` | Source-to-test mapping | `backend/app/auth/` wildcard maps to `["api-tests/test_auth.py", "api-tests/test_rbac.py"]`. `backend/app/auth/middleware.py` wildcard maps to ALL API tests. |
| `frontend/src/lib/auth-context.tsx` | Frontend auth provider | `AuthProvider` fetches `/auth/me`, provides `hasPermission(resource, scope)` checking `permissions` array for `"resource:scope"` or `"*:*"`. Also provides `hasRole(...roles)`. |
| `frontend/src/lib/api.ts` | API wrapper | Injects `X-Dev-Role` header from `localStorage` in dev mode. |
| `frontend/src/components/layout/Sidebar.tsx` | Navigation sidebar | Items gated by `hasPermission(item.requiredResource, item.requiredScope)`. Hidden if no permission. |
| `frontend/src/app/(sidebar)/settings/page.tsx` | Settings hub | 6 cards: Scoping Templates, Questionnaire Templates, Dispatch Rules, Domain Management, User Authorization, Audit Log. |
| `frontend/src/app/(sidebar)/settings/user-authorization/page.tsx` | User role management UI | Full CRUD for role assignments. Hardcoded `ROLES` array and `ROLE_LABELS` map. |
| `api-tests/test_rbac.py` | RBAC enforcement tests | 15 tests verifying role-based endpoint access (requestor can/cannot, reviewer can/cannot, viewer can/cannot, governance_lead can/cannot). |
| `api-tests/test_auth.py` | Auth endpoint tests | 5 tests for `/auth/me`, `/auth/permissions`, role switching. Asserts specific permission values like `"*:*"`, `"governance_request:read"`. |
| `api-tests/test_user_authorization.py` | User auth CRUD tests | 19 tests for employee search + role CRUD + RBAC. |
| `api-tests/conftest.py` | Shared test fixtures | Session-scoped `httpx.Client` at `localhost:4001/api`. |
| `e2e-tests/settings.spec.ts` | Settings E2E tests | 5 tests for settings page navigation. |

#### Dependency Graph Analysis

`backend/app/auth/` is listed in `globalFiles` in `_DEPENDENCIES.json`. This means any change to this directory affects the entire system. Additionally:

**Direct callers of `check_permission()` (via `require_permission`):**

Every router in the system uses `require_permission()`. Grepping the codebase found **38 endpoint-level permission checks** across all 14 routers:

| Router | Endpoints Using `require_permission` | Endpoints Using `require_role` |
|--------|--------------------------------------|-------------------------------|
| `governance_requests.py` | 9 | 0 |
| `domain_reviews.py` | 7 | 0 |
| `intake.py` | 5 | 3 |
| `domain_registry.py` | 2 | 3 |
| `dispatch_rules.py` | 1 | 3 |
| `dispatcher.py` | 1 | 0 |
| `info_requests.py` | 4 | 0 |
| `dashboard.py` | 2 | 0 |
| `progress.py` | 1 | 0 |
| `audit_log.py` | 1 | 0 |
| `user_authorization.py` | 3 | 3 |
| `projects.py` | 2 | 0 |

**Direct callers of `build_permission_list()`:**
- `DevAuthProvider.authenticate()` -- called on every dev-mode request
- `KeycloakAuthProvider.authenticate()` -- called on every production request

**Frontend consumers of `permissions` data:**
- `auth-context.tsx` -- `hasPermission()` reads from `user.permissions` array
- `Sidebar.tsx` -- uses `hasPermission()` to gate navigation items
- Any component using `usePermission()` hook

#### Connected Features

All 8 features in the dependency graph are affected because they all use `require_permission()`:

1. **governance-requests** -- 9 endpoints guarded
2. **domain-dispatch** -- 5 routers with 15+ endpoints guarded
3. **intake-scoping** -- 8 endpoints guarded
4. **project-linking** -- 2 endpoints guarded
5. **dashboard** -- 2 endpoints guarded
6. **audit-log** -- 1 endpoint guarded
7. **progress** -- 1 endpoint guarded
8. **auth** -- directly modified (the core module)

### Step 1.2 -- Impact Level Classification

**Impact Level: L4 (Global)**

Signals matched:
- Changes `backend/app/auth/` which is explicitly listed in `globalFiles`
- The `check_permission()` function is invoked on **38 endpoints** across **12 routers**
- The `build_permission_list()` function is called during **every authentication** (both Dev and Keycloak providers)
- Changes affect the fundamental authorization infrastructure that all features depend on
- New DB table (`role_permission`) becomes part of the critical request path

### Step 1.3 -- Risk Level Classification

**Risk Level: High**

Signals matched:
- **Changes RBAC permissions** -- the skill explicitly lists this as a High risk signal
- **Modifies existing behavior** -- `check_permission()` switches from dictionary lookup to database query; if migration is wrong, permissions break globally
- **Requires migration with historical data backfill** -- the 72 permission entries currently in the hardcoded dict must be perfectly replicated in the database
- **Structural change** -- adds a database dependency to the hot path of every authenticated request (with caching to mitigate)
- **Risk of system lockout** -- if admin permissions are corrupted or the DB is unreachable without fallback, no user can access any endpoint

### Step 1.4 -- Decision Matrix

```
           L1          L2              L3                  L4
Low      Auto-approve  Auto-approve    Auto-approve+note   Auto-approve+note
Medium   Auto-approve  Pause:review    Pause:review        Pause:review
High     Pause:review  Pause:review    Pause:full-chain    Pause:full-chain
                                                            ^^^^^^^^^^^^^
                                                            THIS CELL
```

**Decision: Pause for Full Chain Review**

### Step 1.5 -- Full Assessment Output

#### Affected Features Table

| Feature | Relationship | Specific Impact |
|---------|-------------|-----------------|
| auth | **Direct modification** | `rbac.py` rewritten: `check_permission()` and `build_permission_list()` switch from dict to DB+cache. `providers.py` updated to use async version. New `role_permissions.py` router added. |
| governance-requests | Permission guard | 9 endpoints use `require_permission("governance_request", ...)`. Permission resolution path changes. |
| domain-dispatch | Permission guard | 15+ endpoints across 5 routers use `require_permission(...)` and `require_role(Role.ADMIN)`. AC-16 explicitly asserts RBAC enforcement. |
| intake-scoping | Permission guard | 8 endpoints use `require_permission("intake"/"intake_template", ...)` and `require_role(Role.ADMIN)`. |
| project-linking | Permission guard | 2 endpoints use `require_permission("governance_request", "read")`. |
| dashboard | Permission guard | 2 endpoints use `require_permission("dashboard", "read")`. |
| audit-log | Permission guard | 1 endpoint uses `require_permission("audit_log", "read")`. |
| progress | Permission guard | 1 endpoint uses `require_permission("progress", "read")`. |
| user-authorization | Permission guard + UI changes | 6 endpoints use `require_permission`/`require_role`. Settings page updated with new link. |

#### Schema Changes

**New table:**
```sql
CREATE TABLE IF NOT EXISTS role_permission (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role        VARCHAR NOT NULL,
    resource    VARCHAR NOT NULL,
    scope       VARCHAR NOT NULL,
    created_by  VARCHAR,
    created_at  TIMESTAMP DEFAULT NOW(),
    UNIQUE(role, resource, scope)
);
```

**No modifications to existing tables.** The `user_role` table and all other tables remain untouched. The `Role` enum in Python code remains unchanged.

**Seed data required:** 72 rows (1 admin wildcard + 27 governance_lead + 18 domain_reviewer + 11 requestor + 8 viewer = 65 rows; plus 7 additional if `role_permission:read` is added for governance_lead for the new endpoints).

#### Affected API Contracts

| Endpoint | Change Type | Detail |
|----------|-------------|--------|
| `GET /api/auth/me` | **Behavior change** (same shape) | `permissions` array now sourced from DB instead of dict. Values identical after correct seed. |
| `GET /api/auth/permissions` | **Behavior change** (same shape) | Same as above. |
| `GET /api/role-permissions` | **NEW** | List all role-permission mappings grouped by role. Admin only. |
| `GET /api/role-permissions/{role}` | **NEW** | Get permissions for a specific role. Admin only. |
| `PUT /api/role-permissions/{role}` | **NEW** | Bulk-replace permissions for a role. Admin only. Rejects modifications to admin role. |
| `POST /api/role-permissions/{role}/permissions` | **NEW** | Add a single permission to a role. Admin only. |
| `DELETE /api/role-permissions/{role}/permissions` | **NEW** | Remove a single permission from a role. Admin only. |
| `GET /api/role-permissions/meta/resources` | **NEW** | List all distinct resources and scopes. Admin only. |
| All `require_permission()`-guarded endpoints (38 total) | **Behavior change** (transparent) | Permission check reads from in-memory cache backed by DB instead of hardcoded dict. Transparent to callers if seed data is correct. |

#### Affected Acceptance Criteria (from existing feature docs)

| Feature Doc | AC | Impact |
|------------|-----|--------|
| `domain-dispatch.md` | AC-16: "All endpoints enforce RBAC -- admin-only for write operations on rules and domains" | Enforcement mechanism changes from hardcoded dict to DB query. The AC itself remains valid. Must verify all `require_role(Role.ADMIN)` guards still work. |

All other existing ACs do not explicitly reference RBAC mechanisms. They will continue to work because the seed data preserves the exact same permissions.

#### Test Impact

| Test File | Impact | Reason |
|-----------|--------|--------|
| `api-tests/test_auth.py` (5 tests) | **Must pass unchanged** | Tests assert specific permission values (`"*:*"`, `"governance_request:read"`, etc.) from `/auth/me`. These values must be identical after migration. |
| `api-tests/test_rbac.py` (15 tests) | **Must pass unchanged** | Tests verify actual endpoint access per role. If seed data is correct, all pass. |
| `api-tests/test_user_authorization.py` (19 tests) | **Must pass unchanged** | Tests use `X-Dev-Role` header which triggers the permission resolution path. |
| All other `api-tests/test_*.py` (~47 tests) | **Must pass unchanged** | All use admin role by default; admin wildcard must still work. |
| `api-tests/test_role_permissions.py` | **NEW -- ~20 tests** | CRUD for the new role-permission management endpoints. |
| `e2e-tests/role-permissions.spec.ts` | **NEW -- ~6 tests** | Settings UI for permission matrix. |
| All other `e2e-tests/*.spec.ts` (~24 tests) | **Must pass unchanged** | Frontend permission checks depend on `/auth/me` response shape. |

#### Full Dependency Chain

```
role_permission (NEW TABLE)
  |
  v
backend/app/auth/rbac.py [MODIFIED]
  |  check_permission() -- now reads from PermissionCache (backed by role_permission table)
  |  build_permission_list() -- now reads from PermissionCache
  |
  +---> backend/app/auth/providers.py [MODIFIED -- calls async_build_permission_list()]
  |       |
  |       +---> DevAuthProvider.authenticate()
  |       |       |
  |       +---> KeycloakAuthProvider.authenticate()
  |               |
  |               v
  |         backend/app/auth/middleware.py [UNCHANGED -- calls provider.authenticate()]
  |               |
  |               v
  |         EVERY AUTHENTICATED REQUEST (sets request.state.user with permissions)
  |
  +---> backend/app/auth/dependencies.py [UNCHANGED -- sync check_permission reads cache]
          |
          +---> require_permission(resource, scope)  -- used by 38 endpoints
          |       |
          |       +---> governance_requests.py (9 endpoints)
          |       +---> domain_reviews.py (7 endpoints)
          |       +---> intake.py (5 endpoints)
          |       +---> info_requests.py (4 endpoints)
          |       +---> user_authorization.py (3 endpoints)
          |       +---> domain_registry.py (2 endpoints)
          |       +---> projects.py (2 endpoints)
          |       +---> dashboard.py (2 endpoints)
          |       +---> dispatch_rules.py (1 endpoint)
          |       +---> dispatcher.py (1 endpoint)
          |       +---> audit_log.py (1 endpoint)
          |       +---> progress.py (1 endpoint)
          |
          +---> require_role(*roles)  -- used by 12 endpoints (admin-only operations)

Frontend dependency chain:
  GET /api/auth/me [permissions array now from DB]
    |
    v
  frontend/src/lib/auth-context.tsx [UNCHANGED -- hasPermission() logic unchanged]
    |
    +---> Sidebar.tsx -- gates navigation items
    +---> All pages using usePermission() or hasPermission()
```

### Step 1.6 -- Gate

**STATUS: PAUSE FOR FULL CHAIN REVIEW**

This assessment must be presented to the user before any code is written. The change is High Risk x L4 (Global), which requires the full dependency chain above, all affected ACs, all schema changes, and all API contract changes to be reviewed and explicitly approved.

**Recommended question to user:**
> This change is classified as L4 (Global) / High Risk because it modifies the core RBAC infrastructure that guards all 38 endpoints across 12 routers. The implementation preserves exact backward compatibility via seed data and includes a hardcoded fallback for safety. All 86+ existing tests must pass unchanged. Shall I proceed with implementation?

---

## Phase 2: Feature Documentation

*Assumes user approved Phase 1 assessment.*

### Step 2.1 -- Create Feature Doc

**File:** `docs/features/db-driven-rbac.md`

**Contents:**

```markdown
# Feature: Database-Driven RBAC Permission System

**Status**: Draft
**Date**: 2026-03-11
**Spec Version**: 1

## Impact Assessment

- **Impact Level**: L4 (Global) -- modifies `backend/app/auth/` (globalFiles)
- **Risk Level**: High -- changes RBAC permission resolution, requires migration + seed
- **Decision**: Pause: Full Chain -- user reviewed dependency chain and approved

## Summary

Replaces the hardcoded `ROLE_PERMISSIONS` dictionary in `backend/app/auth/rbac.py` with a
database-driven permission system. A new `role_permission` table stores (role, resource, scope)
tuples. Permission checks and permission list building read from an in-memory cache (30s TTL)
backed by this table. Admins can manage permissions via a new Settings UI page at
`/settings/role-permissions`, eliminating code changes when adding or modifying permissions.

## Affected Files

### Backend
- `backend/app/auth/rbac.py` -- Replace ROLE_PERMISSIONS with PermissionCache + DB queries + fallback
- `backend/app/auth/providers.py` -- Switch to async_build_permission_list()
- `backend/app/auth/__init__.py` -- Add new exports (PermissionCache, async helpers)
- `backend/app/routers/role_permissions.py` -- NEW: CRUD router for role-permission management
- `backend/app/main.py` -- Register new role_permissions router

### Frontend
- `frontend/src/app/(sidebar)/settings/role-permissions/page.tsx` -- NEW: Permission matrix UI
- `frontend/src/app/(sidebar)/settings/page.tsx` -- Add "Role Permissions" card

### Database
- `scripts/schema.sql` -- Add role_permission table definition
- `scripts/seed-role-permissions.sql` -- NEW: Idempotent seed script

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/role-permissions` | `require_permission("role_permission", "read")` | List all role-permission mappings |
| GET | `/api/role-permissions/{role}` | `require_permission("role_permission", "read")` | Get permissions for a specific role |
| PUT | `/api/role-permissions/{role}` | `require_role(Role.ADMIN)` | Bulk-replace permissions for a role |
| POST | `/api/role-permissions/{role}/permissions` | `require_role(Role.ADMIN)` | Add a single permission |
| DELETE | `/api/role-permissions/{role}/permissions` | `require_role(Role.ADMIN)` | Remove a single permission |
| GET | `/api/role-permissions/meta/resources` | `require_permission("role_permission", "read")` | List distinct resources and scopes |

## UI Behavior

1. Admin navigates to Settings; sees new "Role Permissions" card
2. Clicks through to `/settings/role-permissions`
3. Page shows a matrix table: rows = resources, columns = roles (Admin, Gov Lead, Domain Reviewer, Requestor, Viewer)
4. Each cell contains checkboxes for scopes (read, write, assign, execute)
5. Admin column shows "Full Access" badge and is non-editable
6. Toggling a checkbox calls POST or DELETE to add/remove the individual permission
7. Changes reflect immediately (cache invalidated server-side)
8. Toast notification on success/failure
9. Resource groups are sortable for easier navigation

## Acceptance Criteria

- [ ] AC-1: `role_permission` table exists with UNIQUE(role, resource, scope) constraint
- [ ] AC-2: Seed script inserts all 65 rows matching current hardcoded ROLE_PERMISSIONS exactly
- [ ] AC-3: `check_permission(role, resource, scope)` reads from PermissionCache backed by DB
- [ ] AC-4: `build_permission_list(role)` reads from PermissionCache backed by DB
- [ ] AC-5: All 15 existing test_rbac.py tests pass unchanged (backward compatibility)
- [ ] AC-6: All 5 existing test_auth.py tests pass unchanged (backward compatibility)
- [ ] AC-7: GET /api/role-permissions returns all roles with permissions (admin only)
- [ ] AC-8: GET /api/role-permissions/{role} returns permissions for a role
- [ ] AC-9: PUT /api/role-permissions/{role} replaces permissions and logs to audit_log
- [ ] AC-10: Admin wildcard ("*:*") cannot be modified via API (returns 400)
- [ ] AC-11: Permission cache invalidates immediately after write operations
- [ ] AC-12: If DB is unreachable, system falls back to hardcoded ROLE_PERMISSIONS_FALLBACK
- [ ] AC-13: Non-admin users receive 403 on role-permission management endpoints
- [ ] AC-14: Settings hub shows "Role Permissions" card
- [ ] AC-15: Permission matrix page renders all roles x resources with toggleable scopes
- [ ] AC-16: Toggling a checkbox adds/removes permission in DB and reflects on page
- [ ] AC-17: Seed migration is idempotent (ON CONFLICT DO NOTHING)
- [ ] AC-18: Full API test suite (86+ tests) passes after migration
- [ ] AC-19: Full E2E test suite (24+ tests) passes after migration

## Test Coverage

### API Tests
- `api-tests/test_role_permissions.py::test_list_all_role_permissions` -- AC-7
- `api-tests/test_role_permissions.py::test_get_role_permissions_admin` -- AC-8
- `api-tests/test_role_permissions.py::test_get_role_permissions_governance_lead` -- AC-8
- `api-tests/test_role_permissions.py::test_update_role_permissions` -- AC-9
- `api-tests/test_role_permissions.py::test_admin_wildcard_cannot_be_removed` -- AC-10
- `api-tests/test_role_permissions.py::test_non_admin_cannot_modify_permissions` -- AC-13
- `api-tests/test_role_permissions.py::test_seed_data_matches_original_rbac` -- AC-2, AC-5
- `api-tests/test_role_permissions.py::test_add_permission` -- AC-16
- `api-tests/test_role_permissions.py::test_remove_permission` -- AC-16
- `api-tests/test_role_permissions.py::test_permission_change_takes_effect` -- AC-3, AC-11
- `api-tests/test_auth.py` (existing, unmodified) -- AC-6
- `api-tests/test_rbac.py` (existing, unmodified) -- AC-5

### E2E Tests
- `e2e-tests/role-permissions.spec.ts::settings hub shows Role Permissions card` -- AC-14
- `e2e-tests/role-permissions.spec.ts::navigates to permission matrix page` -- AC-15
- `e2e-tests/role-permissions.spec.ts::displays all roles as columns` -- AC-15
- `e2e-tests/role-permissions.spec.ts::admin column shows Full Access badge` -- AC-10
- `e2e-tests/role-permissions.spec.ts::can toggle a permission checkbox` -- AC-16

## Test Map Entries

```
backend/app/routers/role_permissions.py -> api-tests/test_role_permissions.py
frontend/src/app/(sidebar)/settings/role-permissions/ -> e2e-tests/role-permissions.spec.ts
```

## Notes

1. **Cache Strategy**: 30s TTL in-memory cache. Per-process (not cross-worker). Acceptable propagation delay.
2. **Admin Protection**: API rejects all modifications to admin role. Cannot lock admins out.
3. **Hardcoded Fallback**: Original dict preserved as ROLE_PERMISSIONS_FALLBACK. Activates on DB failure.
4. **Role Enum Unchanged**: Only permission mappings become dynamic. Adding new roles still requires code change.
5. **Sync/Async Compatibility**: Sync check_permission() reads cache (always populated by async provider). No caller changes needed.
```

### Step 2.2 -- Update Dependency Graph

**Changes to `docs/features/_DEPENDENCIES.json`:**

1. Update the `auth` feature entry:
```json
"auth": {
    "doc": "docs/features/db-driven-rbac.md",
    "tables": ["role_permission"],
    "routers": ["auth.py", "role_permissions.py"],
    "frontendPaths": [
        "frontend/src/app/(sidebar)/settings/role-permissions/"
    ]
}
```

2. Add `user-authorization` (currently missing from graph):
```json
"user-authorization": {
    "doc": null,
    "tables": ["user_role"],
    "routers": ["user_authorization.py"],
    "frontendPaths": [
        "frontend/src/app/(sidebar)/settings/user-authorization/"
    ]
}
```

3. Add edge:
```json
{
    "from": "auth",
    "to": "governance-requests",
    "type": "guard",
    "detail": "role_permission table drives check_permission() for all governance-requests endpoints"
}
```

4. No changes to `sharedTables` (role_permission is owned solely by auth).

5. No changes to `globalFiles` (`backend/app/auth/` is already listed).

---

## Phase 3: Implementation

### Step 3.1 -- Write Code

The implementation is ordered to minimize risk and enable early validation.

#### 3.1.1 -- Database Schema (`scripts/schema.sql`)

Add after the `user_role` table (around line 302):

```sql
-- =====================================================
-- I: Role Permissions (database-driven RBAC)
-- =====================================================

CREATE TABLE IF NOT EXISTS role_permission (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role        VARCHAR NOT NULL,
    resource    VARCHAR NOT NULL,
    scope       VARCHAR NOT NULL,
    created_by  VARCHAR,
    created_at  TIMESTAMP DEFAULT NOW(),
    UNIQUE(role, resource, scope)
);
```

#### 3.1.2 -- Seed Migration Script (`scripts/seed-role-permissions.sql`) [NEW FILE]

Idempotent script using `ON CONFLICT DO NOTHING`. Contents mirror the exact values from `ROLE_PERMISSIONS` in `rbac.py`:

- **Admin**: 1 row -- `('admin', '*', '*')`
- **Governance Lead**: 27 rows -- all (resource, scope) pairs from the current dict
- **Domain Reviewer**: 18 rows
- **Requestor**: 11 rows
- **Viewer**: 8 rows
- **Total**: 65 rows

The exact values come from the current `ROLE_PERMISSIONS` dict read from `backend/app/auth/rbac.py` (lines 15-72 of the current file). Every (resource, scope) pair must be transcribed exactly.

**Verification step**: After running the seed, a SQL query should confirm row counts match:
```sql
SELECT role, COUNT(*) FROM egm.role_permission GROUP BY role ORDER BY role;
-- Expected: admin=1, domain_reviewer=18, governance_lead=27, requestor=11, viewer=8
```

#### 3.1.3 -- Backend: `backend/app/auth/rbac.py` [MODIFIED]

**Strategy**: Backward-compatible refactor. Keep sync function signatures unchanged. Add in-memory cache.

**Key changes:**

1. **Rename** `ROLE_PERMISSIONS` to `ROLE_PERMISSIONS_FALLBACK` -- kept as safety net
2. **Add** `PermissionCache` class:
   - Singleton pattern via `PermissionCache.get()`
   - `_cache: dict[str, dict[str, list[str]]]` -- role -> {resource: [scopes]}
   - `_last_refresh: float` -- monotonic timestamp
   - `TTL_SECONDS = 30`
   - `async refresh()` -- loads all rows from `role_permission` table
   - `invalidate()` -- resets `_last_refresh` to 0 forcing next access to refresh
   - `get_permissions(role: str)` -- returns cached dict or None if empty
3. **Add** async versions:
   - `async async_check_permission(role, resource, scope)` -- refreshes cache if stale, checks permissions, falls back to hardcoded on error
   - `async async_build_permission_list(role)` -- refreshes cache if stale, builds flat list, falls back on error
4. **Keep** sync versions unchanged in signature:
   - `check_permission(role, resource, scope)` -- reads from cache (populated during auth), falls back to hardcoded if cache empty
   - `build_permission_list(role)` -- same approach

**Why keep sync versions?**: The `require_permission()` dependency in `dependencies.py` calls `check_permission()` synchronously. Since the cache is always populated by the time any endpoint dependency runs (populated during async `provider.authenticate()`), the sync version will always find data in the cache. No changes needed in `dependencies.py`.

#### 3.1.4 -- Backend: `backend/app/auth/providers.py` [MODIFIED]

Minimal change in both providers:

```python
# Before (line 77 in DevAuthProvider, line 116 in KeycloakAuthProvider):
permissions=build_permission_list(role),

# After:
from app.auth.rbac import async_build_permission_list
permissions=await async_build_permission_list(role),
```

Both `authenticate()` methods are already async, so adding `await` is a clean change.

The `async_build_permission_list` call will also trigger `PermissionCache.refresh()` if the cache is stale, which primes the cache for subsequent sync `check_permission()` calls.

#### 3.1.5 -- Backend: `backend/app/auth/dependencies.py` [UNCHANGED]

**No changes needed.** The `require_permission()` dependency calls `check_permission(user.role, resource, scope)` which is the sync version. By the time this runs, the cache has been populated during authentication. The sync function reads from the in-memory cache and never needs a DB query.

#### 3.1.6 -- Backend: `backend/app/auth/__init__.py` [MODIFIED]

Add new exports:

```python
from app.auth.rbac import check_permission, async_check_permission, PermissionCache
```

#### 3.1.7 -- Backend: `backend/app/routers/role_permissions.py` [NEW FILE]

A new router with 6 endpoints:

| Endpoint | Auth Guard | Function |
|----------|-----------|----------|
| `GET /` | `require_permission("role_permission", "read")` | List all role-permissions grouped by role |
| `GET /{role}` | `require_permission("role_permission", "read")` | Get permissions for one role |
| `PUT /{role}` | `require_role(Role.ADMIN)` | Bulk-replace permissions for a role (rejects admin) |
| `POST /{role}/permissions` | `require_role(Role.ADMIN)` | Add a single permission (rejects admin, 409 on duplicate) |
| `DELETE /{role}/permissions` | `require_role(Role.ADMIN)` | Remove a single permission (rejects admin, 404 if not found) |
| `GET /meta/resources` | `require_permission("role_permission", "read")` | List distinct resources and scopes |

**Key behaviors:**
- All write operations call `PermissionCache.invalidate()` after commit
- All write operations log to `audit_log` table
- Admin role modification is rejected with 400: "Admin permissions cannot be modified"
- Role values are validated against the `Role` enum
- Input validation for all body parameters

#### 3.1.8 -- Backend: `backend/app/main.py` [MODIFIED]

Add import and router registration:

```python
from app.routers import role_permissions
app.include_router(role_permissions.router, prefix="/api/role-permissions", tags=["Role Permissions"])
```

#### 3.1.9 -- Frontend: Settings Hub (`frontend/src/app/(sidebar)/settings/page.tsx`) [MODIFIED]

Add a new card to the `settingsItems` array:

```typescript
{ label: 'Role Permissions', href: '/settings/role-permissions', description: 'Configure which permissions each role has in the system' },
```

#### 3.1.10 -- Frontend: Permission Matrix Page (`frontend/src/app/(sidebar)/settings/role-permissions/page.tsx`) [NEW FILE]

**UI Design:**

The page renders a permission matrix with the following structure:

- **Header row**: Role names as column headers (Admin grayed out with "Full Access" badge, then Governance Lead, Domain Reviewer, Requestor, Viewer)
- **Body rows**: One row per resource (governance_request, intake, intake_template, domain_registry, domain_review, domain_questionnaire, dispatch_rule, review_action, review_comment, shared_artifact, info_supplement_request, user_authorization, progress, dashboard, report, audit_log, export, role_permission)
- **Cells**: Each cell contains checkboxes for each scope that resource supports (derived from the `/meta/resources` endpoint). Checked = permission granted.
- **Interactions**:
  - Checking a box calls `POST /api/role-permissions/{role}/permissions` with `{resource, scope}`
  - Unchecking calls `DELETE /api/role-permissions/{role}/permissions` with `{resource, scope}`
  - Uses `useMutation` with optimistic updates; reverts on failure
  - After each mutation, invalidates `['role-permissions']` and `['auth-user']` queries
- **Error handling**: Toast on failure, checkbox reverts to previous state
- **Loading state**: Skeleton table while fetching

**Data flow:**
1. `GET /api/role-permissions` -- populates the matrix state
2. `GET /api/role-permissions/meta/resources` -- determines which resources and scopes to show
3. Individual `POST`/`DELETE` calls on checkbox toggle
4. `useQueryClient().invalidateQueries()` after each mutation

### Step 3.2 -- Update Test Map (`scripts/test-map.json`)

Add to `"mappings"`:

```json
"backend/app/routers/role_permissions.py": {
    "api": ["api-tests/test_role_permissions.py"],
    "e2e": []
},
"frontend/src/app/(sidebar)/settings/role-permissions/": {
    "api": [],
    "e2e": ["e2e-tests/role-permissions.spec.ts"]
}
```

The existing wildcard `"backend/app/auth/"` already maps to `["api-tests/test_auth.py", "api-tests/test_rbac.py"]`, so changes to `rbac.py` and `providers.py` automatically trigger those regression tests.

### Step 3.3 -- Automatic Verification (PostToolUse Hook)

The PostToolUse hook reads `test-map.json` and runs affected tests after each edit:

| File Edited | Tests Auto-Run |
|------------|----------------|
| `backend/app/auth/rbac.py` | ALL API tests (via `middleware.py` wildcard) |
| `backend/app/auth/providers.py` | ALL API tests (via wildcard) |
| `backend/app/routers/role_permissions.py` | `api-tests/test_role_permissions.py` |
| `frontend/src/app/(sidebar)/settings/role-permissions/page.tsx` | `e2e-tests/role-permissions.spec.ts` |
| `frontend/src/app/(sidebar)/settings/page.tsx` | `e2e-tests/settings.spec.ts` |

---

## Phase 4: Testing

### Step 4.1 -- API Tests

#### New file: `api-tests/test_role_permissions.py`

**Planned test functions (~20 tests):**

```
# Read endpoints
test_list_all_role_permissions           -- GET / as admin -> 200, all 5 roles present
test_get_role_permissions_admin          -- GET /admin -> wildcard "*:*" present
test_get_role_permissions_governance_lead -- GET /governance_lead -> exact permission match
test_get_role_permissions_invalid_role   -- GET /nonexistent -> 400
test_seed_data_matches_original_rbac    -- Compare DB data vs original hardcoded dict for ALL roles
test_list_available_resources           -- GET /meta/resources -> known resources present

# Write endpoints
test_update_role_permissions            -- PUT /viewer -> permissions replaced, verify via GET
test_add_permission                     -- POST /viewer/permissions -> added, verify via GET
test_remove_permission                  -- DELETE /viewer/permissions -> removed, verify via GET
test_add_duplicate_permission           -- POST with existing permission -> 409
test_remove_nonexistent_permission      -- DELETE with nonexistent -> 404

# Admin protection
test_admin_wildcard_cannot_be_removed   -- PUT /admin -> 400
test_admin_cannot_add_to_admin          -- POST /admin/permissions -> 400
test_admin_cannot_remove_from_admin     -- DELETE /admin/permissions -> 400

# RBAC for the endpoints themselves
test_non_admin_cannot_update_permissions    -- PUT as governance_lead -> 403
test_non_admin_cannot_add_permission        -- POST as governance_lead -> 403
test_viewer_cannot_read_permissions         -- GET as viewer -> 403
test_governance_lead_cannot_read_permissions -- GET as governance_lead -> 403 (no role_permission:read in seed)

# Integration / behavioral
test_permission_change_takes_effect     -- Add governance_request:write to viewer, verify viewer can create request, then remove it
test_update_role_creates_audit_log      -- PUT permissions, verify audit_log entry created
```

#### Existing tests (must pass unchanged -- regression safety):

- `api-tests/test_auth.py` -- 5 tests
- `api-tests/test_rbac.py` -- 15 tests
- All other `api-tests/test_*.py` -- ~66 tests

### Step 4.2 -- E2E Tests

#### New file: `e2e-tests/role-permissions.spec.ts`

**Planned test functions (~6 tests):**

```
test("settings hub shows Role Permissions card")
    -- Navigate to /settings, verify "Role Permissions" link visible

test("navigates to permission matrix page")
    -- Click "Role Permissions" in settings -> /settings/role-permissions, verify h1

test("displays all roles as columns")
    -- Verify column headers: Governance Lead, Domain Reviewer, Requestor, Viewer

test("displays resource rows")
    -- Verify rows: governance_request, domain_review, intake, etc.

test("admin column shows Full Access badge")
    -- Verify "Full Access" text in Admin column

test("can toggle a permission checkbox")
    -- Find viewer/governance_request/write checkbox
    -- Verify unchecked
    -- Click to check
    -- Verify checked state persists after page refresh
    -- Uncheck to restore (cleanup)
```

### Step 4.3 -- Run Affected Tests

**During development** (per-file, after each edit):
```bash
# After modifying rbac.py or providers.py:
python3 -m pytest api-tests/test_auth.py api-tests/test_rbac.py -v --tb=short

# After creating role_permissions.py:
python3 -m pytest api-tests/test_role_permissions.py -v --tb=short

# After creating frontend page:
npx playwright test e2e-tests/role-permissions.spec.ts --reporter=list

# After modifying settings page:
npx playwright test e2e-tests/settings.spec.ts --reporter=list
```

---

## Phase 5: Verification & Completion

### Step 5.1 -- Update Feature Doc

After all code is written and tests pass:
1. Check off each AC in `docs/features/db-driven-rbac.md`
2. Fill in actual test function names in Test Coverage section
3. Set Status from "Draft" to "Implemented"

### Step 5.2 -- Run Full Test Suite

```bash
# Full API test suite (86+ existing + ~20 new = 106+ tests)
python3 -m pytest api-tests/ -v --tb=short

# Full E2E test suite (24+ existing + ~6 new = 30+ tests)
npx playwright test --reporter=list
```

**All tests must pass.** Any failure blocks completion.

### Step 5.3 -- Final Checklist

- [ ] Phase 1: Impact assessment completed (L4/High, full chain, user approved)
- [ ] Phase 2: Feature doc created (`docs/features/db-driven-rbac.md`)
- [ ] Phase 2: Dependency graph updated (`docs/features/_DEPENDENCIES.json`)
- [ ] Phase 3: Schema updated (`scripts/schema.sql` -- role_permission table)
- [ ] Phase 3: Seed script created (`scripts/seed-role-permissions.sql`)
- [ ] Phase 3: `backend/app/auth/rbac.py` -- PermissionCache + DB queries + fallback
- [ ] Phase 3: `backend/app/auth/providers.py` -- async_build_permission_list()
- [ ] Phase 3: `backend/app/auth/__init__.py` -- new exports
- [ ] Phase 3: `backend/app/routers/role_permissions.py` -- new router (6 endpoints)
- [ ] Phase 3: `backend/app/main.py` -- router registered
- [ ] Phase 3: `frontend/src/app/(sidebar)/settings/page.tsx` -- new card
- [ ] Phase 3: `frontend/src/app/(sidebar)/settings/role-permissions/page.tsx` -- new page
- [ ] Phase 3: `scripts/test-map.json` -- new mappings added
- [ ] Phase 4: `api-tests/test_role_permissions.py` -- ~20 new tests passing
- [ ] Phase 4: `e2e-tests/role-permissions.spec.ts` -- ~6 new tests passing
- [ ] Phase 4: All 15 existing `test_rbac.py` tests pass unchanged
- [ ] Phase 4: All 5 existing `test_auth.py` tests pass unchanged
- [ ] Phase 5: Feature doc ACs checked off, status set to "Implemented"
- [ ] Phase 5: Full API suite passes (106+ tests)
- [ ] Phase 5: Full E2E suite passes (30+ tests)

---

## Appendix A: Recommended Implementation Order

This order maximizes early validation and minimizes risk:

| Step | Action | Validation |
|------|--------|-----------|
| 1 | Run seed SQL against database | `SELECT role, COUNT(*) FROM role_permission GROUP BY role` confirms row counts |
| 2 | Modify `rbac.py` -- add PermissionCache, async helpers, rename dict to fallback | Run `test_auth.py` + `test_rbac.py` -- if pass, backward compat confirmed |
| 3 | Modify `providers.py` -- switch to async_build_permission_list | Run `test_auth.py` -- `/auth/me` must return identical data |
| 4 | Create `role_permissions.py` router | Run `test_role_permissions.py` -- new endpoints work |
| 5 | Register router in `main.py` | Run `test_role_permissions.py` |
| 6 | Update `test-map.json` | Verify PostToolUse hook picks up new mappings |
| 7 | Modify `settings/page.tsx` | Run `e2e-tests/settings.spec.ts` |
| 8 | Create `settings/role-permissions/page.tsx` | Run `e2e-tests/role-permissions.spec.ts` |
| 9 | Full test suite | All 106+ API + 30+ E2E pass |
| 10 | Update feature doc + dependency graph | Final review |

**Critical checkpoint**: Steps 2 and 3 are the highest-risk moments. If `test_auth.py` and `test_rbac.py` pass after these steps, the core migration is confirmed safe.

---

## Appendix B: Risk Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| DB unreachable during permission check | Low | Critical (all endpoints 500) | Hardcoded `ROLE_PERMISSIONS_FALLBACK` dict activates automatically. Warning logged. |
| Seed data mismatch (wrong permissions) | Medium | High (wrong access control) | `test_seed_data_matches_original_rbac` test compares every role's permissions against original dict. All 15 `test_rbac.py` tests verify actual endpoint access. |
| Cache serves stale data after update | Low | Medium (delayed propagation) | `PermissionCache.invalidate()` called on every write. 30s TTL as fallback. |
| Admin locks themselves out | Very Low | Critical | API rejects ALL modifications to admin role (400 response). Admin always has `*:*`. |
| Performance degradation | Low | Medium (slower requests) | Cache means 0 DB queries for permission checks after initial load. Only refresh (every 30s) hits DB with single lightweight query. |
| Async/sync mismatch breaks callers | Low | High (import errors) | Sync `check_permission()` preserved with identical signature. Reads from in-memory cache. No caller changes needed. |
| Frontend breaks from API shape change | Very Low | Medium (UI errors) | `/auth/me` response shape is unchanged: same `{permissions: ["resource:scope", ...]}`. Frontend `hasPermission()` logic untouched. |

---

## Appendix C: Rollback Plan

### Option 1: Code-Level Fallback (Zero-Downtime)
The modified `rbac.py` retains the original dict as `ROLE_PERMISSIONS_FALLBACK`. If the `role_permission` table is dropped or emptied, the system automatically falls back to the hardcoded dict. No downtime, no restart needed.

### Option 2: Drop Table (Activates Fallback)
```sql
DROP TABLE IF EXISTS egm.role_permission;
```
The next request triggers a DB query failure, fallback activates, system works as before.

### Option 3: Full Git Revert
```bash
git revert <commit-hash>
```
Restores all files to pre-change state. The `role_permission` table can be left in place (harmless) or dropped.

### Option 4: Emergency Admin Recovery
If admin permissions are corrupted:
```sql
DELETE FROM egm.role_permission WHERE role = 'admin';
INSERT INTO egm.role_permission (role, resource, scope) VALUES ('admin', '*', '*');
```
