# EGM — Enterprise Governance Management

## Project Structure
- `backend/` — FastAPI (Python), entry: `backend/app/main.py`
- `frontend/` — Next.js 15 (TypeScript), port 3001
- `api-tests/` — pytest API integration tests (against localhost:4001)
- `e2e-tests/` — Playwright E2E browser tests (against localhost:3001)
- `scripts/` — DB migrations, sync scripts, test-map.json

## Databases
- EGM: PostgreSQL `egm_local` on port 5433 (Docker: `egm-postgres`), schema `egm`
- EAM: PostgreSQL `eam_local` on port 5432 (Docker: `ea-mvp-postgres`), schema `eam`

## Development Servers
- Backend: `cd backend && venv/bin/uvicorn app.main:app --port 4001 --reload`
- Frontend: `npm run dev:frontend` (port 3001)
- Use `.claude/launch.json` preview servers when possible

## Code Changes → Closed-Loop Workflow (MANDATORY)

All code changes MUST follow `.claude/skills/closed-loop-development.md` (Assess → Doc → Code → Test → Verify).

Skip only for: documentation-only changes, test-only changes, dependency version bumps with no code changes.

## Testing

- Source → test mappings: `scripts/test-map.json` (single source of truth)
- PostToolUse hook auto-runs affected tests on Edit/Write
- New router → create `api-tests/test_<name>.py`, register in `main.py`, add to `test-map.json`
- New page → add E2E cases, add to `test-map.json`
- Full suite: `python3 -m pytest api-tests/ -v --tb=short` + `npx playwright test --reporter=list`

## Code Conventions
- Backend: camelCase responses (mapped from snake_case DB), `require_permission()` RBAC, raw SQL via `sqlalchemy.text()`
- Frontend: `@/lib/api` wrapper, Ant Design 5 components
- Shared test fixtures: `api-tests/conftest.py`
