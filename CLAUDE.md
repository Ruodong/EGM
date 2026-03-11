# EGM — Enterprise Governance Management

## Project Structure
- `backend/` — FastAPI (Python), entry: `backend/app/main.py`
- `frontend/` — Next.js 15 (TypeScript), port 3001
- `api-tests/` — pytest API integration tests (against localhost:4001)
- `e2e-tests/` — Playwright E2E browser tests (against localhost:3001)
- `scripts/` — DB migrations, sync scripts

## Databases
- EGM: PostgreSQL `egm_local` on port 5433 (Docker: `egm-postgres`), schema `egm`
- EAM: PostgreSQL `eam_local` on port 5432 (Docker: `ea-mvp-postgres`), schema `eam`

## Development Servers
- Backend: `cd backend && venv/bin/uvicorn app.main:app --port 4001 --reload`
- Frontend: `npm run dev:frontend` (port 3001)
- Use `.claude/launch.json` preview servers when possible

## Feature Development Workflow (MANDATORY)

Follow the **Closed-Loop Feature Development** skill for all new features and significant changes.

- **Skill definition**: `.claude/skills/closed-loop-development.md` (5 phases: Assess → Doc → Code → Test → Verify)
- **Full documentation**: `docs/development-workflow.md` (for human reference and onboarding)

Quick reference for the 5 phases:

1. **Assess** — Read `docs/features/_DEPENDENCIES.json`, classify Impact (L1-L4) × Risk (Low/Med/High), auto-approve or pause for user review
2. **Doc** — Create/update `docs/features/<slug>.md` from `docs/features/_TEMPLATE.md`, update dependency graph if needed
3. **Code** — Implement backend + frontend, add new files to `scripts/test-map.json`
4. **Test** — Write API tests + E2E tests per AC. PostToolUse hook auto-runs affected tests on every Edit/Write.
5. **Verify** — Check off ACs, fill test coverage, set status to "Implemented", run full test suite

When modifying an existing feature that has no spec, create one retroactively.

## Testing Rules (MANDATORY)

### Test mapping (single source of truth)
All source-file → test-file mappings live in `scripts/test-map.json`.
- The PostToolUse hook reads this file to decide which tests to run automatically.
- When you add a new source file, add its mapping to `scripts/test-map.json`.
- Do NOT duplicate mappings elsewhere — `test-map.json` is the only place.
- New router added → create `api-tests/test_<name>.py`, register in `backend/app/main.py`, add to `test-map.json`
- New frontend page added → add E2E cases, add to `test-map.json`

### How to run tests after changes
After modifying code, run ONLY the affected tests:

```bash
# API tests — specific file
python3 -m pytest api-tests/test_governance_requests.py -v --tb=short

# E2E tests — specific file
npx playwright test e2e-tests/governance-requests.spec.ts --reporter=list

# E2E tests — specific test by name
npx playwright test -g "create new request" --reporter=list
```

### Full test suite (before marking work complete)
```bash
python3 -m pytest api-tests/ -v --tb=short    # 86+ API tests
npx playwright test --reporter=list            # 24+ E2E tests
```

## Code Conventions
- Backend responses use camelCase keys (mapped from snake_case DB columns)
- All routers use `require_permission(resource, action)` for RBAC
- DB queries use raw SQL via `sqlalchemy.text()` (no ORM models)
- Frontend uses `@/lib/api` wrapper for all API calls
- Shared fixtures in `api-tests/conftest.py` (create_request, dispatched_request, etc.)
