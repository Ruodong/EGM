# Feature: Domain Review Action Items

**Status**: Implemented
**Date**: 2026-03-14
**Spec Version**: 1

## Impact Assessment

**Feature**: Domain Review Action Items | **Impact**: L3 (cross-feature) | **Risk**: High | **Decision**: Pause for review
New router + modified `review_action` table + new `review_action_feedback` / `review_action_email_log` tables + integration into both review detail (reviewer) and request detail (requestor) pages. Touches domain-dispatch, governance-requests, auth (RBAC extension).

## Summary

Reviewers can create Action Items on domain reviews that are in "Accept" status (after accept, before terminal decision). Each action is assigned to a person (default: requestor) who must provide feedback. Supports multi-round conversation between reviewer and assignee. Reviewer can copy, cancel, and close actions. Email notifications are sent on assignment and follow-up (configurable, disabled in test).

## Affected Files

### Backend
- `backend/app/routers/review_actions.py` — New router: CRUD + state transitions + feedback
- `backend/app/utils/email.py` — New utility: email notification with configurable on/off
- `backend/app/main.py` — Register the new router
- `backend/app/auth/rbac.py` — Add `feedback` scope to Requestor's `review_action` permissions

### Frontend
- `frontend/src/app/governance/[requestId]/reviews/[domainCode]/page.tsx` — Add "Action Items" section (reviewer view)
- `frontend/src/app/governance/[requestId]/page.tsx` — Add "Governance Domain Actions" section below Domain Questionnaires (requestor view)
- `frontend/src/app/governance/_components/ActionItemsSection.tsx` — New: reviewer action management
- `frontend/src/app/governance/_components/CreateActionModal.tsx` — New: create/edit action form
- `frontend/src/app/governance/_components/ActionFeedbackPanel.tsx` — New: multi-round conversation display
- `frontend/src/app/governance/_components/GovernanceDomainActions.tsx` — New: requestor-facing grouped actions view

### Database
- `scripts/schema.sql` — Modify `review_action` table; add `review_action_feedback` and `review_action_email_log` tables

## Database Schema

### Modified: `review_action`

```sql
CREATE TABLE IF NOT EXISTS review_action (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domain_review_id UUID NOT NULL REFERENCES domain_review(id) ON DELETE CASCADE,
    action_no        INT,
    title            VARCHAR NOT NULL,
    description      TEXT,
    priority         VARCHAR NOT NULL DEFAULT 'Medium',    -- 'High' | 'Medium' | 'Low'
    action_type      VARCHAR NOT NULL DEFAULT 'Mandatory', -- 'Mandatory' | 'Long Term'
    status           VARCHAR NOT NULL DEFAULT 'Created',   -- 'Created' | 'Assigned' | 'Closed' | 'Cancelled'
    assignee         VARCHAR,
    assignee_name    VARCHAR,
    closed_at        TIMESTAMP,
    cancelled_at     TIMESTAMP,
    create_by        VARCHAR NOT NULL,
    create_by_name   VARCHAR,
    create_at        TIMESTAMP DEFAULT NOW(),
    update_by        VARCHAR,
    update_by_name   VARCHAR,
    update_at        TIMESTAMP DEFAULT NOW()
);
```

### New: `review_action_feedback`

```sql
CREATE TABLE IF NOT EXISTS review_action_feedback (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action_id        UUID NOT NULL REFERENCES review_action(id) ON DELETE CASCADE,
    round_no         INT NOT NULL DEFAULT 1,
    feedback_type    VARCHAR NOT NULL,  -- 'response' (assignee) | 'follow_up' (reviewer)
    content          TEXT NOT NULL,
    created_by       VARCHAR NOT NULL,
    created_by_name  VARCHAR,
    create_at        TIMESTAMP DEFAULT NOW()
);
```

### New: `review_action_email_log`

```sql
CREATE TABLE IF NOT EXISTS review_action_email_log (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action_id        UUID NOT NULL REFERENCES review_action(id) ON DELETE CASCADE,
    email_type       VARCHAR NOT NULL,  -- 'assigned' | 'feedback_submitted' | 'follow_up' | 'closed'
    recipient        VARCHAR NOT NULL,
    recipient_email  VARCHAR,
    subject          VARCHAR,
    sent_at          TIMESTAMP DEFAULT NOW(),
    status           VARCHAR NOT NULL DEFAULT 'skipped',  -- 'sent' | 'failed' | 'skipped'
    error_message    TEXT
);
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/review-actions` | List actions (filter: domainReviewId, requestId, assignee, status) |
| GET | `/api/review-actions/{id}` | Get single action with feedback history |
| GET | `/api/review-actions/by-request/{requestId}` | Actions grouped by domain (requestor view) |
| POST | `/api/review-actions` | Create action item |
| PUT | `/api/review-actions/{id}` | Update action fields (title, description, priority, type) |
| PUT | `/api/review-actions/{id}/assign` | Assign action to a person |
| PUT | `/api/review-actions/{id}/close` | Close action |
| PUT | `/api/review-actions/{id}/cancel` | Cancel action |
| POST | `/api/review-actions/{id}/copy` | Copy action (creates new duplicate) |
| POST | `/api/review-actions/{id}/feedback` | Submit feedback (assignee→response, reviewer→follow_up) |
| GET | `/api/review-actions/{id}/feedback` | Get feedback history for an action |

## Action Item State Machine

See `docs/state-machine.md` Section 7 for the full state diagram and transition table.

### Summary

- **States**: Created → Assigned → Closed | Cancelled
- **Guard**: Actions can only be created when `domain_review.status = 'Accept'`
- **Assignee default**: Requestor of the governance request
- **Multi-round feedback**: Assignee submits `response`, reviewer submits `follow_up`, cycle repeats
- **Copy**: Creates a new action from an existing one (status = Created, no feedback copied)

## UI Behavior

### Reviewer View (Review Detail Page)

1. After accepting a domain review, an "Action Items" section appears below the existing content
2. Reviewer clicks "Create Action" button → modal with: Title, Description, Priority (High/Medium/Low), Type (Mandatory/Long Term), Assignee (employee search, default = requestor)
3. On create: if assignee provided, auto-assigns (status → Assigned); otherwise stays Created
4. Action list shows: Title, Assignee, Priority, Type, Status, Created Date
5. Each action row is expandable to show feedback conversation timeline
6. Reviewer can add follow-up questions in the feedback panel
7. Action row has buttons: Copy, Cancel, Close (contextual based on status)
8. When review reaches terminal status, "Create Action" is disabled; existing actions become read-only for state changes but feedback can still be submitted

### Requestor View (Request Detail Page)

1. Below "Domain Questionnaires" section, a new "Governance Domain Actions" section appears
2. Actions are grouped by domain (accordion per domain, similar to questionnaire layout)
3. Each action shows: Title, Priority, Type, Status, Description
4. Assignee can expand an action to see the feedback conversation
5. Assignee types feedback in a text area and clicks "Submit" → creates a `response` feedback entry
6. After submitting, the reviewer is notified (if email enabled)

### Email Notifications

| Event | Recipient | When |
|-------|-----------|------|
| Action Assigned | Assignee | On create with assignee or explicit assign |
| Feedback Submitted | Reviewer | Assignee submits response |
| Follow-up Question | Assignee | Reviewer adds follow_up |
| Action Closed | Assignee | Reviewer closes action |

Email is controlled by `EGM_EMAIL_ENABLED` env var (default: `false` in dev/test).

## Acceptance Criteria

### Backend — CRUD & State
- [x] AC-1: POST `/review-actions` creates action only when domain_review.status='Accept' (400 otherwise)
- [x] AC-2: POST with assignee auto-transitions to 'Assigned' status
- [x] AC-3: POST without assignee defaults assignee to requestor and auto-assigns
- [x] AC-4: PUT `/{id}/assign` transitions Created→Assigned, sets assignee fields
- [x] AC-5: PUT `/{id}/close` transitions Assigned→Closed, sets closed_at
- [x] AC-6: PUT `/{id}/cancel` transitions Created|Assigned→Cancelled, sets cancelled_at
- [x] AC-7: POST `/{id}/copy` creates new action with same metadata, status=Created, no feedback copied
- [x] AC-8: PUT `/{id}` updates title/description/priority/type (not status)
- [x] AC-9: GET `/review-actions` supports filtering by domainReviewId, requestId, assignee, status
- [x] AC-10: GET `/{id}` returns action with embedded feedback history
- [x] AC-11: GET `/by-request/{requestId}` returns actions grouped by domain

### Backend — Feedback
- [x] AC-12: POST `/{id}/feedback` by assignee creates feedback_type='response'
- [x] AC-13: POST `/{id}/feedback` by reviewer creates feedback_type='follow_up'
- [x] AC-14: Feedback round_no increments correctly for multi-round conversation
- [x] AC-15: Requestor can submit feedback even with only review_action:read permission (special case)

### Backend — Guards & Permissions
- [x] AC-16: Cannot create action on review not in 'Accept' status (400)
- [x] AC-17: Cannot close a 'Created' action (must be Assigned first) — 400
- [x] AC-18: Cannot perform state changes on 'Closed' or 'Cancelled' actions (400)
- [x] AC-19: Domain Reviewer can only manage actions on their own domains (403)
- [x] AC-20: Governance Lead and Admin can manage actions on any domain

### Backend — Email
- [x] AC-21: Email log entry created for each notification event
- [x] AC-22: When EGM_EMAIL_ENABLED=false, log status='skipped' (no actual send)

### Frontend — Reviewer
- [x] AC-23: Action Items section visible on review detail when status='Accept' or actions exist
- [x] AC-24: Create Action modal with all required fields
- [x] AC-25: Action list with expand/collapse feedback conversation
- [x] AC-26: Copy/Cancel/Close buttons contextual per action status

### Frontend — Requestor
- [x] AC-27: "Governance Domain Actions" section on request detail page, grouped by domain
- [x] AC-28: Assignee can submit feedback via text area
- [x] AC-29: Actions are read-only when review is in terminal status (no new feedback)

## Test Coverage

### API Tests
- `api-tests/test_review_actions.py` — covers AC-1 through AC-22

### E2E Tests
- `e2e-tests/review-actions.spec.ts` — covers AC-23 through AC-29

## Test Map Entries

```
backend/app/routers/review_actions.py -> api-tests/test_review_actions.py
frontend/src/app/governance/[requestId]/reviews/[domainCode]/ -> e2e-tests/review-actions.spec.ts
frontend/src/app/governance/_components/ActionItemsSection.tsx -> e2e-tests/review-actions.spec.ts
frontend/src/app/governance/_components/GovernanceDomainActions.tsx -> e2e-tests/review-actions.spec.ts
```

## Notes

- Feedback uses flat table (not JSONB) for proper indexing and audit trail
- `round_no` convention: each assignee response increments the round; reviewer follow-up shares the same round
- Copy only duplicates metadata (title, description, priority, type, assignee), NOT feedback history
- Actions survive domain review terminal transitions — they remain as historical records
- The `action_no` field is auto-generated per domain_review for display purposes (e.g., "Action #1")
- Email sending is fire-and-forget — SMTP failures do not block state transitions
