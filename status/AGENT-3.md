# AGENT-3 · Family & Scheduling: status

Branch `andy` · service `services/family` on **:4003** · schema `family` · detailed checklist: `services/family/TASKS.md`

Run: `cd services/family && npm install && npm run dev` (seeds itself on first boot). Tests: `npm test`. Dev fakes for voice/money: `npm run fakes`.
(pnpm isn't installed on this machine, so the package uses npm scripts only. It drops into a pnpm workspace as-is.)

## Done
- **Phase 0:** Fastify service, root `.env`, Postgres `family` schema + idempotent migrations (in-memory fallback under `MOCK=1`), seeded circle (CONTRACTS §2) + relationship facts + weekly availability + 8 weeks of call history (Danny most Sundays ~4pm ET, Lisa midweek, Mark rarely). WhatsApp-mock message store. LiveKit room creation + join tokens verified against local LiveKit (`npm run livekit:check`).
- **Phase 1:** every CONTRACTS §4 family endpoint + every §5 webhook responds per contract. **`GET /contact-rhythm/sen_rose` is computed from seeded history**, e.g.:
  `mem_danny: "Sundays ~4pm", lastContactAt = last Sunday, callsLast30d 4` · `mem_lisa: "Midweek, usually Wednesdays ~7pm"` · `mem_mark: "About once a month…"` · `everAskedForMoney: false` for everyone.

- **Phase 2:** post-call pipeline (privateSpans stripped before Muse → hooks → routing → warm nudges, ≤1/member/day), health/complaint/guilt filters, family code word never written into messages (checked by hash), `order-paid` → `add_to_order` ("Add something" = *coming soon* in v1, voice note for delivery) + receipts to funders, voice notes stored per order, messages API. **DoD test: private span never appears in any hook, nudge, or briefing.**

- **Phase 3:** fraud cards to verifiers (cancel → money, approve requires passkey assertion, "I'm calling her" notifies the other verifier), all-clear + code-word practice reminder. Scheduling: hard constraints in code (Rose 10–19 local, nap, church, booked rides, existing calls; members' availability + tz; Mia outside school, only via Lisa), Muse ranks + writes reasons (bad picks dropped), proposals → accepts → `awaiting_senior` → `confirm-senior` → LiveKit room + join URLs → T-60 briefing, T-30 reminder, T-0 `scheduled_call.due` + `ringing`. Weekly calls with fair host rotation, visits (+ groceries hint for Rose), `ai_rhythm` job, moments. **All four DoD tests pass**; verified live with real LiveKit + Muse (`dev/scenario.ts`).

- **Phase 4:** no common slot → next-best slots + "could you flex?" (Rose's constraints never relaxed); full declines → re-plan (max 3 rounds, then ask for a time); stale slot taps → 409 `SLOT_EXPIRED`; availability across midnight; DST (UK Oct 25 / US Nov 1: Mark is 8pm, not 9pm, on Oct 25; weekly calls keep local time); missed calls; demo reset/time-travel. 78 tests passing.

## In progress
- Nothing. Standing by for integration bugs. Ready for Checkpoint merges.

## Blocked on
- **Postgres on this machine (human):** `localhost:5432` reaches a *native* Windows PostgreSQL service (`postgresql-x64-16`/`-17`), not the `cc-pg` Docker container, so `postgres:dev` is rejected. Until the native services are stopped (or `.env` points elsewhere), family runs on its in-memory store (`MOCK=1`); data resets on restart.

## CONTRACT CHANGE REQUESTS
1. **CCR-1 (additive endpoints on family).** Please add to CONTRACTS §4:
   - `GET /schedule/calls/:id/join?memberId=` → `{ serverUrl, roomName, identity, token }`: LiveKit credentials for Agent 4's `/call/:scheduledCallId` page. (`roomJoinUrl` = `${WEB_URL}/call/:id`; per-member links add `?member=mem_x`.)
   - `GET /orders/:orderId/voice-notes` → `{ id, orderId, memberId, memberName, url, createdAt }[]` for the delivery screen.
   - `GET /schedule/proposals/:id` → `Proposal`.
   - Demo panel (require `X-CC-Secret`): `POST /demo/reset`, `GET /demo/clock`, `POST /demo/time-travel { nowUtc } | { to: "next_call", minutesBefore? }` (fast-forward to Sunday 4pm; runs the scheduler right away), `POST /jobs/tick`, `POST /jobs/rhythm { seniorId }`.
2. **CCR-2 (ride time).** `OrderRequest` has no time field, so family can't block Rose's *booked rides* when scheduling. Request optional `OrderRequest.scheduledFor?: string` (ISO UTC) for `type: "ride"`. Family already reads `scheduledFor` / `pickupAt` if present.
3. **CCR-3 (reminder vs due).** §5 uses one path and payload for the T-30m reminder and the T-0 due event. Family sends header **`X-CC-Phase: reminder | due`** on `POST voice /webhooks/scheduled-call-due`. Please document it (or add a `phase` field).
4. **CCR-4 (cancel from the app).** The "Cancel it" fraud-card button calls `POST money /holds/:id/resolve { decision: "cancel", method: "passkey_web" }` **without** a `passkeyAssertion` (cancel is always allowed). Please confirm money accepts that, or add `method: "app_button"` for cancels.
5. **CCR-5 (Rose-side hints).** `GET /circle/:seniorId` also returns `seniorHints: { text, createdAt }[]` (e.g. *"Lisa is visiting Sat. Want groceries for lunch?"*) for the voice agent's `get_family_context()`. Additive.
6. **CCR-6 (scheduled call id on call.ended).** `CallEnded` has no `scheduledCallId` for `kind: "scheduled_family_call"`; family matches by start time (±3h). Request optional `CallEnded.scheduledCallId`.
7. **CCR-7 (`/moments` week param).** No `week` = rolling last 7 days. `week=YYYY-MM-DD` (any day in it), `YYYY-Www`, or `current` = Monday-start calendar week in Rose's tz.
8. **CCR-8 (message action vocabulary, for Agent 4).** `POST /messages/:id/act { action, payload }`. The stored button payload is used; clients may add only `voiceNoteUrl`, `passkeyAssertion`, `note`, or pick a slot via `payload.slotId`. Actions: `schedule_accept`, `schedule_decline`, `schedule_decline_all`, `schedule_request`, `call_senior`, `add_item` (v1: *coming soon*), `record_voice_note` (+`voiceNoteUrl`), `fraud_calling`, `fraud_cancel`, `fraud_approve_passkey` (+`passkeyAssertion`, else 400 `PASSKEY_REQUIRED`), `make_weekly`, `decline_weekly`, `open_url`.
9. **CCR-9 (auth scope).** Family requires `X-CC-Secret` on `/webhooks/*`, `/circle/*`, `/jobs/*`, `/demo/*`. Other routes stay open so the web app can call them. Set `FAMILY_REQUIRE_SECRET_ALL=1` to lock everything once web calls go server-side.

## BUGS FROM INTEGRATION
_(none yet)_
