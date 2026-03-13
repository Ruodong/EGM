# Feature: Progress Tracking

**Status**: Implemented
**Date**: 2026-03-12
**Spec Version**: 1

## Summary

Provides an aggregated view of domain review progress for a single governance request. Used by the request detail page and summary page to show how many domains have completed review, the overall completion percentage, and the count of open information supplement requests (ISRs).

## Affected Files

### Backend
- `backend/app/routers/progress.py` — `GET /progress/{request_id}` endpoint

### Frontend
- `frontend/src/app/governance/[requestId]/page.tsx` — Detail page shows progress bar and domain status list (fetched when status is not Draft)
- `frontend/src/app/governance/[requestId]/summary/page.tsx` — Summary page uses progress data for final review overview

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/progress/{request_id}` | Returns aggregated review status for a governance request |

### Response Shape

```json
{
  "requestId": "GR-001",
  "status": "In Review",
  "totalDomains": 3,
  "completedDomains": 1,
  "inProgressDomains": 1,
  "pendingDomains": 1,
  "progressPercent": 33,
  "openInfoRequests": 1,
  "domains": [
    {
      "domainCode": "CYBER",
      "status": "Complete",
      "outcome": "Approved",
      "reviewer": "jdoe"
    }
  ]
}
```

## UI Behavior

1. On the request detail page, when the request status is not "Draft", the progress section is displayed.
2. Shows a progress bar with `completedDomains / totalDomains` and percentage.
3. If there are open ISRs, a warning message is shown: "N open info request(s)".
4. Each domain is listed with its code, status badge, and optional outcome.

## Acceptance Criteria

- [x] AC-1: `GET /progress/{request_id}` returns totalDomains, completedDomains, progressPercent, openInfoRequests, and domain list
- [x] AC-2: Returns 404 for non-existent request IDs
- [x] AC-3: Progress data reflects current domain_review statuses in real-time
- [x] AC-4: Requires `progress:read` permission

## Test Coverage

### API Tests
- `api-tests/test_dashboard.py::test_progress` — covers AC-1, AC-4
- `api-tests/test_dashboard.py::test_progress_not_found` — covers AC-2

## Test Map Entries

```
backend/app/routers/progress.py -> api-tests/test_dashboard.py
```

## Notes

- Progress is computed dynamically from `domain_review` and `info_supplement_request` tables on each request — no cached or materialized state.
- The progress endpoint is in a separate router from dashboard because it operates per-request, not aggregated.
