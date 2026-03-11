# Development Workflow: Closed-Loop Feature Development

This document describes EGM's development workflow — a unified process that combines **Impact Assessment** (risk evaluation) with a **Closed-Loop Implementation** cycle (doc → code → test-map → tests → verify). It is designed for AI-assisted development with Claude Code but the principles apply to any structured development process.

## Overview

```
User Request
     │
     ▼
┌──────────────────┐
│  Phase 1: Assess │  ← Impact Level (L1-L4) × Risk Level (Low/Med/High)
│  (Impact + Risk)  │  ← Auto-approve or Pause for user review
└────────┬─────────┘
         │ approved
         ▼
┌──────────────────┐
│  Phase 2: Doc    │  ← Create/update feature spec with ACs
│  (Feature Spec)   │  ← Update dependency graph if needed
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Phase 3: Code   │  ← Implement backend + frontend
│  (Implement)      │  ← Update test-map.json for new files
│                    │  ← PostToolUse hook auto-runs affected tests
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Phase 4: Test   │  ← Write API tests + E2E tests per AC
│  (Write Tests)    │  ← Run affected tests only (not full suite)
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Phase 5: Verify │  ← Check off ACs in feature doc
│  (Close Loop)     │  ← Run full test suite
│                    │  ← Set status to "Implemented"
└──────────────────┘
```

## Phase 1: Impact Assessment

Before writing any code, evaluate the change's blast radius and risk to existing functionality.

### Impact Level (How far does it reach?)

| Level | Name | Definition | Examples |
|-------|------|-----------|----------|
| **L1** | UI only | Only page components or styles change. No backend or schema changes. | Add a tooltip, change button color, adjust layout |
| **L2** | Feature-local | Changes confined to a single feature's router/logic/schema. | Add query params to an endpoint, add a column used by one router |
| **L3** | Cross-feature | Changes tables or APIs that other features depend on. | Modify `governance_request` table (used by 4 features), change a shared API response shape |
| **L4** | Global | Changes shared infrastructure or tables used by 3+ features. | Modify `database.py`, `auth/`, `api.ts`, `layout.tsx` |

**How to determine**: Check `docs/features/_DEPENDENCIES.json`:
- `features.<name>.tables` — which tables does each feature use?
- `edges` — which features have FK/status_write/data_read/guard relationships?
- `sharedTables` — which tables appear in multiple features?
- `globalFiles` — which files affect everything?

### Risk Level (Can it break existing functionality?)

| Level | Name | Definition | Examples |
|-------|------|-----------|----------|
| **Low** | Pure additions | Only adds new things. No existing behavior changes. No existing test assertions would break. | New endpoint, new page, new column with default value |
| **Medium** | Behavior modification | Changes existing behavior in ways that could affect users or downstream code. | Rename a field, change API response shape, alter status transition rules, add migration script |
| **High** | Structural change | Changes core relationships, lifecycle, or permissions. May require data migration. | Change FK relationships, alter status lifecycle, modify dispatch logic, change RBAC permissions |

### Decision Matrix

| Risk \ Impact | L1 (UI) | L2 (Local) | L3 (Cross) | L4 (Global) |
|---|---|---|---|---|
| **Low** | Auto-approve | Auto-approve | Auto-approve + note | Auto-approve + note |
| **Medium** | Auto-approve | Pause | Pause | Pause |
| **High** | Pause | Pause | Pause (full chain) | Pause (full chain) |

**Actions:**
- **Auto-approve**: Proceed to implementation immediately
- **Auto-approve + note**: Proceed but list which features are touched
- **Pause**: Extract affected Acceptance Criteria and API contracts from feature docs. Present to user for review before proceeding.
- **Pause (full chain)**: Trace transitive dependencies. Extract all affected ACs, schema changes, and API contracts. Present to user for review.

### Assessment Output Format

See `docs/features/_ASSESSMENT_FORMAT.md` for the full format specification. In brief:

**Low Risk (2-line compact):**
```
**Feature**: <name> | **Impact**: L<n> | **Risk**: Low | **Decision**: Auto-approve
```

**Medium/High Risk (full format with tables):**
- Affected Features table (Feature | Relationship | Impact)
- Schema Changes checklist
- Affected Acceptance Criteria (quoted from feature docs)
- Affected API Contracts
- Test Impact

## Phase 2: Feature Documentation

Every feature or significant change gets a spec document at `docs/features/<slug>.md`.

### Feature Doc Template

Use `docs/features/_TEMPLATE.md`. Key sections:

| Section | Purpose |
|---------|---------|
| Summary | What + Why in 1-2 sentences |
| Impact Assessment | Paste from Phase 1 (historical record) |
| Affected Files | Backend routers, frontend pages, DB changes |
| API Endpoints | Method / Path / Description table |
| UI Behavior | Step-by-step interactions + error states |
| Acceptance Criteria | Numbered, testable requirements (AC-1, AC-2, ...) |
| Test Coverage | Test name → AC mapping (filled in Phase 5) |
| Test Map Entries | Source file → test file mapping (filled in Phase 5) |

### Dependency Graph

`docs/features/_DEPENDENCIES.json` is the machine-readable cross-feature dependency graph. Structure:

```json
{
  "features": {
    "<slug>": {
      "doc": "docs/features/<slug>.md",
      "tables": ["table1", "table2"],
      "routers": ["router.py"],
      "frontendPaths": ["frontend/src/app/path/"]
    }
  },
  "edges": [
    { "from": "feature-a", "to": "feature-b", "type": "FK|status_write|data_read|guard", "detail": "..." }
  ],
  "sharedTables": {
    "table_name": ["feature-a", "feature-b"]
  },
  "globalFiles": ["backend/app/database.py", ...]
}
```

**When to update**: Every time a new feature is added or an existing feature's tables/routers/paths change.

## Phase 3: Implementation

### Code

Write backend and frontend code according to the feature doc's acceptance criteria.

### Test Map

`scripts/test-map.json` is the single source of truth for source-file-to-test-file mappings.

**Mapping rules:**
- Backend router → API tests only (never E2E)
- Frontend page → E2E tests only (never API)
- Shared infrastructure → use the `wildcards` section to trigger all tests of that type

```json
{
  "mappings": {
    "backend/app/routers/example.py": {
      "api": ["api-tests/test_example.py"],
      "e2e": []
    },
    "frontend/src/app/example/": {
      "api": [],
      "e2e": ["e2e-tests/example.spec.ts"]
    }
  },
  "wildcards": {
    "backend/app/database.py": { "api": ["api-tests/"], "e2e": [] }
  }
}
```

### Auto-Test Hook

A PostToolUse hook (`scripts/run-affected-tests.sh`) automatically runs affected tests after every file edit:

1. Receives the edited file path from Claude Code's hook system
2. Looks up `scripts/test-map.json` for matching test files (exact match → prefix match → wildcard match)
3. Runs only those tests (pytest for API, playwright for E2E)
4. Returns pass/fail JSON to Claude Code

**Configuration** (`.claude/settings.local.json`):
```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "Edit|Write",
      "hooks": [{
        "type": "command",
        "command": "\"$CLAUDE_PROJECT_DIR\"/scripts/run-affected-tests.sh",
        "timeout": 120
      }]
    }]
  }
}
```

This creates a tight feedback loop: every code change immediately validates against its tests, catching regressions in real time.

## Phase 4: Testing

### API Tests (`api-tests/`)

- Framework: pytest + httpx
- Target: `localhost:4001` (FastAPI backend)
- Shared fixtures in `api-tests/conftest.py` (e.g., `create_request`, `dispatched_request`)
- Each test function should document which AC it covers

```python
def test_create_request(client: httpx.Client):
    """Covers AC-1: Creating a request generates a unique GR-XXXXXX ID."""
    resp = client.post("/governance-requests", json={"title": "Test"})
    assert resp.status_code == 200
    assert resp.json()["requestId"].startswith("GR-")
```

### E2E Tests (`e2e-tests/`)

- Framework: Playwright
- Target: `localhost:3001` (Next.js frontend)
- Test user interactions end-to-end
- Wait for API responses and navigation before asserting

```typescript
test('create new request via form', async ({ page }) => {
  await page.goto('/governance/create');
  const titleInput = page.getByRole('textbox').first();
  await titleInput.fill('Test Request');

  const [response] = await Promise.all([
    page.waitForResponse(resp => resp.url().includes('/governance-requests')),
    page.getByRole('button', { name: 'Create Request' }).click(),
  ]);
  expect(response.status()).toBe(200);
  await page.waitForURL(/\/governance\/GR-/);
});
```

### Running Tests

```bash
# Affected tests only (during development)
python3 -m pytest api-tests/test_<module>.py -v --tb=short
npx playwright test e2e-tests/<spec>.spec.ts --reporter=list

# Full suite (before completion)
python3 -m pytest api-tests/ -v --tb=short
npx playwright test --reporter=list
```

## Phase 5: Verification & Completion

### Close the Loop

1. **Check off ACs**: In the feature doc, mark each acceptance criterion with `[x]` that has a passing test
2. **Fill Test Coverage**: Map each test to its AC
3. **Fill Test Map Entries**: Document source → test file mappings
4. **Set Status**: Change from "Draft" to "Implemented"
5. **Run Full Suite**: Confirm no regressions across the entire codebase

### Final Checklist

```
- [ ] Phase 1: Impact Assessment completed
- [ ] Phase 2: Feature doc created with numbered ACs
- [ ] Phase 2: Dependency graph updated (if needed)
- [ ] Phase 3: Code implemented
- [ ] Phase 3: test-map.json updated for new files
- [ ] Phase 4: API tests written and passing
- [ ] Phase 4: E2E tests written and passing
- [ ] Phase 5: Feature doc ACs checked off
- [ ] Phase 5: Feature doc status = "Implemented"
- [ ] Phase 5: Full test suite passing
```

## File Reference

| File | Type | Purpose |
|------|------|---------|
| `CLAUDE.md` | Config | Project-level rules referencing this workflow |
| `.claude/skills/closed-loop-development.md` | Skill | Claude Code skill definition (machine-readable) |
| `.claude/settings.local.json` | Config | PostToolUse hook configuration |
| `docs/features/_TEMPLATE.md` | Template | Feature doc template |
| `docs/features/_DEPENDENCIES.json` | Data | Cross-feature dependency graph |
| `docs/features/_ASSESSMENT_FORMAT.md` | Reference | Impact assessment output format |
| `scripts/test-map.json` | Data | Source file → test file mapping |
| `scripts/run-affected-tests.sh` | Script | Auto-test hook (PostToolUse) |

## Adapting for Other Projects

To use this workflow in a different project:

1. **Copy the skill**: `.claude/skills/closed-loop-development.md`
2. **Create the supporting files**:
   - `docs/features/_TEMPLATE.md` — adapt sections to your project
   - `docs/features/_DEPENDENCIES.json` — map your features, tables, and edges
   - `docs/features/_ASSESSMENT_FORMAT.md` — adjust classification signals to your domain
   - `scripts/test-map.json` — map your source files to test files
3. **Set up the hook**: Copy the PostToolUse hook config to `.claude/settings.local.json` and adapt `run-affected-tests.sh` to your test runner (pytest/jest/vitest/etc.)
4. **Add CLAUDE.md rules**: Reference the skill and test-map in your project's `CLAUDE.md`
5. **Bootstrap feature docs**: Generate docs for existing features retroactively

The key insight is that **the dependency graph and test map are the enablers** — without them, impact assessment is guesswork and test selection is all-or-nothing.
