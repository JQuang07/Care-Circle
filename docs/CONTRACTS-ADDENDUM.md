# CONTRACTS-ADDENDUM.md (v1.0.1)
**Status: proposed defaults. The coordinator reviews, edits if needed, and commits.** Once committed, this file is part of the contract: every agent reads `CONTRACTS.md` **and** this file. Where they disagree, this file wins.

Everything here is **additive**, except rule 8, which it replaces.

---

## D1 · Demo reset
`POST /demo/reset` → `{ ok: true }` on **voice, money, family, and delivery**. Each service restores **its own** schema or state to seed. Web calls them in the order family → money → delivery → voice. Requires `X-CC-Secret`.

## D2 · Fast-forward
Family exposes **both** of these:
- `POST /demo/time-travel` `{ nowUtc } | { to: "next_call", minutesBefore? }`
- `POST /demo/fire-due` `{ scheduledCallId }` → `{ ok: true }`: fires `scheduled_call.due` now

Both require `X-CC-Secret`.

## D3 · Voice demo endpoints (Agent 1)
- `GET /demo/calls?seniorId=` → `{ callId, kind, purpose?, scheduledCallId?, startedAt }[]`
- `POST /demo/simulate-verification` `{ seniorId, holdId, memberId, script: { speaker: "senior" | "member", text: string }[] }` → `{ callId }`. The voice agent resolves the hold through `resolve_hold_verbal` exactly as on a real call.

## D4 · Reminder vs. due
The `scheduled_call.due` webhook body adds `phase: "reminder" | "due"`. Family also keeps sending the header `X-CC-Phase` for backward compatibility. Voice reads the body first, then the header.

## D5 · Message actions (one vocabulary)
`POST family /messages/:id/act { action, payload }`. The stored button payload is authoritative. Clients may add only `voiceNoteUrl`, `passkeyAssertion`, `note`, or `slotId`.

| Message kind | `action` | `payload` |
|---|---|---|
| `schedule_proposal` | `accept_slot` / `decline_all` | `{ proposalId, slotId, slot: Slot }` |
| `fraud_card` | `cancel_hold` / `release_hold` / `calling_her` | `{ orderId, holdId }`. `release_hold` needs a `passkeyAssertion`; the web handles the passkey step. |
| `add_to_order` | `add_item` / `record_voice_note` | `{ orderId }` (in v1, `add_item` answers "coming soon") |
| `nudge`, `briefing` | `call_now` / `dismiss` | `{ hookId? }` |

`ScheduledCall.roomJoinUrl` = `${WEB_URL}/call/${id}`. Per-member links add `?member=mem_x`.

## D6 · `everAskedForMoney`
Type changes from the literal `false` to `boolean`. The seed keeps it `false` for everyone.

## D7 · Gifts for dependents (Mia)
- Seed: `dependents: [{ name: "Mia", age: 9, schoolHours: "...", birthday: "10-14" }]`.
- A gift for a dependent is sent with `recipientMemberId` = **the parent** (`mem_lisa`), plus `context.statedReason` naming the child.
- Money treats that as a circle-member recipient, so it does **not** trip `GIFT_CARD_NONMEMBER`.
- Nobody ever creates a member record for, messages, or calls a minor.

## D8 · Cancel without a passkey
`POST money /holds/:id/resolve { decision: "cancel", method: "passkey_web" }` is accepted **without** a `passkeyAssertion`, because cancel is always allowed. `release` on a high-risk hold still requires one.

## D9 · Prices are never invented
- Voice never invents a price or total. It reads back exactly what money returns.
- Money prices grocery items from **delivery `POST /quote`** when the delivery service is reachable (D14). Otherwise it uses its own seeded FreshMart price list.
- `Order` gains an optional `fulfilment?: { provider: "mock" | "doordash_thirdparty"; storeName: string; quoteId?: string; unmatchedItems: string[] }`, so voice can say *"They didn't have oat milk. Want something else?"*
- Money adds `GET /orders/:id` → `Order`.

## D10 · Who must accept a schedule proposal
- If the request **names** members (`memberIds`), all of them must accept a common slot.
- If it names **none**, everyone is invited, and the proposal becomes `awaiting_senior` as soon as **≥2 invitees accept the same slot**. Invitees who haven't answered stay invited and still receive the join link.

## D11 · Additive fields and endpoints
- `CallEnded.scheduledCallId?: string` (for `kind: "scheduled_family_call"`)
- `OrderRequest.scheduledFor?: string` (ISO UTC; rides)
- `GET family /circle/:seniorId` also returns `seniorHints: { text, createdAt }[]`
- Family:
  - `GET /schedule/calls/:id/join?memberId=` → `{ serverUrl, roomName, identity, token }`
  - `GET /schedule/proposals/:id` → `Proposal`
  - `GET /orders/:orderId/voice-notes` → `{ id, orderId, memberId, memberName, url, createdAt }[]`

## D12 · `/moments?week=`
The parameter is an ISO week (`2026-W39`) in Rose's time zone. Omitted means the current week. Family also accepts `YYYY-MM-DD` (any day in the week).

## D13 · Shared secret
One `CC_INTERNAL_SECRET` for the whole team, **≥ 24 characters**, shared privately and never committed.

---

## D14 · Delivery service + third-party DoorDash MCP
A new service owned by **Agent 3**, the **only** place that talks to DoorDash. Money stays the only service that decides whether money can be spent. Delivery only executes orders money has approved.

### Ports and env

| Service | Owner | Port | Env |
|---|---|---|---|
| delivery | Agent 3 | **4004** | `DELIVERY_URL=http://localhost:4004` |
| DoorDash MCP server (third-party, runs locally on the demo laptop only) | Agent 3 | **3100** (never 3000, which is web) | `DOORDASH_MCP_URL`, `DOORDASH_MCP_TOKEN` |

Other env:
- `DELIVERY_PROVIDER=mock | doordash_thirdparty`. **The default is `mock`**, and E2E always uses `mock`.
- `DOORDASH_LIVE_CHECKOUT=0 | 1`. Default `0` means dry run: build the cart, never pay.
- `DOORDASH_MAX_ORDER_CENTS=3000`
- `DOORDASH_PRICE_TOLERANCE_PCT=10`

### Types

```ts
interface QuoteLine {
  requested: string; qty: number;
  status: "matched" | "not_found" | "ambiguous";
  matched?: { name: string; priceCents: number; qty: number };
  options?: { name: string; priceCents: number }[];   // when ambiguous (max 3)
}
interface Quote {
  quoteId: string; provider: "mock" | "doordash_thirdparty";
  kind: "grocery" | "meal"; storeName: string;
  lines: QuoteLine[]; subtotalCents: number; feesCents: number; totalCents: number;
  expiresAt: string;
}
interface DeliveryOrder {
  deliveryId: string; orderId: string; quoteId: string; provider: Quote["provider"];
  status: "cart_ready" | "dry_run_complete" | "awaiting_live_checkout" | "placed"
        | "picked_up" | "delivered" | "failed";
  cartTotalCents: number; approvedAmountCents: number;
  trackingUrl?: string; etaUtc?: string; failureReason?: string;
}
```

### Endpoints (delivery, :4004)

| Method | Path | Body → Response |
|---|---|---|
| GET | `/health` | `{ ok, service: "delivery", mock, provider, liveCheckout: boolean }` |
| POST | `/quote` | `{ kind, items: { name, qty }[], storeHint?, dropoffPersonId }` → `Quote` |
| POST | `/orders` | `{ orderId, quoteId, approvedAmountCents }` → `DeliveryOrder`. Delivery **re-checks** with money `GET /orders/:id` that the order is `paid`. It builds the cart and **aborts** if the cart total > `approvedAmountCents` × (1 + tolerance) or > `DOORDASH_MAX_ORDER_CENTS`. |
| POST | `/orders/:deliveryId/checkout` | `{ confirmedBy }` → `DeliveryOrder`. **Places a real order.** Refused unless `DOORDASH_LIVE_CHECKOUT=1`, `X-CC-Secret` is present, and status is `awaiting_live_checkout`. |
| GET | `/orders/:deliveryId` | → `DeliveryOrder` |
| POST | `/demo/advance/:deliveryId` | `{ to }` → `DeliveryOrder` (mock provider only) |
| POST | `/demo/reset` | → `{ ok: true }` |

**Event:** `delivery.status` is POSTed to money `/webhooks/delivery-status` **and** family `/webhooks/delivery-status` with payload `{ deliveryId, orderId, status, etaUtc?, trackingUrl? }`.

### Flow (groceries)
1. Voice builds Rose's list.
2. Money calls delivery `/quote` for real prices.
3. The fraud engine runs, and Rose confirms the read-back.
4. Money pays through the Visa sandbox.
5. Money calls delivery `POST /orders`.
6. The delivery service:
   - **Dry run (default):** builds the cart and stops. Status becomes `dry_run_complete`.
   - **Live mode:** stops at `awaiting_live_checkout`. **A human** presses "Place real order" in `/demo`, typing a confirmation phrase, and that calls `/checkout`.

### Flow (shared meal, v1.1 Packet B)
Family uses the same `/quote`, `/orders`, and `/checkout` with `kind: "meal"`, **after** money has approved and paid each meal order.

## Rule 8 (replaces the original)
8. DoorDash is reached **only** through the delivery service. Allowed providers: `mock`, and a local third-party DoorDash MCP server (`doordash_thirdparty`), under all of these conditions:
   - It runs **only on the demo laptop**, on loopback with a token.
   - It uses one dedicated DoorDash account and a low-limit card.
   - Dry run is the default. Real checkout needs `DOORDASH_LIVE_CHECKOUT=1` **and** a human click per order.
   - Every order was approved by money's fraud engine and paid first.
   - The cart total is checked against the approved amount and the hard cap.
   - Credentials and session cookies are never committed.
   - The README states plainly that this is an unofficial integration.
