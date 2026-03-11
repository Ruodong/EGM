# Feature: Project Linking

**Status**: Implemented
**Date**: 2026-03-11
**Spec Version**: 1

## Summary

Governance requests can optionally be linked to a project sourced from the Enterprise Architecture Management (EAM) system. The `project` table in EGM is a read-only replica kept in sync via a batch script. A searchable dropdown in the create-request form lets requestors find and attach a project, while the backend validates the foreign key on create and update.

## Affected Files

### Backend
- `backend/app/routers/projects.py` — Read-only project API (list with search, get by ID)
- `backend/app/routers/governance_requests.py` — project_id validation on create and update; LEFT JOIN to resolve project_name

### Frontend
- `frontend/src/app/governance/create/page.tsx` — Searchable project dropdown with debounced typeahead

### Database
- `scripts/schema.sql` — `project` table definition; `governance_request.project_id` FK to `project(project_id)` with `ON DELETE SET NULL`

### Scripts
- `scripts/sync_projects.py` — Batch upsert from EAM (port 5432) to EGM (port 5433) using asyncpg

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/projects` | List projects with optional `search` and `pageSize` query params |
| GET | `/projects/{project_id}` | Get a single project by its business ID |
| POST | `/governance-requests` | Create request; validates `projectId` if provided |
| PUT | `/governance-requests/{request_id}` | Update request; validates `projectId` if present in body |

### Projects List Response Shape

```json
{
  "data": [
    {
      "id": "<internal UUID>",
      "projectId": "PRJ-FY25-001",
      "projectName": "Platform Modernization",
      "type": "Investment",
      "status": "Active",
      "pm": "Jane Doe",
      "pmItcode": "jdoe",
      "dtLead": "...",
      "dtLeadItcode": "...",
      "itLead": "...",
      "itLeadItcode": "...",
      "startDate": "...",
      "goLiveDate": "...",
      "endDate": "...",
      "aiRelated": "Yes",
      "source": "EAM"
    }
  ],
  "total": 42
}
```

### Project Validation on Create / Update

When `projectId` is supplied in the request body, the router executes:

```sql
SELECT 1 FROM project WHERE project_id = :pid
```

If no row is found, a `400 Bad Request` is returned with detail `"Project '<pid>' not found"`.

An empty string for `projectId` is normalized to `NULL` and skips validation.

## UI Behavior

1. On the create-request form, a **Project** field is displayed as a text input with placeholder "Search by project ID or name...".
2. As the user types, a debounced search (300 ms) calls `GET /projects?search=<query>&pageSize=10`.
3. A dropdown appears below the input showing matching projects. Each row displays the project ID on the first line and the project name plus PM on the second line.
4. Clicking a result selects it: the input is replaced with a read-only chip showing `"<projectId> - <projectName>"` and a **Clear** button.
5. Clicking **Clear** resets the selection and restores the search input.
6. Clicking outside the dropdown closes it.
7. The project field is optional; submitting the form without a project is valid.
8. If no results match the search, the dropdown shows "No projects found".
9. While the API call is in flight, the dropdown shows "Searching...".

## Database Schema

### `project` table (read-only replica)

| Column | Type | Constraints |
|--------|------|-------------|
| id | VARCHAR | PRIMARY KEY |
| project_id | VARCHAR | NOT NULL, UNIQUE |
| project_name | VARCHAR | |
| type | VARCHAR | |
| status | VARCHAR | |
| pm | VARCHAR | |
| pm_itcode | VARCHAR | |
| dt_lead | VARCHAR | |
| dt_lead_itcode | VARCHAR | |
| it_lead | VARCHAR | |
| it_lead_itcode | VARCHAR | |
| start_date | VARCHAR | |
| go_live_date | VARCHAR | |
| end_date | VARCHAR | |
| ai_related | VARCHAR | |
| source | VARCHAR | |
| create_by | VARCHAR | |
| create_at | TIMESTAMP | DEFAULT NOW() |
| update_at | TIMESTAMP | |

### `governance_request.project_id` foreign key

```sql
project_id VARCHAR REFERENCES project(project_id) ON DELETE SET NULL
```

If a project is deleted from the replica, any linked governance requests retain their data but `project_id` becomes `NULL`.

## Acceptance Criteria

- [x] AC-1: `GET /projects` returns a paginated list with `data` and `total` fields
- [x] AC-2: `GET /projects?search=<term>` filters by project_id or project_name (ILIKE)
- [x] AC-3: `GET /projects?pageSize=N` limits results to N rows (max 100)
- [x] AC-4: `GET /projects/{project_id}` returns a single project or 404
- [x] AC-5: `POST /governance-requests` with a valid `projectId` creates the request and returns `projectId` and `projectName` in the response
- [x] AC-6: `POST /governance-requests` with a non-existent `projectId` returns 400 with "not found" in the detail message
- [x] AC-7: `POST /governance-requests` with an empty `projectId` (or without it) succeeds with `projectId: null`
- [x] AC-8: `PUT /governance-requests/{id}` validates `projectId` when the field is present in the body
- [x] AC-9: Governance request list and detail queries JOIN project to include `projectName`
- [x] AC-10: Frontend project dropdown performs debounced search and displays results
- [x] AC-11: Selected project can be cleared, resetting the field to empty

## Test Coverage

### API Tests — Projects
- `api-tests/test_projects.py::test_list_projects` — covers AC-1
- `api-tests/test_projects.py::test_list_projects_with_search` — covers AC-2
- `api-tests/test_projects.py::test_list_projects_page_size` — covers AC-3
- `api-tests/test_projects.py::test_get_project_not_found` — covers AC-4
- `api-tests/test_projects.py::test_get_project_by_id` — covers AC-4

### API Tests — Governance Request + Project Linking
- `api-tests/test_governance_requests.py::test_create_request_with_project` — covers AC-5, AC-9
- `api-tests/test_governance_requests.py::test_create_request_invalid_project` — covers AC-6
- `api-tests/test_governance_requests.py::test_create_request_with_empty_optional_fields` — covers AC-7

### E2E Tests
- `e2e-tests/governance-requests.spec.ts` — covers AC-10, AC-11 (project dropdown interaction in create form)

## Test Map Entries

```
backend/app/routers/projects.py              -> api-tests/test_projects.py
backend/app/routers/governance_requests.py   -> api-tests/test_governance_requests.py
frontend/src/app/governance/create/page.tsx  -> e2e-tests/governance-requests.spec.ts
```

## Notes

### EAM to EGM Sync

The `project` table in EGM is not populated by the application itself. A standalone script (`scripts/sync_projects.py`) connects directly to both PostgreSQL instances:

- **Source**: EAM database at `localhost:5432/eam_local`, schema `eam`, table `eam.project`
- **Target**: EGM database at `localhost:5433/egm_local`, schema `egm`, table `egm.project`

The script reads all rows from EAM and performs an **upsert** (`INSERT ... ON CONFLICT (id) DO UPDATE`) into EGM. It syncs all 19 columns and is idempotent. It is designed to be run on demand or via a cron job; the application does not trigger it automatically.

### Design Decisions

- **Read-only in EGM**: The projects router exposes only `GET` endpoints. All project data is mastered in EAM. EGM never creates, updates, or deletes project records through its API.
- **ON DELETE SET NULL**: If a project row is removed during sync (or manually), governance requests are not orphaned; they simply lose their project association.
- **ILIKE search**: The project search supports case-insensitive partial matching on both `project_id` and `project_name`, which aligns with the frontend typeahead UX.
- **Debounced frontend search (300 ms)**: Prevents excessive API calls while the user is still typing.
- **Validation before insert**: The backend does not rely on the database FK constraint alone for error messaging. It explicitly checks for project existence and returns a user-friendly 400 error before attempting the insert.
