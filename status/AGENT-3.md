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

- **Part 3 (live checks, 2026-09-27):** `pnpm health` shows 5 green; 103 family and 15 delivery tests pass. Live: delivery `/quote` returns matched lines + fees; a `dry_run_complete` event puts the delivery message in Lisa's inbox. Replaying a real money hold into `/webhooks/fraud-hold` gives Danny a `fraud_card` with `calling_her` / `cancel_hold` / `release_hold` and `{ orderId, holdId }`.

## In progress
- Waiting to rerun `pnpm e2e` after the next integration merge (see BUGS); then Part 4 (DoorDash MCP, with Andy).

## Blocked on
- **Task 6, contracts swap:** the addendum types (`everAskedForMoney: boolean`, `birthday`, `ScheduledCallDue.phase`, `Quote`/`DeliveryOrder`) are on `origin/claire` but not on `main`, so `services/family/src/contracts-local.ts` and `services/delivery/src/types.ts` stay until Agent 4's contracts merge. Checked 2026-09-27: claire's `packages/contracts/src/types.ts` matches both local files field for field, so the swap is mechanical once it's on `main`. The swap also adds `"@care-circle/contracts": "workspace:*"` to family and delivery, which changes the root `pnpm-lock.yaml`. **Agent 4:** please add those two deps when you merge contracts, or say that I may.
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
- **Rerun (2026-09-27, later): still 0 of 5, with the same causes.** `e2e/reports/latest.md` routes **E2E 3 to Agent 3, but that's wrong**. Money holds were created (`GET money /holds` shows them open); money on `main`/`andy` uses `RecordingEvents` under `MOCK=1` (`services/money/src/index.ts:23`), so `/webhooks/fraud-hold` never gets called. Replaying one of those holds into family by hand produces the fraud card. Arpit's fix is already on `origin/arpit` (`neighbors.ts`). **Agent 4:** please route "no fraud_card" to Agent 2 in `scripts/file-bugs.ts`.
- **Live E2E run (2026-09-27, all services on this branch's code, `pnpm health` 5 green): 0 of 5 pass, and none of the failures are in family or delivery.**
  - E2E 1 and E2E 5 (Agents 1 and 2): the grocery order stays `approved` and never becomes `paid`, so the voice confirm → money `/orders/:id/confirm` step doesn't happen. E2E 5's privacy checks never ran.
  - E2E 2 (Agent 1): family now sends Lisa and Danny the proposal (D10 fix confirmed), then voice `POST /demo/simulate-inbound` → HTTP 500 INTERNAL_ERROR.
  - E2E 3 (Agent 2): no fraud card within 60s, so no hold event reached family.
  - E2E 4 (Agent 2): Mia's gift was falsely held with `GIFT_CARD_NONMEMBER` and `SECRECY` (D7 says a gift with `recipientMemberId: mem_lisa` must pass).
- **For Agent 1 (`services/voice/src/app.ts` `/webhooks/scheduled-call-due`):** it enqueues `due:${call.id}` without reading `phase`, so the T-30 **reminder** looks the same as T-0 and may ring Rose 30 minutes early. Family now sends `phase: "reminder" | "due"` in the body (D4); please branch on it.
- **For Agent 4 (root `scripts/seed.ts:50`): `pnpm seed` fails on Windows.** It prints "family seed failed (exit null)" because Node can't find `pnpm.cmd` when `spawnSync("pnpm", …)` runs without a shell. Fix: `spawnSync("pnpm", args, { …, shell: process.platform === "win32" })`. Workaround until then: run `npx dotenv -e .env -- pnpm --filter @care-circle/<svc> run seed` for family, money, delivery and voice, in that order.

## Demo MVP finish (integration-v3)
- Family planner Muse call: 6 s timeout, `reasoning_effort: "minimal"` (it overran voice's 10 s dependency timeout → 500 on "set up a call").
- Root `scripts/demo-run.ts` + `pnpm demo:run`. See docs/FINISH-PROGRESS.md.

## Demo hotfix 2026-09-27 (integration-v3)
- Delivery `/health` answers from a cached DoorDash status. Web's health polling had jammed the one-at-a-time browser queue, so grocery quotes never ran and the stage hung.
- Dry run: if the DoorDash cart build breaks, the dry run finishes on the quote's prices (amount and cap gates still apply; the reason is kept in `cartNote`). Live mode still fails.
- Quotes reuse the login check (5 min) and store lookup (30 min).
- dd-mcp patch: waits for the grocery `/convenience` redirect; reads `$0.59/lb` / `each` produce prices (bananas). Needs an MCP server restart.
- **For Agent 4, done with the human's OK:** `apps/web/app/stage/page.tsx` speaks a holding line ("One moment, Rose. I'm checking Kroger's prices…") when a turn takes more than 1.5 s. Rose's line is placed above it once the transcript arrives.
- **For Agent 1, done with the human's OK:** voice `POST /demo/speak { text }` → Deepgram Aura-2 MP3 (MOCK=1, secret, in-memory cache). `ttsKey()` in `speech.ts` falls back to reading the repo-root `.env`, so a key added after `pnpm dev` started works without a restart; phone TTS uses it too.
- **For Agent 4, done with the human's OK:** web `/api/stage/speak` proxy; the stage speaks with Aura-2 (holding lines pre-fetched) and falls back to the browser voice. Replies are labelled "Care Circle (AI voice)".
- Rose's voice (with the human's OK): `demo-audio/make-rose-voice.ts` regenerates her clips with the voice service recipe (`ROSE` in `services/voice/src/speech.ts`): Deepgram `aura-2-athena-en`, 12% slower and lower, a slight pitch and loudness tremor, and sentence pauses. `/demo/speak { voice: "rose" }` returns the same aged WAV for typed lines. Danny's clip is untouched; Muse transcribes all 9 clips word for word.
- dd-mcp patch: the Checkout link is followed directly (the drawer's button was "not stable"). Verified: milk, bananas and bread all landed in the real Kroger cart (dry run, emptied afterwards).
