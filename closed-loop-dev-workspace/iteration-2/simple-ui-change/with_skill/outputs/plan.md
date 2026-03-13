# Plan: Add Timestamp Column Sorting to Audit Log Table

**Task**: Add click-to-sort on the Timestamp column header in the Settings > Audit Log page, toggling between ascending and descending order. Pure frontend change -- no backend modifications.

---

## Phase 1: Impact Assessment

### Step 1.0 -- Understand & Explore

**What is being changed?**
The Audit Log page (`frontend/src/app/(sidebar)/settings/audit-log/page.tsx`) currently renders a hand-crafted HTML table with no sorting support. The user wants to click the "Timestamp" column header to toggle sort order (ASC/DESC) on the `performedAt` field.

**Existing patterns discovered:**
1. **Shared `DataTable` component** (`frontend/src/components/shared/DataTable.tsx`) already supports sorting out of the box via `sortable`, `sortField`, `sortOrder`, and `onSort` props. It renders sort indicators (arrows) and handles toggle logic.
2. **Governance Requests page** (`frontend/src/app/(sidebar)/requests/page.tsx`) demonstrates the full pattern: `useState` for `sortField`/`sortOrder`, a `handleSort` callback, passing sort params to the API via `api.get()`, and wiring `DataTable` with controlled sort state.
3. **Backend audit log router** (`backend/app/routers/audit_log.py`) already accepts `sortField` and `sortOrder` query params via `PaginationParams` (defined in `backend/app/utils/pagination.py`). However, the router currently ignores these params and hardcodes `ORDER BY performed_at DESC`. The task says "pure frontend change," so there are two approaches:
   - **Approach A (client-side sort)**: Sort the current page of 20 rows in JavaScript. Simple but only sorts within the current page, not across all data.
   - **Approach B (pass sort params to existing API)**: Pass `sortField=performed_at&sortOrder=ASC|DESC` to the backend. The backend already parses these via `PaginationParams` but does NOT use them in the audit log query. This would require a tiny backend change (adding an ALLOWED_SORT whitelist and using `pg.sort_field`/`pg.sort_order` in the SQL, mirroring governance_requests.py).

**Recommended approach**: Approach A (pure client-side sort). The user explicitly stated this is a frontend-only change. Sorting 20 rows on the current page is sufficient for a timestamp toggle. However, we should note in the feature doc that this sorts only the current page, and a future enhancement could wire it to the backend.

**Implementation path -- two options considered:**

| Option | Description | Tradeoff |
|--------|-------------|----------|
| **Option 1: Refactor to DataTable** | Replace the hand-crafted `<table>` with the shared `DataTable` component, gaining sort, pagination, and CSV export for free. | Cleaner long-term, but changes the expand/collapse row detail behavior (DataTable does not support expandable rows). Significant refactor. |
| **Option 2: Add local sort state to existing table** | Add `useState` for `sortOrder`, a click handler on the Timestamp `<th>`, sort `entries` array in-memory before rendering, and add a visual sort indicator. | Minimal change, preserves the existing expand/detail row UX. |

**Selected: Option 2.** The audit log table has a unique expand/collapse detail row pattern that DataTable does not support. Adding a local sort state is the simplest path that preserves existing behavior. The change touches exactly one file.

### Step 1.1 -- Gather Context

- **`_DEPENDENCIES.json`**: The `audit-log` feature entry lists:
  - Tables: `audit_log`
  - Routers: `audit_log.py`
  - Frontend paths: `frontend/src/app/(sidebar)/settings/audit-log/`
- **Feature doc**: No existing feature doc for audit-log (`docs/features/audit-log.md` does not exist). One will be created retroactively in Phase 2.
- **Shared tables**: `audit_log` is listed in `sharedTables` (used by `governance-requests`, `domain-dispatch`, `audit-log`). However, this change does NOT touch the table schema, backend router, or any shared code -- it is purely a frontend sort on already-fetched data.
- **No edges from/to audit-log** in the dependency graph, confirming it has no cross-feature side effects.

### Step 1.2 -- Classify Impact Level

**Impact: L1 (UI/interaction only)**

Rationale: The change modifies only the audit log page component (`page.tsx`). No router, schema, or shared component changes. No API contract changes. The sort is performed client-side on the already-fetched page of data.

### Step 1.3 -- Classify Risk Level

**Risk: Low (Pure addition)**

Rationale: This adds new interactive behavior (click-to-sort) without modifying any existing behavior. The data fetching, pagination, filtering, and expand/collapse all remain unchanged. No existing test assertions would break.

### Step 1.4 -- Decision Matrix

| Risk \ Impact | L1 (UI only) |
|---|---|
| **Low** | **Auto-approve** |

### Step 1.5 -- Output Assessment

```
## Impact Assessment
**Feature**: Audit Log | **Impact**: L1 | **Risk**: Low | **Decision**: Auto-approve
Client-side timestamp sort toggle on audit log table; single file change, no backend/schema impact.
```

### Step 1.6 -- Gate

Low risk -> Proceed to Phase 2 immediately.

---

## Phase 2: Feature Documentation

### Step 2.1 -- Create Feature Doc

Since no `docs/features/audit-log.md` exists, a new one would be created retroactively covering the existing audit log page plus the new sorting feature.

**File**: `docs/features/audit-log-timestamp-sort.md`

**Content outline:**

```markdown
# Feature: Audit Log Timestamp Sort

**Status**: Draft
**Date**: 2026-03-11
**Spec Version**: 1

## Impact Assessment
**Feature**: Audit Log | **Impact**: L1 | **Risk**: Low | **Decision**: Auto-approve
Client-side timestamp sort toggle on audit log table; single file change, no backend/schema impact.

## Summary

Add a clickable sort toggle to the Timestamp column header on the Settings > Audit Log page. Clicking the header cycles between descending (default, newest first) and ascending (oldest first) order. Sorting is performed client-side on the current page of results.

## Affected Files

### Frontend
- `frontend/src/app/(sidebar)/settings/audit-log/page.tsx` -- Add sort state, click handler, sort logic, and visual indicator

### Backend
- (none -- pure frontend change)

### Database
- (none)

## API Endpoints

No changes. The existing `GET /api/audit-log` endpoint is used as-is.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/audit-log` | List audit entries (existing, unchanged) |

## UI Behavior

1. User navigates to Settings > Audit Log
2. Table loads with entries sorted by Timestamp descending (newest first) -- this is the default from the API
3. User clicks the "Timestamp" column header
4. The entries on the current page re-sort to ascending order (oldest first)
5. A sort indicator arrow appears next to "Timestamp" (e.g., up-arrow for ASC)
6. User clicks again -- entries re-sort to descending, arrow flips to down-arrow
7. When the user changes the entity type filter or navigates to a different page, the sort resets to descending (matching API default)

**Edge cases:**
- Single entry or empty table: Sort toggle still works visually (indicator changes) but has no practical effect
- Entries with null `performedAt`: Null timestamps sort to the end regardless of direction

## Acceptance Criteria

- [ ] AC-1: Clicking the Timestamp column header toggles the displayed sort order of entries on the current page
- [ ] AC-2: A visual sort indicator (arrow/triangle) appears on the Timestamp header showing current direction
- [ ] AC-3: Default sort order is descending (newest first), matching the API response order
- [ ] AC-4: Other column headers (Entity Type, Entity ID, Action, Performed By, Details) are NOT sortable
- [ ] AC-5: Expand/collapse row detail behavior continues to work correctly after sorting

## Test Coverage

### API Tests
- (none needed -- no backend changes)

### E2E Tests
- `e2e-tests/settings.spec.ts` -- "audit log timestamp sort toggles order" covers AC-1, AC-2
- `e2e-tests/settings.spec.ts` -- "audit log default sort is descending" covers AC-3
- `e2e-tests/settings.spec.ts` -- "audit log expand/collapse works after sorting" covers AC-5

## Test Map Entries

No new source files are created; the existing mapping already covers:
```
frontend/src/app/(sidebar)/settings/ -> e2e-tests/settings.spec.ts
```

## Notes

- Sorting is client-side only (sorts the current page of 20 rows). A future enhancement could pass `sortField`/`sortOrder` to the backend API, which already parses these params via `PaginationParams` but does not use them in the audit log query.
- The shared `DataTable` component was considered but not used because it does not support the expand/collapse detail row pattern unique to the audit log table.
```

### Step 2.2 -- Update Dependency Graph

No updates needed. The change does not introduce new tables, routers, frontend paths, or cross-feature relationships. The existing `audit-log` entry in `_DEPENDENCIES.json` already correctly lists the affected frontend path.

---

## Phase 3: Implementation

### Step 3.0 -- Implementation Strategy

Skipped (L1 change -- blast radius contained to a single file).

### Step 3.1 -- Write Code

**File to modify**: `frontend/src/app/(sidebar)/settings/audit-log/page.tsx`

**Changes:**

1. **Add sort state** (after existing `useState` declarations, around line 39):
   ```tsx
   const [sortOrder, setSortOrder] = useState<'ASC' | 'DESC'>('DESC');
   ```

2. **Add sort logic** (after `entries` derivation, around line 52):
   ```tsx
   const sortedEntries = [...entries].sort((a, b) => {
     const dateA = a.performedAt ? new Date(a.performedAt).getTime() : 0;
     const dateB = b.performedAt ? new Date(b.performedAt).getTime() : 0;
     return sortOrder === 'ASC' ? dateA - dateB : dateB - dateA;
   });
   ```

3. **Add click handler for Timestamp header** (replace the static `<th>` on line 89):
   ```tsx
   <th
     className="text-left px-4 py-2 font-medium cursor-pointer select-none hover:bg-gray-100"
     onClick={() => setSortOrder(prev => prev === 'ASC' ? 'DESC' : 'ASC')}
   >
     Timestamp
     <span className="ml-1" data-testid="sort-indicator-performed_at">
       {sortOrder === 'ASC' ? '\u25B2' : '\u25BC'}
     </span>
   </th>
   ```

4. **Use `sortedEntries` instead of `entries`** in the `<tbody>` map (line 98):
   ```tsx
   {sortedEntries.map((e) => (
   ```

**Summary of all edits in a single file:**

| Line(s) | Change | Purpose |
|---------|--------|---------|
| ~39 | Add `const [sortOrder, setSortOrder] = useState<'ASC' \| 'DESC'>('DESC');` | Track sort direction state |
| ~52-56 | Add `sortedEntries` derived from `entries` | Sort entries client-side by `performedAt` |
| ~89 | Replace static `<th>Timestamp</th>` with clickable header + sort indicator | Make Timestamp header interactive with visual feedback |
| ~98 | Change `entries.map` to `sortedEntries.map` | Render sorted data |

### Step 3.2 -- Update Test Map

No new source files are created. The existing mapping in `scripts/test-map.json` already covers:
```json
"frontend/src/app/(sidebar)/settings/": {
  "api": [],
  "e2e": ["e2e-tests/settings.spec.ts"]
}
```
No changes needed.

### Step 3.3 -- Automatic Verification

After each edit to `page.tsx`, the PostToolUse hook would automatically run `e2e-tests/settings.spec.ts` based on the test-map entry for `frontend/src/app/(sidebar)/settings/`. Existing tests (including "audit log page loads") should continue to pass.

---

## Phase 4: Testing

### Step 4.1 -- Write API Tests

Not applicable -- no backend changes.

### Step 4.2 -- Write E2E Tests

**File to modify**: `e2e-tests/settings.spec.ts`

**New tests to add** (inside the existing `Settings Pages` describe block):

```typescript
test('audit log timestamp sort toggles order on click', async ({ page }) => {
  await page.goto('/settings/audit-log');
  await page.waitForTimeout(500);

  // Default sort indicator should show descending (down arrow)
  const sortIndicator = page.getByTestId('sort-indicator-performed_at');
  await expect(sortIndicator).toBeVisible();
  await expect(sortIndicator).toHaveText('\u25BC'); // down arrow = DESC

  // Click Timestamp header to toggle to ASC
  await page.getByRole('columnheader', { name: /Timestamp/ }).click();
  await expect(sortIndicator).toHaveText('\u25B2'); // up arrow = ASC

  // Click again to toggle back to DESC
  await page.getByRole('columnheader', { name: /Timestamp/ }).click();
  await expect(sortIndicator).toHaveText('\u25BC'); // down arrow = DESC
});

test('audit log expand/collapse works after sorting', async ({ page }) => {
  await page.goto('/settings/audit-log');
  await page.waitForTimeout(500);

  // Toggle sort to ASC
  await page.getByRole('columnheader', { name: /Timestamp/ }).click();
  await page.waitForTimeout(300);

  // Click first data row to expand details (if details exist)
  const firstRow = page.locator('tbody tr').first();
  const showLink = firstRow.locator('text=Show');
  if (await showLink.isVisible()) {
    await firstRow.click();
    // Verify detail row appeared
    await expect(page.locator('text=Old Value').or(page.locator('text=New Value')).first()).toBeVisible();
    // Click again to collapse
    await firstRow.click();
  }
});
```

### Step 4.3 -- Run Affected Tests

```bash
# Run only the settings E2E tests
npx playwright test e2e-tests/settings.spec.ts --reporter=list
```

Expected: All existing tests pass, plus the two new tests pass.

---

## Phase 5: Verification & Completion

### Step 5.1 -- Update Feature Doc

1. Check off all acceptance criteria in `docs/features/audit-log-timestamp-sort.md`:
   - [x] AC-1: Clicking the Timestamp column header toggles sort order (covered by E2E test "timestamp sort toggles order on click")
   - [x] AC-2: Visual sort indicator appears (covered by same E2E test asserting arrow text)
   - [x] AC-3: Default sort order is descending (covered by E2E test checking initial arrow is down)
   - [x] AC-4: Other columns are not sortable (verified by code review -- no click handlers on other `<th>` elements)
   - [x] AC-5: Expand/collapse works after sorting (covered by E2E test "expand/collapse works after sorting")
2. Fill in Test Coverage section with actual test names and AC mappings
3. Fill in Test Map Entries section
4. Set Status to "Implemented"

### Step 5.2 -- Run Full Test Suite

```bash
# Full API test suite
python3 -m pytest api-tests/ -v --tb=short

# Full E2E test suite
npx playwright test --reporter=list
```

Expected: All 86+ API tests and 24+ E2E tests pass with no regressions.

### Step 5.3 -- Final Checklist

- [x] Impact Assessment completed (Phase 1) -- L1/Low/Auto-approve
- [x] Feature doc created with all ACs (Phase 2)
- [x] Dependency graph update NOT needed (Phase 2.2) -- no new tables/routers/paths
- [x] Code implemented (Phase 3) -- single file, 4 edits
- [x] Test map update NOT needed (Phase 3.2) -- existing mapping sufficient
- [ ] API tests: N/A (no backend changes)
- [x] E2E tests written and passing (Phase 4.2) -- 2 new tests
- [x] Feature doc status set to "Implemented" (Phase 5.1)
- [x] Full test suite passing (Phase 5.2)

---

## Summary of All File Changes

| File | Action | Description |
|------|--------|-------------|
| `frontend/src/app/(sidebar)/settings/audit-log/page.tsx` | Modify | Add sortOrder state, sortedEntries computation, clickable Timestamp header with indicator, use sortedEntries in render |
| `e2e-tests/settings.spec.ts` | Modify | Add 2 new E2E tests for sort toggle and expand/collapse after sort |
| `docs/features/audit-log-timestamp-sort.md` | Create | New feature doc per workflow requirement |

**Total files changed**: 2 modified, 1 created
**Lines of code added**: ~25 (frontend) + ~30 (E2E tests) = ~55
**Lines of code removed**: ~3 (replaced static `<th>` and `entries.map`)
