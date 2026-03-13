# Dispatch Rules — Two-Level Hierarchy

## Context

Currently dispatch rules are flat (INTERNAL, EXTERNAL, AI, PII, OPEN_SOURCE). The user wants a parent-child hierarchy so that e.g. "Internal Project" can have sub-rules underneath. Both levels are real rules with independent domain mappings. When creating a governance request, users select only level-2 (child) rules; level-1 (parent) rules are auto-aggregated. Triggered domains = union of selected children's "in" domains + auto-aggregated parents' "in" domains.

## Schema Changes

### `dispatch_rule` — add `parent_rule_code`

```sql
ALTER TABLE dispatch_rule
  ADD COLUMN parent_rule_code VARCHAR
    REFERENCES dispatch_rule(rule_code) ON DELETE SET NULL;
```

- `scripts/schema.sql` line ~300: add `parent_rule_code VARCHAR REFERENCES dispatch_rule(rule_code) ON DELETE SET NULL` after `description`
- Level-1 rules: `parent_rule_code IS NULL`
- Level-2 rules: `parent_rule_code` references a level-1 rule
- Max depth = 2 enforced at application layer (create/update rejects a child-of-child)

### `governance_request_rule` — add `is_auto`

```sql
ALTER TABLE governance_request_rule
  ADD COLUMN is_auto BOOLEAN DEFAULT FALSE;
```

- `scripts/schema.sql` line ~329: add `is_auto BOOLEAN DEFAULT FALSE` before UNIQUE constraint
- `is_auto = FALSE` → user-selected level-2 rule
- `is_auto = TRUE` → auto-aggregated level-1 parent

### Seed data (`scripts/seed_data.sql`)

Keep existing 5 rules as level-2, add 2 new level-1 parents:

```sql
-- Level-1 parents (insert first, no parent_rule_code)
INSERT INTO dispatch_rule (rule_code, rule_name, description, sort_order, create_by) VALUES
('PROJECT_TYPE', '项目类型', '项目的业务类型分类', 1, 'system'),
('DATA_TECH', '数据与技术', '数据处理和技术相关特征', 2, 'system')
ON CONFLICT (rule_code) DO NOTHING;

-- Level-2 children (update existing to have parents)
UPDATE dispatch_rule SET parent_rule_code = 'PROJECT_TYPE', sort_order = 1 WHERE rule_code = 'INTERNAL';
UPDATE dispatch_rule SET parent_rule_code = 'PROJECT_TYPE', sort_order = 2 WHERE rule_code = 'EXTERNAL';
UPDATE dispatch_rule SET parent_rule_code = 'DATA_TECH', sort_order = 1 WHERE rule_code = 'AI';
UPDATE dispatch_rule SET parent_rule_code = 'DATA_TECH', sort_order = 2 WHERE rule_code = 'PII';
UPDATE dispatch_rule SET parent_rule_code = 'DATA_TECH', sort_order = 3 WHERE rule_code = 'OPEN_SOURCE';
```

Level-1 parents also get their own domain mappings in the matrix CROSS JOIN (initially all "out", admin configures via UI).

## Backend Changes

### `backend/app/routers/dispatch_rules.py`

1. **`_map_rule`** — add `"parentRuleCode": r.get("parent_rule_code")`

2. **GET `/`** — no SQL change needed (`SELECT cr.*` already picks up new column). Response now includes `parentRuleCode`.

3. **GET `/matrix`** — add `parentRuleCode` to each rule object in the response. Matrix dict stays flat.

4. **POST `/`** — accept optional `parentRuleCode` in body. Validation:
   - If provided, parent must exist, be active, and have `parent_rule_code IS NULL` (is level-1)
   - The new rule itself must not already be a parent of other rules (enforced: if it has children, reject)
   - Add to INSERT: `parent_rule_code = :parent`

5. **PUT `/{code}`** — allow changing `parentRuleCode`. Same validation as create. If rule has children, cannot set a parent (would create depth > 2).

6. **DELETE `/{code}` (toggle)** — no change needed; children remain as-is.

### `backend/app/routers/governance_requests.py`

**Create request** (lines ~243-264):
1. Accept `ruleCodes` (level-2 selections from user)
2. Validate each is active
3. Insert with `is_auto = FALSE`
4. Compute parent codes: `SELECT DISTINCT parent_rule_code FROM dispatch_rule WHERE rule_code = ANY(:codes) AND parent_rule_code IS NOT NULL AND is_active = TRUE`
5. Insert parents with `is_auto = TRUE`

**Update request** (lines ~365-383):
1. Delete all existing `governance_request_rule` rows
2. Re-insert level-2 with `is_auto = FALSE`
3. Compute & insert parents with `is_auto = TRUE`

**Get request** — return `ruleCodes` (all) and `autoRuleCodes` (only `is_auto = TRUE`). Frontend uses `ruleCodes - autoRuleCodes` to know which are user-selected.

## Frontend Changes

### `frontend/src/app/(sidebar)/settings/dispatch-rules/page.tsx`

**Rule list table:**
- Group rules: show level-1 as bold header rows, level-2 indented underneath
- Sort: parent `sort_order` first, then child `sort_order`

**Create/Edit form:**
- Add optional "Parent Rule" select dropdown (populated with level-1 rules where `parentRuleCode === null`)
- If editing a rule that has children → disable parent dropdown

**Matrix grid:**
- Group columns by parent: level-1 column header spans its children
- Both level-1 and level-2 have toggleable in/out cells
- Visual separator between groups (border or background)

### `frontend/src/app/governance/create/_components/GovernanceScopeDetermination.tsx`

**Grouped display:**
- Group rules by `parentRuleCode`
- Show parent `ruleName` as section header
- Only level-2 children get YES/NO toggles
- When any child is YES → show auto-selected indicator on parent header

**Triggered domains computation (useMemo):**
```
1. Collect "in" domains from selected level-2 rules
2. Find parent codes of selected children
3. Collect "in" domains from those parents
4. Return union
```

**`onRulesChange`** — still passes only level-2 rule codes. Backend handles parent auto-aggregation.

## Live DB Migration

```sql
-- Step 1: Add parent_rule_code column
ALTER TABLE dispatch_rule ADD COLUMN parent_rule_code VARCHAR REFERENCES dispatch_rule(rule_code) ON DELETE SET NULL;

-- Step 2: Add is_auto column
ALTER TABLE governance_request_rule ADD COLUMN is_auto BOOLEAN DEFAULT FALSE;

-- Step 3: Insert level-1 parent rules
INSERT INTO dispatch_rule (rule_code, rule_name, description, sort_order, create_by) VALUES
('PROJECT_TYPE', '项目类型', '项目的业务类型分类', 1, 'system'),
('DATA_TECH', '数据与技术', '数据处理和技术相关特征', 2, 'system')
ON CONFLICT (rule_code) DO NOTHING;

-- Step 4: Assign parents to existing level-2 rules
UPDATE dispatch_rule SET parent_rule_code = 'PROJECT_TYPE', sort_order = 1 WHERE rule_code = 'INTERNAL';
UPDATE dispatch_rule SET parent_rule_code = 'PROJECT_TYPE', sort_order = 2 WHERE rule_code = 'EXTERNAL';
UPDATE dispatch_rule SET parent_rule_code = 'DATA_TECH', sort_order = 1 WHERE rule_code = 'AI';
UPDATE dispatch_rule SET parent_rule_code = 'DATA_TECH', sort_order = 2 WHERE rule_code = 'PII';
UPDATE dispatch_rule SET parent_rule_code = 'DATA_TECH', sort_order = 3 WHERE rule_code = 'OPEN_SOURCE';

-- Step 5: Seed domain mappings for new parent rules
INSERT INTO dispatch_rule_domain (rule_id, domain_code, relationship, create_by)
SELECT dr.id, d.domain_code, 'out', 'system'
FROM dispatch_rule dr
CROSS JOIN domain_registry d
WHERE dr.rule_code IN ('PROJECT_TYPE', 'DATA_TECH') AND d.is_active = TRUE
ON CONFLICT (rule_id, domain_code) DO NOTHING;
```

## Test Changes

### `api-tests/test_dispatch.py` — add:
- `test_create_rule_with_parent` — create child, verify parentRuleCode in response
- `test_create_rule_invalid_parent` — reject child-of-child (depth > 2)
- `test_matrix_includes_parent_rule_code` — verify matrix rules have parentRuleCode
- `test_update_rule_parent` — change parent assignment

### `api-tests/test_governance_requests.py` — add:
- `test_create_request_auto_aggregates_parent` — send level-2 codes, verify parent auto-inserted with is_auto
- `test_get_request_includes_auto_rule_codes` — verify autoRuleCodes in response

### `e2e-tests/dispatch-rules.spec.ts` — add:
- `test grouped rules table shows hierarchy` — verify indented children
- `test create rule with parent dropdown` — create child rule

### `e2e-tests/governance-requests.spec.ts` — update:
- `test create form shows rule YES/NO toggles` — verify grouped layout with parent headers

## Verification

1. Run migration SQL on live DB
2. `python3 -m pytest api-tests/test_dispatch.py -v --tb=short`
3. `python3 -m pytest api-tests/test_governance_requests.py -v --tb=short`
4. `npx playwright test e2e-tests/dispatch-rules.spec.ts --reporter=list`
5. `npx playwright test e2e-tests/governance-requests.spec.ts --reporter=list`
6. Full suite: `python3 -m pytest api-tests/ -v --tb=short && npx playwright test --reporter=list`
7. Preview: Settings → Dispatch Rules — verify hierarchy in table and matrix
8. Preview: Create Request → verify grouped toggles and triggered domains
