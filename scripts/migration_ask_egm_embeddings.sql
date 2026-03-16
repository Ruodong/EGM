-- Ask EGM: Review embeddings for RAG-based similar case retrieval
-- Requires: CREATE EXTENSION IF NOT EXISTS vector;

-- Step 1: Install pgvector extension (in public schema)
CREATE EXTENSION IF NOT EXISTS vector SCHEMA public;

-- Step 2: Create table in egm schema (reference vector type as public.vector)
SET search_path TO egm;

CREATE TABLE IF NOT EXISTS ask_egm_review_embedding (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domain_review_id UUID NOT NULL UNIQUE REFERENCES domain_review(id) ON DELETE CASCADE,
    domain_code      VARCHAR NOT NULL,
    content_hash     VARCHAR NOT NULL,
    content_summary  TEXT NOT NULL,
    embedding        public.vector(256) NOT NULL,
    create_at        TIMESTAMP DEFAULT NOW(),
    update_at        TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_review_embedding_domain
    ON ask_egm_review_embedding(domain_code);
