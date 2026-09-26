# Agent 3 · Family & Scheduling: task checklist

Source: `agent-3-family-schedule.md` + `CONTRACTS.md`. Service: `services/family` on :4003, DB schema `family`.
Legend: `[x]` done · `[ ]` open · **DoD** = definition-of-done item.

## Phase 0 · Setup (H0–3)
- [x] Standalone package in `services/family` (Fastify + TS, cross-platform npm scripts, root `.env`)
- [x] `contracts-local.ts` with CONTRACTS §3 types (temporary until `packages/contracts` exists)
- [x] Postgres `family` schema + migrations (idempotent), in-memory store for tests
- [x] Seed the circle (CONTRACTS §2) + relationship facts + weekly availability
- [x] Seed 8 weeks of call history (Danny most Sundays ~4pm ET, Lisa midweek, Mark rarely)
- [x] WhatsApp mock message store
- [x] LiveKit room creation + join token working against local dev server
- [x] `GET /health` → `{ ok, service, mock }`; `X-CC-Secret` on webhooks and internal endpoints
- [x] Fakes for voice (:4001) and money (:4002) in `dev/`

## Phase 1 · Stubs for every endpoint (H3–8), pushed first
- [x] **`GET /contact-rhythm/:seniorId`, realistic, computed from the seeded history (Agent 2 needs it)**
- [x] `GET /circle/:seniorId`
- [x] `POST /schedule/request`, `POST /schedule/proposals/:id/respond`, `POST /schedule/proposals/:id/confirm-senior`
- [x] `GET /schedule/:seniorId/upcoming`, `GET /proposals/:seniorId/pending-senior`
- [x] `GET /messages?memberId=`, `POST /messages/:id/act`, `POST /messages/reply`
- [x] `GET /moments/:seniorId?week=`
- [x] Webhooks: `call-ended`, `order-paid`, `fraud-hold`, `fraud-resolved` (return 200 fast, process async)
- [x] Contract-shape tests for every endpoint

## Phase 2 · Real happy path (H8–30)
- [x] Post-call pipeline: strip `privateSpans` **before** any model call (+ fail-closed timestamps, "keep this between us" fallback, post-model leak check)
- [x] Muse hook extraction (structured output) + heuristic fallback; no health/medication, no complaints about family
- [x] Route each hook to the one member who'd care most (relationship facts, e.g. Danny planted the tomatoes)
- [x] Warm nudge text that suggests a call; guilt-language filter
- [x] Rate limit: ≤1 nudge per member per (local) day
- [x] `order-paid` groceries → `add_to_order` to members ("Add something (coming soon)" + "Record a voice note for delivery"); receipts to funders; idempotent
- [x] Voice-note URLs stored against the order (`GET /orders/:orderId/voice-notes` for Agent 4)
- [x] Messages API complete (inbox, act, reply)
- [x] Family code word (by hash) never written into any hook or outbound message
- [x] **DoD:** a private span never appears in any hook, nudge, or briefing (test: `test/pipeline.test.ts`)

## Phase 3 · Fraud + scheduling (H30–50)
- [x] `fraud-hold` → `fraud_card` to every verifier; buttons "I'm calling her" / "Cancel it" / "Approve in app (passkey)" → money `/holds/:id/resolve`
- [x] `fraud-resolved` → all-clear to the circle + gentle code-word reminder (never the word itself)
- [x] Scheduling constraints in code: Rose 10:00–19:00 local, routine (nap, church), booked rides, existing calls
- [x] Members: time zone + seeded weekly availability (or poll replies via `/messages/reply`)
- [x] Dependents (Mia): outside school hours (and before 8pm bedtime), only through Lisa
- [x] Muse ranks valid slots + writes a human `reason`; invalid Muse picks are dropped in code; `localTimes` for everyone
- [x] `schedule_proposal` messages with slot buttons; responses; `awaiting_senior` when all accept a common slot
- [x] `confirm-senior` → LiveKit room, family join URLs, `ScheduledCall` (`seniorJoin: "phone_dialout"`)
- [x] Triggers: senior (voice), member (`/messages/reply` parsed by Muse), `ai_rhythm` daily job (suggests to family, never Rose)
- [x] T-60m briefing, T-30m reminder, T-0 `scheduled_call.due` + status `ringing`
- [x] After call: log moment, offer "Make this a weekly Sunday call?" → `recurring: "weekly"`, fair host rotation
- [x] Visits: same flow; Rose-side commerce hook for the voice agent's next call (`/circle` → `seniorHints`)
- [x] Moments: calls, voice notes, gifts, added items, scams stopped, dollars saved (from money holds, local fallback)
- [x] **DoD:** schedule request → 3 valid slots with reasons → accepts → Rose confirms → room created → `scheduled_call.due` fires (test: `test/scheduling.test.ts`; also verified live with real LiveKit + Muse via `dev/scenario.ts`)
- [x] **DoD:** hard constraints enforced in code (test: Muse can't propose a slot during a nap)
- [x] **DoD:** no message is ever addressed to a dependent (test)
- [x] **DoD:** `/contact-rhythm` feeds Agent 2's layer 4 correctly in the scam scenario (test: `test/fraud.test.ts`)

## Phase 4 · Harden (H50–62)
- [ ] No common slot → propose next best + ask who can flex
- [ ] Declined slot(s) → re-plan
- [ ] Time-zone boundaries (slot crossing midnight for Mark) + DST transitions (UK Oct 25, US Nov 1 2026)
- [ ] Missed calls (no `call.ended` after T+90m → `missed`)
- [ ] Demo helpers: reset/seed, clock fast-forward

## Environment notes
- `localhost:5432` currently reaches a native Windows PostgreSQL service, not the `cc-pg` container, so the service runs on the in-memory store under `MOCK=1` (see status/AGENT-3.md → Blocked on).
