# Feature: Audit Log

**Status**: Implemented
**Date**: 2026-03-12
**Spec Version**: 1

## Summary

Provides a read-only audit trail of all significant actions in EGM. Actions are recorded by various routers using a shared `write_audit()` utility. The audit log is viewable in the Settings section with filtering and pagination.

## Affected Files

### Backend
- `backend/app/routers/audit_log.py` — `GET /audit-log` endpoint (read-only, paginated, filterable)
- `backend/app/routers/governance_requests.py` — Writes audit entries on create, update, submit, verdict
- `backend/app/routers/user_authorization.py` — Writes audit entries on role assign, update, delete
- `backend/app/routers/domain_reviews.py` — Writes audit entries on review actions

### Frontend
- `frontend/src/app/(sidebar)/settings/audit-log/page.tsx` — Audit Log settings page with table and filters

### Database
- `scripts/schema.sql` — `audit_log` table (id, entity_type, entity_id, action, old_value JSONB, new_value JSONB, performed_by, created_at)

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/audit-log` | List audit entries with optional filters and pagination |

### Query Parameters

| Param | Type | Description |
|-------|------|-------------|
| `entityType` | string | Filter by entity type (e.g., `governance_request`, `user_role`) |
| `action` | string | Filter by action (e.g., `create`, `assign_role`) |
| `performedBy` | string | Filter by user itcode |
| `page` | int | Page number (default 1) |
| `pageSize` | int | Items per page (default 20, max 100) |

## UI Behavior

1. Settings > Audit Log page shows a paginated table of audit entries.
2. Each row displays: timestamp, entity type, entity ID, action, performed by, and expandable old/new value JSON.
3. Filters are available for entity type, action, and performed by.
4. Accessible only to users with `audit_log:read` permission (admin, governance_lead).

## Acceptance Criteria

- [x] AC-1: `GET /audit-log` returns paginated list with `data`, `total`, `page`, `pageSize`
- [x] AC-2: Filtering by `entityType` returns only matching entries
- [x] AC-3: Filtering by `action` returns only matching entries
- [x] AC-4: Filtering by `performedBy` returns only matching entries
- [x] AC-5: Audit entries include `entityType`, `entityId`, `action`, `oldValue`, `newValue`, `performedBy`, `createdAt`
- [x] AC-6: Requires `audit_log:read` permission (admin and governance_lead only)

## Test Coverage

### API Tests
- `api-tests/test_dashboard.py::test_audit_log` — covers AC-1, AC-5, AC-6

## Test Map Entries

```
backend/app/routers/audit_log.py -> api-tests/test_dashboard.py
```

## Notes

- Audit log is write-many, read-only. There is no API endpoint for creating or deleting audit entries — they are written server-side by other routers.
- `old_value` and `new_value` are stored as JSONB columns, allowing flexible schema per entity type.
- The `write_audit()` pattern is inline in each router (direct INSERT), not a centralized middleware or decorator.
