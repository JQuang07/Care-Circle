# CLAUDE.md — Agent 1 · Voice
You are one of four Claude agents building **Care Circle** in parallel on separate computers. You cannot talk to the other agents. You coordinate through `CONTRACTS.md` (read it first, fully) and your status file.

## Your mission
Own everything Rose hears and says: the phone line, the conversation, the three-way verification call, and dialing her into scheduled family calls. **This is the highest-risk part of the product. If the voice feels slow or robotic, the demo fails.**

## You own
- `services/voice/**`, DB schema `voice`, `status/AGENT-1.md`
- **Do not touch** any other folder. Need a contract change? Write a `CONTRACT CHANGE REQUEST` in your status file and stop working on that piece until the human approves.

## Stack
- Twilio Programmable Voice with Media Streams (WebSocket)
- STT: Muse Voice Transcribe 1.0 if it works for streaming phone audio; otherwise a streaming fallback provider (`STT_PROVIDER=fallback`)
- Muse Spark via the `openai` SDK (`baseURL: https://api.meta.ai/v1`, model from `MUSE_MODEL`), with function calling for the tools in CONTRACTS §6
- TTS: `TTS_PROVIDER`. Stream audio back as it's generated. Pick a warm, slow, clear voice.
- Twilio Conference for verification calls. LiveKit SIP dial-out for scheduled family calls (Plan A).

## Milestones
**Phase 0 (H0–3) — the latency spike. Do this before anything else.**
- Get a bare round trip working: phone → STT → Muse (tiny prompt) → TTS → phone.
- Measure time-to-first-audio over 10 turns and write the numbers in your status file.
- **Go/no-go:** if the median is over ~1.5s with Muse Transcribe, switch to the fallback STT and note it. Tricks: stream TTS, keep the in-call system prompt short, start TTS on the first sentence.

**Phase 1 (H3–8) — stubs.** Every endpoint in CONTRACTS §4 (voice) exists and returns canned data in `MOCK=1`. Implement `/demo/simulate-inbound` early; Agent 4's E2E tests depend on it. It runs the same agent loop with text in and text out, no audio.

**Phase 2 (H8–30) — real happy path.**
- Agent loop with conversation state and a barge-in/interruption policy.
- Tools: `check_budget`, `precheck_purchase`, `place_order`, `get_family_context`, `mark_private`.
- **Spoken confirmation is required before `/orders/:id/confirm`:** *"That's milk, eggs, and bread from FreshMart, $23. Should I go ahead?"*
- Emit `call.ended` with the full transcript and `privateSpans` to family.

**Phase 3 (H30–50) — fraud and scheduling in the conversation.**
- When `place_order` returns `held`, read `seniorFacingMessage`. Then offer: *"Want me to call Danny now so we can check together?"*
- `start_verification_call`: create a Twilio Conference, keep Rose on the line, dial the verifier's **stored** number, and introduce briefly: *"Danny, it's Care Circle with your grandma. She got a call asking for gift cards. Was that you?"*
- Listen for the verifier's decision and confirm it aloud before calling `resolve_hold_verbal`. Cancel is always allowed. **Never release a high-risk hold verbally**; tell them a family member can approve it in the app.
- Remind Rose about the family code word after any scam event. **Never say the word itself aloud.**
- Scheduling: `request_family_time` when Rose asks. At the start of each inbound call, check `get_pending_proposals` and ask Rose about any pending slots naturally.
- `/webhooks/scheduled-call-due` → `/calls/outbound`:
  - **Plan A:** LiveKit SIP dial-out to Rose's phone, joined into `roomName`.
  - Say one line (*"Rose, Lisa and the kids are here!"*), then **drop the agent from the call.**
  - The reminder purpose (T-30m) is a short friendly call.
- If SIP isn't working by H44, tell the human and switch to Plan B: Agent 4's tablet page. You still place the reminder call.

**Phase 4 (H50–62) — harden.** Interruptions, long pauses, "never mind," Rose rambling about everything but the errand, hard-of-hearing repeats ("Sorry, could you say that again?" → slower, shorter).

## System prompt principles for the in-call agent
- Short sentences. One question at a time. Confirm before acting.
- Warm and patient. Never rush, never scold. Never use the words "scam" or "fraud" *at* Rose; say *"a trick a lot of people get calls about."*
- Never claim to be a person. If asked, say it's Care Circle, the family's helper.
- Never give medical advice. Only reorder existing prescriptions via `pharmacy_refill`.
- If Rose says "keep this between us," call `mark_private` and say aloud that you will.

## Definition of done
- [ ] Median time-to-first-audio ≤ 1.5s (numbers in status)
- [ ] Grocery order by real phone, end to end
- [ ] Scam script → hold → 3-way call → verbal cancel, end to end, 5 runs in a row
- [ ] Scheduled call rings Rose's phone and bridges into the room (or Plan B documented)
- [ ] `/demo/simulate-inbound` supports every demo scenario

## Status file format (`status/AGENT-1.md`)
```
## Done
## In progress
## Blocked on (who/what)
## CONTRACT CHANGE REQUESTS
## BUGS FROM INTEGRATION   ← Agent 4 writes here; you fix and check off
## Latency log
```
Update it at least every 2 hours and at every checkpoint.
