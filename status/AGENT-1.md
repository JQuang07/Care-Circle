# Agent 1 — Jayden / voice

Updated 2026-09-26. Branch `jayden`, synced with integration-v2 on main. Changes committed and pushed task-by-task; no HOLD.md existed at each checkpoint. Application changes stay in services/voice and this status file.

## Done

- D16: natural purchase confirmations; negation/hesitation/extra details fail closed; playback completion and changed-order safeguards retained. Add-item mock requests re-quote within the current call.
- D1/D3: authenticated reset, senior-filtered call summaries, role-bound verification simulation using the same verbal hold-resolution path as real calls. High-risk release still requires app approval.
- D4: body-first reminder/due phase, header fallback, separate deduplication for each phase.
- D9: exact returned totals, store/provider wording, one clarification for unmatched items, re-quote after skipping, explicit dry-run language, changed-quote invalidation.
- D7: Mia gifts route through verified parent mem_lisa with Mia in statedReason. Birthday demo amount and confirmation supported.
- Optional get_order_status: newest senior-owned order with actual delivery status/ETA; no invented delivery promise.
- Mock grocery demo now retains named items and re-reads after its garden-news sentence before taking a new confirmation.
- Original Twilio/Deepgram transport, signature/stream binding, privacy spans, outbox, verification hard stops, and SIP/tablet paths preserved.
- Private root .env and CLAUDE.local.md created; pinned pnpm 10.34.5 dependencies installed. Mac checklist: services/voice/docs/JAYDEN-SETUP.md.

## Verification

- 49/49 voice unit and transport tests pass.
- Whole-workspace typecheck and voice source/test formatting pass.
- Actual local HTTP processes: voice, money, family, delivery, web all healthy. Temporary test secret, in-memory storage, MOCK=1 and MOCK_DEPENDENCIES=0; this is NOT Postgres acceptance.
- Runbook three-line grocery script produces a paid money order.
- Full grocery E2E retest passes payment, then fails on Lisa's missing add_to_order message (money-to-family event dependency).
- Actual HTTP checks pass: auth 401s, call summaries, member-confirmed verbal cancellation recorded by money, voice reset and empty call list afterwards.
- Full E2E baseline: 1/5 passed (Mia birthday); grocery then retested after voice fixes. Full suite is NOT green.

## BUGS FROM INTEGRATION / owners

- Agent 2 (Arpit), D15: money's MOCK=1 still selects RecordingEvents and a fake family client, suppressing order-paid and fraud events. E2E 1 now stops at add_to_order; E2E 3 stops at fraud_card.
- Agent 2, D9/D14: current MoneyService.draft echoes the request; authoritative grocery catalog/delivery quoting and fulfilment are absent on this base. Voice presentation is tested with returned quote fixtures; real pricing/delivery integration remains pending.
- Agent 3 (Andy), D10: E2E 2 never sees an awaiting_senior proposal after two acceptances.
- Agent 4 (Claire), D3: web and E2E still send string[] verification scripts. Addendum requires {speaker, text}[]; include member cancel followed by member yes to exercise the existing two-step verifier flow.
- Coordinator + Agents 1/4: E2E 5 expects payment after the privacy trigger and treats later peach-pie news as public. Existing voice behavior/tests mark the trigger and all later speech private and block family-facing mutations. The order correctly remains approved under that behavior. Agree on privacy scope/test script before changing the safety rule.
- Next dev generated an untracked apps/web/AGENTS.md. It was not edited or committed by Agent 1.

## Remaining setup / human acceptance

- Team secret is not available yet; root .env CC_INTERNAL_SECRET remains blank. Obtain privately, at least 24 characters, same for all services.
- Docker Desktop installation requires the Mac user's administrator authentication; Jayden is installing it. Postgres compose startup and pnpm seed remain UNVERIFIED.
- Twilio, Deepgram, Meta credentials; consenting test numbers stored by family; DIAL_ALLOWLIST; HTTPS tunnel and Twilio webhook.
- Adding keys alone does not activate voice: launch only voice with MOCK=0 and root .env loaded; keep other services mocked.
- Ten real calls, five real verification runs, end-to-end latency, and SIP/tablet decision by H44 remain UNVERIFIED. No real call, payment, or delivery occurred.

## Latency

No real phone measurements. The latency command reports STT-final-to-first-media and excludes endpointing and phone-network delay. Measure audible end-to-end latency separately; do not infer the 1.5s target from mock tests.

## Demo MVP finish (integration-v3, done by Agent 3's Claude with the team's OK for a single-machine finish)
- `VOICE_REASONER=muse|mock`; MOCK=1 no longer forces MockReasoner. Muse uses `reasoning_effort: "minimal"`, `MUSE_TIMEOUT_MS`, and falls back to MockReasoner per step (`FallbackReasoner`).
- New `src/demo.ts`: `POST /demo/converse`, `/demo/converse/:id/end`, `EventRecorder` (turn events from real dependency calls).
- Engine: order-changed check compares key-sorted JSON (jsonb key order caused false 409s); offer echoes ("call Danny", slot label) count as confirmation; recoverable tool errors go back to Muse; dependency 4xx → 422 with the reason.
- Tests: `test/converse.test.ts`. Details in docs/FINISH-PROGRESS.md.
