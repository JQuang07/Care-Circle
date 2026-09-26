# DoorDash MCP spike notes
**Server:** davidgibbons/mcp-doordash (fork of `@striderlabs/mcp-doordash` v0.5.0), Streamable HTTP mode:
- `MCP_HTTP_PORT` + `MCP_HTTP_TOKEN`, sent as `Authorization: Bearer <token>`
- binds to `127.0.0.1` by default
- `GET /healthz` works without a token
- calls are serialized (one browser tab)

**Verified during integration (no DoorDash login):** our client (`pnpm dd:check`) connected over HTTP and listed these tools. `doordash_auth_check` answered "not logged in." A wrong token is rejected (401).

| Tool | Args | Used by delivery for |
|---|---|---|
| `doordash_auth_check` | none | login check before every operation |
| `doordash_set_address` | `{ address }` | `DOORDASH_DROPOFF_ADDRESS`, once per process |
| `doordash_search` | `{ query, cuisine? }` → `{ restaurants: [{id, name, ...}] }` | picking the store (`DOORDASH_GROCERY_STORE` or `storeHint`) |
| `doordash_menu` | `{ restaurantId }` → `{ categories: [{ items: [{name, price}] }] }` | the catalog for quoting |
| `doordash_add_to_cart` | `{ restaurantId, itemName, quantity }` | building the cart |
| `doordash_cart` | none → `{ items, subtotal, total }` | cart check + totals |
| `doordash_checkout` | `{ confirm }`: `false` = preview, `true` = **places the order** | preview (dry run); `true` only behind the live gate |
| `doordash_track_order` | `{ orderId? }` | status polling after a live order |
| `doordash_auth_clear`, `doordash_create_group_order` | none | not used |

## Still to verify with a real login (Agent 3, demo laptop)
- [ ] `pnpm dd:check` → logged in
- [ ] `pnpm dd:check -- --quote "whole milk,bananas,wheat bread" --store "<store near address>"` prices all three
- [ ] Grocery stores show up in `doordash_search` and `doordash_menu` returns their items with prices (big catalogs may be partial)
- [ ] A dry-run order reaches `dry_run_complete` (cart built, checkout preview total ≤ approved + 10%)
- [ ] Note any captcha or bot check here, with the time and what fixed it
- [ ] **Go/no-go for the one live order:** ______
