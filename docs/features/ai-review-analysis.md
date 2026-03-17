# Feature: AI Review Analysis — Automated Domain Review Intelligence

**Status**: Implemented
**Date**: 2026-03-16
**Spec Version**: 2

## Impact Assessment

**Feature**: AI Review Analysis | **Impact**: L3 (cross-feature, reads domain_review + questionnaire + request + embeddings) | **Risk**: Medium | **Decision**: Pause — review

New router `review_analysis.py` + new service `ai_review_analysis.py` + new table `ai_review_analysis` + new frontend component `AIAnalysisSection.tsx`. Reads from governance_request, domain_review, request_questionnaire_response, review_action, review_action_feedback, ask_egm_review_embedding. Extends existing Ask EGM LLM + embedding infrastructure. Triggered automatically on Submit/Resubmit.

**v2 security + context**: Object-level authorization on all endpoints. Analysis context expanded with action items + feedback (parity with Ask EGM). Background triggers log failures instead of silently swallowing. Content hash includes action items for change detection.

### Schema Changes
- New table: `ai_review_analysis` (versioned analysis results per domain review per dimension)

### Affected Features
- **ask-egm**: Shares LLM client, embedding infrastructure, `find_similar_reviews()`
- **domain-dispatch**: Reads `domain_review` status/outcome for reference cases
- **request-questionnaire**: Reads `request_questionnaire_response` for all 5 analysis dimensions
- **governance-requests**: Hook into submit/resubmit to trigger analysis

### API Contract Changes
- New endpoints only — no existing endpoints modified

---

## Summary

After a requestor submits or resubmits a governance request, AI automatically generates a 5-dimension analysis for each triggered domain review:

1. **Risk Assessment** — Pre-assessment of risk level and recommended review depth
2. **Reference Case Analysis** — Similar historical cases via RAG + outcome suggestion
3. **Consistency Analysis** — Detect contradictions within/across domain answers
4. **Completeness Analysis** — Identify information gaps and insufficient answers
5. **Accuracy Analysis** — Flag factual/technical errors in responses

Results are versioned — each submit/resubmit creates a new version. A **change probability analysis** determines which dimensions actually need re-analysis based on what changed.

## Affected Files

### Backend (New)
- `backend/app/services/ai_review_analysis.py` — Core service: prompt construction, LLM calls, result parsing for all 5 dimensions
- `backend/app/routers/review_analysis.py` — API endpoints: trigger, get results, get version history

### Backend (Modified)
- `backend/app/routers/governance_requests.py` — Hook: trigger analysis after submit
- `backend/app/routers/domain_reviews.py` — Hook: trigger analysis after resubmit
- `backend/app/main.py` — Register `review_analysis` router
- `backend/app/auth/rbac.py` — Add `review_analysis` permissions

### Frontend (New)
- `frontend/src/app/governance/_components/AIAnalysisSection.tsx` — Analysis display component with 5 sub-sections

### Frontend (Modified)
- `frontend/src/app/governance/[requestId]/reviews/[domainCode]/page.tsx` — Insert `<AIAnalysisSection>` between Domain Questionnaire and Activity Log

### Database
- `scripts/migration_ai_review_analysis.sql` — New table

## Database Schema

### `ai_review_analysis`

```sql
CREATE TABLE IF NOT EXISTS ai_review_analysis (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domain_review_id  UUID NOT NULL REFERENCES domain_review(id) ON DELETE CASCADE,
    version           INT NOT NULL DEFAULT 1,
    trigger_event     VARCHAR NOT NULL,          -- 'submit' | 'resubmit' | 'manual'
    trigger_by        VARCHAR,                   -- itcode of triggering user
    status            VARCHAR NOT NULL DEFAULT 'pending',  -- 'pending' | 'running' | 'completed' | 'failed'

    -- Change detection (for version > 1)
    content_hash      VARCHAR,                   -- hash of input data, for change detection
    changed_dimensions TEXT[],                   -- which dimensions were re-analyzed

    -- 5 dimension results (JSONB)
    risk_assessment       JSONB,   -- { riskLevel, riskFactors, recommendedDepth, estimatedEffort }
    reference_cases       JSONB,   -- { suggestedOutcome, confidence, similarCases[], keyDifferences[], attentionPoints[] }
    consistency_analysis  JSONB,   -- { contradictions[], overallScore }
    completeness_analysis JSONB,   -- { perQuestion[], informationGaps[], completenessScore }
    accuracy_analysis     JSONB,   -- { factualIssues[], plausibilityConcerns[] }

    -- Summary
    overall_score     FLOAT,                     -- 0.0-1.0 composite score
    summary           TEXT,                      -- One-paragraph executive summary

    error_message     TEXT,                      -- Error details if status='failed'
    started_at        TIMESTAMP,
    completed_at      TIMESTAMP,
    create_at         TIMESTAMP DEFAULT NOW(),

    UNIQUE(domain_review_id, version)
);

CREATE INDEX IF NOT EXISTS idx_ai_analysis_review
    ON ai_review_analysis(domain_review_id, version DESC);
```

### JSONB Schema Details

#### `risk_assessment`
```json
{
  "riskLevel": "HIGH",
  "riskFactors": [
    "Involves PII with cross-border data transfer",
    "Third-party SaaS vendor without SOC2 certification"
  ],
  "recommendedDepth": "FULL",
  "estimatedEffort": "2-3 hours",
  "projectTypeNote": "New project — full review required for all dimensions"
}
```

#### `reference_cases`
```json
{
  "suggestedOutcome": "Approved with Exception",
  "confidence": 0.72,
  "similarCases": [
    {
      "domainReviewId": "uuid",
      "requestId": "EGM-2026-0042",
      "projectName": "HR Analytics Dashboard",
      "similarity": 0.87,
      "outcome": "Approved",
      "keyDifference": "Previous case had no cross-border data transfer"
    }
  ],
  "keyDifferences": ["Cross-border data transfer not present in similar cases"],
  "attentionPoints": ["Verify data residency compliance for EU regions"]
}
```

#### `consistency_analysis`
```json
{
  "contradictions": [
    {
      "type": "intra_domain",
      "severity": "HIGH",
      "questionRefs": ["Q3", "Q7"],
      "description": "Q3 states 'no PII involved' but Q7 mentions 'HR and Payroll system data sources'",
      "suggestedClarification": "Please confirm whether employee PII is accessed from HR/Payroll systems"
    }
  ],
  "overallScore": 0.65
}
```

#### `completeness_analysis`
```json
{
  "perQuestion": [
    {
      "questionId": "Q5",
      "quality": "BRIEF",
      "missingDetails": ["transmission protocol", "encryption method"],
      "suggestedFollowup": "Please describe the data transfer protocol and encryption used"
    }
  ],
  "informationGaps": [
    {
      "topic": "Data Retention Policy",
      "importance": "HIGH",
      "reason": "New system must define data lifecycle management",
      "suggestedQuestion": "How long will data be retained? What is the disposal procedure?"
    }
  ],
  "completenessScore": 0.60
}
```

#### `accuracy_analysis`
```json
{
  "factualIssues": [
    {
      "questionId": "Q5",
      "claim": "Uses AES-512 encryption",
      "issue": "AES standard only supports 128/192/256 bit keys",
      "severity": "HIGH",
      "type": "technical_error"
    }
  ],
  "plausibilityConcerns": [
    {
      "description": "Global deployment in 3 months with a 3-person team",
      "type": "scale_mismatch"
    }
  ]
}
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/review-analysis/{domain_review_id}/trigger` | Trigger analysis (auto or manual) |
| GET | `/api/review-analysis/{domain_review_id}` | Get latest completed analysis |
| GET | `/api/review-analysis/{domain_review_id}/versions` | List all versions |
| GET | `/api/review-analysis/{domain_review_id}/versions/{version}` | Get specific version |

### POST /trigger — Request Body
```json
{
  "triggerEvent": "submit",
  "dimensions": ["risk_assessment", "reference_cases", "consistency", "completeness", "accuracy"]
}
```
- `dimensions` is optional — if omitted, all 5 run
- On resubmit, change detection determines which actually need re-analysis

### POST /trigger — Response
```json
{
  "analysisId": "uuid",
  "version": 2,
  "status": "running",
  "changedDimensions": ["consistency", "completeness"]
}
```

### GET /{domain_review_id} — Response
```json
{
  "id": "uuid",
  "domainReviewId": "uuid",
  "version": 2,
  "status": "completed",
  "triggerEvent": "resubmit",
  "contentHash": "abc123...",
  "changedDimensions": ["consistency", "completeness"],
  "riskAssessment": { ... },
  "referenceCases": { ... },
  "consistencyAnalysis": { ... },
  "completenessAnalysis": { ... },
  "accuracyAnalysis": { ... },
  "overallScore": 0.72,
  "summary": "...",
  "startedAt": "2026-03-16T10:00:00",
  "completedAt": "2026-03-16T10:00:12",
  "createAt": "2026-03-16T10:00:00"
}
```

## Trigger Flow

### Submit (First Analysis)
```
Requestor clicks "Submit"
  → governance_requests.py: submit_request()
    → Creates domain reviews
    → For each domain_review:
        POST /review-analysis/{id}/trigger { triggerEvent: "submit" }
          → Creates version=1, status='pending'
          → Runs all 5 dimensions
          → Updates status='completed'
```

### Resubmit (Versioned Analysis)
```
Requestor clicks "Resubmit" (after Return for Additional Information)
  → domain_reviews.py: resubmit_review()
    → POST /review-analysis/{id}/trigger { triggerEvent: "resubmit" }
      → Step 1: Build content hash from current questionnaire answers
      → Step 2: Compare with previous version's content_hash
      → Step 3: If changed → identify affected dimensions:
          - Answers changed → re-run consistency, completeness, accuracy
          - Project info changed → re-run risk_assessment, reference_cases
          - No change → skip (reuse previous version's results)
      → Step 4: Create new version with only changed dimensions re-analyzed
      → Step 5: Copy unchanged dimension results from previous version
```

### Change Detection Logic
```python
def detect_changed_dimensions(old_hash_parts, new_hash_parts):
    """Determine which dimensions need re-analysis."""
    changed = []

    if old_hash_parts["answers"] != new_hash_parts["answers"]:
        changed.extend(["consistency", "completeness", "accuracy"])

    if old_hash_parts["project_info"] != new_hash_parts["project_info"]:
        changed.extend(["risk_assessment", "reference_cases"])

    if old_hash_parts["answers"] != new_hash_parts["answers"]:
        # Answer changes also affect reference cases (embedding changes)
        if "reference_cases" not in changed:
            changed.append("reference_cases")

    return changed if changed else None  # None = no re-analysis needed
```

## Service Architecture

### `ai_review_analysis.py` — Core Service

```python
class AIReviewAnalyzer:
    """Orchestrates all 5 analysis dimensions."""

    async def run_analysis(self, db, domain_review_id, trigger_event, dimensions=None):
        """Main entry: run analysis for specified dimensions."""
        # 1. Gather context (reuse _build_system_prompt pattern from ask_egm)
        # 2. For each dimension, build specific prompt + parse structured output
        # 3. Store results in ai_review_analysis table
        # 4. Return analysis ID

    async def analyze_risk(self, context) -> dict:
        """Dimension 1: Risk pre-assessment."""

    async def analyze_reference_cases(self, db, context) -> dict:
        """Dimension 2: Similar cases via embedding + LLM analysis."""

    async def analyze_consistency(self, context) -> dict:
        """Dimension 3: Contradiction detection."""

    async def analyze_completeness(self, context) -> dict:
        """Dimension 4: Information gap identification."""

    async def analyze_accuracy(self, context) -> dict:
        """Dimension 5: Factual error detection."""

    def _build_analysis_context(self, db, domain_review_id) -> dict:
        """Collect all context needed for analysis."""
        # Reuse pattern from ask_egm._build_system_prompt()
        # Returns: { review, request, questionnaire_qa, project_info, domain_info }
```

### LLM Interaction Pattern

Each dimension uses a dedicated prompt with **JSON output enforcement**:
```python
response = client.chat.completions.create(
    model=settings.LLM_MODEL,
    messages=[
        {"role": "system", "content": dimension_system_prompt},
        {"role": "user", "content": analysis_context_text}
    ],
    temperature=0.3,        # Lower than chat (0.7) for more deterministic analysis
    response_format={"type": "json_object"},  # Enforce JSON output
    max_tokens=4096,
)
```

## UI Behavior

### Placement
Between **Domain Questionnaire** section and **Activity Log** section on the Domain Review Detail page.

### Layout
```
┌─ AI Analysis ──────────────────────────────────────────────────┐
│  Version 2 · Triggered by Resubmit · Mar 16, 2026 10:00      │
│  Overall Score: ████████░░ 0.72                                │
│  [View Previous Versions ▾]                                    │
│                                                                │
│  ┌─ 1. Risk Assessment ─────────────────────────── HIGH ──┐   │
│  │  Risk Level: 🔴 HIGH                                    │   │
│  │  Recommended Review Depth: FULL (est. 2-3 hours)        │   │
│  │                                                          │   │
│  │  Risk Factors:                                           │   │
│  │  • Involves PII with cross-border data transfer          │   │
│  │  • Third-party SaaS vendor without SOC2                  │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                │
│  ┌─ 2. Reference Cases ────────────── Suggested: Approve ─┐   │
│  │  Confidence: 72%                                         │   │
│  │                                                          │   │
│  │  Similar Case #1 (87% match): EGM-2026-0042             │   │
│  │    HR Analytics Dashboard · Approved                     │   │
│  │    Key difference: No cross-border transfer              │   │
│  │                                                          │   │
│  │  Similar Case #2 (82% match): EGM-2026-0031             │   │
│  │    Employee Portal v2 · Approved with Exception          │   │
│  │    Key difference: Had SOC2 certification                │   │
│  │                                                          │   │
│  │  ⚠️ Attention: Verify data residency for EU regions      │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                │
│  ┌─ 3. Consistency Analysis ─────────────── Score: 0.65 ──┐   │
│  │  ⚠️ 1 contradiction found                               │   │
│  │                                                          │   │
│  │  🔴 HIGH: Q3 ↔ Q7 (intra-domain)                        │   │
│  │  Q3: "No PII involved"                                   │   │
│  │  Q7: "Data sources: HR, Payroll"                         │   │
│  │  → HR/Payroll systems typically contain PII              │   │
│  │  [Create ISR →]                                          │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                │
│  ┌─ 4. Completeness Analysis ────────────── Score: 0.60 ──┐   │
│  │  📋 3 information gaps found                             │   │
│  │                                                          │   │
│  │  Brief Answers:                                          │   │
│  │  • Q5: Missing transmission protocol, encryption method  │   │
│  │                                                          │   │
│  │  Information Gaps:                                        │   │
│  │  🔴 Data Retention Policy (HIGH)                         │   │
│  │  🟡 Cross-border Transfer Details (MEDIUM)               │   │
│  │  🟢 Backup Strategy (LOW)                                │   │
│  │  [Create ISR with gaps →]                                │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                │
│  ┌─ 5. Accuracy Analysis ─────────────── 1 issue found ───┐   │
│  │  🔴 Technical Error:                                     │   │
│  │  Q5: Claims "AES-512 encryption"                         │   │
│  │  → AES only supports 128/192/256 bit keys                │   │
│  │                                                          │   │
│  │  ⚠️ Scale Concern:                                       │   │
│  │  Global deployment in 3 months with 3-person team        │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                │
│  [Re-run Analysis]                                             │
└────────────────────────────────────────────────────────────────┘
```

### Version Comparison
- Dropdown to select previous versions
- Changed dimensions marked with "Updated" badge
- Unchanged dimensions marked with "Carried forward from v{N}" label

### States
| State | UI Display |
|-------|-----------|
| `pending` | Skeleton loading with "AI Analysis queued..." |
| `running` | Progress spinner with "Analyzing dimension X of 5..." |
| `completed` | Full results as shown above |
| `failed` | Error message with "Re-run Analysis" button |
| No analysis yet | "Analysis will be generated after submission" placeholder |

### RBAC
- **Reviewer / Admin / Governance Lead**: Full access — see all dimensions, re-run
- **Requestor**: Read-only — see scores and summaries (no "Create ISR" buttons)

## Acceptance Criteria

### Backend — API
- [x] AC-1: POST `/trigger` creates analysis record with status='pending', then runs
- [x] AC-2: POST `/trigger` with triggerEvent='submit' runs all 5 dimensions
- [x] AC-3: POST `/trigger` with triggerEvent='resubmit' only re-runs changed dimensions
- [x] AC-4: GET `/{domain_review_id}` returns latest completed analysis
- [x] AC-5: GET `/{domain_review_id}/versions` returns all versions ordered by version DESC
- [x] AC-6: Analysis auto-triggered on governance request submit
- [x] AC-7: Analysis auto-triggered on domain review resubmit
- [x] AC-8: Returns 503 when LLM is not configured
- [x] AC-9: Failed analysis records error_message and sets status='failed'

### Backend — Analysis Dimensions
- [x] AC-10: Risk Assessment outputs riskLevel, riskFactors, recommendedDepth
- [x] AC-11: Reference Cases uses embedding similarity search for same-domain history
- [x] AC-12: Reference Cases returns suggestedOutcome only when confidence >= 0.6
- [x] AC-13: Reference Cases skips suggestion when < 3 historical cases exist
- [x] AC-14: Consistency Analysis detects intra-domain, cross-domain, and vs-description contradictions
- [x] AC-15: Completeness Analysis evaluates per-question quality (SUFFICIENT/BRIEF/INADEQUATE)
- [x] AC-16: Completeness Analysis identifies information gaps with importance levels
- [x] AC-17: Accuracy Analysis only flags high-confidence factual errors
- [x] AC-18: All dimensions return structured JSON matching schema

### Backend — Versioning
- [x] AC-19: Each trigger creates a new version (monotonically increasing)
- [x] AC-20: Change detection compares content_hash to determine which dimensions to re-run
- [x] AC-21: Unchanged dimensions are copied from previous version (not re-analyzed)
- [x] AC-22: content_hash computed from questionnaire answers + project info

### Frontend
- [x] AC-23: AI Analysis section appears between Domain Questionnaire and Activity Log
- [x] AC-24: Shows loading skeleton while analysis is pending/running
- [x] AC-25: Displays all 5 dimension results when completed
- [x] AC-26: Version dropdown shows history with trigger event labels
- [x] AC-27: Changed dimensions show "Updated" badge; unchanged show "Carried forward"
- [x] AC-28: "Re-run Analysis" button triggers POST /trigger with triggerEvent='manual'
- [x] AC-29: Severity colors: RED for HIGH, YELLOW for MEDIUM, GREEN for LOW
- [x] AC-30: Requestor sees read-only view (no re-run button, no ISR creation)

## Implementation Plan

### Step 1: Database Migration
Create `ai_review_analysis` table with versioned structure.

**Files**: `scripts/migration_ai_review_analysis.sql`

### Step 2: Core Analysis Service
Build `AIReviewAnalyzer` class with context gathering and 5 dimension analyzers.

**Files**: `backend/app/services/ai_review_analysis.py`

### Step 3: API Router
Endpoints for trigger, get latest, get versions.

**Files**: `backend/app/routers/review_analysis.py`, `backend/app/main.py`, `backend/app/auth/rbac.py`

### Step 4: Submit/Resubmit Hooks
Add auto-trigger calls in governance_requests.submit_request() and domain_reviews.resubmit_review().

**Files**: `backend/app/routers/governance_requests.py`, `backend/app/routers/domain_reviews.py`

### Step 5: Frontend Component
Build AIAnalysisSection with 5 collapsible sub-sections + version selector.

**Files**: `frontend/src/app/governance/_components/AIAnalysisSection.tsx`

### Step 6: Page Integration
Insert component between questionnaire and activity log sections.

**Files**: `frontend/src/app/governance/[requestId]/reviews/[domainCode]/page.tsx`

### Step 7: Tests
API tests covering all ACs + test-map updates.

**Files**: `api-tests/test_review_analysis.py`, `scripts/test-map.json`

### Step 8: Verification
Full regression + feature doc update.

## Test Coverage

### API Tests
- `api-tests/test_review_analysis.py::test_trigger_creates_analysis` — AC-1
- `api-tests/test_review_analysis.py::test_trigger_submit_runs_all_dimensions` — AC-2
- `api-tests/test_review_analysis.py::test_trigger_resubmit_change_detection` — AC-3, AC-20, AC-21
- `api-tests/test_review_analysis.py::test_get_latest_analysis` — AC-4
- `api-tests/test_review_analysis.py::test_get_versions` — AC-5, AC-19
- `api-tests/test_review_analysis.py::test_llm_not_configured_503` — AC-8
- `api-tests/test_review_analysis.py::test_failed_analysis_error` — AC-9
- `api-tests/test_review_analysis.py::test_json_schema_validation` — AC-18

### E2E Tests
- Manual verification for UI (AC-23 through AC-30)

## Test Map Entries

```
backend/app/services/ai_review_analysis.py -> api-tests/test_review_analysis.py
backend/app/routers/review_analysis.py     -> api-tests/test_review_analysis.py
frontend/src/app/governance/_components/AIAnalysisSection.tsx -> (manual)
```

## Notes

- **Temperature**: Analysis uses 0.3 (lower than chat's 0.7) for more deterministic, structured output
- **JSON mode**: Uses `response_format={"type": "json_object"}` for reliable parsing
- **Async execution**: Analysis runs synchronously in the trigger endpoint (blocking). Future optimization: background task queue
- **LLM cost**: 5 separate LLM calls per analysis. Each ~1-2K tokens input, ~500-1K output. Total ~10K tokens/analysis
- **Embedding reuse**: Reference case analysis reuses `find_similar_reviews()` from `embeddings.py`
- **Graceful degradation**: If embedding not configured, reference cases returns empty (no error)
- **ISR integration**: Future enhancement — "Create ISR" buttons on consistency/completeness findings auto-generate Information Supplementary Requests
