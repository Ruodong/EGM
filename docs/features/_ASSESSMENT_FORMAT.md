# Impact Assessment Output Format

Reference for Claude when generating impact assessments for new feature requests.

## Decision Matrix

| Risk \ Impact | L1 (UI only) | L2 (Feature-local) | L3 (Cross-feature) | L4 (Global) |
|---|---|---|---|---|
| Low | Auto-approve | Auto-approve | Auto-approve + note | Auto-approve + note |
| Medium | Auto-approve | Pause: review | Pause: review | Pause: review |
| High | Pause: review | Pause: review | Pause: full chain | Pause: full chain |

## Format A: Low Risk (compact)

Use when Risk = Low regardless of Impact Level.

```
## Impact Assessment

**Feature**: Add tooltip to request list columns
**Impact**: L1 (UI only) | **Risk**: Low | **Decision**: Auto-approve
No cross-feature impact, no schema changes.
```

For L3/L4 + Low, add a note about which features are touched:

```
## Impact Assessment

**Feature**: Add read-only notification banner on request detail
**Impact**: L3 (reads governance_request + domain_review) | **Risk**: Low | **Decision**: Auto-approve
Touches: governance-requests, domain-dispatch (read-only, no behavior changes).
```

## Format B: Medium/High Risk (full)

Use when Risk = Medium or High. Claude must pause and present this to the user for approval.

```
## Impact Assessment

**Feature**: <feature name>
**Impact Level**: L<n> — <one-line reason>
**Risk Level**: <Medium|High> — <one-line reason>
**Decision**: Pause for review

### Affected Features
| Feature | Relationship | Specific Impact |
|---------|-------------|-----------------|
| governance-requests | FK dependency | Adds new column `workflow_id` to `governance_request` |
| domain-dispatch | Data read | Dispatcher needs to check new `workflow_type` field |

### Schema Changes
- [ ] New table: `workflow` (columns: id, name, steps JSONB, is_active)
- [ ] New column: `governance_request.workflow_id` (FK, nullable)
- [ ] Migration script required: Yes / No

### Affected Acceptance Criteria (from existing feature docs)
> governance-requests.md AC-6: "A verdict can only be recorded on a request
> in 'In Review' status with all domain reviews complete and no open ISRs"
> --> Your change adds a new status 'Pending Approval'. This AC's status
>     check may need updating.

> domain-dispatch.md AC-7: "When no explicit domains or rule matches exist,
> all active domains are dispatched as fallback"
> --> If workflow defines required domains, fallback behavior should respect
>     workflow constraints.

### Affected API Contracts
- `GET /governance-requests/{id}` — response adds `workflowId` field (additive, non-breaking)
- `PUT /governance-requests/{id}/verdict` — guard logic may need workflow-aware checks

### Test Impact
- `api-tests/test_governance_requests.py`: assertion updates for new response fields
- New: `api-tests/test_workflows.py`
- `e2e-tests/governance-requests.spec.ts`: detail page test needs update
```

## Format C: Full Chain (High Risk + L3/L4)

Same as Format B, but additionally trace **transitive dependencies**:

```
### Full Dependency Chain
governance-requests (directly affected)
  └─ intake-scoping (intake_response FK → governance_request)
      └─ domain-dispatch (reads intake_response for dispatch evaluation)
  └─ domain-dispatch (domain_review FK → governance_request)
  └─ project-linking (project FK → governance_request)

All above feature docs reviewed. Affected ACs listed above.
```

## Classification Signals

### Impact Level Signals
| Level | Signals |
|-------|---------|
| L1 | Only `page.tsx`, CSS/Tailwind, component styling changes |
| L2 | Single router logic change; new columns used only by that router |
| L3 | Changes tables/APIs with edges in `_DEPENDENCIES.json`; check `sharedTables` |
| L4 | Changes files in `globalFiles`; or changes tables appearing in 3+ features |

### Risk Level Signals
| Level | Signals |
|-------|---------|
| Low | New columns with defaults; new endpoints; new pages; no existing test breaks |
| Medium | Renames/removes fields; changes API response shape; alters status transitions; needs migration |
| High | Changes FK relationships; alters status lifecycle; modifies dispatch/eval logic; changes RBAC; needs data backfill |
