# Feature: Reviewer Portal Tasks

**Status**: Implemented
**Date**: 2026-03-15
**Spec Version**: 1

## Impact Assessment

**Feature**: Reviewer pending tasks on Portal home page
**Impact**: L3 (Cross-feature) | **Risk**: Low | **Decision**: Auto-approve
Touches: dashboard (new response fields), domain-dispatch (reads domain_review), review-action-items (reads review_action + feedback). No schema changes.

## Summary

Extends the Portal home page to show reviewer-specific pending tasks: (1) resubmitted reviews awaiting re-acceptance, and (2) action items where the assignee has responded and the reviewer needs to follow up or close. Includes a "My Only" toggle to filter between the reviewer's own assigned reviews vs all reviews in their domain(s).

## Affected Files

### Backend
- `backend/app/routers/dashboard.py` — Extended `GET /dashboard/pending-tasks` with reviewer queries and `myOnly` param

### Frontend
- `frontend/src/app/page.tsx` — Reviewer section with two tables + My Only toggle

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/dashboard/pending-tasks?myOnly=true\|false` | Extended: now returns `reviewerResubmitted` and `reviewerPendingActions` arrays |

## UI Behavior

1. **Reviewer section** appears below the requestor pending tasks, only for users with `admin`, `governance_lead`, or `domain_reviewer` role
2. **My Only toggle** (default: on) — filters reviewer tasks to only those where the current user is the reviewer
3. **Resubmitted Reviews table** (green header) — shows reviews that were returned for additional info, requestor resubmitted, now waiting for reviewer re-acceptance
4. **Action Responses table** (orange header) — shows action items where assignee submitted a response, pending reviewer follow-up or close
5. Clicking a resubmitted review navigates to the review detail page
6. Clicking an action response opens the action detail modal with feedback timeline

## Acceptance Criteria

- [x] AC-1: `GET /dashboard/pending-tasks` returns `reviewerResubmitted` array for reviewer/admin/GL users
- [x] AC-2: `GET /dashboard/pending-tasks` returns `reviewerPendingActions` array for reviewer/admin/GL users
- [x] AC-3: `myOnly=true` filters by `dr.reviewer = current_user`; `myOnly=false` filters by user's domain_codes
- [x] AC-4: Requestor users get empty `reviewerResubmitted` and `reviewerPendingActions`
- [x] AC-5: Resubmitted reviews only include reviews with `started_at IS NOT NULL` (previously accepted)
- [x] AC-6: Reviewer pending actions only include those where last feedback is `response` type
- [x] AC-7: Home page shows Reviewer Tasks section only for reviewer/admin/GL roles
- [x] AC-8: My Only toggle refetches data with correct `myOnly` param

## Test Coverage

### API Tests
- `api-tests/test_dashboard.py::test_pending_tasks_reviewer_fields` — covers AC-1, AC-2, AC-4
- `api-tests/test_dashboard.py::test_pending_tasks_my_only_param` — covers AC-3

## Test Map Entries

```
backend/app/routers/dashboard.py -> api-tests/test_dashboard.py
frontend/src/app/page.tsx        -> e2e-tests/governance-requests.spec.ts
```

## Notes

- `started_at IS NOT NULL` is used to distinguish first-time "Waiting for Accept" (new request) from resubmitted reviews (previously accepted, then returned, then resubmitted)
- Admin and Governance Lead with `myOnly=false` see all domains (fetched from domain_registry)
- The existing requestor sections (returnForAdditional, assignedActions) are not affected by the `myOnly` param
