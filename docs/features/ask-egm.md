# Feature: Ask EGM — AI-Assisted Review Analysis

**Status**: Implemented
**Date**: 2026-03-15
**Spec Version**: 2

## Impact Assessment

**Feature**: Ask EGM AI Assistant + RAG | **Impact**: L3 (cross-feature, reads multiple tables) | **Risk**: Low | **Decision**: Auto-approve
New router + 2 new tables (`ask_egm_conversation`, `ask_egm_review_embedding`) + new floating UI component. Reads from governance_request, domain_review, questionnaire responses, and action items for LLM context. pgvector extension for similarity search.

## Summary

Reviewers can open a floating AI assistant ("Ask EGM") on the Domain Review Detail page. The assistant answers questions about the current review by combining governance request info, questionnaire responses, action items, and **similar historical reviews (RAG)** as LLM context. Conversations are persisted per domain review and support streaming (SSE) responses.

## Affected Files

### Backend
- `backend/app/routers/ask_egm.py` — Router: chat (SSE), history, clear, embedding sync
- `backend/app/utils/embeddings.py` — New: embedding generation, similarity search, upsert
- `backend/app/config.py` — LLM + Embedding configuration fields
- `backend/app/main.py` — Register `ask_egm` router at `/api/ask-egm`

### Frontend
- `frontend/src/app/governance/_components/AskEgmFloating.tsx` — Floating chat panel component
- `frontend/src/app/governance/[requestId]/reviews/[domainCode]/page.tsx` — Render `<AskEgmFloating>`

### Database
- `scripts/schema.sql` — Tables `ask_egm_conversation` + `ask_egm_review_embedding`
- `scripts/migration_ask_egm.sql` — Conversation table migration
- `scripts/migration_ask_egm_embeddings.sql` — Embedding table migration (requires pgvector)

## Database Schema

### `ask_egm_conversation`

```sql
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
```

### `ask_egm_review_embedding` (RAG)

Requires: `CREATE EXTENSION IF NOT EXISTS vector;` (pgvector)

```sql
CREATE TABLE IF NOT EXISTS ask_egm_review_embedding (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domain_review_id UUID NOT NULL UNIQUE REFERENCES domain_review(id) ON DELETE CASCADE,
    domain_code      VARCHAR NOT NULL,
    content_hash     VARCHAR NOT NULL,       -- SHA-256 of content_summary, for change detection
    content_summary  TEXT NOT NULL,           -- Plaintext summary used for embedding
    embedding        vector(256) NOT NULL,   -- 256-dim vector from text-embedding-3-small
    create_at        TIMESTAMP DEFAULT NOW(),
    update_at        TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_review_embedding_domain
    ON ask_egm_review_embedding(domain_code);
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/ask-egm/{domain_review_id}/history` | Get conversation history |
| DELETE | `/api/ask-egm/{domain_review_id}/history` | Clear conversation history |
| POST | `/api/ask-egm/{domain_review_id}/chat` | Send message, receive SSE stream |
| POST | `/api/ask-egm/{domain_review_id}/embedding` | Generate/update embedding for a review |
| POST | `/api/ask-egm/embeddings/sync-all` | Batch sync embeddings for all terminal reviews |

### POST /chat — SSE Response Format

```
data: {"token": "Based on"}
data: {"token": " the questionnaire"}
data: {"token": " responses..."}
data: {"done": true}
```

### POST /chat — Internal Flow

1. Validate LLM is configured (503 if not)
2. Build system prompt with review context:
   - Request info, questionnaire Q&A, action items + feedback
   - **RAG: Top-5 similar historical reviews** (via pgvector cosine similarity)
3. Auto-update embedding for current review (best-effort)
4. Save user message to `ask_egm_conversation`
5. Load full conversation history
6. Assemble messages: `[system_prompt, ...history]`
7. Stream response from LLM
8. Save assistant response to DB after stream ends

### POST /embeddings/sync-all — Response

```json
{"total": 397, "created": 397, "skipped": 0}
```

## Configuration

### LLM (required for chat)

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_BASE_URL` | (required) | OpenAI-compatible API endpoint |
| `LLM_API_KEY` | (required) | API key |
| `LLM_MODEL` | `gpt-4.1-dev` | Model name |
| `LLM_TEMPERATURE` | `0.7` | Sampling temperature |
| `LLM_TOP_P` | `0.8` | Nucleus sampling |

### Embedding (optional, enables RAG)

| Variable | Default | Description |
|----------|---------|-------------|
| `EMBEDDING_BASE_URL` | (optional) | Embedding API endpoint |
| `EMBEDDING_API_KEY` | (optional) | Embedding API key |
| `EMBEDDING_MODEL` | `text-embedding-3-small` | Embedding model |
| `EMBEDDING_DIMENSIONS` | `256` | Vector dimensions |

If embedding is not configured, chat still works — it just won't include similar historical reviews.

## RAG — Similar Historical Reviews

### How It Works

```
用户提问 → POST /chat
              │
              ├─ 1. Build current review context (SQL)
              ├─ 2. Extract key fields → embed as query vector
              ├─ 3. pgvector cosine similarity search in same domain
              ├─ 4. Top-5 similar reviews' summaries → inject into system prompt
              └─ 5. LLM generates answer with both current + historical context
```

### Embedding Content

Each review is summarized as plaintext including:
- Domain, status, outcome
- Request ID, title, project name/type, description
- Software type, vendor, business unit, end users, regions
- All questionnaire Q&A (compact format)

### Change Detection

- `content_hash` = SHA-256 of the plaintext summary
- On `upsert_review_embedding()`, if hash matches → skip (no re-embed)
- This avoids unnecessary Embedding API calls

### Embedding Trigger Points

| Trigger | Automatic? | Description |
|---------|-----------|-------------|
| User chats (`POST /chat`) | Yes | Auto-embeds current review (best-effort) |
| Single sync (`POST /{id}/embedding`) | Manual | Admin triggers for one review |
| Batch sync (`POST /embeddings/sync-all`) | Manual | All terminal-status reviews |

### Similarity Search

```sql
SELECT domain_review_id, content_summary,
       1 - (embedding <=> query_vector) AS similarity
FROM ask_egm_review_embedding
WHERE domain_code = :same_domain
  AND domain_review_id != :current_review
ORDER BY embedding <=> query_vector
LIMIT 5;
```

## System Prompt — Context Injection

The system prompt automatically includes:

1. **Review Context** — domain name, review status, outcome, reviewer
2. **Project Information** — request ID, title, project name/type, business unit, requestor, PM, software type, vendor, end users, regions
3. **Questionnaire Responses** — all Q&A grouped by section
4. **Action Items** — all actions with priority, type, status, assignee, and feedback
5. **Similar Historical Reviews** (RAG) — Top-5 most similar past reviews in the same domain

The AI is instructed to:
- **ONLY** answer questions related to the current domain review context
- Use historical reviews as reference when relevant
- Politely decline unrelated questions
- Answer in the same language as the user's question

## UI Behavior

### Floating Action Button (FAB)
- Fixed position at bottom-right corner of Domain Review Detail page
- Circular button with robot icon (`RobotOutlined`)
- Click to expand the chat panel

### Chat Panel (expanded)
- 420×580px panel anchored to bottom-right
- **Header**: "Ask EGM · {domainName}" with clear history and close buttons
- **Context badges**: "Request Info", "Questionnaire", "Action Items"
- **Chat area**: scrollable message list (user = blue, assistant = gray)
- **Quick prompts** (shown when no messages):
  1. "Summarize the key points from the questionnaire responses"
  2. "What are the potential compliance risks in this review?"
  3. "Are there any inconsistencies in the questionnaire responses?"
  4. "Suggest action items for this review"
  5. "Draft a review decision summary"
- **Input area**: textarea + send button, Enter to send, Shift+Enter for newline
- **Disclaimer**: "AI suggestions are for reference only."
- **Streaming**: typing indicator → real-time token display → final message

## Acceptance Criteria

### Backend — API
- [x] AC-1: GET `/history` returns empty array for new domain review
- [x] AC-2: POST `/chat` returns SSE stream (200) when LLM is configured
- [x] AC-3: POST `/chat` returns 503 when LLM not configured
- [x] AC-4: POST `/chat` saves user message to DB before streaming
- [x] AC-5: POST `/chat` saves assistant response to DB after stream completes
- [x] AC-6: DELETE `/history` clears all messages for the domain review
- [x] AC-7: POST `/chat` with empty/whitespace message returns 422
- [x] AC-8: Conversation history includes all prior messages in LLM context

### Backend — Context & RAG
- [x] AC-9: System prompt includes governance request info
- [x] AC-10: System prompt includes questionnaire responses grouped by section
- [x] AC-11: System prompt includes action items with feedback history
- [x] AC-12: AI is restricted to only answer domain-review-related questions
- [x] AC-13: System prompt includes Top-5 similar historical reviews when embedding is configured
- [x] AC-14: POST `/{id}/embedding` generates embedding for a single review
- [x] AC-15: POST `/embeddings/sync-all` batch generates embeddings
- [x] AC-16: Embedding uses content_hash to skip unchanged reviews
- [x] AC-17: RAG failure is non-fatal — chat works without embeddings

### Frontend
- [x] AC-18: Floating robot icon appears on Domain Review Detail page
- [x] AC-19: Click FAB → chat panel expands; click close → panel collapses
- [x] AC-20: Quick prompts shown when no messages
- [x] AC-21: Messages stream in real-time with typing indicator
- [x] AC-22: Clear history button removes all messages

## Test Coverage

### API Tests
- `api-tests/test_ask_egm.py::TestAskEgm::test_get_history_empty` — covers AC-1
- `api-tests/test_ask_egm.py::TestAskEgm::test_chat_returns_sse_or_503` — covers AC-2, AC-3
- `api-tests/test_ask_egm.py::TestAskEgm::test_chat_saves_user_message_when_configured` — covers AC-4, AC-5
- `api-tests/test_ask_egm.py::TestAskEgm::test_clear_history` — covers AC-6
- `api-tests/test_ask_egm.py::TestAskEgm::test_empty_message_rejected` — covers AC-7

## Test Map Entries

```
backend/app/routers/ask_egm.py -> api-tests/test_ask_egm.py
backend/app/utils/embeddings.py -> api-tests/test_ask_egm.py
frontend/src/app/governance/_components/AskEgmFloating.tsx -> (manual)
```

## Notes

- **LLM Provider**: OpenAI-compatible API (currently Lenovo AIverse). Any endpoint supporting chat completions format works.
- **Embedding Model**: `text-embedding-3-small` at 256 dimensions via AIverse. Same endpoint, different model.
- **pgvector**: PostgreSQL extension for vector storage + cosine similarity search. Must be installed separately (`apt install postgresql-16-pgvector`).
- **Conversation isolation**: Each domain review has independent conversation history.
- **Post-stream DB save**: Uses separate `AsyncSessionLocal` session in `finally` block.
- **Embedding auto-update**: On chat, current review's embedding is updated (best-effort, failure doesn't break chat).
- **Content hash**: SHA-256 of the summary text prevents unnecessary re-embedding when content hasn't changed.
- **Graceful degradation**: If embedding is not configured or pgvector not installed, RAG is silently skipped — chat still works with current-review-only context.
- **Auth**: Reuses `review_action:read` permission.
