-- Migration: Domain Review State Machine Redesign
-- Date: 2026-03-14
-- Description: Simplify domain review from 8 states to 6, remove dispatcher/ISR/waive
--
-- New states: Waiting for Accept, Return for Additional Information, Accept,
--             Approved, Approved with Exception, Not Passed
--
-- Run: psql -p 5433 -U postgres -d egm_local -f scripts/migration_domain_review_state_machine.sql

SET search_path TO egm;

BEGIN;

-- 1. Update domain_review default status
ALTER TABLE domain_review ALTER COLUMN status SET DEFAULT 'Waiting for Accept';

-- 2. Migrate existing domain_review statuses
-- Pending/Assigned → Waiting for Accept (not yet accepted)
UPDATE domain_review SET status = 'Waiting for Accept'
  WHERE status IN ('Pending', 'Assigned');

-- In Progress → Accept (reviewer has accepted and is working)
UPDATE domain_review SET status = 'Accept'
  WHERE status = 'In Progress';

-- Review Complete → map by outcome
UPDATE domain_review SET status = 'Approved'
  WHERE status = 'Review Complete' AND outcome = 'Approved';

UPDATE domain_review SET status = 'Approved with Exception'
  WHERE status = 'Review Complete' AND outcome = 'Approved with Conditions';

UPDATE domain_review SET status = 'Not Passed'
  WHERE status = 'Review Complete' AND outcome IN ('Rejected', 'Deferred');

-- Catch-all: any remaining Review Complete without recognized outcome
UPDATE domain_review SET status = 'Not Passed'
  WHERE status = 'Review Complete';

-- Waived → Approved (waive removed, treat as auto-approved)
UPDATE domain_review SET status = 'Approved'
  WHERE status = 'Waived';

-- Returned → Return for Additional Information
UPDATE domain_review SET status = 'Return for Additional Information'
  WHERE status = 'Returned';

-- Accepted → Accept
UPDATE domain_review SET status = 'Accept'
  WHERE status = 'Accepted';

-- 3. Migrate governance_request statuses
-- Information Inquiry → Submitted (return no longer changes request status)
UPDATE governance_request SET status = 'Submitted'
  WHERE status = 'Information Inquiry';

-- Completed → Complete
UPDATE governance_request SET status = 'Complete'
  WHERE status = 'Completed';

-- 4. Add comment to info_supplement_request table (deprecated)
COMMENT ON TABLE info_supplement_request IS 'DEPRECATED (2026-03-14): Replaced by domain review "Return for Additional Information" status. Table retained for historical data.';

COMMIT;
