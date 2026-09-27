# Care Circle

Care Circle is a phone helper for Rose, who is 81. She talks to it the way she would talk to a person:

- She orders groceries by voice, and they are priced and ordered through DoorDash (dry run by default).
- Every purchase goes through a four-layer scam check before any money moves.
- Her family (Lisa, Danny, Mark) sees what happens on their phones and can step in when something looks wrong.
- It books family video calls at times that suit everyone, and rings Rose when it is time.

This guide explains how to install it, start it, and use it. The shared interfaces live in [`CONTRACTS.md`](CONTRACTS.md) and [`docs/CONTRACTS-ADDENDUM.md`](docs/CONTRACTS-ADDENDUM.md); where they disagree, the addendum wins.

---

## 1. What you need

| Tool | Version | Notes |
|---|---|---|
| Node.js | 22.12 or newer | `node -v` to check |
| pnpm | 10 | `npm install -g pnpm`, or `corepack enable` |
| Docker Desktop | any recent | Runs the Postgres database. Start it once and wait until it says it is running |
| Git | any recent | |
| Chrome or Edge | any recent | Needed for the microphone on the demo page |

On Windows, if Postgres is already installed natively it will block Docker's port 5432. Stop it once from an administrator command prompt: `net stop postgresql-x64-16` (and `postgresql-x64-17` if present).

---

## 2. Install

```bash
git clone https://github.com/JQuang07/Care-Circle.git
cd Care-Circle
pnpm install
```

Create your settings file from the example:

```bash
cp .env.example .env       # macOS / Linux
copy .env.example .env     # Windows CMD
```

Open `.env` and set at least:

| Key | What to put |
|---|---|
| `CC_INTERNAL_SECRET` | Any string of 24 or more characters. Everyone on the team must use the same one. Voice refuses to start if it is shorter |
| `MOCK` | Leave at `1`. This fakes the outside providers (Twilio, payments, LiveKit) so nothing real is charged or dialled |
| `META_API_KEY` | Optional but recommended. Turns on Muse for understanding Rose and for speech-to-text. Without it, a simple keyword bot and the clip transcripts are used |
| `MUSE_MODEL` | `muse-spark-1.3` |
| `DEEPGRAM_API_KEY` | Optional. Gives Care Circle a natural spoken voice and a backup speech-to-text |

Leave these as they are unless you are on the demo laptop: `MOCK_DEPENDENCIES=0`, `DELIVERY_PROVIDER=mock`, `DOORDASH_LIVE_CHECKOUT=0`. Never add a `PORT=` line; each service has its own fixed port.

---

## 3. Start it

```bash
docker compose up -d --wait   # start the database
pnpm seed                     # load Rose, her family, the stores, and her history
pnpm dev                      # start all five parts; leave this window open
```

In a second terminal, check that everything is up:

```bash
pnpm health
```

You should see five green rows: voice, money, family, delivery, and web. The web row can take about 30 seconds the first time.

Then open **http://localhost:3000** in Chrome or Edge.

### Every day after that

```bash
docker compose up -d --wait
pnpm dev
```

---

## 4. Using the app

The bar at the top of every page links to the main screens.

| Page | Address | What it is for |
|---|---|---|
| Stage | `/stage` | The main demo screen. Rose's side of the phone call on the left, Lisa's and Danny's phones on the right, all live |
| Family phones | `/family` | Lisa's, Danny's, and Mark's phones on their own, with the passkey step for releasing a paused purchase |
| Rose's week | `/dashboard` | Calls, paused purchases, recent orders and their delivery status, and "See how we decided" for each fraud check |
| Rose's tablet | `/tablet` | A backup for Rose: one large button that answers only calls from her own schedule |
| Demo controls | `/demo` | Run each scenario as text, fast-forward to the next family call, try a DoorDash quote, view fraud eval results, reset all data |
| Family call | `/call/<id>?member=mem_lisa` | The family video room. The link arrives on the family phones when a call is booked |

### The Stage page, step by step

1. **Pick a scenario** with the tabs at the top: Groceries, Family call, Scam call, or Mia's gift.
2. **Play the clips in order.** Each row is one thing Rose says. Press the round play button on the first row. The clip plays out loud, then:
   - her words appear in the conversation as soon as they are transcribed,
   - a label under the conversation shows whether Care Circle is transcribing, thinking, or speaking,
   - Care Circle answers out loud, and its reply appears on the right side of the conversation.
3. **Watch the phones.** Lisa's and Danny's phones update by themselves. Buttons on the phones work: tap a time slot, cancel a hold, and so on.
4. **Read the cards below the conversation.** Each card is one thing that happened, such as "Order paid", "Hold placed", or "Ordered from Kroger". A grocery card shows the DoorDash total, what was charged, and anything returned to the family card.
5. **Start over** with "New call" (keeps the data, clears the conversation) or "Reset demo" (puts every service back to the starting data).

**Speaking live instead of playing clips.** Press **Speak**, say the sentence, and press it again to send. Choose "as Rose", or "as Danny (check-in call)" to answer a verification call after a scam hold. If nothing is heard, pick another microphone from the Mic list; the Level bar shows whether the microphone hears you. The browser only allows the microphone on `http://localhost:3000`, so open the demo on the same computer that runs it.

**Typing instead of speaking.** Type in "Or type what Rose says" and press Say.

### What each scenario should do

| Scenario | What happens |
|---|---|
| Groceries | Rose asks for milk, bananas, and bread. Care Circle reads back the items, store, and price. When she says yes, the order is paid, DoorDash builds the cart (dry run), and Lisa gets a message asking if she wants to add anything |
| Family call | Rose asks to see the family. Lisa and Danny each get three suggested times. After clip 1, tap the **same** time on both phones, then play clip 2, where Rose agrees. The call is booked and the join links are sent |
| Scam call | A caller claiming to be her grandson asks for gift cards. The purchase is held, nothing is paid, and Danny gets a card explaining why. Danny answers the check-in call, says it was not him, and the hold is cancelled. Rose is never scolded |
| Mia's gift | Rose buys a birthday gift for her granddaughter Mia. It goes through Lisa (Mia is a child and is never contacted directly), passes as low risk, and is paid |

### Confirming a purchase

Care Circle only buys after Rose clearly agrees. A reply confirms when it starts with yes (or yeah, okay, sure, go ahead), contains no "no", "wait", "not", or "actually", and adds nothing new. For example:

- "Yes please. Thank you so much." confirms.
- "Yes, but add eggs." does not; Care Circle updates the order and reads it back again.

### Family phones and paused purchases

When a purchase is paused, the verifiers (Lisa and Danny) get a red "Purchase paused" card listing the reasons. From the card they can:

- **Cancel** the purchase. This never needs a passkey.
- **Release** it. For a high-risk purchase this requires the passkey step on `/family`.
- **Call Rose** to check with her first.

---

## 5. Running it without a browser

```bash
pnpm demo:run all           # plays every scenario's clips through the real services
pnpm demo:run all --text    # the same, using the text transcripts instead of audio
```

It prints each transcript, reply, and event, then checks the final state.

---

## 6. Groceries and DoorDash

By default, groceries use a built-in demo store and nothing leaves your computer.

To price and build real DoorDash carts on the demo laptop, see [`services/delivery/README.md`](services/delivery/README.md). In short: run the third-party DoorDash MCP server outside this repository, then set in `.env`:

```
DELIVERY_PROVIDER=doordash_thirdparty
DOORDASH_MCP_URL=http://127.0.0.1:3100/mcp
DOORDASH_MCP_TOKEN=<the token the MCP server was started with>
DOORDASH_DROPOFF_ADDRESS=<delivery address>
DOORDASH_GROCERY_STORE=<a store near that address>
DOORDASH_LIVE_CHECKOUT=0
```

Check the connection with `pnpm dd:check`, then restart `pnpm dev`.

**This is an unofficial third-party integration and it runs as a dry run.** The cart is built and priced, and the process stops at DoorDash's checkout page. Nothing is ordered and nothing is charged. A real order needs `DOORDASH_LIVE_CHECKOUT=1`, an order the money service has already checked and paid, and a person on `/demo` typing their name and `PLACE REAL ORDER`. The cart is also checked against the approved amount and a hard cap (`DOORDASH_MAX_ORDER_CENTS`).

Notes on the dry run:

- Before building, the dry run empties whatever the previous rehearsal left in the DoorDash cart.
- Rose approves an estimate (items plus estimated fees). Once DoorDash shows its real checkout total, the charge is lowered to that total and the difference is returned; it is never raised.

---

## 7. Troubleshooting

| Problem | Fix |
|---|---|
| `pnpm health` shows voice down | `CC_INTERNAL_SECRET` is shorter than 24 characters, or differs from the team's |
| A service starts on the wrong port | Remove any `PORT=` line from `.env` |
| Database connection refused or wrong password | A native Postgres is using port 5432. Stop it (see section 1), then `docker compose up -d --wait` |
| `pnpm` not found | `npm install -g pnpm`, then open a new terminal |
| Care Circle answers with simple canned replies | `META_API_KEY` is missing or invalid, so the keyword bot is answering |
| The Speak button says the microphone is blocked | Open the page at `http://localhost:3000` in Chrome or Edge and allow the microphone in the address bar |
| "No sound reached this microphone" | Pick another device in the Mic list, or check the microphone is not muted |
| The grocery card says the DoorDash cart did not build | The DoorDash page was slow. The dry run finished on the quoted price. Run it again; check `pnpm dd:check` if it keeps happening |
| DoorDash rejects the token (401) | The `DOORDASH_MCP_TOKEN` in `.env` must match the token the MCP server was started with. Fix one, then restart `pnpm dev` |
| Old orders or messages are in the way | Press "Reset demo" on `/stage`, or "Reset all data" on `/demo` |

---

## 8. Tests

| Command | What it checks |
|---|---|
| `pnpm typecheck` | Every package compiles, and the shared types match their schemas |
| `pnpm --filter @care-circle/<service> test` | One service's unit tests (`voice`, `money`, `family`, `delivery`) |
| `pnpm e2e` | The cross-service scenarios against the running services. Requires `DELIVERY_PROVIDER=mock` |
| `pnpm e2e:10` | Ten passing end-to-end runs in a row |
| `pnpm e2e:selftest` | The end-to-end tests themselves, against an in-memory fake of every service |

When `pnpm e2e` fails it writes `e2e/reports/latest.md`, grouping each failure under the part of the system that owns it.

---

## 9. How it fits together

Five parts share one Postgres database. Each writes only its own schema and talks to the others over HTTP with a shared secret.

| Part | Port | Job |
|---|---|---|
| voice | 4001 | Rose's calls. Understands what she says, reads orders back, and only buys after a clear yes. Runs check-in calls to a family member's stored number |
| money | 4002 | The fraud check (hard rules, scam patterns, "unusual for Rose", family patterns), holds, cooling-off, passkey release, and payments |
| family | 4003 | The circle, the family phone messages, reminders and nudges, fraud cards, and scheduling family calls |
| delivery | 4004 | Grocery quotes and carts. The only part that talks to DoorDash, and only for orders money has approved and paid |
| web | 3000 | Every screen. The browser never talks to the services directly; the web server adds the secret |

A grocery order, end to end: Rose asks, voice builds the list, money prices it from a delivery quote and runs the fraud check, Rose confirms the read-back, money pays, delivery builds the cart, and the family phones show the order and its status.

### Rules the whole system follows

- Nobody under 18 is ever a member, messaged, or called.
- Anything Rose asks to "keep between us" is removed before it reaches the family.
- The AI never impersonates a family member and never clones a voice.
- Check-in calls use the phone number stored in the circle, never one a caller gives.
- Hard fraud rules are plain code; no AI output can override them.

### Team

| Folder | Owner |
|---|---|
| `services/voice/` | Agent 1, Jayden |
| `services/money/` | Agent 2, Arpit |
| `services/family/`, `services/delivery/` | Agent 3, Andy |
| `apps/web/`, `packages/contracts/`, `e2e/`, `scripts/` | Agent 4, Claire |
