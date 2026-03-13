# Feature: Dashboard & Reports

**Status**: Implemented
**Date**: 2026-03-12
**Spec Version**: 1

## Summary

Provides governance metrics and KPI dashboards. Two API endpoints serve aggregated statistics consumed by the home page and three dedicated report pages (Governance Dashboard, Domain Metrics, Lead Time).

## Affected Files

### Backend
- `backend/app/routers/dashboard.py` — `/dashboard/stats` (full metrics) and `/dashboard/home-stats` (summary for home page)

### Frontend
- `frontend/src/app/(sidebar)/reports/page.tsx` — Reports hub / Governance Dashboard
- `frontend/src/app/(sidebar)/reports/domain-metrics/page.tsx` — Domain Metrics report
- `frontend/src/app/(sidebar)/reports/lead-time/page.tsx` — Lead Time report

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/dashboard/stats` | Full governance metrics: total requests, counts by status and verdict, domain review counts |
| GET | `/dashboard/home-stats` | Summary stats for home page: total, in-review, completed, open info requests |

## UI Behavior

1. **Home page** consumes `/dashboard/home-stats` to show 4 summary stat cards.
2. **Reports > Governance Dashboard** shows request distribution by status and verdict using `/dashboard/stats`.
3. **Reports > Domain Metrics** shows per-domain review activity and outcomes.
4. **Reports > Lead Time** shows time-based metrics for governance request lifecycle.
5. All report pages are read-only; accessible by admin, governance_lead, domain_reviewer, and viewer roles.

## Acceptance Criteria

- [x] AC-1: `GET /dashboard/stats` returns `totalRequests`, `byStatus` (object), `byVerdict` (object), and domain review counts
- [x] AC-2: `GET /dashboard/home-stats` returns `total`, `inReview`, `completed`, `openInfoRequests`
- [x] AC-3: Governance Dashboard report page loads and displays request metrics
- [x] AC-4: Domain Metrics report page loads and displays domain review data
- [x] AC-5: Lead Time report page loads and displays lifecycle timing stats
- [x] AC-6: Both endpoints require `dashboard:read` permission

## Test Coverage

### API Tests
- `api-tests/test_dashboard.py::test_dashboard_stats` — covers AC-1, AC-6
- `api-tests/test_dashboard.py::test_home_stats` — covers AC-2, AC-6

### E2E Tests
- `e2e-tests/reports.spec.ts` — "domain metrics page loads" covers AC-4
- `e2e-tests/reports.spec.ts` — "lead time page loads with stats" covers AC-5
- `e2e-tests/reports.spec.ts` — "actions page loads" covers AC-3

## Test Map Entries

```
backend/app/routers/dashboard.py                       -> api-tests/test_dashboard.py
frontend/src/app/(sidebar)/reports/page.tsx             -> e2e-tests/reports.spec.ts
frontend/src/app/(sidebar)/reports/domain-metrics/      -> e2e-tests/reports.spec.ts
frontend/src/app/(sidebar)/reports/lead-time/           -> e2e-tests/reports.spec.ts
```

## Notes

- Stats endpoints use aggregate SQL queries (`COUNT`, `GROUP BY`) directly on `governance_request` and `domain_review` tables. No materialized views or caching layer.
- The `home-stats` endpoint is a simplified subset of `stats`, optimized for the home page (fewer queries).
