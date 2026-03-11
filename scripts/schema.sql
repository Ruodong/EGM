-- EGM Database Schema
CREATE SCHEMA IF NOT EXISTS egm;
SET search_path TO egm;

-- Sequence for governance request IDs (GR-000001, GR-000002, ...)
CREATE SEQUENCE IF NOT EXISTS gr_seq START 1;
-- To sync with existing data: SELECT setval('egm.gr_seq', (SELECT COALESCE(MAX(CAST(SPLIT_PART(request_id, '-', 2) AS INT)), 0) FROM egm.governance_request));

-- ═══════════════════════════════════════════════════════
-- Projects (synced from EAM)
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS project (
    id              VARCHAR PRIMARY KEY,
    project_id      VARCHAR NOT NULL UNIQUE,
    project_name    VARCHAR,
    type            VARCHAR,
    status          VARCHAR,
    pm              VARCHAR,
    pm_itcode       VARCHAR,
    dt_lead         VARCHAR,
    dt_lead_itcode  VARCHAR,
    it_lead         VARCHAR,
    it_lead_itcode  VARCHAR,
    start_date      VARCHAR,
    go_live_date    VARCHAR,
    end_date        VARCHAR,
    ai_related      VARCHAR,
    source          VARCHAR,
    create_by       VARCHAR,
    create_at       TIMESTAMP DEFAULT NOW(),
    update_at       TIMESTAMP
);

-- ═══════════════════════════════════════════════════════
-- A: Governance Requests
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS governance_request (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id      VARCHAR NOT NULL UNIQUE,
    title           VARCHAR NOT NULL,
    description     TEXT,
    project_id      VARCHAR REFERENCES project(project_id) ON DELETE SET NULL,
    requestor       VARCHAR NOT NULL,
    requestor_name  VARCHAR,
    organization    VARCHAR,
    status          VARCHAR NOT NULL DEFAULT 'Draft',
    overall_verdict VARCHAR,
    priority        VARCHAR DEFAULT 'Normal',
    target_date     TIMESTAMP,
    completed_at    TIMESTAMP,
    create_by       VARCHAR,
    create_at       TIMESTAMP DEFAULT NOW(),
    update_by       VARCHAR,
    update_at       TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════
-- B: Intake Templates (unified scoping + common questionnaire)
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS intake_template (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    section_type    VARCHAR NOT NULL DEFAULT 'common',   -- 'scoping' | 'common'
    section         VARCHAR NOT NULL,                     -- e.g. "AI Usage", "Project Details", "Data Info"
    question_no     INT NOT NULL,
    question_text   TEXT NOT NULL,
    answer_type     VARCHAR NOT NULL DEFAULT 'text',      -- text|textarea|select|multiselect|boolean|date
    options         JSONB,
    is_required     BOOLEAN DEFAULT FALSE,
    help_text       TEXT,
    triggers_domain TEXT[],                               -- domain codes triggered (scoping only)
    sort_order      INT DEFAULT 0,
    is_active       BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS intake_response (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id      UUID NOT NULL REFERENCES governance_request(id) ON DELETE CASCADE,
    template_id     UUID NOT NULL REFERENCES intake_template(id),
    answer          JSONB,
    create_by       VARCHAR,
    create_at       TIMESTAMP DEFAULT NOW(),
    update_by       VARCHAR,
    update_at       TIMESTAMP DEFAULT NOW(),
    UNIQUE(request_id, template_id)
);

-- ═══════════════════════════════════════════════════════
-- C: Domain Registry
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS domain_registry (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domain_code     VARCHAR NOT NULL UNIQUE,
    domain_name     VARCHAR NOT NULL,
    description     TEXT,
    integration_type VARCHAR NOT NULL DEFAULT 'internal',
    external_base_url VARCHAR,
    icon            VARCHAR,
    sort_order      INT DEFAULT 0,
    is_active       BOOLEAN DEFAULT TRUE,
    config          JSONB
);

-- ═══════════════════════════════════════════════════════
-- D: Dispatch Rules
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS dispatch_rule (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_name       VARCHAR NOT NULL,
    domain_code     VARCHAR NOT NULL,
    condition_type  VARCHAR NOT NULL DEFAULT 'scoping_answer',
    condition_field VARCHAR,
    condition_operator VARCHAR DEFAULT 'equals',
    condition_value JSONB,
    priority        INT DEFAULT 0,
    is_active       BOOLEAN DEFAULT TRUE
);

-- ═══════════════════════════════════════════════════════
-- E: Domain Reviews
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS domain_review (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id      UUID NOT NULL REFERENCES governance_request(id) ON DELETE CASCADE,
    domain_code     VARCHAR NOT NULL,
    status          VARCHAR NOT NULL DEFAULT 'Pending',
    reviewer        VARCHAR,
    reviewer_name   VARCHAR,
    outcome         VARCHAR,
    outcome_notes   TEXT,
    external_ref_id VARCHAR,
    common_data_updated_at TIMESTAMP,
    started_at      TIMESTAMP,
    completed_at    TIMESTAMP,
    create_by       VARCHAR,
    create_at       TIMESTAMP DEFAULT NOW(),
    update_by       VARCHAR,
    update_at       TIMESTAMP DEFAULT NOW(),
    UNIQUE(request_id, domain_code)
);

CREATE TABLE IF NOT EXISTS domain_questionnaire_template (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domain_code     VARCHAR NOT NULL,
    section         VARCHAR,
    question_no     INT NOT NULL,
    question_text   TEXT NOT NULL,
    answer_type     VARCHAR NOT NULL DEFAULT 'text',
    options         JSONB,
    is_required     BOOLEAN DEFAULT FALSE,
    sort_order      INT DEFAULT 0,
    is_active       BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS domain_questionnaire_response (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domain_review_id UUID NOT NULL REFERENCES domain_review(id) ON DELETE CASCADE,
    template_id     UUID NOT NULL REFERENCES domain_questionnaire_template(id),
    answer          JSONB,
    create_by       VARCHAR,
    create_at       TIMESTAMP DEFAULT NOW(),
    update_by       VARCHAR,
    update_at       TIMESTAMP DEFAULT NOW(),
    UNIQUE(domain_review_id, template_id)
);

-- ═══════════════════════════════════════════════════════
-- E: Review Actions & Comments
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS review_action (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domain_review_id UUID NOT NULL REFERENCES domain_review(id) ON DELETE CASCADE,
    action_no       VARCHAR,
    title           VARCHAR NOT NULL,
    description     TEXT,
    assignee        VARCHAR,
    assignee_name   VARCHAR,
    status          VARCHAR NOT NULL DEFAULT 'Open',
    due_date        TIMESTAMP,
    closed_at       TIMESTAMP,
    create_by       VARCHAR,
    create_at       TIMESTAMP DEFAULT NOW(),
    update_by       VARCHAR,
    update_at       TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS review_comment (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domain_review_id UUID NOT NULL REFERENCES domain_review(id) ON DELETE CASCADE,
    comment_text    TEXT NOT NULL,
    create_by       VARCHAR,
    create_at       TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════
-- E: Shared Artifacts
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS shared_artifact (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id      UUID NOT NULL REFERENCES governance_request(id) ON DELETE CASCADE,
    source_domain   VARCHAR NOT NULL,
    artifact_type   VARCHAR NOT NULL,
    artifact_name   VARCHAR NOT NULL,
    artifact_data   JSONB,
    file_url        VARCHAR,
    create_by       VARCHAR,
    create_at       TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════
-- E.1: Info Supplement Requests (ISR)
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS info_supplement_request (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id      UUID NOT NULL REFERENCES governance_request(id) ON DELETE CASCADE,
    domain_review_id UUID NOT NULL REFERENCES domain_review(id) ON DELETE CASCADE,
    requester       VARCHAR NOT NULL,
    category        VARCHAR,
    field_reference UUID,
    description     TEXT NOT NULL,
    priority        VARCHAR DEFAULT 'Normal',
    status          VARCHAR NOT NULL DEFAULT 'Open',
    resolution_note TEXT,
    resolved_by     VARCHAR,
    resolved_at     TIMESTAMP,
    create_by       VARCHAR,
    create_at       TIMESTAMP DEFAULT NOW(),
    update_by       VARCHAR,
    update_at       TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════
-- E.1: Intake Change Log
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS intake_change_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id      UUID NOT NULL REFERENCES governance_request(id) ON DELETE CASCADE,
    template_id     UUID NOT NULL REFERENCES intake_template(id),
    old_answer      JSONB,
    new_answer      JSONB,
    change_reason   UUID,
    changed_by      VARCHAR,
    changed_at      TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════
-- F: Audit Log
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS audit_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type     VARCHAR NOT NULL,
    entity_id       UUID,
    action          VARCHAR NOT NULL,
    old_value       JSONB,
    new_value       JSONB,
    performed_by    VARCHAR,
    performed_at    TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════
-- G: Employee Info (synced from EAM)
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS employee_info (
    itcode          VARCHAR(255) PRIMARY KEY,
    name            VARCHAR,
    email           VARCHAR,
    job_role        VARCHAR,
    worker_type     VARCHAR,
    country         VARCHAR,
    primary_skill   VARCHAR,
    skill_level     VARCHAR,
    tier_1_org      VARCHAR,
    tier_2_org      VARCHAR,
    manager_itcode  VARCHAR,
    manager_name    VARCHAR,
    synced_at       TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════
-- H: User Role Assignments
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS user_role (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    itcode          VARCHAR(255) NOT NULL UNIQUE REFERENCES employee_info(itcode),
    role            VARCHAR NOT NULL DEFAULT 'viewer',
    assigned_by     VARCHAR,
    assigned_at     TIMESTAMP DEFAULT NOW(),
    update_by       VARCHAR,
    update_at       TIMESTAMP DEFAULT NOW()
);
