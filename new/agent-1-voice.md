# Agent 1 · Voice (Jayden)
**Branch `jayden` · folder `services/voice/` · port 4001 · status `status/AGENT-1.md`**
Spec: `agent-1-voice.md` (original brief) + `CONTRACTS.md` + `docs/CONTRACTS-ADDENDUM.md`. Where they differ, the addendum wins.

## How to use this file
1. **Human (Jayden):** do Part 0, then `docs/agents/COMMON-SETUP.md`.
2. Open Claude Code in the repo and paste the kickoff prompt at the bottom. Claude does Parts 1–3.
3. **Human:** Part 4 (the real phone), when Claude asks.

## Where voice stands (from the integration run)
- 35/35 tests pass; the service boots in the workspace and passes health.
- **Bug found in the live E2E:** a scripted grocery call creates the order but never confirms it. The confirmation check only accepts a bare "yes." Rose's line *"Yes, that's everything. Please go ahead and order it."* is ignored, so orders sit at `approved` and are never paid. Fix is task 1.
- **Unverified:** real phone latency, Twilio, the SIP bridge.

## Part 0 · Human prerequisites
- **Keys** (put in `.env` only when you reach Part 4): Twilio (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_NUMBER`), Deepgram (`DEEPGRAM_API_KEY`), Muse (`META_API_KEY` from dev.meta.ai, `MUSE_MODEL=muse-spark-1.3`)
- An ngrok (or similar) account for the tunnel
- The team secret (≥24 characters)

## Part 1 · Tasks, in order (Claude)
1. **Confirmation fix (D16).** Treat an utterance as a purchase confirmation when it starts with an affirmative (`yes`, `yeah`, `go ahead`, `please do`, `that's right`, `okay`, `sure`), contains **no** negation (`no`, `not`, `wait`, `don't`, `hold on`, `actually`), and adds **no** new items or changes. *"Yes, that's everything. Please go ahead and order it."* must confirm. *"Yes, but add eggs"* must **not** confirm; it re-quotes instead. Keep the rest of the safety (complete playback, invalidation on change). Add tests for both.
2. **Demo endpoints (D1, D3):**
   - `POST /demo/reset`
   - `GET /demo/calls?seniorId=` → `{ callId, kind, purpose?, scheduledCallId?, startedAt }[]`
   - `POST /demo/simulate-verification { seniorId, holdId, memberId, script: { speaker: "senior" | "member", text }[] }` → `{ callId }`, resolving through `resolve_hold_verbal`
   - All require `X-CC-Secret`.
3. **D4:** on `/webhooks/scheduled-call-due`, read `body.phase` (`reminder` | `due`), falling back to the `X-CC-Phase` header.
4. **D9, prices:** never speak a model-made price. Read back exactly the `Order` money returns. If `order.fulfilment` exists:
   - say the store: *"from Kroger, delivered by DoorDash"*
   - ask **one** question about `fulfilment.unmatchedItems`: *"They didn't have oat milk. Something else, or skip it?"*
   - If fulfilment is a dry run, never promise a real delivery.
5. **D7:** a gift for Mia goes out with `recipientMemberId: "mem_lisa"` and a `context.statedReason` naming Mia.
6. **Optional tool `get_order_status`** → money `GET /orders?seniorId=sen_rose` (newest order), so Rose hears *"Out for delivery, about 20 minutes"* or *"Your order is ready."*

After each task: `pnpm --filter @care-circle/voice test`, update `services/voice/TASKS.md` and `status/AGENT-1.md`, commit, `git push origin jayden`.

## Part 2 · Verify against the real services (Claude; `pnpm dev` running)
```bash
pnpm health    # 5 green
```
Then run the grocery script through voice:
```bash
curl -s -X POST localhost:4001/demo/simulate-inbound -H "X-CC-Secret: $CC_INTERNAL_SECRET" \
  -H "content-type: application/json" \
  -d '{"seniorId":"sen_rose","script":["Hi, it'"'"'s Rose. I'"'"'d like my groceries from FreshMart.","A gallon of whole milk, wheat bread and bananas.","Yes, that'"'"'s everything. Please go ahead and order it."]}'
curl -s "localhost:4002/orders?seniorId=sen_rose" -H "X-CC-Secret: $CC_INTERNAL_SECRET"
```
**Pass:** the newest order is `paid`.

Then `pnpm e2e`: **E2E 1 must pass.** E2E 3 passes once money and family events are wired. Report other failures in your status file under the owner's name.

## Part 3 · Your "service is up" checklist
- [ ] `pnpm --filter @care-circle/voice test` green (including the new confirmation tests)
- [ ] `pnpm health` shows voice ✓
- [ ] Simulated grocery call → money order `paid`
- [ ] `/demo/calls`, `/demo/simulate-verification`, and `/demo/reset` work with the secret, and return 401 without it

## Part 4 · Real phone (human + Claude)
1. Start the tunnel: `ngrok http 4001`. Put the https URL in `PUBLIC_BASE_URL` and your keys in `.env`.
2. Set `MOCK=0` **for voice only**, by adding the keys; ask Claude how voice reads its live config.
3. Point the Twilio number's voice webhook at `<PUBLIC_BASE_URL>/twilio/voice`.
4. Make **10 real calls**, then run `pnpm --filter @care-circle/voice latency`. Target: ≤1.5s to first audio. Paste the numbers into `status/AGENT-1.md`.
5. Run the scam flow for real 5 times (the verification call rings Danny's stored test number).
6. **By H44:** SIP dial-out (Plan A) or tablet (Plan B)? Write the decision in your status file.

## DoorDash (third-party MCP): your part
You never talk to DoorDash; money and delivery do. Your part is only speech: the store name, unmatched items, the dry-run wording, and optionally order status. The one live order on demo day is placed by a human in the web `/demo` panel, **never** by voice.

## Kickoff prompt (paste into Claude Code)
> You are Agent 1 (voice). Read CLAUDE.local.md, docs/agents/agent-1-voice.md, docs/CONTRACTS-ADDENDUM.md, and docs/INTEGRATION-REPORT.md. Put Parts 1–3 in services/voice/TASKS.md and do them in order. After each task, run the tests, update the status file, commit, and push to origin jayden. `pnpm dev` is running in another window. Stop only for: API keys, anything needing a real phone (Part 4), or a contract question the addendum doesn't answer. Never write outside services/voice/ and status/AGENT-1.md.
