# Feature: User Authorization

**Status**: Implemented
**Date**: 2026-03-13
**Spec Version**: 2

## Impact Assessment

**Features**: user-authorization
**Impact**: L2 (feature-local — multi-role RBAC redesign within existing router + frontend page)
**Risk**: Low (bug fixes + edit button addition)
**Decision**: Auto-approve

## Summary

Manages EGM multi-role assignments for employees. Admins can search the `employee_info` table (synced from EAM) and assign one or more roles to any employee. Each user can hold multiple roles simultaneously (e.g., governance_lead + domain_reviewer). Domain reviewer roles require associated domain codes stored in `user_role_domain`. Role assignments are stored in the `user_role` table and take priority over Keycloak JWT roles at authentication time.

## Affected Files

### Backend
- `backend/app/routers/user_authorization.py` — Employee search and multi-role CRUD endpoints

### Frontend
- `frontend/src/app/(sidebar)/settings/user-authorization/page.tsx` — User Authorization settings page with employee search, multi-role assignment form, roles table with per-role operations, and inline domain editor for domain_reviewer

### Database
- `scripts/schema.sql` — `user_role` table (id, itcode, role, assigned_by, assigned_at, update_by, update_at); `user_role_domain` table (user_role_id FK, domain_code, assigned_by); `employee_info` table (read-only, synced from EAM)

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/user-authorization/employees` | Search employees by itcode, name, or email (ILIKE) |
| GET | `/user-authorization/roles` | List role assignments grouped by user, with domain codes |
| GET | `/user-authorization/roles/{itcode}` | Get all role assignments for a single user |
| POST | `/user-authorization/roles` | Add a single role to a user (admin only) |
| PUT | `/user-authorization/roles/{itcode}/{role}` | Update domain codes for a domain_reviewer role (admin only) |
| DELETE | `/user-authorization/roles/{itcode}/{role}` | Remove a specific role from a user (admin only) |
| DELETE | `/user-authorization/roles/{itcode}` | Remove ALL roles for a user (admin only) |

### Permission Matrix

| Endpoint | admin | governance_lead | domain_reviewer | requestor |
|----------|-------|-----------------|-----------------|-----------|
| GET /employees | Yes | Yes | No | No |
| GET /roles | Yes | Yes | No | No |
| GET /roles/{itcode} | Yes | Yes | No | No |
| POST /roles | Yes | No | No | No |
| PUT /roles/{itcode}/{role} | Yes | No | No | No |
| DELETE /roles/{itcode}/{role} | Yes | No | No | No |
| DELETE /roles/{itcode} | Yes | No | No | No |

## UI Behavior

1. Settings > User Authorization page shows a table of existing role assignments grouped by user.
2. Each user row shows all assigned roles as badges, with domain codes listed for domain_reviewer roles.
3. "Assign Role" button opens a form with employee search (autocomplete) and role dropdown (admin, governance_lead, domain_reviewer, requestor).
4. For domain_reviewer, the form shows domain checkboxes to select assigned domains.
5. Employee search queries `/user-authorization/employees?search=<query>` with debounced input.
6. Each role row has operation buttons: a Delete (×) button to remove that specific role, and for domain_reviewer roles, an Edit (pencil) button to modify assigned domains inline.
7. Clicking the Edit button opens an inline domain editor row with checkboxes for all active domains, Save/Cancel buttons.
8. Role search/filter is available above the table.
9. All write operations are admin-only; governance_lead can view but not modify.

## Acceptance Criteria

- [x] AC-1: `GET /employees?search=<term>` returns matching employees (ILIKE on itcode, name, email)
- [x] AC-2: Empty search query returns empty array (no full table scan)
- [x] AC-3: `GET /roles` returns paginated list grouped by user with employee info and domain codes
- [x] AC-4: `GET /roles/{itcode}` returns all roles for a user or 404
- [x] AC-5: `POST /roles` adds a new role to a user with audit log entry
- [x] AC-6: `POST /roles` with existing (itcode, role) combo returns 409 conflict
- [x] AC-7: `POST /roles` for domain_reviewer requires domainCodes; other roles reject domainCodes
- [x] AC-8: `PUT /roles/{itcode}/domain_reviewer` updates domain codes with audit log
- [x] AC-9: `DELETE /roles/{itcode}/{role}` removes specific role with CASCADE to user_role_domain
- [x] AC-10: `DELETE /roles/{itcode}` removes ALL roles for a user
- [x] AC-11: Invalid role value returns 400 with list of valid roles
- [x] AC-12: Non-existent employee returns 404
- [x] AC-13: Non-existent role assignment returns 404 for GET/PUT/DELETE
- [x] AC-14: Write operations (POST/PUT/DELETE) require admin role; governance_lead gets 403
- [x] AC-15: Frontend shows employee search with autocomplete and multi-role assignment form
- [x] AC-16: Frontend shows roles table with per-role operations (delete, edit domains)
- [x] AC-17: Frontend edit button opens inline domain editor for domain_reviewer with Save/Cancel

## Test Coverage

### API Tests
- `api-tests/test_user_authorization.py::test_search_employees_empty_query` — covers AC-2
- `api-tests/test_user_authorization.py::test_search_employees_by_itcode` — covers AC-1
- `api-tests/test_user_authorization.py::test_search_employees_by_name` — covers AC-1
- `api-tests/test_user_authorization.py::test_search_employees_limit` — covers AC-1
- `api-tests/test_user_authorization.py::test_assign_role` — covers AC-5
- `api-tests/test_user_authorization.py::test_assign_role_upsert` — covers AC-6
- `api-tests/test_user_authorization.py::test_list_roles` — covers AC-3
- `api-tests/test_user_authorization.py::test_get_role` — covers AC-4
- `api-tests/test_user_authorization.py::test_update_role` — covers AC-8
- `api-tests/test_user_authorization.py::test_delete_role` — covers AC-9
- `api-tests/test_user_authorization.py::test_assign_role_missing_itcode` — covers AC-11
- `api-tests/test_user_authorization.py::test_assign_role_missing_role` — covers AC-11
- `api-tests/test_user_authorization.py::test_assign_role_invalid_role` — covers AC-11
- `api-tests/test_user_authorization.py::test_assign_role_nonexistent_employee` — covers AC-12
- `api-tests/test_user_authorization.py::test_get_nonexistent_role` — covers AC-13
- `api-tests/test_user_authorization.py::test_update_nonexistent_role` — covers AC-13
- `api-tests/test_user_authorization.py::test_delete_nonexistent_role` — covers AC-13
- `api-tests/test_user_authorization.py::test_viewer_cannot_assign_role` — covers AC-14
- `api-tests/test_user_authorization.py::test_requestor_cannot_assign_role` — covers AC-14
- `api-tests/test_user_authorization.py::test_governance_lead_can_read_employees` — covers AC-14
- `api-tests/test_user_authorization.py::test_governance_lead_can_read_roles` — covers AC-14
- `api-tests/test_user_authorization.py::test_governance_lead_cannot_assign_role` — covers AC-14
- `api-tests/test_user_authorization.py::test_viewer_cannot_search_employees` — covers AC-14
- `api-tests/test_user_authorization.py::test_requestor_cannot_search_employees` — covers AC-14

### E2E Tests
- `e2e-tests/user-authorization.spec.ts` — "settings page shows User Authorization card" covers AC-15
- `e2e-tests/user-authorization.spec.ts` — "page loads with heading and assign button" covers AC-15
- `e2e-tests/user-authorization.spec.ts` — "assign role form appears on button click" covers AC-15
- `e2e-tests/user-authorization.spec.ts` — "employee search shows results" covers AC-15
- `e2e-tests/user-authorization.spec.ts` — "roles table is visible" covers AC-16
- `e2e-tests/user-authorization.spec.ts` — "role search filter is visible" covers AC-16
- `e2e-tests/user-authorization.spec.ts` — "edit domain reviewer domains inline" covers AC-17

## Test Map Entries

```
backend/app/routers/user_authorization.py                      -> api-tests/test_user_authorization.py
frontend/src/app/(sidebar)/settings/user-authorization/page.tsx -> e2e-tests/user-authorization.spec.ts
```

## Notes

- The `employee_info` table is a read-only replica synced from EAM. EGM never creates or modifies employee records.
- Multi-role model: a user can hold multiple roles simultaneously. Each (itcode, role) pair is a separate row in `user_role`.
- `user_role_domain` links domain_reviewer role entries to their assigned domain codes, with CASCADE delete.
- Assigning the same (itcode, role) combination returns 409 Conflict (no upsert).
- Deleting all roles reverts the user to the default role (requestor in dev mode, Keycloak JWT role in production).
- All write operations write to the `audit_log` table with old/new value JSONB for traceability.
- The inline domain editor (AC-17) uses `PUT /roles/{itcode}/domain_reviewer` to replace the full domain code set.
