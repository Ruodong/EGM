# EGM State Machine

This document describes the complete status lifecycle for **Governance Requests** and **Domain Reviews** in the EGM system.

---

## 1. Governance Request — Workflow Status

A governance request progresses through a simple linear workflow. Submit auto-creates domain reviews; the first Accept triggers In Progress; all terminal reviews trigger Complete.

```mermaid
stateDiagram-v2
    direction LR

    [*] --> Draft : Create Request

    Draft --> Submitted : Submit\n(PUT /submit)
    Submitted --> InProgress : First Domain Review\nAccepted
    InProgress --> Complete : All Domain Reviews\nReach Terminal Status

    state Draft {
        direction LR
        [*] --> Editing
        Editing --> Editing : Save Draft
        note right of Editing
            Owner can edit all fields,
            select rules, answer
            domain questionnaires
        end note
    }

    note right of Submitted
        Domain reviews auto-created
        with "Waiting for Accept" status.
        No dispatcher step needed.
    end note

    note right of Complete
        Terminal state. All domain
        reviews are Approved,
        Approved with Exception,
        or Not Passed.
    end note
```

### Transition Details

| # | From | To | Trigger | Who | Conditions | Side Effects |
|---|------|----|---------|-----|------------|--------------|
| 1 | **Draft** | **Submitted** | `PUT /{id}/submit` | Requestor (owner) | All required fields filled; mandatory rules satisfied; rule dependencies met; at least 1 domain triggered; required domain questionnaires answered | Creates `domain_review` records (status = "Waiting for Accept") for each triggered domain |
| 2 | **Submitted** | **In Progress** | First `PUT /domain-reviews/{id}/accept` | Domain Reviewer / Governance Lead | At least one domain review accepted | Automatic — triggered when the first domain review transitions to "Accept" |
| 3 | **In Progress** | **Complete** | All reviews terminal | System (automatic) | All domain reviews in terminal status (Approved, Approved with Exception, or Not Passed) | Automatic — checked after each terminal transition via `_check_auto_complete()` |

> **Note:** Requestors can edit request fields and domain questionnaire answers in any status except Complete. All changes are tracked in `governance_request_change_log`.

---

## 2. Governance Request — Lifecycle Status

Lifecycle status is an **orthogonal dimension** independent of the workflow status. It controls visibility in the request list.

```mermaid
stateDiagram-v2
    direction LR

    [*] --> Active : Create Request

    Active --> Cancelled : Cancel\n(PUT /cancel)
    Active --> Archived : Archive\n(PUT /archive)

    Cancelled --> [*]
    Archived --> [*]

    note right of Active
        Default state.
        Shown in request list.
    end note

    note right of Cancelled
        Hidden from list by default.
        Filterable via lifecycle dropdown.
    end note

    note right of Archived
        Hidden from list by default.
        Filterable via lifecycle dropdown.
    end note
```

### Transition Details

| # | From | To | Endpoint | Who | Conditions |
|---|------|----|----------|-----|------------|
| 1 | **Active** | **Cancelled** | `PUT /{id}/cancel` | Requestor (owner) | Workflow status must be **Draft** |
| 2 | **Active** | **Archived** | `PUT /{id}/archive` | Admin / Governance Lead | Workflow status must be **Complete** |

> Cancelled and Archived are **terminal states** — no transitions back to Active.

---

## 3. Domain Review — Status Lifecycle

Each governance request can have multiple domain reviews (one per triggered governance domain). Each review follows a 6-state lifecycle.

```mermaid
flowchart TB
    START(("Create")) -->|"Request Submitted\n(auto-created per domain)"| WFA

    WFA["<b>Waiting for Accept</b>\n\nInitial status.\nReviewer can accept or return."]

    WFA -->|"PUT /accept"| ACC
    WFA -->|"PUT /return\n(reason required)"| RET

    RET["<b>Return for Additional Information</b>\n\nRequestor needs to provide\nadditional information.\nReturn reason is recorded."]

    RET -->|"PUT /resubmit\n(by Requestor)"| WFA

    ACC["<b>Accept</b>\n\nReviewer has accepted.\nOne-way — cannot return\nafter accepting.\nFirst accept triggers\nrequest In Progress."]

    ACC -->|"PUT /approve"| APR
    ACC -->|"PUT /approve-with-exception\n(notes required)"| EXC
    ACC -->|"PUT /not-pass\n(notes required)"| NP

    APR["<b>Approved</b>\n\nDomain review passed\nwithout conditions."]
    EXC["<b>Approved with Exception</b>\n\nPassed with exceptions\nthat must be addressed."]
    NP["<b>Not Passed</b>\n\nDomain review\ndid not pass."]

    APR --> DONE
    EXC --> DONE
    NP --> DONE

    DONE(("Terminal\n✓ auto-complete check"))

    style WFA fill:#e6f3ff,stroke:#1890ff,stroke-width:2px,color:#000
    style RET fill:#fff7e6,stroke:#fa8c16,stroke-width:2px,color:#000
    style ACC fill:#e6fffb,stroke:#13c2c2,stroke-width:2px,color:#000
    style APR fill:#f6ffed,stroke:#52c41a,stroke-width:2px,color:#000
    style EXC fill:#fffbe6,stroke:#faad14,stroke-width:2px,color:#000
    style NP fill:#fff1f0,stroke:#ff4d4f,stroke-width:2px,color:#000
    style START fill:#d9d9d9,stroke:#595959,color:#000
    style DONE fill:#d9d9d9,stroke:#595959,color:#000
```

### Transition Details

| # | From | To | Endpoint | Who | Conditions | Side Effects |
|---|------|----|----------|-----|------------|--------------|
| 1 | *(created)* | **Waiting for Accept** | `PUT /{requestId}/submit` | System | Automatic on request submission | One review per triggered domain |
| 2 | **Waiting for Accept** | **Accept** | `PUT /{reviewId}/accept` | Domain Reviewer / Governance Lead | — | Sets `reviewer`, `started_at`; if request is Submitted → In Progress |
| 3 | **Waiting for Accept** | **Return for Additional Information** | `PUT /{reviewId}/return` | Domain Reviewer / Governance Lead | Return reason required | Sets `return_reason`; does **NOT** change request status |
| 4 | **Return for Additional Information** | **Waiting for Accept** | `PUT /{reviewId}/resubmit` | Requestor | — | Clears `return_reason` |
| 5 | **Accept** | **Approved** | `PUT /{reviewId}/approve` | Domain Reviewer / Governance Lead | — | Sets `completed_at`; triggers auto-complete check |
| 6 | **Accept** | **Approved with Exception** | `PUT /{reviewId}/approve-with-exception` | Domain Reviewer / Governance Lead | — | Sets `outcome_notes`, `completed_at`; triggers auto-complete check |
| 7 | **Accept** | **Not Passed** | `PUT /{reviewId}/not-pass` | Domain Reviewer / Governance Lead | — | Sets `outcome_notes`, `completed_at`; triggers auto-complete check |

### Terminal Statuses

| Status | Meaning |
|--------|---------|
| **Approved** | Domain review passed without conditions |
| **Approved with Exception** | Passed with exceptions that must be addressed |
| **Not Passed** | Domain review did not pass |

### Key Rules

- **Accept is one-way**: Once a review is accepted, it cannot be returned. The reviewer must proceed to a terminal decision.
- **Return does not change request status**: Unlike the old system, returning a review does NOT move the governance request to a different status.
- **Auto-complete**: When ALL domain reviews for a request reach terminal status, the request automatically transitions to Complete.
- **Race condition prevention**: Auto-complete uses `SELECT FOR UPDATE` to prevent duplicate transitions when two reviewers complete simultaneously.

### Status Change Logic

#### PUT /accept

```mermaid
flowchart TB
    A1["Receive PUT /domain-reviews/{id}/accept"]
    A1 --> A2{Review status ==\nWaiting for Accept?}
    A2 -->|No| A2E["Return 400\nBad Request"]
    A2 -->|Yes| A3["Set review status = Accept"]
    A3 --> A4["Set reviewer = current user\nSet started_at = now()"]
    A4 --> A5{Request status\n== Submitted?}
    A5 -->|Yes| A6["Set request status = In Progress\n(first domain review accepted)"]
    A5 -->|No| A7["Skip — request already\nIn Progress or later"]
    A6 --> A8["Return 200 OK"]
    A7 --> A8
```

#### PUT /return

```mermaid
flowchart TB
    R1["Receive PUT /domain-reviews/{id}/return"]
    R1 --> R2{Review status ==\nWaiting for Accept?}
    R2 -->|No| R2E["Return 400\nBad Request"]
    R2 -->|Yes| R3{returnReason\nprovided?}
    R3 -->|No| R3E["Return 400\nBad Request — reason required"]
    R3 -->|Yes| R4["Set review status =\nReturn for Additional Information"]
    R4 --> R5["Set return_reason"]
    R5 --> R6["Request status unchanged\n(no side effect on request)"]
    R6 --> R7["Return 200 OK"]
```

#### PUT /resubmit

```mermaid
flowchart TB
    S1["Receive PUT /domain-reviews/{id}/resubmit"]
    S1 --> S2{Review status ==\nReturn for Additional Information?}
    S2 -->|No| S2E["Return 400\nBad Request"]
    S2 -->|Yes| S3["Set review status =\nWaiting for Accept"]
    S3 --> S4["Clear return_reason"]
    S4 --> S5["Return 200 OK"]
```

#### PUT /approve

```mermaid
flowchart TB
    P1["Receive PUT /domain-reviews/{id}/approve"]
    P1 --> P2{Review status ==\nAccept?}
    P2 -->|No| P2E["Return 400\nBad Request"]
    P2 -->|Yes| P3["Set review status = Approved"]
    P3 --> P4["Set completed_at = now()"]
    P4 --> P5["Call _check_auto_complete()"]
    P5 --> P6["Return 200 OK"]
```

#### PUT /approve-with-exception

```mermaid
flowchart TB
    E1["Receive PUT /domain-reviews/{id}/approve-with-exception"]
    E1 --> E2{Review status ==\nAccept?}
    E2 -->|No| E2E["Return 400\nBad Request"]
    E2 -->|Yes| E3["Set review status =\nApproved with Exception"]
    E3 --> E4["Set outcome_notes\nSet completed_at = now()"]
    E4 --> E5["Call _check_auto_complete()"]
    E5 --> E6["Return 200 OK"]
```

#### PUT /not-pass

```mermaid
flowchart TB
    N1["Receive PUT /domain-reviews/{id}/not-pass"]
    N1 --> N2{Review status ==\nAccept?}
    N2 -->|No| N2E["Return 400\nBad Request"]
    N2 -->|Yes| N3["Set review status = Not Passed"]
    N3 --> N4["Set outcome_notes\nSet completed_at = now()"]
    N4 --> N5["Call _check_auto_complete()"]
    N5 --> N6["Return 200 OK"]
```

#### _check_auto_complete(request_id)

```mermaid
flowchart TB
    AC1["SELECT FOR UPDATE\ngovernance_request row\n(lock to prevent race condition)"]
    AC1 --> AC2["Query all domain_reviews\nfor this request_id"]
    AC2 --> AC3{All reviews in\nterminal status?\nApproved / Approved with Exception / Not Passed}
    AC3 -->|No| AC4["Return — no change\n(some reviews still pending)"]
    AC3 -->|Yes| AC5{Request status\nalready Complete?}
    AC5 -->|Yes| AC6["Return — already complete\n(idempotent)"]
    AC5 -->|No| AC7["Set request status = Complete\nSet update_by, update_at"]
    AC7 --> AC8["Write audit_log entry\n(action: auto_complete)"]
    AC8 --> AC9["Return"]
```

---

## 4. Permission Matrix

### Governance Request Actions

| Action | Requestor (Owner) | Domain Reviewer | Governance Lead | Admin |
|--------|:-:|:-:|:-:|:-:|
| Create / Edit Draft | Yes | — | — | — |
| Submit | Yes | — | — | — |
| Edit after Submit | Yes | — | — | — |
| Cancel (Draft) | Yes | — | — | Yes |
| Archive (Complete) | — | — | Yes | Yes |
| Copy | Yes | — | — | — |

### Domain Review Actions

| Action | Requestor | Domain Reviewer | Governance Lead | Admin |
|--------|:-:|:-:|:-:|:-:|
| Accept | — | Own domains | Yes | Yes |
| Return for Info | — | Own domains | Yes | Yes |
| Resubmit | Yes | — | — | — |
| Approve | — | Own domains | Yes | Yes |
| Approve with Exception | — | Own domains | Yes | Yes |
| Not Pass | — | Own domains | Yes | Yes |

---

## 5. Combined View — Request + Domain Review Interaction

```mermaid
sequenceDiagram
    participant R as Requestor
    participant S as System
    participant DR as Domain Reviewer

    R->>S: Create Request (Draft)
    R->>S: Fill fields, select rules,<br/>answer questionnaires
    R->>S: Submit Request
    S->>S: Validate rules, fields,<br/>questionnaires
    S->>S: Create Domain Reviews<br/>(Waiting for Accept)

    alt Happy Path
        DR->>S: Accept Review
        S->>S: First accept → Request "In Progress"
        DR->>S: Approve Review
        S->>S: All reviews terminal?<br/>→ Request "Complete"
    else Approve with Exception
        DR->>S: Accept Review
        DR->>S: Approve with Exception<br/>(with notes)
        S->>S: All reviews terminal?<br/>→ Request "Complete"
    else Not Pass
        DR->>S: Accept Review
        DR->>S: Not Pass<br/>(with notes)
        S->>S: All reviews terminal?<br/>→ Request "Complete"
    else Return for Info
        DR->>S: Return Review<br/>(with reason)
        Note over S: Request status unchanged
        R->>S: Update information
        R->>S: Resubmit Review
        DR->>S: Accept Review
        DR->>S: Approve / Exception / Not Pass
        S->>S: All reviews terminal?<br/>→ Request "Complete"
    end
```

### Multi-Domain Example

```mermaid
sequenceDiagram
    participant R as Requestor
    participant S as System
    participant DR1 as Reviewer (Domain A)
    participant DR2 as Reviewer (Domain B)

    R->>S: Submit Request
    S->>S: Create Review A (Waiting for Accept)
    S->>S: Create Review B (Waiting for Accept)

    DR1->>S: Accept Review A
    S->>S: Request → In Progress<br/>(first accept)

    DR2->>S: Return Review B<br/>(need more info)
    Note over S: Request stays In Progress

    R->>S: Update info, Resubmit Review B

    DR1->>S: Approve Review A ✓
    DR2->>S: Accept Review B
    DR2->>S: Approve with Exception Review B ✓

    S->>S: All reviews terminal<br/>→ Request "Complete"
```

---

## 6. Progress Calculation

The `/progress/{requestId}` endpoint calculates review progress:

| Metric | Calculation |
|--------|-------------|
| **Completed domains** | Reviews where `status IN ('Approved', 'Approved with Exception', 'Not Passed')` |
| **In progress domains** | Reviews where `status = 'Accept'` |
| **Pending domains** | Reviews where `status IN ('Waiting for Accept', 'Return for Additional Information')` |
| **Progress percent** | `(completed / total) * 100` |

---

## Source Files

| File | Role |
|------|------|
| `backend/app/routers/governance_requests.py` | Submit, cancel, archive, copy endpoints |
| `backend/app/routers/domain_reviews.py` | Accept, return, resubmit, approve, approve-with-exception, not-pass |
| `backend/app/routers/progress.py` | Progress calculation |
| `scripts/schema.sql` | Table definitions |
| `frontend/src/lib/constants.ts` | Status color mappings |
