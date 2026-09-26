# AGENT-3 · Family & Scheduling: status

Branch `andy` · service `services/family` on **:4003** · schema `family` · detailed checklist: `services/family/TASKS.md`

Also owns `services/delivery` on **:4004** (D14). Run everything with `pnpm dev` from the repo root. Tests: `pnpm --filter @care-circle/family test`, `pnpm --filter @care-circle/delivery test`.

## Done
- **Phase 0:** Fastify service, root `.env`, Postgres `family` schema + idempotent migrations (in-memory fallback under `MOCK=1`), seeded circle (CONTRACTS §2) + relationship facts + weekly availability + 8 weeks of call history (Danny most Sundays ~4pm ET, Lisa midweek, Mark rarely). WhatsApp-mock message store. LiveKit room creation + join tokens verified against local LiveKit (`npm run livekit:check`).
- **Phase 1:** every CONTRACTS §4 family endpoint + every §5 webhook responds per contract. **`GET /contact-rhythm/sen_rose` is computed from seeded history**, e.g.:
  `mem_danny: "Sundays ~4pm", lastContactAt = last Sunday, callsLast30d 4` · `mem_lisa: "Midweek, usually Wednesdays ~7pm"` · `mem_mark: "About once a month…"` · `everAskedForMoney: false` for everyone.

- **Phase 2:** post-call pipeline (privateSpans stripped before Muse → hooks → routing → warm nudges, ≤1/member/day), health/complaint/guilt filters, family code word never written into messages (checked by hash), `order-paid` → `add_to_order` ("Add something" = *coming soon* in v1, voice note for delivery) + receipts to funders, voice notes stored per order, messages API. **DoD test: private span never appears in any hook, nudge, or briefing.**

- **Phase 3:** fraud cards to verifiers (cancel → money, approve requires passkey assertion, "I'm calling her" notifies the other verifier), all-clear + code-word practice reminder. Scheduling: hard constraints in code (Rose 10–19 local, nap, church, booked rides, existing calls; members' availability + tz; Mia outside school, only via Lisa), Muse ranks + writes reasons (bad picks dropped), proposals → accepts → `awaiting_senior` → `confirm-senior` → LiveKit room + join URLs → T-60 briefing, T-30 reminder, T-0 `scheduled_call.due` + `ringing`. Weekly calls with fair host rotation, visits (+ groceries hint for Rose), `ai_rhythm` job, moments. **All four DoD tests pass**; verified live with real LiveKit + Muse (`dev/scenario.ts`).

- **Phase 4:** no common slot → next-best slots + "could you flex?" (Rose's constraints never relaxed); full declines → re-plan (max 3 rounds, then ask for a time); stale slot taps → 409 `SLOT_EXPIRED`; availability across midnight; DST (UK Oct 25 / US Nov 1: Mark is 8pm, not 9pm, on Oct 25; weekly calls keep local time); missed calls; demo reset/time-travel. 78 tests passing.

- **Integration v2 · task 1 (D10):** a request that names members needs all of them to accept the same slot; one that names nobody goes to `awaiting_senior` once any 2 invitees accept the same slot. Non-responders stay invited and get the join link. This fixes E2E 2 ("proposal never reaches Rose").
- **Integration v2 · task 2 (D5):** buttons now use the addendum action names. `accept_slot` payloads carry the full `Slot`, fraud-card payloads are exactly `{ orderId, holdId }`, and nudges and briefings get `call_now` / `dismiss`. The stored payload wins over client keys; the pre-D5 names still work as aliases.
- **Integration v2 · task 3 (D2 + D4):** `POST /demo/fire-due { scheduledCallId }` (secret) sets `ringing` and sends `scheduled_call.due` now. The due body now carries `phase: "reminder" | "due"`, and the `X-CC-Phase` header stays.
- **Integration v2 · task 4 (D6/D7/D11/D12):** `everAskedForMoney` is a `boolean`; Mia is seeded with `birthday: "10-14"`. `call.ended` matches by `scheduledCallId` when voice sends it. `/moments` defaults to the current ISO week in Rose's time zone (`?week=2026-W39` or any `YYYY-MM-DD`; `last7` is still accepted). The join, proposal, `seniorHints` and voice-notes endpoints were already live.
- **Integration v2 · task 5:** `POST /webhooks/delivery-status` (secret, idempotent by `deliveryId` + `status`). `dry_run_complete` goes to Lisa; `placed`/`picked_up` send an ETA note (with a tracking button when there's a URL) to the circle; `delivered` goes to the circle plus `POST voice /calls/outbound { purpose: "delivery_arrived", orderId }` (a 400 from voice is ignored); `failed` goes to verifiers with `failureReason`. Delivery events now also carry `seniorId` and `storeName`. Without them, family looks up `GET delivery /orders/:id`.
- **Integration v2 · task 6 (part):** config reads only `FAMILY_PORT ?? 4003`; `PORT` is ignored.
- **Integration v2 · task 7:** the Postgres store test now runs, not skipped, against Docker's `care-circle-db`. 103 family tests and 15 delivery tests pass.

## In progress
- Integration v2 tasks 2–7 (`docs/agents/agent-3-family.md` Part 1), then delivery upkeep and live E2E. Checklist: `services/family/TASKS.md` Phase 5.

## Blocked on
- **Task 6, contracts swap:** the addendum types (`everAskedForMoney: boolean`, `birthday`, `ScheduledCallDue.phase`, `Quote`/`DeliveryOrder`) are on `origin/claire` but not on `main`, so `services/family/src/contracts-local.ts` and `services/delivery/src/types.ts` stay until Agent 4's contracts merge.
- Nothing else. (Postgres fixed: the native Windows services are stopped and Docker's database serves :5432.)

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
7. **CCR-7: superseded by addendum D12** (default is now the current week).
8. **CCR-8: superseded by addendum D5** (implemented in integration v2). Family also keeps `make_weekly`, `decline_weekly`, `open_url` (the "Join call" link on confirmations), `schedule_decline`, and `schedule_request`. The pre-D5 names still work as aliases on older stored messages.
9. **CCR-9 (auth scope).** Family requires `X-CC-Secret` on `/webhooks/*`, `/circle/*`, `/jobs/*`, `/demo/*`. Other routes stay open so the web app can call them. Set `FAMILY_REQUIRE_SECRET_ALL=1` to lock everything once web calls go server-side.

## BUGS FROM INTEGRATION
- **For Agent 1 (`services/voice/src/app.ts` `/webhooks/scheduled-call-due`):** it enqueues `due:${call.id}` without reading `phase`, so the T-30 **reminder** looks the same as T-0 and may ring Rose 30 minutes early. Family now sends `phase: "reminder" | "due"` in the body (D4); please branch on it.
- **For Agent 4 (root `scripts/seed.ts:50`): `pnpm seed` fails on Windows.** It prints "family seed failed (exit null)" because Node can't find `pnpm.cmd` when `spawnSync("pnpm", …)` runs without a shell. Fix: `spawnSync("pnpm", args, { …, shell: process.platform === "win32" })`. Workaround until then: run `npx dotenv -e .env -- pnpm --filter @care-circle/<svc> run seed` for family, money, delivery and voice, in that order.
