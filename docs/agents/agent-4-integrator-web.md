# Agent 4 · Integrator + Web (Claire)
**Branch `claire` · root config, `packages/contracts/`, `apps/web/`, `e2e/`, `scripts/` · port 3000 · status `status/AGENT-4.md`**
Spec: `agent-4-integrator-web.md` + `CONTRACTS.md` + `docs/CONTRACTS-ADDENDUM.md` (the addendum wins).

## How to use this file
1. **Human (Claire), FIRST:** save your role file before pulling. The merge untracks the root `CLAUDE.md` you committed:
   ```cmd
   cd /d %USERPROFILE%\code\Care-Circle
   copy CLAUDE.md CLAUDE.local.md
   ```
   Then do `docs/agents/COMMON-SETUP.md`. In step 4, **add** its import lines to your existing `CLAUDE.local.md`.
2. Open Claude Code and paste the kickoff prompt. Claude does Parts 1–3.

## What the integration changed in your area
- Added a root `.gitignore` (`CLAUDE.md`, `CLAUDE.local.md`, `.env`, `node_modules`, build output) and a root `.env.example` (the README referenced it, but it didn't exist). **You own both now.**
- Removed the duplicate root `AGENT-4.md` and `CONTRACTS copy.md`.
- Registered the new **delivery** service (`@care-circle/delivery`, :4004) in `pnpm dev`, `dev:services`, `pnpm health`, and `pnpm seed`, and added `pnpm dd:check`.
- The live E2E found two things in your area:
  - E2E 4 blamed a "false hold" that was actually E2E 3's scam order. The Mia-gift test is picking the wrong order.
  - E2E 1's confirmation line doesn't match voice's check. Voice fixes it (Agent 1, task 1), and you add a guard test.

## Part 1 · Tasks, in order (Claude)
1. **Contracts package:** apply the addendum, including:
   - D5 action payloads
   - D6 `everAskedForMoney: boolean`
   - D7 `birthday` on dependents
   - D9 `Order.fulfilment?: { provider, storeName, quoteId?, unmatchedItems[], delivery? }`
   - D11 fields and endpoint bodies
   - D14 `Quote`, `QuoteLine`, `DeliveryOrder`, `DeliveryStatus`

   Update the zod schemas and drift guard. **Push immediately**, because three agents import these.
2. **E2E:**
   - Move to the addendum endpoints (D1 reset on all 5 services, D2 `fire-due`, D3 voice demo calls and simulate-verification, D5 payloads).
   - **Fix E2E 4:** select the order created by *this* scenario (match on `type: "gift"`, a `recipientMemberId` of `mem_lisa`, and `createdAt` after the scenario start), never a leftover scam order.
   - **Extend E2E 1:** paid grocery → delivery order `dry_run_complete` (`GET delivery /orders?seniorId=sen_rose`) → `POST delivery /demo/advance/:id {to:"delivered"}` → family has the "arrived" message.
   - The E2E suite must **refuse to run** unless delivery `/health` reports `provider: "mock"`.
   - Add the delivery mock to the self-test fake stack.
3. **Demo reset chain:** web's "Reset all data" calls `/demo/reset` on family → money → delivery → voice.
4. **Web · delivery UI:**
   - Dashboard and family phones show delivery status from money's `order.fulfilment.delivery` (or delivery `/orders`): store name, ETA, and tracking link.
   - A **"DRY RUN"** badge unless delivery `/health` says `liveCheckout: true`.
   - The read-back/order card lists `unmatchedItems`.
5. **Web · demo panel DoorDash controls:**
   - "Quote groceries (DoorDash)" shows the quote table.
   - **"Place real order"** is rendered **only** when delivery `/health` reports `provider: "doordash_thirdparty"` **and** `liveCheckout: true`, and only for deliveries in `awaiting_live_checkout`.
   - It shows the store and amount, requires typing `PLACE REAL ORDER`, and calls `POST delivery /orders/:id/checkout { confirmedBy: "<name typed>" }` **through the server-side proxy**, which adds `X-CC-Secret`. Add `delivery` to the proxy allowlist with the checkout route. The browser never sees the secret.
6. **`/call/:id`:** join LiveKit using family `GET /schedule/calls/:id/join?memberId=`.
7. **Integration duty:** after each checkpoint merge, run `pnpm e2e` against the live services and file failures under `## BUGS FROM INTEGRATION` in the owners' status files.
8. **Final README (H62):** architecture (5 services + web), how to run, a mock-vs-real table, and a plain statement that **DoorDash is an unofficial third-party integration** (dry run by default; one human-confirmed live order at most).

After each task: `pnpm typecheck`, `pnpm build:web`, and `pnpm e2e:selftest`; update `status/AGENT-4.md`; commit; `git push origin claire`.

## Part 2 · Verify (Claude; `pnpm dev` running)
```bash
pnpm health          # 5 green: voice, money, family, delivery, web
pnpm e2e:selftest    # fake stack
pnpm e2e             # live services, delivery on mock
```
Open `http://localhost:3000/demo` in a browser and check:
- the "Grocery happy path" button leads to a paid order, a DRY RUN delivery, and Lisa's messages
- "Place real order" is **not visible** (because the provider is mock)

## Part 3 · Your "service is up" checklist
- [ ] `pnpm health` shows 5 green; `pnpm typecheck` and `pnpm build:web` pass
- [ ] E2E 1–5 pass against the live services (delivery on mock); the self-test passes 10 runs in a row
- [ ] The DRY RUN badge shows; the live button is hidden unless the real provider + live flag are on, and needs the typed phrase
- [ ] Reset clears all 5 services

## DoorDash (third-party MCP): your part
The web is where a **human** approves the one real order. Your job is to make an accidental press impossible (hidden unless armed, typed confirmation, server-side secret) and to show clearly when anything is a dry run.

## Kickoff prompt (paste into Claude Code)
> You are Agent 4 (integrator + web). Read CLAUDE.local.md, docs/agents/agent-4-integrator-web.md, docs/CONTRACTS-ADDENDUM.md, and docs/INTEGRATION-REPORT.md. Put Part 1 in status/AGENT-4.md as a checklist and do it in order. Task 1 (contracts) goes first; push it the moment it's green. After each task, run typecheck, build:web, and e2e:selftest, update the status file, commit, and push to origin claire. `pnpm dev` is running in another window. Don't edit services/** code; report bugs in the owners' status files. Stop only for decisions the addendum doesn't cover.
