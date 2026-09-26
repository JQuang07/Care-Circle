# Agent 1 acceptance and handoff

## Automated checks

Run `npm test`, `npm run typecheck`, `npm run build`, and `npm run format:check` inside `services/voice`. Tests cover action authorization, changed orders, private spans, member eligibility, high-risk/hard-stop releases, text demos, webhook idempotency, authentication, Twilio signatures, stream identity binding, real HTTP-client request shape, and playback interruption.

Tests use in-memory dependencies and controlled provider transports. They do not prove real telephony, a reachable Postgres, Visa behavior, or another agent’s implementation.

## Manual integration sequence

1. Agent 4 includes the package in the workspace and verifies all service health endpoints. Agent 3 seeds the circle and Agent 2 seeds credentials/history.
2. Run text simulations with `MOCK=1,MOCK_DEPENDENCIES=0`. Inspect actual money orders/holds and family messages rather than only the voice response. Call IDs are returned even though transcript diagnostics are mock-only.
3. Groceries: a draft before yes; exactly one paid order after yes. “Never mind” must not pay. Change the draft after the summary and verify the old yes is rejected.
4. Private detail: inspect family messages, extracted hooks, and briefings; the sensitive phrase must appear nowhere. Only the raw internal transcript can contain it.
5. Scheduling: request → adult family accepts → next senior call offers pending slot → senior says yes → a ScheduledCall exists. T-0 event calls outbound once, including when the event is replayed.
6. Confirm the Mia birthday recipient convention with Agent 2 before marking that cross-service scenario passed.

## Real phone sequence

- Configure Twilio, Meta, Deepgram, HTTPS/WSS, Postgres, test-number allowlist, and the stored adult numbers.
- Call the Twilio number from an enrolled test senior phone. Verify greeting, STT, Muse, streamed TTS, and clean shutdown.
- Ask for a quoted grocery basket. Interrupt the summary; payment must not happen. Hear the complete repeated summary, then say yes. Verify the money service result.
- Speak the impersonation script. Accept the known-number callback. Talk to the adult verifier. They press star, say cancel, then yes. Check hold cancelled. Repeat five consecutive times.
- Try release on the high-risk case: it must stay held and direct the family to app approval. Disconnect or let the verifier ring out: the hold must remain.
- Confirm that an unrecognized phone and a forged provider signature cannot enter the flow.
- Schedule a family call with a real LiveKit room/trunk. Rose’s phone rings, joins the correct room, hears one introduction, and no AI participant remains. Hang up the phone and check the signed participant-left callback creates call-ended.
- Force a duplicate due event: no second phone call. If a provider call times out ambiguously, inspect the provider console and `voice.dispatches`; never blindly clear a claim and redial.
- If SIP fails, document the tablet fallback and still test the real Twilio reminder call.

## Latency spike

Capture at least ten natural voice turns. `npm run latency` summarizes persisted **STT-final received → first audio frame sent** samples. It is a server processing diagnostic, not total speaker-to-ear latency. For the actual ≤1.5-second target, record/measure from the end of Rose’s speech to first audible assistant audio, including transcription endpointing and telephone transport. Record median, p95, provider/model, region, network conditions, and sample count in `status/AGENT-1.md`.

No measured values are supplied before a real call. Muse streaming transcription is not implemented; the current explicit fallback is Deepgram. If measured latency is too high, optimize model response length, pipeline first-sentence TTS, and remeasure rather than assuming the target is met.

## Branch handoff

All implementation belongs to `jayden`. Once reviewed, use the Git UI or:

```sh
git status
git add services/voice status/AGENT-1.md
git commit -m "Build Agent 1 voice service and integration specs"
git push -u origin jayden
```

Do not commit `.env`, dependency directories, or compiled output. The service `.gitignore` excludes them. Do not merge into main here; your team’s integrator coordinates the combined build.
