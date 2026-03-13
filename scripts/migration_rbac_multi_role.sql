-- Migration: RBAC Multi-Role + Domain-Scoped Permissions
-- Run: psql -h localhost -p 5433 -U egm_user -d egm_local -f scripts/migration_rbac_multi_role.sql

BEGIN;

-- 1. Migrate existing viewer roles to requestor
UPDATE user_role SET role = 'requestor' WHERE role = 'viewer';

-- 2. Drop the old UNIQUE constraint on itcode (single role per user)
--    and replace with UNIQUE(itcode, role) to allow multiple roles per user.
ALTER TABLE user_role DROP CONSTRAINT IF EXISTS user_role_itcode_key;
ALTER TABLE user_role ADD CONSTRAINT user_role_itcode_role_key UNIQUE(itcode, role);

-- 3. Change default role from 'viewer' to 'requestor'
ALTER TABLE user_role ALTER COLUMN role SET DEFAULT 'requestor';

-- 4. New table: domain assignments for domain_reviewer role entries
CREATE TABLE IF NOT EXISTS user_role_domain (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_role_id UUID NOT NULL REFERENCES user_role(id) ON DELETE CASCADE,
    domain_code  VARCHAR NOT NULL,
    assigned_by  VARCHAR,
    assigned_at  TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_role_id, domain_code)
);

COMMIT;
