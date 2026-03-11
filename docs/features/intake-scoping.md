# Feature: Intake & Scoping

**Status**: Implemented
**Date**: 2026-03-11
**Spec Version**: 1

## Summary

Provides a unified intake flow for governance requests, combining scoping questions and common questionnaire collection into a single system backed by configurable templates. Supports saving and updating responses, evaluating scoping answers to determine applicable review domains, and maintaining a change log for audit and ISR (information / supplemental request) feedback loops.

## Affected Files

### Backend
- `backend/app/routers/intake.py` — Intake router: template CRUD, response upsert, scoping evaluation, and change log retrieval

### Frontend
- `frontend/src/app/governance/[requestId]/scoping/page.tsx` — Scoping questions UI for a governance request
- `frontend/src/app/governance/[requestId]/common-questionnaire/page.tsx` — Common questionnaire UI for a governance request
- `frontend/src/app/governance/[requestId]/reviews/page.tsx` — Reviews overview page (post-scoping)

### Database
- `scripts/schema.sql` — `intake_template`, `intake_response`, and `intake_change_log` tables

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/intake/templates` | List active intake templates, optionally filtered by `section_type` |
| GET | `/api/intake/templates/admin` | List all templates including inactive (admin view) |
| POST | `/api/intake/templates` | Create a new intake template (admin only) |
| PUT | `/api/intake/templates/{template_id}` | Update an existing template (admin only) |
| DELETE | `/api/intake/templates/{template_id}` | Soft-delete a template by setting `is_active = false` (admin only) |
| GET | `/api/intake/responses/{request_id}` | Get all saved responses for a governance request |
| POST | `/api/intake/responses` | Batch upsert intake responses for a governance request |
| POST | `/api/intake/evaluate/{request_id}` | Evaluate scoping answers to determine triggered review domains |
| GET | `/api/intake/changelog/{request_id}` | Get change log entries for a governance request |

## Database Tables

### `intake_template`
Stores configurable questionnaire questions for both scoping and common sections.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `section_type` | VARCHAR | `'scoping'` or `'common'` |
| `section` | VARCHAR | Grouping label (e.g., "AI Usage", "Data Info") |
| `question_no` | INT | Question number within section |
| `question_text` | TEXT | The question displayed to the user |
| `answer_type` | VARCHAR | Input type: `text`, `textarea`, `select`, `multiselect`, `boolean`, `date` |
| `options` | JSONB | Predefined answer options (for select/multiselect) |
| `is_required` | BOOLEAN | Whether a response is mandatory |
| `help_text` | TEXT | Explanatory text shown alongside the question |
| `triggers_domain` | TEXT[] | Domain codes triggered when answered affirmatively (scoping only) |
| `sort_order` | INT | Display ordering |
| `is_active` | BOOLEAN | Soft-delete flag |

### `intake_response`
Stores user answers per governance request, with a unique constraint on `(request_id, template_id)` enabling upsert behavior.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `request_id` | UUID | FK to `governance_request` |
| `template_id` | UUID | FK to `intake_template` |
| `answer` | JSONB | The user's answer (supports text, arrays, objects) |
| `create_by` | VARCHAR | User who initially saved the response |
| `create_at` | TIMESTAMP | Creation timestamp |
| `update_by` | VARCHAR | User who last modified the response |
| `update_at` | TIMESTAMP | Last update timestamp |

### `intake_change_log`
Records every modification to a previously saved answer, supporting audit trails and ISR-driven re-scoping.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `request_id` | UUID | FK to `governance_request` |
| `template_id` | UUID | FK to `intake_template` |
| `old_answer` | JSONB | Previous answer value |
| `new_answer` | JSONB | Updated answer value |
| `change_reason` | UUID | Optional FK to the ISR that triggered the change |
| `changed_by` | VARCHAR | User who made the change |
| `changed_at` | TIMESTAMP | Timestamp of the change |

## UI Behavior

- **Scoping page** (`/governance/{requestId}/scoping`): Displays scoping-type template questions. User answers determine which review domains are triggered.
- **Common questionnaire page** (`/governance/{requestId}/common-questionnaire`): Displays common-type template questions for general information collection.
- **Reviews overview page** (`/governance/{requestId}/reviews`): Shows the outcome of scoping evaluation and triggered domain reviews.
- Answers are batch-saved via `POST /api/intake/responses`. The upsert mechanism (ON CONFLICT) ensures re-submissions update existing answers rather than creating duplicates.
- When an existing answer is modified, the old and new values are automatically recorded in the `intake_change_log` table.
- The `changeReason` field (a UUID) can reference an ISR that triggered the re-scoping, linking the change back to a specific information request.

## Scoping Evaluation Logic

The `POST /api/intake/evaluate/{request_id}` endpoint determines applicable review domains through two mechanisms:

1. **Template-level triggers**: Scoping questions with a `triggers_domain` value trigger the listed domains when the user's answer is truthy (not empty, "no", "false", "null", or "n/a").
2. **Dispatch rules**: Active rules from the `dispatch_rule` table are evaluated against scoping answers using operators: `equals`, `not_equals`, `contains`, `in`, `gt`, `lt`. Rules with `condition_type = 'always'` unconditionally add their domain.

After evaluation, the governance request status is updated to `'Scoping'`. The endpoint returns a sorted list of triggered domain codes.

## Acceptance Criteria

- [x] AC-1: Active intake templates can be listed, with optional filtering by section type
- [x] AC-2: Admin users can list all templates including inactive ones
- [x] AC-3: Admin users can create new intake templates with section type, question text, answer type, options, and sort order
- [x] AC-4: Admin users can update existing template fields (question text, required flag, options, active status, etc.)
- [x] AC-5: Admin users can soft-delete templates (sets `is_active = false`)
- [x] AC-6: Intake responses can be batch-saved for a governance request, with upsert on `(request_id, template_id)`
- [x] AC-7: Responses support multiple answer formats including plain text and arrays (JSONB)
- [x] AC-8: Saved responses can be retrieved by governance request ID (supports both business ID and UUID)
- [x] AC-9: Scoping evaluation returns triggered domain codes based on template triggers and dispatch rules
- [x] AC-10: Scoping evaluation updates the governance request status to "Scoping"
- [x] AC-11: Modifying an existing answer creates an entry in the change log with old and new values
- [x] AC-12: Change log entries can be retrieved per governance request, ordered by most recent first
- [x] AC-13: Change log supports an optional `changeReason` (ISR UUID) linking changes to information requests
- [x] AC-14: All endpoints enforce RBAC via `require_permission` or `require_role`
- [x] AC-15: Scoping page loads without application errors for a governance request
- [x] AC-16: Common questionnaire page loads without application errors for a governance request
- [x] AC-17: Reviews overview page loads without application errors for a governance request

## Test Coverage

### API Tests (`api-tests/test_intake.py`)
- `test_list_templates` — covers AC-1
- `test_list_templates_filter_section_type` — covers AC-1 (section type filter)
- `test_list_templates_admin` — covers AC-2
- `test_create_template` — covers AC-3
- `test_update_template` — covers AC-4
- `test_delete_template` — covers AC-5
- `test_save_and_get_responses` — covers AC-6, AC-8
- `test_save_response_array_answer` — covers AC-7
- `test_evaluate_scoping` — covers AC-9
- `test_get_changelog` — covers AC-12
- `test_changelog_records_changes` — covers AC-11

### E2E Tests (`e2e-tests/intake.spec.ts`)
- `"scoping page loads for a request"` — covers AC-15
- `"common questionnaire page loads for a request"` — covers AC-16
- `"reviews overview page loads for a request"` — covers AC-17

## Test Map Entries

```
backend/app/routers/intake.py       -> api-tests/test_intake.py
backend/app/routers/intake.py       -> e2e-tests/intake.spec.ts
frontend/src/app/governance/[requestId]/scoping/          -> e2e-tests/intake.spec.ts
frontend/src/app/governance/[requestId]/common-questionnaire/ -> e2e-tests/intake.spec.ts
```

## Notes

- Template deletion is a soft-delete (`is_active = false`), not a hard delete. This preserves referential integrity with existing responses.
- The `intake_response` table uses a unique constraint on `(request_id, template_id)` to enable upsert (INSERT ... ON CONFLICT DO UPDATE) behavior, preventing duplicate answers.
- The `triggers_domain` column on `intake_template` supports both list and comma-separated string formats for flexibility.
- Scoping evaluation combines two trigger sources (template-level `triggers_domain` and `dispatch_rule` table) into a unified set of triggered domains.
- The `change_reason` column in `intake_change_log` is typed as UUID to support direct references to ISR records, enabling a feedback loop where information requests can trigger re-scoping with full traceability.
- The `_resolve_request_uuid` helper accepts both business IDs (e.g., `GR-xxxxxx`) and raw UUIDs, providing flexibility for both frontend and API consumers.
