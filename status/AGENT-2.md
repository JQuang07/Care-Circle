D9 order lookup implemented, including authenticated access and contract-shaped 404; money tests pass.

# Current Agent 2 integration — arpit

- Mistaken Agent 4 integration was reverted in 0021c99. Common main setup reapplied without Agent 4/Jayden feature branches.
- D15 complete: MOCK=1 uses real family HTTP/events unless MOCK_DEPENDENCIES=1; configured Postgres is used in mock mode too. Mocking providers no longer replaces deterministic fraud checks with canned assessments.
- Validation: 117 tests passed, 1 Postgres test skipped; money typecheck passed.
- Shared secret configured in ignored .env. Docker/Postgres and live providers remain unverified.

# AGENT-2 · Money & Fraud — status

## Done
- `services/money` Fastify service on :4002, every endpoint in CONTRACTS §4 (money), `/health`, `X-CC-Secret` auth, contract error shape.
- `MOCK=1`: in-memory store, mock payments, seed family data, canned low/medium/high `FraudAssessment`s (header-free guess from the request).
- Fraud engine, all 4 layers + combine exactly per spec (L2 = confidence × 40; L3 +10/+15/+10/+10; L4 +15/+15; medium ≥30, high ≥60 or hard stop).
  - Layer 1 is pure code; tests prove no model output (0, negative, NaN, garbage) can bypass any rule.
  - Layer 2 uses Muse via the openai SDK with a JSON schema. Output is validated/clamped; on error or bad output it falls back to an offline cue-based classifier (never to "safe").
  - Senior/family messages: Muse-drafted, validated (≤2 sentences, no "scam/fraud/tricked"), template fallback per field.
- Orders: draft → approved/held, confirm → paid + receipt URL, caps re-checked at payment, paid orders feed the baseline.
- Holds: 24h cooling-off, `fraud.hold_created` / `fraud.hold_resolved` events to family, cancel always allowed, high-risk release only via `passkey_web` + valid assertion, expiry → `expired_cooling_off` + order cancelled (never auto-release). Sweeper runs every 60s.
- Seed: Rose's 60-day history (weekly FreshMart $40–70, monthly CornerRx, rides, bakery), deterministic, auto-seeded if empty.
- Postgres store in schema `money` (tested against real Postgres 16); in-memory store when `DATABASE_URL` is unset.
- Eval: 24 scenarios in `services/money/eval/scenarios`, `pnpm eval` prints the confusion matrix and logs to `eval/results/`, served at `GET /eval/results`.
- Tests: 115 (vitest). `pnpm test`; set `TEST_DATABASE_URL` to include the Postgres test.

## In progress
- Re-run the eval with real Muse (`EVAL_LAYER2=muse pnpm eval`) once `META_API_KEY` is in the shared .env; tune before H62 freeze.

## Blocked on
- **Visa Intelligent Commerce sandbox**: no sandbox credentials/API docs available to this agent. `PAYMENTS_PROVIDER=visa` logs this and falls back to Stripe test mode. Adapter slot: `src/payments.ts → visaPayments()`.
- **Stripe test key** needed in the shared .env (`STRIPE_SECRET_KEY=sk_test_...`) to put a real test payment + Stripe receipt URL on the board. Without it, payments are mocked.
- **Real WebAuthn**: passkey is simulated (rule enforced, crypto stubbed): assertion must be `{ credentialId: "cred_<memberId>", holdId, signature }`. Agent 4's release button should send exactly that for now. See CCR-3.

## CONTRACT CHANGE REQUESTS
- **CCR-1 · payment rail on OrderRequest.** `OrderType` has no gift_card/wire/crypto. Money currently detects the rail from `payeeDescription` + item names (keywords like "gift card", "Western Union", "bitcoin", "Zelle"). Proposal: optional `paymentMethod?: "card" | "gift_card" | "wire" | "crypto" | "money_transfer" | "cash"` set by voice. Keyword detection would stay as a backstop.
- **CCR-2 · surprise vs. secrecy.** The SECRECY hard stop fires on "it's a surprise, don't tell him" (eval: `legit-04-cake-for-mark-surprise` → false high hold, 1 of our 2 allowed). Options: (a) accept; (b) only hard-stop secrecy aimed at family/bank ("don't tell your mom/family/kids/bank") and let other secrecy add Layer 2 risk. Recommend (b); needs human sign-off since it softens a Layer-1 rule.
- **CCR-3 · passkey challenge.** Real WebAuthn needs `POST /holds/:id/passkey-challenge → { challenge }` and member credential registration (Agent 4). Until approved, simulated as above.
- **CCR-4 · "emergency mentioned anywhere."** Layer 4's "emergency isn't mentioned in any family channel" needs data from family (e.g. `ContactRhythm.perMember[].recentMoneyMentions`). Today any money request claimed by a relative counts as unmentioned. Also: `everAskedForMoney` is typed as literal `false`, so it can never be true.
- **CCR-5 · suggested verifier for non-verifiers.** CLAUDE.md says set `suggestedVerifierId` to the claimed relative; the contract says it must be a member with `isVerifier`. When the claim is Mark (not a verifier) we use the most recently contacted verifier instead. Please confirm.
- **CCR-6 · bank impostor typology.** No `bank_impostor` in `ScamTypology`; bank/"safe account" stories map to `government_impostor`.
- **Note:** README says the phase 4 target is "24/24 scams caught"; the eval has 12 scams (target 12/12).

## BUGS FROM INTEGRATION
_(Agent 4 writes here.)_

## Eval results log
| Run | Layer 2 | Scams caught | False high holds | Result | Note |
|---|---|---|---|---|---|
| 1 | heuristic (offline) | 12/12 | 1 | PASS | only false high: surprise cake (CCR-2). 3 scams (Medicare, prize, charity) are caught at medium by story + new-payee signals alone. |
