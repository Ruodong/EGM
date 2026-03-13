# Feature: Authentication & RBAC

**Status**: Implemented
**Date**: 2026-03-12
**Spec Version**: 1

## Summary

Provides authentication and role-based access control (RBAC) for all EGM endpoints. Supports two modes: **Dev mode** (header-based identity switching for local development) and **Production mode** (Keycloak OIDC with JWT tokens). Five roles define a permission matrix that gates every API endpoint.

## Affected Files

### Backend
- `backend/app/auth/__init__.py` — Exports `require_permission`, `require_role`, `get_current_user`
- `backend/app/auth/models.py` — `AuthUser` dataclass and `Role` enum (admin, governance_lead, domain_reviewer, requestor, viewer)
- `backend/app/auth/providers.py` — `DevAuthProvider` (X-Dev-User / X-Dev-Role headers) and `KeycloakAuthProvider` (JWT decode + JWKS caching)
- `backend/app/auth/rbac.py` — `ROLE_PERMISSIONS` matrix, `check_permission()`, `build_permission_list()`
- `backend/app/routers/auth.py` — `/auth/me`, `/auth/permissions`, `/auth/token` endpoints

### Frontend
- `frontend/src/lib/auth-context.tsx` — AuthProvider React context; fetches `/auth/me`; stores current user in state; provides `switchUser()` for dev mode
- `frontend/src/components/layout/Header.tsx` — Switch User dropdown (dev mode only); persists selected user in localStorage

### Database
- `scripts/schema.sql` — `user_role` table (itcode PK, role, assigned_by, timestamps); `employee_info` table (synced from EAM)

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/auth/me` | Returns current user identity (id, name, email, role, permissions) |
| GET | `/auth/permissions` | Returns current user's role and flat permission list |
| POST | `/auth/token` | Exchanges OIDC authorization code for access token (production mode) |

## Roles & Permission Matrix

| Role | Key Resources |
|------|---------------|
| **admin** | Full access (`*:*`) |
| **governance_lead** | Read/write governance requests, intake, domain reviews, review actions, ISRs; read-only domain registry, dispatch rules, compliance rules, user auth |
| **domain_reviewer** | Read governance requests; read/write domain reviews, questionnaires, review actions, ISRs |
| **requestor** | Read/write governance requests, intake, ISRs; read-only compliance rules, domain reviews |
| **viewer** | Read-only across governance requests, intake, domain reviews, progress, dashboard, reports |

## Auth Modes

### Dev Mode (`AUTH_DISABLED=True`)
- `X-Dev-User` header: switch to a real employee identity (looks up `employee_info` + `user_role`)
- `X-Dev-Role` header: override role directly (e.g., `requestor`, `viewer`)
- No header: uses `AUTH_DEV_USER` / `AUTH_DEV_ROLE` from settings, with DB role lookup fallback
- Frontend Switch User: dropdown in Header reads `/dev/users`, stores selection in localStorage, sends `X-Dev-User` header on all requests

### Production Mode (`AUTH_DISABLED=False`)
- Bearer token in `Authorization` header
- `KeycloakAuthProvider` decodes JWT using JWKS (cached 1hr)
- DB-assigned role (`user_role` table) takes priority over Keycloak JWT role
- Role mapping: `_SYS_ADMIN`/`ADMIN`/`SUPER_ADMIN` → admin; `GOVERNANCE_LEAD` → governance_lead; etc.

## Acceptance Criteria

- [x] AC-1: `GET /auth/me` returns user identity with id, name, email, role, and permissions array
- [x] AC-2: `GET /auth/permissions` returns role and flat permission list
- [x] AC-3: Dev mode: `X-Dev-Role` header switches the active role
- [x] AC-4: Dev mode: `X-Dev-User` header resolves identity from `employee_info` + role from `user_role`
- [x] AC-5: Production mode: valid JWT returns user identity with Keycloak-derived role
- [x] AC-6: DB-assigned role (`user_role`) overrides JWT/dev default role
- [x] AC-7: `require_permission(resource, scope)` dependency blocks unauthorized access with 403
- [x] AC-8: `require_role(Role.ADMIN)` dependency blocks non-admin users with 403
- [x] AC-9: Frontend Switch User dropdown persists selection in localStorage and sends `X-Dev-User` header
- [x] AC-10: Role-based sidebar visibility (admin sees all; requestor/viewer see limited menus)

## Test Coverage

### API Tests
- `api-tests/test_auth.py::test_auth_me` — covers AC-1
- `api-tests/test_auth.py::test_auth_permissions` — covers AC-2
- `api-tests/test_auth.py::test_switch_role_to_requestor` — covers AC-3
- `api-tests/test_auth.py::test_switch_role_to_reviewer` — covers AC-3
- `api-tests/test_auth.py::test_switch_role_invalid_falls_back` — covers AC-3

### E2E Tests
- `e2e-tests/role-switcher.spec.ts` — "default role is admin with full sidebar" covers AC-9, AC-10
- `e2e-tests/role-switcher.spec.ts` — "switch to requestor hides admin menus" covers AC-9, AC-10
- `e2e-tests/role-switcher.spec.ts` — "switch to reviewer shows limited menus" covers AC-10
- `e2e-tests/role-switcher.spec.ts` — "switch back to admin restores full sidebar" covers AC-9

## Test Map Entries

```
backend/app/routers/auth.py         -> api-tests/test_auth.py
backend/app/auth/rbac.py            -> api-tests/test_auth.py
backend/app/auth/providers.py       -> api-tests/test_auth.py
frontend/src/lib/auth-context.tsx   -> e2e-tests/role-switcher.spec.ts
frontend/src/components/layout/Header.tsx -> e2e-tests/role-switcher.spec.ts
```

## Notes

- The `employee_info` table is a read-only replica synced from EAM via `scripts/sync_employees.py`. EGM never creates or modifies employee records through its API.
- JWKS keys are cached in-memory for 1 hour (`_JWKS_TTL = 3600`). No external cache (Redis) is used.
- The `POST /auth/token` endpoint is a passthrough to Keycloak's token endpoint; EGM does not store tokens server-side.
