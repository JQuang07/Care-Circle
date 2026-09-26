# Agent 4 · Integrator + Web — status
_Last updated: integration-v2, Part 1 task 1 (contracts) done._

## Part 1 · integration-v2 checklist (docs/agents/agent-4-integrator-web.md)
- [x] **1. Contracts package:** addendum v1.0.2 applied to `packages/contracts` (types + zod + drift guard + self-test, 28/28).
  - D5 action payloads per kind (`MESSAGE_ACTIONS`), `MessageActRequest` with the four allowed client extras
  - D6 `everAskedForMoney: boolean` · D7 `Dependent.birthday?` + `Senior`/`Member`/`Circle` shapes · D9 `Order.fulfilment?`
  - D11 `CallEnded.scheduledCallId?`, `OrderRequest.scheduledFor?`, `Circle.seniorHints`, `CallJoin`, `VoiceNote`; D1–D4/D8 bodies (`OkResponse`, `TimeTravelRequest`, `FireDueRequest`, `DemoCall`, `SimulateVerification*`, `ScheduledCallDue`, `HoldResolveRequest`)
  - D14 `Quote`, `QuoteLine`, `QuoteRequest`, `DeliveryOrder`, `DeliveryStatus`, `DeliveryHealth`, `DeliveryStatusEvent`, request bodies
  - Drift guard re-tested by planting drift (caught). Schemas validated against the live voice/money/family/delivery responses.
- [ ] 2. E2E: addendum endpoints, fix E2E 4 order selection, extend E2E 1 through delivery, refuse unless delivery is `mock`, delivery in the fake stack
- [ ] 3. Demo reset chain: family → money → delivery → voice
- [ ] 4. Web delivery UI: status/ETA/tracking, DRY RUN badge, `unmatchedItems`
- [ ] 5. Web demo panel DoorDash controls (quote table; guarded "Place real order" via the proxy)
- [ ] 6. `/call/:id` joins LiveKit via family `/schedule/calls/:id/join`
- [ ] 7. Integration duty: `pnpm e2e` after each checkpoint merge, bugs filed in owners' status files
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
Run against the Phase 0 skeletons, at H3: **0/5 pass, as expected.** Each scenario stops at its first snapshot call with `404 NOT_FOUND` (for example `GET money /orders`), routed to Agent 2 or Agent 3. No bugs are filed yet, because the stubs are due at H8.
Self-test against the fake stack: **5/5, 10 runs in a row.**
