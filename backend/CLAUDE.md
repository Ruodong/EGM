# Backend — FastAPI

- Entry: `app/main.py`, port 4001
- DB: PostgreSQL `egm_local` on port 5433 (Docker: `egm-postgres`), schema `egm`
- All queries use raw SQL via `sqlalchemy.text()` — no ORM models
- Auth: `app/auth/rbac.py` → `require_permission(resource, action)`
- Responses: camelCase keys (mapped from snake_case DB columns)
- Tests: `python3 -m pytest api-tests/test_<module>.py -v --tb=short`
- Shared test fixtures: `api-tests/conftest.py` (create_request, submitted_request_with_reviews, etc.)
