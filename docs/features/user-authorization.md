# Feature: User Authorization

**Status**: Implemented
**Date**: 2026-03-12
**Spec Version**: 1

## Summary

Manages EGM role assignments for employees. Admins can search the `employee_info` table (synced from EAM) and assign one of five roles to any employee. Role assignments are stored in the `user_role` table and take priority over Keycloak JWT roles at authentication time.

## Affected Files

### Backend
- `backend/app/routers/user_authorization.py` — Employee search and role CRUD endpoints

### Frontend
- `frontend/src/app/(sidebar)/settings/user-authorization/page.tsx` — User Authorization settings page with employee search, role assignment form, and roles table

### Database
- `scripts/schema.sql` — `user_role` table (id, itcode UNIQUE, role, assigned_by, assigned_at, update_by, update_at); `employee_info` table (read-only, synced from EAM)

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/user-authorization/employees` | Search employees by itcode, name, or email (ILIKE) |
| GET | `/user-authorization/roles` | List role assignments with pagination and search |
| GET | `/user-authorization/roles/{itcode}` | Get a single role assignment |
| POST | `/user-authorization/roles` | Assign or upsert a role (admin only) |
| PUT | `/user-authorization/roles/{itcode}` | Update an existing role (admin only) |
| DELETE | `/user-authorization/roles/{itcode}` | Remove a role assignment (admin only) |

### Permission Matrix

| Endpoint | admin | governance_lead | domain_reviewer | requestor | viewer |
|----------|-------|-----------------|-----------------|-----------|--------|
| GET /employees | Yes | Yes | No | No | No |
| GET /roles | Yes | Yes | No | No | No |
| POST /roles | Yes | No | No | No | No |
| PUT /roles | Yes | No | No | No | No |
| DELETE /roles | Yes | No | No | No | No |

## UI Behavior

1. Settings > User Authorization page shows a table of existing role assignments.
2. "Assign Role" button opens a form with employee search (autocomplete) and role dropdown.
3. Employee search queries `/user-authorization/employees?search=<query>` with debounced input.
4. Selecting an employee and role, then clicking "Save" calls `POST /user-authorization/roles`.
5. Existing roles can be edited (role change) or deleted from the table.
6. Role search/filter is available above the table.
7. All write operations are admin-only; governance_lead can view but not modify.

## Acceptance Criteria

- [x] AC-1: `GET /employees?search=<term>` returns matching employees (ILIKE on itcode, name, email)
- [x] AC-2: Empty search query returns empty array (no full table scan)
- [x] AC-3: `GET /roles` returns paginated list with employee info joined
- [x] AC-4: `GET /roles/{itcode}` returns single role or 404
- [x] AC-5: `POST /roles` creates a new role assignment with audit log entry
- [x] AC-6: `POST /roles` with existing itcode upserts (updates role) with audit log
- [x] AC-7: `PUT /roles/{itcode}` updates role and writes audit log with old/new values
- [x] AC-8: `DELETE /roles/{itcode}` removes assignment and writes audit log
- [x] AC-9: Invalid role value returns 400 with list of valid roles
- [x] AC-10: Non-existent employee returns 404
- [x] AC-11: Non-existent role assignment returns 404 for GET/PUT/DELETE
- [x] AC-12: Write operations (POST/PUT/DELETE) require admin role; governance_lead gets 403
- [x] AC-13: Viewer and requestor cannot access employee search or role list (403)
- [x] AC-14: Frontend shows employee search with autocomplete and role assignment form
- [x] AC-15: Frontend shows roles table with search/filter

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
- `api-tests/test_user_authorization.py::test_update_role` — covers AC-7
- `api-tests/test_user_authorization.py::test_delete_role` — covers AC-8
- `api-tests/test_user_authorization.py::test_assign_role_missing_itcode` — covers AC-9
- `api-tests/test_user_authorization.py::test_assign_role_missing_role` — covers AC-9
- `api-tests/test_user_authorization.py::test_assign_role_invalid_role` — covers AC-9
- `api-tests/test_user_authorization.py::test_assign_role_nonexistent_employee` — covers AC-10
- `api-tests/test_user_authorization.py::test_get_nonexistent_role` — covers AC-11
- `api-tests/test_user_authorization.py::test_update_nonexistent_role` — covers AC-11
- `api-tests/test_user_authorization.py::test_delete_nonexistent_role` — covers AC-11
- `api-tests/test_user_authorization.py::test_viewer_cannot_assign_role` — covers AC-12
- `api-tests/test_user_authorization.py::test_requestor_cannot_assign_role` — covers AC-12
- `api-tests/test_user_authorization.py::test_governance_lead_can_read_employees` — covers AC-12
- `api-tests/test_user_authorization.py::test_governance_lead_can_read_roles` — covers AC-12
- `api-tests/test_user_authorization.py::test_governance_lead_cannot_assign_role` — covers AC-12
- `api-tests/test_user_authorization.py::test_viewer_cannot_search_employees` — covers AC-13
- `api-tests/test_user_authorization.py::test_requestor_cannot_search_employees` — covers AC-13

### E2E Tests
- `e2e-tests/user-authorization.spec.ts` — "settings page shows User Authorization card" covers AC-14
- `e2e-tests/user-authorization.spec.ts` — "page loads with heading and assign button" covers AC-14
- `e2e-tests/user-authorization.spec.ts` — "assign role form appears on button click" covers AC-14
- `e2e-tests/user-authorization.spec.ts` — "employee search shows results" covers AC-14
- `e2e-tests/user-authorization.spec.ts` — "roles table is visible" covers AC-15
- `e2e-tests/user-authorization.spec.ts` — "role search filter is visible" covers AC-15

## Test Map Entries

```
backend/app/routers/user_authorization.py                      -> api-tests/test_user_authorization.py
frontend/src/app/(sidebar)/settings/user-authorization/page.tsx -> e2e-tests/user-authorization.spec.ts
```

## Notes

- The `employee_info` table is a read-only replica synced from EAM. EGM never creates or modifies employee records.
- Role assignment uses `INSERT ... ON CONFLICT (itcode) DO UPDATE` for upsert semantics — assigning a role to an employee who already has one simply updates it.
- Deleting a role assignment reverts the user to the default role (viewer in dev mode, Keycloak JWT role in production).
- All write operations write to the `audit_log` table with old/new value JSONB for traceability.
