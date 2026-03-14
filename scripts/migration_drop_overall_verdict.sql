-- Migration: Drop overall_verdict and completed_at columns from governance_request
-- Date: 2026-03-13
-- Reason: Verdict functionality removed from the application

ALTER TABLE egm.governance_request DROP COLUMN IF EXISTS overall_verdict;
ALTER TABLE egm.governance_request DROP COLUMN IF EXISTS completed_at;
