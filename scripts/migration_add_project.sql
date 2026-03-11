-- Migration: Add project table and refactor governance_request
-- Run against egm_local database (port 5433)

SET search_path TO egm;

-- 1. Create project table
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

-- 2. Drop project_name column from governance_request (now joined from project table)
ALTER TABLE governance_request DROP COLUMN IF EXISTS project_name;

-- 3. Add FK constraint on project_id (must clear invalid values first)
UPDATE governance_request SET project_id = NULL
WHERE project_id IS NOT NULL
  AND project_id NOT IN (SELECT project_id FROM project);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'governance_request_project_id_fkey'
          AND table_schema = 'egm'
    ) THEN
        ALTER TABLE governance_request
        ADD CONSTRAINT governance_request_project_id_fkey
        FOREIGN KEY (project_id) REFERENCES project(project_id) ON DELETE SET NULL;
    END IF;
END $$;
