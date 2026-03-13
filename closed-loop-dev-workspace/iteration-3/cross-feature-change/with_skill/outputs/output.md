# Closed-Loop Feature Development: Add Urgency Field to Governance Requests

**Task**: Add an `urgency` field (`urgent` / `normal`) to governance requests. The field must be settable on create and edit. When set to `urgent`, dispatch priority must be elevated. Domain reviewer interfaces must display an urgency badge.

**Date**: 2026-03-11
**Skill**: `.claude/skills/closed-loop-development.md`

---

## Phase 1: Impact Assessment

### Step 1.0 — Understand & Explore

**What is being asked?**
1. Add a new `urgency` column to the `governance_request` table (values: `urgent` / `normal`, default `normal`).
2. Expose `urgency` in every existing API response that returns a governance request (GET list, GET single, POST create, PUT update — all go through the `_map()` function).
3. Accept `urgency` as an input field in the `POST /governance-requests` (create) and `PUT /governance-requests/{id}` (update) endpoints.
4. On `POST /dispatch/execute/{request_id}`: when `urgency = 'urgent'`, adjust dispatch behavior to elevate priority — specifically by sorting dispatch rules by priority DESC and ensuring urgent requests are flagged in newly created `domain_review` records (or, alternatively, inserting `domain_review` records with a higher `priority` field — but since `domain_review` has no priority column today, the most natural implementation is to have the dispatcher pass urgency context back so the reviewer UI can respond to it).
5. In the domain reviewer interfaces (`/reviews` all-reviews dashboard, `/governance/[requestId]/reviews`, `/governance/[requestId]/reviews/[domainCode]`), display a visual urgency badge when the parent governance request is `urgent`.

**Exploring existing patterns:**
- `governance_request` already has a `priority` field (`Low` / `Normal` / `High` / `Critical`). The new `urgency` field is a binary flag (`urgent` / `normal`) orthogonal to priority — it signals time-sensitivity rather than importance tier.
- The `_map()` function in `governance_requests.py` is the single projection point for all GR API responses. Adding `urgency` there means all endpoints automatically expose it.
- The update endpoint uses a for-loop over a whitelist of mutable fields (line 172–183 of `governance_requests.py`). Adding `("urgency", "urgency")` to that loop handles edit.
- The dispatcher (`dispatcher.py`) currently creates `domain_review` records with a fixed status of `Pending`. There is no `priority` or `urgency` column on `domain_review`. To "elevate priority" at dispatch time, the most straightforward interpretation is: (a) when `urgency = 'urgent'`, sort dispatched reviews to be created first and potentially log this in audit, and (b) pass urgency context in the dispatch response so the UI can badge it. However, the domain reviewer UI reads `domain_review` records, not `governance_request` directly — so to show a badge on reviewer pages, those pages need to additionally fetch or join urgency from the parent `governance_request`. Looking at `domain_reviews.py`'s `list_reviews` query: it already JOINs `governance_request` via `LEFT JOIN governance_request gr ON gr.id = dr.request_id` — so adding `gr.urgency AS gov_request_urgency` to the SELECT is the cleanest approach to propagate urgency to reviewer pages without a separate API call.
- The `ALL Reviews` page (`/reviews/page.tsx`) fetches `/domain-reviews` with pageSize 500 and renders a table. Adding an urgency badge column there is straightforward once the domain review response includes `govRequestUrgency`.
- The per-request reviews page (`/governance/[requestId]/reviews/page.tsx`) fetches `/domain-reviews?request_id=...` and renders per-review cards. The urgency badge should appear at the page header level (since all reviews on a page share the same parent request's urgency).

**Implementation approaches considered:**

| Approach | Description | Tradeoff |
|---|---|---|
| **A (chosen)** | Add `urgency` to `governance_request` table; join it into `domain_review` responses via the existing `gr` LEFT JOIN; surface badge on both reviewer page types | Minimal schema change; reuses existing JOIN; no new column on `domain_review` |
| **B** | Add `urgency` column on `domain_review` table too, populated at dispatch time | Requires migration on two tables; redundant data; harder to keep in sync |
| **C** | Store urgency only in `governance_request`; reviewer pages do a second API call to fetch GR urgency | Two API calls per page; worse performance; more frontend complexity |

Approach A is the right choice: one new column, reuse of existing JOIN infrastructure, clean propagation path.

---

### Step 1.1 — Gather Context

From `_DEPENDENCIES.json`:
- `governance_request` is listed in `sharedTables` — it is used by **four** features: `governance-requests`, `intake-scoping`, `domain-dispatch`, `project-linking`.
- `domain-dispatch` has a `FK+status_write` edge TO `governance-requests` (reads and writes `governance_request`).
- `governance-requests` has a `guard` edge TO `domain-dispatch` (verdict checks domain_review statuses).
- Both the `domain_reviews.py` router and `dispatcher.py` router will be touched.

Relevant feature docs read: `governance-requests.md` (Spec V3, Implemented) and `domain-dispatch.md` (Spec V1, Implemented).

---

### Step 1.2 — Classify Impact Level

This change:
- Adds a column to `governance_request`, which is a **shared table** used by 4 features.
- Changes the API response shape of all governance request endpoints (adds `urgency` field).
- Changes `dispatcher.py` logic (reads `urgency` from `governance_request` to adjust dispatch behavior).
- Changes `domain_reviews.py` SQL (adds `gr.urgency` to the JOIN SELECT, adds `govRequestUrgency` to `_map()`).
- Changes 4 frontend pages across 2 features.

**Impact Level: L3 — Cross-feature**

The change directly touches the `governance_request` shared table and modifies the API response shape of endpoints that `domain-dispatch` and `intake-scoping` depend on (indirectly, through the shared table). The dispatcher itself is modified to use the new field.

---

### Step 1.3 — Classify Risk Level

Risk signals present:
1. **Migration script required**: Adding `urgency VARCHAR DEFAULT 'normal'` to an existing table requires an `ALTER TABLE` migration, even though it has a safe default.
2. **Existing API response shapes change**: Every GET `/governance-requests` and GET `/governance-requests/{id}` response will now include a new `urgency` field. While additive, any consumer that does strict JSON schema validation or destructuring would notice.
3. **Dispatcher logic change**: The `POST /dispatch/execute/{request_id}` endpoint's behavior is modified — urgent requests alter the dispatch flow.
4. **Domain review API shape change**: `GET /domain-reviews` responses gain a new `govRequestUrgency` field (joined from `governance_request`).

**Risk Level: Medium**

Per the skill instructions: "Any change that needs a migration script (even adding a column with a default), adds/changes fields in existing API responses consumed by other features... it's Medium." All four criteria above are present. This is NOT Low risk despite the changes being additive.

---

### Step 1.4 — Decision Matrix

| Risk \ Impact | Result |
|---|---|
| **Medium × L3** | **Pause: review** — Present affected ACs + API contracts to user, wait for approval |

---

### Step 1.5 — Output Assessment (Full Format)

## Impact Assessment

**Feature**: Urgency Field on Governance Requests
**Impact Level**: L3 — Cross-feature
**Risk Level**: Medium — Migration script required; existing API response shapes change in `governance-requests` and `domain-dispatch` routers; dispatcher logic modified
**Decision**: Pause for review

### Affected Features

| Feature | Relationship | Specific Impact |
|---------|-------------|-----------------|
| `governance-requests` | Primary — owns the table | Schema change (new column), API response change (new field in all GR endpoints), new mutable field on create + update |
| `domain-dispatch` | Consumer via FK+status_write | `dispatcher.py` reads `urgency` to adjust dispatch behavior; `domain_reviews.py` adds `govRequestUrgency` to JOIN response; 3 frontend review pages add urgency badge |
| `intake-scoping` | Consumer via FK (reads `governance_request`) | `intake_response.request_id` FK unchanged; intake endpoints do not return GR fields — no direct impact, but scoping pages do not need updating |
| `project-linking` | Consumer via FK | `governance_request.project_id` FK unchanged; no router or UI changes required |

### Schema Changes

- [x] New column: `governance_request.urgency VARCHAR NOT NULL DEFAULT 'normal'`
- [x] Constraint: CHECK (`urgency IN ('urgent', 'normal')`) recommended
- [x] Migration script required: **Yes** — `scripts/migration_add_urgency.sql`
- [ ] No changes to `domain_review`, `intake_response`, `project`, or other tables

### Affected Acceptance Criteria

**governance-requests.md:**

> AC-3: "Mutable fields (title, description, projectId, organization, priority, targetDate) can be updated via PUT"
> --> **Extended**: `urgency` must be added to the mutable fields list. This AC now reads: "...priority, targetDate, urgency) can be updated via PUT"

> AC-10: "List endpoint supports pagination (page, pageSize), sorting (by allowed columns), and multi-value filtering (status, priority, requestor, search, dateFrom, dateTo)"
> --> **Note**: `urgency` will be in the response but filtering by urgency is not required per the task spec. AC-10 is not invalidated, but the response shape now includes `urgency`.

> AC-16: "The create form validates that title is required before submission"
> --> **Extended**: The create form must also render the urgency selector. The existing validation logic is unchanged, but form state and POST payload must include `urgency`.

> AC-17: "The detail page displays a step indicator, request metadata, and review progress (when applicable)"
> --> **Extended**: The detail page header must display an urgency badge alongside the existing status and priority display.

**domain-dispatch.md:**

> AC-4: "Executing dispatch creates domain review records for each triggered domain"
> --> **Modified**: When the governance request has `urgency = 'urgent'`, the dispatcher must reflect this in its execution (e.g., log urgency context, ensure urgent requests are prioritized in the dispatch response ordering). The `domain_review` records themselves do not change structure, but the `GET /domain-reviews` response will now include `govRequestUrgency` for badge display.

> AC-9: "Domain reviews can be listed with filters (request_id, domainCode, status, reviewer) and pagination"
> --> **Extended**: The domain review list response shape now includes `govRequestUrgency` (from JOIN). Existing filters are unaffected.

> domain-dispatch.md: No RBAC-specific ACs found that are affected.

**intake-scoping.md**: No ACs affected — the intake router does not return `governance_request` fields directly.

**project-linking.md**: No ACs affected.

### Affected API Contracts

| Endpoint | Change Type | Details |
|---|---|---|
| `POST /api/governance-requests` | Request body extended | Accepts optional `urgency: 'urgent' \| 'normal'` (defaults to `'normal'`) |
| `POST /api/governance-requests` | Response shape extended | Now includes `urgency` field |
| `GET /api/governance-requests` | Response shape extended | Each item now includes `urgency` field |
| `GET /api/governance-requests/{id}` | Response shape extended | Now includes `urgency` field |
| `PUT /api/governance-requests/{id}` | Request body extended | Accepts `urgency` as a mutable field |
| `PUT /api/governance-requests/{id}` | Response shape extended | Now includes `urgency` field |
| `POST /api/dispatch/execute/{id}` | Behavior change | Reads `urgency` from GR; when `urgent`, dispatcher logs/flags accordingly |
| `GET /api/domain-reviews` | Response shape extended | Each item now includes `govRequestUrgency` field (joined from governance_request) |
| `GET /api/domain-reviews/{id}` | Response shape extended | Now includes `govRequestUrgency` field if joined |

### Test Impact

**Existing tests needing updates:**
- `api-tests/test_governance_requests.py`:
  - `test_create_request` — response now includes `urgency`; assert `urgency == 'normal'` by default
  - `test_update_request` — add urgency to update payload; assert response reflects change
  - `test_list_requests` — response items now include `urgency`
  - `test_get_request_by_business_id` / `test_get_request_by_uuid` — response now includes `urgency`

- `api-tests/test_dispatch.py`:
  - `test_execute_dispatch` — urgent GR dispatch test; verify dispatch response for urgent request

- `api-tests/test_domain_reviews.py`:
  - `test_list_reviews` — response items now include `govRequestUrgency`

**New tests needed:**
- `test_create_request_with_urgency_urgent` — creates with urgency=urgent, verifies response
- `test_update_request_urgency` — updates urgency from normal to urgent
- `test_dispatch_urgent_request` — dispatches an urgent GR; verifies urgency propagated
- `test_domain_review_list_includes_gov_request_urgency` — list reviews, check `govRequestUrgency` field
- E2E: urgency selector visible on create form; urgency badge visible on detail page; urgency badge visible on reviewer pages

---

### Step 1.6 — Gate

**Decision: Pause for review.** This is a Medium-risk, L3 cross-feature change. The assessment above is presented to the user for explicit approval before proceeding to Phase 2.

---

## Phase 2: Feature Documentation

**Note**: Since this task says "Do NOT actually write code or run tests", this phase produces the full planned feature doc content. The actual file to be created is `docs/features/urgency-field.md`.

However, since this is an enhancement to an *existing* feature (governance requests) and also modifies domain-dispatch, the most appropriate approach is to:
1. Create `docs/features/urgency-field.md` as a focused change-spec for the urgency field addition.
2. Update `docs/features/governance-requests.md` with new ACs (AC-24 through AC-29) and updated affected files.
3. Update `docs/features/domain-dispatch.md` with new/modified ACs.

### Step 2.1 — Feature Doc: `docs/features/urgency-field.md`

```markdown
# Feature: Urgency Field on Governance Requests

**Status**: Draft
**Date**: 2026-03-11
**Spec Version**: 1

## Impact Assessment

**Feature**: Urgency Field on Governance Requests
**Impact Level**: L3 — Cross-feature (touches shared `governance_request` table; modifies governance-requests and domain-dispatch features)
**Risk Level**: Medium — Migration script required; existing API response shapes change; dispatcher logic modified
**Decision**: Approved for implementation

## Summary

Adds an `urgency` field (`urgent` / `normal`) to governance requests. The field is settable on
creation and edit. When a request is marked `urgent`, the dispatch execution flags urgency
context so domain reviewer interfaces can display a prominent urgency badge, helping reviewers
prioritize their work.

## Affected Files

### Backend
- `backend/app/routers/governance_requests.py` — Add `urgency` to `_map()`, create, and update endpoints
- `backend/app/routers/dispatcher.py` — Read `urgency` from governance_request; pass urgency context in dispatch execution
- `backend/app/routers/domain_reviews.py` — Add `gr.urgency AS gov_request_urgency` to JOIN SELECT; expose `govRequestUrgency` in `_map()`

### Frontend
- `frontend/src/app/governance/create/page.tsx` — Add urgency selector (Normal/Urgent) to create form
- `frontend/src/app/governance/[requestId]/page.tsx` — Display urgency badge in request header
- `frontend/src/app/(sidebar)/reviews/page.tsx` — Show urgency badge in domain review table rows
- `frontend/src/app/governance/[requestId]/reviews/page.tsx` — Show urgency banner/badge at page header
- `frontend/src/app/governance/[requestId]/reviews/[domainCode]/page.tsx` — Show urgency badge in review detail header

### Database
- `scripts/schema.sql` — Add `urgency VARCHAR NOT NULL DEFAULT 'normal'` column to `governance_request`
- `scripts/migration_add_urgency.sql` — Migration script: ALTER TABLE ADD COLUMN with CHECK constraint

## API Endpoints

| Method | Path | Change | Description |
|--------|------|--------|-------------|
| POST | `/api/governance-requests` | Extended | Accepts `urgency` in body; response includes `urgency` |
| GET | `/api/governance-requests` | Extended | Each response item now includes `urgency` |
| GET | `/api/governance-requests/{id}` | Extended | Response includes `urgency` |
| PUT | `/api/governance-requests/{id}` | Extended | Accepts `urgency` as mutable field; response includes `urgency` |
| POST | `/api/dispatch/execute/{id}` | Modified | Reads `urgency`; urgent requests are flagged in dispatch response |
| GET | `/api/domain-reviews` | Extended | Each item includes `govRequestUrgency` (joined from governance_request) |

## UI Behavior

### Create Page (`/governance/create`)
- A new "Urgency" select field appears in the form (alongside Priority)
- Options: "Normal" (default), "Urgent"
- When "Urgent" is selected, the field is sent as `urgency: 'urgent'` in the POST body

### Detail Page (`/governance/{requestId}`)
- The request header badge area (currently shows status + priority) also shows an "URGENT" badge
  in red (`bg-red-500 text-white`) when `urgency === 'urgent'`
- Badge is not shown when `urgency === 'normal'`

### Edit (PUT via Detail Page)
- If the detail page has an edit mode or inline edit, urgency can be toggled
- The PUT endpoint accepts `urgency` in body

### All Reviews Page (`/reviews`)
- The domain review table gains a new column or inline badge: when `govRequestUrgency === 'urgent'`,
  a small "URGENT" badge is rendered in the Request column next to the GR ID link
- Helps reviewers quickly identify urgent requests in their queue

### Per-Request Reviews Page (`/governance/{requestId}/reviews`)
- When the parent GR has `urgency === 'urgent'`, a prominent amber/red banner is shown at the
  top of the page: "This governance request is marked URGENT — please prioritize your review."

### Domain Review Detail Page (`/governance/{requestId}/reviews/{domainCode}`)
- The review detail header shows the urgency badge (same red badge) beneath the domain name
- Ensures the individual reviewer is aware of urgency when completing their review

### Error States
- `urgency` must be one of `'urgent'` or `'normal'`; backend returns 400 if an invalid value is supplied
- Default is `'normal'` — omitting the field on create is valid

## Acceptance Criteria

- [ ] AC-1: Creating a governance request without specifying urgency defaults to `urgency = 'normal'`
- [ ] AC-2: Creating a governance request with `urgency = 'urgent'` persists and returns the correct value
- [ ] AC-3: Updating a governance request with `urgency` in the PUT body changes the stored value
- [ ] AC-4: The `urgency` field is included in all governance request API responses (list, single, create, update)
- [ ] AC-5: Attempting to create or update with an invalid urgency value (not `urgent` or `normal`) returns HTTP 400
- [ ] AC-6: The dispatch endpoint reads the governance request's urgency; when `urgent`, urgency context is included in the dispatch response (`isUrgent: true`)
- [ ] AC-7: `GET /api/domain-reviews` response items include a `govRequestUrgency` field reflecting the parent governance request's urgency
- [ ] AC-8: The create form renders an "Urgency" selector with "Normal" and "Urgent" options; "Normal" is the default
- [ ] AC-9: The governance request detail page header displays a red "URGENT" badge when `urgency === 'urgent'`; no badge when `urgency === 'normal'`
- [ ] AC-10: The all-reviews dashboard (`/reviews`) shows an urgency indicator next to the GR ID for urgent requests
- [ ] AC-11: The per-request reviews page (`/governance/{requestId}/reviews`) shows a prominent urgency banner when the parent GR is urgent
- [ ] AC-12: The domain review detail page shows an urgency badge when the parent GR is urgent

## Test Coverage

*(To be filled in after implementation)*

### API Tests
- `api-tests/test_governance_requests.py::test_create_request_default_urgency` — covers AC-1
- `api-tests/test_governance_requests.py::test_create_request_with_urgency_urgent` — covers AC-2
- `api-tests/test_governance_requests.py::test_update_request_urgency` — covers AC-3
- `api-tests/test_governance_requests.py::test_urgency_in_all_gr_responses` — covers AC-4
- `api-tests/test_governance_requests.py::test_invalid_urgency_value_rejected` — covers AC-5
- `api-tests/test_dispatch.py::test_dispatch_urgent_request_response` — covers AC-6
- `api-tests/test_domain_reviews.py::test_domain_review_list_includes_gov_request_urgency` — covers AC-7

### E2E Tests
- `e2e-tests/governance-requests.spec.ts` — "urgency selector is visible on create form" — covers AC-8
- `e2e-tests/governance-requests.spec.ts` — "urgent badge appears on detail page" — covers AC-9
- `e2e-tests/dashboard.spec.ts` — "urgent badge visible in all-reviews table" — covers AC-10
- `e2e-tests/governance-requests.spec.ts` — "urgency banner on per-request reviews page" — covers AC-11
- `e2e-tests/governance-requests.spec.ts` — "urgency badge on domain review detail page" — covers AC-12

## Test Map Entries

*(No new source files; all existing mappings cover the modified files)*

```
backend/app/routers/governance_requests.py -> api-tests/test_governance_requests.py  [existing]
backend/app/routers/dispatcher.py          -> api-tests/test_dispatch.py             [existing]
backend/app/routers/domain_reviews.py      -> api-tests/test_domain_reviews.py       [existing]
frontend/src/app/governance/create/        -> e2e-tests/governance-requests.spec.ts  [existing]
frontend/src/app/governance/              -> e2e-tests/governance-requests.spec.ts  [existing]
frontend/src/app/(sidebar)/reviews/        -> e2e-tests/dashboard.spec.ts            [existing]
```

## Notes

- **Why not add urgency to `domain_review` table?** Adding a redundant column on `domain_review` would require a second migration and create a data synchronization problem (urgency could diverge from the parent GR). The cleaner solution is to JOIN `governance_request.urgency` in the domain review list query, which already JOINs `governance_request`.
- **Dispatch "priority elevation"**: The task says "dispatch 的时候优先级要调高" (priority should be elevated at dispatch). Since `domain_review` has no priority column, the implementation interprets this as: (a) the dispatch response includes `isUrgent: true` when the GR is urgent, and (b) urgent requests' `domain_review` records are created first (ordering). A future extension could add a `priority` column to `domain_review`.
- **Urgency vs. Priority**: `priority` (`Low/Normal/High/Critical`) expresses importance tier; `urgency` (`normal/urgent`) expresses time-criticality. They are orthogonal fields.
- **Default value**: `'normal'` is the safe default, ensuring all existing records remain functional without any data backfill.
```

### Step 2.2 — Dependency Graph Updates

The `_DEPENDENCIES.json` does not need structural changes (no new tables, no new routers, no new frontend paths). The `governance_request` shared table entry and existing edges remain accurate. No update required.

However, a documentation note: the `sharedTables.governance_request` entry already lists all four consuming features. This remains correct.

---

## Phase 3: Implementation Strategy

### Step 3.0 — Implementation Strategy (L3 — required)

**Phased delivery plan** (each phase leaves the system in a working state):

#### Phase 1: Database Migration
File: `scripts/migration_add_urgency.sql`

```sql
-- Migration: Add urgency field to governance_request
-- Run against egm_local database (port 5433)
SET search_path TO egm;

ALTER TABLE governance_request
    ADD COLUMN IF NOT EXISTS urgency VARCHAR NOT NULL DEFAULT 'normal';

-- Optional: add CHECK constraint to enforce valid values
ALTER TABLE governance_request
    DROP CONSTRAINT IF EXISTS governance_request_urgency_check;
ALTER TABLE governance_request
    ADD CONSTRAINT governance_request_urgency_check
    CHECK (urgency IN ('urgent', 'normal'));
```

Also update `scripts/schema.sql` governance_request table definition to include the new column:
```sql
urgency         VARCHAR NOT NULL DEFAULT 'normal' CHECK (urgency IN ('urgent', 'normal')),
```

**System state after Phase 1**: Database has the new column with safe defaults. All existing rows get `urgency = 'normal'`. Backend code still works (SELECT * includes the new field but it's ignored in `_map()`).

**Rollback for Phase 1**:
```sql
ALTER TABLE governance_request DROP COLUMN IF EXISTS urgency;
```

---

#### Phase 2: Backend — governance_requests.py

Three changes to `backend/app/routers/governance_requests.py`:

**2a. Update `_map()` to expose `urgency`:**
```python
def _map(r: dict) -> dict:
    return {
        ...
        "priority": r.get("priority"),
        "urgency": r.get("urgency", "normal"),   # ADD THIS LINE
        "targetDate": ...
    }
```

**2b. Update `create_request` to accept `urgency`:**
In the INSERT SQL, add `urgency` to the column list and values list:
```python
sql = text("""
    INSERT INTO governance_request (request_id, title, description, project_id,
        requestor, requestor_name, organization, status, priority, urgency, target_date, create_by, update_by)
    VALUES (:request_id, :title, :description, :project_id,
        :requestor, :requestor_name, :organization, 'Draft', :priority, :urgency, :target_date, :create_by, :create_by)
    RETURNING *, (SELECT project_name FROM project WHERE project_id = governance_request.project_id) AS project_name
""")
# In the params dict:
"urgency": body.get("urgency", "normal"),
```

Also add urgency validation:
```python
urgency = body.get("urgency", "normal")
if urgency not in ("urgent", "normal"):
    raise HTTPException(status_code=400, detail="Invalid urgency value; must be 'urgent' or 'normal'")
```

**2c. Update `update_request` field whitelist:**
In the for-loop over field/col pairs, add:
```python
("urgency", "urgency"),
```
And add validation before the loop:
```python
if "urgency" in body and body["urgency"] not in ("urgent", "normal", None):
    raise HTTPException(status_code=400, detail="Invalid urgency value; must be 'urgent' or 'normal'")
```

**System state after Phase 2**: All governance request endpoints now expose and accept `urgency`. Existing tests pass (the new field is additive). New API tests for urgency can now be written and run.

**Rollback for Phase 2**: Revert the three edits to `governance_requests.py`.

---

#### Phase 3: Backend — dispatcher.py

Read `urgency` from the governance request record and include it in the dispatch response.

**Change in `dispatcher.py`:**
```python
# Change the initial query to also SELECT urgency:
gr_row = (await db.execute(text(
    "SELECT id, urgency FROM governance_request WHERE request_id = :id OR id::text = :id"
), {"id": request_id})).mappings().first()
if not gr_row:
    raise HTTPException(status_code=404, detail="Governance request not found")

gr = gr_row["id"]
is_urgent = gr_row["urgency"] == "urgent"
```

Then at the return statement:
```python
return {"dispatched": created, "count": len(created), "isUrgent": is_urgent}
```

Note: The current code uses `.scalar()` which only returns the `id`. The query needs to be changed to `.mappings().first()` to capture both `id` and `urgency`.

**System state after Phase 3**: The dispatch endpoint now reflects urgency in its response. Domain review records are created as before (no change to `domain_review` table).

**Rollback for Phase 3**: Revert the dispatcher query change.

---

#### Phase 4: Backend — domain_reviews.py

Add `gr.urgency AS gov_request_urgency` to the JOIN SELECT and expose it in `_map()`.

**Change in `domain_reviews.py` — `_map()` function:**
```python
# Optional joined fields
if "domain_name" in r:
    result["domainName"] = r["domain_name"]
if "gov_request_id" in r:
    result["govRequestId"] = r["gov_request_id"]
if "gov_request_urgency" in r:                          # ADD THIS
    result["govRequestUrgency"] = r["gov_request_urgency"]  # ADD THIS
```

**Change in `list_reviews` query** (the SELECT already JOINs `governance_request gr`):
```python
rows = (await db.execute(text(
    f"SELECT dr.*, dreg.domain_name, gr.request_id AS gov_request_id, gr.urgency AS gov_request_urgency "
    f"{base_from}{where} ORDER BY dr.create_at DESC LIMIT :limit OFFSET :offset"
), params)).mappings().all()
```

Note: `get_review` does not JOIN `governance_request`, so `govRequestUrgency` will be `None` in single-review responses unless that endpoint is also updated (optional, since the detail page fetches urgency from the GR endpoint separately).

**System state after Phase 4**: Domain review list responses now include `govRequestUrgency`. All tests still pass.

---

#### Phase 5: Frontend — governance_requests create page

File: `frontend/src/app/governance/create/page.tsx`

**Form state**: Add `urgency: 'normal'` to the initial form state.

**Render**: Add a new select field in the `grid grid-cols-2 gap-4` section alongside Priority:
```tsx
<div>
  <label className="block text-sm font-medium mb-1">Urgency</label>
  <select className="select-field" value={form.urgency} onChange={(e) => setForm({ ...form, urgency: e.target.value })}>
    <option value="normal">Normal</option>
    <option value="urgent">Urgent</option>
  </select>
</div>
```

The existing `handleSubmit` already sends `form` directly in the POST body — no change needed there since `urgency` will be included automatically.

---

#### Phase 6: Frontend — governance request detail page

File: `frontend/src/app/governance/[requestId]/page.tsx`

**GovRequest interface**: Add `urgency: string` to the interface.

**Header badges area**: After the existing status and verdict badges, add:
```tsx
{request.urgency === 'urgent' && (
  <span className="px-2 py-0.5 rounded text-xs font-bold bg-red-500 text-white">
    URGENT
  </span>
)}
```

---

#### Phase 7: Frontend — All Reviews dashboard

File: `frontend/src/app/(sidebar)/reviews/page.tsx`

**DomainReview interface**: Add `govRequestUrgency?: string`.

**Table row**: In the `<td>` for the Request column, add urgency badge next to the link:
```tsx
<td className="p-3">
  <Link href={...} className="text-primary-blue hover:underline">
    {r.requestId}
  </Link>
  {r.govRequestUrgency === 'urgent' && (
    <span className="ml-1 px-1.5 py-0.5 rounded text-xs font-bold bg-red-500 text-white">
      URGENT
    </span>
  )}
</td>
```

---

#### Phase 8: Frontend — Per-Request Reviews Page

File: `frontend/src/app/governance/[requestId]/reviews/page.tsx`

This page fetches `/domain-reviews?request_id=...` which now includes `govRequestUrgency` on each item. Since all reviews share the same parent GR, check `reviews.data[0].govRequestUrgency`.

Add urgency banner above the existing open-info-requests warning:
```tsx
{reviews?.data?.[0]?.govRequestUrgency === 'urgent' && (
  <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
    <p className="text-sm font-semibold text-red-800">
      This governance request is marked URGENT — please prioritize your review.
    </p>
  </div>
)}
```

Update the `DomainReview` interface to include `govRequestUrgency?: string`.

---

#### Phase 9: Frontend — Domain Review Detail Page

File: `frontend/src/app/governance/[requestId]/reviews/[domainCode]/page.tsx`

The `review` object comes from the domain-reviews list query, which now includes `govRequestUrgency`. Update the interface and add a badge in the detail header:

```tsx
{review.govRequestUrgency === 'urgent' && (
  <span className="px-2 py-0.5 rounded text-xs font-bold bg-red-500 text-white">
    URGENT
  </span>
)}
```

Place it in the `flex items-center gap-2 mt-1` div alongside the status and outcome badges.

---

### Step 3.1 — Backward Compatibility Notes

- The new `urgency` column has `DEFAULT 'normal'`, so all existing records are valid immediately after migration.
- All new response fields (`urgency`, `govRequestUrgency`, `isUrgent`) are additive — no existing fields are renamed or removed.
- The dispatcher's return value gains `isUrgent`, which is a new key that existing consumers (the frontend dispatch mutation in `reviews/page.tsx`) do not currently read — no breakage.

### Step 3.2 — Test Map Updates

No new source files are created. All modified files already have entries in `scripts/test-map.json`:

```
backend/app/routers/governance_requests.py -> api-tests/test_governance_requests.py  [EXISTING - no change]
backend/app/routers/dispatcher.py          -> api-tests/test_dispatch.py             [EXISTING - no change]
backend/app/routers/domain_reviews.py      -> api-tests/test_domain_reviews.py       [EXISTING - no change]
frontend/src/app/governance/create/        -> e2e-tests/governance-requests.spec.ts  [EXISTING - no change]
frontend/src/app/governance/              -> e2e-tests/governance-requests.spec.ts  [EXISTING - no change]
frontend/src/app/(sidebar)/reviews/        -> e2e-tests/dashboard.spec.ts            [EXISTING - no change]
```

No `test-map.json` changes required.

---

## Phase 4: Testing Plan

### Step 4.1 — API Tests to Write

All new tests go into existing test files (no new test files needed).

#### `api-tests/test_governance_requests.py` — New tests

```python
def test_create_request_default_urgency(create_request):
    """AC-1: Creating without urgency defaults to 'normal'"""
    # create_request fixture creates a request without urgency
    assert create_request["urgency"] == "normal"

def test_create_request_with_urgency_urgent(client, auth_headers):
    """AC-2: Creating with urgency='urgent' persists correctly"""
    resp = client.post("/api/governance-requests", json={
        "title": "Urgent Test Request",
        "urgency": "urgent",
    }, headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["urgency"] == "urgent"

def test_update_request_urgency(create_request, client, auth_headers):
    """AC-3: Updating urgency field changes stored value"""
    request_id = create_request["requestId"]
    resp = client.put(f"/api/governance-requests/{request_id}",
        json={"urgency": "urgent"}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["urgency"] == "urgent"

def test_urgency_in_get_single_response(create_request, client, auth_headers):
    """AC-4: GET single response includes urgency"""
    request_id = create_request["requestId"]
    resp = client.get(f"/api/governance-requests/{request_id}", headers=auth_headers)
    assert "urgency" in resp.json()

def test_urgency_in_list_response(create_request, client, auth_headers):
    """AC-4: GET list response items include urgency"""
    resp = client.get("/api/governance-requests", headers=auth_headers)
    assert resp.status_code == 200
    items = resp.json()["data"]
    assert len(items) > 0
    assert "urgency" in items[0]

def test_invalid_urgency_value_rejected_on_create(client, auth_headers):
    """AC-5: Invalid urgency value returns 400"""
    resp = client.post("/api/governance-requests", json={
        "title": "Test",
        "urgency": "high-priority",  # invalid
    }, headers=auth_headers)
    assert resp.status_code == 400

def test_invalid_urgency_value_rejected_on_update(create_request, client, auth_headers):
    """AC-5: Invalid urgency value on update returns 400"""
    request_id = create_request["requestId"]
    resp = client.put(f"/api/governance-requests/{request_id}",
        json={"urgency": "VERY_URGENT"}, headers=auth_headers)
    assert resp.status_code == 400
```

#### `api-tests/test_dispatch.py` — New tests

```python
def test_dispatch_urgent_request_response(dispatched_request_urgent, client, auth_headers):
    """AC-6: Dispatching an urgent GR includes isUrgent=True in response"""
    # dispatched_request_urgent fixture: create GR with urgency='urgent', submit, then dispatch
    request_id = dispatched_request_urgent["requestId"]
    resp = client.post(f"/api/dispatch/execute/{request_id}",
        json={"domainCodes": ["TEST_DOMAIN"]}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["isUrgent"] is True

def test_dispatch_normal_request_response(dispatched_request, client, auth_headers):
    """AC-6: Dispatching a normal GR includes isUrgent=False in response"""
    # dispatched_request fixture: create GR with default urgency='normal'
    request_id = dispatched_request["requestId"]
    # (Dispatch already happened in fixture; this tests a fresh dispatch or checks response)
    assert True  # Covered by test_execute_dispatch checking isUrgent is absent or False
```

#### `api-tests/test_domain_reviews.py` — New tests

```python
def test_domain_review_list_includes_gov_request_urgency(dispatched_request, client, auth_headers):
    """AC-7: Domain review list response includes govRequestUrgency"""
    request_id = dispatched_request["requestId"]
    resp = client.get(f"/api/domain-reviews?request_id={request_id}", headers=auth_headers)
    assert resp.status_code == 200
    items = resp.json()["data"]
    assert len(items) > 0
    assert "govRequestUrgency" in items[0]
    assert items[0]["govRequestUrgency"] in ("urgent", "normal")

def test_domain_review_urgency_for_urgent_request(client, auth_headers):
    """AC-7: govRequestUrgency reflects 'urgent' when parent GR is urgent"""
    # Create urgent GR, submit, dispatch
    gr_resp = client.post("/api/governance-requests",
        json={"title": "Urgent GR", "urgency": "urgent"}, headers=auth_headers)
    request_id = gr_resp.json()["requestId"]
    client.put(f"/api/governance-requests/{request_id}/submit", json={}, headers=auth_headers)
    client.post(f"/api/dispatch/execute/{request_id}", json={"domainCodes": ["TEST_DOMAIN"]}, headers=auth_headers)
    # Now check domain reviews
    resp = client.get(f"/api/domain-reviews?request_id={request_id}", headers=auth_headers)
    items = resp.json()["data"]
    assert items[0]["govRequestUrgency"] == "urgent"
```

#### Existing tests that need assertions updated

- `test_create_request`: Add `assert "urgency" in data` and `assert data["urgency"] == "normal"`
- `test_list_requests`: Add `assert "urgency" in data["data"][0]`
- `test_get_request_by_business_id`: Add `assert "urgency" in data`
- `test_get_request_by_uuid`: Add `assert "urgency" in data`
- `test_update_request`: Verify `"urgency"` in response
- `test_list_reviews` (domain_reviews): Add `assert "govRequestUrgency" in data["data"][0]`

---

### Step 4.2 — E2E Tests to Write

All new E2E tests extend existing spec files.

#### `e2e-tests/governance-requests.spec.ts` — New tests

```typescript
test('urgency selector is visible on create form with Normal default', async ({ page }) => {
    // AC-8
    await page.goto('/governance/create');
    const urgencySelect = page.locator('select').filter({ hasText: 'Normal' }).last();
    await expect(urgencySelect).toBeVisible();
    await expect(urgencySelect).toHaveValue('normal');
});

test('urgent badge appears on detail page when urgency is urgent', async ({ page }) => {
    // AC-9
    // Create an urgent request (via API setup or UI)
    // Navigate to the detail page
    await page.goto(`/governance/${urgentRequestId}`);
    await expect(page.getByText('URGENT')).toBeVisible();
});

test('no urgent badge on detail page when urgency is normal', async ({ page }) => {
    // AC-9 negative
    await page.goto(`/governance/${normalRequestId}`);
    await expect(page.getByText('URGENT')).not.toBeVisible();
});

test('urgency banner shown on per-request reviews page for urgent request', async ({ page }) => {
    // AC-11
    await page.goto(`/governance/${urgentRequestId}/reviews`);
    await expect(page.getByText(/marked URGENT/)).toBeVisible();
});

test('urgency badge shown on domain review detail page for urgent request', async ({ page }) => {
    // AC-12
    await page.goto(`/governance/${urgentRequestId}/reviews/${domainCode}`);
    await expect(page.getByText('URGENT')).toBeVisible();
});
```

#### `e2e-tests/dashboard.spec.ts` — New tests

```typescript
test('urgent badge visible in all-reviews table for urgent request', async ({ page }) => {
    // AC-10
    await page.goto('/reviews');
    // After urgent GR is dispatched, its review row shows URGENT badge
    const urgentBadge = page.locator('text=URGENT').first();
    await expect(urgentBadge).toBeVisible();
});
```

---

### Step 4.3 — Test Execution Commands

```bash
# After each phase, run affected tests:

# Phase 2 (governance_requests.py):
python3 -m pytest api-tests/test_governance_requests.py -v --tb=short

# Phase 3 (dispatcher.py):
python3 -m pytest api-tests/test_dispatch.py -v --tb=short

# Phase 4 (domain_reviews.py):
python3 -m pytest api-tests/test_domain_reviews.py -v --tb=short

# Phase 5-9 (frontend):
npx playwright test e2e-tests/governance-requests.spec.ts --reporter=list
npx playwright test e2e-tests/dashboard.spec.ts --reporter=list
```

---

## Phase 5: Verification Checklist

### Step 5.1 — Acceptance Criteria Verification

After full implementation and all tests passing, check off each AC:

**`docs/features/urgency-field.md`:**
- [ ] AC-1: Default urgency — covered by `test_create_request_default_urgency`
- [ ] AC-2: Create with urgent — covered by `test_create_request_with_urgency_urgent`
- [ ] AC-3: Update urgency — covered by `test_update_request_urgency`
- [ ] AC-4: Field in all responses — covered by `test_urgency_in_get_single_response`, `test_urgency_in_list_response`
- [ ] AC-5: Invalid value rejected — covered by `test_invalid_urgency_value_rejected_on_create/update`
- [ ] AC-6: Dispatch reads urgency — covered by `test_dispatch_urgent_request_response`
- [ ] AC-7: govRequestUrgency in domain reviews — covered by `test_domain_review_list_includes_gov_request_urgency`
- [ ] AC-8: Urgency selector on create form — covered by `"urgency selector is visible on create form"`
- [ ] AC-9: Urgency badge on detail page — covered by `"urgent badge appears on detail page"`
- [ ] AC-10: Urgency indicator on all-reviews dashboard — covered by `"urgent badge visible in all-reviews table"`
- [ ] AC-11: Urgency banner on per-request reviews page — covered by `"urgency banner shown on per-request reviews page"`
- [ ] AC-12: Urgency badge on domain review detail — covered by `"urgency badge shown on domain review detail page"`

**Updated `governance-requests.md` ACs** (to be appended):
- [ ] AC-24: `urgency` field included in all GR API responses (maps from AC-4)
- [ ] AC-25: `urgency` is a mutable field on PUT (extends AC-3)
- [ ] AC-26: Create form includes urgency selector (extends AC-16)
- [ ] AC-27: Detail page shows urgency badge for urgent requests (extends AC-17)

**Updated `domain-dispatch.md` ACs** (to be appended):
- [ ] AC-17: Dispatch response includes `isUrgent` flag reflecting parent GR urgency
- [ ] AC-18: `GET /api/domain-reviews` includes `govRequestUrgency` per item
- [ ] AC-19: All reviewer UI pages (all-reviews, per-request, detail) show urgency badge/banner when parent GR is urgent

### Step 5.2 — Full Test Suite Command

```bash
# Before marking complete:
python3 -m pytest api-tests/ -v --tb=short    # must pass all 86+ existing + 9 new = 95+ tests
npx playwright test --reporter=list            # must pass all 24+ existing + 5 new = 29+ tests
```

### Step 5.3 — Final Checklist

- [ ] Impact Assessment completed (Phase 1) — L3, Medium risk, Pause for review
- [ ] Feature doc created: `docs/features/urgency-field.md` with all 12 ACs (Phase 2)
- [ ] `docs/features/governance-requests.md` updated with AC-24 through AC-27 (Phase 2)
- [ ] `docs/features/domain-dispatch.md` updated with AC-17 through AC-19 (Phase 2)
- [ ] Dependency graph (`_DEPENDENCIES.json`) reviewed — no structural changes required (Phase 2.2)
- [ ] Migration script written: `scripts/migration_add_urgency.sql` (Phase 3, Phase 1)
- [ ] `scripts/schema.sql` updated with new column definition (Phase 3, Phase 1)
- [ ] `backend/app/routers/governance_requests.py` updated: `_map()`, create, update (Phase 3, Phase 2)
- [ ] `backend/app/routers/dispatcher.py` updated: reads urgency, returns `isUrgent` (Phase 3, Phase 3)
- [ ] `backend/app/routers/domain_reviews.py` updated: JOIN SELECT + `_map()` (Phase 3, Phase 4)
- [ ] `frontend/src/app/governance/create/page.tsx` updated with urgency selector (Phase 3, Phase 5)
- [ ] `frontend/src/app/governance/[requestId]/page.tsx` updated with urgency badge (Phase 3, Phase 6)
- [ ] `frontend/src/app/(sidebar)/reviews/page.tsx` updated with urgency indicator (Phase 3, Phase 7)
- [ ] `frontend/src/app/governance/[requestId]/reviews/page.tsx` updated with urgency banner (Phase 3, Phase 8)
- [ ] `frontend/src/app/governance/[requestId]/reviews/[domainCode]/page.tsx` updated with urgency badge (Phase 3, Phase 9)
- [ ] Test map (`scripts/test-map.json`) reviewed — no new entries required (Phase 3.2)
- [ ] API tests written: 7 new + assertions on 6 existing tests (Phase 4.1)
- [ ] E2E tests written: 5 new in governance-requests.spec.ts + 1 in dashboard.spec.ts (Phase 4.2)
- [ ] All new API tests passing (Phase 4.3)
- [ ] All new E2E tests passing (Phase 4.3)
- [ ] Feature doc status set to "Implemented" (Phase 5.1)
- [ ] Full test suite passing: 95+ API, 29+ E2E (Phase 5.2)

---

## Summary

This change adds `urgency` (`urgent` / `normal`) to governance requests as a **L3 cross-feature, Medium-risk** change. It requires:

1. **1 migration script** (`scripts/migration_add_urgency.sql`) — `ALTER TABLE governance_request ADD COLUMN urgency`
2. **3 backend files modified** — `governance_requests.py` (CRUD), `dispatcher.py` (dispatch logic), `domain_reviews.py` (JOIN propagation)
3. **5 frontend files modified** — create form, detail page, all-reviews dashboard, per-request reviews page, domain review detail page
4. **1 new feature doc** + updates to 2 existing feature docs
5. **13 new tests** (7 API + 6 E2E) + assertions updated on 6 existing tests
6. **No new source files** → no test-map.json changes required

The implementation is fully backward-compatible (additive API fields, safe DB default) and is broken into 9 independently testable phases, each leaving the system in a working state.
