# CLAUDE.md — Agent 2 · Money & Fraud
You are one of four Claude agents building **Care Circle** in parallel on separate computers. You cannot talk to the other agents. You coordinate through `CONTRACTS.md` (read it first, fully) and your status file.

## Your mission
Own every dollar: the family-funded credential, orders, payments, and the **four-layer AI fraud engine**. This is the product's core Visa story. The engine must catch scams without making Rose feel policed.

## You own
- `services/money/**`, DB schema `money`, `status/AGENT-2.md`
- Seeding Rose's 60-day order history (realistic: weekly FreshMart around $40–70, a monthly CornerRx refill, occasional RideMock rides, a bakery treat now and then)
- **Do not touch** any other folder. Contract changes go through a `CONTRACT CHANGE REQUEST` in your status file.

## Stack
- Fastify + Postgres (`money` schema)
- Payments: `PAYMENTS_PROVIDER=visa` → Visa Intelligent Commerce sandbox (scoped agent credential, caps, passkey). `stripe` → Stripe test mode fallback. **Wire the Stripe fallback in Phase 0 regardless.**
- Muse Spark via the `openai` SDK for layer 2, using structured output (JSON schema)

## The fraud engine
`assess(req: OrderRequest): FraudAssessment` is a pure function plus lookups, used by both `/fraud/assess` and `/orders/draft`.

**Layer 1 — hard rules (deterministic; a model can never override these).** Any hit sets `hardStop: true` and `recommendedAction: "hold"`.
- Gift cards where `recipientMemberId` is missing or not a circle member → `GIFT_CARD_NONMEMBER`
- Category in `blockedCategories` (wire, crypto, money_transfer) → `BLOCKED_CATEGORY`
- `merchantId` missing (a new or unknown payee) with amount > $50 → `NEW_PAYEE`
- Amount > per-purchase cap, or would exceed the monthly cap → `OVER_CAP`
- Secrecy language in the context ("don't tell," "keep it secret," "between us and the bank") → `SECRECY`
- Cash courier ("someone will pick up the cash") → `CASH_COURIER`. It can't be blocked as a payment, but it **must** alert family.

**Layer 2 — scam-story classifier (Muse).** Input: `statedReason`, `transcriptExcerpt`, `claimedRelative`, items, payee. Output: `{ typology, confidence 0–1, cues: string[] }`.
- Typologies are in CONTRACTS §3. Grounding cues: urgency, secrecy, authority claims (IRS, Medicare, bank, police), prize/"you've won," tech-support remote access, a new online romantic interest, guaranteed returns, "don't call your family."
- Weight: `confidence × 40`.

**Layer 3 — personal baseline.** From Rose's history:
- Merchant never used → +10
- Amount > 5× her median → +15
- Request outside her usual hours (before 7am or after 10pm local) → +10
- Category new to her → +10

**Layer 4 — relationship signal.** Call `GET family /contact-rhythm/sen_rose`.
- Claimed relative is **not** in the circle → +15
- Claimed relative **is** in the circle, but `everAskedForMoney` is false and the "emergency" isn't mentioned anywhere → +15, and set `suggestedVerifierId` to that member.
- Otherwise `suggestedVerifierId` is the most recently contacted verifier.

**Combining:**
- `score = min(100, sum)`
- Risk: `high` if `hardStop` or score ≥ 60, `medium` if 30–59, otherwise `low`
- Action: `high` → `hold`; `medium` → `verify_with_family`; `low` → `proceed`

**Messages (generate with Muse, then validate length and tone):**
- `seniorFacingMessage`: warm, ≤2 sentences, never says "scam," "fraud," or "you're being tricked." Example: *"This looks like a trick a lot of people get calls about. Let's check with Danny before we send anything."*
- `familyFacingSummary`: plain English with the top 3 signals. Example: *"Rose was asked for $500 in gift cards by someone claiming to be Danny, with 'don't tell your mom' language. Danny last called Sunday and has never asked for money. We paused it and called Danny."*

**The tricky legit case must pass:** a $25 gift card for Mia's birthday. Mia is Lisa's dependent, so model it as `recipientMemberId: "mem_lisa"` with the note "for Mia." The birthday is in the seeded context and the amount is normal → `low`.

## Holds
- `/orders/draft` with high risk → create a `Hold` with `coolingOffUntil = now + 24h` and emit `fraud.hold_created`.
- `/holds/:id/resolve`:
  - `cancel` is always allowed.
  - `release` on a high-risk hold **requires** `method:"passkey_web"` plus a passkey assertion. In Stripe fallback mode, simulate the passkey step but keep the rule.
  - Emit `fraud.hold_resolved`.
- When the cooling-off period expires with no decision, status becomes `expired_cooling_off` and the order is cancelled. **Never auto-release.**

## Eval set (build it; the demo panel shows the score)
Put 24 scenarios in `services/money/eval/*.json`:
- **12 scams:** 3 grandparent-impostor variants (one with a voice-clone "it sounded exactly like him"), government/Medicare, IRS, tech support ("Microsoft called, needs $300 in gift cards to fix my computer"), prize/lottery, romance, investment "guaranteed 20%," cash courier, bank impostor ("move your money to a safe account"), charity after a disaster.
- **12 legit:** weekly groceries, pharmacy refill, ride to the doctor, bakery cake for Mark, Mia's birthday gift card, a larger-than-usual Thanksgiving grocery order, a new merchant for a normal amount ("that new farm stand"), a gift for Lisa, and so on.

`pnpm eval` prints the confusion matrix. **Target: 12/12 scams caught (medium or high), ≤2 legit held as high.** Log each run to `/eval/results`.

## Milestones
- **H0–3:** Visa sandbox auth (or document the blocker and use Stripe). Layer 1 module with unit tests.
- **H3–8:** all endpoints stubbed in `MOCK=1`, with canned `FraudAssessment` examples for low, medium, and high.
- **H8–30:** real orders, caps, payments. Layer 3 on seeded history. `order.paid` event.
- **H30–50:** layers 2 and 4, holds, resolution, cooling-off, events, eval set.
- **H50–62:** tune thresholds on the eval set until the targets hold. Freeze thresholds at H62.

## Definition of done
- [ ] Every Layer-1 rule has a unit test proving a model can't bypass it
- [ ] Eval: 12/12 scams caught, ≤2 false high holds; results visible at `/eval/results`
- [ ] Scam flow end to end with Agent 1's verification call (cancel)
- [ ] High-risk release only works via passkey
- [ ] A payment appears in the Visa sandbox (or Stripe test) with a receipt URL

## Status file format (`status/AGENT-2.md`)
`## Done` · `## In progress` · `## Blocked on` · `## CONTRACT CHANGE REQUESTS` · `## BUGS FROM INTEGRATION` · `## Eval results log`
