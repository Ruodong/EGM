# Feature: Domain Dispatch

**Status**: Implemented
**Date**: 2026-03-11
**Spec Version**: 1

## Summary

Domain Dispatch governs how governance requests are routed to the appropriate review domains. It encompasses four subsystems: a **domain registry** that defines available governance domains, **dispatch rules** that encode routing logic (condition-based or always-on), a **dispatcher** that evaluates those rules against intake scoping answers to create domain review records, and a **domain review lifecycle** that tracks each review from creation through assignment, progress, and completion.

## Affected Files

### Backend
- `backend/app/routers/dispatch_rules.py` -- Admin CRUD for dispatch rules (create, list, update, soft-delete)
- `backend/app/routers/dispatcher.py` -- Execution engine that evaluates rules and creates domain review records
- `backend/app/routers/domain_reviews.py` -- Domain review lifecycle (list, get, assign, start, complete, waive)
- `backend/app/routers/domain_registry.py` -- Manage governance domain definitions (CRUD)

### Frontend
- `frontend/src/app/(sidebar)/settings/dispatch-rules/page.tsx` -- Admin UI for managing dispatch rules
- `frontend/src/app/(sidebar)/domains/page.tsx` -- Domain registry listing page
- `frontend/src/app/(sidebar)/reviews/page.tsx` -- Domain reviews dashboard
- `frontend/src/app/governance/[requestId]/reviews/page.tsx` -- Per-request review list
- `frontend/src/app/governance/[requestId]/reviews/[domainCode]/page.tsx` -- Single domain review detail

### Database
- `scripts/schema.sql` -- Tables: `domain_registry`, `dispatch_rule`, `domain_review`

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
| status | VARCHAR | `Pending`, `Assigned`, `In Progress`, `Review Complete`, `Waived` |
| reviewer | VARCHAR | Assigned reviewer ID |
| reviewer_name | VARCHAR | Assigned reviewer display name |
| outcome | VARCHAR | `Approved`, `Approved with Conditions`, `Rejected`, `Deferred` |
| outcome_notes | TEXT | Reviewer notes on the outcome |
| external_ref_id | VARCHAR | Reference to external tracking system |
| common_data_updated_at | TIMESTAMP | Last sync of common data |
| started_at | TIMESTAMP | When review work began |
| completed_at | TIMESTAMP | When review was completed |
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

### Dispatcher (`/api/dispatch`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/dispatch/execute/{request_id}` | `governance_request:write` | Execute dispatch for a governance request; creates domain_review records and sets request status to "In Review" |

### Domain Reviews (`/api/domain-reviews`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/domain-reviews` | `domain_review:read` | List reviews with pagination; filterable by `request_id`, `domainCode`, `status`, `reviewer` |
| GET | `/api/domain-reviews/{review_id}` | `domain_review:read` | Get a single review by UUID |
| PUT | `/api/domain-reviews/{review_id}/assign` | `domain_review:write` | Assign a reviewer; status becomes "Assigned" |
| PUT | `/api/domain-reviews/{review_id}/start` | `domain_review:write` | Mark review as "In Progress"; records `started_at` timestamp |
| PUT | `/api/domain-reviews/{review_id}/complete` | `domain_review:write` | Complete review with outcome (`Approved`, `Approved with Conditions`, `Rejected`, `Deferred`); records `completed_at` timestamp and writes audit log |
| PUT | `/api/domain-reviews/{review_id}/waive` | `domain_review:write` | Waive the review; status becomes "Waived" |

## Dispatch Execution Logic

When `POST /api/dispatch/execute/{request_id}` is called:

1. **Explicit domains**: If `domainCodes` is provided in the request body, those domains are dispatched directly.
2. **Auto-evaluation** (when no `domainCodes` provided):
   a. Scoping answers from `intake_response` are checked against `intake_template.triggers_domain` -- any non-empty, truthy answer triggers the associated domain(s).
   b. Active `dispatch_rule` records are evaluated:
      - `always` rules unconditionally add their domain.
      - `scoping_answer` and `field_value` rules compare the scoping answer for `condition_field` against `condition_value` using `condition_operator`.
   c. If no domains are triggered by either mechanism, **all active domains** from `domain_registry` are dispatched as a fallback.
3. For each resolved domain code:
   - The domain must exist and be active in `domain_registry`.
   - If a `domain_review` already exists for the same request + domain, it is skipped (idempotency).
   - A new `domain_review` record is created with status "Pending".
4. The governance request status is updated to "In Review".

### Supported Condition Operators
| Operator | Behavior |
|----------|----------|
| `equals` | Exact string match (case-insensitive, trimmed) |
| `not_equals` | Inverse of equals |
| `contains` | Expected value is a substring of actual value |
| `in` | Actual value is one of the expected list values |
| `gt` | Numeric greater-than comparison |
| `lt` | Numeric less-than comparison |

## UI Behavior

### Domain Registry Page (`/domains`)
- Displays a list of all active governance domains
- Admin users can create new domains and edit existing ones

### Dispatch Rules Page (`/settings/dispatch-rules`)
- Lists all dispatch rules with their condition type, target domain, and priority
- Admin users can create, edit, and deactivate rules
- Rules support three condition types: "always", "scoping_answer", and "field_value"

### Domain Reviews Dashboard (`/reviews`)
- Lists all domain reviews across requests
- Supports filtering by request, domain, status, and reviewer
- Paginated results

### Per-Request Review View (`/governance/[requestId]/reviews`)
- Shows all domain reviews for a specific governance request
- Reviewers can assign themselves, start, complete, or waive reviews
- Completion requires selecting an outcome: Approved, Approved with Conditions, Rejected, or Deferred

## Acceptance Criteria

- [x] AC-1: Admins can create, list, update, and soft-delete dispatch rules
- [x] AC-2: Dispatch rules support condition types: `always`, `scoping_answer`, `field_value`
- [x] AC-3: Dispatch rules support operators: `equals`, `not_equals`, `contains`, `in`, `gt`, `lt`
- [x] AC-4: Executing dispatch creates domain review records for each triggered domain
- [x] AC-5: Dispatch is idempotent -- re-dispatching the same domain for the same request does not create duplicates
- [x] AC-6: Executing dispatch updates the governance request status to "In Review"
- [x] AC-7: When no explicit domains or rule matches exist, all active domains are dispatched as fallback
- [x] AC-8: Domain registry supports CRUD operations; listing returns only active domains
- [x] AC-9: Domain reviews can be listed with filters (request_id, domainCode, status, reviewer) and pagination
- [x] AC-10: A domain review can be assigned to a reviewer (status transitions to "Assigned")
- [x] AC-11: A domain review can be started (status transitions to "In Progress", `started_at` recorded)
- [x] AC-12: A domain review can be completed with a valid outcome and optional notes (status transitions to "Review Complete", `completed_at` recorded, audit log written)
- [x] AC-13: Completing a review with an invalid outcome returns HTTP 400
- [x] AC-14: A domain review can be waived (status transitions to "Waived")
- [x] AC-15: Dispatch rules DELETE endpoint performs soft-delete (sets `is_active = false`)
- [x] AC-16: All endpoints enforce RBAC -- admin-only for write operations on rules and domains

## Test Coverage

### API Tests -- Dispatch Rules and Dispatcher
- `api-tests/test_dispatch.py::test_list_dispatch_rules` -- covers AC-1 (list)
- `api-tests/test_dispatch.py::test_create_dispatch_rule` -- covers AC-1, AC-2 (create with `always` condition)
- `api-tests/test_dispatch.py::test_update_dispatch_rule` -- covers AC-1 (update priority and name)
- `api-tests/test_dispatch.py::test_delete_dispatch_rule` -- covers AC-1, AC-15 (soft-delete)
- `api-tests/test_dispatch.py::test_execute_dispatch` -- covers AC-4, AC-6 (explicit domain dispatch)
- `api-tests/test_dispatch.py::test_execute_dispatch_idempotent` -- covers AC-5 (no duplicate reviews)
- `api-tests/test_dispatch.py::test_create_scoping_answer_rule` -- covers AC-2 (scoping_answer condition type)
- `api-tests/test_dispatch.py::test_create_field_value_rule` -- covers AC-2 (field_value condition type)

### API Tests -- Domain Registry
- `api-tests/test_domains.py::test_list_domains` -- covers AC-8 (list active domains)
- `api-tests/test_domains.py::test_create_domain` -- covers AC-8 (create domain with all fields)
- `api-tests/test_domains.py::test_get_domain` -- covers AC-8 (get single domain by code)
- `api-tests/test_domains.py::test_update_domain` -- covers AC-8 (update domain name and description)
- `api-tests/test_domains.py::test_get_nonexistent_domain` -- covers AC-8 (404 for missing domain)

### API Tests -- Domain Reviews
- `api-tests/test_domain_reviews.py::test_list_reviews` -- covers AC-9 (list with pagination)
- `api-tests/test_domain_reviews.py::test_dispatch_creates_review` -- covers AC-4 (dispatch creates review with Pending status)
- `api-tests/test_domain_reviews.py::test_get_review` -- covers AC-9 (get single review)
- `api-tests/test_domain_reviews.py::test_assign_reviewer` -- covers AC-10 (assign reviewer, status = Assigned)
- `api-tests/test_domain_reviews.py::test_start_review` -- covers AC-11 (start review, status = In Progress)
- `api-tests/test_domain_reviews.py::test_complete_review` -- covers AC-12 (complete with Approved outcome)
- `api-tests/test_domain_reviews.py::test_complete_invalid_outcome` -- covers AC-13 (400 on invalid outcome)
- `api-tests/test_domain_reviews.py::test_waive_review` -- covers AC-14 (waive review, status = Waived)
- `api-tests/test_domain_reviews.py::test_filter_reviews_by_request` -- covers AC-9 (filter by request_id)

### E2E Tests
- `e2e-tests/settings.spec.ts` -- "domains page loads" covers AC-8 (domain registry UI)
- `e2e-tests/settings.spec.ts` -- "dispatch rules page loads" covers AC-1 (dispatch rules UI)

## Test Map Entries

```
backend/app/routers/dispatch_rules.py  -> api-tests/test_dispatch.py
backend/app/routers/dispatcher.py      -> api-tests/test_dispatch.py
backend/app/routers/domain_reviews.py  -> api-tests/test_domain_reviews.py
backend/app/routers/domain_registry.py -> api-tests/test_domains.py
frontend/src/app/(sidebar)/settings/dispatch-rules/ -> e2e-tests/settings.spec.ts
frontend/src/app/(sidebar)/domains/                 -> e2e-tests/settings.spec.ts
```

## Notes

- **Soft-delete pattern**: Both `dispatch_rule` and `domain_registry` use `is_active` flags rather than hard deletes, preserving referential integrity with existing `domain_review` records.
- **Idempotent dispatch**: The dispatcher checks for existing `domain_review` records (via the `UNIQUE(request_id, domain_code)` constraint) before inserting, so re-executing dispatch is safe and will not create duplicates.
- **Fallback behavior**: When auto-evaluation yields no triggered domains (e.g., no scoping answers have been submitted yet), the dispatcher dispatches to all active domains. This ensures no request is left without review coverage.
- **Audit logging**: Only the `complete_review` action writes to the audit log. Other lifecycle transitions (assign, start, waive) are tracked via the `update_by` / `update_at` columns on the `domain_review` table.
- **camelCase response mapping**: All routers map snake_case database columns to camelCase JSON keys in API responses, consistent with the project convention.
- **Condition evaluation**: Rule conditions are evaluated case-insensitively with trimmed whitespace. Numeric operators (`gt`, `lt`) silently skip on parse failure rather than erroring.
