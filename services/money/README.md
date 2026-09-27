# money · Agent 2 (:4002)

Orders, the family-funded credential, payments, and the four-layer fraud engine.

```bash
pnpm install
MOCK=1 pnpm dev            # external providers mocked; real fraud checks and neighbor HTTP
pnpm dev                   # DATABASE_URL selects Postgres in either mode; otherwise memory
pnpm test                  # add TEST_DATABASE_URL for the Postgres integration test
pnpm eval                  # 24 scenarios → confusion matrix → eval/results/latest.json
EVAL_LAYER2=muse pnpm eval # same, with real Muse for Layer 2
```

| Path | What |
|---|---|
| `src/fraud/layer1.ts` | Hard rules. Deterministic; nothing overrides them. |
| `src/fraud/layer2.ts` | Scam-story classifier (Muse, validated) + offline fallback |
| `src/fraud/layer3.ts` | Rose's personal baseline |
| `src/fraud/layer4.ts` | Relationship signal from family's contact rhythm |
| `src/fraud/combine.ts` | Score, risk, action. Thresholds live here (freeze at H62). |
| `src/fraud/assess.ts` | Runs all four layers → `FraudAssessment` |
| `src/service.ts` | Orders, holds, passkey release, cooling-off |
| `src/payments.ts` | mock / Stripe test mode / Visa slot |
| `src/seed.ts` | Contract seed + Rose's 60-day history |

Env: see `.env.example`. Status and open contract requests: `status/AGENT-2.md`.

## Local integration

Use the repo-root `.env`: `MOCK=1`, `MOCK_DEPENDENCIES=0`, family and delivery URLs,
and the shared `CC_INTERNAL_SECRET`. Never commit `.env`.

From the repo root, with all services running:

```bash
node --env-file=.env services/money/src/scripts/integration-check.mjs
```

This creates demo orders and checks grocery pricing → payment → dry-run delivery →
delivered callback, Lisa's add-to-order message, Danny's fraud card/cancel, and Mia's
gift through Lisa. It requires mock payments and mock delivery with live checkout off.
Run it separately from E2E: both suites mutate Rose's state.

Money exposes authenticated `GET /orders/:id`, `POST /webhooks/delivery-status`, and
`POST /demo/reset`. Reset restores only money's seeded ledger and clears its orders/holds.
Grocery quotes include delivery fees; unknown/ambiguous items block payment. If delivery
is unreachable, known FreshMart catalogue items use local prices without a quote ID.
Delivery dispatch is asynchronous after payment; failures are logged and leave payment paid.

Shared D6/D14 contract migration awaits the updated package on main: the current main
package still types `everAskedForMoney` as literal `false` and lacks fulfilment types.
