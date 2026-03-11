# EGM Testing Guidelines

When adding or modifying features, corresponding tests must be updated to maintain coverage. This document describes the test structure, conventions, and checklist for keeping tests in sync with code changes.

---

## Test Structure

```
api-tests/           # Backend API integration tests (pytest + httpx)
  conftest.py         # Shared fixtures: client, create_request, dispatched_request, etc.
  test_auth.py        # Auth endpoints + role switching
  test_rbac.py        # Permission enforcement per role
  test_governance_requests.py  # CRUD + lifecycle + sort + search + date filter
  test_projects.py    # Project list + search
  test_intake.py      # Templates, responses, scoping, changelog
  test_dispatch.py    # Dispatch rules + execution
  test_domain_reviews.py  # Review lifecycle
  test_domains.py     # Domain CRUD
  test_info_requests.py   # ISR lifecycle
  test_dashboard.py   # Stats, progress, audit log
  test_health.py      # Health check

e2e-tests/           # Frontend E2E tests (Playwright)
  home.spec.ts        # Home page + navigation
  governance-requests.spec.ts  # Request list, create, detail, filters
  intake.spec.ts      # Scoping + questionnaire pages
  role-switcher.spec.ts   # Role switching UI
  settings.spec.ts    # Settings pages (domains, templates, rules, audit)
  dashboard.spec.ts   # Dashboard page
  reports.spec.ts     # Reports pages
```

## Running Tests

```bash
# API tests (requires backend on port 4001)
source backend/venv/bin/activate
cd api-tests && python -m pytest -v

# E2E tests (requires both backend:4001 and frontend:3001)
npx playwright test --reporter=list
```

---

## When to Add/Update Tests

### New Backend Endpoint
1. Add API test in the corresponding `test_<module>.py`
2. Test both success and error cases (400, 403, 404)
3. If the endpoint is permission-gated, add RBAC test in `test_rbac.py`

### New Frontend Page/Route
1. Add E2E test in the corresponding `*.spec.ts` or create a new one
2. Verify the page loads, key elements are visible, and basic interactions work

### Modified Endpoint Behavior
1. Update existing test assertions to match new response shape
2. If field names change (e.g. `verdict` → `overallVerdict`), update all test references

### New Role/Permission
1. Update `test_rbac.py` with access tests for the new role
2. Update `test_auth.py` if role switching is affected
3. Add E2E test in `role-switcher.spec.ts` if sidebar/UI changes

### Database Schema Changes
1. If column types change (e.g. VARCHAR → UUID), update test data to use valid values
2. Update fixture factories in `conftest.py` if table structure changes
3. Test that old-format data is handled (migration edge cases)

---

## API Test Conventions

### Fixtures (`conftest.py`)
- `client` — session-scoped httpx.Client with admin role (default)
- `create_request` — creates a fresh governance request per test
- `submitted_request` — creates and submits a request
- `dispatched_request` — full pipeline: create → submit → dispatch (includes review ID)
- `create_domain` — creates a unique domain with random code
- `create_template` — creates an intake template

### Role-specific Tests
Use a helper function to create role-scoped clients:

```python
import httpx

BASE_URL = "http://localhost:4001/api"

def _client_as(role: str) -> httpx.Client:
    return httpx.Client(
        base_url=BASE_URL,
        headers={"X-Dev-Role": role},
        timeout=10,
    )
```

### Naming
- `test_<action>_<entity>` for happy path: `test_create_request`
- `test_<action>_<condition>_fails` for error cases: `test_submit_non_draft_fails`
- `test_<role>_can_<action>` / `test_<role>_cannot_<action>` for RBAC

### Assertions
- Always check `resp.status_code` first
- For 4xx responses, check `resp.json()["detail"]` for expected message
- For list endpoints, verify `"data"` key and check list length / item shape

---

## E2E Test Conventions

### Setup
Each spec file creates a governance request in `beforeAll` if needed:

```typescript
let requestId: string;
test.beforeAll(async ({ request }) => {
  const resp = await request.post(`${API}/governance-requests`, {
    data: { title: 'E2E Test' },
  });
  requestId = (await resp.json()).requestId;
});
```

### What to Test
- Page loads without errors (check for heading or key element)
- Key data renders (table has rows, stats show numbers)
- Basic interactions (click tabs, fill forms, submit)
- Role-dependent UI (sidebar items appear/disappear based on role)

### What NOT to Test in E2E
- Exact API response shapes (that's what API tests are for)
- Exhaustive form validation (test a few key cases)
- Performance / timing

---

## Checklist for Feature Changes

- [ ] New endpoint → API test with success + error cases
- [ ] Permission-gated → RBAC test per role
- [ ] New page/route → E2E test
- [ ] Changed response shape → update API test assertions
- [ ] Changed sidebar/nav → update role-switcher E2E
- [ ] Schema migration → verify fixture data matches new schema
- [ ] Run full suite: `pytest -v` + `npx playwright test`
