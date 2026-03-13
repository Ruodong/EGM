# Feature: Project Linking

**Status**: Implemented
**Date**: 2026-03-11
**Spec Version**: 1

## Summary

Governance requests can optionally be linked to a project via two modes:

- **MSPO Project**: Select from the `project` table (read-only replica synced from EAM). Project data is snapshotted into 16 `project_*` columns on `governance_request` at creation time. The FK to `project(project_id)` is retained for future sync updates.
- **Non-MSPO Project**: Manually enter project details (code, name, description, PM, dates). No FK — data lives only on `governance_request`.

A `project_type` column (`'mspo'`, `'non_mspo'`, or `NULL` for legacy data) distinguishes the modes.

## Affected Files

### Backend
- `backend/app/routers/projects.py` — Read-only project API (list with search, get by ID)
- `backend/app/routers/governance_requests.py` — project_type-aware create/update; MSPO snapshots project data, Non-MSPO stores manual fields; no LEFT JOIN (project_name is now a column on governance_request)

### Frontend
- `frontend/src/app/governance/create/page.tsx` — Searchable project dropdown with debounced typeahead

### Database
- `scripts/schema.sql` — `project` table definition; `governance_request.project_id` FK with `ON DELETE SET NULL`; 16 `project_*` snapshot columns on `governance_request`

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

1. A **Project** toggle with two buttons: **MSPO Project** (default) and **Non-MSPO Project**.
2. **MSPO mode**: Search input with debounced typeahead (300 ms) against `GET /projects?search=<query>&pageSize=10`. Selecting a project shows a read-only display of all project fields (Code, Name, Type, Status, PM, DT Lead, IT Lead, Dates, AI Related) with a "Clear" button.
3. **Non-MSPO mode**: Manual form with editable fields: Project Code, Project Name, Description, Project Manager, Start Date, Go Live Date, End Date.
4. Switching modes clears the other mode's data.
5. The project section is optional; submitting without selecting/filling a project is valid (no `projectType` sent).
6. On submit, MSPO sends `projectType: 'mspo'` + `projectId`; Non-MSPO sends `projectType: 'non_mspo'` + manual field values.

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
- [x] AC-5: `POST /governance-requests` with `projectType: 'mspo'` + valid `projectId` creates the request and returns all `project_*` snapshot fields
- [x] AC-5b: `POST /governance-requests` with `projectId` but no `projectType` (backward compat) snapshots project data and returns `projectName`
- [x] AC-6: `POST /governance-requests` with a non-existent `projectId` returns 400 with "not found" in the detail message
- [x] AC-7: `POST /governance-requests` with `projectType: 'non_mspo'` stores manual `projectCode`, `projectName`, etc.; `projectId` (FK) is `null`
- [x] AC-7b: `POST /governance-requests` without any project fields succeeds with all project fields `null`
- [x] AC-8: `PUT /governance-requests/{id}` supports `projectType`-aware updates
- [x] AC-9: Governance request responses include all `project_*` fields (no LEFT JOIN; data is on `governance_request` table)
- [x] AC-10: Frontend MSPO/Non-MSPO toggle with search dropdown (MSPO) and manual form (Non-MSPO)
- [x] AC-11: Selected project can be cleared, resetting the field to empty
- [x] AC-12: Detail page shows Project Information card with snapshot fields when project data exists

## Test Coverage

### API Tests — Projects
- `api-tests/test_projects.py::test_list_projects` — covers AC-1
- `api-tests/test_projects.py::test_list_projects_with_search` — covers AC-2
- `api-tests/test_projects.py::test_list_projects_page_size` — covers AC-3
- `api-tests/test_projects.py::test_get_project_not_found` — covers AC-4
- `api-tests/test_projects.py::test_get_project_by_id` — covers AC-4

### API Tests — Governance Request + Project Linking
- `api-tests/test_governance_requests.py::test_create_request_with_project` — covers AC-5b (backward compat)
- `api-tests/test_governance_requests.py::test_create_mspo_project` — covers AC-5 (MSPO snapshot)
- `api-tests/test_governance_requests.py::test_create_non_mspo_project` — covers AC-7 (Non-MSPO manual fields)
- `api-tests/test_governance_requests.py::test_create_mspo_without_project_id_fails` — covers AC-6
- `api-tests/test_governance_requests.py::test_create_request_invalid_project` — covers AC-6
- `api-tests/test_governance_requests.py::test_get_request_returns_project_fields` — covers AC-9, AC-12
- `api-tests/test_governance_requests.py::test_create_request_with_empty_optional_fields` — covers AC-7b

### E2E Tests
- `e2e-tests/governance-requests.spec.ts` — covers AC-10, AC-11 (MSPO/Non-MSPO toggle and project interaction in create form)

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
