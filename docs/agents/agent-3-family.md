# Agent 3 · Family & Scheduling + Delivery (Andy): next phase
**Branch `andy` · folders `services/family/` (port 4003) and NEW `services/delivery/` (port 4004) · status `status/AGENT-3.md`**

**Read first:**
- `CONTRACTS.md` and `docs/CONTRACTS-ADDENDUM.md`, especially D10 and D14
- your original brief `agent-3-family-schedule.md`
- `docs/INTEGRATION-REPORT.md`

## Where you are
- Family Phases 0–4 are done, with 78 passing tests, merged into the workspace.
- Real E2E 2 fails only because of the "who must accept" rule, which the addendum now settles as D10.
- You're the agent with spare capacity, so **you own the new delivery service**, the only thing that talks to DoorDash.

## Part 1: Family fixes (about 2 hours, do these first)
1. **Sync:** `git merge origin/main` → `pnpm install` at the root. Use `pnpm --filter @care-circle/family test|dev`.
2. **D10:**
   - named members → all must accept
   - none named → `awaiting_senior` as soon as ≥2 invitees accept the same slot
   - non-responders stay invited and get the join link
   - Test it.
3. **D5:** slot buttons use `action: "accept_slot"`, payload `{ proposalId, slotId, slot }`. Align the fraud-card, add-to-order, and nudge actions with the D5 table.
4. **D2:** add `POST /demo/fire-due { scheduledCallId }` alongside `/demo/time-travel`. **D4:** send `phase` in the webhook body and keep the header.
5. **D6/D7/D11/D12:**
   - `everAskedForMoney` becomes `boolean`
   - Mia gets `birthday: "10-14"` in the seed
   - endpoints: `/schedule/calls/:id/join`, `/schedule/proposals/:id`, `seniorHints`, `/orders/:orderId/voice-notes`
   - `week` format per D12
6. Replace `src/contracts-local.ts` with `@care-circle/contracts`. It's updated by Agent 4 after the addendum lands; until then keep local types for the new fields only.
7. **Config:** drop the `env.PORT` fallback. Use `FAMILY_PORT ?? 4003` only.
8. **Postgres on Windows:** in an **admin** CMD run `net stop postgresql-x64-16` (and `postgresql-x64-17`), then `docker compose up -d --wait` from the repo root, with `DATABASE_URL=postgres://cc:cc@localhost:5432/care_circle`. Run the skipped Postgres test.

## Part 2: DoorDash third-party MCP spike (1–2 hours, before building the service)
**Goal:** learn whether a third-party DoorDash MCP server works on your laptop, and record its exact tool names, *before* writing any integration code.

**Safety setup:**
- Create a **dedicated DoorDash account**, and pay with a **low-limit virtual or prepaid card**.
- The account's saved delivery address is where a real Dasher would go. Use a teammate's address and call it "Rose's house" in the demo.
- These servers automate DoorDash's website without DoorDash's permission, which DoorDash's terms may not allow.
- **Never check out during the spike.**

**Step 1: a folder OUTSIDE the repo** (so cookies and credentials can never be committed):
```cmd
mkdir %USERPROFILE%\code\dd-mcp
cd /d %USERPROFILE%\code\dd-mcp
```

**Step 2: try candidate A** (davidgibbons/mcp-doordash). It has an HTTP mode behind a token, binds to loopback by default, and queues calls so they run one at a time.
```cmd
git clone https://github.com/davidgibbons/mcp-doordash.git
cd mcp-doordash
npm install
npx playwright install chromium
```
Follow its README to log in once. Then start it on **port 3100** (never 3000, which is our web app) with a long random token. In a new CMD:
```cmd
cd /d %USERPROFILE%\code\dd-mcp\mcp-doordash
set MCP_HTTP_PORT=3100
set MCP_HTTP_TOKEN=paste-a-long-random-string-here
npm start
```

**Step 2b: if A fails, try candidate B** (ashah360/doordash-mcp). It explicitly supports groceries and needs no browser. It runs over stdio, and its `.env` holds the account email and password.
```cmd
cd /d %USERPROFILE%\code\dd-mcp
git clone https://github.com/ashah360/doordash-mcp.git
cd doordash-mcp
npm install
npm run build
```

**Step 3: poke it with MCP Inspector** (no code yet):
```cmd
npx @modelcontextprotocol/inspector
```
Connect to candidate A's HTTP URL (with the token), or to candidate B's command (`node dist\index.js`). In the Inspector:
1. **List tools.**
2. **Search** a grocery store near the account address.
3. **Search** 3 items (milk, bananas, bread).
4. **Add them to the cart,** then **view the cart total.**
5. **Search** a restaurant and view its menu (for the shared meal).
6. **Stop.** Don't check out.

**Step 4: write it down.** Create `services/delivery/docs/DOORDASH-SPIKE.md` (no secrets) with:
- which candidate worked
- the exact tool names and arguments for search, add-to-cart, view cart, checkout, and order status
- the login and session steps
- anything that broke (bot checks, captchas)

**Go/no-go:** if neither candidate reaches "cart with 3 items," stay on `DELIVERY_PROVIDER=mock` for the demo and report the result in team chat. Everything below still gets built, with mock as the provider.

## Part 3: Build `services/delivery` (addendum D14)
Create a new workspace package, `@care-circle/delivery` (Fastify, port 4004). Ask Agent 4 to add it to `pnpm dev`, `pnpm health`, and `pnpm seed`.

1. **Provider interface:** `quote(items, kind, storeHint, dropoff)`, `buildCart(quote)`, `checkout(cart)`, `status(externalId)`.
2. **`mock` provider:** a seeded grocery store with a priced catalog (about 60 items) and 3 restaurants per city (for Packet B). Statuses advance by timer or `/demo/advance`.
3. **`doordash_thirdparty` provider:**
   - An MCP client (`@modelcontextprotocol/sdk`) using a Streamable HTTP transport (candidate A) or stdio (candidate B), picked by env.
   - At startup, call `listTools()` and **fail loudly if any tool from `DOORDASH-SPIKE.md` is missing.**
   - Queue every call so they run one at a time.
4. **Quote:** match each line, returning `matched` / `not_found` / `ambiguous` (max 3 options). Cache quotes for 15 minutes.
5. **Orders:** `POST /orders` → re-check money `GET /orders/:id` is `paid` → build the cart → **abort** if the total > approved × (1 + `DOORDASH_PRICE_TOLERANCE_PCT`) or > `DOORDASH_MAX_ORDER_CENTS` → `dry_run_complete` (default) or `awaiting_live_checkout` (live).
6. **Checkout:** refused unless `DOORDASH_LIVE_CHECKOUT=1` + `X-CC-Secret` + status `awaiting_live_checkout`. Log `confirmedBy`.
7. **Events:** POST `delivery.status` to money **and** family `/webhooks/delivery-status`. Poll provider status every 30s for live orders.
8. **Safety tests (all mock):**
   - checkout refused when the flag is 0
   - checkout refused without the secret
   - checkout refused when the money order isn't paid
   - over-tolerance aborts
   - over-cap aborts
   - `/demo/advance` refused for the third-party provider
9. **Family side:** on `delivered`, call voice `/calls/outbound` with purpose `delivery_arrived` (v1.1), and post "delivered" to the circle.

## Part 4 (later, v1.1 Packet B): the shared meal
Use delivery `/quote`, `/orders`, and `/checkout` with `kind: "meal"` instead of DoorDash Drive. Everything else follows brief §6.

## Definition of done
- [ ] Part 1 fixes, with real E2E 2 passing against the live services
- [ ] `DOORDASH-SPIKE.md` written, with a go/no-go decision
- [ ] Delivery service with mock provider: quote → order → dry run → delivered events, with every safety test passing
- [ ] *(If go)* the third-party provider builds a real cart with 3 items in dry run

## Kickoff prompt
> You are Agent 3. Read CLAUDE.local.md, docs/agents/agent-3-family.md, docs/CONTRACTS-ADDENDUM.md, and docs/INTEGRATION-REPORT.md. Put Parts 1–3 in services/family/TASKS.md. Do Part 1 now, committing and pushing to origin andy after each item. For Part 2, stop and walk me through the spike (I run the commands and paste you the tool list). Then do Part 3, starting with the mock provider and the safety tests. You may write in services/family/, services/delivery/, and status/AGENT-3.md only. Never place a real DoorDash order; never commit credentials, tokens, or cookies.
