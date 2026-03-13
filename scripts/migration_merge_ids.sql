-- Migration: Merge request_id (GR-XXXXXX) and egq_id (EGQxxxxxxxxxx) into single request_id column
-- Keep EGQ format, rename egq_id → request_id, drop old GR-format request_id and gr_seq sequence
-- Safe: All FK references in other tables use UUID id, not VARCHAR request_id

-- 1. Drop the old GR-format request_id column
ALTER TABLE governance_request DROP COLUMN request_id;

-- 2. Rename egq_id → request_id
ALTER TABLE governance_request RENAME COLUMN egq_id TO request_id;

-- 3. Ensure NOT NULL constraint (UNIQUE already carries over from egq_id)
ALTER TABLE governance_request ALTER COLUMN request_id SET NOT NULL;

-- 4. Drop the unused gr_seq sequence
DROP SEQUENCE IF EXISTS gr_seq;
