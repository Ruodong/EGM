# Implementation Plan: Urgency Field for Governance Requests

## 1. Overview

Add an `urgency` field (`urgent` / `normal`) to governance requests. The field is settable during create and edit, influences dispatch priority, and is visually surfaced as a badge on domain reviewer interfaces.

This is a **cross-feature change** touching three feature boundaries:
- **governance-requests** -- new DB column, API contract changes, create/edit forms, list/detail displays
- **domain-dispatch** -- dispatcher reads urgency to elevate dispatch priority
- **domain-dispatch (reviews UI)** -- domain reviewer pages show urgency badge

---

## 2. Impact Analysis

### 2.1 Features Affected

| Feature | Impact | Reason |
|---------|--------|--------|
| governance-requests | HIGH | New column, API contract change, form + display updates |
| domain-dispatch (dispatcher) | MEDIUM | Dispatcher must read urgency and pass priority hint to domain_review |
| domain-dispatch (reviews UI) | MEDIUM | Reviewer pages need urgency badge rendering |
| dashboard/reports | LOW | Optional: dashboard stats could break down by urgency |
| intake-scoping | NONE | No interaction with urgency |

### 2.2 Files Affected

#### Database
- `scripts/schema.sql` -- add `urgency` column to `governance_request` table definition
- New `scripts/migration_add_urgency.sql` -- ALTER TABLE migration for existing databases

#### Backend (Routers)
| File | Changes |
|------|---------|
| `backend/app/routers/governance_requests.py` | `_map()` adds `urgency`; `create_request` accepts + inserts `urgency`; `update_request` allows editing `urgency`; `list_requests` supports `urgency` filter param; `filter_options` returns distinct urgency values; `ALLOWED_SORT` adds `urgency` |
| `backend/app/routers/dispatcher.py` | `execute_dispatch` reads `urgency` from governance_request, stores it on created `domain_review` records (or passes it through as response data) |
| `backend/app/routers/domain_reviews.py` | `_map()` includes `urgency` from joined governance_request; `list_reviews` SQL joins urgency; per-review GET includes urgency |
| `backend/app/routers/progress.py` | Include `urgency` in progress response for display on detail page |
| `backend/app/routers/dashboard.py` | (Optional) Add urgency breakdown to dashboard stats |

#### Frontend (Pages & Components)
| File | Changes |
|------|---------|
| `frontend/src/app/governance/create/page.tsx` | Add urgency radio/select to create form (default: `normal`) |
| `frontend/src/app/governance/[requestId]/page.tsx` | Display urgency badge in header; add `urgency` to `GovRequest` interface |
| `frontend/src/app/(sidebar)/requests/page.tsx` | Add urgency column to DataTable; optionally add urgency filter |
| `frontend/src/app/(sidebar)/reviews/page.tsx` | Add urgency badge column to all-reviews table; update `DomainReview` interface |
| `frontend/src/app/governance/[requestId]/reviews/page.tsx` | Show urgency badge next to each domain review card |
| `frontend/src/app/governance/[requestId]/reviews/[domainCode]/page.tsx` | Show urgency badge in review detail header |
| `frontend/src/lib/constants.ts` | Add urgency color mapping (e.g., `Urgent: 'bg-red-500'`) |

#### Tests
| File | New/Modified Tests |
|------|-------------------|
| `api-tests/test_governance_requests.py` | New: `test_create_request_with_urgency`, `test_update_urgency`, `test_filter_by_urgency`, `test_default_urgency_is_normal` |
| `api-tests/test_dispatch.py` | New: `test_dispatch_urgent_request_sets_priority` |
| `api-tests/test_domain_reviews.py` | New: `test_review_includes_urgency_from_request` |
| `e2e-tests/governance-requests.spec.ts` | New: `test urgency selector on create form`, `test urgency badge on detail page` |

---

## 3. Database Changes

### 3.1 Schema Change

Add column to `governance_request`:

```sql
urgency VARCHAR NOT NULL DEFAULT 'normal'
```

Valid values: `'normal'`, `'urgent'`

The column is a simple VARCHAR (not an enum type) to match the existing pattern used for `status`, `priority`, and `overall_verdict` in this schema. A CHECK constraint can optionally be added.

### 3.2 Migration Script: `scripts/migration_add_urgency.sql`

```sql
-- Migration: Add urgency field to governance_request
-- Run against egm_local database (port 5433)

SET search_path TO egm;

-- Add urgency column with default 'normal'
ALTER TABLE governance_request
ADD COLUMN IF NOT EXISTS urgency VARCHAR NOT NULL DEFAULT 'normal';

-- Optional: add CHECK constraint for valid values
ALTER TABLE governance_request
ADD CONSTRAINT chk_urgency CHECK (urgency IN ('normal', 'urgent'));
```

### 3.3 Schema.sql Update

In `scripts/schema.sql`, add after the `priority` column:

```sql
urgency         VARCHAR NOT NULL DEFAULT 'normal',
```

### 3.4 Design Decision: No New Column on domain_review

Rather than denormalizing urgency onto `domain_review`, the reviewer UI will JOIN back to `governance_request.urgency`. This avoids data duplication and ensures urgency changes on the governance request are immediately reflected everywhere.

The dispatcher can still use urgency at dispatch time for priority-related logic (e.g., sorting domain review creation order or tagging metadata), but the source of truth remains `governance_request.urgency`.

---

## 4. Backend Changes

### 4.1 `governance_requests.py`

#### 4.1.1 `_map()` function (line ~20)

Add urgency to the mapping:

```python
"urgency": r.get("urgency", "normal"),
```

Insert after `"priority": r.get("priority"),` (line 33).

#### 4.1.2 `list_requests()` (line ~42)

Add `urgency` filter parameter:

```python
urgency: str | None = Query(None),
```

And the corresponding condition block:

```python
if urgency:
    conditions.append(multi_value_condition("gr.urgency", "urgency", urgency, params))
```

Add `"urgency"` to `ALLOWED_SORT` set (line 17).

#### 4.1.3 `filter_options()` (line ~98)

Add urgency to the returned filter options:

```python
urgencies = (await db.execute(
    text("SELECT DISTINCT urgency FROM governance_request ORDER BY urgency")
)).scalars().all()
return {"statuses": statuses, "priorities": priorities, "urgencies": urgencies}
```

#### 4.1.4 `create_request()` (line ~117)

Add urgency to INSERT SQL and parameter binding:

In the INSERT column list, add `urgency` after `priority`:
```sql
INSERT INTO governance_request (request_id, title, description, project_id,
    requestor, requestor_name, organization, status, priority, urgency, target_date, create_by, update_by)
VALUES (:request_id, :title, :description, :project_id,
    :requestor, :requestor_name, :organization, 'Draft', :priority, :urgency, :target_date, :create_by, :create_by)
```

Parameter:
```python
"urgency": body.get("urgency", "normal"),
```

Add validation before INSERT:
```python
urgency = body.get("urgency", "normal")
if urgency not in ("normal", "urgent"):
    raise HTTPException(status_code=400, detail="Invalid urgency value; must be 'normal' or 'urgent'")
```

#### 4.1.5 `update_request()` (line ~157)

Add urgency to the updatable fields loop:

```python
for field, col in [
    ("title", "title"), ("description", "description"),
    ("projectId", "project_id"), ("organization", "organization"),
    ("priority", "priority"), ("urgency", "urgency"),
    ("targetDate", "target_date"),
]:
```

Add validation:
```python
if "urgency" in body and body["urgency"] not in ("normal", "urgent"):
    raise HTTPException(status_code=400, detail="Invalid urgency value; must be 'normal' or 'urgent'")
```

### 4.2 `dispatcher.py`

#### 4.2.1 `execute_dispatch()` (line ~14)

After resolving the governance request UUID (line 18), also fetch the urgency:

```python
gr_row = (await db.execute(text(
    "SELECT id, urgency FROM governance_request WHERE request_id = :id OR id::text = :id"
), {"id": request_id})).mappings().first()
if not gr_row:
    raise HTTPException(status_code=404, detail="Governance request not found")
gr = gr_row["id"]
urgency = gr_row.get("urgency", "normal")
```

When creating domain_review records, if the request is urgent, we can order them by priority or include a note. The simplest useful behavior: include urgency in the response payload so the frontend can immediately display it:

```python
created.append({
    "id": str(row["id"]),
    "domainCode": row["domain_code"],
    "status": row["status"],
    "urgency": urgency,
})
```

**Priority elevation semantics**: The feature request says "dispatch priority should be elevated." The most practical implementation is:

1. The `domain_review` table does not currently have a `priority` column. Adding one would be an additional schema change. Instead, urgency is conveyed through the governance request itself.
2. The reviewer UI surfaces the urgency badge prominently, which is the primary mechanism for priority elevation -- reviewers see the badge and know to prioritize.
3. If future requirements need automated priority sorting, a `priority` column can be added to `domain_review` at that time.

**Alternative (more involved)**: Add a `dispatch_priority` column to `domain_review`:
```sql
ALTER TABLE domain_review ADD COLUMN dispatch_priority VARCHAR DEFAULT 'normal';
```
And set it to `'urgent'` during dispatch when the parent request has `urgency = 'urgent'`. This makes queries like "show me all urgent reviews" simpler without JOINs. This is deferred as optional scope.

### 4.3 `domain_reviews.py`

#### 4.3.1 `_map()` function (line ~16)

Add urgency to the result dict (only when available from JOIN):

```python
if "urgency" in r:
    result["urgency"] = r["urgency"]
```

#### 4.3.2 `list_reviews()` (line ~40)

Update the SELECT to include urgency from `governance_request`:

```sql
SELECT dr.*, dreg.domain_name, gr.request_id AS gov_request_id, gr.urgency
```

This requires no additional JOIN since `governance_request gr` is already joined.

#### 4.3.3 `get_review()` (line ~85)

Update the single-review GET to also fetch urgency via JOIN:

```sql
SELECT dr.*, gr.urgency, gr.request_id AS gov_request_id
FROM domain_review dr
LEFT JOIN governance_request gr ON gr.id = dr.request_id
WHERE dr.id = :id
```

### 4.4 `progress.py`

Add `urgency` to the response (line ~40):

```python
"urgency": gr.get("urgency", "normal"),
```

### 4.5 `dashboard.py` (Optional Enhancement)

Add urgency breakdown to `dashboard_stats`:

```python
by_urgency = (await db.execute(text(
    "SELECT urgency, COUNT(*) as cnt FROM governance_request GROUP BY urgency ORDER BY urgency"
))).mappings().all()
# ...
"byUrgency": [{"urgency": r["urgency"], "count": r["cnt"]} for r in by_urgency],
```

---

## 5. Frontend Changes

### 5.1 Constants: `frontend/src/lib/constants.ts`

Add urgency-related styling constants. No changes to `statusColors` needed since urgency is not a status. Instead, add a separate mapping or use inline styling:

```typescript
export const urgencyColors: Record<string, string> = {
  urgent: 'bg-red-500',
  normal: 'bg-gray-400',
};
```

### 5.2 Create Page: `frontend/src/app/governance/create/page.tsx`

#### 5.2.1 Add urgency to form state (line ~20)

```typescript
const [form, setForm] = useState({
  title: '',
  description: '',
  projectId: '',
  organization: '',
  priority: 'Normal',
  urgency: 'normal',   // <-- new field
  targetDate: '',
});
```

#### 5.2.2 Add urgency selector to form UI

Insert after the Priority select (around line 168-175), within the same 2-column grid:

```tsx
<div>
  <label className="block text-sm font-medium mb-1">Urgency</label>
  <select
    className="select-field"
    value={form.urgency}
    onChange={(e) => setForm({ ...form, urgency: e.target.value })}
  >
    <option value="normal">Normal</option>
    <option value="urgent">Urgent</option>
  </select>
</div>
```

Alternatively, make it a 3-column grid or keep 2-column and put urgency on a new row alongside target date. The most natural layout is to expand the existing 2-column grid to include urgency next to priority:

```tsx
<div className="grid grid-cols-3 gap-4">
  <div>
    <label ...>Organization</label>
    <input ... />
  </div>
  <div>
    <label ...>Priority</label>
    <select ... />
  </div>
  <div>
    <label ...>Urgency</label>
    <select ... />
  </div>
</div>
```

### 5.3 Detail Page: `frontend/src/app/governance/[requestId]/page.tsx`

#### 5.3.1 Update GovRequest interface (line ~12)

```typescript
urgency: string;
```

#### 5.3.2 Display urgency badge in header (line ~79)

After the priority display, add an urgency badge:

```tsx
<span className="text-sm text-text-secondary">Priority: {request.priority}</span>
{request.urgency === 'urgent' && (
  <span className="px-2 py-0.5 rounded text-xs text-white bg-red-500">
    URGENT
  </span>
)}
```

#### 5.3.3 Add urgency to Request Details panel (line ~125)

```tsx
<div className="flex">
  <dt className="w-32 text-text-secondary">Urgency</dt>
  <dd>
    {request.urgency === 'urgent' ? (
      <span className="px-2 py-0.5 rounded text-xs text-white bg-red-500">Urgent</span>
    ) : (
      'Normal'
    )}
  </dd>
</div>
```

### 5.4 Requests List: `frontend/src/app/(sidebar)/requests/page.tsx`

#### 5.4.1 Update GovRequest interface (line ~12)

```typescript
urgency: string;
```

#### 5.4.2 Add urgency column to DataTable (after priority column, ~line 105)

```typescript
{
  key: 'urgency',
  label: 'Urgency',
  sortable: true,
  render: (r) => (
    r.urgency === 'urgent'
      ? <span className="px-2 py-0.5 rounded text-xs text-white bg-red-500">Urgent</span>
      : <span className="text-text-secondary">Normal</span>
  ),
  exportValue: (r) => r.urgency || 'normal',
},
```

#### 5.4.3 (Optional) Add urgency filter

Add urgency to the filter bar or as a separate dropdown. Since the existing FilterBar is config-driven, this may require extending `FilterBarConfig` with an `urgencyOptions` array, or adding a standalone select. The simplest approach is to add it as a query param like status:

```typescript
...(filterValues.urgency && { urgency: filterValues.urgency }),
```

### 5.5 All Reviews Page: `frontend/src/app/(sidebar)/reviews/page.tsx`

#### 5.5.1 Update DomainReview interface (line ~10)

```typescript
urgency?: string;
```

#### 5.5.2 Add urgency badge column to reviews table

After the "Status" column (line ~57), add:

```tsx
<th className="text-left p-3 font-medium">Urgency</th>
```

And in the row:

```tsx
<td className="p-3">
  {r.urgency === 'urgent' ? (
    <span className="px-2 py-0.5 rounded text-xs text-white bg-red-500">Urgent</span>
  ) : (
    <span className="text-text-secondary">Normal</span>
  )}
</td>
```

Update `colSpan` for empty/loading states from `6` to `7`.

### 5.6 Per-Request Reviews: `frontend/src/app/governance/[requestId]/reviews/page.tsx`

Add urgency badge to each domain review card. The urgency comes from the parent governance request, so either:

1. Fetch the governance request separately (already available via query cache), or
2. Rely on the domain_reviews API now returning urgency from the JOIN.

Option 2 is cleaner. In the review card (line ~123), after the status badge:

```tsx
{review.urgency === 'urgent' && (
  <span className="px-2 py-0.5 rounded text-xs text-white bg-red-500">Urgent</span>
)}
```

Update the `DomainReview` interface to include `urgency?: string`.

### 5.7 Domain Review Detail: `frontend/src/app/governance/[requestId]/reviews/[domainCode]/page.tsx`

Add urgency badge in the review header (line ~124):

```tsx
{review.urgency === 'urgent' && (
  <span className="px-2 py-0.5 rounded text-xs text-white bg-red-500">URGENT</span>
)}
```

Update the `DomainReview` interface to include `urgency?: string`.

---

## 6. Testing Strategy

### 6.1 New API Tests (`api-tests/test_governance_requests.py`)

```python
def test_create_request_with_urgency(client):
    """Creating with urgency='urgent' stores and returns it."""
    resp = client.post("/governance-requests", json={
        "title": "Urgent Request",
        "urgency": "urgent",
    })
    assert resp.status_code == 200
    assert resp.json()["urgency"] == "urgent"

def test_default_urgency_is_normal(client):
    """Omitting urgency defaults to 'normal'."""
    resp = client.post("/governance-requests", json={"title": "Normal Request"})
    assert resp.status_code == 200
    assert resp.json()["urgency"] == "normal"

def test_update_urgency(client, create_request):
    """Urgency can be updated via PUT."""
    rid = create_request["requestId"]
    resp = client.put(f"/governance-requests/{rid}", json={"urgency": "urgent"})
    assert resp.status_code == 200
    assert resp.json()["urgency"] == "urgent"
    # Change back
    resp = client.put(f"/governance-requests/{rid}", json={"urgency": "normal"})
    assert resp.json()["urgency"] == "normal"

def test_create_request_invalid_urgency(client):
    """Invalid urgency value returns 400."""
    resp = client.post("/governance-requests", json={
        "title": "Bad Urgency",
        "urgency": "super_urgent",
    })
    assert resp.status_code == 400

def test_filter_by_urgency(client):
    """urgency query param filters results."""
    client.post("/governance-requests", json={"title": "Urgent Filter Test", "urgency": "urgent"})
    resp = client.get("/governance-requests", params={"urgency": "urgent", "pageSize": 100})
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] >= 1
    assert all(r["urgency"] == "urgent" for r in data["data"])

def test_filter_options_includes_urgencies(client):
    """filter-options returns urgencies."""
    resp = client.get("/governance-requests/filter-options")
    assert resp.status_code == 200
    assert "urgencies" in resp.json()
```

### 6.2 New API Tests (`api-tests/test_domain_reviews.py`)

```python
def test_review_includes_urgency_from_request(client, dispatched_request):
    """Domain review list includes urgency from parent governance request."""
    rid = dispatched_request["request"]["requestId"]
    resp = client.get("/domain-reviews", params={"request_id": rid})
    assert resp.status_code == 200
    reviews = resp.json()["data"]
    assert len(reviews) >= 1
    # Default urgency should be present
    assert "urgency" in reviews[0]
```

### 6.3 New API Tests (`api-tests/test_dispatch.py`)

```python
def test_dispatch_returns_urgency(client, create_domain):
    """Dispatch response includes urgency from governance request."""
    # Create urgent request
    resp = client.post("/governance-requests", json={
        "title": "Urgent Dispatch Test",
        "urgency": "urgent",
    })
    rid = resp.json()["requestId"]
    client.put(f"/governance-requests/{rid}/submit")

    resp = client.post(f"/dispatch/execute/{rid}", json={
        "domainCodes": [create_domain["domainCode"]],
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["dispatched"][0]["urgency"] == "urgent"
```

### 6.4 New E2E Tests (`e2e-tests/governance-requests.spec.ts`)

```typescript
test('urgency selector on create form defaults to normal', async ({ page }) => {
  await page.goto('/governance/create');
  const urgencySelect = page.locator('select').filter({ has: page.locator('option[value="urgent"]') });
  await expect(urgencySelect).toHaveValue('normal');
});

test('create urgent request shows badge on detail page', async ({ page }) => {
  // Create urgent request via API
  const resp = await page.request.post('http://localhost:4001/api/governance-requests', {
    data: { title: 'E2E Urgent Test', urgency: 'urgent' },
  });
  const gr = await resp.json();

  await page.goto(`/governance/${gr.requestId}`);
  // Urgency badge should be visible
  await expect(page.locator('text=URGENT')).toBeVisible({ timeout: 10000 });
});

test('urgency badge visible on reviews page for urgent request', async ({ page }) => {
  // Create, submit, dispatch urgent request via API
  const resp = await page.request.post('http://localhost:4001/api/governance-requests', {
    data: { title: 'E2E Urgent Review Test', urgency: 'urgent' },
  });
  const gr = await resp.json();
  await page.request.put(`http://localhost:4001/api/governance-requests/${gr.requestId}/submit`);

  // Navigate to all reviews page and check for urgency badge
  await page.goto('/reviews');
  // If the request was dispatched, an "Urgent" badge should appear
  // (This depends on dispatch having occurred; may need to dispatch first)
});
```

### 6.5 Test Map Updates (`scripts/test-map.json`)

No new entries needed since all modified files are already mapped. The existing mappings cover:
- `governance_requests.py` -> `test_governance_requests.py`
- `dispatcher.py` -> `test_dispatch.py`
- `domain_reviews.py` -> `test_domain_reviews.py`
- Frontend paths -> corresponding E2E test files

### 6.6 Test Execution Order

1. Run migration on test DB
2. Run API tests: `python3 -m pytest api-tests/test_governance_requests.py api-tests/test_dispatch.py api-tests/test_domain_reviews.py -v --tb=short`
3. Run E2E tests: `npx playwright test e2e-tests/governance-requests.spec.ts --reporter=list`
4. Full suite: `python3 -m pytest api-tests/ -v --tb=short && npx playwright test --reporter=list`

---

## 7. Implementation Order

### Phase 1: Database (5 min)
1. Write `scripts/migration_add_urgency.sql`
2. Update `scripts/schema.sql` with new column
3. Run migration against `egm_local`

### Phase 2: Backend -- Governance Requests (20 min)
1. Update `_map()` to include urgency
2. Add urgency to `create_request()` with validation
3. Add urgency to `update_request()` field loop with validation
4. Add urgency filter to `list_requests()`
5. Add urgency to `filter_options()`
6. Add `"urgency"` to `ALLOWED_SORT`
7. Write and run API tests for governance requests

### Phase 3: Backend -- Dispatcher & Reviews (15 min)
1. Update `dispatcher.py` to read and return urgency
2. Update `domain_reviews.py` list/get to JOIN urgency
3. Update `progress.py` to include urgency
4. Write and run API tests for dispatch and reviews

### Phase 4: Frontend -- Forms & Display (25 min)
1. Update create page form with urgency selector
2. Update detail page header and details panel with urgency badge
3. Update requests list with urgency column
4. Update all-reviews page with urgency badge column
5. Update per-request reviews page with urgency badge
6. Update domain review detail page with urgency badge
7. Add urgency styling to constants

### Phase 5: E2E Tests & Verification (15 min)
1. Write E2E tests for urgency on create form and detail page
2. Run full test suite
3. Manual verification in browser

**Estimated total: ~80 minutes**

---

## 8. Risks & Considerations

### 8.1 Urgency vs. Priority Confusion

The schema already has a `priority` field (Low/Normal/High/Critical). Adding `urgency` (normal/urgent) creates two related but distinct concepts:

- **Priority** is a general classification of request importance
- **Urgency** is a binary flag that triggers specific workflow behaviors (dispatch priority, visual badges)

This distinction should be documented clearly. If stakeholders prefer to collapse these into a single dimension, the implementation would be simpler (e.g., making "Critical" priority trigger urgent behaviors). However, the task explicitly requests a separate urgency field.

### 8.2 Existing Data

All existing governance requests will default to `urgency = 'normal'` via the migration's DEFAULT clause. No data backfill is needed.

### 8.3 Validation Consistency

Urgency validation (`"normal"` / `"urgent"`) must be enforced at both:
- Backend: HTTPException 400 on invalid values (implemented in create + update)
- Database: CHECK constraint (defense in depth)
- Frontend: select element with only valid options

### 8.4 Case Sensitivity

The values `normal` and `urgent` are lowercase to distinguish them from existing capitalized enum patterns (`Low`, `Normal`, `High`, `Critical` for priority; `Draft`, `Submitted`, etc. for status). This is a deliberate choice since urgency is a simpler binary flag, but the team should decide whether to capitalize (`Normal`/`Urgent`) for consistency with the rest of the schema. The plan uses lowercase as specified in the task prompt, but this is easily changed.

### 8.5 No domain_review Schema Change

This plan intentionally avoids adding a column to `domain_review`. The urgency is read from the governance_request via JOIN. This has tradeoffs:

- **Pro**: Single source of truth; urgency changes propagate immediately
- **Pro**: No migration needed on `domain_review`
- **Con**: Slightly more complex queries (JOIN required)
- **Con**: Cannot sort reviews by urgency without the JOIN

If sorting reviews by urgency becomes important, a denormalized `urgency` column on `domain_review` (set at dispatch time) would be the right enhancement.

### 8.6 Audit Logging

Urgency changes during update should be captured in audit log entries. The existing `update_request` endpoint does not write audit logs for field changes (only `create`, `submit`, and `verdict` do). If audit logging for urgency changes is required, `write_audit()` should be added to the update endpoint, at least for urgency transitions from normal to urgent or vice versa.

### 8.7 Backward Compatibility

- API responses gain a new `urgency` field. Existing clients that don't consume it are unaffected.
- Create/update endpoints accept a new optional `urgency` parameter. Omitting it defaults to `normal`, preserving existing behavior.
- The migration uses `DEFAULT 'normal'`, so existing data is unaffected.
- No breaking changes to any existing API contract.

---

## 9. Feature Doc Update

After implementation, update `docs/features/governance-requests.md`:
- Add `urgency` to the table description
- Add new API param documentation
- Add new ACs (e.g., AC-24 through AC-29)
- Add new test coverage entries

Update `docs/features/domain-dispatch.md`:
- Document that urgency is surfaced on reviewer UI
- Document that dispatch response includes urgency
