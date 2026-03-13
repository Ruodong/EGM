# Feature: Dispatch Rules & Rule-Domain Matrix

**Status**: Implemented
**Date**: 2026-03-12
**Spec Version**: 4

## Impact Assessment

- **Impact Level**: L2 (new tables + router + settings page, no cross-feature side effects)
- **Risk**: Low (standalone feature, no modification to existing dispatch logic)

## Summary

Dispatch Rules define project characteristic tags (e.g. 内部项目, AI项目, PII数据) that describe project attributes. A Rule-Domain matrix maps each Rule × Domain combination to `in` (needs review dispatch) or `out` (doesn't need). The matrix is used on the governance request create form to preview triggered domains based on selected rules.

## Affected Files

### Backend
- `backend/app/routers/dispatch_rules.py` — Rule CRUD + matrix read/write endpoints
- `backend/app/main.py` — Router registration
- `backend/app/auth/rbac.py` — `dispatch_rule: [read]` for governance_lead and requestor

### Frontend
- `frontend/src/app/(sidebar)/settings/dispatch-rules/page.tsx` — Rule list + matrix UI
- `frontend/src/app/(sidebar)/settings/page.tsx` — Settings hub card
- `frontend/src/lib/constants.ts` — Sidebar nav entry
- `frontend/src/app/governance/create/_components/GovernanceScopeDetermination.tsx` — Rule toggles on create form

### Database
- `scripts/schema.sql` — `dispatch_rule` + `dispatch_rule_domain` + `dispatch_rule_exclusion` tables
- `scripts/seed_data.sql` — 5 Level-1 seed rules + 2 Level-2 children (INTERNAL_ONLY, EXTERNAL_USING) + matrix seed + exclusion seed

## API Endpoints

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | `/api/dispatch-rules/` | `dispatch_rule:read` | List rules (opt `includeInactive`) with inline domains |
| GET | `/api/dispatch-rules/matrix` | `dispatch_rule:read` | Full matrix: rules (with description), domains, matrix object |
| GET | `/api/dispatch-rules/{code}` | `dispatch_rule:read` | Single rule + domain relationships |
| POST | `/api/dispatch-rules/` | ADMIN | Create rule |
| PUT | `/api/dispatch-rules/{code}` | ADMIN | Update rule |
| DELETE | `/api/dispatch-rules/{code}` | ADMIN | Toggle is_active |
| PUT | `/api/dispatch-rules/matrix` | ADMIN | Bulk save matrix (full replacement) |
| PUT | `/api/dispatch-rules/exclusions` | ADMIN | Save mutual exclusion pairs (full replacement, symmetric) |

## UI Behavior

- Settings hub shows "Dispatch Rules" card → navigates to `/settings/dispatch-rules`
- **Part 1 — Rule List**: Table with Code, Name, Description, Operation (edit / toggle active)
  - "Add Rule" button opens inline form (Code, Name, Description, Sort Order)
  - Edit pre-fills form; Cancel closes form
- **Part 2 — Rule-Domain Matrix**: Grid with Domain rows × Rule columns
  - Each cell is a toggle button: green `● in` / gray `○ out`
  - Click toggles locally; "Save Matrix" button enables when dirty
  - Save sends full matrix to PUT endpoint

## Acceptance Criteria

- [x] AC-1: 5 seed rules visible in rules table (INTERNAL, EXTERNAL, AI, PII, OPEN_SOURCE)
- [x] AC-2: Rule CRUD works (create, edit, toggle active)
- [x] AC-3: Matrix displays correct in/out state from seed data
- [x] AC-4: Matrix toggle + save persists changes
- [x] AC-5: RBAC enforced — governance_lead/requestor read-only, viewer blocked
- [x] AC-6: Settings hub links to dispatch rules page
- [x] AC-7: Level-2 seed rules (INTERNAL_ONLY, EXTERNAL_USING) visible under INTERNAL
- [x] AC-8: Rule exclusions configurable in settings (Level-1↔Level-1, Level-2↔sibling)
- [x] AC-9: GET /matrix and GET / include exclusions field
- [x] AC-10: PUT /exclusions saves symmetric pairs with level validation
- [x] AC-11: Create form disables excluded rules (gray + reason text)
- [x] AC-12: Backend rejects request creation with mutually exclusive rules (400)
- [x] AC-13: Rules support `isMandatory` property (default false); persisted via POST/PUT
- [x] AC-14: Matrix endpoint returns `isMandatory` for each rule
- [x] AC-15: Settings form includes Mandatory checkbox; table shows Mandatory badge
- [x] AC-16: Create form shows "Required" badge on mandatory rules
- [x] AC-17: Backend rejects request creation missing mandatory rules (400)
- [x] AC-18: Mandatory rule is exempt if excluded by a selected rule (mutual exclusion exemption)

## Test Coverage

### API Tests (35 tests)
- `api-tests/test_dispatch.py::test_list_dispatch_rules` — AC-1
- `api-tests/test_dispatch.py::test_list_rules_has_domains` — AC-1
- `api-tests/test_dispatch.py::test_get_rule` — AC-1
- `api-tests/test_dispatch.py::test_get_rule_not_found` — AC-2
- `api-tests/test_dispatch.py::test_create_rule` — AC-2
- `api-tests/test_dispatch.py::test_create_rule_missing_fields` — AC-2
- `api-tests/test_dispatch.py::test_create_rule_duplicate` — AC-2
- `api-tests/test_dispatch.py::test_update_rule` — AC-2
- `api-tests/test_dispatch.py::test_update_rule_not_found` — AC-2
- `api-tests/test_dispatch.py::test_toggle_rule` — AC-2
- `api-tests/test_dispatch.py::test_toggle_rule_not_found` — AC-2
- `api-tests/test_dispatch.py::test_get_matrix` — AC-3
- `api-tests/test_dispatch.py::test_save_matrix` — AC-4
- `api-tests/test_dispatch.py::test_save_matrix_empty` — AC-4
- `api-tests/test_dispatch.py::test_governance_lead_can_read_rules` — AC-5
- `api-tests/test_dispatch.py::test_governance_lead_can_read_matrix` — AC-5
- `api-tests/test_dispatch.py::test_governance_lead_cannot_create_rule` — AC-5
- `api-tests/test_dispatch.py::test_governance_lead_cannot_save_matrix` — AC-5
- `api-tests/test_dispatch.py::test_viewer_cannot_read_rules` — AC-5
- `api-tests/test_dispatch.py::test_requestor_can_read_rules` — AC-5
- `api-tests/test_dispatch.py::test_seed_child_rules_exist` — AC-7
- `api-tests/test_dispatch.py::test_matrix_includes_exclusions` — AC-9
- `api-tests/test_dispatch.py::test_list_rules_includes_exclusions` — AC-9
- `api-tests/test_dispatch.py::test_save_exclusions` — AC-10
- `api-tests/test_dispatch.py::test_save_exclusions_symmetric` — AC-10
- `api-tests/test_dispatch.py::test_save_exclusions_cross_level_rejected` — AC-10
- `api-tests/test_dispatch.py::test_create_request_with_excluded_rules_fails` — AC-12
- `api-tests/test_dispatch.py::test_save_exclusions_rbac` — AC-5
- `api-tests/test_dispatch.py::test_create_rule_with_mandatory` — AC-13
- `api-tests/test_dispatch.py::test_create_rule_default_optional` — AC-13
- `api-tests/test_dispatch.py::test_update_rule_mandatory` — AC-13
- `api-tests/test_dispatch.py::test_matrix_includes_is_mandatory` — AC-14
- `api-tests/test_dispatch.py::test_create_request_missing_mandatory_rule_fails` — AC-17
- `api-tests/test_dispatch.py::test_create_request_with_mandatory_rule_succeeds` — AC-17
- `api-tests/test_dispatch.py::test_mandatory_rule_exclusion_exemption` — AC-18

### E2E Tests (13 tests)
- `e2e-tests/dispatch-rules.spec.ts` — "page loads with rules table and matrix" covers AC-1, AC-3
- `e2e-tests/dispatch-rules.spec.ts` — "seed rules are visible" covers AC-1
- `e2e-tests/dispatch-rules.spec.ts` — "add rule form opens and closes" covers AC-2
- `e2e-tests/dispatch-rules.spec.ts` — "matrix shows in/out toggle buttons" covers AC-3
- `e2e-tests/dispatch-rules.spec.ts` — "toggle matrix cell enables save button" covers AC-4
- `e2e-tests/dispatch-rules.spec.ts` — "settings hub has dispatch rules link" covers AC-6
- `e2e-tests/dispatch-rules.spec.ts` — "seed child rules visible under INTERNAL" covers AC-7
- `e2e-tests/dispatch-rules.spec.ts` — "exclusion section visible in settings" covers AC-8
- `e2e-tests/dispatch-rules.spec.ts` — "seed exclusions are pre-checked" covers AC-8
- `e2e-tests/dispatch-rules.spec.ts` — "excluded rules disabled on create form" covers AC-11
- `e2e-tests/dispatch-rules.spec.ts` — "add rule form has mandatory checkbox" covers AC-15
- `e2e-tests/dispatch-rules.spec.ts` — "create mandatory rule shows badge in table" covers AC-15
- `e2e-tests/dispatch-rules.spec.ts` — "mandatory rule shows Required badge on create form" covers AC-16

## Test Map Entries

```
backend/app/routers/dispatch_rules.py -> api-tests/test_dispatch.py
frontend/src/app/(sidebar)/settings/dispatch-rules/ -> e2e-tests/dispatch-rules.spec.ts
```

## Notes

- Route ordering in FastAPI: `/matrix` endpoints must be declared before `/{code}` to avoid path parameter conflict
- Matrix PUT does full replacement (delete all + re-insert) for simplicity
- Domain codes in seed data use actual active DB values (EA, DP, RAI, OSC), not original plan names (BIA, DATA_PRIVACY)
- Renamed from "Compliance Rules" to "Dispatch Rules" on 2026-03-12 (tables: compliance_rule → dispatch_rule)
