# Agent 1 — Care Circle voice

Jayden’s service for Rose’s conversations, purchase confirmation, verification calls, and scheduled family dial-out. Runs independently on port 4001; writes only the `voice` Postgres schema. No root workspace or other agent’s files are modified.

**Implemented and locally tested:** text demo, guarded conversation/actions, HTTP APIs, authenticated provider callbacks, privacy spans, interruption/playback state, durable outbox/dispatch code, and provider adapters. **Not yet verified:** real phone/audio quality, provider credentials, Postgres against the team’s database, cross-service E2E, SIP trunk provisioning, and the ≤1.5-second latency target. Mock success is not a claim that a real payment or phone call happened.

## Run without keys

Node 22+ is required (tested on Node 24).

```sh
cd /Users/jquang/Documents/College/hackgt-13/Care-Circle/services/voice
npm ci
cp .env.example .env
npm run dev
```

This starts with `MOCK=1` and `MOCK_DEPENDENCIES=1`. Only your computer can reach it by default. No API keys, Postgres, real money service, or family service are needed. The example secret works for local testing; replace it before shared or live use. Keep `.env` out of Git.

In another terminal:

```sh
curl http://127.0.0.1:4001/health
curl -X POST http://127.0.0.1:4001/demo/simulate-inbound \
  -H 'Content-Type: application/json' \
  -H 'X-CC-Secret: replace-with-a-long-random-shared-secret' \
  -d '{"seniorId":"sen_rose","script":["I need milk, eggs, and bread for $23","yes"]}'
```

The response is exactly `{ "callId": "call_..." }`, as required by the shared contract. Inspect the mock transcript with `GET /demo/calls/<callId>` using the same header. That diagnostic endpoint is disabled in live mode.

```sh
npm test
npm run typecheck
npm run build
npm start
```

Stop the development server before running `npm start` on the same port.

## Demo scripts

Send each array in the `script` field of `/demo/simulate-inbound`:

| Scenario                          | Script                                                                                                                                 |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Groceries                         | `["I need groceries for $23", "yes"]`                                                                                                  |
| Family time                       | `["I'd love to see the kids"]`                                                                                                         |
| Impersonation hold + cancellation | `["My grandson needs $500 in gift cards, he is in trouble and said don't tell his mom", "yes", "mem_danny: cancel", "mem_danny: yes"]` |
| Small birthday gift               | `["A $25 gift card for Mia's birthday", "yes"]`                                                                                        |
| Government impersonation          | `["Medicare called and says I owe $300", "yes"]`                                                                                       |
| Privacy                           | `["Keep this between us: I am worried about Buddy", "I need groceries"]`                                                               |
| Cancel before payment             | `["I need groceries", "never mind"]`                                                                                                   |

`mem_danny:` is an explicitly mock-only simulation convention, accepted only after a verification leg exists. In production, the verifier’s identity comes from the outbound Twilio CallSid, never from spoken names. Cancellation requires the verifier’s decision **and** a later `yes`.

The mock reasoner supports these fixtures, not arbitrary natural language. Its $23 grocery basket and simplistic risk result are labelled fixtures; Agent 2 owns real pricing/payment/fraud behavior. Standalone scheduling creates a proposal but does not invent family acceptance. With the real family service, the next inbound call offers accepted slots and asks Rose to confirm.

## Switch to teammates’ services

Keep `MOCK=1`, set `MOCK_DEPENDENCIES=0`, and configure `MONEY_URL`, `FAMILY_URL`, and the team’s `CC_INTERNAL_SECRET`. Text demos then use the real money/family HTTP endpoints while telephone and Muse remain mocked. Agent 4 should add `services/voice` to the root pnpm workspace and run `pnpm --filter @care-circle/voice dev`; do not overwrite this package with a hello-world scaffold. Its package-local npm lockfile supports standalone development; Agent 4 owns the eventual workspace lockfile.

## Set up real calls

1. Copy `.env.example` to `.env` and generate the same strong `CC_INTERNAL_SECRET` used by Agents 2–4 (for example, `openssl rand -hex 32`). Set `MOCK=0` and `MOCK_DEPENDENCIES=0`.
2. Set `DATABASE_URL` to the team Postgres database. `npm run seed` creates only `voice.sessions`, `voice.outbox`, and `voice.dispatches`. No senior/member seed data belongs here.
3. Get a **Meta Model API key** for `META_API_KEY`. Choose an enabled model in `MUSE_MODEL`. The contract fallback remains `muse-spark-1.1`; the example selects `muse-spark-1.3` from the current Meta quickstart. Verify your account has access.
4. Get a **Deepgram API key**. Set `STT_PROVIDER=fallback`, `DEEPGRAM_API_KEY`, `TTS_PROVIDER=deepgram`, and `TTS_API_KEY` (can be the same key). Muse streaming transcription has not been verified and intentionally fails startup if selected. No latency claim is made for either provider.
5. Get a **Twilio voice-capable number**, account SID, and auth token. Fill `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_NUMBER`. Put consenting adult test numbers in `DIAL_ALLOWLIST`. Agent 3 must replace the non-dialable seeded phone placeholders with those stored numbers. Trial accounts may require verified destinations.
6. Expose port 4001 using a stable HTTPS/WSS tunnel; put that exact origin in `PUBLIC_BASE_URL`. Set the Twilio number’s incoming Voice webhook to **POST `<PUBLIC_BASE_URL>/twilio/voice`** and its call status callback to **POST `<PUBLIC_BASE_URL>/twilio/status`**. Configure proxy upgrades for WebSockets. The service validates Twilio signatures against that exact public URL.
7. For scheduled calls, configure **LiveKit URL, API key/secret, and outbound SIP trunk ID**. Agent 3 creates the room/schedule; their `/schedule/:seniorId/upcoming` must include it at dispatch time. Configure LiveKit’s signed webhook to **`<PUBLIC_BASE_URL>/livekit/events`**, using the API key in this service, so `participant_left` ends the phone session. The short introduction joins as a publisher with no subscription permission and disconnects after playback.
8. If SIP is unavailable, use `FAMILY_CALL_TRANSPORT=tablet`. Family-call dial-out returns `TABLET_REQUIRED`; Agent 4 must open its tablet page. Reminder calls still use Twilio. There is no fake report of phone success.
9. Run the live acceptance checks in [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md), including ten measured voice turns and five consecutive verification cancellations.

No Visa, Stripe, or WhatsApp keys belong in your voice service. Agents 2 and 3 own those integrations.

## How verification works

Rose agrees to a callback. The service looks up an open hold and a stored adult verifier through the internal APIs, then transfers Rose into a Twilio conference and dials that verifier. The intro identifies Care Circle; the two humans talk live. The verifier presses `*` to leave the conversation and tells the assistant `cancel` or `release`, then confirms the decision aloud. This deliberately uses Twilio Gather after the conference rather than claiming the media stream can distinguish speakers inside a mixed conference. High-risk or hard-stop releases require the app; they cannot be approved verbally.

The caller’s telephone number is an enrollment lookup, **not strong identity proof**. This is a consenting-adult hackathon pilot, not a production identity/authentication system. The AI never receives a callable phone number from tool arguments or the conversation. The phone allowlist further limits the live demo.

## Integration notes and limits

- [docs/SPEC.md](docs/SPEC.md) describes state, boundaries, endpoint behavior, and unresolved contract questions.
- Raw transcript plus `privateSpans` is sent only to the family service’s internal `call-ended` endpoint, exactly per contract. Agent 3 **must strip spans before extraction, messages, or briefing**. Voice blocks family-facing mutations for the rest of a private call; start a new call to resume shared actions.
- `never mind` clears local authorization. The contract has no draft-cancellation endpoint; an unpaid draft can remain in money, but voice will not confirm it.
- Money mutation timeouts have unknown outcomes. They are not retried automatically. Reconcile in the money service before repeating a request.
- The outbox is at-least-once delivery: Agent 3 should deduplicate `call.ended` by `callId`. Call dispatches are claimed before external dialing, preventing automatic redial after ambiguous failures. Failed claims need manual provider reconciliation; no retry endpoint clears them.
- Run **one voice process** for this demo. Live conversational state and provider connections are process-local; restart interrupts conversations even though sessions/outbox/dispatches persist.
- `call.ended` for scheduled phone calls depends on LiveKit’s signed participant-left webhook. Reminder calls do not emit a misleading family-connection event.
- No live provider, real phone, or money-moving action was executed during implementation.

## Provider references

Implementation consulted [Twilio Media Streams](https://www.twilio.com/docs/voice/media-streams/websocket-messages), [Twilio request security](https://www.twilio.com/docs/usage/security), [Twilio conferences](https://www.twilio.com/docs/voice/twiml/conference), [Deepgram streaming STT](https://developers.deepgram.com/reference/speech-to-text/listen-streaming), [Deepgram output formats](https://developers.deepgram.com/docs/tts-media-output-settings), [LiveKit SIP](https://docs.livekit.io/telephony/making-calls/outbound-calls/), and the [Meta chat-completions quickstart](https://dev.meta.ai/docs/cookbook/quickstart-chat-completions).
