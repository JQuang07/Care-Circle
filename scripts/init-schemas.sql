-- One schema per agent (CONTRACTS.md §1). Each service writes ONLY its own schema
-- and never reads another's; cross-service data goes through the HTTP APIs.
-- Idempotent: safe to run on every `pnpm seed`.
CREATE SCHEMA IF NOT EXISTS voice;   -- Agent 1
CREATE SCHEMA IF NOT EXISTS money;   -- Agent 2
CREATE SCHEMA IF NOT EXISTS family;  -- Agent 3
CREATE SCHEMA IF NOT EXISTS web;     -- Agent 4
