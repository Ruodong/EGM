# Feature: Governance Requests

**Status**: Implemented
**Date**: 2026-03-12
**Spec Version**: 4

## Summary

Governance Requests is the core feature of EGM, providing full CRUD lifecycle management for governance review requests. Each request follows a structured workflow from Draft through Submitted, In Review, and finally Completed with a recorded verdict. Requests can be optionally linked to projects from the EAM system and support filtering, pagination, sorting, and audit logging throughout their lifecycle.

## Affected Files

### Backend
- `backend/app/routers/governance_requests.py` — CRUD endpoints, status transitions (submit, verdict), delete, filter options, pagination/sorting, attachment CRUD
- `backend/app/routers/employees.py` — Employee search endpoint for PM itcode autocomplete

### Frontend
- `frontend/src/app/(sidebar)/requests/page.tsx` — List view with DataTable (sortable columns, CSV export), status dropdown filter, search, date range pickers, pagination
- `frontend/src/components/shared/DataTable.tsx` — Reusable table component with column sorting, CSV export, pagination
- `frontend/src/lib/csv.ts` — CSV generation + browser download utility
- `frontend/src/app/governance/create/page.tsx` — Create form with project search/select, priority picker, target date, and organization fields
- `frontend/src/app/governance/[requestId]/page.tsx` — Detail view with step indicator, request metadata, review progress panel, and verdict display

### Database
- `governance_request` table — stores all request data including `egq_id` (auto-generated daily-reset ID), `gov_project_type`, `business_unit`, and 16 `project_*` snapshot columns (project_type, project_code, project_name, project_proj_type, project_status, project_description, project_pm, project_pm_itcode, etc.)
- `governance_request_attachment` table — stores file attachments as BYTEA with metadata (file_name, file_size, content_type)
- `gr_seq` PostgreSQL sequence — generates unique `GR-XXXXXX` business IDs atomically
- `project` table — MSPO projects reference via FK; project data is snapshotted to `governance_request` at creation
- `frontend/src/config/project-types.json` — configurable project type options (PoC, New Solution, Existing Solution enhancement)
- `frontend/src/config/business-units.json` — configurable business unit options (IDG, Moto, SSG, ISG, ISO, PRC, DT&IT, HR, Finance, Legal, Security, Other)

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/governance-requests` | List requests with pagination, sorting, and filters (status, priority, requestor, search, dateFrom, dateTo) |
| GET | `/api/governance-requests/filter-options` | Return distinct statuses and priorities for filter dropdowns |
| GET | `/api/governance-requests/{request_id}` | Get a single request by business ID (`GR-XXXXXX`) or UUID |
| POST | `/api/governance-requests` | Create a new request in Draft status; generates `GR-XXXXXX` ID via sequence and `EGQyymmdd####` EGQ ID |
| PUT | `/api/governance-requests/{request_id}` | Update mutable fields (title, description, projectId, organization, priority, targetDate, govProjectType) |
| PUT | `/api/governance-requests/{request_id}/submit` | Transition from Draft to Submitted status |
| PUT | `/api/governance-requests/{request_id}/verdict` | Record final verdict (Approved, Approved with Conditions, Rejected, Deferred); transitions to Completed |
| DELETE | `/api/governance-requests/{request_id}` | Delete a request (only allowed in Draft status) |
| POST | `/api/governance-requests/{request_id}/attachments` | Upload a file attachment (multipart/form-data) |
| GET | `/api/governance-requests/{request_id}/attachments` | List attachment metadata for a request |
| GET | `/api/governance-requests/{request_id}/attachments/{att_id}` | Download attachment binary |
| DELETE | `/api/governance-requests/{request_id}/attachments/{att_id}` | Delete an attachment |
| GET | `/api/employees/search?q={query}` | Search employees by itcode or name (ILIKE) |

## UI Behavior

### List Page (`/requests`)
- Displays a paginated table of all governance requests with columns: Request ID, EGQ ID, Status, Priority, Requestor, Verdict, Created
- **Filter bar** between header and status tabs: keyword search input (left) + date range pickers (right)
  - Keyword search: debounced (300ms) text input, searches Request ID and Title via `search` param
  - Date range: two date pickers (From / To) filter by `create_at` via `dateFrom`/`dateTo` params
  - All filters combine with AND logic; changing any filter resets pagination to page 1
- Status filter dropdown: All, Draft, Submitted, In Review, Info Requested, Completed
- Changing the dropdown selection resets pagination to page 1 and filters the list by that status
- Column headers (Request ID, EGQ ID, Status, Priority, Requestor, Created) support click-to-sort with ASC/DESC toggle indicators
- "Export CSV" button above the table downloads the current page data as a .csv file
- "New Request" button in the top-right navigates to the create form
- Request ID column is a clickable link to the detail page
- Pagination controls shown at the bottom when total pages exceed 1

### Create Page (`/governance/create`)
- Form fields: EGQ ID (auto-generated, read-only placeholder), Governance Project Type (select from configurable options), Project (MSPO/Non-MSPO toggle), Organization, Priority (select: Low/Normal/High/Critical, defaults to Normal), Target Date (date picker)
- **EGQ ID**: Auto-generated by backend on submission in `EGQyymmdd####` format (daily-reset sequence). Frontend displays "Auto-generated upon submission" placeholder.
- **Governance Project Type**: Dropdown selector loaded from `frontend/src/config/project-types.json`. Options: PoC, New Solution, Existing Solution enhancement.
- **MSPO Project mode** (default): Search-as-you-type dropdown against `/projects` endpoint; selecting a project displays all fields read-only (Code, Name, Type, Status, PM, DT Lead, IT Lead, Dates, AI Related)
- **Non-MSPO Project mode**: Manual form with editable fields (Project Code, Name, Description, PM, Start/Go-Live/End Date)
- **MSPO/Non-MSPO caching**: Switching modes preserves the other mode's data in state. Both modes' data are kept independently; only the active mode's data is sent on submit.
- On submit: POST to `/governance-requests` with `govProjectType`, then redirect to the new request's detail page (`/governance/{requestId}`)
- Cancel button navigates back

### Detail Page (`/governance/{requestId}`)
- Header shows EGQ ID (or business ID fallback), governance project type, project name, status badge, priority, and verdict badge (if set)
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

- [x] AC-1: Creating a request generates a unique sequential business ID in `GR-XXXXXX` format, an auto-generated EGQ ID in `EGQyymmdd####` format (daily-reset sequence), and sets status to Draft
- [x] AC-2: Requests can be retrieved by either business ID (`GR-XXXXXX`) or UUID
- [x] AC-3: Mutable fields (title, description, projectId, organization, priority, targetDate, govProjectType) can be updated via PUT
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
- [x] ~~AC-16: The create form validates that title is required before submission~~ (Superseded by AC-24 — title is no longer user-editable, auto-set to EGQ ID)
- [x] AC-17: The detail page displays a step indicator, request metadata, and review progress (when applicable)
- [x] AC-18: List endpoint supports dateFrom and dateTo query params to filter by create_at date range
- [x] AC-19: The list page displays a keyword search input that filters by Request ID, Title, or EGQ ID with 300ms debounce
- [x] AC-20: The list page displays date range pickers (From/To) that filter results by creation date
- [x] AC-21: List page table headers support click-to-sort with ASC/DESC toggle indicators, sort params sent to backend
- [x] AC-22: List page has an "Export CSV" button that downloads the current filtered page data as a .csv file
- [x] AC-23: Status filter is a dropdown select instead of tab buttons
- [x] AC-24: EGQ ID is auto-generated by backend in `EGQyymmdd####` format with daily-reset sequence; title field is removed from the create form and auto-set to the EGQ ID value
- [x] AC-25: EGQ IDs within the same day are sequential (e.g., EGQ260312001, EGQ260312002)
- [x] AC-26: Creating a request without a title succeeds; title defaults to EGQ ID
- [x] AC-27: Governance project type (`govProjectType`) can be set on create and updated via PUT; accepted values loaded from configurable `project-types.json`
- [x] AC-28: Search endpoint matches `egq_id` in addition to `request_id` and `title`
- [x] AC-29: Detail page heading displays EGQ ID (with fallback to request ID), governance project type, and project name
- [x] AC-30: Switching between MSPO and Non-MSPO modes on the create form preserves the other mode's data in state (cache behavior)
- [x] AC-31: Business Unit (`businessUnit`) can be set on create and updated via PUT; accepted values loaded from configurable `business-units.json`
- [x] AC-32: Business Unit is displayed on the detail page in the Request Details section
- [x] AC-33: Multiple file attachments can be uploaded after request creation via POST multipart endpoint
- [x] AC-34: Attachments metadata (fileName, fileSize, contentType) can be listed via GET
- [x] AC-35: Individual attachments can be downloaded as binary via GET with correct Content-Disposition
- [x] AC-36: Attachments can be deleted via DELETE endpoint
- [x] AC-37: Detail page displays attachments with download links
- [x] AC-38: Non-MSPO project PM can be selected via itcode autocomplete searching employee_info
- [x] AC-39: Employee search endpoint returns matching employees by itcode or name (ILIKE)
- [x] AC-40: Non-MSPO PM itcode is saved to governance_request.project_pm_itcode on create and update

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
- `test_filter_by_status` — covers AC-10 (status query param filters results; verifies no ambiguous column with LEFT JOIN)
- `test_filter_by_priority` — covers AC-10 (priority query param filters results)
- `test_egq_id_format` — covers AC-24 (EGQ ID format `EGQyymmdd####`)
- `test_egq_id_daily_sequence` — covers AC-25 (sequential EGQ IDs within same day)
- `test_create_without_title` — covers AC-26 (title no longer required, auto-set to EGQ ID)
- `test_gov_project_type` — covers AC-27 (govProjectType saved and returned via POST and GET)
- `test_update_gov_project_type` — covers AC-27 (govProjectType can be updated via PUT)
- `test_search_by_egq_id` — covers AC-28 (search matches egq_id)
- `test_create_request_with_business_unit` — covers AC-31 (businessUnit saved on create)
- `test_update_request_business_unit` — covers AC-31 (businessUnit updated via PUT)
- `test_create_request_without_business_unit` — covers AC-31 (optional, defaults to null)
- `test_upload_attachment` — covers AC-33 (multipart file upload)
- `test_list_attachments` — covers AC-34 (list attachment metadata)
- `test_download_attachment` — covers AC-35 (download binary with Content-Disposition)
- `test_delete_attachment` — covers AC-36 (delete attachment)
- `test_upload_attachment_invalid_request` — covers AC-33 (404 on non-existent request)
- `test_create_nonmspo_with_pm_itcode` — covers AC-40 (PM itcode saved for non-MSPO)
- `test_create_nonmspo_without_pm_itcode` — covers AC-40 (backward compat without PM itcode)

### API Tests (`api-tests/test_employees.py`)
- `test_search_employees_by_itcode` — covers AC-39 (search by itcode)
- `test_search_employees_by_name` — covers AC-39 (search by name)
- `test_search_employees_min_length` — covers AC-39 (validation: min query length)
- `test_search_employees_no_match` — covers AC-39 (empty results for non-existent query)
- `test_search_employees_limit` — covers AC-39 (max 10 results)

### E2E Tests (`e2e-tests/governance-requests.spec.ts`)
- `"list page loads with table"` — covers AC-15 (heading and New Request button visible)
- `"create new request via form"` — covers AC-1, AC-24, AC-27 (EGQ ID auto-generated, project type selector visible, redirect to detail)
- `"view request detail page"` — covers AC-17, AC-29 (detail page renders EGQ ID heading)
- `"status filter dropdown filters results"` — covers AC-10, AC-23 (status dropdown triggers filtered API call, response contains only matching rows)
- `"search box filters requests"` — covers AC-19 (search input visible and functional)
- `"date range pickers are visible"` — covers AC-20 (date From/To inputs rendered)
- `"column header sort indicators appear on click"` — covers AC-21 (sort indicator on EGQ ID column click)
- `"export CSV button is visible"` — covers AC-22 (Export CSV button visible)
- `"create form shows business unit dropdown"` — covers AC-31 (BU dropdown visible and selectable)
- `"create request with BU and verify on detail page"` — covers AC-31, AC-32 (BU saved and displayed on detail)
- `"create form shows file upload component"` — covers AC-33 (file upload button visible)
- `"file upload adds files to list"` — covers AC-33 (files appear in attachment list)
- `"create request with attachment and verify on detail page"` — covers AC-33, AC-37 (upload + detail page display)
- `"non-MSPO PM autocomplete search"` — covers AC-38 (PM itcode autocomplete search and selection)

## Test Map Entries

```
backend/app/routers/governance_requests.py -> api-tests/test_governance_requests.py
backend/app/routers/employees.py          -> api-tests/test_employees.py
frontend/src/app/governance/create/       -> e2e-tests/governance-requests.spec.ts
frontend/src/app/governance/[requestId]/  -> e2e-tests/governance-requests.spec.ts
frontend/src/app/(sidebar)/requests/      -> e2e-tests/governance-requests.spec.ts
frontend/src/components/shared/DataTable.tsx -> e2e-tests/governance-requests.spec.ts
frontend/src/lib/csv.ts                   -> e2e-tests/governance-requests.spec.ts
```

## Notes

- **ID generation**: Uses a PostgreSQL sequence (`gr_seq`) with `nextval()` to avoid race conditions on concurrent request creation. The format `GR-XXXXXX` is zero-padded to six digits. Additionally, an EGQ ID is generated in `EGQyymmdd####` format using a COUNT-based daily-reset approach (count existing EGQ IDs with today's prefix + 1).
- **Dual-lookup pattern**: All single-resource endpoints accept either the business ID (`GR-XXXXXX`) or the PostgreSQL UUID, using the condition `WHERE request_id = :id OR id::text = :id`.
- **Verdict guards**: Recording a verdict enforces two preconditions beyond status checks: (1) all domain reviews must be in "Review Complete" or "Waived" status, and (2) all information supplement requests (ISRs) must be resolved (not in "Open" or "Acknowledged" status).
- **Project linking**: The optional `projectId` field references the `project` table (synced from EAM). A LEFT JOIN resolves `projectName` on all read operations. Invalid project IDs are rejected at creation and update time.
- **Audit trail**: Create, submit, and verdict actions write entries to the audit log via `write_audit()`, capturing old and new values for traceability.
- **camelCase mapping**: The `_map()` function converts snake_case database columns to camelCase JSON keys, consistent with the project-wide API convention.
- **Status lifecycle**: Draft -> Submitted -> (dispatcher moves to In Review) -> Completed. The "In Review" and "Info Requested" states are managed by other subsystems (dispatcher, domain reviews, ISRs) rather than this router directly.
