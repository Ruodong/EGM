-- Ask EGM: AI-assisted review analysis conversation history
-- Each row is a single message (user or assistant) tied to a domain_review.

SET search_path TO egm;

CREATE TABLE IF NOT EXISTS ask_egm_conversation (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domain_review_id UUID NOT NULL REFERENCES domain_review(id) ON DELETE CASCADE,
    role             VARCHAR NOT NULL,          -- 'user' | 'assistant'
    content          TEXT NOT NULL,
    create_by        VARCHAR,
    create_at        TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ask_egm_conv_review
    ON ask_egm_conversation(domain_review_id, create_at);
