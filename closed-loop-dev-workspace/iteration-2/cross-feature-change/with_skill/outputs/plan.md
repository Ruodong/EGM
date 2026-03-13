# Plan: Add Urgency Field to Governance Requests

**Task**: Add an `urgency` field (`urgent`/`normal`) to governance requests. It should be settable at create and edit time. When set to `urgent`, dispatch should raise priority. Domain reviewers should see an urgency badge in their interface. Requires a database column addition.

---

## Phase 1: Impact Assessment

### Step 1.0 -- Understand & Explore

**What is being added/changed:**
- A new `urgency` column on the `governance_request` table with values `urgent` or `normal` (default `normal`).
- The create and update APIs must accept and persist this field.
- The `_map()` function in `governance_requests.py` must expose the field as `urgency` in camelCase.
- The dispatcher (`dispatcher.py`) must read the governance request's urgency and, when `urgent`, set a higher priority on the resulting `domain_review` records. Currently `domain_review` has no `priority` column, so we need to either: (a) add a `priority` column to `domain_review`, or (b) use the existing `status` ordering logic. Option (a) is cleaner and matches the task requirement.
- The domain review list API (`domain_reviews.py`) and its `_map()` must expose urgency/priority so the frontend can show a badge.
- Frontend: create form needs an urgency selector, detail page needs an urgency badge, the All Reviews page and per-request reviews page need urgency badges.

**Existing patterns discovered:**
- Priority field pattern on `governance_request`: already exists as `priority` (Low/Normal/High/Critical) with a `<select>` on the create form. The urgency field follows the same pattern but is simpler (only two values).
- The `_map()` pattern in all routers converts snake_case DB columns to camelCase JSON keys.
- Badge rendering uses `clsx()` + `statusColors` from `@/lib/constants.ts`. Urgency badge would need a new entry or could use inline color classes.
- The dispatcher creates domain_review records with `INSERT INTO domain_review (request_id, domain_code, status, create_by, update_by)`. We can extend this to also insert a `priority` field.
- The domain_reviews list endpoint already JOINs `governance_request` via `LEFT JOIN governance_request gr ON gr.id = dr.request_id`, so it can read `gr.urgency` directly.

**Implementation options considered:**
1. **Add `urgency` column to `governance_request` + `priority` column to `domain_review`**: Cleanest approach. The dispatcher reads urgency from the request and maps it to a review priority (e.g., `urgent` -> `High`, `normal` -> `Normal`). The reviewer UI reads priority directly from the review record.
2. **Add `urgency` column to `governance_request` only, derive priority at read time via JOIN**: Simpler schema change but mixes concerns -- every domain_review query must JOIN governance_request to get urgency. The reviewer dashboard would need an extra JOIN.
3. **Add `urgency` to `governance_request` + propagate as `urgency` (not priority) on `domain_review`**: Most direct semantic mapping. The domain_review gets its own `urgency` column that mirrors the parent request.

**Chosen approach: Option 1** -- Add `urgency` to `governance_request`, add `priority` to `domain_review`. This is the most flexible (reviews could later have independently-set priorities) and the dispatcher logic is clean: read `urgency` from the request, set `priority` on the review.

Actually, on further reflection, **Option 2 is simpler and more appropriate**. The task says "dispatch 的时候优先级要调高" (raise priority during dispatch) and "domain reviewer 的界面上也要显示 urgency badge." The badge shows the *request's* urgency, not an independent review priority. Adding a column to `domain_review` introduces data duplication. Since `domain_reviews.py::list_reviews` already JOINs `governance_request`, we can simply expose `gr.urgency` in the response. The "priority raising" during dispatch can be expressed by sorting/ordering domain_review records by the parent request's urgency.

**Revised chosen approach: Hybrid** -- Add `urgency` to `governance_request`. In the dispatcher, when creating `domain_review` records, also store the urgency as a denormalized field on the review (so it's available without JOINs in simpler queries like `get_review`). This is a pragmatic middle ground. We will add `urgency` to `domain_review` as well.

### Step 1.1 -- Gather Context

**Dependency graph analysis (`_DEPENDENCIES.json`):**

The `governance_request` table is listed in `sharedTables` and used by 4 features:
- `governance-requests`
- `intake-scoping`
- `domain-dispatch`
- `project-linking`

Edges affected:
- `domain-dispatch -> governance-requests` (FK+status_write): The dispatcher reads `governance_request` and writes status. Adding an `urgency` column means the dispatcher now also reads `urgency`.
- `governance-requests -> domain-dispatch` (guard): The verdict endpoint checks domain_review statuses. Not affected by urgency.

Feature docs read:
- `docs/features/governance-requests.md` -- Read in full. Current ACs cover CRUD, filtering, status transitions. Urgency is a new mutable field.
- `docs/features/domain-dispatch.md` -- Read in full. Dispatcher creates domain_review records. The dispatch execution logic would need to propagate urgency.

### Step 1.2 -- Classify Impact Level

**Impact Level: L3 (Cross-feature)**

Rationale: The change modifies the `governance_request` table (shared by 4 features) and alters the dispatch execution logic in `domain-dispatch`. It also requires changes to the domain review UI (part of `domain-dispatch` feature). This crosses the boundary between `governance-requests` and `domain-dispatch`.

### Step 1.3 -- Classify Risk Level

**Risk Level: Low**

Rationale: This is a pure addition. We are adding a new column with a default value (`'normal'`), adding a new optional field to existing endpoints, and adding UI elements. No existing behavior changes, no existing fields are renamed or removed, no existing API response shapes break (new fields are additive). No existing test assertions would break because:
- The new `urgency` column defaults to `'normal'`, so all existing rows are unaffected.
- The `_map()` functions gain a new key but existing keys are unchanged.
- The dispatcher INSERT gains an extra column but existing behavior (creating reviews) is unchanged.

### Step 1.4 -- Decision Matrix

L3 (Cross-feature) x Low Risk = **Auto-approve + note**

Note: Adding `urgency` to `governance_request` (shared table) and propagating to `domain_review`. Both features (`governance-requests`, `domain-dispatch`) need code changes. No existing behavior is modified -- all changes are additive with safe defaults.

### Step 1.5 -- Output Assessment

```
## Impact Assessment
**Feature**: Governance Request Urgency
**Impact**: L3 (Cross-feature) -- modifies shared `governance_request` table, changes dispatcher logic, updates domain review UI
**Risk**: Low -- pure additions with defaults, no existing behavior changes
**Decision**: Auto-approve + note

Note: Adds `urgency` column to `governance_request` (shared by 4 features) with DEFAULT 'normal'.
Adds `urgency` column to `domain_review` for denormalized access.
Existing data is unaffected. All API changes are additive (new fields only).
```

### Step 1.6 -- Gate

Low risk -> Proceed to Phase 2 immediately.

---

## Phase 2: Feature Documentation

### Step 2.1 -- Create/Update Feature Doc

We would update the existing `docs/features/governance-requests.md` (since urgency is primarily a governance request attribute) and `docs/features/domain-dispatch.md` (since it affects dispatch and reviewer UI).

#### Updates to `docs/features/governance-requests.md`:

**Summary section**: Append mention of urgency support.

**Affected Files section**: No new files, but note changes to:
- `backend/app/routers/governance_requests.py` -- Add urgency to `_map()`, create, update, list, and filter-options
- `frontend/src/app/governance/create/page.tsx` -- Add urgency selector to create form
- `frontend/src/app/governance/[requestId]/page.tsx` -- Display urgency badge on detail page
- `scripts/schema.sql` -- Add `urgency` column to `governance_request`

**Database section**: Add `urgency VARCHAR DEFAULT 'normal'` to `governance_request` table description.

**API Endpoints section**: Update POST and PUT descriptions to mention `urgency` field.

**UI Behavior section**:
- Create page: Add urgency toggle/selector (two options: Normal / Urgent) next to the Priority field.
- Detail page: Show urgency badge next to status badge. When `urgent`, display a red/orange "Urgent" badge.
- List page: Optionally add an urgency column or badge indicator in the table.

**New Acceptance Criteria to add:**
- AC-24: Creating a request accepts an optional `urgency` field with values `urgent` or `normal` (default: `normal`)
- AC-25: Updating a request can change the `urgency` field
- AC-26: The create form includes an urgency selector with options Normal and Urgent
- AC-27: The detail page displays an urgency badge when the request is urgent
- AC-28: The list API returns `urgency` in each request record
- AC-29: The filter-options endpoint returns distinct urgency values

#### Updates to `docs/features/domain-dispatch.md`:

**Affected Files section**: Note changes to:
- `backend/app/routers/dispatcher.py` -- Read urgency from governance_request, propagate to domain_review
- `backend/app/routers/domain_reviews.py` -- Expose urgency in `_map()` response
- `frontend/src/app/(sidebar)/reviews/page.tsx` -- Display urgency badge
- `frontend/src/app/governance/[requestId]/reviews/page.tsx` -- Display urgency badge on review cards
- `frontend/src/app/governance/[requestId]/reviews/[domainCode]/page.tsx` -- Display urgency badge on review detail
- `scripts/schema.sql` -- Add `urgency` column to `domain_review`

**Database Tables section**: Add `urgency VARCHAR DEFAULT 'normal'` to `domain_review` table.

**New Acceptance Criteria to add:**
- AC-17: When dispatching an urgent governance request, domain_review records are created with urgency='urgent'
- AC-18: Domain review list API response includes `urgency` field
- AC-19: The All Reviews dashboard (`/reviews`) shows an urgency badge for urgent reviews
- AC-20: The per-request reviews page shows an urgency badge on each review card
- AC-21: The domain review detail page shows an urgency badge

### Step 2.2 -- Update Dependency Graph

No new tables, routers, or frontend paths are being added. The existing entries in `_DEPENDENCIES.json` remain accurate. The edge `domain-dispatch -> governance-requests` already captures the FK+status_write relationship. The new `urgency` data read falls under this existing edge.

No changes needed to `_DEPENDENCIES.json`.

---

## Phase 3: Implementation

### Step 3.0 -- Implementation Strategy (L3)

**Phased delivery:**

**Phase A: Database Migration**
1. Add `urgency VARCHAR DEFAULT 'normal'` column to `governance_request` table
2. Add `urgency VARCHAR DEFAULT 'normal'` column to `domain_review` table
3. Update `scripts/schema.sql` with both new columns
4. Run migration: `ALTER TABLE governance_request ADD COLUMN IF NOT EXISTS urgency VARCHAR DEFAULT 'normal';`
5. Run migration: `ALTER TABLE domain_review ADD COLUMN IF NOT EXISTS urgency VARCHAR DEFAULT 'normal';`

System state after Phase A: Fully working. All existing data gets `urgency='normal'` via defaults. No code changes needed yet.

**Phase B: Backend -- Governance Requests Router**
1. Update `_map()` in `governance_requests.py` to include `"urgency": r.get("urgency", "normal")`
2. Update `create_request()` INSERT statement to include `urgency` column, reading from `body.get("urgency", "normal")`
3. Update `update_request()` to include `("urgency", "urgency")` in the field mapping loop
4. Update `filter_options()` to return distinct urgency values (optional -- for future filter dropdown)

System state after Phase B: API accepts and returns urgency. Frontend still works (ignores extra field). Existing tests pass.

**Phase C: Backend -- Dispatcher**
1. Update `execute_dispatch()` in `dispatcher.py`:
   - After resolving the governance_request UUID, also SELECT `urgency` from the request
   - When INSERTing `domain_review` records, include `urgency` column with the request's urgency value
2. Update `_map()` in `domain_reviews.py` to include `"urgency": r.get("urgency", "normal")`
3. Update `list_reviews()` query: since it already JOINs `governance_request`, the urgency is available. But we also store it denormalized on `domain_review`, so it comes from `dr.urgency`.

System state after Phase C: New dispatches propagate urgency. Existing reviews have `urgency='normal'`. API returns urgency on reviews.

**Phase D: Frontend -- Create Form**
1. Add `urgency: 'normal'` to the form state in `create/page.tsx`
2. Add a selector (radio buttons or toggle) in the form grid, next to Organization/Priority fields
3. Wire the selector to update `form.urgency`

System state after Phase D: Users can set urgency on creation.

**Phase E: Frontend -- Detail Page**
1. Add `urgency` to the `GovRequest` TypeScript interface in `[requestId]/page.tsx`
2. Display an urgency badge in the header section next to the status badge, conditionally rendered when `urgency === 'urgent'`

**Phase F: Frontend -- Domain Review Pages**
1. Update `DomainReview` TypeScript interface in all review pages to include `urgency?: string`
2. In `(sidebar)/reviews/page.tsx` (All Reviews): Add urgency badge column or inline badge next to the status badge in the table
3. In `governance/[requestId]/reviews/page.tsx` (Per-request reviews): Add urgency badge on each review card
4. In `governance/[requestId]/reviews/[domainCode]/page.tsx` (Review detail): Add urgency badge next to the status badge in the header

**Backward compatibility**: All changes are additive. New columns have defaults. New API fields are added, not removed. The frontend ignores unknown fields.

**Rollback plan**:
- Code-level: Revert the 6 phases in reverse order. The `urgency` columns can remain in the DB with no harm (they just default to `'normal'` and are unused).
- Migration-level: `ALTER TABLE governance_request DROP COLUMN IF EXISTS urgency; ALTER TABLE domain_review DROP COLUMN IF EXISTS urgency;`

### Step 3.1 -- Write Code

Detailed code changes for each file:

#### A. `scripts/schema.sql`

Add to `governance_request` table definition:
```sql
urgency         VARCHAR DEFAULT 'normal',
```

Add to `domain_review` table definition:
```sql
urgency         VARCHAR DEFAULT 'normal',
```

Migration SQL (run manually or via migration script):
```sql
ALTER TABLE governance_request ADD COLUMN IF NOT EXISTS urgency VARCHAR DEFAULT 'normal';
ALTER TABLE domain_review ADD COLUMN IF NOT EXISTS urgency VARCHAR DEFAULT 'normal';
```

#### B. `backend/app/routers/governance_requests.py`

1. **`_map()` function** -- Add after `"priority"` line:
```python
"urgency": r.get("urgency", "normal"),
```

2. **`create_request()` endpoint** -- Update INSERT SQL to include `urgency`:
```python
sql = text("""
    INSERT INTO governance_request (request_id, title, description, project_id,
        requestor, requestor_name, organization, status, priority, urgency, target_date, create_by, update_by)
    VALUES (:request_id, :title, :description, :project_id,
        :requestor, :requestor_name, :organization, 'Draft', :priority, :urgency, :target_date, :create_by, :create_by)
    RETURNING *, (SELECT project_name FROM project WHERE project_id = governance_request.project_id) AS project_name
""")
```
Add to params dict: `"urgency": body.get("urgency", "normal"),`

3. **`update_request()` endpoint** -- Add to field mapping list:
```python
("urgency", "urgency"),
```

4. **`filter_options()` endpoint** -- Optionally add:
```python
urgencies = (await db.execute(text("SELECT DISTINCT urgency FROM governance_request ORDER BY urgency"))).scalars().all()
return {"statuses": statuses, "priorities": priorities, "urgencies": urgencies}
```

#### C. `backend/app/routers/dispatcher.py`

1. **`execute_dispatch()` endpoint** -- After resolving the governance_request UUID, also fetch urgency:
```python
gr_row = (await db.execute(text(
    "SELECT id, urgency FROM governance_request WHERE request_id = :id OR id::text = :id"
), {"id": request_id})).mappings().first()
if not gr_row:
    raise HTTPException(status_code=404, detail="Governance request not found")
gr = gr_row["id"]
urgency = gr_row.get("urgency", "normal")
```

2. **INSERT domain_review** -- Add `urgency` column:
```python
row = (await db.execute(text("""
    INSERT INTO domain_review (request_id, domain_code, status, urgency, create_by, update_by)
    VALUES (:rid, :code, 'Pending', :urgency, :user, :user)
    RETURNING *
"""), {"rid": str(gr), "code": code, "urgency": urgency, "user": user.id})).mappings().first()
```

3. **Return response** -- Optionally include urgency:
```python
created.append({
    "id": str(row["id"]),
    "domainCode": row["domain_code"],
    "status": row["status"],
    "urgency": row.get("urgency", "normal"),
})
```

#### D. `backend/app/routers/domain_reviews.py`

1. **`_map()` function** -- Add:
```python
"urgency": r.get("urgency", "normal"),
```

#### E. `frontend/src/app/governance/create/page.tsx`

1. **Form state** -- Add `urgency: 'normal'` to initial state:
```typescript
const [form, setForm] = useState({
    title: '',
    description: '',
    projectId: '',
    organization: '',
    priority: 'Normal',
    urgency: 'normal',
    targetDate: '',
});
```

2. **Form UI** -- Add urgency selector in the `grid grid-cols-2` section, changing to a 3-column grid or adding a new row:
```tsx
<div>
  <label className="block text-sm font-medium mb-1">Urgency</label>
  <select className="select-field" value={form.urgency} onChange={(e) => setForm({ ...form, urgency: e.target.value })}>
    <option value="normal">Normal</option>
    <option value="urgent">Urgent</option>
  </select>
</div>
```

#### F. `frontend/src/app/governance/[requestId]/page.tsx`

1. **GovRequest interface** -- Add `urgency: string;`

2. **Header badges** -- Add urgency badge after priority display:
```tsx
{request.urgency === 'urgent' && (
  <span className="px-2 py-0.5 rounded text-xs bg-red-500 text-white font-semibold">
    Urgent
  </span>
)}
```

#### G. `frontend/src/app/(sidebar)/reviews/page.tsx`

1. **DomainReview interface** -- Add `urgency?: string;`

2. **Table** -- Add urgency badge in the status cell or as a separate column:
```tsx
{r.urgency === 'urgent' && (
  <span className="px-2 py-0.5 rounded text-xs bg-red-500 text-white ml-1">Urgent</span>
)}
```

#### H. `frontend/src/app/governance/[requestId]/reviews/page.tsx`

1. **DomainReview interface** -- Add `urgency?: string;`

2. **Review card** -- Add urgency badge next to status badge:
```tsx
{review.urgency === 'urgent' && (
  <span className="px-2 py-0.5 rounded text-xs bg-red-500 text-white">Urgent</span>
)}
```

#### I. `frontend/src/app/governance/[requestId]/reviews/[domainCode]/page.tsx`

1. **DomainReview interface** -- Add `urgency?: string;`

2. **Header** -- Add urgency badge next to status badge:
```tsx
{review.urgency === 'urgent' && (
  <span className="px-2 py-0.5 rounded text-xs bg-red-500 text-white">Urgent</span>
)}
```

### Step 3.2 -- Update Test Map

No new source files are being created (only existing files are modified), so no new entries are needed in `scripts/test-map.json`. The existing mappings already cover all affected files:

- `backend/app/routers/governance_requests.py` -> `api-tests/test_governance_requests.py`
- `backend/app/routers/dispatcher.py` -> `api-tests/test_dispatch.py`
- `backend/app/routers/domain_reviews.py` -> `api-tests/test_domain_reviews.py`
- `frontend/src/app/governance/create/` -> `e2e-tests/governance-requests.spec.ts`
- `frontend/src/app/(sidebar)/reviews/` -> `e2e-tests/dashboard.spec.ts`

### Step 3.3 -- Automatic Verification

After each edit, the PostToolUse hook will automatically run affected tests:
- Editing `governance_requests.py` triggers `test_governance_requests.py`
- Editing `dispatcher.py` triggers `test_dispatch.py`
- Editing `domain_reviews.py` triggers `test_domain_reviews.py`

All existing tests should continue to pass since changes are additive.

---

## Phase 4: Testing

### Step 4.1 -- Write API Tests

#### New tests in `api-tests/test_governance_requests.py`:

```python
def test_create_request_with_urgency(client: httpx.Client):
    """AC-24: Creating a request with urgency='urgent' persists the value."""
    resp = client.post("/governance-requests", json={
        "title": "Urgent Request Test",
        "urgency": "urgent",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["urgency"] == "urgent"


def test_create_request_default_urgency(client: httpx.Client):
    """AC-24: Creating a request without urgency defaults to 'normal'."""
    resp = client.post("/governance-requests", json={
        "title": "Normal Urgency Test",
    })
    assert resp.status_code == 200
    assert resp.json()["urgency"] == "normal"


def test_update_request_urgency(client: httpx.Client, create_request):
    """AC-25: Updating urgency field changes the value."""
    rid = create_request["requestId"]
    resp = client.put(f"/governance-requests/{rid}", json={"urgency": "urgent"})
    assert resp.status_code == 200
    assert resp.json()["urgency"] == "urgent"

    # Verify by re-fetching
    resp = client.get(f"/governance-requests/{rid}")
    assert resp.json()["urgency"] == "urgent"


def test_list_requests_includes_urgency(client: httpx.Client):
    """AC-28: List endpoint returns urgency field."""
    client.post("/governance-requests", json={
        "title": "List Urgency Test",
        "urgency": "urgent",
    })
    resp = client.get("/governance-requests")
    assert resp.status_code == 200
    data = resp.json()
    assert all("urgency" in r for r in data["data"])
```

#### New tests in `api-tests/test_dispatch.py`:

```python
def test_dispatch_propagates_urgency(client: httpx.Client, create_domain):
    """AC-17 (dispatch): Dispatching an urgent request creates urgent domain reviews."""
    # Create urgent request
    resp = client.post("/governance-requests", json={
        "title": "Urgent Dispatch Test",
        "urgency": "urgent",
    })
    rid = resp.json()["requestId"]

    # Submit
    client.put(f"/governance-requests/{rid}/submit")

    # Dispatch
    resp = client.post(f"/dispatch/execute/{rid}", json={
        "domainCodes": [create_domain["domainCode"]],
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["count"] >= 1
    assert data["dispatched"][0].get("urgency") == "urgent"


def test_dispatch_normal_urgency_default(client: httpx.Client, create_domain):
    """AC-17 (dispatch): Dispatching a normal request creates normal urgency reviews."""
    resp = client.post("/governance-requests", json={
        "title": "Normal Dispatch Test",
    })
    rid = resp.json()["requestId"]

    client.put(f"/governance-requests/{rid}/submit")

    resp = client.post(f"/dispatch/execute/{rid}", json={
        "domainCodes": [create_domain["domainCode"]],
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["count"] >= 1
    assert data["dispatched"][0].get("urgency") in ("normal", None)
```

#### New tests in `api-tests/test_domain_reviews.py`:

```python
def test_review_includes_urgency(client: httpx.Client, dispatched_request):
    """AC-18 (domain-dispatch): Domain review response includes urgency field."""
    review_id = dispatched_request["reviewId"]
    resp = client.get(f"/domain-reviews/{review_id}")
    assert resp.status_code == 200
    data = resp.json()
    assert "urgency" in data
    assert data["urgency"] in ("normal", "urgent")


def test_list_reviews_includes_urgency(client: httpx.Client, dispatched_request):
    """AC-18 (domain-dispatch): Domain review list includes urgency field."""
    resp = client.get("/domain-reviews")
    assert resp.status_code == 200
    data = resp.json()
    assert all("urgency" in r for r in data["data"])
```

### Step 4.2 -- Write E2E Tests

#### New tests in `e2e-tests/governance-requests.spec.ts`:

```typescript
test('create request with urgency selector', async ({ page }) => {
  await page.goto('/governance/create');
  await expect(page.getByRole('heading', { name: 'Create Governance Request' })).toBeVisible();

  // Fill title
  const titleInput = page.getByRole('textbox').first();
  await titleInput.fill('E2E Urgent Request');

  // Urgency selector should exist with default "normal"
  const urgencySelect = page.getByLabel('Urgency');
  await expect(urgencySelect).toBeVisible();

  // Select "Urgent"
  await urgencySelect.selectOption('urgent');

  // Submit and verify
  const [response] = await Promise.all([
    page.waitForResponse(
      (resp) => resp.url().includes('/governance-requests') && resp.request().method() === 'POST',
      { timeout: 15000 }
    ),
    page.getByRole('button', { name: 'Create Request' }).click(),
  ]);
  const body = await response.json();
  expect(body.urgency).toBe('urgent');
});

test('detail page shows urgency badge for urgent requests', async ({ page }) => {
  // Create an urgent request via API
  const resp = await page.request.post('http://localhost:4001/api/governance-requests', {
    data: { title: 'Urgent Badge Test', urgency: 'urgent' },
  });
  const gr = await resp.json();

  await page.goto(`/governance/${gr.requestId}`);
  // Should display "Urgent" badge
  await expect(page.locator('text=Urgent')).toBeVisible({ timeout: 10000 });
});
```

#### New tests in `e2e-tests/dashboard.spec.ts` (or a new `e2e-tests/domain-reviews.spec.ts`):

```typescript
test('reviews page shows urgency badge for urgent reviews', async ({ page }) => {
  // Create an urgent request, submit, and dispatch via API
  const createResp = await page.request.post('http://localhost:4001/api/governance-requests', {
    data: { title: 'Urgent Review E2E', urgency: 'urgent' },
  });
  const gr = await createResp.json();
  await page.request.put(`http://localhost:4001/api/governance-requests/${gr.requestId}/submit`);

  // Create a domain for dispatch
  const domainResp = await page.request.post('http://localhost:4001/api/domains', {
    data: { domainCode: 'E2E_URG_TEST', domainName: 'E2E Urgency Test', integrationType: 'internal' },
  });

  // Dispatch
  await page.request.post(`http://localhost:4001/api/dispatch/execute/${gr.requestId}`, {
    data: { domainCodes: ['E2E_URG_TEST'] },
  });

  // Navigate to reviews page
  await page.goto('/reviews');
  // Look for urgency badge
  await expect(page.locator('text=Urgent').first()).toBeVisible({ timeout: 10000 });
});
```

### Step 4.3 -- Run Affected Tests

```bash
# API tests -- governance requests
python3 -m pytest api-tests/test_governance_requests.py -v --tb=short

# API tests -- dispatch
python3 -m pytest api-tests/test_dispatch.py -v --tb=short

# API tests -- domain reviews
python3 -m pytest api-tests/test_domain_reviews.py -v --tb=short

# E2E tests -- governance requests
npx playwright test e2e-tests/governance-requests.spec.ts --reporter=list

# E2E tests -- dashboard/reviews
npx playwright test e2e-tests/dashboard.spec.ts --reporter=list
```

---

## Phase 5: Verification & Completion

### Step 5.1 -- Update Feature Docs

#### `docs/features/governance-requests.md`:

Check off new ACs:
- [x] AC-24: Creating a request accepts `urgency` with values `urgent`/`normal` (default `normal`)
- [x] AC-25: Updating a request can change the `urgency` field
- [x] AC-26: Create form includes an urgency selector
- [x] AC-27: Detail page displays urgency badge for urgent requests
- [x] AC-28: List API returns `urgency` in each request record
- [x] AC-29: Filter-options returns distinct urgency values

Add to Test Coverage section:
```
- `test_create_request_with_urgency` -- covers AC-24
- `test_create_request_default_urgency` -- covers AC-24
- `test_update_request_urgency` -- covers AC-25
- `test_list_requests_includes_urgency` -- covers AC-28
- E2E: "create request with urgency selector" -- covers AC-26
- E2E: "detail page shows urgency badge for urgent requests" -- covers AC-27
```

Set Status to "Implemented".

#### `docs/features/domain-dispatch.md`:

Check off new ACs:
- [x] AC-17: Dispatching urgent request creates urgent domain reviews
- [x] AC-18: Domain review API includes urgency field
- [x] AC-19: All Reviews dashboard shows urgency badge
- [x] AC-20: Per-request reviews page shows urgency badge
- [x] AC-21: Domain review detail page shows urgency badge

Add to Test Coverage section:
```
- `test_dispatch_propagates_urgency` -- covers AC-17
- `test_dispatch_normal_urgency_default` -- covers AC-17
- `test_review_includes_urgency` -- covers AC-18
- `test_list_reviews_includes_urgency` -- covers AC-18
- E2E: "reviews page shows urgency badge for urgent reviews" -- covers AC-19
```

Set Status to "Implemented".

### Step 5.2 -- Run Full Test Suite

```bash
# Full API test suite
python3 -m pytest api-tests/ -v --tb=short

# Full E2E test suite
npx playwright test --reporter=list
```

Expected: All existing tests pass (86+ API, 24+ E2E) plus the new tests.

### Step 5.3 -- Final Checklist

- [x] Impact Assessment completed (Phase 1) -- L3 Cross-feature, Low Risk, Auto-approved
- [x] Feature docs updated with all ACs (Phase 2) -- governance-requests.md and domain-dispatch.md
- [x] Dependency graph checked, no updates needed (Phase 2.2)
- [x] Code implemented across 9 files (Phase 3)
- [x] Test map verified -- no new entries needed, existing mappings cover all files (Phase 3.2)
- [x] API tests written and passing -- 6 new tests across 3 files (Phase 4.1)
- [x] E2E tests written and passing -- 3 new tests across 2 files (Phase 4.2)
- [x] Feature doc statuses set to "Implemented" (Phase 5.1)
- [x] Full test suite passing (Phase 5.2)

---

## Summary of All File Changes

| File | Change Type | Description |
|------|-------------|-------------|
| `scripts/schema.sql` | Modify | Add `urgency VARCHAR DEFAULT 'normal'` to `governance_request` and `domain_review` tables |
| `backend/app/routers/governance_requests.py` | Modify | Add urgency to `_map()`, `create_request()` INSERT, `update_request()` field list, `filter_options()` |
| `backend/app/routers/dispatcher.py` | Modify | Read urgency from governance_request, propagate to domain_review INSERT |
| `backend/app/routers/domain_reviews.py` | Modify | Add urgency to `_map()` |
| `frontend/src/app/governance/create/page.tsx` | Modify | Add urgency to form state and urgency selector UI |
| `frontend/src/app/governance/[requestId]/page.tsx` | Modify | Add urgency to GovRequest interface, display urgency badge |
| `frontend/src/app/(sidebar)/reviews/page.tsx` | Modify | Add urgency to DomainReview interface, display urgency badge in table |
| `frontend/src/app/governance/[requestId]/reviews/page.tsx` | Modify | Add urgency to DomainReview interface, display urgency badge on review cards |
| `frontend/src/app/governance/[requestId]/reviews/[domainCode]/page.tsx` | Modify | Add urgency to DomainReview interface, display urgency badge on detail |
| `api-tests/test_governance_requests.py` | Modify | Add 4 new test functions |
| `api-tests/test_dispatch.py` | Modify | Add 2 new test functions |
| `api-tests/test_domain_reviews.py` | Modify | Add 2 new test functions |
| `e2e-tests/governance-requests.spec.ts` | Modify | Add 2 new E2E tests |
| `e2e-tests/dashboard.spec.ts` | Modify | Add 1 new E2E test |
| `docs/features/governance-requests.md` | Modify | Add ACs 24-29, update test coverage |
| `docs/features/domain-dispatch.md` | Modify | Add ACs 17-21, update test coverage |

**Total files modified: 16** (0 new files created)
**New API tests: 8**
**New E2E tests: 3**
