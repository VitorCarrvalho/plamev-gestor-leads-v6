-- Migration 013: add RAG trace fields to ai_interaction_logs
ALTER TABLE ai_interaction_logs
  ADD COLUMN IF NOT EXISTS rag_docs_count    INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rag_sources       TEXT,
  ADD COLUMN IF NOT EXISTS kb_chars_injected INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS history_msgs_count INTEGER DEFAULT 0;
