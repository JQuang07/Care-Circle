# Agent 2 · Money & Fraud (Arpit)

## Current branch and scope

Branch `arpit`. The mistaken Agent 4 integration was reverted in `0021c99`, restoring the previous arpit contents exactly. Common main setup was reapplied in `c30b0db`. All subsequent application changes are confined to `services/money/`; Jayden and Claire feature branches were not reapplied. The shared secret is configured only in ignored `.env`.

## Completed from new/agent-2-money.md

- **D15:** MOCK controls external providers; family requests/events use actual HTTP unless MOCK_DEPENDENCIES=1 or FAMILY_URL is missing. PostgreSQL is selected whenever DATABASE_URL is set. Mock payments still run all deterministic fraud gates.
- **D9:** authenticated GET /orders/:id, contract-shaped 404, grocery quotes before fraud assessment, fee-inclusive totals and matched unit prices. Invalid/expired/inconsistent quotes are rejected. Unreachable delivery falls back to known FreshMart prices without quoteId. Unresolved items block payment; their original names remain visible to fraud rules.
- **D14:** authenticated, validated, idempotent delivery callbacks persist fulfilment.delivery; backward status updates and mismatched delivery IDs are rejected/ignored. Paid quoted orders dispatch asynchronously with the exact charged amount. Failures are logged without undoing payment; repeated confirmation does not re-dispatch.
- **Fraud regression:** a $200 Apple gift card through a DoorDash grocery quote triggers GIFT_CARD_NONMEMBER. Fallback/unmatched items retain the same protection.
- **D6/D7/D8:** contact history accepts boolean values; Mia's $25 bakery gift through Lisa is low-risk and paid; verbal cancellation works; high-risk/hard-stop release requires the existing simulated passkey verification.
- **D1:** authenticated reset restores seed ledger and clears money orders/holds. PostgreSQL reset is transactional and limited to money's schema.

## Validation · 2026-09-26

- Money tests: **132 passed**, one PostgreSQL integration test skipped because TEST_DATABASE_URL is unavailable.
- All-workspace typecheck: passed.
- Fraud evaluation: **12/12 scams caught; 1 false high hold** (maximum allowed 2). See services/money/eval/results/latest.json. Medium-risk scenarios count as detected; this is not a claim that all 12 receive hard stops.
- Health: voice, money, family, delivery and web all passed.
- Actual local HTTP integration with in-memory stores, real neighbor services and mock external providers: **passed**. Grocery quote $14.55 → paid → delivery dry_run_complete → delivered callback; Lisa add_to_order received. Scam held/hardStop → Danny fraud_card → verbal cancel. Mia through Lisa low → paid.
- Reproduce the direct HTTP check from repo root with services running: `node --env-file=.env services/money/src/scripts/integration-check.mjs`. Run separately from E2E because both mutate Rose's state.

## Remaining dependencies

- **Task 9 shared contracts:** origin/main (`63320fe`) still exports literal-false ContactRhythm and lacks D14 fulfilment/delivery shapes. Keep addendum-compatible local types until Agent 4's updated shared package lands on main; then replace duplicated shapes with @care-circle/contracts imports and add its workspace dependency. This task is pending, not claimed complete.
- **Docker/PostgreSQL:** Docker Desktop and Docker CLI were not available on this Mac. Configured PostgreSQL startup/seed/reset are not runtime-verified in this session. Local integration used an explicit process-only empty DATABASE_URL; saved .env retains the database configuration.
- **Voice-dependent E2E 1/3/4:** current main voice code still needs Agent 1's fixes. See below. Direct money flows pass without relaxing fraud/payment rules.
- Optional real-provider checks need Stripe test/Muse keys; Visa adapter is not implemented. No live payment, delivery checkout, or phone call was made. Passkey verification remains the existing simulated demo implementation.

## BUGS FROM INTEGRATION

- **E2E 1, Agent 1 dependency:** voice drafts a single item named `milk, eggs, and bread`. Delivery cannot match that as one product; money correctly records unmatchedItems and refuses payment. Voice should send separate resolved items and apply the D16 confirmation flow.
- **E2E 3, Agent 1 dependency:** the scam is held and the family fraud card is emitted, but POST voice /demo/simulate-verification returns 404. Direct verbal cancellation through money passes.
- **E2E 4, Agent 1 dependency:** voice sends Mia's $25 gift as amountCents=50000 with no parent recipient. Money correctly holds it. The same scenario with amountCents=2500, merchantId=mer_crumb, recipientMemberId=mem_lisa passes.
- Delivery posts callbacks to both money and family. Money receives them; baseline family's /webhooks/delivery-status still returns 404 (Agent 3 follow-up).

## Existing contract/product limitations

- Rail detection uses item names/payee description because OrderRequest has no explicit payment rail.
- Surprise secrecy causes the one false high hold (surprise cake); no Layer-1 rule was weakened.
- Real WebAuthn needs credential registration/challenge work. Current demo assertion is `{ credentialId: "cred_<memberId>", holdId, signature }`.
- Relationship history has no recent emergency/financial-mention feed. A claimed relative is suggested as verifier only if isVerifier is true; otherwise a known verifier is selected.
