-- Migration: Add audience column to domain_questionnaire_template
-- Allows questions to be designated for 'requestor' or 'reviewer'
-- All existing questions default to 'requestor' (preserves current behavior)

SET search_path TO egm, public;

ALTER TABLE domain_questionnaire_template
    ADD COLUMN IF NOT EXISTS audience VARCHAR NOT NULL DEFAULT 'requestor';
