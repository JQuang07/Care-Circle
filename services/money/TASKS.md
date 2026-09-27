# Agent 2 — Arpit

- [x] D15: mock external providers only; real HTTP family/events by default.
- [x] D9: GET /orders/:id.
- [x] D14: authenticated, idempotent delivery status receiver.
- [x] D9: authoritative delivery grocery quotes with FreshMart fallback.
- [x] D14: dispatch delivery only after payment, exact charged amount.
- [x] Gift-card grocery-rail fraud regression.
- [x] D6/D7/D8: history boolean, Mia through Lisa, cancel/release safeguards.
- [x] D1: authenticated money reset and seed.
- [ ] Shared contract imports: waiting for Agent 4's D6/D14 package on main (main remains 63320fe).
- [x] Money tests (132 pass), workspace typecheck, fraud eval (12/12, 1 false high).
- [x] Actual HTTP grocery/payment/delivery/family/scam/Mia integration and all five health checks (memory stores, mock providers).
- [ ] PostgreSQL runtime validation: Docker unavailable; optional integration test skipped.
- [ ] Voice E2E 1/3/4 green: blocked by main's Agent 1 parser, confirmation, and verification-endpoint gaps; details in status/AGENT-2.md.

After each implementation task: money tests, update status, commit, push arpit, fetch main and check HOLD.md.
