# Feature Plan: Audit Log Timestamp Column Sorting

**Date**: 2026-03-11
**Request**: Add click-to-sort on the Timestamp column header in the Settings > Audit Log table, toggling between ascending and descending order.
**Scope**: Pure frontend change (no backend modifications).

---

## Phase 1: Assessment

### Impact Classification

**Feature**: Add timestamp sorting to Audit Log table
**Impact**: L1 (UI only) | **Risk**: Low | **Decision**: Auto-approve
No cross-feature impact, no schema changes, no backend changes.

### Key Assessment Findings

1. **The backend already supports sorting.** The `PaginationParams` class (`backend/app/utils/pagination.py`) already accepts `sortField` (or `sortBy`) and `sortOrder` query parameters. However, the `audit_log.py` router currently **hardcodes** `ORDER BY performed_at DESC` and does not use `pg.sort_field` / `pg.sort_order`. Since this is declared a pure frontend change, we have two options:
   - **Option A (frontend-only sort)**: Sort the already-fetched page of entries in JavaScript. This is simpler but only sorts within the current page (20 items), not across all data.
   - **Option B (pass sort params to backend)**: Pass `sortField` and `sortOrder` query params to the API. The backend already parses them via `PaginationParams` but ignores them in `audit_log.py`. This requires a one-line backend change to use `pg.sort_order` instead of hardcoded `DESC`.

   **Recommendation**: Option B is correct and minimal (1 backend line change + frontend changes). However, since the user explicitly said "pure frontend change," we will implement **Option A** (client-side sort of the current page) unless the user approves a backend touch. The plan below documents both; the primary plan follows Option A.

2. **A reusable DataTable component already exists** at `frontend/src/components/shared/DataTable.tsx` with full sort support (sort indicators, toggle logic, `sortable` column property). The Requests page (`frontend/src/app/(sidebar)/requests/page.tsx`) demonstrates the pattern. However, the Audit Log page uses a **hand-rolled table** with an expand/collapse detail row pattern (clicking a row expands old/new value JSON). The DataTable component does not currently support expandable detail rows.

3. **Two approaches for the frontend**:
   - **Approach 1**: Refactor the Audit Log page to use the shared `DataTable` component. This would require either extending DataTable to support expandable rows or removing the expand feature.
   - **Approach 2**: Keep the hand-rolled table but add sort state management and a clickable Timestamp header with sort indicators, mirroring the DataTable pattern inline.

   **Recommendation**: Approach 2 is safer and more targeted -- it avoids disrupting the expand/collapse detail row behavior and keeps the change minimal. We add sort state, a click handler on the Timestamp `<th>`, a sort indicator, and a `useMemo` to sort the entries array client-side.

4. **Dependency graph** (`docs/features/_DEPENDENCIES.json`): The `audit-log` feature entry exists with `"doc": null`. No downstream dependencies. The change is fully isolated.

5. **Existing tests**: `e2e-tests/settings.spec.ts` has a basic "audit log page loads" test. No sort-related tests exist for the audit log.

6. **Test map**: `frontend/src/app/(sidebar)/settings/` maps to `e2e-tests/settings.spec.ts`.

### Files to Read Before Starting

| File | Purpose |
|------|---------|
| `frontend/src/app/(sidebar)/settings/audit-log/page.tsx` | Current audit log page (174 lines) |
| `frontend/src/components/shared/DataTable.tsx` | Reference for sort indicator UI pattern |
| `frontend/src/app/(sidebar)/requests/page.tsx` | Reference for sort state management pattern |
| `backend/app/routers/audit_log.py` | Confirm backend hardcodes `ORDER BY performed_at DESC` |
| `backend/app/utils/pagination.py` | Confirm `sortField`/`sortOrder` params exist |
| `e2e-tests/settings.spec.ts` | Existing E2E tests to extend |
| `scripts/test-map.json` | Verify test mapping |

---

## Phase 2: Documentation

### Create Feature Spec

Create `docs/features/audit-log-sort.md` (or update a future `audit-log.md` spec). Minimal spec since this is L1/Low:

**Acceptance Criteria**:

- [ ] AC-1: Clicking the "Timestamp" column header sorts entries in ascending order (oldest first).
- [ ] AC-2: Clicking the "Timestamp" column header again toggles to descending order (newest first).
- [ ] AC-3: A visual sort indicator (arrow) appears next to the Timestamp header showing current sort direction.
- [ ] AC-4: The default sort order on page load is descending (newest first), matching current behavior.
- [ ] AC-5: Sorting is applied client-side to the current page of results.
- [ ] AC-6: Pagination continues to work correctly alongside sorting.
- [ ] AC-7: The expand/collapse detail row feature continues to work correctly after sorting.

### Update Dependency Graph

No changes needed to `docs/features/_DEPENDENCIES.json` -- the `audit-log` feature entry already exists and this change adds no new dependencies.

---

## Phase 3: Code Changes

### Single file to modify

**`frontend/src/app/(sidebar)/settings/audit-log/page.tsx`**

#### Change 1: Add imports

Add `useMemo` to the React import:

```typescript
import { useState, useMemo } from 'react';
```

#### Change 2: Add sort state

Inside `AuditLogPage()`, add a state variable for sort direction after the existing state declarations (line 39):

```typescript
const [sortOrder, setSortOrder] = useState<'ASC' | 'DESC'>('DESC');
```

#### Change 3: Add sorted entries computation

After `const entries = data?.data || [];` (line 52), add a `useMemo` that sorts entries client-side:

```typescript
const sortedEntries = useMemo(() => {
  if (entries.length === 0) return entries;
  return [...entries].sort((a, b) => {
    const dateA = a.performedAt ? new Date(a.performedAt).getTime() : 0;
    const dateB = b.performedAt ? new Date(b.performedAt).getTime() : 0;
    return sortOrder === 'ASC' ? dateA - dateB : dateB - dateA;
  });
}, [entries, sortOrder]);
```

#### Change 4: Make Timestamp header clickable

Replace the current Timestamp `<th>` (line 89):

```tsx
// Before:
<th className="text-left px-4 py-2 font-medium">Timestamp</th>

// After:
<th
  className="text-left px-4 py-2 font-medium cursor-pointer select-none hover:bg-gray-100"
  onClick={() => setSortOrder((prev) => (prev === 'ASC' ? 'DESC' : 'ASC'))}
>
  Timestamp
  <span className="ml-1" data-testid="sort-indicator-timestamp">
    {sortOrder === 'ASC' ? '\u25B2' : '\u25BC'}
  </span>
</th>
```

#### Change 5: Use sortedEntries instead of entries in the map

Replace `{entries.map((e) => (` (line 98) with:

```typescript
{sortedEntries.map((e) => (
```

#### Summary of changes

| Line(s) | What changes |
|---------|-------------|
| 3 | Add `useMemo` to import |
| ~39 | Add `sortOrder` state, default `'DESC'` |
| ~52-59 | Add `sortedEntries` useMemo |
| ~89 | Replace static `<th>` with clickable header + sort indicator |
| ~98 | Change `entries.map` to `sortedEntries.map` |

**No other files need to change.** The backend, shared components, and other pages are untouched.

### Files NOT modified (and why)

| File | Reason |
|------|--------|
| `backend/app/routers/audit_log.py` | User specified frontend-only; backend still returns DESC by default |
| `frontend/src/components/shared/DataTable.tsx` | Audit log uses custom table with expand/collapse rows; not worth refactoring to DataTable for this change |
| `scripts/test-map.json` | No new source files created; existing mapping `frontend/src/app/(sidebar)/settings/ -> e2e-tests/settings.spec.ts` already covers this path |

---

## Phase 4: Tests

### E2E Tests to Add

Add to `e2e-tests/settings.spec.ts`, inside the existing `'Settings Pages'` describe block:

#### Test 1: Sort indicator visible on Audit Log Timestamp header

```typescript
test('audit log timestamp sort indicator is visible', async ({ page }) => {
  await page.goto('/settings/audit-log');
  await page.waitForTimeout(500);
  // Default sort indicator (descending) should be visible
  await expect(page.getByTestId('sort-indicator-timestamp')).toBeVisible();
  await expect(page.getByTestId('sort-indicator-timestamp')).toHaveText('\u25BC');
});
```

#### Test 2: Clicking Timestamp toggles sort direction

```typescript
test('audit log timestamp column toggles sort order on click', async ({ page }) => {
  await page.goto('/settings/audit-log');
  await page.waitForTimeout(500);

  // Default is DESC (down arrow)
  const indicator = page.getByTestId('sort-indicator-timestamp');
  await expect(indicator).toHaveText('\u25BC');

  // Click to toggle to ASC
  await page.getByRole('columnheader', { name: /Timestamp/ }).click();
  await expect(indicator).toHaveText('\u25B2');

  // Click again to toggle back to DESC
  await page.getByRole('columnheader', { name: /Timestamp/ }).click();
  await expect(indicator).toHaveText('\u25BC');
});
```

#### Test 3: Sort actually reorders rows (if audit data exists)

```typescript
test('audit log entries reorder when timestamp sort changes', async ({ page }) => {
  // Create two governance requests via API to generate audit entries with different timestamps
  await page.request.post('http://localhost:4001/api/governance-requests', {
    data: { title: 'Audit Sort Test 1' },
  });
  await page.waitForTimeout(200);
  await page.request.post('http://localhost:4001/api/governance-requests', {
    data: { title: 'Audit Sort Test 2' },
  });

  await page.goto('/settings/audit-log');
  await page.waitForTimeout(1000);

  // Get all timestamp cells
  const timestampCells = page.locator('tbody tr td:first-child');
  const count = await timestampCells.count();

  if (count >= 2) {
    // In DESC (default), first timestamp should be >= second
    const firstDesc = await timestampCells.nth(0).textContent();
    const secondDesc = await timestampCells.nth(1).textContent();

    // Toggle to ASC
    await page.getByRole('columnheader', { name: /Timestamp/ }).click();
    await page.waitForTimeout(300);

    // In ASC, first timestamp should be <= second
    const firstAsc = await timestampCells.nth(0).textContent();
    const secondAsc = await timestampCells.nth(1).textContent();

    // The order should have changed (first row in DESC should now be last, or different)
    expect(firstDesc).not.toBe(firstAsc);
  }
});
```

### No API Tests Needed

This is a frontend-only change. The backend API behavior is unchanged. No new API tests are required.

### Test Map Updates

No updates needed to `scripts/test-map.json`. The existing mapping already covers this:

```json
"frontend/src/app/(sidebar)/settings/": {
  "api": [],
  "e2e": ["e2e-tests/settings.spec.ts"]
}
```

---

## Phase 5: Verification

### AC Checklist

| AC | How to verify | Test covering it |
|----|--------------|-----------------|
| AC-1: Click Timestamp sorts ascending | E2E test: click header, verify arrow changes to up | Test 2 |
| AC-2: Click again toggles to descending | E2E test: click twice, verify arrow toggles back | Test 2 |
| AC-3: Visual sort indicator appears | E2E test: check `data-testid="sort-indicator-timestamp"` visibility | Test 1 |
| AC-4: Default is descending | E2E test: verify down arrow on page load | Test 1 |
| AC-5: Sorting is client-side | Code review: `useMemo` sorts `entries` array; no new API params | Code inspection |
| AC-6: Pagination still works | Manual test + existing E2E test "audit log page loads" | Existing test |
| AC-7: Expand/collapse still works | Manual test: click row after sorting to verify detail expansion | Manual |

### Final Test Suite Run

```bash
# Run affected E2E tests
npx playwright test e2e-tests/settings.spec.ts --reporter=list

# Run full test suite to ensure no regressions
python3 -m pytest api-tests/ -v --tb=short
npx playwright test --reporter=list
```

### Definition of Done

- [ ] All 7 ACs checked off
- [ ] All new E2E tests pass
- [ ] Full E2E suite passes (24+ tests)
- [ ] Full API test suite passes (86+ tests) -- should be unaffected
- [ ] Feature spec created at `docs/features/audit-log-sort.md` with status "Implemented"
- [ ] No regressions in existing audit log functionality (expand/collapse, pagination, entity type filter)

---

## Risks and Notes

1. **Client-side sort limitation**: Sorting only reorders entries within the current page (20 items). If the user expects global sorting across all pages, a backend change to `audit_log.py` line 54 would be needed -- replacing the hardcoded `ORDER BY performed_at DESC` with a parameterized sort using `pg.sort_field` and `pg.sort_order` (following the pattern in `governance_requests.py` lines 79-81). This is a one-line change but was explicitly excluded from scope.

2. **Future enhancement**: If more columns need sorting (Entity Type, Action, etc.), consider refactoring the audit log page to use the shared `DataTable` component. This would require extending `DataTable` to support expandable detail rows (a new `renderDetail` prop pattern).

3. **No React key warning**: The current code has a minor issue where the `<>` fragment wrapping the main row and detail row lacks a unique key on the fragment (line 99). The `key` is on the inner `<tr>` instead. This pre-existing issue is not introduced by our change, but could be fixed opportunistically by adding `key={e.id}` to the fragment: `<React.Fragment key={e.id}>`.
