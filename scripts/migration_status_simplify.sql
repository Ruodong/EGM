-- Migration: Simplify governance request statuses to 4 states
-- Draft → Submitted → In Progress → Completed
-- Date: 2026-03-13

SET search_path TO egm;

-- 1. Create field-level change log table for tracking edits in Submitted/In Progress
CREATE TABLE IF NOT EXISTS governance_request_change_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id      UUID NOT NULL REFERENCES governance_request(id) ON DELETE CASCADE,
    field_name      VARCHAR NOT NULL,
    old_value       JSONB,
    new_value       JSONB,
    changed_by      VARCHAR,
    changed_at      TIMESTAMP DEFAULT NOW()
);

-- 2. Migrate existing statuses: collapse In Review, Scoping, Info Requested → In Progress
UPDATE governance_request SET status = 'In Progress'
WHERE status IN ('In Review', 'Scoping', 'Info Requested');
