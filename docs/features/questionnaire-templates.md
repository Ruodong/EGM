# Feature: Questionnaire Template Management

**Status**: Implemented
**Date**: 2026-03-13
**Spec Version**: 1

## Impact Assessment

**Feature**: Questionnaire Template Management | **Impact**: L2 (feature-local) | **Risk**: Low | **Decision**: Auto-approve
New router + new settings page. Uses existing `domain_questionnaire_template` table. No schema migration needed.

## Summary

Settings UI for managing per-domain questionnaire templates that domain reviewers fill in during governance reviews. Only Internal domains (`integration_type = 'internal'`) can have questionnaires. Admin/Governance Lead see all domains; Domain Reviewer sees only their assigned domains.

## Affected Files

### Backend
- `backend/app/routers/questionnaire_templates.py` — CRUD router for questionnaire templates
- `backend/app/main.py` — Register the new router

### Frontend
- `frontend/src/app/(sidebar)/settings/questionnaire-templates/page.tsx` — Template management UI
- `frontend/src/lib/constants.ts` — Sidebar nav requiredScope change

### Database
- No schema changes — `domain_questionnaire_template` table already exists

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/questionnaire-templates` | List templates grouped by internal domain |
| GET | `/api/questionnaire-templates/{domain_code}` | List templates for a specific domain |
| POST | `/api/questionnaire-templates` | Create a template question |
| PUT | `/api/questionnaire-templates/{template_id}` | Update a template question |
| DELETE | `/api/questionnaire-templates/{template_id}` | Toggle is_active (soft delete) |

## UI Behavior

1. Page loads showing internal domains as expandable accordion sections
2. Each domain section shows a table of questions: #, Question, Type, Required, Actions
3. "Add Question" button opens a form dialog with: Domain dropdown, Section, Question #, Question Text, Answer Type, Options editor (for radio/multiselect/dropdown), Required checkbox, Sort Order
4. Edit button on each row opens the same form pre-filled
5. Toggle button on each row toggles is_active status
6. Domain Reviewer only sees their assigned domains
7. Write permission required for Add/Edit/Toggle buttons

## Acceptance Criteria

- [x] AC-1: GET /api/questionnaire-templates returns templates grouped by internal domains only
- [x] AC-2: Domain Reviewer sees only their assigned domains in the list
- [x] AC-3: POST /api/questionnaire-templates creates a template with valid answer_type (radio, multiselect, dropdown, textarea)
- [x] AC-4: POST rejects invalid answer_type values
- [x] AC-5: POST requires options for radio/multiselect/dropdown types
- [x] AC-6: PUT /api/questionnaire-templates/{id} updates template fields
- [x] AC-7: DELETE /api/questionnaire-templates/{id} toggles is_active
- [x] AC-8: Domain Reviewer cannot create/update templates for unassigned domains (403)
- [x] AC-9: Frontend shows domain-grouped accordion list of templates
- [x] AC-10: Frontend Add/Edit form validates required fields and shows options editor for non-textarea types
- [x] AC-11: Sidebar nav item visible to users with domain_questionnaire:read permission

## Test Coverage

### API Tests (18 tests, all passing)
- `test_list_returns_internal_domains_only` — AC-1
- `test_list_includes_templates` — AC-1
- `test_list_domain_templates` — AC-1
- `test_create_radio` — AC-3
- `test_create_textarea` — AC-3
- `test_create_multiselect_with_other` — AC-3
- `test_create_dropdown` — AC-3
- `test_reject_invalid_answer_type` — AC-4
- `test_reject_missing_domain` — AC-4
- `test_reject_radio_without_options` — AC-5
- `test_reject_external_domain` — AC-4
- `test_update_question_text` — AC-6
- `test_update_answer_type_and_options` — AC-6
- `test_update_no_fields_returns_400` — AC-6
- `test_update_nonexistent_returns_404` — AC-6
- `test_toggle_deactivate` — AC-7
- `test_toggle_reactivate` — AC-7
- `test_toggle_nonexistent_returns_404` — AC-7

### E2E Tests
- Manual verification via preview — covers AC-9, AC-10, AC-11

## Test Map Entries

```
backend/app/routers/questionnaire_templates.py -> api-tests/test_questionnaire_templates.py
frontend/src/app/(sidebar)/settings/questionnaire-templates/ -> (manual verification)
```

## Notes

- Answer types: radio (single select), multiselect (multi-select checkboxes), dropdown, textarea
- Multiselect and dropdown support "Other" option that enables free text input
- Options stored as JSONB array in the `options` column
