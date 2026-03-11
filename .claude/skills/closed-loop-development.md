# Skill: Closed-Loop Feature Development

## Description

A unified workflow that combines **Impact Assessment** and **Closed-Loop Implementation** into a single end-to-end process. When a user requests a new feature or significant change, this skill guides Claude through risk evaluation, implementation, testing, and verification — ensuring nothing is missed and existing functionality is protected.

## When to Use

Activate this skill when:
- User requests a new feature or significant code change
- User asks to modify existing behavior (API, schema, UI)
- User requests refactoring that touches multiple files
- A bug fix may have side effects on other features

Do NOT activate for:
- Simple questions or explanations
- Reading/exploring code without changes
- Documentation-only updates (unless they accompany code changes)

---

## Phase 1: Impact Assessment

Before writing any code, evaluate the blast radius and risk of the requested change.

### Step 1.1 — Gather Context

1. Read `docs/features/_DEPENDENCIES.json` for the cross-feature dependency graph
2. Identify which feature(s) the change belongs to (match by tables, routers, frontendPaths)
3. Read the feature doc(s) from `docs/features/<slug>.md` for the affected feature
4. If the change touches tables/APIs listed in `edges` or `sharedTables`, read those connected feature docs too

### Step 1.2 — Classify Impact Level

| Level | Definition | Signals |
|-------|-----------|---------|
| **L1** | UI/interaction only | Only `page.tsx`, CSS/Tailwind, component styling changes. No router or schema changes. |
| **L2** | Feature-local | Changes a single router's logic or adds columns used only by that router. |
| **L3** | Cross-feature | Changes tables/APIs that other features depend on. Check `_DEPENDENCIES.json` edges and `sharedTables`. |
| **L4** | Global | Changes shared infrastructure (`database.py`, `auth/`, `middleware`, `api.ts`, `layout.tsx`) or tables used by 3+ features. |

### Step 1.3 — Classify Risk Level

| Level | Definition | Signals |
|-------|-----------|---------|
| **Low** | Pure additions | New columns with defaults, new endpoints, new pages. No existing test assertions would break. |
| **Medium** | Modifies existing behavior | Renames/removes fields, changes API response shape, alters status transition rules, requires migration script. |
| **High** | Structural changes | Changes FK relationships, status lifecycle, dispatch/evaluation logic, RBAC permissions, requires historical data backfill. |

### Step 1.4 — Decision Matrix

| Risk \ Impact | L1 (UI only) | L2 (Feature-local) | L3 (Cross-feature) | L4 (Global) |
|---|---|---|---|---|
| **Low** | Auto-approve | Auto-approve | Auto-approve + note | Auto-approve + note |
| **Medium** | Auto-approve | Pause: review | Pause: review | Pause: review |
| **High** | Pause: review | Pause: review | Pause: full chain | Pause: full chain |

### Step 1.5 — Output Assessment

**Low Risk (compact format):**
```
## Impact Assessment
**Feature**: <name> | **Impact**: L<n> | **Risk**: Low | **Decision**: Auto-approve
<one-line note about scope>
```

**Medium/High Risk (full format):**
```
## Impact Assessment
**Feature**: <name>
**Impact Level**: L<n> — <reason>
**Risk Level**: <Medium|High> — <reason>
**Decision**: Pause for review

### Affected Features
| Feature | Relationship | Specific Impact |
|---------|-------------|-----------------|

### Schema Changes
- [ ] New/altered tables or columns
- [ ] Migration script required: Yes / No

### Affected Acceptance Criteria
> <feature>.md AC-<n>: "<quoted AC>"
> --> How this change affects the AC

### Affected API Contracts
- Endpoint changes, response shape changes

### Test Impact
- Existing tests needing updates
- New tests needed
```

**Full Chain (High Risk + L3/L4) — additionally include:**
```
### Full Dependency Chain
<feature> (directly affected)
  └─ <dependent-feature> (<relationship>)
      └─ <transitive-dependent> (<relationship>)
```

### Step 1.6 — Gate

- **Low risk** → Proceed to Phase 2 immediately
- **Medium risk** → Present affected ACs + API contracts to user. Wait for approval.
- **High risk** → Present full dependency chain + ACs + schema changes to user. Wait for approval.

---

## Phase 2: Feature Documentation

After assessment is approved (or auto-approved), create or update the feature spec.

### Step 2.1 — Create/Update Feature Doc

1. Use `docs/features/_TEMPLATE.md` as the starting template
2. File path: `docs/features/<slug>.md`
3. Fill in all sections:
   - **Summary**: What + Why (1-2 sentences)
   - **Impact Assessment**: Paste the assessment from Phase 1
   - **Affected Files**: List all backend routers, frontend pages, DB changes
   - **API Endpoints**: Table of Method | Path | Description
   - **UI Behavior**: Step-by-step interaction + error states
   - **Acceptance Criteria**: Numbered, testable requirements (AC-1, AC-2, ...)
4. Set Status to "Draft"

### Step 2.2 — Update Dependency Graph

If the change introduces new tables, routers, frontend paths, or cross-feature relationships:
1. Update `docs/features/_DEPENDENCIES.json`
2. Add/modify the feature entry (tables, routers, frontendPaths)
3. Add any new edges (FK, status_write, data_read, guard)
4. Update `sharedTables` if tables are used by multiple features

---

## Phase 3: Implementation

### Step 3.1 — Write Code

Implement the backend and frontend code according to the feature doc's acceptance criteria.

### Step 3.2 — Update Test Map

If new source files are created, add their mappings to `scripts/test-map.json`:

```json
{
  "backend/app/routers/<new_router>.py": {
    "api": ["api-tests/test_<name>.py"],
    "e2e": []
  },
  "frontend/src/app/<new_path>/": {
    "api": [],
    "e2e": ["e2e-tests/<spec>.spec.ts"]
  }
}
```

**Mapping rules:**
- Backend router changes → API tests only (never E2E)
- Frontend page changes → E2E tests only (never API)
- Shared infrastructure (database.py, auth/, api.ts, layout.tsx) → use `wildcards` section

### Step 3.3 — Automatic Verification

The PostToolUse hook (`scripts/run-affected-tests.sh`) automatically runs affected tests after every Edit/Write operation:
- Reads the edited file path
- Looks up `scripts/test-map.json` for matching test files
- Runs only those tests
- Reports pass/fail as JSON to Claude

If tests fail after an edit, fix the issue before proceeding.

---

## Phase 4: Testing

### Step 4.1 — Write API Tests

For each backend acceptance criterion, write a test in `api-tests/test_<module>.py`:
- Use shared fixtures from `api-tests/conftest.py`
- Test happy path, error cases, and edge cases
- Each test function name should indicate which AC it covers

### Step 4.2 — Write E2E Tests

For each frontend acceptance criterion, write a test in `e2e-tests/<spec>.spec.ts`:
- Use Playwright's page object model
- Test user interactions end-to-end
- Wait for API responses and navigation before asserting

### Step 4.3 — Run Affected Tests

```bash
# API tests — specific file
python3 -m pytest api-tests/test_<module>.py -v --tb=short

# E2E tests — specific file
npx playwright test e2e-tests/<spec>.spec.ts --reporter=list
```

---

## Phase 5: Verification & Completion

### Step 5.1 — Update Feature Doc

1. Check off all acceptance criteria that have passing tests
2. Fill in the **Test Coverage** section with test names and AC mappings
3. Fill in the **Test Map Entries** section
4. Set Status to "Implemented"

### Step 5.2 — Run Full Test Suite

Before marking work complete, run the full suite to catch regressions:

```bash
python3 -m pytest api-tests/ -v --tb=short
npx playwright test --reporter=list
```

### Step 5.3 — Final Checklist

- [ ] Impact Assessment completed (Phase 1)
- [ ] Feature doc created/updated with all ACs (Phase 2)
- [ ] Dependency graph updated if needed (Phase 2.2)
- [ ] Code implemented (Phase 3)
- [ ] Test map updated for new files (Phase 3.2)
- [ ] API tests written and passing (Phase 4.1)
- [ ] E2E tests written and passing (Phase 4.2)
- [ ] Feature doc status set to "Implemented" (Phase 5.1)
- [ ] Full test suite passing (Phase 5.2)

---

## Supporting Files

| File | Purpose |
|------|---------|
| `docs/features/_TEMPLATE.md` | Feature doc template |
| `docs/features/_DEPENDENCIES.json` | Cross-feature dependency graph |
| `docs/features/_ASSESSMENT_FORMAT.md` | Impact assessment output format reference |
| `scripts/test-map.json` | Source file → test file mapping (single source of truth) |
| `scripts/run-affected-tests.sh` | PostToolUse hook — auto-runs affected tests on Edit/Write |
| `.claude/settings.local.json` | Hook configuration for auto-test runner |

---

## Example Walkthrough

**User request**: "Add keyword search and date range filter to the governance requests list page"

**Phase 1 — Assessment:**
```
## Impact Assessment
**Feature**: Governance Requests search/filter
**Impact**: L2 (backend adds query params + frontend adds UI controls)
**Risk**: Low (pure additions — new query params, new UI elements, no existing behavior changes)
**Decision**: Auto-approve
```

**Phase 2 — Doc**: Update `docs/features/governance-requests.md` with new ACs:
- AC-18: dateFrom/dateTo filter by create_at
- AC-19: keyword search with 300ms debounce
- AC-20: date range pickers visible on list page

**Phase 3 — Code**:
- Backend: Add `dateFrom`, `dateTo`, `search` query params to `list_requests`
- Frontend: Add search input + date pickers to requests page

**Phase 4 — Tests**:
- API: `test_filter_by_date_range`, `test_search_by_keyword`
- E2E: `search box filters requests`, `date range pickers are visible`

**Phase 5 — Verify**: All 88 API + 26 E2E tests pass. Feature doc updated to "Implemented".
