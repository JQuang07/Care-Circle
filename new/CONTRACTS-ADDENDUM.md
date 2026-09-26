# CONTRACTS-ADDENDUM.md (v1.0.2)
**Part of the contract.** Every agent reads `CONTRACTS.md` **and** this file; where they disagree, this file wins. Everything is additive, except rule 8, which it replaces. The coordinator may edit any decision; tell the team when you do.

## D1 · Demo reset
`POST /demo/reset` → `{ ok: true }` on **voice, money, family, and delivery**. Each service restores its own state to seed. Web calls them in the order family → money → delivery → voice. Requires `X-CC-Secret`.

## D2 · Fast-forward
Family exposes `POST /demo/time-travel` `{ nowUtc } | { to: "next_call", minutesBefore? }` **and** `POST /demo/fire-due` `{ scheduledCallId }` → `{ ok: true }`. Both require the secret.

## D3 · Voice demo endpoints
- `GET /demo/calls?seniorId=` → `{ callId, kind, purpose?, scheduledCallId?, startedAt }[]`
- `POST /demo/simulate-verification` `{ seniorId, holdId, memberId, script: { speaker: "senior" | "member", text }[] }` → `{ callId }`. Resolves through `resolve_hold_verbal` exactly as on a real call.

## D4 · Reminder vs. due
The `scheduled_call.due` body adds `phase: "reminder" | "due"`. Family keeps sending the `X-CC-Phase` header too; voice reads the body first.

## D5 · Message actions
`POST family /messages/:id/act { action, payload }`. The stored button payload is authoritative. Clients may add only `voiceNoteUrl`, `passkeyAssertion`, `note`, or `slotId`.

| Kind | Actions | Payload |
|---|---|---|
| `schedule_proposal` | `accept_slot`, `decline_all` | `{ proposalId, slotId, slot: Slot }` |
| `fraud_card` | `cancel_hold`, `release_hold`, `calling_her` | `{ orderId, holdId }` (`release_hold` needs `passkeyAssertion`) |
| `add_to_order` | `add_item` (v1: "coming soon"), `record_voice_note` | `{ orderId }` |
| `nudge`, `briefing` | `call_now`, `dismiss` | `{ hookId? }` |

`ScheduledCall.roomJoinUrl` = `${WEB_URL}/call/${id}` (per member: `?member=mem_x`).

## D6 · `everAskedForMoney` is `boolean`
The seed keeps it `false` for everyone.

## D7 · Gifts for dependents (Mia)
- Seed: `dependents: [{ name: "Mia", age: 9, schoolHours: "08:00-15:30 mon-fri", birthday: "10-14" }]`.
- A gift for a dependent is sent with `recipientMemberId` = the parent (`mem_lisa`) and a `context.statedReason` naming the child. Money treats that as a circle recipient, so it does **not** trip `GIFT_CARD_NONMEMBER`.
- A minor is never a member, never messaged, never called.

## D8 · Cancel needs no passkey
`POST money /holds/:id/resolve { decision: "cancel" }` is accepted without `passkeyAssertion`. Releasing a high-risk hold still needs one.

## D9 · Prices are never invented
- Voice reads back exactly what money returns.
- For `type: "groceries"`, money prices items from **delivery `POST /quote`** (D14) when `DELIVERY_URL` is reachable. Otherwise it uses its FreshMart price list.
- `Order` gains `fulfilment?: { provider: "mock" | "doordash_thirdparty"; storeName: string; quoteId?: string; unmatchedItems: string[]; delivery?: { deliveryId, status, etaText?, trackingUrl?, failureReason? } }`.
- Money adds `GET /orders/:id` → `Order`.

## D10 · Who must accept a schedule proposal
- **Named members:** all of them must accept the same slot.
- **None named:** everyone is invited, and the proposal becomes `awaiting_senior` as soon as **≥2 invitees accept the same slot**. Non-responders stay invited and get the join link.

## D11 · Additive fields and endpoints
- `CallEnded.scheduledCallId?`
- `OrderRequest.scheduledFor?` (ISO UTC, rides)
- `/circle/:seniorId` returns `seniorHints: { text, createdAt }[]`
- Family:
  - `GET /schedule/calls/:id/join?memberId=` → `{ serverUrl, roomName, identity, token }`
  - `GET /schedule/proposals/:id` → `Proposal`
  - `GET /orders/:orderId/voice-notes` → `{ id, orderId, memberId, memberName, url, createdAt }[]`

## D12 · `/moments?week=`
The parameter is an ISO week (`2026-W39`) in Rose's time zone; omitted means the current week. `YYYY-MM-DD` is also accepted.

## D13 · Shared secret
One `CC_INTERNAL_SECRET` for the whole team, **≥24 characters**, shared privately and never committed.

## D14 · Delivery service (built; owner: Agent 3)
`services/delivery`, **port 4004**, `DELIVERY_URL=http://localhost:4004`. The only service that talks to DoorDash. Money decides; delivery only fulfils orders money has **approved and charged**. Full docs: `services/delivery/README.md`.

**Providers**
- `DELIVERY_PROVIDER=mock` (default, E2E, rehearsals)
- `doordash_thirdparty`: a local third-party DoorDash MCP server (davidgibbons/mcp-doordash) on `127.0.0.1:3100`, reached over Streamable HTTP with `DOORDASH_MCP_URL` and `DOORDASH_MCP_TOKEN` (or stdio via `DOORDASH_MCP_COMMAND`)

**Other env**
- `DOORDASH_LIVE_CHECKOUT=0|1` (default `0` = dry run)
- `DOORDASH_MAX_ORDER_CENTS=3000`
- `DOORDASH_PRICE_TOLERANCE_PCT=10`
- `DOORDASH_DROPOFF_ADDRESS`, `DOORDASH_GROCERY_STORE`
- `DOORDASH_FEE_BASE_CENTS=799`, `DOORDASH_FEE_PCT=15` (the fee and tax estimate added to quotes)

**Types** (`services/delivery/src/types.ts`; Agent 4 moves them into `@care-circle/contracts`): `QuoteLine`, `Quote` (with `storeId`, `feesCents`, and `totalCents` = subtotal + estimated fees), `DeliveryStatus`, and `DeliveryOrder`.

**Endpoints** (all except `/health` require `X-CC-Secret`)

| Method | Path | Body → Response |
|---|---|---|
| GET | `/health` | `{ ok, service: "delivery", mock, provider, liveCheckout, doordash? }` |
| POST | `/quote` | `{ kind: "grocery" \| "meal", items: { name, qty }[], storeHint? }` → `Quote`. Lines are `matched`, `ambiguous` (≤3 options), or `not_found`. |
| POST | `/orders` | `{ orderId, seniorId, quoteId, approvedAmountCents }` → `DeliveryOrder`. Re-checks that money's order is `paid` and `approvedAmountCents` ≤ what money charged; builds the cart; `failed` if total > approved × 1.10 or > cap; otherwise `dry_run_complete`, or `awaiting_live_checkout` when live. Idempotent per `orderId`. |
| POST | `/orders/:id/checkout` | `{ confirmedBy }` → `DeliveryOrder`. **Places a real order.** Needs the real provider + `DOORDASH_LIVE_CHECKOUT=1` + secret + `confirmedBy` + a still-paid order. At most once. |
| GET | `/orders/:id`, `/orders?seniorId=` | → `DeliveryOrder` / `DeliveryOrder[]` |
| POST | `/demo/advance/:id` | `{ to: "placed" \| "picked_up" \| "delivered" }` (mock only) |
| POST | `/demo/reset` | → `{ ok: true }` |

**Event:** `POST {money,family}/webhooks/delivery-status` with `{ deliveryId, orderId, status, etaText?, trackingUrl?, failureReason? }` on every status change.

**Groceries flow**
1. Voice builds the list.
2. Money calls delivery `/quote`.
3. Fraud check, then Rose confirms the read-back.
4. Money pays.
5. Money calls delivery `/orders`.
6. Dry run by default. A live order needs a human to press "Place real order" in web `/demo`.

**Shared meal (v1.1 Packet B):** the same endpoints with `kind: "meal"`.

## D15 · What `MOCK` means (team-wide)
- `MOCK=1` fakes **external providers** only: Stripe/Visa, Muse, Twilio/Deepgram, LiveKit, DoorDash.
- `MOCK_DEPENDENCIES=1` additionally fakes **neighbor services** (voice/money/family/delivery).
- **Team default:** `MOCK=1`, `MOCK_DEPENDENCIES=0`, so every service calls the others' real code over HTTP and events flow.

## D16 · Purchase confirmation (voice)
An utterance confirms a pending purchase when:
- it **starts with an affirmative** (yes, yeah, go ahead, please do, that's right, okay, sure),
- has **no negation or hesitation** (no, not, wait, don't, hold on, actually),
- and adds **no new items or changes**.

*"Yes, that's everything. Please go ahead and order it."* confirms. *"Yes, but add eggs"* does not; it re-quotes. Playback-completion and change-invalidation rules still apply.

## Rule 8 (replaces the original)
8. DoorDash is reached **only** through the delivery service, with `mock` or the local third-party MCP server. Conditions:
   - The server runs on the demo laptop only, on loopback, behind a token.
   - It uses a dedicated DoorDash account with a low-limit card.
   - Dry run is the default. A real order needs `DOORDASH_LIVE_CHECKOUT=1` **and** a human's typed confirmation.
   - Every order is fraud-checked and paid by money first, and the cart is checked against the approved amount and the cap.
   - Tokens, cookies, and `.env` are never committed.
   - The README states that this is an unofficial integration.
