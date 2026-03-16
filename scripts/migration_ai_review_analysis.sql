-- Migration: AI Review Analysis table
-- Stores versioned AI analysis results per domain review per dimension

SET search_path TO egm, public;

CREATE TABLE IF NOT EXISTS ai_review_analysis (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domain_review_id  UUID NOT NULL REFERENCES domain_review(id) ON DELETE CASCADE,
    version           INT NOT NULL DEFAULT 1,
    trigger_event     VARCHAR NOT NULL,          -- 'submit' | 'resubmit' | 'manual'
    trigger_by        VARCHAR,                   -- itcode of triggering user

    status            VARCHAR NOT NULL DEFAULT 'pending',  -- 'pending' | 'running' | 'completed' | 'failed'

    -- Change detection (for version > 1)
    content_hash      VARCHAR,                   -- hash of input data for change detection
    changed_dimensions TEXT[],                   -- which dimensions were re-analyzed (NULL = all)

    -- 5 dimension results (JSONB)
    risk_assessment       JSONB,
    reference_cases       JSONB,
    consistency_analysis  JSONB,
    completeness_analysis JSONB,
    accuracy_analysis     JSONB,

    -- Summary
    overall_score     FLOAT,
    summary           TEXT,

    error_message     TEXT,
    started_at        TIMESTAMP,
    completed_at      TIMESTAMP,
    create_at         TIMESTAMP DEFAULT NOW(),

    UNIQUE(domain_review_id, version)
);

CREATE INDEX IF NOT EXISTS idx_ai_analysis_review
    ON ai_review_analysis(domain_review_id, version DESC);
