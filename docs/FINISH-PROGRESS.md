# Demo MVP finish: progress
Branch `integration-v3`, one machine. Updated after each phase.

| Phase | Status | Commit |
|---|---|---|
| A · Muse drives voice (`/demo/converse`) | ✅ done: 4/4 scenarios pass on Muse (text) | see `git log` "Phase A" |
| B · Audio in (`/demo/audio-turn`, `pnpm demo:run`) | ✅ done: 4/4 pass from WAV clips, transcribed by Muse | see `git log` "Phase B" |
| C · `/stage` demo screen | ✅ done: 4/4 pass in a headless browser (clip → Muse STT → Muse → cards + phones) | see `git log` "Phase C" |
| D · Typecheck, tests, e2e, README | ⏳ | |

## Phase A notes
- `VOICE_REASONER=muse|mock` (default `muse` when `META_API_KEY` is set; `MOCK=1` no longer forces the mock). Muse runs with `reasoning_effort: "minimal"` (≈3 s a step; without it a turn took 10 s+ and often returned no text) and `MUSE_TIMEOUT_MS` (default 12000). Any Muse error or timeout falls back to `MockReasoner` for that step; `reasonedBy` in the response says which ran.
- `POST /demo/converse` and `POST /demo/converse/:sessionId/end` (MOCK=1 only, secret required). Events come from the real calls voice makes to money, family and delivery.
- Verification leg: a turn with `speaker: "mem_danny"` on Rose's session reaches the bound verifier call only. "Cancel" works in one turn (D8, the safe direction). A release still needs a confirmation and is refused for high risk.
- Fixed:
  - **409 "order details changed":** Postgres `jsonb` reorders keys. The check now compares key-sorted JSON, which is still an exact match.
  - **"Yes, please call Danny"** was not accepted, so Muse drafted a duplicate hold. It now echoes the offer.
  - **"Yes, that sounds lovely"** was not accepted either.
  - **Family planner timeout:** its Muse call took 12 s, but voice gives up after 10 s. It now allows 6 s at minimal effort, with the heuristic as fallback.
  - **Dependency 4xx** errors now reach Muse as a refusal, not as a 500.
  - **Muse prompt:** knows the merchants and circle IDs, so the Mia gift is low risk.
- Carried in from before (commit 731926f): an offer that has been read back survives a question ("Did the family pick a time?") and a privacy span.

## Phase B notes
- Speech-to-text: **Muse Voice Transcribe works with this key** (`POST https://api.meta.ai/v1/asr/transcribe`, model `muse-voice-transcribe-1.0`, mode `PUSH_TO_TALK`, about 3 s a clip). It accepts WAV only (16/24 kHz mono PCM). Non-WAV audio goes to Deepgram prerecorded (`DEEPGRAM_API_KEY`), and after that to the sidecar `.txt` (sent as the `sidecar` field, or found under `demo-audio/` by file hash). Transcripts are cached per SHA-256. The turn never fails on STT.
- `demo-audio/` was not in the repo, so I generated placeholder clips with Windows speech synth (Zira as Rose, David as Danny) from the scripted lines. Replace them with real recordings under the same names.
- `pnpm demo:run <scenario|all> [--text]`.

## Phase C notes
- `/stage` has Rose's line on the left and Lisa's and Danny's phones on the right.
  - Rose's line: a scenario picker, a ▶ button per clip, the transcript and reply bubbles, a "type as Rose" box, event cards, New call, and Reset demo.
  - The phones are the `/family` Phone component, refreshing every 1.5 s. Their slot buttons can be tapped live.
- The browser sends clips to `/api/stage/audio-turn`, a server route that adds the secret and the clip's `.txt` as fallback. Non-WAV clips are converted to 16 kHz WAV in the browser. The clip is transcribed while it plays.
- Muse gets one automatic retry (429, 5xx or timeout) before the keyword fallback. Without it, one `/stage` run fell back mid-scenario.
- Verified with a headless Chromium script (scratchpad, not committed): all four scenarios reach their expected cards.

## Open issues
- **Real DoorDash cart is not verified.** The DoorDash MCP server on :3100 answers `401 unauthorized` to the token in `.env`: it was started with a different `MCP_HTTP_TOKEN`. Claude was not allowed to restart it. Fix: restart it with the `.env` token (or copy its token into `.env`), then restart `pnpm dev`. `.env` now has `DELIVERY_PROVIDER=doordash_thirdparty`, but the running delivery service still uses mock until the restart. Until then, groceries do a dry run at "FreshMart (demo)".
