# Domain Review & Rule Dispatch Mechanism

This document describes how governance domains are determined from dispatch rules, and how domain reviews are created and dispatched.

---

## 1. Overview

The dispatch system connects **Requestor intent** (selecting applicable rules) to **Governance outcomes** (domain-specific reviews). The flow is:

```mermaid
flowchart LR
    A[Requestor selects\nrules on form] --> B[Auto-aggregation\n& constraint check]
    B --> C[Rules saved\nto request]
    C --> D[Submit request\nwith validation]
    D --> E[Triggered domains\ncalculated]
    E --> F[Domain reviews\ncreated]
    F --> G[Reviews dispatched\nto reviewers]

    style A fill:#e6f3ff,stroke:#1890ff
    style D fill:#fff7e6,stroke:#fa8c16
    style F fill:#f6ffed,stroke:#52c41a
```

---

## 2. Data Model

### Entity Relationship

```mermaid
erDiagram
    dispatch_rule {
        UUID id PK
        VARCHAR rule_code UK "e.g. AI, SECURITY"
        VARCHAR rule_name
        TEXT description
        VARCHAR parent_rule_code FK "NULL = L1 rule"
        BOOLEAN is_mandatory
        BOOLEAN is_active
        INT sort_order
    }

    dispatch_rule_domain {
        UUID id PK
        UUID rule_id FK
        VARCHAR domain_code
        VARCHAR relationship "in | out"
    }

    dispatch_rule_exclusion {
        UUID id PK
        VARCHAR rule_code FK
        VARCHAR excluded_rule_code FK
    }

    dispatch_rule_dependency {
        UUID id PK
        VARCHAR rule_code FK
        VARCHAR required_rule_code FK
    }

    governance_request_rule {
        UUID id PK
        UUID request_id FK
        VARCHAR rule_code FK
        BOOLEAN is_auto "TRUE = parent auto-added"
    }

    domain_registry {
        UUID id PK
        VARCHAR domain_code UK
        VARCHAR domain_name
        VARCHAR integration_type "internal | external"
        BOOLEAN is_active
    }

    domain_review {
        UUID id PK
        UUID request_id FK
        VARCHAR domain_code
        VARCHAR status
        VARCHAR outcome
    }

    dispatch_rule ||--o{ dispatch_rule_domain : "maps to domains"
    dispatch_rule ||--o{ dispatch_rule_exclusion : "excludes"
    dispatch_rule ||--o{ dispatch_rule_dependency : "depends on"
    dispatch_rule ||--o{ governance_request_rule : "selected by"
    domain_registry ||--o{ dispatch_rule_domain : "referenced by"
    domain_registry ||--o{ domain_review : "reviewed under"
```

### Table Descriptions

| Table | Purpose |
|-------|---------|
| `dispatch_rule` | Rule definitions with 2-level hierarchy (L1 parent → L2 children) |
| `dispatch_rule_domain` | Matrix mapping each rule to domains (`'in'` = triggers, `'out'` = does not trigger) |
| `dispatch_rule_exclusion` | Mutual exclusion pairs (bidirectional) |
| `dispatch_rule_dependency` | Prerequisite requirements (unidirectional, OR semantics) |
| `governance_request_rule` | Junction table: which rules a request has selected |
| `domain_registry` | Governance domain definitions (internal vs external) |
| `domain_review` | Created on submission, one per triggered domain per request |

---

## 3. Rule Hierarchy (L1 / L2)

Rules are organized in a **two-level hierarchy**:

```
L1: Data Governance          (parent, rule_code = "DATA_GOV")
  ├── L2: Personal Data      (child, parent_rule_code = "DATA_GOV")
  ├── L2: Cross-border Data  (child, parent_rule_code = "DATA_GOV")
  └── L2: Data Retention     (child, parent_rule_code = "DATA_GOV")

L1: AI Usage                 (parent, rule_code = "AI")
  ├── L2: GenAI              (child, parent_rule_code = "AI")
  └── L2: ML Models          (child, parent_rule_code = "AI")

L1: Security Review          (standalone L1, no children)
```

**Key behaviors:**
- L1 rules are **header-level** — they appear as section titles in the UI
- L2 rules are **selectable** — the requestor toggles YES/NO on each
- L1 rules with children are **not directly selectable** — they are auto-included when any child is selected
- L1 rules without children **are selectable** (standalone rules)

---

## 4. Auto-Parent Aggregation

When a requestor selects an L2 child rule, the L1 parent is **automatically included** in the rule set.

```mermaid
flowchart TD
    subgraph User Selection
        A[User selects L2:\nPersonal Data] --> B[User selects L2:\nGenAI]
    end

    subgraph Auto Aggregation
        B --> C{Find parents of\nselected children}
        C --> D[Auto-add L1:\nData Governance]
        C --> E[Auto-add L1:\nAI Usage]
    end

    subgraph Final Rule Set
        D --> F["Selected: Personal Data, GenAI\nAuto: Data Governance, AI Usage"]
    end

    style A fill:#e6f3ff,stroke:#1890ff
    style B fill:#e6f3ff,stroke:#1890ff
    style D fill:#fff7e6,stroke:#fa8c16
    style E fill:#fff7e6,stroke:#fa8c16
    style F fill:#f6ffed,stroke:#52c41a
```

**Backend implementation** (on save):
```sql
-- 1. Save user-selected rules (is_auto = FALSE)
INSERT INTO governance_request_rule (request_id, rule_code, is_auto)
VALUES (:rid, :user_selected_code, FALSE);

-- 2. Auto-add parent rules (is_auto = TRUE)
INSERT INTO governance_request_rule (request_id, rule_code, is_auto)
SELECT :rid, parent_rule_code, TRUE
FROM dispatch_rule
WHERE rule_code = ANY(:selected_codes)
  AND parent_rule_code IS NOT NULL
  AND is_active = TRUE;
```

---

## 5. Constraint System

### 5.1 Mutual Exclusions

Two rules that cannot be selected together.

**Scoping rules:**
- L1 can exclude L1 only
- L2 can exclude sibling L2 only (same parent)

**Behavior:** When rule A is selected and A excludes B, rule B is disabled in the UI. If B was previously selected, it is automatically deselected.

**Auto-parent cascading:** If an auto-aggregated parent is excluded, all of its children are also disabled.

### 5.2 Dependencies (Prerequisites)

A rule may require one or more other rules to be active.

**OR semantics:** If rule A depends on [B, C], then A can be selected if **at least one** of B or C is active (directly selected or auto-aggregated).

**Cascade behavior:** If a rule is deselected and another rule's only remaining dependency was that rule, the dependent rule is also deselected.

### 5.3 Mandatory Rules

Rules marked `is_mandatory = TRUE` must be present in the final rule set.

**Exclusion exemption:** A mandatory rule is exempt if it is **excluded by** a selected rule. This prevents impossible validation states.

```mermaid
flowchart TD
    A[Check mandatory rules] --> B{Mandatory rule\nin selected set?}
    B -->|Yes| C[OK - satisfied]
    B -->|No| D{Excluded by a\nselected rule?}
    D -->|Yes| E[OK - exempt]
    D -->|No| F[FAIL - missing\nmandatory rule]

    style C fill:#f6ffed,stroke:#52c41a
    style E fill:#f6ffed,stroke:#52c41a
    style F fill:#fff1f0,stroke:#ef4444
```

---

## 6. Domain Triggering

Domains are triggered based on the **rule ↔ domain matrix**. The `dispatch_rule_domain` table stores `relationship = 'in'` (triggers) or `'out'` (does not trigger) for each rule-domain pair.

```mermaid
flowchart TD
    subgraph Selected Rules
        R1[Personal Data]
        R2[GenAI]
    end

    subgraph Auto Parents
        R3[Data Governance]
        R4[AI Usage]
    end

    subgraph Rule-Domain Matrix
        R1 -->|in| D1[Privacy Domain]
        R1 -->|in| D2[Legal Domain]
        R3 -->|in| D2
        R3 -->|in| D3[Compliance Domain]
        R2 -->|in| D4[AI Ethics Domain]
        R4 -->|in| D4
        R4 -->|in| D5[Security Domain]
    end

    subgraph Triggered Domains
        D1
        D2
        D3
        D4
        D5
    end

    style R1 fill:#e6f3ff,stroke:#1890ff
    style R2 fill:#e6f3ff,stroke:#1890ff
    style R3 fill:#fff7e6,stroke:#fa8c16
    style R4 fill:#fff7e6,stroke:#fa8c16
    style D1 fill:#f6ffed,stroke:#52c41a
    style D2 fill:#f6ffed,stroke:#52c41a
    style D3 fill:#f6ffed,stroke:#52c41a
    style D4 fill:#f6ffed,stroke:#52c41a
    style D5 fill:#f6ffed,stroke:#52c41a
```

**Domain calculation combines:**
1. Domains from user-selected rules (L1 standalone or L2)
2. Domains from auto-aggregated L1 parent rules

```sql
SELECT DISTINCT crd.domain_code
FROM governance_request_rule grr
JOIN dispatch_rule cr ON cr.rule_code = grr.rule_code AND cr.is_active = TRUE
JOIN dispatch_rule_domain crd ON crd.rule_id = cr.id AND crd.relationship = 'in'
WHERE grr.request_id = :rid
```

---

## 7. Frontend: GovernanceScopeDetermination Component

The `GovernanceScopeDetermination` component (`frontend/src/app/governance/_components/GovernanceScopeDetermination.tsx`) implements the rule selection UI.

### Data Source

Fetches `GET /dispatch-rules/matrix` which returns:

```typescript
{
  rules: [{ ruleCode, ruleName, parentRuleCode, isMandatory, sortOrder }],
  domains: [{ domainCode, domainName }],
  matrix: { [ruleCode]: { [domainCode]: "in" | "out" } },
  exclusions: { [ruleCode]: [excludedCodes...] },
  dependencies: { [ruleCode]: [requiredCodes...] }  // OR semantics
}
```

### UI Flow

```mermaid
flowchart TD
    A[Render rule list\ngrouped by L1 parent] --> B[User toggles\nL2 rule YES/NO]
    B --> C[Update selectedRules]
    C --> D[Compute auto-parent codes]
    D --> E[Compute exclusion map\n- disable conflicting rules]
    E --> F[Compute dependency map\n- disable rules with\nunsatisfied prerequisites]
    F --> G[Compute triggered domains\nfrom matrix]
    G --> H[Render domain preview chips]
    H --> I[Callback: onRulesChange\nonTriggeredDomainsChange]

    style B fill:#e6f3ff,stroke:#1890ff
    style G fill:#f6ffed,stroke:#52c41a
    style H fill:#f6ffed,stroke:#52c41a
```

### Visual Layout

Each L1 rule appears as a **section header**. Its L2 children appear below with YES/NO toggle buttons:

```
┌──────────────────────────────────────────────┐
│ Data Governance                    [Auto ✓]  │
│  ├── Personal Data          [YES] / [ NO ]   │
│  ├── Cross-border Data      [ YES] / [NO ]   │
│  └── Data Retention         [YES] / [ NO ]   │
├──────────────────────────────────────────────┤
│ AI Usage                           [Auto ✓]  │
│  ├── GenAI                  [YES] / [ NO ]   │
│  └── ML Models              [ YES] / [NO ]   │
├──────────────────────────────────────────────┤
│ Security Review             [YES] / [ NO ]   │
│ (standalone L1 — directly selectable)        │
└──────────────────────────────────────────────┘

Triggered Domains:
[Privacy] [Legal] [Compliance] [AI Ethics] [Security]
```

---

## 8. Submission & Domain Review Creation

### Validation Pipeline

```mermaid
flowchart TD
    A[PUT /submit] --> B[Check status = Draft]
    B --> C[Validate required fields\ngovProjectType, businessUnit,\nproductSoftwareType, etc.]
    C --> D[Fetch all saved rules\nselected + auto-parents]
    D --> E[Validate mandatory rules\nwith exclusion exemption]
    E --> F[Validate dependencies\nOR semantics]
    F --> G[Calculate triggered domains]
    G --> H{At least 1\ndomain triggered?}
    H -->|No| I[FAIL: No domains]
    H -->|Yes| J[Validate internal domain\nquestionnaires complete]
    J --> K{All required\nanswered?}
    K -->|No| L[FAIL: Incomplete\nquestionnaires]
    K -->|Yes| M[Update status:\nDraft → Submitted]
    M --> N[Create domain_review\nrecords per domain]
    N --> O[Status: Waiting for Accept]

    style I fill:#fff1f0,stroke:#ef4444
    style L fill:#fff1f0,stroke:#ef4444
    style O fill:#f6ffed,stroke:#52c41a
```

### Domain Review Creation

On successful submission:

```sql
INSERT INTO domain_review (request_id, domain_code, status, create_by, update_by)
SELECT :request_id, domain_code, 'Waiting for Accept', :user, :user
FROM (
    SELECT DISTINCT crd.domain_code
    FROM governance_request_rule grr
    JOIN dispatch_rule cr ON cr.rule_code = grr.rule_code AND cr.is_active = TRUE
    JOIN dispatch_rule_domain crd ON crd.rule_id = cr.id AND crd.relationship = 'in'
    WHERE grr.request_id = :rid
) triggered
ON CONFLICT (request_id, domain_code) DO NOTHING;
```

Each triggered domain gets exactly one `domain_review` record. The review follows its own lifecycle (see [State Machine](./state-machine.md)).

---

## 9. Dispatch Execution

After submission, a Governance Lead or Admin can **execute the dispatch** via `POST /dispatcher/execute/{requestId}`:

1. Transitions request from **Submitted** → **In Progress**
2. Domain reviews remain in **Waiting for Accept** status until reviewers are assigned and begin work

```mermaid
sequenceDiagram
    participant R as Requestor
    participant S as System
    participant GL as Governance Lead
    participant DR as Domain Reviewer

    R->>S: Submit Request
    S->>S: Validate & create domain reviews

    GL->>S: Execute Dispatch
    S->>S: Request: Submitted → In Progress

    GL->>S: Assign reviewer to domain A
    S->>S: Review A: WFA → Assigned
    DR->>S: Start review
    S->>S: Review A: Assigned → In Progress
    DR->>S: Complete with outcome
    S->>S: Review A: → Review Complete

    Note over S: Repeat for each domain
```

---

## 10. API Endpoints

### Dispatch Rules Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/dispatch-rules/` | List all rules with relationships |
| `GET` | `/dispatch-rules/matrix` | Full matrix for frontend UI |
| `GET` | `/dispatch-rules/{code}` | Single rule detail |
| `POST` | `/dispatch-rules/` | Create new rule |
| `PUT` | `/dispatch-rules/{code}` | Update rule |
| `DELETE` | `/dispatch-rules/{code}` | Soft-delete (toggle is_active) |
| `PUT` | `/dispatch-rules/matrix` | Batch update domain relationships |
| `PUT` | `/dispatch-rules/exclusions` | Batch update exclusion pairs |
| `PUT` | `/dispatch-rules/dependencies` | Batch update dependencies |
| `PUT` | `/dispatch-rules/reorder` | Update sort_order |

### Request-Level Rule Operations

| Method | Endpoint | Description |
|--------|----------|-------------|
| `PUT` | `/governance-requests/{id}` | Save selected `ruleCodes` (Draft only) |
| `PUT` | `/governance-requests/{id}/submit` | Validate rules & create domain reviews |

### Dispatcher

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/dispatcher/execute/{id}` | Transition Submitted → In Progress |

---

## Source Files

| File | Role |
|------|------|
| `backend/app/routers/dispatch_rules.py` | Rule CRUD, matrix, exclusions, dependencies API |
| `backend/app/routers/governance_requests.py` | Rule save on update, submit validation & domain review creation |
| `backend/app/routers/dispatcher.py` | Execute dispatch transition |
| `backend/app/routers/domain_reviews.py` | Domain review lifecycle endpoints |
| `frontend/src/app/governance/_components/GovernanceScopeDetermination.tsx` | Rule selection UI component |
| `scripts/schema.sql` | All table definitions |
