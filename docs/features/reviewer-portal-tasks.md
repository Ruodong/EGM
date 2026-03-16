# Feature: Reviewer Portal Tasks

**Status**: Implemented
**Date**: 2026-03-15
**Spec Version**: 2

## Impact Assessment

**Feature**: Reviewer pending tasks on Portal home page
**Impact**: L3 (Cross-feature) | **Risk**: Low | **Decision**: Auto-approve
Touches: dashboard (new response fields), domain-dispatch (reads domain_review), review-action-items (reads review_action + feedback). No schema changes.

## Summary

Extends the Portal home page to show reviewer-specific pending tasks: (1) first-time submissions waiting for reviewer acceptance (shown at the top, not controlled by My Only), (2) resubmitted reviews with additional information awaiting re-acceptance, and (3) action items where the assignee has responded and the reviewer needs to follow up or close. Includes a "My Only" toggle to filter between the reviewer's own assigned reviews vs all reviews in their domain(s). All tables on the Home page display 10 rows per page with pagination controls.

## Affected Files

### Backend
- `backend/app/routers/dashboard.py` — Extended `GET /dashboard/pending-tasks` with reviewer queries and `myOnly` param

### Frontend
- `frontend/src/app/page.tsx` — Reviewer section with two tables + My Only toggle

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/dashboard/pending-tasks?myOnly=true\|false` | Returns `reviewerFirstSubmit`, `reviewerResubmitted`, and `reviewerPendingActions` arrays |

## UI Behavior

1. **"Reviews Waiting for Accept" section** (green header) — appears after Stats Cards, before requestor pending tasks. Shows first-time submissions (`return_reason IS NULL`) for the reviewer's domains. Not controlled by My Only toggle. Visible to `admin`, `governance_lead`, `domain_reviewer` roles.
2. **Requestor sections** — Return for Additional Info (pink) and Assigned Actions (blue), shown when applicable.
3. **Reviewer Tasks section** — appears below requestor sections, only for reviewer/admin/GL roles.
4. **My Only toggle** (default: on) — filters reviewer tasks (resubmitted reviews + action responses) to only those where the current user is the reviewer.
5. **"Waiting for Accept with Additional Information" table** (green header, in Reviewer Tasks) — shows reviews that were returned for additional info, requestor resubmitted (`return_reason IS NOT NULL`), now waiting for reviewer re-acceptance. Controlled by My Only.
6. **Action Responses table** (orange header, in Reviewer Tasks) — shows action items where assignee submitted a response, pending reviewer follow-up or close. Controlled by My Only.
7. Clicking a review navigates to the review detail page; clicking an action response opens the action detail modal.
8. **Pagination** — all 5 tables show 10 rows per page with Ant Design Pagination controls when total exceeds 10.

## Acceptance Criteria

- [x] AC-1: `GET /dashboard/pending-tasks` returns `reviewerResubmitted` array for reviewer/admin/GL users
- [x] AC-2: `GET /dashboard/pending-tasks` returns `reviewerPendingActions` array for reviewer/admin/GL users
- [x] AC-3: `myOnly=true` filters by `dr.reviewer = current_user`; `myOnly=false` filters by user's domain_codes
- [x] AC-4: Requestor users get empty `reviewerResubmitted` and `reviewerPendingActions`
- [x] AC-5: Resubmitted reviews only include reviews with `started_at IS NOT NULL` (previously accepted)
- [x] AC-6: Reviewer pending actions only include those where last feedback is `response` type
- [x] AC-7: Home page shows Reviewer Tasks section only for reviewer/admin/GL roles
- [x] AC-8: My Only toggle refetches data with correct `myOnly` param
- [x] AC-9: `GET /dashboard/pending-tasks` returns `reviewerFirstSubmit` array (first-time submissions, `return_reason IS NULL`)
- [x] AC-10: `reviewerFirstSubmit` is always filtered by domain codes (not affected by `myOnly`)
- [x] AC-11: `reviewerResubmitted` only includes reviews with `return_reason IS NOT NULL`
- [x] AC-12: Home page shows "Reviews Waiting for Accept" section at the top (after Stats Cards, before Return for Additional Info)
- [x] AC-13: All 5 tables on Home page display 10 rows per page with Ant Design Pagination controls

## Test Coverage

### API Tests
- `api-tests/test_dashboard.py::test_pending_tasks_reviewer_fields` — covers AC-1, AC-2, AC-4, AC-9
- `api-tests/test_dashboard.py::test_pending_tasks_my_only_param` — covers AC-3
- `api-tests/test_dashboard.py::test_pending_tasks_first_submit_not_affected_by_my_only` — covers AC-10

## Test Map Entries

```
backend/app/routers/dashboard.py -> api-tests/test_dashboard.py
frontend/src/app/page.tsx        -> e2e-tests/governance-requests.spec.ts
```

## Notes

- `return_reason IS NULL` distinguishes first-time submissions from resubmitted reviews (previously returned, then resubmitted with additional information)
- First-time submissions (`reviewerFirstSubmit`) are always domain-filtered — they show all reviews in the reviewer's domains regardless of `myOnly`
- Admin and Governance Lead with `myOnly=false` see all domains (fetched from domain_registry)
- The existing requestor sections (returnForAdditional, assignedActions) are not affected by the `myOnly` param
