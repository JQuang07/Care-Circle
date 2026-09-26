# Agent 2 · Money & Fraud (Arpit)
**Branch `arpit` · folder `services/money/` · port 4002 · status `status/AGENT-2.md`**
Spec: `agent-2-money-fraud.md` + `CONTRACTS.md` + `docs/CONTRACTS-ADDENDUM.md` (the addendum wins).

## How to use this file
1. **Human (Arpit):** read "Working in the repo" below, then do `docs/agents/COMMON-SETUP.md`.
2. Open Claude Code **inside the cloned repo** and paste the kickoff prompt. Claude does Parts 1–3.

## Working in the repo (important)
Your last two pushes were **web uploads**. The second one put your whole service inside a new folder, `care-circle-agent2/`, so the workspace couldn't see it. The integration moved it to the right place (`services/money/`); your code is intact, with 114 tests passing.

From now on:
- **Work inside the cloned repo:** `%USERPROFILE%\code\Care-Circle`, on branch `arpit`, editing `services/money/` directly.
- **Stop working in the separate `care-circle-agent2` folder.** If it has anything newer than what's on `main`, copy just those files into `services\money\` of the repo, then commit.
- **Push with git only:**
  ```cmd
  git add -A
  git commit -m "..."
  git push origin arpit
  ```
- **Never** use "Add files via upload" on GitHub again.

## Where money stands (from the integration run)
- All endpoints exist and the four fraud layers plus the eval work. Orders go draft → approved/held → confirm → paid (mock payments).
- **Bug found in the live E2E:** with `MOCK=1`, money swaps family for a built-in fake and **never sends events** (`order.paid`, `fraud.hold_created`), so no family messages or fraud cards appear. Fix is task 1.
- The integration added a `seed` script (`src/scripts/seed-cli.ts`) so the root `pnpm seed` works.

## Part 0 · Human prerequisites
- A Stripe **test** key (`STRIPE_SECRET_KEY=sk_test_...`, `PAYMENTS_PROVIDER=stripe`), optional in mock mode
- Visa Intelligent Commerce sandbox access, if you can get it (optional)
- Muse key (`META_API_KEY`, `MUSE_MODEL=muse-spark-1.3`) for Layer 2; the offline heuristic works without it
- The team secret (≥24 characters)

## Part 1 · Tasks, in order (Claude)
1. **Mock semantics (D15).** `MOCK=1` fakes **external providers** only (Stripe/Visa, Muse). Neighbor services are faked only when `MOCK_DEPENDENCIES=1`. In `src/index.ts`, choose the family client and events by `env.MOCK_DEPENDENCIES === '1' || !env.FAMILY_URL`, not by `mock`. The team default is `MOCK=1`, `MOCK_DEPENDENCIES=0`, so events reach family.
2. **`GET /orders/:id` (D9)** → `Order` (404 in the contract error shape if missing). The delivery service uses it; it currently falls back to the list.
3. **Receive delivery events (D14):** `POST /webhooks/delivery-status` (requires `X-CC-Secret`) with body `{ deliveryId, orderId, status, etaText?, trackingUrl?, failureReason? }`. Store it on the order as `order.fulfilment.delivery = { deliveryId, status, etaText, trackingUrl, failureReason }`. Idempotent.
4. **Price groceries from delivery (D9).** When drafting `type: "groceries"` and `DELIVERY_URL` is set:
   - `POST {DELIVERY_URL}/quote` with `X-CC-Secret` and `{ kind: "grocery", items: [{ name, qty }], storeHint? }`.
   - Use each `matched` line's `priceCents` for the items, and `quote.totalCents` (which includes the fees estimate) as `amountCents`.
   - Set `order.fulfilment = { provider, storeName, quoteId, unmatchedItems: [requested names of not_found/ambiguous lines] }`.
   - If delivery is unreachable, fall back to your FreshMart price list and don't set `quoteId`.
   - The fraud engine runs **after** pricing, on the real amount.
5. **Fulfil after payment (D14).** When `/orders/:id/confirm` makes an order `paid` and it has `fulfilment.quoteId`, call `POST {DELIVERY_URL}/orders` with `X-CC-Secret` and `{ orderId, seniorId, quoteId, approvedAmountCents: order.amountCents }`. Fire-and-forget with a log on failure; never un-pay because delivery failed.
6. **Fraud test: gift cards through DoorDash.** *"$200 Apple gift card"* from a DoorDash grocery store → `GIFT_CARD_NONMEMBER` hard stop. Add the test; the rail detection runs on item names, so it should already pass.
7. **D6/D7/D8:**
   - `everAskedForMoney` is a `boolean`
   - a gift routed via the parent (`recipientMemberId: mem_lisa`, reason naming Mia) is **not** a non-member gift card
   - `cancel` needs no passkey; `release` of a high-risk hold does
8. **`POST /demo/reset` (D1):** restore seed state, `X-CC-Secret` required.
9. Replace any duplicated contract types with imports from `@care-circle/contracts` when Agent 4 publishes them; keep internal types local.

After each task: `pnpm --filter @care-circle/money test`, update `services/money/TASKS.md` and `status/AGENT-2.md`, commit, `git push origin arpit`.

## Part 2 · Verify against the real services (Claude; `pnpm dev` running)
```bash
pnpm health
S="$CC_INTERNAL_SECRET"
# draft groceries → should be priced by delivery (fulfilment.quoteId set, amount includes fees)
curl -s -X POST localhost:4002/orders/draft -H "X-CC-Secret: $S" -H "content-type: application/json" \
  -d '{"seniorId":"sen_rose","type":"groceries","merchantId":"mer_freshmart","items":[{"name":"whole milk","qty":1},{"name":"wheat bread","qty":1},{"name":"bananas","qty":2}],"amountCents":0,"context":{"transcriptExcerpt":"my usual groceries please"}}'
# confirm it (use the id from above) → paid, then delivery should show dry_run_complete
curl -s -X POST localhost:4002/orders/<id>/confirm -H "X-CC-Secret: $S" -H "content-type: application/json" -d '{}'
curl -s "localhost:4004/orders?seniorId=sen_rose" -H "X-CC-Secret: $S"
# family should have received order.paid (Lisa gets add_to_order)
curl -s "localhost:4003/messages?memberId=mem_lisa"
```
Then `pnpm e2e`: E2E 1 (with Agent 1's fix), 3, and 4 must pass.

## Part 3 · Your "service is up" checklist
- [ ] `pnpm --filter @care-circle/money test` green; `pnpm --filter @care-circle/money eval` shows 12/12 scams caught and ≤2 false high holds
- [ ] Grocery draft priced by delivery → confirm → `paid` → delivery order `dry_run_complete` → a delivered event lands on the order
- [ ] A scam draft → `held` + hard stop → Danny gets a `fraud_card` in family `/messages`
- [ ] Mia's gift via Lisa → `low`, paid

## DoorDash (third-party MCP): your part
**Money is the gate.** Delivery re-checks that your order is `paid` and never lets the cart exceed `approvedAmountCents` + 10%. So always pass the exact amount you charged, and never mark an order paid without the full fraud check. You don't talk to DoorDash directly.

## Kickoff prompt (paste into Claude Code)
> You are Agent 2 (money). Read CLAUDE.local.md, docs/agents/agent-2-money.md, docs/CONTRACTS-ADDENDUM.md, and docs/INTEGRATION-REPORT.md. Put Parts 1–3 in services/money/TASKS.md and do them in order; task 1 (mock semantics) first, because it unblocks family messages and fraud cards. After each task, run the tests, update the status file, commit, and push to origin arpit with git (never upload through the website). `pnpm dev` is running in another window. Stop only for API keys or a contract question the addendum doesn't answer. Never write outside services/money/ and status/AGENT-2.md.
