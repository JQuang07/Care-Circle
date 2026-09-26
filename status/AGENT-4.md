# Agent 4 · Integrator + Web — status
_Last updated: integration-v2, Part 1 task 1 (contracts) done._

## Part 1 · integration-v2 checklist (docs/agents/agent-4-integrator-web.md)
- [x] **1. Contracts package:** addendum v1.0.2 applied to `packages/contracts` (types + zod + drift guard + self-test, 28/28).
  - D5 action payloads per kind (`MESSAGE_ACTIONS`), `MessageActRequest` with the four allowed client extras
  - D6 `everAskedForMoney: boolean` · D7 `Dependent.birthday?` + `Senior`/`Member`/`Circle` shapes · D9 `Order.fulfilment?`
  - D11 `CallEnded.scheduledCallId?`, `OrderRequest.scheduledFor?`, `Circle.seniorHints`, `CallJoin`, `VoiceNote`; D1–D4/D8 bodies (`OkResponse`, `TimeTravelRequest`, `FireDueRequest`, `DemoCall`, `SimulateVerification*`, `ScheduledCallDue`, `HoldResolveRequest`)
  - D14 `Quote`, `QuoteLine`, `QuoteRequest`, `DeliveryOrder`, `DeliveryStatus`, `DeliveryHealth`, `DeliveryStatusEvent`, request bodies
  - Drift guard re-tested by planting drift (caught). Schemas validated against the live voice/money/family/delivery responses.
- [x] **2. E2E** (self-test 13/13, 10 runs in a row; 9/9 planted bugs caught and routed)
  - Addendum endpoints: new `E2E 0` resets family → money → delivery → voice (D1, one scenario per owner); D2 `fire-due` and D3 `/demo/calls` + `simulate-verification` (`{ speaker, text }[]`, also fixes web's `/demo` payload) are now required, not "proposed"; D5 payloads are schema-checked (`MESSAGE_ACTIONS`).
  - **E2E 4 fixed:** selects only a `gift` order to `mem_lisa` created after the scenario started. The fake stack now injects a late E2E-3-style scam order; the old test reported "FALSE HOLD" on it, the new one passes.
  - **E2E 1 extended:** paid → delivery `dry_run_complete` (mock) → `/demo/advance {to:"delivered"}` → family "arrived" message → money `GET /orders/:id` shows `fulfilment.delivery.status = delivered`.
  - "Order drafted" vs. "Rose's yes confirms it (D16)" are separate steps, so a stuck `approved` order is routed to voice, not money.
  - **Refuses to run** unless delivery `/health` is `provider: "mock"`, `liveCheckout: false` (planted `live-provider` bug → "REFUSING TO RUN").
  - D16 guard test: every purchase script ends with a line that confirms under the addendum rule.
  - Fake stack: delivery mock on :5004, `/demo/reset` everywhere, money `GET /orders/:id` + `fulfilment`.
- [x] **3. Demo reset chain:** "Reset all data" calls `/demo/reset` on family → money → delivery → voice (`RESET_ORDER` in `lib/services.ts`), tries every service even if one fails, and names each failure. Delivery added to the web proxy (health, orders, reset; `/demo/advance` stays blocked) and the `/demo` health strip. Verified through the proxy: family + delivery `{ ok: true }`; money + voice 404 until their D1 task lands.
- [x] **4. Web delivery UI:** `components/DeliveryStatus.tsx` + `lib/delivery.ts`. Shows store, plain-words status, ETA (hidden once delivered/failed), "Track it" link, and "Store didn't have: …" (`fulfilment.unmatchedItems`) on the dashboard's Recent orders and on the phones' `add_to_order` card. Status comes from delivery `/orders` (freshest), falling back to money's `order.fulfilment.delivery`. **DRY RUN** badge on every delivery unless delivery `/health` says `liveCheckout: true` (unreachable counts as dry run). Verified in a real browser against a live `dry_run_complete` delivery; the phone card can't be shown live until money sends family events (A2 D15) and fills `fulfilment` (A2 D9), so the sample data now carries a delivery too.
- [x] **5. Web demo panel DoorDash controls** (`components/DoorDashPanel.tsx`): provider line with DRY RUN / "LIVE CHECKOUT ARMED"; "Quote groceries (DoorDash)" shows the quote table (matched, "Which one?" options for ambiguous lines, not found, subtotal, fees, total). **"Place real order"** is rendered only when delivery `/health` is `doordash_thirdparty` + `liveCheckout: true`, only for `awaiting_live_checkout` deliveries; shows store and amount; needs a name and the typed `PLACE REAL ORDER` (paste blocked). The web proxy re-checks the phrase **server-side**, forwards only `{ confirmedBy }`, and adds `X-CC-Secret`; delivery allowlist now has `POST /quote` and `/orders/:id/checkout`.
  - Verified in Chrome: on mock, no button (and delivery answers `LIVE_CHECKOUT_DISABLED` even to a full confirmation). Against a fake armed delivery on a throwaway web instance: button disabled until name + exact phrase; click → the fake received `{"confirmedBy":"Claire"}` with the secret; the secret never appeared in the page or any browser request. Proxy refuses a missing/wrong phrase (403) or missing name (400).
- [x] **6. `/call/:id` joins LiveKit** (`@livekit/components-react` `VideoConference`). `?member=mem_x` (D5 `roomJoinUrl`) picks who you are; without it, a "Who's joining?" picker lists the call's members. Credentials come from family `GET /schedule/calls/:id/join?memberId=` (D11) through the proxy (added to the family allowlist). Mock credentials (`ws://fake-livekit` / `fake.` token) show a labeled "Simulated video room" instead of trying to connect; an uninvited member sees "isn't invited"; a failed connect shows the server URL and error; leaving shows "Rejoin".
  - Verified in Chrome (fake camera) against a throwaway `livekit-server --dev` container on :7880 (the `.env` devkey/secret): a real call made through family's contract endpoints; Lisa and Danny both joined and saw each other's tiles, Mark was refused, Leave → Rejoin.
  - Note: no LiveKit server runs by default (not in `docker-compose.yml`), so real video needs one started by hand or LiveKit Cloud.
- [x] **7. Integration duty (recurring; tooling ready):** after each checkpoint merge run `pnpm e2e`, then `pnpm e2e:file` (dry run) → `pnpm e2e:file --write`. `scripts/file-bugs.ts` files each failure under `## BUGS FROM INTEGRATION` in the owner's status file (voice → A1, money → A2, family/delivery → A3) with expected/actual and the last request/response, replaces the "none yet" placeholder, never duplicates an entry (HTML-comment marker), and touches nothing outside that heading. web/contract failures are listed, not filed. Tested with a planted bug (write, re-run = 0 new, reverted).
  - Not filed yet: no checkpoint merge has happened, and today's 7 failures (table below) are all tasks already assigned in the runbooks. First real filing: after the Part-1 checkpoint merge.
- [ ] 8. Final README (H62)

## Done
- **Monorepo:** pnpm workspace (`packages/contracts`, `services/{voice,money,family}`, `apps/web`, `e2e`), Node ≥22.12, pnpm 10 pinned.
- **Database:** `docker-compose.yml` (Postgres 16). `scripts/init-schemas.sql` creates `voice`, `money`, `family`, `web`.
- **Seed:** `pnpm seed` re-applies the schemas safely, then runs each service's `seed` script in order family → money → voice. It stops at the first failure and names the owner. Tested on a fresh database, on a re-run, with a failing service seed, and with Postgres down.
- **Contracts:** `packages/contracts` holds the §3 types verbatim and matching zod schemas.
  - A compile-time drift guard fails `pnpm typecheck` if a type and its schema disagree. Tested by planting drift; it was caught.
  - A runtime self-test passes 12/12 (`pnpm --filter @care-circle/contracts test`).
  - The only refinements are ones the contract states in words: integer cents (§0) and score 0–100 (§3).
- **Service skeletons:**
  - Fastify on the §1 ports.
  - `/health` in the §0 shape.
  - 404s and errors in the §0 error shape.
  - A no-op, idempotent `src/seed.ts` for each owner to replace.
- **Scripts:**
  - `pnpm dev` runs all four with labeled output.
  - `pnpm health` is the H8 check and validates the `/health` shape.
  - `pnpm typecheck` covers every package.
- **Web (Next 16, Tailwind 4, Atkinson Hyperlegible):**
  - `/api/svc/*` proxy. It adds `X-CC-Secret` server-side and enforces a path allowlist. `GET /circle` (phone numbers, "internal only") is never exposed to the browser.
  - `/family` phone simulator.
    - Polls every 1.5s. Renders every `Message.kind`; the switch is exhaustive, so the build breaks if a kind is added and not rendered.
    - Fraud cards list the signals pulled from money's order.
    - Slot buttons show the reader's local time and Rose's.
    - Any new message scrolls into view, even if that phone was scrolled up.
    - Replies, and a simulated passkey release labeled on screen.
  - `/dashboard`: week line, paused purchases with the "why we paused" text, recent orders, upcoming calls. The fraud drawer shows all four layers with weights, score, risk, typology, and what Rose and the family were told.
  - `/demo`:
    - Five scenario buttons, plus "Danny answers the check-in call."
    - "Fast-forward to <next call>," "Show eval results," and "Reset all data."
    - A service health strip.
  - `/tablet` (Plan B): huge type and one green button. It auto-answers after a visible 5-second countdown, and only for calls that come from Rose's own schedule.
  - `/call/:id`: placeholder until LiveKit (Phase 3).
  - Sample data appears only when a service is unreachable, always under a visible label.
- **E2E:** all five scenarios are written.
  - Assertions only look at what's new since the test started, so runs repeat without a reset.
  - Every response is schema-checked.
  - Each step names the owning service. Failures are written to `e2e/reports/latest.md`, grouped by status file and including the request/response.
- **E2E self-test (`pnpm e2e:selftest [N]`):** runs the real suite against an in-memory fake of the three services on ports 5001–5003.
  - All 5 pass, 10 runs in a row, with no reset.
  - Mutation-tested: 7 planted bugs, each caught by exactly one scenario and routed to the right agent:

    | Planted bug | Routed to |
    |---|---|
    | Privacy leak | Agent 3 |
    | Scam paid | Agent 2 |
    | Wrong time zone | Agent 3 |
    | Slot during Rose's nap | Agent 3 |
    | $25 heard as 25 cents | Agent 1 |
    | High-risk hold released | Agent 2 |
    | Scam missing from moments | Agent 3 |

- **UI verified in a real browser, against the fake stack:** `/demo` buttons → proxy → services → live messages on `/family`; slot taps moved the proposal to `awaiting_senior`; the drawer renders all four layers; no page errors.

## In progress
- Phase 1: nothing is blocked. Next up is voice-note recording plus a web upload endpoint (schema `web`), and SSE for `/family`.

## Blocked on
- Scenario 2 steps 7–8 need CCR-02 and CCR-03. Scenario 3 step 5 needs CCR-04. Until they're approved, those steps fail as "CONTRACT GAP" and are routed to the human, not to an agent.

## CONTRACT CHANGE REQUESTS
Each one is needed for a checkpoint item. The E2E suite already calls the proposed shapes, so approving a CCR as written needs no test changes.

**CCR-01 · Reset.** `POST /demo/reset` → `{ ok: true }` on voice, money, and family.
- Each service restores its own schema to the seed state; web calls them family → money → voice.
- Needed for the "Reset all data" button and for a clean demo take.

**CCR-02 · Fast-forward.** `POST family /demo/fire-due` `{ scheduledCallId }` → `{ ok: true }`.
- Family fires `scheduled_call.due` now instead of waiting for the wall clock.
- Needed for "Fast-forward to Sunday 4pm" and E2E 2.

**CCR-03 · Call log.** `GET voice /demo/calls?seniorId=` → `{ callId, kind, purpose?, scheduledCallId?, startedAt }[]`.
- E2E 2 must prove `/calls/outbound` was hit, and nothing in §4 can show that today.

**CCR-04 · Scripted verifier.** `POST voice /demo/simulate-verification` `{ seniorId, holdId, memberId, script: string[] }` → `{ callId }`.
- Simulates the verification call with the member's lines as text. The voice agent then resolves the hold through `resolve_hold_verbal`.
- Needed for E2E 3 ("scripted Danny says cancel") and the demo button. Today's `script: string[]` has no speaker, so it can't carry Danny's lines.

**CCR-05 · Message action payloads** (convention, no new endpoint). Proposed shapes:

| Message kind | `action` value(s) | `payload` |
|---|---|---|
| `schedule_proposal` | `accept_slot` | `{ proposalId, slotId, slot: Slot }` |
| `fraud_card` | `cancel_hold` / `release_hold` | `{ orderId, holdId }` |
| `add_to_order` | e.g. `add_item` | `{ orderId, … }` |

- Without `slot` in the payload, the web can't show local times: no endpoint returns a proposal by id.
- `release_hold` is handled in the web app with a passkey, not by family.
- `ScheduledCall.roomJoinUrl` should be `${WEB_URL}/call/${id}`.

**CCR-06 · `everAskedForMoney`.** §3 types it as the literal `false`, so layer 4 can never report "has asked for money before."
- Proposal: change it to `boolean`. It's encoded literally for now.

**CCR-07 · Types for §4 bodies not in §3.** Proposal: add these to §3.
- The `/moments` response. E2E pins only `scamsStopped` and `savedCents` (integer).
- The `/credentials/:seniorId` response and the `/eval/results` response.
- `passkeyAssertion`. The web currently sends `{ simulated: true, memberId, at }`.
- A real WebAuthn release would also need `POST money /passkeys/challenge` and a registration flow.

**CCR-08 · Mia's gift.** The kit README says the gift passes because "Mia is in the circle, her birthday is on the calendar." But CONTRACTS.md §2 says Mia is not a member, and no birthday exists in the seed.
- Add `birthday: "MM-DD"` to `dependents` in the seed.
- State that a gift for a dependent routes through the parent (`recipientMemberId: "mem_lisa"`) and does not trip `gift_card_nonmember`.
- Affects Agents 1, 2, and 3.

**CCR-09 · `/moments?week=` format.** Proposal: ISO week (`2026-W39`) in Rose's time zone; omitted means the current week.

## Notes for the coordinator
- The root `CLAUDE.md` is gitignored, because four different copies would conflict on every merge. Keep each agent's brief local.
- Status files: agents write above the marker comment; I write below it. The gap between them keeps checkpoint merges clean.
- Open the web app at `http://localhost:3000`. `127.0.0.1` also works (allowed in the config).
- E2E 5's "whole inbox is clean" step fails permanently after any real leak, until CCR-01's reset exists. That's on purpose: a leak is a leak.

## Integration report (latest E2E run)
**2026-09-26, live services on `claire` (= main + task 1–2), delivery on mock: 6/13 pass.** Not filed in owners' status files yet (Part 1 task 7 does that after the next checkpoint merge); every failure matches a task already assigned in `docs/INTEGRATION-REPORT.md`:
| Scenario | Routed to | Symptom | Their task |
|---|---|---|---|
| E2E 0 money/voice reset | Agent 2 / Agent 1 | `POST /demo/reset` → 404 | A2 task 8, A1 (D1) |
| E2E 1, 4, 5 | Agent 1 | order stays `approved`; Rose's "yes" isn't taken as confirmation | A1 task 1 (D16) |
| E2E 2 | Agent 3 | proposal buttons use `schedule_accept` with no `slot` (D5 wants `accept_slot` + `{ proposalId, slotId, slot }`) | A3 (D5) |
| E2E 3 | Agent 3 (report) | no `fraud_card`. Root cause per the integration report: money with `MOCK=1` never sends events to family | A2 task 1 (D15) |
Passing: D16 guard, family + delivery reset.

### Earlier runs
Run against the Phase 0 skeletons, at H3: **0/5 pass, as expected.** Each scenario stops at its first snapshot call with `404 NOT_FOUND` (for example `GET money /orders`), routed to Agent 2 or Agent 3. No bugs are filed yet, because the stubs are due at H8.
Self-test against the fake stack: **5/5, 10 runs in a row.**
