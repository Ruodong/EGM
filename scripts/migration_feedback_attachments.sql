-- Migration: Add feedback attachments table
-- Allows file uploads alongside feedback entries in action item conversations

CREATE TABLE IF NOT EXISTS review_action_feedback_attachment (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    feedback_id      UUID NOT NULL REFERENCES review_action_feedback(id) ON DELETE CASCADE,
    action_id        UUID NOT NULL REFERENCES review_action(id) ON DELETE CASCADE,
    file_name        VARCHAR NOT NULL,
    file_size        INT NOT NULL,
    content_type     VARCHAR NOT NULL DEFAULT 'application/octet-stream',
    file_data        BYTEA NOT NULL,
    create_by        VARCHAR,
    create_by_name   VARCHAR,
    create_at        TIMESTAMP DEFAULT NOW()
);
