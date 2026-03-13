# Closed-Loop Feature Development Output
**Task**: 把现有的硬编码权限系统（DEFAULT_PERMISSIONS dict）改成数据库驱动的 RBAC，管理员可以通过 API 动态修改角色权限，前端 settings 页面可以查看和编辑权限矩阵
**Date**: 2026-03-11
**Skill**: closed-loop-development.md

---

## Phase 1: Impact Assessment

### Step 1.0 — Understand & Explore

**What is being changed?**

The task replaces the hardcoded `ROLE_PERMISSIONS` dict in `backend/app/auth/rbac.py` with a database-driven RBAC system. Currently, `check_permission(role, resource, scope)` reads from an in-process Python dict. The request adds:

1. A new DB table (`role_permission`) that stores role → resource → scope relationships
2. A new router (`rbac.py`) exposing admin APIs for reading and mutating the permission matrix
3. A new frontend settings page (`/settings/permissions`) for the permissions matrix editor UI
4. Changes to `backend/app/auth/rbac.py` and `backend/app/auth/dependencies.py` to consult the DB instead of the hardcode dict

**Existing patterns explored:**

- `backend/app/auth/rbac.py`: Contains `ROLE_PERMISSIONS` dict (5 roles, ~50 resource:scope pairs), plus `check_permission()` and `build_permission_list()`. Both helpers are called by auth infrastructure, not individual routers.
- `backend/app/auth/dependencies.py`: `require_permission(resource, scope)` calls `_check_permission(user.role, resource, scope)` from `rbac.py`. Every router in the system calls this — it is the enforcement point used by all ~15 routers.
- `backend/app/auth/providers.py`: `build_permission_list(role)` is called on every authenticated request to populate `AuthUser.permissions`. This means `rbac.py`'s dict is read on every single API call.
- `backend/app/auth/middleware.py`: `AuthMiddleware` calls `provider.authenticate(request)` per request, which triggers `build_permission_list`. If we replace the dict with a DB call, the middleware execution path hits the database.
- All routers in `backend/app/routers/` use `require_permission(...)` from `app.auth`. Any change to how `check_permission` works immediately affects all routers.
- `api-tests/test_rbac.py`: 16 existing tests verify behavior of the hardcoded permission matrix. These will need review; the test expectations must still pass after DB-driven RBAC is in place.
- `backend/app/routers/user_authorization.py`: Existing pattern for admin-only writes with audit logging — reuse this pattern for the new RBAC router.
- `frontend/src/app/(sidebar)/settings/user-authorization/page.tsx`: Example of how other settings pages work; reuse `useQuery`/`useMutation` + table pattern.

**Implementation options considered:**

Option A — Per-request DB lookup (naive): On every `check_permission()` call, query the DB. Simple but catastrophic for performance — every API endpoint fires an extra SELECT per permission check.

Option B — Per-request cached load with in-memory TTL cache: Load the full permission matrix from DB once per process, cache with a TTL (e.g., 60 seconds). `check_permission()` uses the in-memory cache; a cache-invalidation endpoint flushes it. This balances consistency with performance.

Option C — Load at AuthUser construction time: In `providers.py`, load permissions from DB during `authenticate()` instead of from the hardcoded dict, and cache them on `AuthUser.permissions`. The permission matrix itself is loaded lazily from DB into a process-level cache shared across requests. This is the cleanest approach: the AuthUser already carries a `permissions: list[str]` field, and `check_permission` can check that list directly.

**Selected approach: Option C (process-level permission matrix cache, invalidated via admin API)**

- Keeps `check_permission()` fast (no DB hit on hot path after cache is warm)
- Admin can call `POST /api/rbac/cache/invalidate` after updating permissions, or cache auto-expires (TTL)
- Backward-compatible: old behavior during cold start (DB empty) can fall back to hardcoded defaults, or we seed the DB from the hardcoded dict on migration
- `AuthUser.permissions` list already exists and is used by the frontend

---

### Step 1.1 — Gather Context

**Dependency graph analysis:**

From `_DEPENDENCIES.json`:
- The `auth/` directory is listed under `globalFiles`: `"backend/app/auth/"` — this is explicitly flagged as global infrastructure
- The `test-map.json` wildcard entry: `"backend/app/auth/"` → `["api-tests/test_auth.py", "api-tests/test_rbac.py"]` — changes here trigger both auth and RBAC test suites
- No feature in `_DEPENDENCIES.json` lists `auth/` tables because auth is cross-cutting, not owned by a single feature

**Features using `require_permission` (all affected):**

Every router in `backend/app/routers/` calls `require_permission(...)`. Full enumeration from `main.py`:

| Router | Representative `require_permission` call |
|--------|------------------------------------------|
| `governance_requests.py` | `governance_request:read`, `governance_request:write` |
| `intake.py` | `intake:read`, `intake:write`, `intake_template:read/write` |
| `dispatch_rules.py` | `dispatch_rule:read` (+ `require_role(ADMIN)`) |
| `dispatcher.py` | `governance_request:write` |
| `domain_registry.py` | `domain_registry:read` (+ `require_role(ADMIN)`) |
| `domain_reviews.py` | `domain_review:read`, `domain_review:write` |
| `info_requests.py` | `info_supplement_request:read/write` |
| `dashboard.py` | `dashboard:read` |
| `progress.py` | `progress:read` |
| `audit_log.py` | `audit_log:read` |
| `user_authorization.py` | `user_authorization:read` (+ `require_role(ADMIN)`) |

All of these are indirectly dependent on `rbac.py` via `dependencies.py`.

---

### Step 1.2 — Classify Impact Level

**Impact: L4 — Global**

Justification:
- `backend/app/auth/` is listed in `_DEPENDENCIES.json` `globalFiles`
- `check_permission()` is called on every authenticated API request across all routers
- A new DB table (`role_permission`) is used by no single feature but by all 11 routers
- Changes to `rbac.py` and `dependencies.py` affect the entire API surface

---

### Step 1.3 — Classify Risk Level

**Risk: High**

Justification (multiple high-risk signals apply):
- **Changes RBAC permissions**: The `_ASSESSMENT_FORMAT.md` classification signals explicitly list "changes RBAC" as a High risk signal
- **Requires data migration + seeding**: Need to seed `role_permission` table from the existing hardcoded dict; migration script required
- **Historical data backfill**: The existing `user_role` assignments depend on the implicit permission matrix; existing users' effective permissions must not change on first deploy
- **Structural change to auth layer**: Moving from static dict to DB-backed lookup changes the execution model for every authenticated request
- **Risk of permission gaps during migration**: If DB is empty and code no longer falls back to the dict, all permission checks fail → system-wide 403s

---

### Step 1.4 — Decision Matrix

Impact L4 × Risk High → **Pause: full chain**

---

### Step 1.5 — Output Assessment

## Impact Assessment

**Feature**: DB-Driven RBAC — Dynamic Permission Matrix
**Impact Level**: L4 — Changes `backend/app/auth/` (listed in `globalFiles`); `check_permission()` is called by every authenticated endpoint across all 11 routers; introduces new DB table used system-wide
**Risk Level**: High — Modifies RBAC permission logic (explicitly listed as a High signal); requires DB migration + data seeding; if not done correctly, causes system-wide 403 failures; changes the runtime execution path for every API call
**Decision**: Pause for review — Full dependency chain required

---

### Affected Features

| Feature | Relationship | Specific Impact |
|---------|-------------|-----------------|
| governance-requests | `require_permission("governance_request", "read/write")` on all endpoints | Permission lookup changes from dict to DB cache; all 8 endpoints affected |
| intake-scoping | `require_permission("intake", "read/write")` and `require_permission("intake_template", ...)` | All intake endpoints affected |
| domain-dispatch | `require_permission("dispatch_rule:read")`, `require_permission("domain_registry:read")`, `require_permission("domain_review:read/write")` | All domain and dispatch endpoints affected |
| project-linking | `require_permission` used indirectly via governance_requests router | Affected transitively |
| user-authorization | `require_permission("user_authorization", "read")` | Admin UI depends on this; also the model for the new RBAC admin router |
| auth | Direct: `rbac.py`, `dependencies.py`, `providers.py`, `middleware.py` all modified | Core auth layer changes |
| audit-log | `require_permission("audit_log", "read")` | Affected; also audit log will gain new entries for permission changes |
| dashboard | `require_permission("dashboard", "read")` | Affected |
| progress | `require_permission("progress", "read")` | Affected |

---

### Schema Changes

- [ ] **New table**: `role_permission` (columns: `id UUID PK`, `role VARCHAR NOT NULL`, `resource VARCHAR NOT NULL`, `scope VARCHAR NOT NULL`, `is_active BOOLEAN DEFAULT TRUE`, `create_by VARCHAR`, `create_at TIMESTAMP`, `update_by VARCHAR`, `update_at TIMESTAMP`, `UNIQUE(role, resource, scope)`)
- [ ] **Migration script required**: Yes — must seed all rows from the current `ROLE_PERMISSIONS` hardcoded dict to ensure zero behavior change on first deploy
- [ ] **Rollback plan**: Keep `ROLE_PERMISSIONS` dict in place as fallback (see Phase 3.0); drop `role_permission` table on rollback

---

### Affected Acceptance Criteria (from existing feature docs)

> governance-requests.md AC-6: "A verdict can only be recorded on a request in 'In Review' status with all domain reviews complete and no open ISRs"
> --> Unaffected by RBAC change itself. But the endpoint uses `require_permission("governance_request", "write")` — if that permission is not seeded correctly, verdict endpoint returns 403 instead of executing the guard logic.

> governance-requests.md AC-9: "Only Draft requests can be deleted; deleting a non-Draft request returns 400"
> --> Same pattern as AC-6: the delete endpoint is RBAC-guarded. Permissions must be seeded.

> domain-dispatch.md AC-16: "All endpoints enforce RBAC — admin-only for write operations on rules and domains"
> --> Directly affected. Currently enforced via `require_role(Role.ADMIN)` (not `require_permission`). These use the role-based path, not resource-based, so they are unaffected by the `role_permission` table — but must be verified. If a future admin changes permissions, `require_role` calls bypass the DB table entirely. This creates a split-enforcement model that needs a design decision.

> intake-scoping.md AC-14: "All endpoints enforce RBAC via `require_permission` or `require_role`"
> --> The AC is met via `require_permission`, which will change its data source. All existing RBAC behavior must be preserved by seeding. No AC text changes required, but the implementation path changes.

> domain-dispatch.md AC-1: "Admins can create, list, update, and soft-delete dispatch rules"
> --> Uses `require_role(Role.ADMIN)` not `require_permission`. Unaffected by permission table changes, but creates design inconsistency if admins can edit the permission matrix and remove their own role's write access.

> governance-requests.md (all ACs): No RBAC-specific ACs exist in this doc, but every endpoint is RBAC-guarded. The ACs implicitly rely on the current permissions being stable.

> project-linking.md: No RBAC-specific ACs. Only `require_auth` or `require_permission` calls indirectly via governance_requests.py.

---

### Affected API Contracts

- `GET /api/auth/me` (if it exists) — `AuthUser.permissions` list populated from `build_permission_list()` changes from dict-sourced to DB-sourced; response shape unchanged but values depend on DB state
- **New endpoints** added:
  - `GET /api/rbac/permissions` — returns full permission matrix (all roles × resources × scopes)
  - `GET /api/rbac/permissions/{role}` — returns permissions for a single role
  - `PUT /api/rbac/permissions/{role}/{resource}/{scope}` — grant/revoke a specific permission
  - `POST /api/rbac/permissions/reset` — reset to hardcoded defaults
  - `POST /api/rbac/cache/invalidate` — flush the in-memory permission cache
- No existing endpoint response shapes change

---

### Test Impact

**Existing tests needing review:**
- `api-tests/test_rbac.py`: All 16 tests verify role-based access behavior. After migration, the DB must be seeded with the same permissions as the hardcoded dict, so all 16 tests should continue to pass without modification. However, they must be run against the seeded DB, not against the hardcoded dict.
- `api-tests/test_auth.py`: May test `AuthUser.permissions` field; will need verification that permissions are populated correctly from DB.
- All 86+ other API tests: Any test that hits a guarded endpoint implicitly tests RBAC. These should pass without change if seeding is correct.

**New tests needed:**
- `api-tests/test_rbac_admin.py`:
  - `test_get_permission_matrix` — AC coverage: list all permissions
  - `test_get_permissions_for_role` — AC coverage: get by role
  - `test_grant_permission` — AC coverage: admin can add a scope
  - `test_revoke_permission` — AC coverage: admin can remove a scope
  - `test_revoke_permission_takes_effect` — AC coverage: after revoke, 403 is returned
  - `test_grant_permission_takes_effect` — AC coverage: after grant, 200 is returned
  - `test_non_admin_cannot_modify_permissions` — AC coverage: 403 for non-admin
  - `test_reset_to_defaults` — AC coverage: reset restores hardcoded permissions
  - `test_cache_invalidate` — AC coverage: cache flush endpoint returns 200
- `e2e-tests/settings-permissions.spec.ts`:
  - "permissions matrix page loads" — permissions grid renders
  - "admin can toggle a permission cell" — click on cell changes permission
  - "non-admin cannot access permissions page" — page returns 403 or redirects

---

### Full Dependency Chain

```
auth/ (directly affected — rbac.py, dependencies.py, providers.py)
  └─ governance-requests (require_permission on all 8 endpoints)
      └─ intake-scoping (require_permission; reads governance_request)
          └─ domain-dispatch (reads intake_response for dispatch evaluation)
      └─ domain-dispatch (domain_review FK → governance_request)
      └─ project-linking (project FK → governance_request)
  └─ intake-scoping (require_permission on all intake endpoints)
  └─ domain-dispatch (require_permission on all dispatch/review endpoints)
  └─ user-authorization (require_permission on user_authorization:read)
  └─ audit-log (require_permission on audit_log:read)
  └─ dashboard (require_permission on dashboard:read)
  └─ progress (require_permission on progress:read)
```

All feature docs reviewed. Affected ACs listed above. Summary:
- governance-requests.md: no RBAC-specific ACs, but all endpoints guarded — seeding is critical
- intake-scoping.md AC-14: RBAC enforcement AC — must pass after migration
- domain-dispatch.md AC-16: RBAC enforcement AC — uses `require_role` (not `require_permission`), design decision needed
- project-linking.md: no RBAC-specific ACs
- user-authorization: no spec doc yet, but existing tests cover it

---

### Step 1.6 — Gate Decision

**Decision: Pause for user review** (High Risk × L4 Global)

This plan must be approved before implementation begins. Key questions for the user:

1. **Split enforcement model**: Some endpoints use `require_role(ADMIN)` and some use `require_permission(...)`. Should `require_role` calls also be migrated to the permission table, or left as-is? Making them DB-driven is more consistent but expands scope significantly.
2. **Cache TTL vs explicit invalidation**: Should permission changes take effect immediately (requires invalidation endpoint or per-request DB call) or after a TTL expiry? A 60-second TTL is low-latency in practice; explicit invalidation endpoint gives instant effect.
3. **Admin self-lockout protection**: Should the API prevent an admin from revoking their own admin permissions (which would prevent any future changes)? Recommend: yes, add a guard.
4. **Wildcard admin handling**: The current `ROLE_PERMISSIONS` uses `"*": ["*"]` for `admin`. The DB table cannot directly represent wildcards. Two options: (a) store a sentinel row `(admin, *, *)` and handle it specially in `check_permission`; (b) treat admin as special-cased in code and don't put admin permissions in the table at all.

---

## Phase 2: Feature Documentation

*(Note: This phase produces the feature spec. Since this is a planning output only, the spec is drafted here rather than written to disk.)*

### Step 2.1 — Feature Doc Draft

**File**: `docs/features/db-driven-rbac.md`

```markdown
# Feature: DB-Driven RBAC — Dynamic Permission Matrix

**Status**: Draft
**Date**: 2026-03-11
**Spec Version**: 1

## Impact Assessment

**Feature**: DB-Driven RBAC — Dynamic Permission Matrix
**Impact Level**: L4 — Global infrastructure change (auth/ in globalFiles); all 11 routers affected
**Risk Level**: High — Changes RBAC enforcement logic; requires DB migration + seeding; system-wide 403 risk if seeding fails
**Decision**: Pause for review (presented to user before implementation)

## Summary

Replaces the hardcoded `ROLE_PERMISSIONS` dict in `backend/app/auth/rbac.py` with a DB-backed
permission table (`role_permission`). Admins can dynamically grant or revoke resource:scope permissions
per role via a new API and frontend permissions matrix UI. A process-level in-memory cache (with TTL
and explicit invalidation endpoint) keeps the hot path fast.

## Affected Files

### Backend
- `backend/app/auth/rbac.py` — Replace `ROLE_PERMISSIONS` dict with DB-backed cache; update
  `check_permission()` and `build_permission_list()` to read from cache
- `backend/app/auth/providers.py` — `build_permission_list(role)` calls updated cache loader;
  no signature change
- `backend/app/routers/rbac.py` — NEW: admin CRUD for the permission matrix + cache invalidation
- `backend/app/main.py` — Register new `rbac` router at `/api/rbac`

### Frontend
- `frontend/src/app/(sidebar)/settings/permissions/page.tsx` — NEW: Permission matrix editor
  (grid of roles × resources with scope toggles)
- `frontend/src/app/(sidebar)/settings/page.tsx` — Add "Permissions" entry to settings index

### Database
- `scripts/schema.sql` — New table: `role_permission`
- `scripts/migrate_rbac_seed.sql` — NEW migration: create table + INSERT seed data from current dict

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/rbac/permissions` | `rbac:read` (admin+) | Full permission matrix |
| GET | `/api/rbac/permissions/{role}` | `rbac:read` (admin+) | Permissions for one role |
| PUT | `/api/rbac/permissions/{role}/{resource}/{scope}` | Role: ADMIN | Grant a permission |
| DELETE | `/api/rbac/permissions/{role}/{resource}/{scope}` | Role: ADMIN | Revoke a permission |
| POST | `/api/rbac/permissions/reset` | Role: ADMIN | Reset to hardcoded defaults |
| POST | `/api/rbac/cache/invalidate` | Role: ADMIN | Flush in-memory permission cache |

### GET /api/rbac/permissions Response Shape
```json
{
  "matrix": {
    "admin": { "*": ["*"] },
    "governance_lead": {
      "governance_request": ["read", "write"],
      "intake": ["read", "write"],
      ...
    },
    ...
  },
  "roles": ["admin", "governance_lead", "domain_reviewer", "requestor", "viewer"],
  "resources": ["governance_request", "intake", "domain_registry", ...],
  "allScopes": ["read", "write", "assign", "execute"]
}
```

## UI Behavior

### Permissions Matrix Page (`/settings/permissions`)
- Accessible to Admin role only; non-admin sees 403 redirect
- Displays a 2D grid: rows = resources, columns = roles
- Each cell shows scope badges (read, write, assign, execute) that toggle on/off
- Clicking a scope badge calls PUT (grant) or DELETE (revoke)
- After any change, a "Refresh Cache" button becomes active and calls POST /rbac/cache/invalidate
- A "Reset to Defaults" button at the bottom restores the hardcoded permission set (with confirmation dialog)
- Admin role row is read-only (cannot remove admin permissions)

### Settings Index (`/settings`)
- Add "Permissions" card linking to `/settings/permissions`

### Error States
- Attempting to revoke admin's own role returns 400 with "Cannot revoke admin permissions"
- Non-admin accessing the page: redirect to 403 page or back to settings
- Network error on toggle: revert optimistic UI update, show error toast

## Acceptance Criteria

- [ ] AC-1: `GET /api/rbac/permissions` returns the full permission matrix for all roles
- [ ] AC-2: `GET /api/rbac/permissions/{role}` returns permissions for a single role; 404 if role is invalid
- [ ] AC-3: Admin can grant a permission via `PUT /api/rbac/permissions/{role}/{resource}/{scope}`; subsequent permission checks reflect the change
- [ ] AC-4: Admin can revoke a permission via `DELETE /api/rbac/permissions/{role}/{resource}/{scope}`; subsequent permission checks return 403 for that resource:scope
- [ ] AC-5: After revoking a permission, the in-memory cache is either auto-invalidated (TTL) or explicitly flushed, and the change takes effect within the TTL window
- [ ] AC-6: `POST /api/rbac/permissions/reset` restores the permission matrix to the hardcoded default values
- [ ] AC-7: `POST /api/rbac/cache/invalidate` flushes the process-level permission cache; next request reloads from DB
- [ ] AC-8: Admin cannot revoke permissions for the `admin` role; endpoint returns 400
- [ ] AC-9: Non-admin users cannot call any write endpoint on `/api/rbac/`; endpoints return 403
- [ ] AC-10: On application startup or cold cache, the permission matrix is loaded from DB; if DB table is empty, falls back to hardcoded defaults
- [ ] AC-11: The migration script seeds the `role_permission` table from the current hardcoded dict; existing permission behavior is unchanged after migration
- [ ] AC-12: All changes to the permission matrix are recorded in the `audit_log` table
- [ ] AC-13: The frontend permissions page renders a matrix of roles × resources with scope toggle controls
- [ ] AC-14: Toggling a scope badge in the UI calls the grant/revoke API and reflects the updated state
- [ ] AC-15: "Reset to Defaults" button shows a confirmation dialog before resetting
- [ ] AC-16: All existing RBAC tests (`api-tests/test_rbac.py`) continue to pass after migration without modification
- [ ] AC-17: The settings page includes a "Permissions" entry linking to the matrix editor

## Test Coverage

### API Tests (`api-tests/test_rbac_admin.py`)
- `test_get_permission_matrix` — covers AC-1
- `test_get_permissions_for_role` — covers AC-2
- `test_grant_permission` — covers AC-3
- `test_revoke_permission` — covers AC-4
- `test_revoke_permission_takes_effect` — covers AC-4, AC-5
- `test_grant_permission_takes_effect` — covers AC-3, AC-5
- `test_non_admin_cannot_modify_permissions` — covers AC-9
- `test_reset_to_defaults` — covers AC-6
- `test_cache_invalidate` — covers AC-7
- `test_cannot_revoke_admin_permissions` — covers AC-8
- `test_cold_cache_fallback` — covers AC-10
- `test_permission_change_audit_logged` — covers AC-12

### Regression Tests (existing, must still pass)
- `api-tests/test_rbac.py` (all 16 tests) — covers AC-16

### E2E Tests (`e2e-tests/settings-permissions.spec.ts`)
- `"permissions matrix page loads"` — covers AC-13
- `"admin can toggle a permission cell"` — covers AC-14
- `"reset to defaults shows confirmation dialog"` — covers AC-15
- `"non-admin cannot access permissions page"` — covers AC-9 (frontend guard)
- `"settings page shows permissions entry"` — covers AC-17

## Test Map Entries

```
backend/app/auth/rbac.py                          -> api-tests/test_rbac.py, api-tests/test_rbac_admin.py
backend/app/routers/rbac.py                       -> api-tests/test_rbac_admin.py
frontend/src/app/(sidebar)/settings/permissions/  -> e2e-tests/settings-permissions.spec.ts
frontend/src/app/(sidebar)/settings/page.tsx      -> e2e-tests/settings.spec.ts
```

## Notes

- Admin wildcard handling: The `admin` role uses `"*": ["*"]` in the hardcoded dict. In the DB table, store a sentinel row `(admin, *, *)`. The `check_permission()` cache loader will detect this row and short-circuit to `True` for admin. The UI displays the admin row as "Full Access (read-only)" without toggle controls.
- Cache strategy: A module-level `dict` in `rbac.py` acts as the cache, populated lazily on first access and on cache invalidation. A `_cache_loaded_at` timestamp enables TTL expiry (default 60 seconds). The `POST /rbac/cache/invalidate` endpoint sets `_cache_loaded_at = 0` to force reload on next access.
- Backward compatibility: Keep the `ROLE_PERMISSIONS` dict in `rbac.py` as `_DEFAULT_PERMISSIONS`. The DB-loader falls back to it if the `role_permission` table is empty (AC-10). This ensures zero-downtime migration.
- Seeding: `scripts/migrate_rbac_seed.sql` is idempotent (uses `INSERT ... ON CONFLICT DO NOTHING`). It can be re-run without harm.
```

---

### Step 2.2 — Dependency Graph Updates

The `_DEPENDENCIES.json` must be updated to add the new `rbac` feature entry and the new shared table.

**Changes to `docs/features/_DEPENDENCIES.json`:**

1. Add new feature entry:
```json
"rbac": {
  "doc": "docs/features/db-driven-rbac.md",
  "tables": ["role_permission"],
  "routers": ["rbac.py"],
  "frontendPaths": [
    "frontend/src/app/(sidebar)/settings/permissions/"
  ]
}
```

2. Add `role_permission` to `sharedTables` (used by auth layer, indirectly touches all features):
```json
"role_permission": ["rbac", "auth"]
```

3. Add new edge from `rbac` to `auth`:
```json
{
  "from": "rbac",
  "to": "auth",
  "type": "data_read",
  "detail": "rbac.py reads role_permission table; auth/rbac.py loads permission matrix from role_permission for check_permission()"
}
```

4. Update `globalFiles` to note that `backend/app/auth/rbac.py` now also depends on `role_permission` table (comment in JSON, not a structural change to `globalFiles` array).

---

## Phase 3: Implementation (Plan Only — No Code Written)

### Step 3.0 — Implementation Strategy

**Phased delivery plan (each phase leaves system in working state):**

#### Phase 3-A: Database Migration + Seeding
**Files**: `scripts/schema.sql`, `scripts/migrate_rbac_seed.sql`
**Goal**: Create `role_permission` table and seed it from current hardcoded dict.
**Leaves system in**: Working state — table exists but code still uses dict. No behavior change.

SQL for table creation:
```sql
CREATE TABLE IF NOT EXISTS role_permission (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role        VARCHAR NOT NULL,
    resource    VARCHAR NOT NULL,
    scope       VARCHAR NOT NULL,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    create_by   VARCHAR,
    create_at   TIMESTAMP DEFAULT NOW(),
    update_by   VARCHAR,
    update_at   TIMESTAMP DEFAULT NOW(),
    UNIQUE(role, resource, scope)
);
```

Seed script (idempotent):
```sql
INSERT INTO role_permission (role, resource, scope, create_by) VALUES
  ('admin', '*', '*', 'system'),
  ('governance_lead', 'governance_request', 'read', 'system'),
  ('governance_lead', 'governance_request', 'write', 'system'),
  -- ... all rows from ROLE_PERMISSIONS dict ...
ON CONFLICT (role, resource, scope) DO NOTHING;
```

**Rollback**: `DROP TABLE role_permission;`

#### Phase 3-B: Backend Cache Loader in `rbac.py`
**Files**: `backend/app/auth/rbac.py`
**Goal**: Add `load_permission_cache()` async function that reads from `role_permission` table and populates a module-level dict. Keep `ROLE_PERMISSIONS` as `_DEFAULT_PERMISSIONS`. `check_permission()` checks the cache first; if not loaded yet, triggers a load. Falls back to `_DEFAULT_PERMISSIONS` if DB returns empty.

Key implementation points:
- Module-level: `_permission_cache: dict | None = None` and `_cache_loaded_at: float = 0`
- `TTL_SECONDS = 60`
- `async def _load_cache(db: AsyncSession) -> None`: reads all `is_active = TRUE` rows from `role_permission`, builds dict matching `ROLE_PERMISSIONS` structure, sets `_permission_cache` and `_cache_loaded_at`
- `def check_permission(role: Role, resource: str, scope: str) -> bool`: if cache is warm (not None and not expired), use it; otherwise use `_DEFAULT_PERMISSIONS` as synchronous fallback (DB load happens asynchronously on next authenticated request)
- `async def refresh_permission_cache(db: AsyncSession) -> None`: public function called by the invalidate endpoint and by `providers.py` on each auth call (lazy load)

**Backward compatibility**: If `role_permission` table is empty, cache is empty, falls back to `_DEFAULT_PERMISSIONS`. Zero behavior change during rollout.

**Rollback**: Revert `rbac.py` to use `ROLE_PERMISSIONS` dict directly. Cache loader functions removed.

#### Phase 3-C: Update `providers.py` to Load Cache
**Files**: `backend/app/auth/providers.py`
**Goal**: Call `refresh_permission_cache(session)` during `authenticate()` so the cache is warm after first login.

Specifically, in `DevAuthProvider.authenticate()` and `KeycloakAuthProvider.authenticate()`:
- After resolving `role`, call `await ensure_permission_cache_loaded(session)` (a lightweight check: only fetches from DB if cache is cold or expired)
- Then call `build_permission_list(role)` as before (now reads from warm cache)

This approach means the first request after startup (or after TTL expiry) will have a slightly slower auth round-trip (one extra SELECT), but all subsequent requests are fast.

**Rollback**: Remove the `ensure_permission_cache_loaded` call; `build_permission_list` reverts to using `ROLE_PERMISSIONS`.

#### Phase 3-D: New `rbac.py` Router
**Files**: `backend/app/routers/rbac.py`, `backend/app/main.py`
**Goal**: Expose the admin CRUD API for the permission matrix.

Router structure:
```python
router = APIRouter()

@router.get("/permissions", dependencies=[Depends(require_role(Role.ADMIN))])
async def get_permission_matrix(db: AsyncSession = Depends(get_db)): ...

@router.get("/permissions/{role}", dependencies=[Depends(require_role(Role.ADMIN))])
async def get_permissions_for_role(role: str, db: AsyncSession = Depends(get_db)): ...

@router.put("/permissions/{role}/{resource}/{scope}", dependencies=[Depends(require_role(Role.ADMIN))])
async def grant_permission(role: str, resource: str, scope: str, user: AuthUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)): ...
    # Guard: if role == "admin", return 400
    # INSERT INTO role_permission ... ON CONFLICT DO UPDATE SET is_active = TRUE
    # Write audit_log entry
    # Invalidate cache

@router.delete("/permissions/{role}/{resource}/{scope}", dependencies=[Depends(require_role(Role.ADMIN))])
async def revoke_permission(role: str, resource: str, scope: str, user: AuthUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)): ...
    # Guard: if role == "admin", return 400
    # UPDATE role_permission SET is_active = FALSE WHERE role=... AND resource=... AND scope=...
    # Write audit_log entry
    # Invalidate cache

@router.post("/permissions/reset", dependencies=[Depends(require_role(Role.ADMIN))])
async def reset_permissions(user: AuthUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)): ...
    # DELETE all rows, re-seed from _DEFAULT_PERMISSIONS
    # Invalidate cache

@router.post("/cache/invalidate", dependencies=[Depends(require_role(Role.ADMIN))])
async def invalidate_cache(): ...
    # Set _cache_loaded_at = 0
    # Return {"status": "cache invalidated"}
```

Register in `main.py`:
```python
from app.routers import rbac
app.include_router(rbac.router, prefix="/api/rbac", tags=["RBAC"])
```

#### Phase 3-E: Frontend — Permissions Matrix Page
**Files**: `frontend/src/app/(sidebar)/settings/permissions/page.tsx`, `frontend/src/app/(sidebar)/settings/page.tsx`

Component design:
```typescript
// Fetches GET /api/rbac/permissions
// Renders a table: rows = resources, columns = roles
// Each cell contains scope pills (read, write, assign, execute)
// Clicking a pill calls PUT (to grant) or DELETE (to revoke)
// Optimistic UI: toggle immediately, revert on API error
// After any change, shows "Invalidate Cache" button
// "Reset to Defaults" button with window.confirm() dialog
// Admin column: all cells are read-only (grayed out)
```

Add to settings index page:
```typescript
{ label: 'Permissions', href: '/settings/permissions', description: 'Manage role-based permission matrix for all resources' },
```

---

### Step 3.2 — Test Map Updates

New entries to add to `scripts/test-map.json`:

```json
"backend/app/routers/rbac.py": {
  "api": ["api-tests/test_rbac_admin.py"],
  "e2e": []
},
"frontend/src/app/(sidebar)/settings/permissions/": {
  "api": [],
  "e2e": ["e2e-tests/settings-permissions.spec.ts"]
}
```

Update existing wildcard for `backend/app/auth/`:
```json
"backend/app/auth/": {
  "api": ["api-tests/test_auth.py", "api-tests/test_rbac.py", "api-tests/test_rbac_admin.py"],
  "e2e": []
}
```

Update `frontend/src/app/(sidebar)/settings/` wildcard to also include `settings-permissions.spec.ts`:
```json
"frontend/src/app/(sidebar)/settings/": {
  "api": [],
  "e2e": ["e2e-tests/settings.spec.ts", "e2e-tests/settings-permissions.spec.ts"]
}
```

---

## Phase 4: Testing (Plan Only — No Tests Written)

### Step 4.1 — API Test Plan: `api-tests/test_rbac_admin.py`

All tests use the existing `_client_as(role)` helper from `test_rbac.py`. Test list with AC coverage:

```python
# Fixtures needed: standard db + seeded role_permission table

def test_get_permission_matrix():
    """AC-1: GET /rbac/permissions returns all roles and their resource:scope pairs."""
    with _client_as("admin") as c:
        resp = c.get("/rbac/permissions")
        assert resp.status_code == 200
        body = resp.json()
        assert "matrix" in body
        assert "governance_lead" in body["matrix"]
        assert "read" in body["matrix"]["governance_lead"]["governance_request"]

def test_get_permissions_for_role():
    """AC-2: GET /rbac/permissions/{role} returns permissions for one role."""
    with _client_as("admin") as c:
        resp = c.get("/rbac/permissions/requestor")
        assert resp.status_code == 200
        assert "governance_request" in resp.json()

def test_get_permissions_invalid_role():
    """AC-2: 404 on unknown role."""
    with _client_as("admin") as c:
        resp = c.get("/rbac/permissions/not_a_role")
        assert resp.status_code == 404

def test_grant_permission():
    """AC-3: Admin grants a new scope; it appears in the matrix."""
    with _client_as("admin") as c:
        # Viewer does not have intake:write
        resp = c.put("/rbac/permissions/viewer/intake/write")
        assert resp.status_code == 200
        matrix = c.get("/rbac/permissions").json()
        assert "write" in matrix["matrix"]["viewer"].get("intake", [])

def test_revoke_permission():
    """AC-4: Admin revokes a scope; it disappears from the matrix."""
    with _client_as("admin") as c:
        resp = c.delete("/rbac/permissions/viewer/governance_request/read")
        assert resp.status_code == 200
        matrix = c.get("/rbac/permissions").json()
        assert "read" not in matrix["matrix"].get("viewer", {}).get("governance_request", [])

def test_revoke_permission_takes_effect():
    """AC-4, AC-5: After revoking + invalidating cache, endpoint returns 403."""
    with _client_as("admin") as c:
        c.delete("/rbac/permissions/viewer/governance_request/read")
        c.post("/rbac/cache/invalidate")
    with _client_as("viewer") as c:
        resp = c.get("/governance-requests")
        assert resp.status_code == 403

def test_grant_permission_takes_effect():
    """AC-3, AC-5: After granting + invalidating cache, endpoint returns 200."""
    # Viewer normally cannot write governance_request; grant it
    with _client_as("admin") as c:
        c.put("/rbac/permissions/viewer/governance_request/write")
        c.post("/rbac/cache/invalidate")
    with _client_as("viewer") as c:
        resp = c.post("/governance-requests", json={"title": "Viewer Write Test"})
        assert resp.status_code == 200

def test_non_admin_cannot_modify_permissions():
    """AC-9: Non-admin gets 403 on write endpoints."""
    with _client_as("governance_lead") as c:
        resp = c.put("/rbac/permissions/viewer/intake/write")
        assert resp.status_code == 403

def test_reset_to_defaults():
    """AC-6: Reset endpoint restores original permissions."""
    with _client_as("admin") as c:
        c.delete("/rbac/permissions/viewer/governance_request/read")
        c.post("/rbac/permissions/reset")
        c.post("/rbac/cache/invalidate")
    # After reset, viewer should have read access again
    with _client_as("viewer") as c:
        resp = c.get("/governance-requests")
        assert resp.status_code == 200

def test_cache_invalidate():
    """AC-7: Cache invalidation endpoint returns 200."""
    with _client_as("admin") as c:
        resp = c.post("/rbac/cache/invalidate")
        assert resp.status_code == 200

def test_cannot_revoke_admin_permissions():
    """AC-8: Admin cannot revoke admin's own permissions."""
    with _client_as("admin") as c:
        resp = c.delete("/rbac/permissions/admin/governance_request/read")
        assert resp.status_code == 400
        assert "admin" in resp.json()["detail"].lower()

def test_cold_cache_fallback():
    """AC-10: If role_permission table is empty, falls back to defaults."""
    # This test requires a special fixture that empties role_permission;
    # then verifies that permission checks still work via hardcoded defaults.
    # Implementation note: use a test-specific fixture with TRUNCATE + ROLLBACK.

def test_permission_change_audit_logged():
    """AC-12: Grant/revoke writes to audit_log."""
    with _client_as("admin") as c:
        c.put("/rbac/permissions/viewer/intake/execute")
        # Check audit_log for a record with entity_type='role_permission'
        logs = c.get("/audit-log").json()
        # Verify entry exists (exact field depends on audit_log response shape)
        assert any(e.get("entityType") == "role_permission" for e in logs.get("data", []))
```

**Regression**: Confirm all 16 tests in `api-tests/test_rbac.py` still pass after migration (AC-16). No test modifications expected; seeding ensures behavior is identical.

---

### Step 4.2 — E2E Test Plan: `e2e-tests/settings-permissions.spec.ts`

```typescript
import { test, expect } from '@playwright/test';

test.describe('Permissions Matrix Page', () => {
  test('permissions matrix page loads', async ({ page }) => {
    // Login as admin (via X-Dev-Role header or dev auth)
    await page.goto('/settings/permissions');
    await expect(page.getByRole('heading', { name: /permissions/i })).toBeVisible();
    // Grid with role columns should be visible
    await expect(page.getByText('governance_lead')).toBeVisible();
    await expect(page.getByText('governance_request')).toBeVisible();
  });

  test('admin can toggle a permission cell', async ({ page }) => {
    await page.goto('/settings/permissions');
    // Find a toggleable scope badge and click it
    const badge = page.locator('[data-testid="scope-toggle-viewer-intake-write"]');
    const initialState = await badge.getAttribute('data-active');
    await badge.click();
    // State should have changed
    await expect(badge).not.toHaveAttribute('data-active', initialState);
  });

  test('reset to defaults shows confirmation dialog', async ({ page }) => {
    await page.goto('/settings/permissions');
    page.on('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: /reset to defaults/i }).click();
    // After confirm, success toast or page reload
    await expect(page.getByText(/reset/i)).toBeVisible();
  });

  test('non-admin cannot access permissions page', async ({ page }) => {
    // Set X-Dev-Role to governance_lead via cookie or request interception
    await page.goto('/settings/permissions');
    // Should redirect to 403 or settings page
    await expect(page).not.toHaveURL('/settings/permissions');
  });

  test('settings page shows permissions entry', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('link', { name: /permissions/i })).toBeVisible();
  });
});
```

---

## Phase 5: Verification Checklist

*(To be completed after implementation — not applicable in planning-only mode)*

### Step 5.1 — Feature Doc Status

The feature doc `docs/features/db-driven-rbac.md` should be set to **"Implemented"** after all ACs are checked off and tests pass.

AC checklist (to be filled during implementation):
- [ ] AC-1: `GET /api/rbac/permissions` returns full matrix
- [ ] AC-2: `GET /api/rbac/permissions/{role}` returns role permissions; 404 on invalid
- [ ] AC-3: Admin can grant permissions
- [ ] AC-4: Admin can revoke permissions
- [ ] AC-5: Permission changes take effect after cache invalidation
- [ ] AC-6: Reset restores defaults
- [ ] AC-7: Cache invalidation endpoint works
- [ ] AC-8: Cannot revoke admin permissions
- [ ] AC-9: Non-admin cannot use write endpoints (403)
- [ ] AC-10: Cold cache falls back to hardcoded defaults
- [ ] AC-11: Migration seeds without behavior change
- [ ] AC-12: Changes are audit logged
- [ ] AC-13: Frontend matrix renders
- [ ] AC-14: Toggle calls API and reflects state
- [ ] AC-15: Reset requires confirmation
- [ ] AC-16: All 16 existing RBAC tests still pass
- [ ] AC-17: Settings index has Permissions entry

### Step 5.2 — Full Test Suite (to run after implementation)

```bash
# All API tests (86+ expected, new total ~100)
python3 -m pytest api-tests/ -v --tb=short

# All E2E tests (24+ expected, new total ~29)
npx playwright test --reporter=list
```

### Step 5.3 — Final Checklist

- [ ] Impact Assessment completed — Phase 1 (L4, High, Full Chain)
- [ ] Feature doc `docs/features/db-driven-rbac.md` created with all 17 ACs — Phase 2
- [ ] `_DEPENDENCIES.json` updated with new `rbac` feature entry and `role_permission` table — Phase 2.2
- [ ] Code implemented in 5 phases (DB migration, rbac.py cache, providers.py update, router, frontend) — Phase 3
- [ ] `scripts/test-map.json` updated for new files — Phase 3.2
- [ ] API tests written in `api-tests/test_rbac_admin.py` (12 new tests) — Phase 4.1
- [ ] Existing `api-tests/test_rbac.py` regression confirmed (16 tests, no changes needed) — Phase 4.1
- [ ] E2E tests written in `e2e-tests/settings-permissions.spec.ts` (5 new tests) — Phase 4.2
- [ ] Feature doc status set to "Implemented" — Phase 5.1
- [ ] Full test suite passing — Phase 5.2

---

## Summary

This is an **L4 × High** change that touches the core authentication infrastructure used by every endpoint in the system. The key risks are:

1. **System-wide 403 on bad migration**: Mitigated by seeding the `role_permission` table before switching code, and by keeping `_DEFAULT_PERMISSIONS` as a cold-cache fallback (AC-10).
2. **Performance regression from DB hits on hot path**: Mitigated by the process-level in-memory cache with 60-second TTL. Only cold starts and explicit invalidations hit the DB.
3. **Split enforcement model** (`require_role` vs `require_permission`): Endpoints using `require_role(ADMIN)` (dispatch rules, domain registry writes, user authorization writes, new RBAC router) are NOT affected by the permission table. This is a conscious design choice: admin-only operations remain hardcoded, while resource-level permissions are configurable. This decision should be confirmed with the user before implementation.
4. **Admin self-lockout**: Mitigated by the guard in the revoke endpoint (AC-8).

The implementation is planned in 5 additive phases, each leaving the system in a working state, with full rollback paths documented at each phase.
