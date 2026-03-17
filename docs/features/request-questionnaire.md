# Feature: Pre-Submit Domain Questionnaires

**Status**: Implemented
**Date**: 2026-03-16
**Spec Version**: 2

## Impact Assessment

**Feature**: Pre-Submit Domain Questionnaires | **Impact**: L3 (cross-feature) | **Risk**: Medium | **Decision**: Pause for review
New router + new DB table + submit-gate validation in governance-requests router + frontend integration into create/edit pages. Touches governance-requests submit flow and reads from questionnaire-templates and domain-registry.

## Summary

During the Request Draft stage, if triggered domains include Internal domains, the requestor must fill out those domains' questionnaire templates before submitting the request. All required questions must be answered for submit to be allowed. Responses are stored in a new `request_questionnaire_response` table and validated server-side on submit.

**v2**: Audience filtering — GET /templates now returns only `audience='requestor'` questions. Reviewer-audience questions are handled by the separate Domain Questionnaire module.

## Affected Files

### Backend
- `backend/app/routers/request_questionnaire.py` — New router: fetch templates, get/save responses
- `backend/app/routers/governance_requests.py` — Submit validation: block submit if required questionnaire answers missing
- `backend/app/main.py` — Register the new router

### Frontend
- `frontend/src/app/governance/_components/DomainQuestionnaires.tsx` — New component rendering per-domain questionnaire forms
- `frontend/src/app/governance/[requestId]/page.tsx` — Integrate DomainQuestionnaires into edit page
- `frontend/src/app/governance/create/page.tsx` — Integrate DomainQuestionnaires into create page

### Database
- `scripts/schema.sql` — New table `request_questionnaire_response`

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/request-questionnaire/templates/{request_id}` | List questionnaire templates for the request's triggered internal domains |
| GET | `/api/request-questionnaire/{request_id}` | Get saved questionnaire responses for a request |
| POST | `/api/request-questionnaire/{request_id}` | Batch upsert questionnaire responses for a request |

## Database Schema

```sql
CREATE TABLE request_questionnaire_response (
    request_id       UUID NOT NULL REFERENCES governance_request(id) ON DELETE CASCADE,
    template_id      UUID NOT NULL REFERENCES domain_questionnaire_template(id),
    domain_code      TEXT NOT NULL,
    answer           JSONB NOT NULL,
    PRIMARY KEY (request_id, template_id)
);
```

## UI Behavior

1. On the create or edit page, after the requestor selects scope/rules that trigger internal domains, a "Domain Questionnaires" section appears
2. Each triggered internal domain is shown as an expandable section with its questionnaire questions
3. Questions within each domain are grouped by section with collapsible sub-headers (gray bar with arrow, section name, question count); questions without sections render directly
4. The requestor fills in answers for each question (radio, multiselect, dropdown, or textarea depending on template type)
5. Answers auto-save via POST on change or section blur
6. If any required question is unanswered, the Submit button is disabled with a tooltip explaining which domains have incomplete questionnaires
7. On submit, the backend validates that all required questions for triggered internal domains have responses; returns 400 if incomplete
8. When any domain review has "Return for Additional Information" status, the Domain Questionnaire section reappears on the request detail page as editable, allowing the requestor to update answers before resubmitting

## Acceptance Criteria

- [ ] AC-1: GET /api/request-questionnaire/templates/{request_id} returns questionnaire templates only for triggered internal domains
- [ ] AC-2: GET /api/request-questionnaire/{request_id} returns all saved responses for the request
- [ ] AC-3: POST /api/request-questionnaire/{request_id} upserts responses (insert new, update existing)
- [ ] AC-4: POST rejects responses referencing non-existent template IDs (400)
- [ ] AC-5: PUT /governance-requests/{id}/submit returns 400 if required questionnaire answers are missing
- [ ] AC-6: Submit succeeds when all required questionnaire answers are provided
- [ ] AC-7: Frontend shows domain questionnaire sections for triggered internal domains on create/edit pages
- [ ] AC-8: Frontend disables Submit button when required questions are unanswered

## Test Coverage

### API Tests (8 tests)
- `api-tests/test_request_questionnaire.py` — covers AC-1 through AC-6

### E2E Tests
- Integration into existing governance-requests E2E flows — covers AC-7, AC-8

## Test Map Entries

```
backend/app/routers/request_questionnaire.py -> api-tests/test_request_questionnaire.py
backend/app/routers/governance_requests.py   -> api-tests/test_governance_requests.py
frontend/src/app/governance/[requestId]/     -> e2e-tests/governance-requests.spec.ts
frontend/src/app/governance/create/          -> e2e-tests/governance-requests.spec.ts
```

## Notes

- Responses use a composite primary key (request_id, template_id) to enable upsert semantics
- The templates endpoint is request-aware: it reads the request's triggered rules/domains to determine which questionnaires apply
- Only internal domains (integration_type = 'internal') have questionnaire templates; external domains are skipped
- Submit validation is additive — existing submit checks (required fields, etc.) still apply alongside questionnaire completeness
- The templates response includes a `section` field for each question, used by the frontend DomainQuestionnaires component to group questions by section with collapsible sub-headers
- Domain questionnaires become editable again when a domain review is returned for additional information
