# Agent 1 — Jayden / voice

Updated: 2026-09-26. Branch: `jayden`, synced with integration-v2 on main.

## Integration follow-up

- D9 voice complete: exact returned totals, store/provider wording, one missing-item question, re-quote on skip, dry-run wording, quote-change invalidation. 44/44 tests and typecheck pass.
- Agent 2: current MoneyService.draft echoes the submitted request; delivery quote/pricing/fulfilment is not implemented on this base. Voice presentation is tested with injected authoritative quotes; real pricing/delivery integration remains pending Agent 2.

- D4 complete: body phase takes precedence, header fallback, phase-specific deduplication. 41/41 tests and typecheck pass.

- D1/D3 complete: authenticated reset, filtered call summaries, and role-bound verification simulation. 40/40 tests and typecheck pass.
- Agent 4: web/e2e still send string[] to simulate-verification; D3 requires {speaker, text}[]. Add a member confirmation after cancel to exercise the real two-step verifier flow.

- D16 implemented: natural affirmative sentences confirm only after completed playback; negation, hesitation, and extra details fail closed. Mock add-item requests draft again and require fresh confirmation.
- Validation: 38/38 voice tests and voice typecheck pass.
- Local setup: workspace dependencies installed using pinned pnpm 10.34.5; private role file and .env created. Team secret pending from team. Docker installation requires local administrator authentication.
- Real-service E2E and real phone tests remain pending.

## Done

- Standalone TypeScript/Fastify service in `services/voice` on port 4001. Only Agent 1 folders changed; shared contracts and root scaffolding untouched.
- All voice contract endpoints, scheduled-call-due receiver, exact internal auth/error shapes, mock-only transcript diagnostic.
- No-key standalone demos and optional HTTP integration with Agents 2/3; SDK-backed Muse tool planner for live mode.
- Spoken purchase confirmation enforced outside the model, including complete-playback marks, interruption invalidation, changed-order checks, and consumed authorization before mutation.
- Private spans cover the trigger and later conversation; family-facing mutations blocked while private. Full internal transcript + spans delivered per contract.
- Known-number verification conference with a separately bound verifier leg. Star → verbal decision → affirmative confirmation. High-risk/hard-stop release cannot happen verbally.
- Twilio Media Streams + Deepgram fallback streaming STT and TTS, signature checks, per-stream token binding, barge-in, silence nudge, bounded call duration.
- Reminder calls, LiveKit SIP dial-out and one-shot intro publisher that never subscribes and leaves after speaking; signed participant-left callback finalizes scheduled phone call.
- Voice-only Postgres session/outbox/dispatch storage, event deduplication and uncertain-dispatch protection. Postgres adapter compiled; real database testing still pending.
- 35 automated tests passed locally (mock dependencies and controlled transport): grocery/hold/schedule/privacy, signatures, stream binding/playback interruption, duplicate dispatches, concurrent resolution, validation and HTTP auth.
- TypeScript build passed. Formatting checked. Setup guide, .env example, implementation spec, manual acceptance checklist included.

## In progress

- Ready for Jayden’s review, credential configuration, live acceptance, and teammate integration. No real external call/payment was made during implementation.

## Blocked on (who/what)

- Jayden: Meta, Deepgram, Twilio credentials; consenting test numbers; HTTPS/WSS tunnel; team Postgres and shared secret.
- Agent 2: money endpoints, authoritative prices/merchant data and hold behavior; resolving minor-recipient gift semantics.
- Agent 3: circle seed with real adult test numbers, scheduling acceptance/upcoming endpoints, call-ended deduplication and privacy filter, LiveKit room/SIP provisioning and webhook configuration.
- Agent 4: pnpm workspace registration and shared contract package. Do not replace the voice package with a stub. Run cross-service E2E after team-approved merges.
- End-to-end phone latency, five live verification runs, and actual SIP room bridge remain UNVERIFIED. Muse transcription streaming is unsupported until its protocol and latency are verified; use the explicit Deepgram fallback.

## CONTRACT CHANGE REQUESTS

No changes made to CONTRACTS.md. Details in services/voice/docs/SPEC.md.

1. Define reminder webhook discriminator; until then Agent 3 uses existing `/calls/outbound` with purpose `reminder` at T-30.
2. Add an optional unpaid-draft cancellation endpoint if desired. Current “never mind” cancels local authorization, not the remote draft record.
3. Clarify Mia’s birthday gift recipient: she is a dependent, not a `mem_` circle member. Never create a fake member or call her.
4. Provide an authoritative existing-prescription lookup before pharmacy refills can be enabled.
5. Confirm call-ended deduplication by callId and inclusive private-span filtering at Agent 3 before extraction.
6. Define authoritative pricing/catalog lookup before real payments; the voice model cannot invent quotes.

## BUGS FROM INTEGRATION

None reported yet. Cross-service tests have not been run against teammates’ implementations.

## Latency log

No real phone turns measured. Do not infer the ≤1.5s target from mock tests.

`npm run latency` reports server STT-final-to-first-media timing after at least ten live turns; actual speech-end-to-audible-response latency additionally includes STT endpointing and phone transport. Measure both during the live spike. Muse text is currently completed before TTS begins; first-sentence pipelining is a remaining optimization if measured latency requires it.
