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
- [x] No common slot → propose next best (Rose's constraints never relaxed) + ask who can flex; 422 `NO_SLOTS` if truly nothing
- [x] Declined slot(s) → re-plan with fresh times (atomic decline-all; stale buttons → 409 `SLOT_EXPIRED`); after 3 rounds ask the family for a time
- [x] Declining the agreed slot drops `awaiting_senior` back to `proposed`; confirm rejects past slots
- [x] Time-zone boundaries (availability chains across midnight) + DST transitions (UK Oct 25, US Nov 1 2026; weekly calls keep local wall-clock time)
- [x] Missed calls (no `call.ended` after T+90m → `missed`)
- [x] Demo helpers: reset/seed, clock fast-forward (`/demo/*`, secret-protected)

## Phase 5 · Integration v2 (`docs/agents/agent-3-family.md`; the addendum wins)
### Part 1 · Family
- [x] 1. **D10:** named members → all must accept the same slot; none named → `awaiting_senior` once ≥2 invitees accept the same slot; non-responders stay invited + get the join link (test: `test/acceptance.test.ts`)
- [x] 2. **D5 action vocabulary:** `accept_slot` / `decline_all` (payload `{ proposalId, slotId, slot }`), `cancel_hold` / `release_hold` / `calling_her` (`{ orderId, holdId }`), `add_item` / `record_voice_note` (`{ orderId }`), `call_now` / `dismiss` (`{ hookId? }`); clients may add only `voiceNoteUrl`, `passkeyAssertion`, `note`, `slotId`
- [x] 3. **D2 + D4:** `POST /demo/fire-due { scheduledCallId }`; `phase: "reminder" | "due"` in the `scheduled-call-due` body (keep `X-CC-Phase`)
- [x] 4. **D6/D7/D11/D12:** `everAskedForMoney: boolean`; Mia `birthday: "10-14"`; join/proposal/seniorHints/voice-notes endpoints; `/moments?week=` ISO week, default = current week in Rose's tz
- [ ] 5. `POST /webhooks/delivery-status` (secret, idempotent by `deliveryId` + `status`): dry run → Lisa; placed/picked_up → ETA note; delivered → circle + voice `/calls/outbound`; failed → verifiers
- [ ] 6. Config: `FAMILY_PORT ?? 4003` only (no `PORT`); `contracts-local.ts` → `@care-circle/contracts` once the addendum types are published
- [ ] 7. Postgres test runs against Docker's database
### Part 2 · Delivery upkeep
- [ ] `pnpm --filter @care-circle/delivery test` green (15, every safety gate); switch `src/types.ts` to `@care-circle/contracts` once `Quote`, `QuoteLine`, `DeliveryOrder` are there
### Part 3 · Verify against the real services
- [ ] `pnpm health` 5 green; `pnpm e2e` E2E 2 and E2E 5 pass; delivery `/quote` curl; delivery message in Lisa's inbox after a paid grocery order (needs Arpit's tasks 4–5)
### Part 4 · DoorDash MCP (human + Claude): see the runbook

## Environment notes
- Docker's Postgres (`care-circle-db`) serves `localhost:5432` now that the native Windows services are stopped. If they start again after a reboot, voice fails on DB auth.
