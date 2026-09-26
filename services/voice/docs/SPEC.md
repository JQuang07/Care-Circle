# Agent 1 implementation specification

## Ownership and integration

Only `services/voice/**`, `status/AGENT-1.md`, and Postgres schema `voice` are owned here. Branch: `jayden`. No shared contracts, root configuration, or teammate folders are edited. Local TypeScript mirrors in `src/types.ts` stand in for the not-yet-created `packages/contracts`; Agent 4 can replace the imports once that package exists.

| Component                       | Responsibility                                                                                      |
| ------------------------------- | --------------------------------------------------------------------------------------------------- |
| `app.ts`                        | Fastify routes, authentication, validation, demo scripts, provider callbacks, webhook worker        |
| `engine.ts`                     | Per-call transcript and pending-confirmation state, tool dispatch, privacy, money/scheduling policy |
| `reasoner.ts`                   | Muse tool planner and separate deterministic demo planner                                           |
| `dependencies.ts`               | Authenticated money/family HTTP clients and in-memory fixtures                                      |
| `media.ts`, `speech.ts`         | Twilio stream binding, μ-law frames, Deepgram STT/TTS, serialized turns, barge-in                   |
| `telephony.ts`, `room-intro.ts` | Known-number verification conference, reminder calls, LiveKit SIP + one-shot introduction           |
| `store.ts`                      | Voice-only Postgres storage, call-ended outbox, durable dispatch claims                             |

## Request boundaries

Health is unauthenticated and returns the exact contract health shape. All internal routes require constant-time comparison of `X-CC-Secret`; malformed bodies return a structured 400. Twilio routes accept only provider-signed requests, not internal-secret substitutes. WebSocket starts additionally require a one-use server-generated stream token bound to the exact CallSid. LiveKit events require the provider JWT and body hash verified by its SDK. Demo and transcript-inspection routes are disabled in live mode.

| Endpoint                                     | Behavior                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------- |
| `GET /health`                                | `{ok:true,service:"voice",mock:boolean}`                                  |
| `POST /twilio/voice`                         | Enrolled caller → a bound bidirectional Media Stream                      |
| `WS /twilio/stream`                          | 8 kHz mono μ-law in/out; playback mark gates confirmation                 |
| `POST /calls/verification`                   | Requires an active senior call and open hold; stored verifier number only |
| `POST /calls/outbound`                       | Reminder via Twilio; scheduled family call via LiveKit SIP                |
| `POST /demo/simulate-inbound`                | `{seniorId,script}` → `{callId}`; same action engine with text transport  |
| `POST /webhooks/scheduled-call-due`          | Validate/persist ScheduledCall, acknowledge, then dispatch asynchronously |
| `GET /demo/calls/:callId`                    | Authenticated mock-only local diagnostic; not a shared API dependency     |
| `POST /twilio/status`                        | Terminal provider state finalizes transcript and queues call-ended        |
| `POST /twilio/stream-status`                 | Acknowledges stream lifecycle; stream end is not call end                 |
| `POST /twilio/verification/:callId/decision` | Bound verifier leg; decision then affirmative confirmation                |
| `POST /livekit/events`                       | Signed participant-left event ends scheduled phone session                |

## Conversation and action state

A session has a transcript, privacy spans, zero or one pending action, provider IDs, and optional verification context. A pending order contains the precise approved order snapshot. Only a later unambiguous affirmative from the senior, after the complete summary has played, can consume it. The service re-fetches the order, verifies unchanged details and approved/risk state, persists consumed authorization, then calls money confirmation once. Held/cancelled/changed orders cannot bypass that gate. Negation, changed instructions, or a private-mode request clear pending authorization. An interrupted prompt is not marked delivered; an early “yes” causes a repeat instead of payment.

The Muse tools never include a standalone payment-confirmation function. Tools cannot override the server-bound senior ID. Pharmacy requests fail closed because no existing-prescription lookup exists. Scheduling only confirms slots returned as awaiting senior agreement. Children are not circle members by contract; an explicitly underage member is also rejected in code.

## Privacy

The privacy-triggering senior turn and the remainder of that call are private. Tool-triggered privacy starts at the current senior turn. All family-facing mutations are blocked afterward to prevent notification leaks. Read-only budget/family lookups remain possible. `call.ended` contains the full transcript and inclusive timestamp spans per the shared contract. Only Agent 3’s internal receiver gets this event; Agent 3 owns removal before extraction and external family output. This service does not claim to test Agent 3’s filter in isolation.

Private conversation is still processed by speech/reasoning providers and stored in the voice database. “Private” means excluded from family messages/hooks, not offline or provider-free processing. Use only consenting demo participants and synthetic sensitive details.

## Telephone behavior

STT fallback: Deepgram Nova, raw 8 kHz μ-law. TTS: Deepgram Aura, raw μ-law with no WAV header. Audio is sent as Twilio JSON media frames with a playback mark. Speech-start clears queued playback and aborts TTS; turns are serialized. A 45-second idle nudge and 15-minute stream limit bound sessions. Synthesized audio streams as HTTP chunks arrive, but **Muse text currently completes before synthesis starts**. First-sentence model/TTS pipelining remains a potential latency optimization after real measurements.

Verification is a human-to-human conference assisted by the AI before and after it. The verifier presses star to exit into a Gather prompt, chooses cancel/release, and answers yes. No unreliable speaker attribution is attempted on mixed conference audio. High risk OR hard stop rejects verbal release; cancel is allowed for any open hold. On no answer or abandonment, the purchase remains paused. The service never speaks or fetches the actual family code word.

Scheduled family calls use the room returned by the family service, not an arbitrary substituted room. SIP waits until answered, then a short-lived audio publisher delivers the intro without subscribing to anyone’s audio and disconnects. A signed LiveKit participant-left event supplies actual phone departure. The service must not emit a completion event just because the introduction finished.

## Delivery, durability, and failures

Live mode requires Postgres and creates only `voice.sessions`, `voice.outbox`, `voice.dispatches`. Mock mode defaults to memory. Call-ended delivery retries every five seconds; receivers must deduplicate by callId. Ended sessions are recovered into the outbox at startup without resending already-completed persisted jobs. Outbound scheduled events persist before acknowledgement and have at most five worker attempts; dispatch claims prevent dialing again after an uncertain external result. Such uncertainty is an operator task, not automatic success. Calls without a scheduledCallId have no cross-request idempotency key.

Money mutations are never retried automatically because the contract lacks idempotency keys. A timeout can mean the mutation succeeded but the response was lost; inspect Agent 2’s actual state before repeating. Model calls have a bounded timeout and five tool-planning rounds. No transcript, phone number, or credential is printed in routine logs. Operate one process; distributed session locking and production retention controls are outside this hackathon implementation.

## Contract questions for the human / integrator

These are requests, not changes to `CONTRACTS.md`:

1. **Reminder event shape:** `scheduled_call.due` is typed as ScheduledCall without a purpose discriminator. Until clarified, that webhook means T-0 family call. Agent 3 should use the already-defined `/calls/outbound` with `purpose:"reminder"` for T-30.
2. **Draft cancellation:** no endpoint exists to mark an approved/unpaid draft cancelled. Voice clears local consent on “never mind” and leaves money state unpaid. Decide whether a cancellation endpoint is needed.
3. **Minor birthday gift:** Mia is a dependent, not a `mem_` recipient. Agent 2 must define how the legitimate Mia gift fixture maps to its hard rules. Voice will not invent `mem_mia` or call her.
4. **Prescription catalog:** no current-prescription endpoint exists. Refills are blocked until one is approved or Agent 2 provides an authoritative existing-prescription identifier.
5. **Webhook idempotency:** confirm Agent 3 deduplicates call-ended by callId and removes all inclusive privateSpans before processing.
6. **Order pricing/catalog:** the live model asks for missing information; it must not invent a merchant quote. Real price discovery is not represented by a shared endpoint. Agent 2 must establish authoritative pricing before real payment use.

No work on these missing shared features is disguised as complete. Existing contract-compatible paths remain usable.
