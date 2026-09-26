# Agent 1 · Voice (Jayden): next phase
**Branch `jayden` · folder `services/voice/` · port 4001 · status `status/AGENT-1.md`**

**Read first:**
- `CONTRACTS.md` and `docs/CONTRACTS-ADDENDUM.md` (the addendum wins where they differ)
- your original brief `agent-1-voice.md`
- `docs/INTEGRATION-REPORT.md`

## Where you are
- The service is merged into the pnpm workspace, typechecks, and passes 35/35 tests.
- It boots under `pnpm dev`.
- **Unverified:** real phone latency, live Twilio, SIP bridge. No real calls have been made yet.
- The real E2E fails only because money has no endpoints yet, not because of voice.

## Tasks, in order
1. **Sync:** `git merge origin/main` → `pnpm install` at the repo root. The root `.env` needs the team `CC_INTERNAL_SECRET` (≥24 chars).
2. **Demo endpoints (addendum D1, D3):**
   - `POST /demo/reset`
   - `GET /demo/calls?seniorId=`
   - `POST /demo/simulate-verification` with speaker-tagged script lines
3. **D4:** on `/webhooks/scheduled-call-due`, read `body.phase`, falling back to the `X-CC-Phase` header.
4. **D9, prices:** never speak a price the model made up. Read back exactly the `Order` money returns, including `fulfilment.storeName`. If `fulfilment.unmatchedItems` is non-empty, ask **one** question: *"They didn't have oat milk. Want something else, or skip it?"*
5. **D7:** a gift for Mia is sent with `recipientMemberId: "mem_lisa"` and a `statedReason` naming Mia.
6. **Live spike** (needs your keys): Twilio number + tunnel (`PUBLIC_BASE_URL`) + Deepgram + Muse `muse-spark-1.3`. Make 10 real turns and log the latency with `pnpm --filter @care-circle/voice latency`. Target: ≤1.5s.
7. **Real integration:** as soon as money's stubs are on `main`, run with `MOCK_DEPENDENCIES=0`. Verify grocery → paid, and scam → hold → verification call → verbal cancel, 5 times in a row.
8. **By H44, decide SIP dial-out (Plan A) vs. tablet (Plan B)** and record the decision in your status file.

## DoorDash (third-party MCP): your part is small
- You never talk to DoorDash. Money and delivery handle it.
- **Optional:** a `get_order_status()` tool → money `GET /orders/:id`, so Rose can ask *"Where are my groceries?"* and hear *"Out for delivery, about 20 minutes."*
- If the order is a **dry run**, say *"Your order is ready"* and never promise a real delivery.

## Definition of done
- [ ] D1/D3/D4 endpoints, with tests
- [ ] Read-back never contains a model-invented price (test)
- [ ] Latency log with 10 real turns
- [ ] Scam flow passes against real money and family, 5 runs in a row

## Kickoff prompt (paste into Claude Code)
> You are Agent 1. Read CLAUDE.local.md, docs/agents/agent-1-voice.md, docs/CONTRACTS-ADDENDUM.md, and docs/INTEGRATION-REPORT.md. Add these tasks to a checklist in services/voice/TASKS.md, then work through them in order. Commit and push to origin jayden after each one. Only stop to ask me for credentials, for anything needing a real phone, or when a contract question isn't answered by the addendum. Never write outside services/voice/ and status/AGENT-1.md.
