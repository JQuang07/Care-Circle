# Agent 3 · Family & Scheduling + Delivery/DoorDash (Andy)
**Branch `andy` · folders `services/family/` (port 4003) and `services/delivery/` (port 4004) · status `status/AGENT-3.md`**
Spec: `agent-3-family-schedule.md` + `CONTRACTS.md` + `docs/CONTRACTS-ADDENDUM.md` (the addendum wins) + `services/delivery/README.md`.

## How to use this file
1. **Human (Andy):** Part 0, then `docs/agents/COMMON-SETUP.md`.
2. Open Claude Code and paste the kickoff prompt. Claude does Parts 1–3.
3. **Human + Claude:** Part 4 (connect the DoorDash MCP) whenever you're ready. It's independent of Parts 1–3.

## Where you stand (from the integration run)
- Family: 78 tests pass; it boots in the workspace.
- **Delivery service is built and merged** (`services/delivery`):
  - a mock provider, plus the third-party DoorDash MCP provider
  - money-paid gate, price and cap gates, a human-confirmed live checkout, events, and `pnpm dd:check`
  - 15 tests pass
  - it connected to the real DoorDash MCP server over HTTP and found all 10 tools
  - a real cross-service run worked end to end: quote → money paid → delivery dry run → delivered event

  You own it now.
- **E2E 2 fails** because of the "who must accept" rule. Fix is task 1 (D10).
- **Family returns 404 for `/webhooks/delivery-status`,** which delivery already posts to. That's task 5.

## Part 0 · Human prerequisites
- **Admin CMD, once:** `net stop postgresql-x64-16` and `net stop postgresql-x64-17`. Native Postgres was blocking Docker's port 5432.
- Muse key (`META_API_KEY`, `MUSE_MODEL=muse-spark-1.3`) for hooks and slot reasons; templates work without it
- LiveKit: the local dev server (`docker run -d --name cc-livekit -p 7880:7880 -p 7881:7881 -p 7882:7882/udp livekit/livekit-server --dev --bind 0.0.0.0` with `devkey`/`secret`), or a LiveKit Cloud project
- For Part 4: a **dedicated DoorDash account** with a **low-limit card**, and a delivery address you control (a teammate's) standing in for "Rose's house"

## Part 1 · Family tasks, in order (Claude)
1. **D10:** if a request names members, all of them must accept the same slot. If it names none, the proposal becomes `awaiting_senior` as soon as **≥2 invitees accept the same slot**. Non-responders stay invited and still get the join link. Add tests.
2. **D5 action vocabulary:** slot buttons use `action: "accept_slot"`, payload `{ proposalId, slotId, slot }` (the full `Slot`), plus `decline_all`. Fraud cards: `cancel_hold` / `release_hold` / `calling_her`, payload `{ orderId, holdId }`. `add_to_order`: `add_item` (v1: answers "coming soon") / `record_voice_note`. Nudges: `call_now` / `dismiss`.
3. **D2 + D4:** add `POST /demo/fire-due { scheduledCallId }` next to `/demo/time-travel`, and send `phase: "reminder" | "due"` in the `scheduled-call-due` body (keep the header).
4. **D6/D7/D11/D12:**
   - `everAskedForMoney` is a `boolean`
   - seed Mia with `birthday: "10-14"`
   - `GET /schedule/calls/:id/join?memberId=`, `GET /schedule/proposals/:id`, `seniorHints` on `/circle`, `GET /orders/:orderId/voice-notes`
   - `/moments?week=` takes an ISO week (default: the current week, in Rose's time zone)
5. **Receive delivery events:** `POST /webhooks/delivery-status` (secret required, idempotent by `deliveryId` + `status`):
   - `dry_run_complete` → message Lisa: *"Rose's groceries from {store} are ready (demo: no real delivery)."*
   - `placed`, `picked_up` → a short ETA note to the circle
   - `delivered` → *"Rose's groceries arrived"* to the circle, plus `POST voice /calls/outbound { seniorId, purpose: "delivery_arrived", orderId }`. Voice may return 400 until v1.1; ignore that.
   - `failed` → message the verifiers with `failureReason`
6. **Config:** remove the `env.PORT` fallback (use `FAMILY_PORT ?? 4003` only), and replace `src/contracts-local.ts` with `@care-circle/contracts` once Agent 4 publishes the addendum types.
7. **Postgres:** with Docker's database up (`DATABASE_URL=postgres://cc:cc@localhost:5432/care_circle`), run the skipped Postgres test.

After each task: `pnpm --filter @care-circle/family test`, update `services/family/TASKS.md` and `status/AGENT-3.md`, commit, `git push origin andy`.

## Part 2 · Delivery upkeep (Claude)
- Keep `pnpm --filter @care-circle/delivery test` green (15 tests, including every safety gate).
- Switch `services/delivery/src/types.ts` to `@care-circle/contracts` once Agent 4 adds `Quote`, `QuoteLine`, and `DeliveryOrder`.
- **Never** weaken a gate: money-paid, price tolerance, hard cap, live flag + secret + `confirmedBy`, the cart-not-empty check.

## Part 3 · Verify against the real services (Claude; `pnpm dev` running)
```bash
pnpm health    # 5 green
pnpm e2e       # E2E 2 must pass; E2E 5 must pass
S="$CC_INTERNAL_SECRET"
curl -s -X POST localhost:4004/quote -H "X-CC-Secret: $S" -H "content-type: application/json" \
  -d '{"kind":"grocery","items":[{"name":"whole milk","qty":1},{"name":"bananas","qty":2}]}'
```
After Arpit's tasks 4–5 are merged, a paid grocery order produces a delivery `dry_run_complete`, and Lisa's inbox shows the delivery message:
```bash
curl -s "localhost:4003/messages?memberId=mem_lisa"
```

## Part 4 · Connect the third-party DoorDash MCP (human + Claude, Andy's laptop)
Full steps: `services/delivery/README.md`, "Connecting the third-party DoorDash MCP server." In short:
1. Install `davidgibbons/mcp-doordash` in `%USERPROFILE%\code\dd-mcp` (**outside the repo**), then `npm run build` and `npx patchright install chromium`.
2. `npm run login`, and sign in to the **dedicated** DoorDash account in the window that opens.
3. Run it: `set MCP_HTTP_PORT=3100`, `set MCP_HTTP_TOKEN=<long random>`, `npm start`. Leave the window open.
4. In the repo `.env`: `DELIVERY_PROVIDER=doordash_thirdparty`, `DOORDASH_MCP_URL=http://127.0.0.1:3100/mcp`, `DOORDASH_MCP_TOKEN=<same>`, `DOORDASH_DROPOFF_ADDRESS=<address>`, `DOORDASH_GROCERY_STORE=<store near it>`, and **`DOORDASH_LIVE_CHECKOUT=0`**.
5. `pnpm dd:check` → then `pnpm dd:check -- --quote "whole milk,bananas,wheat bread" --store "<store>"`. Both must pass.
6. Restart `pnpm dev`. Do a **dry run**: a grocery order through voice or money reaches `dry_run_complete` with a **real** DoorDash cart total. Then empty the cart in DoorDash.
7. Fill in `services/delivery/docs/DOORDASH-SPIKE.md` (checkboxes, any captcha notes, go/no-go).
8. **Live order: demo day only, once,** on the demo laptop. Set `DOORDASH_LIVE_CHECKOUT=1` and keep `DOORDASH_MAX_ORDER_CENTS` low. A human presses "Place real order" in web `/demo` and types the confirmation. Set it back to `0` right after. Record a mock take as backup.

**If step 5 fails** (login, captcha, no grocery store): try another store name. If it's still failing, fall back to `DELIVERY_PROVIDER=mock` and say "DoorDash: no-go" in team chat. The whole product still works on mock.

## Part 5 (later, v1.1 Packet B) · Shared meal
Reuse delivery: `/quote` with `kind: "meal"` and a restaurant `storeHint` per person; money pays each meal; delivery creates the orders. Timing logic stays in family (brief §6). This replaces DoorDash Drive.

## Your "service is up" checklist
- [ ] Family and delivery tests green; `pnpm health` shows family ✓ and delivery ✓
- [ ] E2E 2 and E2E 5 pass against the live services
- [ ] Delivery events produce family messages (dry run, delivered, failed)
- [ ] `pnpm dd:check` passes with the real DoorDash account, **or** the no-go is written in `DOORDASH-SPIKE.md`

## Kickoff prompt (paste into Claude Code)
> You are Agent 3 (family + delivery). Read CLAUDE.local.md, docs/agents/agent-3-family.md, docs/CONTRACTS-ADDENDUM.md, docs/INTEGRATION-REPORT.md, and services/delivery/README.md. Put Parts 1–3 in services/family/TASKS.md and do them in order, running tests, updating the status file, committing, and pushing to origin andy after each task. `pnpm dev` is running in another window. For Part 4 (DoorDash), walk me through it step by step: I run the commands that need logins; you run `pnpm dd:check` and interpret the results. Never place a real DoorDash order, never set DOORDASH_LIVE_CHECKOUT=1, and never commit tokens, cookies, or .env. You may write only in services/family/, services/delivery/, and status/AGENT-3.md.
