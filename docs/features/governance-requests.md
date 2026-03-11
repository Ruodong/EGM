# Feature: Governance Requests

**Status**: Implemented
**Date**: 2026-03-11
**Spec Version**: 3

## Summary

Governance Requests is the core feature of EGM, providing full CRUD lifecycle management for governance review requests. Each request follows a structured workflow from Draft through Submitted, In Review, and finally Completed with a recorded verdict. Requests can be optionally linked to projects from the EAM system and support filtering, pagination, sorting, and audit logging throughout their lifecycle.

## Affected Files

### Backend
- `backend/app/routers/governance_requests.py` — CRUD endpoints, status transitions (submit, verdict), delete, filter options, pagination/sorting

### Frontend
- `frontend/src/app/(sidebar)/requests/page.tsx` — List view with DataTable (sortable columns, CSV export), status dropdown filter, search, date range pickers, pagination
- `frontend/src/components/shared/DataTable.tsx` — Reusable table component with column sorting, CSV export, pagination
- `frontend/src/lib/csv.ts` — CSV generation + browser download utility
- `frontend/src/app/governance/create/page.tsx` — Create form with project search/select, priority picker, target date, and organization fields
- `frontend/src/app/governance/[requestId]/page.tsx` — Detail view with step indicator, request metadata, review progress panel, and verdict display

### Database
- `governance_request` table — stores all request data (id, request_id, title, description, project_id, requestor, requestor_name, organization, status, overall_verdict, priority, target_date, completed_at, create_by, update_by, create_at, update_at)
- `gr_seq` PostgreSQL sequence — generates unique `GR-XXXXXX` business IDs atomically
- `project` table — referenced via LEFT JOIN for project name resolution

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/governance-requests` | List requests with pagination, sorting, and filters (status, priority, requestor, search, dateFrom, dateTo) |
| GET | `/api/governance-requests/filter-options` | Return distinct statuses and priorities for filter dropdowns |
| GET | `/api/governance-requests/{request_id}` | Get a single request by business ID (`GR-XXXXXX`) or UUID |
| POST | `/api/governance-requests` | Create a new request in Draft status; generates `GR-XXXXXX` ID via sequence |
| PUT | `/api/governance-requests/{request_id}` | Update mutable fields (title, description, projectId, organization, priority, targetDate) |
| PUT | `/api/governance-requests/{request_id}/submit` | Transition from Draft to Submitted status |
| PUT | `/api/governance-requests/{request_id}/verdict` | Record final verdict (Approved, Approved with Conditions, Rejected, Deferred); transitions to Completed |
| DELETE | `/api/governance-requests/{request_id}` | Delete a request (only allowed in Draft status) |

## UI Behavior

### List Page (`/requests`)
- Displays a paginated table of all governance requests with columns: Request ID, Title, Status, Priority, Requestor, Verdict, Created
- **Filter bar** between header and status tabs: keyword search input (left) + date range pickers (right)
  - Keyword search: debounced (300ms) text input, searches Request ID and Title via `search` param
  - Date range: two date pickers (From / To) filter by `create_at` via `dateFrom`/`dateTo` params
  - All filters combine with AND logic; changing any filter resets pagination to page 1
- Status filter dropdown: All, Draft, Submitted, In Review, Info Requested, Completed
- Changing the dropdown selection resets pagination to page 1 and filters the list by that status
- Column headers (Request ID, Title, Status, Priority, Requestor, Created) support click-to-sort with ASC/DESC toggle indicators
- "Export CSV" button above the table downloads the current page data as a .csv file
- "New Request" button in the top-right navigates to the create form
- Request ID column is a clickable link to the detail page
- Pagination controls shown at the bottom when total pages exceed 1

### Create Page (`/governance/create`)
- Form fields: Title (required), Description (textarea), Project (search-as-you-type dropdown), Organization, Priority (select: Low/Normal/High/Critical, defaults to Normal), Target Date (date picker)
- Project selector uses debounced search (300ms) against `/projects` endpoint; displays project ID and name in dropdown
- Selected project shows as a chip with a "Clear" button
- On submit: POST to `/governance-requests`, then redirect to the new request's detail page (`/governance/{requestId}`)
- Cancel button navigates back
- Title validation: toast error if blank on submit

### Detail Page (`/governance/{requestId}`)
- Header shows business ID, title, status badge, priority, and verdict badge (if set)
- Step indicator bar: Create > Scoping > Questionnaire > Reviews > Summary, with completed steps highlighted in teal
- Left panel: Request Details (requestor, organization, project, created date, description)
- Right panel (conditional): Review Progress showing domain completion bar, open info request count, and per-domain status list; only displayed when the request has been dispatched (status is not Draft)

### Error States
- 404 on detail page: renders "Request not found" message
- Invalid project ID on create: backend returns 400, frontend shows error toast
- Submitting a non-Draft request: backend returns 400 with message "Can only submit Draft requests"
- Recording verdict on non-In-Review request: backend returns 400
- Recording verdict with incomplete domain reviews or open ISRs: backend returns 400 with count of blockers
- Deleting a non-Draft request: backend returns 400 with message "Can only delete Draft requests"

## Acceptance Criteria

- [x] AC-1: Creating a request generates a unique sequential business ID in `GR-XXXXXX` format and sets status to Draft
- [x] AC-2: Requests can be retrieved by either business ID (`GR-XXXXXX`) or UUID
- [x] AC-3: Mutable fields (title, description, projectId, organization, priority, targetDate) can be updated via PUT
- [x] AC-4: A Draft request can be submitted, transitioning its status to Submitted
- [x] AC-5: Submitting a non-Draft request returns a 400 error
- [x] AC-6: A verdict can only be recorded on a request in "In Review" status with all domain reviews complete and no open ISRs
- [x] AC-7: Valid verdicts are: Approved, Approved with Conditions, Rejected, Deferred
- [x] AC-8: Recording a verdict transitions the request to Completed and sets completedAt timestamp
- [x] AC-9: Only Draft requests can be deleted; deleting a non-Draft request returns 400
- [x] AC-10: List endpoint supports pagination (page, pageSize), sorting (by allowed columns), and multi-value filtering (status, priority, requestor, search, dateFrom, dateTo)
- [x] AC-11: Filter options endpoint returns distinct statuses and priorities from existing data
- [x] AC-12: Creating a request with an invalid projectId returns a 400 error
- [x] AC-13: Empty optional fields (targetDate, projectId, organization) are handled gracefully as NULL
- [x] AC-14: All status transitions are recorded in the audit log
- [x] AC-15: The list page renders a table with status filter tabs and pagination controls
- [x] AC-16: The create form validates that title is required before submission
- [x] AC-17: The detail page displays a step indicator, request metadata, and review progress (when applicable)
- [x] AC-18: List endpoint supports dateFrom and dateTo query params to filter by create_at date range
- [x] AC-19: The list page displays a keyword search input that filters by Request ID or Title with 300ms debounce
- [x] AC-20: The list page displays date range pickers (From/To) that filter results by creation date
- [x] AC-21: List page table headers support click-to-sort with ASC/DESC toggle indicators, sort params sent to backend
- [x] AC-22: List page has an "Export CSV" button that downloads the current filtered page data as a .csv file
- [x] AC-23: Status filter is a dropdown select instead of tab buttons

## Test Coverage

### API Tests (`api-tests/test_governance_requests.py`)
- `test_create_request` — covers AC-1 (Draft creation with generated GR- ID)
- `test_list_requests` — covers AC-10 (list returns data and total)
- `test_get_request_by_business_id` — covers AC-2 (lookup by GR-XXXXXX)
- `test_get_request_by_uuid` — covers AC-2 (lookup by UUID)
- `test_update_request` — covers AC-3 (update title and priority)
- `test_submit_request` — covers AC-4 (Draft to Submitted transition)
- `test_submit_non_draft_fails` — covers AC-5 (400 on double-submit)
- `test_verdict_on_draft_fails` — covers AC-6 (verdict guard on non-In-Review)
- `test_verdict_invalid_value` — covers AC-7 (rejects invalid verdict string)
- `test_verdict_approved` — covers AC-6, AC-8 (full lifecycle through to Completed with verdict)
- `test_delete_draft_request` — covers AC-9 (successful Draft deletion)
- `test_delete_non_draft_fails` — covers AC-9 (400 on non-Draft deletion)
- `test_filter_options` — covers AC-11 (returns statuses and priorities)
- `test_sequence_generates_unique_ids` — covers AC-1 (sequential uniqueness)
- `test_pagination` — covers AC-10 (pageSize param limits results)
- `test_create_request_with_project` — covers AC-12 (valid project linking)
- `test_create_request_invalid_project` — covers AC-12 (400 on invalid projectId)
- `test_create_request_with_empty_optional_fields` — covers AC-13 (graceful NULL handling)
- `test_filter_by_date_range` — covers AC-18 (dateFrom/dateTo filter by create_at)
- `test_search_by_keyword` — covers AC-19 (search param filters by request_id or title)
- `test_sort_by_title_asc` — covers AC-21 (sortField=title returns alphabetically sorted data)
- `test_sort_by_create_at_desc` — covers AC-21 (default sort order is create_at DESC)

### E2E Tests (`e2e-tests/governance-requests.spec.ts`)
- `"list page loads with table"` — covers AC-15 (heading and New Request button visible)
- `"create new request via form"` — covers AC-1, AC-16 (fill title, submit, redirect to detail)
- `"view request detail page"` — covers AC-17 (detail page renders request title)
- `"status filter dropdown works"` — covers AC-23 (status dropdown select works)
- `"search box filters requests"` — covers AC-19 (search input visible and functional)
- `"date range pickers are visible"` — covers AC-20 (date From/To inputs rendered)
- `"column header sort indicators appear on click"` — covers AC-21 (sort indicator on click)
- `"export CSV button is visible"` — covers AC-22 (Export CSV button visible)

## Test Map Entries

```
backend/app/routers/governance_requests.py -> api-tests/test_governance_requests.py
frontend/src/app/governance/create/       -> e2e-tests/governance-requests.spec.ts
frontend/src/app/governance/[requestId]/  -> e2e-tests/governance-requests.spec.ts
frontend/src/app/(sidebar)/requests/      -> e2e-tests/governance-requests.spec.ts
frontend/src/components/shared/DataTable.tsx -> e2e-tests/governance-requests.spec.ts
frontend/src/lib/csv.ts                   -> e2e-tests/governance-requests.spec.ts
```

## Notes

- **ID generation**: Uses a PostgreSQL sequence (`gr_seq`) with `nextval()` to avoid race conditions on concurrent request creation. The format `GR-XXXXXX` is zero-padded to six digits.
- **Dual-lookup pattern**: All single-resource endpoints accept either the business ID (`GR-XXXXXX`) or the PostgreSQL UUID, using the condition `WHERE request_id = :id OR id::text = :id`.
- **Verdict guards**: Recording a verdict enforces two preconditions beyond status checks: (1) all domain reviews must be in "Review Complete" or "Waived" status, and (2) all information supplement requests (ISRs) must be resolved (not in "Open" or "Acknowledged" status).
- **Project linking**: The optional `projectId` field references the `project` table (synced from EAM). A LEFT JOIN resolves `projectName` on all read operations. Invalid project IDs are rejected at creation and update time.
- **Audit trail**: Create, submit, and verdict actions write entries to the audit log via `write_audit()`, capturing old and new values for traceability.
- **camelCase mapping**: The `_map()` function converts snake_case database columns to camelCase JSON keys, consistent with the project-wide API convention.
- **Status lifecycle**: Draft -> Submitted -> (dispatcher moves to In Review) -> Completed. The "In Review" and "Info Requested" states are managed by other subsystems (dispatcher, domain reviews, ISRs) rather than this router directly.
