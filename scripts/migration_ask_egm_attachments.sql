-- Migration: Ask EGM — chat attachments (images/files)
-- Run: docker exec egm-postgres psql -U postgres -d egm_local -f /dev/stdin < scripts/migration_ask_egm_attachments.sql

-- Attachment table for chat messages (same BYTEA pattern as review_action_attachment)
CREATE TABLE IF NOT EXISTS egm.ask_egm_attachment (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domain_review_id UUID NOT NULL REFERENCES egm.domain_review(id) ON DELETE CASCADE,
    file_name        VARCHAR NOT NULL,
    file_size        INT NOT NULL,
    content_type     VARCHAR NOT NULL,
    file_data        BYTEA NOT NULL,
    create_by        VARCHAR,
    create_at        TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ask_egm_att_review
    ON egm.ask_egm_attachment(domain_review_id, create_at);

-- Add metadata column to conversation for attachment refs + follow-up questions
ALTER TABLE egm.ask_egm_conversation ADD COLUMN IF NOT EXISTS metadata JSONB;
-- metadata examples:
--   user msg:      {"attachments": [{"id": "uuid", "fileName": "img.png", "contentType": "image/png"}]}
--   assistant msg: {"followUpQuestions": ["Q1?", "Q2?", "Q3?"]}
