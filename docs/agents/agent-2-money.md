# Agent 2 · Money & Fraud (Arpit): next phase. YOU ARE THE CRITICAL PATH
**Branch `arpit` · folder `services/money/` · port 4002 · status `status/AGENT-2.md`**

**Read first:**
- `CONTRACTS.md` and `docs/CONTRACTS-ADDENDUM.md`
- your original brief `agent-2-money-fraud.md`
- `docs/INTEGRATION-REPORT.md`

## Where you are
- Layer 1 hard rules + `combine` are done, with 74 passing tests.
- **Money has no HTTP endpoints yet**, so 4 of the 5 real E2E scenarios fail on their first call to money. Everyone else is waiting on this.

## Rule #1: commit with git, not the GitHub website
Web uploads created duplicate root files that had to be removed. From your cloned repo folder:
```cmd
git checkout arpit
git merge origin/main
pnpm install
```
Then `git add -A` → `git commit -m "..."` → `git push origin arpit`.

## Tasks, in order
1. **Stubs (target: within 2 hours).** Every money endpoint in CONTRACTS §4, plus addendum D9's `GET /orders/:id`, in `MOCK=1`, returning schema-valid canned data:
   - `/fraud/assess`, `/orders/draft`, `/orders/:id/confirm`, `/orders?seniorId=`, `/orders/:id`
   - `/holds/:id/resolve`, `/holds?seniorId=`
   - `/credentials/:seniorId`, `/eval/results`, `/demo/reset`

   Push, and say "money stubs pushed" in team chat.
2. **Types:** delete `src/fraud/types.ts` duplicates of contract types and import from `@care-circle/contracts`. Keep your internal types.
3. **Seed:**
   - the credential
   - 60 days of order history
   - merchants, including `mer_doordash` (category `grocery`) as a known payee
   - a FreshMart **price list** as the fallback pricer (D9)
4. **Real orders:** draft → fraud assess → `approved`/`held` → confirm → pay (Stripe test first; Visa sandbox if you get access) → `order.paid` event to family.
5. **Pricing (D9):** for `type: "groceries"`, call delivery `POST /quote`. Use its line prices and total, and set `Order.fulfilment` (storeName, unmatchedItems). If delivery is unreachable, fall back to your price list.
6. **Fulfilment (D14):** after an order is `paid`, call delivery `POST /orders { orderId, quoteId, approvedAmountCents }`. Accept `delivery.status` on `POST /webhooks/delivery-status` and mirror it onto the order.
7. **Fraud engine, remaining layers:**
   - Layer 3 baseline
   - Layer 4: family `/contact-rhythm` is **live now**; `everAskedForMoney` is now a `boolean` (D6)
   - Layer 2 Muse classifier (`muse-spark-1.3`, with timeout and fallback)
8. **Holds:** cooling-off, `fraud.hold_created` / `fraud.hold_resolved` events. **D8:** cancel with no passkey is OK. **D7:** a gift routed via the parent is not a non-member gift card.
9. **Eval set:** 24 scenarios. Target: 12/12 scams caught, ≤2 false high holds.

## DoorDash (third-party MCP): your part
- **Money is the gate.** Delivery never spends money on an order you didn't approve and mark paid.
- **Gift cards bought *through* DoorDash** (DoorDash sells them) must still trip Layer 1. Your rail detection runs on item names, so add a test: *"$200 Apple gift card from DoorDash"* → `GIFT_CARD_NONMEMBER`.
- The cart-total check is delivery's job, but **always pass the exact `approvedAmountCents`** you charged.

## Definition of done
- [ ] Stubs on `main` (E2E stops failing on 404s)
- [ ] Grocery → quote-priced → paid → delivery order created (mock)
- [ ] Scam → high hold → cancel, with all Layer-1 tests still passing
- [ ] Eval 12/12 scams, ≤2 false holds

## Kickoff prompt
> You are Agent 2. Read CLAUDE.local.md, docs/agents/agent-2-money.md, docs/CONTRACTS-ADDENDUM.md, and docs/INTEGRATION-REPORT.md. Task 1 (stubs) comes before anything else: build it, test it, commit, and push to origin arpit, then continue through the list in order, pushing after each task. Keep services/money/TASKS.md updated. Only stop for credentials or a contract question the addendum doesn't answer. Never write outside services/money/ and status/AGENT-2.md.
