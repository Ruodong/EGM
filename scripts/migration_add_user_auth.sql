-- Migration: Add User Authorization tables + Clean test domains
-- Date: 2026-03-11
SET search_path TO egm;

-- ═══════════════════════════════════════════════════════
-- 1. Employee Info (synced from EAM resource_pool)
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
-- 2. User Role assignments
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

-- ═══════════════════════════════════════════════════════
-- 3. Clean up test domain data (TEST_* and TST_* prefixes)
--    Keep only: EA, BIA, RAI, DATA_PRIVACY
-- ═══════════════════════════════════════════════════════

-- 3a. Clean domain_questionnaire_response for test domain reviews
DELETE FROM egm.domain_questionnaire_response WHERE domain_review_id IN (
    SELECT id FROM egm.domain_review
    WHERE domain_code LIKE 'TEST_%' OR domain_code LIKE 'TST_%'
);

-- 3b. Clean review_action for test domain reviews
DELETE FROM egm.review_action WHERE domain_review_id IN (
    SELECT id FROM egm.domain_review
    WHERE domain_code LIKE 'TEST_%' OR domain_code LIKE 'TST_%'
);

-- 3c. Clean review_comment for test domain reviews
DELETE FROM egm.review_comment WHERE domain_review_id IN (
    SELECT id FROM egm.domain_review
    WHERE domain_code LIKE 'TEST_%' OR domain_code LIKE 'TST_%'
);

-- 3d. Clean info_supplement_request for test domain reviews
DELETE FROM egm.info_supplement_request WHERE domain_review_id IN (
    SELECT id FROM egm.domain_review
    WHERE domain_code LIKE 'TEST_%' OR domain_code LIKE 'TST_%'
);

-- 3e. Clean domain reviews referencing test domains
DELETE FROM egm.domain_review
WHERE domain_code LIKE 'TEST_%' OR domain_code LIKE 'TST_%';

-- 3f. Clean dispatch rules referencing test domains
DELETE FROM egm.dispatch_rule
WHERE domain_code LIKE 'TEST_%' OR domain_code LIKE 'TST_%';

-- 3g. Clean domain questionnaire templates referencing test domains
DELETE FROM egm.domain_questionnaire_template
WHERE domain_code LIKE 'TEST_%' OR domain_code LIKE 'TST_%';

-- 3h. Clean domain registry entries
DELETE FROM egm.domain_registry
WHERE domain_code LIKE 'TEST_%' OR domain_code LIKE 'TST_%';
