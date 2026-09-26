# services/family: Agent 3 · Family & Scheduling (:4003)

The circle, the WhatsApp-mock messages, post-call hooks and nudges, fraud cards, contact rhythm, and scheduling (proposals → LiveKit rooms → reminders).

```
npm install
npm run dev        # :4003, seeds the circle + 8 weeks of call history on first boot
npm test           # vitest (in-memory store, Muse off, fake LiveKit/voice/money)
npm run fakes      # fake voice :4001 + money :4002 for local dev (skips ports already in use)
npm run seed       # wipe + re-seed family data
npm run livekit:check  # create a room on LIVEKIT_URL and print two join links
```

Config comes from the repo-root `.env` (`DATABASE_URL`, `CC_INTERNAL_SECRET`, `META_API_KEY`, `MUSE_MODEL`, `LIVEKIT_*`, `VOICE_URL`, `MONEY_URL`, `WEB_URL`, `MOCK`).
Service-specific: `FAMILY_MUSE=off` (force heuristics), `FAMILY_TICK_MS` (scheduler interval, default 15000, 0 = off), `FAMILY_REQUIRE_SECRET_ALL=1`, `MUSE_BASE_URL` (default `https://api.meta.ai/v1`).

`MOCK=1`: if Postgres or LiveKit are unreachable the service falls back to an in-memory store / fake rooms instead of failing. Muse is used whenever `META_API_KEY` is set; every Muse call has a deterministic fallback.

## Layout
- `src/domain/`: circle + seed, rhythm, messages, privacy + safety filters, hooks pipeline, orders, fraud, moments, jobs (scheduler tick, rhythm job, weekly calls), scheduling (constraints, planner, proposals)
- `src/adapters/`: Muse (openai SDK), LiveKit, HTTP clients for voice/money
- `src/store/`: document store (Postgres `family.*` tables with jsonb, or in-memory)
- `src/contracts-local.ts`: CONTRACTS §3 types (temporary until `packages/contracts` exists)
