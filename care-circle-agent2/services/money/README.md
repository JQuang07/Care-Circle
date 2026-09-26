# money · Agent 2 (:4002)

Orders, the family-funded credential, payments, and the four-layer fraud engine.

```bash
pnpm install
MOCK=1 pnpm dev            # canned data, no DB, no keys
pnpm dev                   # real engine; in-memory store unless DATABASE_URL is set
pnpm test                  # 115 tests (add TEST_DATABASE_URL for the Postgres test)
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
