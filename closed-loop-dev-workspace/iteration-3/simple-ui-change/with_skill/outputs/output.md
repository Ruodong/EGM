# Closed-Loop Feature Development Plan

**Task**: 在 audit log 列表页面，支持按时间戳排序（点击列头升序/降序切换），默认降序
**Translation**: On the audit log list page, support sorting by timestamp (click column header to toggle ascending/descending), default descending order.
**Date**: 2026-03-11
**Model**: claude-sonnet-4-6

---

## Phase 1: Impact Assessment

### Step 1.0 — Understand & Explore

**What is being changed?**
The audit log list page (`/settings/audit-log`) currently renders a hand-coded HTML `<table>` with a hardcoded `ORDER BY performed_at DESC` in the backend. The request is to make the `Timestamp` column header clickable to toggle sort direction (ascending/descending), defaulting to descending.

**Exploration of existing code:**

**Backend** (`backend/app/routers/audit_log.py`):
- The `list_audit_entries` endpoint uses `PaginationParams` (which already exposes `sort_field` and `sort_order` query params via `sortField`/`sortOrder`/`sortBy`) but does NOT currently pass them to the SQL query — the ORDER BY is hardcoded: `ORDER BY performed_at DESC`.
- The `governance_requests.py` router shows the established pattern: define `ALLOWED_SORT` whitelist, read `pg.sort_field` and `pg.sort_order`, build dynamic `ORDER BY`.
- `PaginationParams` in `backend/app/utils/pagination.py` already accepts `sortField`, `sortBy`, and `sortOrder` query params.

**Frontend** (`frontend/src/app/(sidebar)/settings/audit-log/page.tsx`):
- The page is currently a hand-rolled table component — it does NOT use the shared `DataTable` component.
- The `requests/page.tsx` demonstrates the full pattern: `useState` for `sortField`/`sortOrder`, `handleSort` callback, `DataTable` with `sortField`/`sortOrder`/`onSort` props, and column definitions with `sortable: true`.
- The shared `DataTable` component (`frontend/src/components/shared/DataTable.tsx`) already handles click-to-sort column headers, sort direction indicators (▲/▼/⇅), and the `onSort` callback pattern.

**Implementation approach options:**

Option A — Minimal: Keep the hand-coded table, add click handler to the Timestamp `<th>` only, add `sortOrder` state, pass `sort_order` query param to API. Requires backend change only for that one column.

Option B — Refactor to DataTable (recommended): Replace the hand-coded `<table>` with the shared `DataTable` component. Aligns with the project's established pattern (requests page uses DataTable), enables future sortable columns, and requires less custom code. The expanded detail rows (show/hide old/new value) need special handling since `DataTable` does not natively support expandable rows — this can be achieved by keeping a custom `renderExpandedRow` approach or using a wrapper.

Option C — Hybrid: Wire sort state + API params with minimal HTML change, using the same header-click pattern as `DataTable` but keeping the existing markup for the expand behavior.

**Decision**: Option A is the most surgical change for this specific task (timestamp-sort only), introduces no structural refactor risk to the expand-row feature, and is fully consistent with the L1 classification below. The backend change is a pure addition (the sort column whitelist + dynamic ORDER BY), with no API shape change since `sortField`/`sortOrder` are already standard PaginationParams query params.

---

### Step 1.1 — Gather Context

From `_DEPENDENCIES.json`:
- Feature `audit-log`: tables `["audit_log"]`, routers `["audit_log.py"]`, frontendPaths `["frontend/src/app/(sidebar)/settings/audit-log/"]`
- `audit_log` table is in `sharedTables` and also used by `governance-requests` and `domain-dispatch`, but the change only touches how the audit log router READS and sorts its own data — it does not alter any writes, schema, or data shape consumed by other features.
- No feature doc currently exists for `audit-log` (`"doc": null` in dependencies graph). One will be created.

**Connected feature doc check:**
- `governance-requests.md`: The `audit_log` table appears in this feature's table list (writes to it via `write_audit`). The change here is read-only sorting of audit log entries — no impact to write paths or governance request behavior.
- `domain-dispatch` similarly only writes to `audit_log`. No impact.

---

### Step 1.2 — Classify Impact Level

**L1 — UI/interaction only.**

Rationale:
- The backend change is a one-line addition to the SQL ORDER BY clause inside `audit_log.py`, using the already-existing `PaginationParams.sort_field`/`sort_order` infrastructure. The API response shape does not change. No new endpoint, no schema change.
- The frontend change adds `sortOrder` / `sortField` state and passes them as query params to an existing endpoint. The visual change is adding a clickable indicator on the Timestamp column header.
- No router file is being added, no DB columns are being added.

The only reason this is not purely CSS is that the backend ORDER BY needs to respond to the new query param. However, since `PaginationParams` already exposes `sortField`/`sortOrder` and the response shape is unchanged, this is effectively a UI-driven interaction change backed by a trivially small backend query-param hook-up.

---

### Step 1.3 — Classify Risk Level

**Low.**

Rationale:
- No migration script required — no schema change.
- The API response shape is unchanged (same fields, same paginated structure).
- Existing consumers (other features) do not call `/audit-log` — this endpoint is used only by the audit log page.
- The behavior change is purely additive: adding `sortField`/`sortOrder` query params that were previously ignored. The default behavior (when params are absent, ORDER BY performed_at DESC) is preserved.
- No FK relationships, no status lifecycle, no RBAC permissions are affected.

---

### Step 1.4 — Decision Matrix

| Risk \ Impact | L1 (UI only) |
|---|---|
| **Low** | **Auto-approve** |

**Decision: Auto-approve. Proceed to Phase 2 immediately.**

---

### Step 1.5 — Output Assessment (Compact Format)

```
## Impact Assessment
**Feature**: audit-log (timestamp sort) | **Impact**: L1 | **Risk**: Low | **Decision**: Auto-approve
Backend: add sort column whitelist + dynamic ORDER BY to audit_log.py (1 param already in PaginationParams).
Frontend: add sortField/sortOrder state + clickable Timestamp column header on audit-log page.
No schema change, no API shape change, no other features affected.
```

---

## Phase 2: Feature Documentation

### Step 2.1 — Feature Doc

**File**: `docs/features/audit-log.md` (create new — no existing doc)

---

```markdown
# Feature: Audit Log — Timestamp Sort

**Status**: Draft
**Date**: 2026-03-11
**Spec Version**: 1

## Impact Assessment

**Feature**: audit-log (timestamp sort) | **Impact**: L1 | **Risk**: Low | **Decision**: Auto-approve
Backend: add sort column whitelist + dynamic ORDER BY to audit_log.py using existing PaginationParams infrastructure.
Frontend: add sortField/sortOrder state + clickable Timestamp column header on audit-log page.
No schema change, no API shape change, no other features affected.

## Summary

The audit log list page (`/settings/audit-log`) displays system activity entries. This feature adds clickable
column header sorting for the Timestamp column, allowing users to toggle ascending/descending order.
Default sort is descending (most recent first).

## Affected Files

### Backend
- `backend/app/routers/audit_log.py` — Add ALLOWED_SORT whitelist; replace hardcoded ORDER BY with
  dynamic sort using PaginationParams.sort_field and sort_order.

### Frontend
- `frontend/src/app/(sidebar)/settings/audit-log/page.tsx` — Add sortOrder/sortField state; pass sort
  params to API query; make Timestamp column header clickable with sort direction indicator.

### Database
- None (no schema changes).

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/audit-log` | List audit entries with optional sorting via `sortField` and `sortOrder` query params (already present in PaginationParams, previously ignored). |

### Query Parameters (unchanged shape, new behavior)

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `sortField` | string | `performed_at` | Column to sort by. Only `performed_at` is accepted (whitelisted). |
| `sortOrder` | `ASC` \| `DESC` | `DESC` | Sort direction. |
| `entity_type` | string | — | Existing filter (unchanged). |
| `action` | string | — | Existing filter (unchanged). |
| `performed_by` | string | — | Existing filter (unchanged). |
| `page` | int | 1 | Existing pagination (unchanged). |
| `pageSize` | int | 20 | Existing pagination (unchanged). |

## UI Behavior

1. On page load, the audit log table renders with the Timestamp column header showing a down-arrow (▼) indicator, indicating active descending sort.
2. The user clicks the Timestamp column header.
3. The sort direction toggles to ascending. The header now shows an up-arrow (▲) indicator.
4. The page resets to page 1 and the API is called with `sortField=performed_at&sortOrder=ASC`.
5. The table re-renders with entries sorted oldest-first.
6. Clicking the Timestamp header again toggles back to descending (▼), page resets to 1.
7. Clicking the Timestamp header on a page > 1 resets to page 1.
8. Other column headers (Entity Type, Entity ID, Action, Performed By, Details) are not sortable and have no click behavior.
9. The expand/collapse behavior for old/new value details is unaffected.
10. Entity type filter and pagination continue to work correctly in combination with sorting.

## Acceptance Criteria

- [ ] AC-1: The Timestamp column header is clickable and toggles sort direction between ASC and DESC.
- [ ] AC-2: On initial page load, the default sort is DESC (most recent first). The Timestamp header shows a ▼ indicator.
- [ ] AC-3: When sorted ASC, the Timestamp header shows a ▲ indicator and entries are ordered oldest-first.
- [ ] AC-4: Clicking the Timestamp header while on a page > 1 resets the page to 1.
- [ ] AC-5: The backend `GET /audit-log?sortField=performed_at&sortOrder=ASC` returns entries ordered ascending by `performed_at`.
- [ ] AC-6: The backend `GET /audit-log?sortField=performed_at&sortOrder=DESC` returns entries ordered descending by `performed_at`.
- [ ] AC-7: When `sortField` is absent or set to an unsupported value, the backend falls back to `performed_at DESC` (safe default).
- [ ] AC-8: Existing filters (entity_type, action, performed_by) continue to work correctly in combination with sort params.
- [ ] AC-9: Pagination (page, pageSize) continues to work correctly in combination with sort params.
- [ ] AC-10: The expand/collapse behavior for old/new value detail rows is unaffected.

## Test Coverage

### API Tests
- `api-tests/test_dashboard.py::test_audit_log_sort_asc` — covers AC-5, AC-7
- `api-tests/test_dashboard.py::test_audit_log_sort_desc` — covers AC-6
- `api-tests/test_dashboard.py::test_audit_log_sort_with_filter` — covers AC-8
- `api-tests/test_dashboard.py::test_audit_log_invalid_sort_field_fallback` — covers AC-7

### E2E Tests
- `e2e-tests/settings.spec.ts` — "audit log timestamp column is sortable" covers AC-1, AC-2, AC-3
- `e2e-tests/settings.spec.ts` — "audit log sort resets to page 1" covers AC-4

## Test Map Entries

```
backend/app/routers/audit_log.py -> api-tests/test_dashboard.py  (already mapped)
frontend/src/app/(sidebar)/settings/ -> e2e-tests/settings.spec.ts  (already mapped)
```

No new test-map.json entries required — both mappings already exist.

## Notes

- The audit log page currently uses a hand-rolled `<table>` instead of the shared `DataTable` component.
  A full refactor to `DataTable` is out of scope for this task because the page has expandable detail rows
  (old/new value JSON display) that `DataTable` does not natively support. The sort feature is implemented
  by adding targeted state + a click handler to the Timestamp `<th>` only, consistent with the existing
  page structure.
- Only `performed_at` is whitelisted for sorting in the backend ALLOWED_SORT set, since that is the only
  column the UI exposes as sortable. Future columns can be added to the whitelist when needed.
- The `PaginationParams` utility already accepts `sortField` and `sortOrder` as query params — no
  changes to `pagination.py` are needed.
```

---

### Step 2.2 — Update Dependency Graph

No new tables, routers, or frontend paths are introduced. The existing `audit-log` entry in `_DEPENDENCIES.json` should have its `"doc"` field updated from `null` to `"docs/features/audit-log.md"`:

```json
"audit-log": {
  "doc": "docs/features/audit-log.md",
  "tables": ["audit_log"],
  "routers": ["audit_log.py"],
  "frontendPaths": [
    "frontend/src/app/(sidebar)/settings/audit-log/"
  ]
}
```

No new `edges` or `sharedTables` changes are required.

---

## Phase 3: Implementation Strategy

### Step 3.0 — Implementation Strategy

This is an L1 change with contained blast radius. No phased delivery plan is required. The two changes (backend + frontend) are independent and can be implemented in either order.

### Step 3.1 — Write Code

#### Backend: `backend/app/routers/audit_log.py`

Current state: `ORDER BY performed_at DESC` is hardcoded; `PaginationParams` is imported but `sort_field`/`sort_order` are never read.

Changes needed:
1. Add `ALLOWED_SORT = {"performed_at"}` constant (mirrors the pattern in `governance_requests.py`).
2. In `list_audit_entries`, replace the hardcoded sort with:
   ```python
   sort_col = pg.sort_field if pg.sort_field in ALLOWED_SORT else "performed_at"
   sort_dir = "ASC" if pg.sort_order and pg.sort_order.upper() == "ASC" else "DESC"
   ```
3. Update the SQL query to use `ORDER BY {sort_col} {sort_dir}` (using f-string injection of whitelisted column only — safe because ALLOWED_SORT is a hardcoded set, not user input).

Full updated router function signature stays the same; no new query params needed since `PaginationParams` already handles `sortField`/`sortOrder`.

#### Frontend: `frontend/src/app/(sidebar)/settings/audit-log/page.tsx`

Current state: Static `<th>Timestamp</th>`, no sort state.

Changes needed:
1. Add state:
   ```tsx
   const [sortOrder, setSortOrder] = useState<'ASC' | 'DESC'>('DESC');
   ```
   (Only one sortable column, so no `sortField` state needed — `performed_at` is always the sort field.)

2. Update `queryKey` to include `sortOrder`:
   ```tsx
   queryKey: ['audit-log', entityType, page, sortOrder],
   ```

3. Update `queryFn` to pass sort params:
   ```tsx
   params.set('sortField', 'performed_at');
   params.set('sortOrder', sortOrder);
   ```

4. Add `handleTimestampSort` callback:
   ```tsx
   const handleTimestampSort = () => {
     setSortOrder((prev) => (prev === 'DESC' ? 'ASC' : 'DESC'));
     setPage(1);
   };
   ```

5. Update the Timestamp `<th>` to be clickable with a sort indicator:
   ```tsx
   <th
     className="text-left px-4 py-2 font-medium cursor-pointer select-none hover:bg-gray-100"
     onClick={handleTimestampSort}
   >
     Timestamp
     <span className="ml-1" data-testid="sort-indicator-performed_at">
       {sortOrder === 'ASC' ? '▲' : '▼'}
     </span>
   </th>
   ```

### Step 3.2 — Update Test Map

No new source files are created. Both existing mappings already cover the modified files:

```json
"backend/app/routers/audit_log.py": {
  "api": ["api-tests/test_dashboard.py"],
  "e2e": []
},
"frontend/src/app/(sidebar)/settings/": {
  "api": [],
  "e2e": ["e2e-tests/settings.spec.ts"]
}
```

**No changes to `scripts/test-map.json` are required.**

### Step 3.3 — Automatic Verification

After editing `backend/app/routers/audit_log.py`, the PostToolUse hook will automatically run:
```
api-tests/test_dashboard.py
```

After editing `frontend/src/app/(sidebar)/settings/audit-log/page.tsx`, the PostToolUse hook will automatically run:
```
e2e-tests/settings.spec.ts
```

---

## Phase 4: Testing

### Step 4.1 — API Tests

File: `api-tests/test_dashboard.py` (append new test functions)

**Test: `test_audit_log_sort_desc`** — covers AC-6
```python
def test_audit_log_sort_desc(client: httpx.Client):
    """GET /audit-log with sortOrder=DESC returns entries ordered descending by performed_at."""
    resp = client.get("/audit-log?sortOrder=DESC&pageSize=50")
    assert resp.status_code == 200
    data = resp.json()["data"]
    timestamps = [e["performedAt"] for e in data if e["performedAt"]]
    # Verify descending order
    assert timestamps == sorted(timestamps, reverse=True), \
        "Entries should be sorted DESC by performedAt"
```

**Test: `test_audit_log_sort_asc`** — covers AC-5
```python
def test_audit_log_sort_asc(client: httpx.Client):
    """GET /audit-log with sortField=performed_at&sortOrder=ASC returns entries ascending."""
    resp = client.get("/audit-log?sortField=performed_at&sortOrder=ASC&pageSize=50")
    assert resp.status_code == 200
    data = resp.json()["data"]
    timestamps = [e["performedAt"] for e in data if e["performedAt"]]
    # Verify ascending order
    assert timestamps == sorted(timestamps), \
        "Entries should be sorted ASC by performedAt"
```

**Test: `test_audit_log_invalid_sort_field_fallback`** — covers AC-7
```python
def test_audit_log_invalid_sort_field_fallback(client: httpx.Client):
    """GET /audit-log with an unsupported sortField falls back to performed_at DESC."""
    resp = client.get("/audit-log?sortField=malicious_col&sortOrder=ASC&pageSize=50")
    assert resp.status_code == 200
    data = resp.json()["data"]
    timestamps = [e["performedAt"] for e in data if e["performedAt"]]
    # Should fall back to DESC (default), not ASC
    assert timestamps == sorted(timestamps, reverse=True), \
        "Invalid sortField should fall back to performed_at DESC"
```

**Test: `test_audit_log_sort_with_filter`** — covers AC-8
```python
def test_audit_log_sort_with_filter(client: httpx.Client):
    """Sort and filter can be combined: entity_type filter + sortOrder=ASC."""
    resp = client.get("/audit-log?entity_type=governance_request&sortOrder=ASC&pageSize=50")
    assert resp.status_code == 200
    body = resp.json()
    assert "data" in body
    data = body["data"]
    # All returned entries have the correct entity type
    for entry in data:
        assert entry["entityType"] == "governance_request"
    # Entries are ascending
    timestamps = [e["performedAt"] for e in data if e["performedAt"]]
    assert timestamps == sorted(timestamps), \
        "Filter + sort ASC should return filtered entries in ascending order"
```

### Step 4.2 — E2E Tests

File: `e2e-tests/settings.spec.ts` (append to existing `Settings Pages` describe block)

**Test: "audit log timestamp column is sortable"** — covers AC-1, AC-2, AC-3
```typescript
test('audit log timestamp column is sortable', async ({ page }) => {
  await page.goto('/settings/audit-log');
  await page.waitForTimeout(800); // wait for data load

  // AC-2: Default sort is DESC — header should show ▼
  const timestampHeader = page.locator('th', { hasText: 'Timestamp' });
  await expect(timestampHeader).toBeVisible();
  await expect(timestampHeader.locator('[data-testid="sort-indicator-performed_at"]')).toHaveText('▼');

  // AC-1: Click header to toggle to ASC
  await timestampHeader.click();
  await page.waitForTimeout(500);

  // AC-3: After click, header shows ▲
  await expect(timestampHeader.locator('[data-testid="sort-indicator-performed_at"]')).toHaveText('▲');
});
```

**Test: "audit log sort resets to page 1"** — covers AC-4
```typescript
test('audit log sort resets to page 1', async ({ page }) => {
  await page.goto('/settings/audit-log');
  await page.waitForTimeout(800);

  // Navigate to a later page if pagination is present
  const nextBtn = page.locator('button', { hasText: 'Next' });
  const isNextVisible = await nextBtn.isVisible();
  if (isNextVisible && !(await nextBtn.isDisabled())) {
    await nextBtn.click();
    await page.waitForTimeout(500);
    // Verify we are on page 2
    await expect(page.locator('text=Page 2')).toBeVisible();

    // Click Timestamp header to sort — should reset to page 1
    await page.locator('th', { hasText: 'Timestamp' }).click();
    await page.waitForTimeout(500);
    await expect(page.locator('text=Page 1')).toBeVisible();
  } else {
    // Single page — just verify sort toggle works without error
    await page.locator('th', { hasText: 'Timestamp' }).click();
    await page.waitForTimeout(500);
    await expect(page.locator('h1, h2, [class*="title"]').first()).toBeVisible();
  }
});
```

### Step 4.3 — Run Affected Tests

After implementation:

```bash
# Backend API tests
python3 -m pytest api-tests/test_dashboard.py -v --tb=short

# Frontend E2E tests
npx playwright test e2e-tests/settings.spec.ts --reporter=list
```

---

## Phase 5: Verification & Completion

### Step 5.1 — Update Feature Doc

After all tests pass, update `docs/features/audit-log.md`:

1. Check off all ACs:
   - [x] AC-1 through AC-10 (all covered by tests above)
2. Fill in the Test Coverage section with actual test function names.
3. Set Status to "Implemented".

### Step 5.2 — Run Full Test Suite

```bash
python3 -m pytest api-tests/ -v --tb=short    # 86+ API tests (expect 90+ after new tests added)
npx playwright test --reporter=list            # 24+ E2E tests (expect 26+ after new tests added)
```

### Step 5.3 — Final Checklist

- [x] Impact Assessment completed (Phase 1) — L1 / Low Risk / Auto-approved
- [x] Feature doc created (`docs/features/audit-log.md`) with all 10 ACs (Phase 2)
- [x] Dependency graph doc pointer updated (`"doc": "docs/features/audit-log.md"`) (Phase 2.2)
- [ ] Backend: `audit_log.py` — ALLOWED_SORT + dynamic ORDER BY (Phase 3)
- [ ] Frontend: `audit-log/page.tsx` — sortOrder state + clickable Timestamp header (Phase 3)
- [x] Test map: no changes required — existing mappings cover both modified files (Phase 3.2)
- [ ] API tests: 4 new test functions in `test_dashboard.py` written and passing (Phase 4.1)
- [ ] E2E tests: 2 new test cases in `settings.spec.ts` written and passing (Phase 4.2)
- [ ] Feature doc status set to "Implemented" (Phase 5.1)
- [ ] Full test suite passing — 90+ API + 26+ E2E (Phase 5.2)

---

## Summary

This is a minimal, well-contained L1/Low-risk change. The infrastructure is almost entirely already in place:

- `PaginationParams` already accepts `sortField`/`sortOrder` — no utility change needed.
- The established sort pattern (ALLOWED_SORT + dynamic ORDER BY) is already proven in `governance_requests.py`.
- The shared `DataTable` component handles sort indicators, but the audit log page keeps its hand-coded table to preserve the expand-row behavior — instead, a targeted `<th>` click handler is added with a matching `data-testid` for E2E assertions.
- No schema change, no migration, no new files, no test-map update — just two file edits and four new test functions.

**Estimated change size**: ~15 lines of backend code, ~20 lines of frontend code, ~60 lines of new tests.
