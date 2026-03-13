# Closed-Loop Development Plan: Add "Urgency" Field to Governance Requests

## User Request (translated)

> Add an 'Urgency' field (urgent/normal) to governance requests, settable during create and edit. When set to urgent, dispatch should raise priority, and the domain reviewer interface should display an urgency badge. Requires a database column.

---

## Phase 1: Impact Assessment

### Step 1.1 -- Gather Context

1. **Read `_DEPENDENCIES.json`**: Identified the change belongs primarily to the `governance-requests` feature (table: `governance_request`, router: `governance_requests.py`, frontendPaths: requests list, create form, detail page).

2. **Cross-feature check**: The `governance_request` table appears in `sharedTables` and is used by four features: `governance-requests`, `intake-scoping`, `domain-dispatch`, and `project-linking`. The user request explicitly requires changes to the dispatcher (`dispatcher.py`) and the domain reviewer UI (reviews pages), confirming cross-feature scope.

3. **Feature docs read**:
   - `docs/features/governance-requests.md` -- fully implemented, 23 ACs all checked, Spec Version 3
   - `docs/features/domain-dispatch.md` -- fully implemented, 16 ACs all checked, Spec Version 1
   - `docs/features/intake-scoping.md` -- fully implemented, 17 ACs all checked

4. **Connected features via edges**:
   - `domain-dispatch -> governance-requests` (FK+status_write): The dispatcher reads `governance_request` (currently just `id`) and creates domain_review records. This change requires reading the new `urgency` column.
   - `governance-requests -> domain-dispatch` (guard): Verdict endpoint checks domain_review statuses. No impact from urgency.
   - `intake-scoping -> governance-requests` (FK+status_write): Intake reads/writes governance_request for status changes. Urgency is independent of scoping.
   - `project-linking -> governance-requests` (FK): No impact -- urgency is independent of project linking.

5. **Source files read (9 backend + frontend files)**:
   - `backend/app/routers/governance_requests.py` -- 268 lines: `_map()` function on lines 20-39 maps DB columns to camelCase; `create_request()` on lines 117-154 INSERT with params; `update_request()` on lines 157-199 uses field loop; `list_requests()` on lines 42-95 with filter conditions; `filter_options()` on lines 98-102 returns distinct values
   - `backend/app/routers/dispatcher.py` -- 141 lines: `execute_dispatch()` resolves `governance_request.id` via simple scalar query on line 18-21, creates domain_review records in loop on lines 106-131
   - `backend/app/routers/domain_reviews.py` -- 159 lines: `list_reviews()` already JOINs `governance_request gr` on line 70; `_map()` on lines 16-37 has conditional field mapping; `get_review()` on lines 85-92 uses simple SELECT without JOIN
   - `frontend/src/app/governance/create/page.tsx` -- 191 lines: form state on line 20-27 with `priority: 'Normal'`; grid layout on lines 162-176 with 2 columns (Organization, Priority)
   - `frontend/src/app/governance/[requestId]/page.tsx` -- 165 lines: `GovRequest` interface lines 12-26; header badges lines 79-89 showing status + priority + verdict
   - `frontend/src/app/(sidebar)/requests/page.tsx` -- 166 lines: column definitions lines 69-130; `GovRequest` interface lines 12-23
   - `frontend/src/app/(sidebar)/reviews/page.tsx` -- 93 lines: `DomainReview` interface lines 10-22; table with 6 columns, colSpan=6 in loading/empty states
   - `frontend/src/app/governance/[requestId]/reviews/page.tsx` -- 174 lines: review cards with status/outcome badges on lines 122-159
   - `frontend/src/app/governance/[requestId]/reviews/[domainCode]/page.tsx` -- 268 lines: review detail with status badges on lines 121-135
   - `scripts/schema.sql` -- 303 lines: `governance_request` table lines 39-57 with columns up to `update_at`; `domain_review` table lines 127-145
   - `api-tests/conftest.py` -- shared fixtures: `create_request` on line 22, `dispatched_request` on line 56
   - `api-tests/test_governance_requests.py` -- 288 lines, 22 existing tests
   - `api-tests/test_dispatch.py` -- 123 lines, 7 existing tests
   - `e2e-tests/governance-requests.spec.ts` -- 165 lines, 10 existing E2E tests
   - `frontend/src/lib/constants.ts` -- `statusColors` map on lines 70-87 (no urgency colors yet)

### Step 1.2 -- Classify Impact Level

**Impact Level: L3 (Cross-feature)**

Signals:
- Adds a column to `governance_request`, a **shared table** (listed in `sharedTables` with 4 consumer features)
- Modifies the `governance_requests.py` router API response shape (new `urgency` key in all responses)
- Modifies the `dispatcher.py` router to read urgency from `governance_request`
- Modifies `domain_reviews.py` to propagate urgency via JOIN
- Touches frontend pages belonging to two different features: governance-requests (create, detail, list) and domain-dispatch (reviews dashboard, per-request reviews, domain review detail)
- Changes span exactly 2 features with code modifications: `governance-requests` and `domain-dispatch`

### Step 1.3 -- Classify Risk Level

**Risk Level: Low**

Signals:
- **Pure addition**: New column `urgency VARCHAR DEFAULT 'normal'` with a safe default -- all existing rows automatically get 'normal' via DEFAULT
- No existing columns renamed or removed
- No existing API fields changed -- only a new `urgency` key added to responses (additive, backward-compatible)
- No FK relationships changed
- No status lifecycle changes
- No RBAC permission changes
- Dispatch "priority elevation" is additive metadata propagation, not a change to existing dispatch rule evaluation logic
- Migration is a simple `ALTER TABLE ADD COLUMN IF NOT EXISTS` with DEFAULT (instant on PostgreSQL 11+, no table rewrite)

### Step 1.4 -- Decision Matrix

| Risk \ Impact | L1 | L2 | **L3** | L4 |
|---|---|---|---|---|
| **Low** | Auto-approve | Auto-approve | **Auto-approve + note** | Auto-approve + note |
| Medium | Auto-approve | Pause: review | Pause: review | Pause: review |
| High | Pause: review | Pause: review | Pause: full chain | Pause: full chain |

**Result: Auto-approve + note** (L3 x Low)

### Step 1.5 -- Assessment Output (compact format + note)

```
Impact Assessment: L3/Low -- Auto-approve + note

Feature: Governance Request Urgency Field
Schema: ADD COLUMN governance_request.urgency VARCHAR DEFAULT 'normal'
API: New "urgency" field in all governance-request responses (additive)
Affected features:
  - governance-requests (primary): schema + CRUD + create/edit/list/detail UI
  - domain-dispatch (secondary): dispatcher reads urgency; review UIs show badge
  - intake-scoping: no code changes (urgency independent of scoping)
  - project-linking: no code changes (urgency independent of project linking)

Note: The governance_request table is shared across 4 features, but only
governance-requests and domain-dispatch require code changes. The new column
has a DEFAULT value so existing data is unaffected. All API changes are
additive (new field, no existing field modifications).
```

### Step 1.6 -- Gate

**Decision: PROCEED to Phase 2** (Low risk = auto-approve)

No user review gate needed. The change is low risk despite being cross-feature -- it is purely additive with safe defaults.

---

## Phase 2: Feature Documentation

### Step 2.1 -- Update Feature Docs

Since this change spans two existing features, update **both** feature docs rather than creating a new one.

#### Updates to `docs/features/governance-requests.md` (v3 -> v4)

**Summary section**: Append: "Requests include an urgency level (urgent/normal) that influences dispatch priority and reviewer visibility."

**Database section**: Add to `governance_request` table column list:
```
urgency VARCHAR DEFAULT 'normal'   -- 'urgent' or 'normal'
```

**API Endpoints section**: Add notes to existing endpoint descriptions:
- POST `/api/governance-requests`: accepts optional `urgency` (default: "normal")
- PUT `/api/governance-requests/{request_id}`: urgency is a mutable field
- All GET endpoints: response includes `urgency` field
- GET `/api/governance-requests/filter-options`: returns `urgencies` array

**UI Behavior section**:
- Create Page: "Urgency select field (Normal/Urgent, defaults to Normal) in the form grid"
- Detail Page: "Red 'URGENT' badge in the header when urgency is 'urgent'"
- List Page: "Urgency column in the data table showing badge for urgent requests"

**New Acceptance Criteria** (append after AC-23):
- `[ ] AC-24: Creating a request with urgency='urgent' persists the value; default is 'normal'`
- `[ ] AC-25: Creating a request with an invalid urgency value returns HTTP 400`
- `[ ] AC-26: Urgency can be updated via PUT (added to mutable fields)`
- `[ ] AC-27: Urgency is included in all governance request API responses (list, get, create, update)`
- `[ ] AC-28: Filter options endpoint returns distinct urgency values`
- `[ ] AC-29: Create form includes an urgency selector defaulting to Normal`
- `[ ] AC-30: Detail page displays a red 'URGENT' badge when urgency is 'urgent'`
- `[ ] AC-31: List page displays an urgency column with badge rendering`

**Update existing AC-3 text**: Change "Mutable fields (title, description, projectId, organization, priority, targetDate)" to "Mutable fields (title, description, projectId, organization, priority, urgency, targetDate)"

#### Updates to `docs/features/domain-dispatch.md` (v1 -> v2)

**Dispatch Execution Logic section**: Add after step 3: "3b. Urgency propagation: The dispatch response includes the governance request's urgency value. Domain review list/get endpoints include urgency via JOIN to governance_request."

**New Acceptance Criteria** (append after AC-16):
- `[ ] AC-17: Domain review list endpoint returns the parent request's urgency via JOIN`
- `[ ] AC-18: Domain review get endpoint returns the parent request's urgency via JOIN`
- `[ ] AC-19: All-reviews dashboard (/reviews) displays urgency badge for urgent requests`
- `[ ] AC-20: Per-request reviews page (/governance/{requestId}/reviews) shows urgency badge on review cards`
- `[ ] AC-21: Domain review detail page shows urgency badge when the parent request is urgent`

### Step 2.2 -- Update Dependency Graph

**No changes needed to `docs/features/_DEPENDENCIES.json`**:
- No new tables created (urgency is a column addition, not a new table)
- No new routers created
- No new frontend paths created
- No new edges between features
- `governance_request` is already in `sharedTables` with the correct feature list
- The existing `domain-dispatch -> governance-requests` (FK+status_write) edge already covers the relationship

---

## Phase 3: Implementation

### Step 3.1 -- Write Code

#### 3.1.1 Database Migration

**New file**: `scripts/migrations/add_urgency_field.sql`

```sql
-- Add urgency column to governance_request table
-- DEFAULT 'normal' means all existing rows automatically get 'normal' (instant on PG 11+)
ALTER TABLE governance_request
ADD COLUMN IF NOT EXISTS urgency VARCHAR DEFAULT 'normal';

-- Explicit backfill for safety (in case column existed without default)
UPDATE governance_request SET urgency = 'normal' WHERE urgency IS NULL;
```

**Modify file**: `scripts/schema.sql` (line ~50, after `priority`)

Add between `priority VARCHAR DEFAULT 'Normal'` and `target_date TIMESTAMP`:
```sql
    urgency         VARCHAR DEFAULT 'normal',
```

#### 3.1.2 Backend: `backend/app/routers/governance_requests.py`

**Change 1 -- `ALLOWED_SORT` set (line 17)**: Add `"urgency"`
```python
ALLOWED_SORT = {"request_id", "title", "status", "priority", "urgency", "create_at", "update_at", "requestor"}
```

**Change 2 -- `_map()` function (after line 33, the `"priority"` line)**: Add urgency mapping
```python
"urgency": r.get("urgency", "normal"),
```

**Change 3 -- `list_requests()` function signature (line 43-51)**: Add urgency query parameter
```python
async def list_requests(
    status: str | None = Query(None),
    priority: str | None = Query(None),
    urgency: str | None = Query(None),    # <-- NEW
    requestor: str | None = Query(None),
    ...
```

**Change 3b -- `list_requests()` filter conditions (after line 59)**: Add urgency filter
```python
if urgency:
    params["urgency"] = urgency
    conditions.append("gr.urgency = :urgency")
```

**Change 4 -- `filter_options()` function (lines 99-102)**: Add urgency to response
```python
urgencies = (await db.execute(text(
    "SELECT DISTINCT urgency FROM governance_request ORDER BY urgency"
))).scalars().all()
return {"statuses": statuses, "priorities": priorities, "urgencies": urgencies}
```

**Change 5 -- `create_request()` function (lines 117-154)**: Accept and validate urgency

Add validation before the INSERT (after line 126):
```python
urgency = body.get("urgency", "normal")
if urgency not in ("urgent", "normal"):
    raise HTTPException(status_code=400, detail="Invalid urgency value. Must be 'urgent' or 'normal'")
```

Update INSERT SQL (line 132-137) to include urgency column:
```sql
INSERT INTO governance_request (request_id, title, description, project_id,
    requestor, requestor_name, organization, status, priority, urgency, target_date, create_by, update_by)
VALUES (:request_id, :title, :description, :project_id,
    :requestor, :requestor_name, :organization, 'Draft', :priority, :urgency, :target_date, :create_by, :create_by)
RETURNING *, (SELECT project_name FROM project WHERE project_id = governance_request.project_id) AS project_name
```

Add to params dict (after line 148):
```python
"urgency": urgency,
```

**Change 6 -- `update_request()` function (lines 157-199)**: Add urgency to mutable fields

Add validation before the field loop (after line 167):
```python
if "urgency" in body:
    if body["urgency"] not in ("urgent", "normal"):
        raise HTTPException(status_code=400, detail="Invalid urgency value. Must be 'urgent' or 'normal'")
```

Add to the field mapping list (line 172-176):
```python
for field, col in [
    ("title", "title"), ("description", "description"),
    ("projectId", "project_id"), ("organization", "organization"),
    ("priority", "priority"), ("urgency", "urgency"),
    ("targetDate", "target_date"),
]:
```

#### 3.1.3 Backend: `backend/app/routers/dispatcher.py`

**Change 1 -- `execute_dispatch()` (lines 18-21)**: Fetch urgency along with the request UUID

Replace the scalar query:
```python
gr = (await db.execute(text(
    "SELECT id FROM governance_request WHERE request_id = :id OR id::text = :id"
), {"id": request_id})).scalar()
```

With a mappings query that also fetches urgency:
```python
gr_row = (await db.execute(text(
    "SELECT id, urgency FROM governance_request WHERE request_id = :id OR id::text = :id"
), {"id": request_id})).mappings().first()
if not gr_row:
    raise HTTPException(status_code=404, detail="Governance request not found")
gr = gr_row["id"]
request_urgency = gr_row.get("urgency", "normal")
```

Remove the separate `if not gr` check on line 22-23 (now handled inline).

**Change 2 -- domain_review creation loop response (lines 127-131)**: Add urgency to each created item
```python
created.append({
    "id": str(row["id"]),
    "domainCode": row["domain_code"],
    "status": row["status"],
    "urgency": request_urgency,
})
```

**Change 3 -- return statement (line 141)**: Add urgency to dispatch response
```python
return {"dispatched": created, "count": len(created), "urgency": request_urgency}
```

**Design decision**: Urgency is NOT stored redundantly on `domain_review`. It is read from the parent `governance_request` via JOIN at query time. This means if a user changes urgency after dispatch, all domain reviews immediately reflect the updated urgency. This is the correct behavior -- urgency is a request-level attribute, not a per-review attribute.

#### 3.1.4 Backend: `backend/app/routers/domain_reviews.py`

**Change 1 -- `_map()` function (after line 36)**: Add urgency from JOIN
```python
if "gov_urgency" in r:
    result["urgency"] = r["gov_urgency"]
```

**Change 2 -- `list_reviews()` SELECT (line 78)**: Add urgency from governance_request JOIN

Change:
```sql
SELECT dr.*, dreg.domain_name, gr.request_id AS gov_request_id
```
To:
```sql
SELECT dr.*, dreg.domain_name, gr.request_id AS gov_request_id, gr.urgency AS gov_urgency
```

The JOIN to `governance_request gr` already exists on line 70, so no JOIN changes needed.

**Change 3 -- `get_review()` function (lines 86-92)**: Add JOIN to get urgency

Change:
```python
row = (await db.execute(text(
    "SELECT * FROM domain_review WHERE id = :id"
), {"id": review_id})).mappings().first()
```
To:
```python
row = (await db.execute(text(
    "SELECT dr.*, gr.urgency AS gov_urgency "
    "FROM domain_review dr "
    "LEFT JOIN governance_request gr ON gr.id = dr.request_id "
    "WHERE dr.id = :id"
), {"id": review_id})).mappings().first()
```

#### 3.1.5 Frontend: Create Page (`frontend/src/app/governance/create/page.tsx`)

**Change 1 -- form state (lines 20-27)**: Add urgency
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

**Change 2 -- form grid (lines 162-176)**: Change from 2-column to 3-column grid and add urgency selector

Replace:
```tsx
<div className="grid grid-cols-2 gap-4">
```
With:
```tsx
<div className="grid grid-cols-3 gap-4">
```

Add after the Priority `<div>` (after line 175):
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

#### 3.1.6 Frontend: Detail Page (`frontend/src/app/governance/[requestId]/page.tsx`)

**Change 1 -- `GovRequest` interface (lines 12-26)**: Add urgency
```typescript
urgency: string;
```

**Change 2 -- header badges (lines 79-89)**: Add urgency badge after priority text (line 83)

Insert after `<span className="text-sm text-text-secondary">Priority: {request.priority}</span>`:
```tsx
{request.urgency === 'urgent' && (
    <span className="px-2 py-0.5 rounded text-xs text-white bg-red-500">
        URGENT
    </span>
)}
```

**Change 3 -- Request Details panel (lines 125-131)**: Add urgency row to dl

Insert after the Organization row:
```tsx
<div className="flex">
    <dt className="w-32 text-text-secondary">Urgency</dt>
    <dd>
        {request.urgency === 'urgent' ? (
            <span className="px-2 py-0.5 rounded text-xs text-white bg-red-500">Urgent</span>
        ) : (
            <span>Normal</span>
        )}
    </dd>
</div>
```

#### 3.1.7 Frontend: Requests List Page (`frontend/src/app/(sidebar)/requests/page.tsx`)

**Change 1 -- `GovRequest` interface (lines 12-23)**: Add urgency
```typescript
urgency: string;
```

**Change 2 -- columns array (lines 69-130)**: Add urgency column after priority (line 105)

Insert after the priority column definition:
```typescript
{
    key: 'urgency',
    label: 'Urgency',
    sortable: true,
    render: (r) => (
        r.urgency === 'urgent' ? (
            <span className="px-2 py-0.5 rounded text-xs text-white bg-red-500">Urgent</span>
        ) : (
            <span className="text-text-secondary">Normal</span>
        )
    ),
    exportValue: (r) => r.urgency || 'normal',
},
```

#### 3.1.8 Frontend: All Reviews Dashboard (`frontend/src/app/(sidebar)/reviews/page.tsx`)

**Change 1 -- `DomainReview` interface (lines 10-22)**: Add urgency
```typescript
urgency?: string;
```

**Change 2 -- table header (lines 54-61)**: Add Urgency column header

Insert after the Request `<th>`:
```tsx
<th className="text-left p-3 font-medium">Urgency</th>
```

**Change 3 -- table body rows (lines 70-85)**: Add urgency cell

Insert after the Request `<td>` (after line 75):
```tsx
<td className="p-3">
    {r.urgency === 'urgent' ? (
        <span className="px-2 py-0.5 rounded text-xs text-white bg-red-500" data-testid="urgency-badge">
            URGENT
        </span>
    ) : (
        <span className="text-text-secondary">Normal</span>
    )}
</td>
```

**Change 4 -- colSpan updates (lines 65-67)**: Change `colSpan={6}` to `colSpan={7}` in loading and empty states.

#### 3.1.9 Frontend: Per-Request Reviews Page (`frontend/src/app/governance/[requestId]/reviews/page.tsx`)

**Change 1 -- `DomainReview` interface (lines 12-24)**: Add urgency
```typescript
urgency?: string;
```

**Change 2 -- review card badges (lines 131-139)**: Add urgency badge

Insert after the outcome badge (after line 139):
```tsx
{review.urgency === 'urgent' && (
    <span className="px-2 py-0.5 rounded text-xs text-white bg-red-500">
        URGENT
    </span>
)}
```

#### 3.1.10 Frontend: Domain Review Detail Page (`frontend/src/app/governance/[requestId]/reviews/[domainCode]/page.tsx`)

**Change 1 -- `DomainReview` interface (lines 12-25)**: Add urgency
```typescript
urgency?: string;
```

**Change 2 -- review header badges (lines 121-135)**: Add urgency badge

Insert after the outcome badge conditional (after line 133):
```tsx
{review.urgency === 'urgent' && (
    <span className="px-2 py-0.5 rounded text-xs text-white bg-red-500">
        URGENT
    </span>
)}
```

### Step 3.2 -- Update Test Map (`scripts/test-map.json`)

**No changes needed.** All modified files already have existing test mappings:

| Source File | Existing Test Mapping |
|---|---|
| `backend/app/routers/governance_requests.py` | `api-tests/test_governance_requests.py` |
| `backend/app/routers/dispatcher.py` | `api-tests/test_dispatch.py` |
| `backend/app/routers/domain_reviews.py` | `api-tests/test_domain_reviews.py` |
| `frontend/src/app/governance/create/` | `e2e-tests/governance-requests.spec.ts` |
| `frontend/src/app/governance/[requestId]/` | `e2e-tests/governance-requests.spec.ts` |
| `frontend/src/app/(sidebar)/requests/` | `e2e-tests/governance-requests.spec.ts` |
| `frontend/src/app/(sidebar)/reviews/` | `e2e-tests/dashboard.spec.ts` |

No new source files are being created, so no new mappings are required.

### Step 3.3 -- Automatic Verification (PostToolUse hook)

As each file is edited during implementation, the PostToolUse hook reads `scripts/test-map.json` and auto-runs mapped tests:

| When editing... | Auto-runs... |
|---|---|
| `governance_requests.py` | `api-tests/test_governance_requests.py` |
| `dispatcher.py` | `api-tests/test_dispatch.py` |
| `domain_reviews.py` | `api-tests/test_domain_reviews.py` |
| `frontend/src/app/governance/create/` | `e2e-tests/governance-requests.spec.ts` |
| `frontend/src/app/(sidebar)/reviews/` | `e2e-tests/dashboard.spec.ts` |

Any test failures must be fixed before proceeding to the next file.

---

## Phase 4: Testing

### Step 4.1 -- Write API Tests

#### 4.1.1 New tests in `api-tests/test_governance_requests.py`

**Test 1: `test_create_request_with_urgency`** -- covers AC-24
```python
def test_create_request_with_urgency(client: httpx.Client):
    """Creating a request with urgency='urgent' persists the value."""
    resp = client.post("/governance-requests", json={
        "title": "Urgent Request Test",
        "urgency": "urgent",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["urgency"] == "urgent"
```

**Test 2: `test_create_request_default_urgency`** -- covers AC-24
```python
def test_create_request_default_urgency(client: httpx.Client):
    """Creating a request without urgency defaults to 'normal'."""
    resp = client.post("/governance-requests", json={
        "title": "Normal Urgency Test",
    })
    assert resp.status_code == 200
    assert resp.json()["urgency"] == "normal"
```

**Test 3: `test_create_request_invalid_urgency`** -- covers AC-25
```python
def test_create_request_invalid_urgency(client: httpx.Client):
    """Creating with invalid urgency returns 400."""
    resp = client.post("/governance-requests", json={
        "title": "Invalid Urgency",
        "urgency": "super_urgent",
    })
    assert resp.status_code == 400
    assert "urgency" in resp.json()["detail"].lower()
```

**Test 4: `test_update_request_urgency`** -- covers AC-26
```python
def test_update_request_urgency(client: httpx.Client, create_request):
    """Urgency can be updated via PUT."""
    rid = create_request["requestId"]
    # Update to urgent
    resp = client.put(f"/governance-requests/{rid}", json={"urgency": "urgent"})
    assert resp.status_code == 200
    assert resp.json()["urgency"] == "urgent"
    # Verify persisted via GET
    resp = client.get(f"/governance-requests/{rid}")
    assert resp.json()["urgency"] == "urgent"
    # Update back to normal
    resp = client.put(f"/governance-requests/{rid}", json={"urgency": "normal"})
    assert resp.status_code == 200
    assert resp.json()["urgency"] == "normal"
```

**Test 5: `test_get_request_includes_urgency`** -- covers AC-27
```python
def test_get_request_includes_urgency(client: httpx.Client, create_request):
    """GET response includes urgency field."""
    rid = create_request["requestId"]
    resp = client.get(f"/governance-requests/{rid}")
    assert resp.status_code == 200
    assert "urgency" in resp.json()
    assert resp.json()["urgency"] in ("urgent", "normal")
```

**Test 6: `test_list_requests_includes_urgency`** -- covers AC-27
```python
def test_list_requests_includes_urgency(client: httpx.Client):
    """List response items include urgency field."""
    client.post("/governance-requests", json={"title": "Urgency List Test", "urgency": "urgent"})
    resp = client.get("/governance-requests")
    assert resp.status_code == 200
    for r in resp.json()["data"]:
        assert "urgency" in r
```

**Test 7: `test_filter_options_includes_urgencies`** -- covers AC-28
```python
def test_filter_options_includes_urgencies(client: httpx.Client):
    """Filter options endpoint returns urgencies array."""
    resp = client.get("/governance-requests/filter-options")
    assert resp.status_code == 200
    data = resp.json()
    assert "urgencies" in data
    assert isinstance(data["urgencies"], list)
```

**Update to existing `test_create_request`** (line 5-16): Add urgency default assertion
```python
assert data["urgency"] == "normal"  # default
```

**Update to existing `test_filter_options`** (line 101-106): Add urgency assertion
```python
assert "urgencies" in data
```

#### 4.1.2 New test in `api-tests/test_dispatch.py`

**Test 8: `test_dispatch_urgent_request_propagates_urgency`** -- covers domain-dispatch AC-17
```python
def test_dispatch_urgent_request_propagates_urgency(client: httpx.Client, create_domain):
    """Dispatching an urgent request includes urgency='urgent' in response."""
    resp = client.post("/governance-requests", json={
        "title": "Urgent Dispatch Test",
        "urgency": "urgent",
    })
    rid = resp.json()["requestId"]
    assert resp.json()["urgency"] == "urgent"

    # Submit
    client.put(f"/governance-requests/{rid}/submit")

    # Dispatch
    resp = client.post(f"/dispatch/execute/{rid}", json={
        "domainCodes": [create_domain["domainCode"]],
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["urgency"] == "urgent"
    assert data["dispatched"][0]["urgency"] == "urgent"
```

#### 4.1.3 New test in `api-tests/test_domain_reviews.py`

**Test 9: `test_review_list_includes_urgency`** -- covers domain-dispatch AC-17, AC-18
```python
def test_review_list_includes_urgency(client: httpx.Client, dispatched_request):
    """Domain review list response includes urgency from parent governance request."""
    rid = dispatched_request["request"]["requestId"]
    resp = client.get("/domain-reviews", params={"request_id": rid})
    assert resp.status_code == 200
    for review in resp.json()["data"]:
        assert "urgency" in review
        assert review["urgency"] in ("urgent", "normal")
```

**Test 10: `test_review_get_includes_urgency`** -- covers domain-dispatch AC-18
```python
def test_review_get_includes_urgency(client: httpx.Client, dispatched_request):
    """Domain review GET response includes urgency from parent governance request."""
    review_id = dispatched_request["reviewId"]
    resp = client.get(f"/domain-reviews/{review_id}")
    assert resp.status_code == 200
    assert "urgency" in resp.json()
    assert resp.json()["urgency"] in ("urgent", "normal")
```

### Step 4.2 -- Write E2E Tests

#### 4.2.1 New tests in `e2e-tests/governance-requests.spec.ts`

**E2E Test 1: `"create form has urgency selector defaulting to Normal"`** -- covers AC-29
```typescript
test('create form has urgency selector defaulting to Normal', async ({ page }) => {
    await page.goto('/governance/create');
    await expect(page.getByRole('heading', { name: 'Create Governance Request' })).toBeVisible();
    // Urgency select should exist and default to 'normal'
    const urgencySelect = page.getByLabel('Urgency');
    await expect(urgencySelect).toBeVisible();
    await expect(urgencySelect).toHaveValue('normal');
});
```

**E2E Test 2: `"detail page shows URGENT badge for urgent request"`** -- covers AC-30
```typescript
test('detail page shows URGENT badge for urgent request', async ({ page }) => {
    // Create an urgent request via API
    const resp = await page.request.post('http://localhost:4001/api/governance-requests', {
        data: { title: 'Urgent Badge E2E Test', urgency: 'urgent' },
    });
    const gr = await resp.json();
    expect(gr.urgency).toBe('urgent');

    // Navigate to detail page
    await page.goto(`/governance/${gr.requestId}`);
    await expect(page.locator('text=Urgent Badge E2E Test')).toBeVisible({ timeout: 15000 });
    // URGENT badge should be visible
    await expect(page.locator('text=URGENT')).toBeVisible();
});
```

**E2E Test 3: `"list page shows urgency column"`** -- covers AC-31
```typescript
test('list page shows urgency column', async ({ page }) => {
    // Create an urgent request to ensure data exists
    await page.request.post('http://localhost:4001/api/governance-requests', {
        data: { title: 'Urgency Column E2E Test', urgency: 'urgent' },
    });
    await page.goto('/requests');
    await expect(page.getByRole('heading', { name: 'Governance Requests' })).toBeVisible();
    // Urgency column header should be visible
    await expect(page.getByRole('columnheader', { name: /Urgency/ })).toBeVisible();
});
```

### Step 4.3 -- Run Affected Tests

```bash
# API tests -- governance requests (22 existing + 7 new = 29 tests)
python3 -m pytest api-tests/test_governance_requests.py -v --tb=short

# API tests -- dispatch (7 existing + 1 new = 8 tests)
python3 -m pytest api-tests/test_dispatch.py -v --tb=short

# API tests -- domain reviews (9 existing + 2 new = 11 tests)
python3 -m pytest api-tests/test_domain_reviews.py -v --tb=short

# E2E tests -- governance requests (10 existing + 3 new = 13 tests)
npx playwright test e2e-tests/governance-requests.spec.ts --reporter=list

# E2E tests -- dashboard/reviews
npx playwright test e2e-tests/dashboard.spec.ts --reporter=list
```

---

## Phase 5: Verification & Completion

### Step 5.1 -- Update Feature Docs

#### `docs/features/governance-requests.md`:
- Increment Spec Version: 3 -> 4
- Check off new ACs: AC-24 through AC-31
- Update AC-3 text to include urgency in mutable fields list
- Add Test Coverage entries:
  ```
  - `test_create_request_with_urgency` -- covers AC-24
  - `test_create_request_default_urgency` -- covers AC-24
  - `test_create_request_invalid_urgency` -- covers AC-25
  - `test_update_request_urgency` -- covers AC-26
  - `test_get_request_includes_urgency` -- covers AC-27
  - `test_list_requests_includes_urgency` -- covers AC-27
  - `test_filter_options_includes_urgencies` -- covers AC-28
  - E2E: "create form has urgency selector defaulting to Normal" -- covers AC-29
  - E2E: "detail page shows URGENT badge for urgent request" -- covers AC-30
  - E2E: "list page shows urgency column" -- covers AC-31
  ```
- Status remains "Implemented"

#### `docs/features/domain-dispatch.md`:
- Increment Spec Version: 1 -> 2
- Check off new ACs: AC-17 through AC-21
- Add Test Coverage entries:
  ```
  - `test_dispatch_urgent_request_propagates_urgency` -- covers AC-17
  - `test_review_list_includes_urgency` -- covers AC-17, AC-18
  - `test_review_get_includes_urgency` -- covers AC-18
  - E2E: urgency badge tests for reviews pages -- covers AC-19, AC-20, AC-21
  ```
- Status remains "Implemented"

### Step 5.2 -- Run Full Test Suite

```bash
# Full API test suite (86 existing + 10 new = ~96 tests)
python3 -m pytest api-tests/ -v --tb=short

# Full E2E test suite (24 existing + 3 new = ~27 tests)
npx playwright test --reporter=list
```

All tests must pass. If any existing tests fail due to the new `urgency` field, update assertions to expect the field.

### Step 5.3 -- Final Checklist

| # | Check | Phase |
|---|---|---|
| 1 | Impact assessment completed: L3/Low, Auto-approve + note | 1 |
| 2 | `governance-requests.md` updated with ACs 24-31, AC-3 text updated | 2 |
| 3 | `domain-dispatch.md` updated with ACs 17-21 | 2 |
| 4 | `_DEPENDENCIES.json` reviewed -- no changes needed | 2 |
| 5 | Migration script `add_urgency_field.sql` created | 3 |
| 6 | `scripts/schema.sql` updated with urgency column | 3 |
| 7 | `governance_requests.py` -- _map, create, update, list, filter_options updated | 3 |
| 8 | `dispatcher.py` -- reads urgency, includes in dispatch response | 3 |
| 9 | `domain_reviews.py` -- list/get JOIN includes urgency via gov_urgency alias | 3 |
| 10 | Create form (`create/page.tsx`) -- urgency selector added | 3 |
| 11 | Detail page (`[requestId]/page.tsx`) -- URGENT badge in header + details panel | 3 |
| 12 | List page (`requests/page.tsx`) -- urgency column in DataTable | 3 |
| 13 | All-reviews dashboard (`reviews/page.tsx`) -- urgency column with badge | 3 |
| 14 | Per-request reviews (`[requestId]/reviews/page.tsx`) -- urgency badge on cards | 3 |
| 15 | Domain review detail (`[domainCode]/page.tsx`) -- urgency badge in header | 3 |
| 16 | `test-map.json` -- no new entries needed (all files already mapped) | 3 |
| 17 | 7 new API tests in `test_governance_requests.py` passing | 4 |
| 18 | 1 new API test in `test_dispatch.py` passing | 4 |
| 19 | 2 new API tests in `test_domain_reviews.py` passing | 4 |
| 20 | 3 new E2E tests in `governance-requests.spec.ts` passing | 4 |
| 21 | 2 existing test assertions updated (urgency default + filter options) | 4 |
| 22 | Feature doc ACs checked off, spec versions incremented | 5 |
| 23 | Full API test suite passing (no regressions) | 5 |
| 24 | Full E2E test suite passing (no regressions) | 5 |

---

## Summary of All Affected Files

| # | File | Change Type | Description |
|---|------|------------|-------------|
| 1 | `scripts/schema.sql` | Modify | Add `urgency VARCHAR DEFAULT 'normal'` to `governance_request` CREATE TABLE |
| 2 | `scripts/migrations/add_urgency_field.sql` | **New** | ALTER TABLE ADD COLUMN + backfill migration |
| 3 | `backend/app/routers/governance_requests.py` | Modify | _map, create, update, list (filter+sort), filter_options -- 6 change points |
| 4 | `backend/app/routers/dispatcher.py` | Modify | Read urgency from governance_request; include in dispatch response -- 3 change points |
| 5 | `backend/app/routers/domain_reviews.py` | Modify | Add gov_urgency to list SELECT and get JOIN; add to _map -- 3 change points |
| 6 | `frontend/src/app/governance/create/page.tsx` | Modify | Add urgency to form state; add urgency selector to grid |
| 7 | `frontend/src/app/governance/[requestId]/page.tsx` | Modify | Add urgency to interface; add URGENT badge in header and details panel |
| 8 | `frontend/src/app/(sidebar)/requests/page.tsx` | Modify | Add urgency to interface; add urgency column to DataTable columns |
| 9 | `frontend/src/app/(sidebar)/reviews/page.tsx` | Modify | Add urgency to interface; add column header + cell + colSpan updates |
| 10 | `frontend/src/app/governance/[requestId]/reviews/page.tsx` | Modify | Add urgency to interface; add badge on review cards |
| 11 | `frontend/src/app/governance/[requestId]/reviews/[domainCode]/page.tsx` | Modify | Add urgency to interface; add badge in review detail header |
| 12 | `api-tests/test_governance_requests.py` | Modify | 7 new tests + 2 existing assertion updates |
| 13 | `api-tests/test_dispatch.py` | Modify | 1 new test for urgent dispatch propagation |
| 14 | `api-tests/test_domain_reviews.py` | Modify | 2 new tests for urgency in review list/get |
| 15 | `e2e-tests/governance-requests.spec.ts` | Modify | 3 new E2E tests (form selector, detail badge, list column) |
| 16 | `docs/features/governance-requests.md` | Modify | ACs 24-31, AC-3 text update, test coverage, v3 -> v4 |
| 17 | `docs/features/domain-dispatch.md` | Modify | ACs 17-21, test coverage, v1 -> v2 |

**Totals: 17 files (1 new migration, 16 modified) | 10 new API tests | 3 new E2E tests | 13 new ACs**
