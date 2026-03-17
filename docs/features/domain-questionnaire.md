# Feature: Reviewer Domain Questionnaires

**Status**: Implemented
**Date**: 2026-03-16
**Spec Version**: 1

## Impact Assessment

**Feature**: Reviewer Domain Questionnaires | **Impact**: L3 (cross-feature, blocks approve) | **Risk**: Medium | **Decision**: Pause for review
New router + frontend component. Uses existing `domain_questionnaire_response` table. Integrates with domain_reviews.py to block approve/not-pass when required reviewer questions are unanswered.

## Summary

During the review phase, domain reviewers must answer reviewer-audience questionnaire templates before approving or rejecting a domain review. Templates are filtered to `audience='reviewer'` only. Responses are stored in `domain_questionnaire_response` and validated server-side before terminal transitions (approve, approve with exception, not pass).

## Affected Files

### Backend
- `backend/app/routers/domain_questionnaire.py` — Router: get templates, get/save responses
- `backend/app/routers/domain_reviews.py` — Modified: `_check_reviewer_questionnaire_complete()` validation guard
- `backend/app/main.py` — Register `domain_questionnaire` router at `/api/domain-questionnaire`

### Frontend
- `frontend/src/app/governance/_components/ReviewerQuestionnaires.tsx` — Reviewer questionnaire form component
- `frontend/src/app/governance/_components/QuestionInput.tsx` — Shared question rendering component
- `frontend/src/app/governance/[requestId]/reviews/[domainCode]/page.tsx` — Integrates ReviewerQuestionnaires

### Database
- No schema changes — `domain_questionnaire_response` table already exists

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/domain-questionnaire/templates/{domain_review_id}` | Get active reviewer questionnaire templates for a review's domain |
| GET | `/api/domain-questionnaire/{domain_review_id}` | Get saved reviewer questionnaire responses |
| POST | `/api/domain-questionnaire/{domain_review_id}` | Batch upsert reviewer questionnaire responses |

### POST — Request Body

```json
{
  "responses": [
    {"templateId": "uuid", "answer": {"value": "Yes"}}
  ]
}
```

### Validation Rules

- Responses can only be saved when the domain review is in **Accept** status
- Approve, Approve with Exception, and Not Pass transitions are blocked if any required reviewer-audience template has no response

## UI Behavior

1. On the Domain Review Detail page, when the review is in Accept status, a "Reviewer Questionnaire" section appears
2. Questions are rendered using the shared QuestionInput component (radio, multiselect, dropdown, textarea, text)
3. Answers auto-save on change
4. Before approve/not-pass, the frontend calls `flushPendingSaves()` and checks `getIncompleteCount()`
5. In terminal statuses (Approved, Not Passed, etc.), the questionnaire section is read-only

## Acceptance Criteria

- [x] AC-1: GET /templates returns only audience='reviewer' active templates for the review's domain
- [x] AC-2: GET /templates returns 404 for non-existent review
- [x] AC-3: GET /{review_id} returns saved responses
- [x] AC-4: POST /{review_id} upserts responses when review is in Accept status
- [x] AC-5: POST /{review_id} returns 400 when review is not in Accept status
- [x] AC-6: POST /{review_id} returns 400 when responses array is empty
- [x] AC-7: Approve blocked when required reviewer questions are unanswered (400)
- [x] AC-8: Approve succeeds after all required reviewer questions are answered
- [x] AC-9: Frontend shows reviewer questionnaire section on review detail page
- [x] AC-10: Frontend validates completeness before approve/not-pass

## Test Coverage

### API Tests
- `api-tests/test_domain_questionnaire.py::TestReviewerTemplates::test_get_reviewer_templates` — AC-1
- `api-tests/test_domain_questionnaire.py::TestReviewerTemplates::test_get_reviewer_templates_404` — AC-2
- `api-tests/test_domain_questionnaire.py::TestReviewerResponses::test_get_responses_empty` — AC-3
- `api-tests/test_domain_questionnaire.py::TestReviewerResponses::test_save_responses` — AC-4
- `api-tests/test_domain_questionnaire.py::TestReviewerResponses::test_save_responses_not_accept_status` — AC-5
- `api-tests/test_domain_questionnaire.py::TestReviewerResponses::test_save_responses_empty_array` — AC-6
- `api-tests/test_domain_questionnaire.py::TestReviewerQuestionnaireBlocking::test_approve_blocked_by_incomplete_reviewer_questionnaire` — AC-7
- `api-tests/test_domain_questionnaire.py::TestReviewerQuestionnaireBlocking::test_approve_succeeds_after_answering_reviewer_questionnaire` — AC-8

## Test Map Entries

```
backend/app/routers/domain_questionnaire.py -> api-tests/test_domain_questionnaire.py
frontend/src/app/governance/_components/ReviewerQuestionnaires.tsx -> e2e-tests/governance-requests.spec.ts
```

## Notes

- Reuses the existing `domain_questionnaire_response` table (composite unique on domain_review_id + template_id)
- Templates endpoint reads `system_config` for default description box title
- The `_check_reviewer_questionnaire_complete()` function in domain_reviews.py checks all required reviewer-audience templates have corresponding responses
- Only templates with `is_active = true AND audience = 'reviewer'` are considered
