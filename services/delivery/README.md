# delivery (:4004), owned by Agent 3
The **only** service that talks to DoorDash. Money decides whether anything may be bought; delivery only fulfils orders money has already **approved and charged**.

| Mode | `.env` | What happens |
|---|---|---|
| **Mock** (default, E2E, rehearsals) | `DELIVERY_PROVIDER=mock` | Built-in demo grocery store + restaurants. Dry run; `/demo/advance` simulates the Dasher. |
| **DoorDash dry run** | `DELIVERY_PROVIDER=doordash_thirdparty`, `DOORDASH_LIVE_CHECKOUT=0` | Real store, real prices, real cart, checkout **preview** only. Nothing is paid. |
| **DoorDash live** (demo laptop, one take) | `...thirdparty`, `DOORDASH_LIVE_CHECKOUT=1` | Stops at `awaiting_live_checkout`; a human must press "Place real order" (web /demo), which calls `/orders/:id/checkout`. |

## Safety gates (tested in `test/service.test.ts`)
1. **Money gate:** `POST /orders` re-checks money: the order must be `paid`, and `approvedAmountCents` ≤ what money charged.
2. **Price gate:** it aborts if the cart total > approved × (1 + `DOORDASH_PRICE_TOLERANCE_PCT`%) or > `DOORDASH_MAX_ORDER_CENTS`.
3. **Live gate:** `/checkout` needs `DOORDASH_LIVE_CHECKOUT=1` + the real provider + `X-CC-Secret` + a named human (`confirmedBy`) + a still-paid order. It places **at most once**.
4. **Cart gate:** it refuses to build on a DoorDash cart that already has items, and checks the cart matches the approved lines exactly.

The model never calls DoorDash tools. Matching and dispatch are deterministic code.

## API (all routes except `/health` need `X-CC-Secret`)
| Method | Path | Body → Response |
|---|---|---|
| GET | `/health` | `{ ok, service, mock, provider, liveCheckout, doordash? }` |
| POST | `/quote` | `{ kind: "grocery"\|"meal", items: {name, qty}[], storeHint? }` → `Quote` |
| POST | `/orders` | `{ orderId, seniorId, quoteId, approvedAmountCents }` → `DeliveryOrder` |
| POST | `/orders/:id/checkout` | `{ confirmedBy }` → `DeliveryOrder` (**real order**, gated) |
| GET | `/orders/:id`, `/orders?seniorId=` | → `DeliveryOrder` / `DeliveryOrder[]` |
| POST | `/demo/advance/:id` | `{ to: placed\|picked_up\|delivered }` (mock only) |
| POST | `/demo/reset` | `{ ok: true }` |

**Event:** `POST {money,family}/webhooks/delivery-status` with `{ deliveryId, orderId, status, etaText?, trackingUrl?, failureReason? }`, plus `seniorId`, `storeName` and `etaUtc` (additive, so receivers can route without a lookup). A 404 on the receiver is ignored. Family handles it: dry run → Lisa, placed/picked_up → ETA note to the circle, delivered → circle + voice `delivery_arrived` call, failed → verifiers.

## Connecting the third-party DoorDash MCP server (Windows CMD, demo laptop)
Tested against **davidgibbons/mcp-doordash** (a fork of `@striderlabs/mcp-doordash`). Our client connected over HTTP and found all 10 tools. This integration is **unofficial**: it drives DoorDash's website with browser automation, which DoorDash's terms may not allow. Use a **dedicated DoorDash account** with a **low-limit card**.

**1. Install it OUTSIDE the repo,** so cookies can never be committed:
```cmd
mkdir %USERPROFILE%\code\dd-mcp
cd /d %USERPROFILE%\code\dd-mcp
git clone https://github.com/davidgibbons/mcp-doordash.git
cd mcp-doordash
npm install
npm run build
npx patchright install chromium
```
If `patchright` isn't found, run `npx playwright install chromium` instead.

**2. Log in once.** A real browser window opens; sign in to the dedicated account:
```cmd
npm run login
```

**3. Run it as a local HTTP server on port 3100,** in its own CMD window, left open:
```cmd
cd /d %USERPROFILE%\code\dd-mcp\mcp-doordash
set MCP_HTTP_PORT=3100
set MCP_HTTP_TOKEN=<make up a long random string>
npm start
```
Keep the browser **headed** (don't set `DOORDASH_HEADLESS`), because headless mode is flagged more often. It listens on `127.0.0.1` only.

**4. Point Care Circle at it** in the repo-root `.env`:
```
DELIVERY_PROVIDER=doordash_thirdparty
DOORDASH_MCP_URL=http://127.0.0.1:3100/mcp
DOORDASH_MCP_TOKEN=<same string as step 3>
DOORDASH_DROPOFF_ADDRESS=<the account's delivery address>
DOORDASH_GROCERY_STORE=<a grocery store name near that address, e.g. Kroger>
DOORDASH_LIVE_CHECKOUT=0
```

**5. Check the connection.** This never adds to the cart and never checks out:
```cmd
pnpm dd:check
pnpm dd:check -- --quote "whole milk,bananas,wheat bread" --store "Kroger"
```
Expect `✓ all required tools present`, `✓ logged in`, and prices for the three items.

**6. Restart `pnpm dev`.** `pnpm health` now shows delivery with `provider: doordash_thirdparty`.

**Session expired?** Run `npm run login` again and restart the MCP server.
**Going back to safe mode:** set `DELIVERY_PROVIDER=mock` and restart.

## Dev
```cmd
pnpm --filter @care-circle/delivery test
pnpm --filter @care-circle/delivery dev
```
