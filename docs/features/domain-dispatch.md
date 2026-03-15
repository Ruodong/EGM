# Feature: Domain Dispatch & Review

**Status**: Implemented
**Date**: 2026-03-14
**Spec Version**: 2

## Summary

Domain Dispatch governs how governance requests are routed to the appropriate review domains. It encompasses three subsystems: a **domain registry** that defines available governance domains, **dispatch rules** that encode routing logic (condition-based or always-on), and a **domain review lifecycle** that tracks each review through a 6-state machine from creation to terminal decision.

### Key Changes (v2)
- **Dispatcher removed**: Submit now directly creates domain reviews — no separate dispatch execution step.
- **ISR removed**: "Return for Additional Information" status replaces the info_supplement_request table.
- **Waive removed**: No longer possible to waive reviews.
- **6-state machine**: Waiting for Accept → Accept / Return for Additional Information → Approved / Approved with Exception / Not Passed.
- **Auto-complete**: When all domain reviews reach terminal status, the governance request automatically transitions to "Complete".

## Affected Files

### Backend
- `backend/app/routers/dispatch_rules.py` -- Admin CRUD for dispatch rules (create, list, update, soft-delete)
- `backend/app/routers/domain_reviews.py` -- Domain review 6-state lifecycle (accept, return, resubmit, approve, approve-with-exception, not-pass)
- `backend/app/routers/domain_registry.py` -- Manage governance domain definitions (CRUD)

### Frontend
- `frontend/src/app/(sidebar)/settings/dispatch-rules/page.tsx` -- Admin UI for managing dispatch rules
- `frontend/src/app/(sidebar)/domains/page.tsx` -- Domain registry listing page
- `frontend/src/app/(sidebar)/reviews/page.tsx` -- Domain reviews dashboard (6-status filters)
- `frontend/src/app/governance/[requestId]/reviews/page.tsx` -- Per-request review list
- `frontend/src/app/governance/[requestId]/reviews/[domainCode]/page.tsx` -- Single domain review detail with action buttons

### Database
- `scripts/schema.sql` -- Tables: `domain_registry`, `dispatch_rule`, `domain_review`
- `scripts/migration_domain_review_state_machine.sql` -- Migration from old 8-state to new 6-state machine

## Database Tables

### `domain_registry`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | Auto-generated |
| domain_code | VARCHAR UNIQUE | Short identifier (e.g. `SECURITY`, `DATA_PRIVACY`) |
| domain_name | VARCHAR | Human-readable name |
| description | TEXT | Optional long description |
| integration_type | VARCHAR | `internal` (default) or external system type |
| external_base_url | VARCHAR | URL for external integrations |
| icon | VARCHAR | UI icon identifier |
| sort_order | INT | Display ordering (default 0) |
| is_active | BOOLEAN | Soft-delete flag (default TRUE) |
| config | JSONB | Arbitrary domain configuration |

### `dispatch_rule`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | Auto-generated |
| rule_name | VARCHAR | Descriptive name |
| domain_code | VARCHAR | Target domain to dispatch to |
| condition_type | VARCHAR | `always`, `scoping_answer`, or `field_value` |
| condition_field | VARCHAR | Template ID or field name to evaluate |
| condition_operator | VARCHAR | `equals`, `not_equals`, `contains`, `in`, `gt`, `lt` |
| condition_value | JSONB | Expected value for comparison |
| priority | INT | Higher = evaluated first (default 0) |
| is_active | BOOLEAN | Soft-delete flag (default TRUE) |

### `domain_review`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | Auto-generated |
| request_id | UUID FK | References `governance_request(id)` ON DELETE CASCADE |
| domain_code | VARCHAR | Domain being reviewed |
| status | VARCHAR | `Waiting for Accept`, `Accept`, `Return for Additional Information`, `Approved`, `Approved with Exception`, `Not Passed` |
| reviewer | VARCHAR | Assigned reviewer ID |
| reviewer_name | VARCHAR | Assigned reviewer display name |
| outcome | VARCHAR | Legacy column (unused in v2) |
| outcome_notes | TEXT | Notes for Approved with Exception or Not Passed |
| return_reason | TEXT | Reason for returning the review |
| external_ref_id | VARCHAR | Reference to external tracking system |
| common_data_updated_at | TIMESTAMP | Last sync of common data |
| started_at | TIMESTAMP | When review was accepted |
| completed_at | TIMESTAMP | When terminal decision was made |
| create_by / create_at | VARCHAR / TIMESTAMP | Audit fields |
| update_by / update_at | VARCHAR / TIMESTAMP | Audit fields |
| UNIQUE(request_id, domain_code) | | Prevents duplicate reviews per domain per request |

## API Endpoints

### Domain Registry (`/api/domains`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/domains` | `domain_registry:read` | List all active domains ordered by sort_order, then domain_name |
| GET | `/api/domains/{code}` | `domain_registry:read` | Get a single domain by its domain_code |
| POST | `/api/domains` | Role: ADMIN | Create a new domain entry |
| PUT | `/api/domains/{code}` | Role: ADMIN | Update domain fields (partial update) |

### Dispatch Rules (`/api/dispatch-rules`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/dispatch-rules` | `dispatch_rule:read` | List all dispatch rules ordered by priority DESC, rule_name |
| POST | `/api/dispatch-rules` | Role: ADMIN | Create a new dispatch rule |
| PUT | `/api/dispatch-rules/{rule_id}` | Role: ADMIN | Update rule fields (partial update) |
| DELETE | `/api/dispatch-rules/{rule_id}` | Role: ADMIN | Soft-delete: sets `is_active = false` |

### Domain Reviews (`/api/domain-reviews`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/domain-reviews` | `domain_review:read` | List reviews with pagination; filterable by `request_id`, `domainCode`, `status`, `reviewer` |
| GET | `/api/domain-reviews/{review_id}` | `domain_review:read` | Get a single review by UUID |
| PUT | `/api/domain-reviews/{review_id}/accept` | `domain_review:write` | Accept review (Waiting for Accept → Accept); triggers request In Progress on first accept |
| PUT | `/api/domain-reviews/{review_id}/return` | `domain_review:write` | Return review (Waiting for Accept → Return for Additional Information); requires `returnReason` |
| PUT | `/api/domain-reviews/{review_id}/resubmit` | `governance_request:write` | Resubmit after return (Return for Additional Information → Waiting for Accept) |
| PUT | `/api/domain-reviews/{review_id}/approve` | `domain_review:write` | Approve review (Accept → Approved); triggers auto-complete check |
| PUT | `/api/domain-reviews/{review_id}/approve-with-exception` | `domain_review:write` | Approve with exception (Accept → Approved with Exception); requires `outcomeNotes` |
| PUT | `/api/domain-reviews/{review_id}/not-pass` | `domain_review:write` | Not pass review (Accept → Not Passed); requires `outcomeNotes` |

## Domain Review State Machine

```
                    ┌──────────────────┐
                    │ Waiting for      │
        ┌───────────│ Accept           │───────────┐
        │           └──────────────────┘           │
        ▼                                          ▼
┌──────────────────┐                    ┌──────────────────┐
│ Return for       │    Resubmit       │ Accept           │
│ Additional Info  │────────────────►  │ (one-way)        │
└──────────────────┘                    └────────┬─────────┘
                                           │    │    │
                                           ▼    ▼    ▼
                                    ┌────┐ ┌────┐ ┌────┐
                                    │Appr│ │Exc │ │Not │
                                    │oved│ │ept │ │Pass│
                                    └────┘ └────┘ └────┘
```

### Key Rules
- **Accept is one-way**: Once accepted, cannot return. Must proceed to terminal.
- **Return does NOT change request status**: Request stays in Submitted or In Progress.
- **Resubmit**: Requestor can resubmit returned domains (Return for Additional Information → Waiting for Accept).
- **Auto-complete**: All reviews terminal → request "Complete" (uses SELECT FOR UPDATE for race prevention).
- **First accept triggers In Progress**: Request transitions from Submitted → In Progress on first domain review accept.
- **Audit logging**: Approve with Exception and Not Pass actions write `outcomeNotes` to audit log `new_value` for activity log display.

## UI Behavior

### Domain Registry Page (`/domains`)
- Displays a list of all active governance domains
- Admin users can create new domains and edit existing ones

### Dispatch Rules Page (`/settings/dispatch-rules`)
- Lists all dispatch rules with their condition type, target domain, and priority
- Admin users can create, edit, and deactivate rules

### Domain Reviews Dashboard (`/reviews`)
- Lists all domain reviews across requests
- Domain column visible to all roles (not just admin/governance lead)
- Supports multi-select filtering by status (6 statuses: Waiting for Accept, Accept, Return for Additional Information, Approved, Approved with Exception, Not Passed)
- Supports multi-select filtering by domain code
- Backend accepts comma-separated values for `status` and `domainCode` query params
- Paginated results

### Per-Request Review Detail (`/governance/[requestId]/reviews/[domainCode]`)
- Shows review status, reviewer info, questionnaire answers
- **Waiting for Accept**: Accept / Return buttons
- **Accept**: Approve / Approve with Exception / Not Pass buttons (with confirmation dialogs)
- **Return for Additional Information**: Shows return reason banner
- **Terminal statuses**: Read-only display

## Acceptance Criteria

- [x] AC-1: Admins can create, list, update, and soft-delete dispatch rules
- [x] AC-2: Dispatch rules support condition types: `always`, `scoping_answer`, `field_value`
- [x] AC-3: Dispatch rules support operators: `equals`, `not_equals`, `contains`, `in`, `gt`, `lt`
- [x] AC-4: Submitting a request auto-creates domain review records for each triggered domain
- [x] AC-5: Domain reviews are created with "Waiting for Accept" status
- [x] AC-6: Accept transitions review to "Accept" and triggers request "In Progress" on first accept
- [x] AC-7: Return transitions review to "Return for Additional Information" with reason; does NOT change request status
- [x] AC-8: Resubmit transitions review from "Return for Additional Information" back to "Waiting for Accept"
- [x] AC-9: Accept is one-way — cannot return after accepting
- [x] AC-10: Approve transitions review to "Approved" terminal status
- [x] AC-11: Approve with Exception transitions review to "Approved with Exception" with notes
- [x] AC-12: Not Pass transitions review to "Not Passed" with notes
- [x] AC-13: When all reviews reach terminal status, request auto-completes to "Complete"
- [x] AC-14: Auto-complete uses SELECT FOR UPDATE to prevent race conditions
- [x] AC-15: Invalid state transitions return HTTP 400
- [x] AC-16: Domain registry supports CRUD operations; listing returns only active domains
- [x] AC-17: Domain reviews can be listed with filters (request_id, domainCode, status, reviewer) and pagination
- [x] AC-18: All endpoints enforce RBAC
- [x] AC-19: Dispatch rules DELETE endpoint performs soft-delete
- [ ] AC-20: Admins can configure dependency relationships between dispatch rules via PUT `/dispatch-rules/dependencies`
- [ ] AC-21: GET `/dispatch-rules/` and GET `/dispatch-rules/matrix` include `dependencies` field in response
- [ ] AC-22: Dependencies use OR semantics — a rule with multiple required rules is satisfied if any one is selected
- [ ] AC-23: Dependencies are unidirectional — A depends on B does NOT mean B depends on A
- [ ] AC-24: Creating a governance request with unsatisfied dependencies returns HTTP 400
- [ ] AC-25: Settings UI shows a "Rule Dependencies" section with checkbox toggles
- [ ] AC-26: Create form disables rules whose dependencies are not satisfied

## Test Coverage

### API Tests -- Dispatch Rules
- `api-tests/test_dispatch.py::test_list_dispatch_rules` -- covers AC-1 (list)
- `api-tests/test_dispatch.py::test_create_dispatch_rule` -- covers AC-1, AC-2 (create with `always` condition)
- `api-tests/test_dispatch.py::test_update_dispatch_rule` -- covers AC-1 (update priority and name)
- `api-tests/test_dispatch.py::test_delete_dispatch_rule` -- covers AC-1, AC-19 (soft-delete)
- `api-tests/test_dispatch.py::test_create_scoping_answer_rule` -- covers AC-2 (scoping_answer condition type)
- `api-tests/test_dispatch.py::test_create_field_value_rule` -- covers AC-2 (field_value condition type)

### API Tests -- Domain Registry
- `api-tests/test_domains.py::test_list_domains` -- covers AC-16 (list active domains)
- `api-tests/test_domains.py::test_create_domain` -- covers AC-16 (create domain)
- `api-tests/test_domains.py::test_get_domain` -- covers AC-16 (get single domain)
- `api-tests/test_domains.py::test_update_domain` -- covers AC-16 (update domain)
- `api-tests/test_domains.py::test_get_nonexistent_domain` -- covers AC-16 (404 for missing)

### API Tests -- Domain Reviews (16 tests)
- `test_list_reviews` -- covers AC-17
- `test_get_review` -- covers AC-17
- `test_accept_review` -- covers AC-6 (accept + request In Progress)
- `test_return_review` -- covers AC-7 (return with reason, request status unchanged)
- `test_resubmit_review` -- covers AC-8 (resubmit after return)
- `test_approve_review` -- covers AC-10
- `test_approve_with_exception` -- covers AC-11
- `test_not_pass_review` -- covers AC-12
- `test_accept_is_one_way` -- covers AC-9 (400 on return after accept)
- `test_auto_complete_request` -- covers AC-13, AC-14
- `test_invalid_transition_*` -- covers AC-15
- `test_filter_reviews_by_request` -- covers AC-17

### E2E Tests
- `e2e-tests/settings.spec.ts` -- "domains page loads" covers AC-16 (domain registry UI)
- `e2e-tests/settings.spec.ts` -- "dispatch rules page loads" covers AC-1 (dispatch rules UI)

## Test Map Entries

```
backend/app/routers/dispatch_rules.py  -> api-tests/test_dispatch.py
backend/app/routers/domain_reviews.py  -> api-tests/test_domain_reviews.py
backend/app/routers/domain_registry.py -> api-tests/test_domains.py
frontend/src/app/(sidebar)/settings/dispatch-rules/ -> e2e-tests/settings.spec.ts
frontend/src/app/(sidebar)/domains/                 -> e2e-tests/settings.spec.ts
```

## Notes

- **Soft-delete pattern**: Both `dispatch_rule` and `domain_registry` use `is_active` flags rather than hard deletes, preserving referential integrity with existing `domain_review` records.
- **Dispatcher removed (v2)**: The separate dispatch execution step has been removed. Submit now directly creates domain reviews via the governance_requests submit endpoint.
- **ISR removed (v2)**: The `info_supplement_request` table and `/api/info-requests` endpoints have been removed. "Return for Additional Information" is now a domain review status.
- **Waive removed (v2)**: Reviews can no longer be waived. All reviews must reach a terminal decision (Approved, Approved with Exception, Not Passed).
- **camelCase response mapping**: All routers map snake_case database columns to camelCase JSON keys in API responses, consistent with the project convention.
- **Condition evaluation**: Rule conditions are evaluated case-insensitively with trimmed whitespace. Numeric operators (`gt`, `lt`) silently skip on parse failure rather than erroring.
