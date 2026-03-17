# Feature: Questionnaire Template Management

**Status**: Implemented
**Date**: 2026-03-16
**Spec Version**: 2

## Impact Assessment

**Feature**: Questionnaire Template Management | **Impact**: L2 (feature-local) | **Risk**: Low | **Decision**: Auto-approve
New router + new settings page. Uses existing `domain_questionnaire_template` table. No schema migration needed.

## Summary

Settings UI for managing per-domain questionnaire templates that domain reviewers fill in during governance reviews. Only Internal domains (`integration_type = 'internal'`) can have questionnaires. Admin/Governance Lead see all domains; Domain Reviewer sees only their assigned domains.

v2 enhancements: Audience field (requestor vs reviewer), section-level audience management, inline Required toggle, reorder endpoint, Chinese content parity, text answer type.

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
| PUT | `/api/questionnaire-templates/reorder` | Reorder questions by sort_order |
| PUT | `/api/questionnaire-templates/section-audience` | Batch update audience for all questions in a domain+section |

## UI Behavior

1. Page loads showing internal domains as expandable accordion sections (all collapsed by default)
2. Each domain section shows a table of questions: Section, Question, Type, Required, Actions
3. "Add Question" button opens a form dialog with: Domain dropdown, Section (AutoComplete — select existing sections for the domain or type new), Question Text, Answer Type, Options editor (for radio/multiselect/dropdown), Required checkbox, Sort Order
4. In the DomainQuestionnaires component (request detail / domain review detail), questions within each domain are grouped by section with collapsible sub-headers (gray bar with arrow, section name, question count)
5. Edit button on each row opens the same form pre-filled
6. Toggle button on each row toggles is_active status
7. Domain Reviewer only sees their assigned domains
8. Write permission required for Add/Edit/Toggle buttons
9. Inline Required toggle: table shows Switch component for Required column (direct toggle without opening form).
10. Section-level audience: UI manages audience at section level via dropdown in section column header (first question per section shows Select).
11. Audience badges: color-coded badges in Audience column (green for 'requestor', blue for 'reviewer').

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
- [x] AC-12: PUT /reorder updates sort_order for multiple templates
- [x] AC-13: Dependency field — question can depend on another question's answer
- [x] AC-14: hasDescriptionBox — additional text input for any question type
- [x] AC-15: System config — configurable default description box title
- [x] AC-16: audience field — 'requestor' or 'reviewer', default 'requestor'
- [x] AC-17: PUT /section-audience batch updates all questions in a domain+section
- [x] AC-18: Inline Required toggle in table view
- [x] AC-19: text answer type allowed alongside radio, multiselect, dropdown, textarea
- [x] AC-20: Chinese content fields (questionTextZh, questionDescriptionZh, optionsZh, descriptionBoxTitleZh) treated as equal-status, not optional fallbacks

## Test Coverage

### API Tests (24 tests, all passing)
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
- `test_create_with_audience_reviewer` — AC-16
- `test_create_default_audience_requestor` — AC-16
- `test_create_invalid_audience` — AC-16
- `test_update_section_audience` — AC-17
- `test_update_section_audience_invalid` — AC-17
- `test_reorder_swaps_sort_order` — AC-12

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

### v2 — Audience & Section Management

The `audience` column distinguishes whether a question targets the requestor (who submits the governance request) or the reviewer (domain expert evaluating the request). Default is `'requestor'`. The UI manages audience at section level: changing the audience dropdown on the first question of a section triggers a batch update for all questions in that domain+section via `PUT /section-audience`.

Chinese content fields (`questionTextZh`, `questionDescriptionZh`, `optionsZh`, `descriptionBoxTitleZh`) are treated as equal-status content, not optional fallbacks. Both English and Chinese fields are displayed side-by-side in the UI when the locale context provides Chinese, ensuring full bilingual parity.
