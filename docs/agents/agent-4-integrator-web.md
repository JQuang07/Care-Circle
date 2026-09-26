# Agent 4 · Integrator + Web (Claire): next phase
**Branch `claire` · root config, `packages/contracts/`, `apps/web/`, `e2e/` · port 3000 · status `status/AGENT-4.md`**

**Read first:**
- `CONTRACTS.md` and `docs/CONTRACTS-ADDENDUM.md`
- your original brief `agent-4-integrator-web.md`
- `docs/INTEGRATION-REPORT.md`

## ⚠️ Before you pull `main`
The integration stopped tracking your root `CLAUDE.md`. Save it first:
```cmd
copy CLAUDE.md CLAUDE.local.md
git fetch origin
git merge origin/main
pnpm install
```
`CLAUDE.md` and `CLAUDE.local.md` are now in the root `.gitignore`. Keep your role in `CLAUDE.local.md`.

## Where you are
- Scaffold, contracts package, web (every route builds), E2E suite, and the fake-stack self-test (5/5) are all done.
- The integration added a root `.gitignore` and `.env.example`, which **you own now**, and removed the duplicate `AGENT-4.md` and `CONTRACTS copy.md`.

## Tasks, in order
1. **Contracts package:** apply the addendum:
   - D5 action payloads, D6 `boolean`, D7 `birthday`, D9 `Order.fulfilment`
   - D11 fields and bodies, D14 delivery types (`Quote`, `QuoteLine`, `DeliveryOrder`)

   Update the zod schemas and drift guard. Push fast, because three agents import these.
2. **Workspace:** add `@care-circle/delivery` (port 4004) to `pnpm dev`, `dev:services`, `health`, `seed` (order: family → money → delivery → voice), and the `/demo/reset` chain. Add the D14 env vars to `.env.example` with `DELIVERY_PROVIDER=mock` and `DOORDASH_LIVE_CHECKOUT=0`.
3. **E2E:**
   - Switch to the addendum's endpoints (D1–D5).
   - Add the delivery mock to the self-test fake stack.
   - Extend E2E 1: paid grocery order → delivery order in `dry_run_complete` → advance → `delivered`.
   - **E2E always runs with `DELIVERY_PROVIDER=mock`**; refuse to run if it isn't mock.
4. **Web:**
   - Dashboard and family phones show the delivery status: store name, ETA, tracking link, and a **"DRY RUN"** badge when not live.
   - The grocery read-back card shows `unmatchedItems`.
   - `/call/:id` uses family `GET /schedule/calls/:id/join`.
5. **Demo panel, DoorDash controls:**
   - "Quote groceries (DoorDash)" shows the quote.
   - "Place real order" is visible **only** when delivery `/health` reports `liveCheckout: true`. It requires typing `PLACE REAL ORDER`, calls `/orders/:id/checkout` through the server-side proxy (which adds `X-CC-Secret`), and shows the amount and store before confirming.
   - Never expose `X-CC-Secret` or the delivery checkout route to the browser directly.
6. **Integration duty:** after each checkpoint merge, run `pnpm e2e` against the live services and file failures under `## BUGS FROM INTEGRATION` in the owners' status files.
7. Voice-note recording/upload (your planned item), then the final README (H62): architecture, **mock vs. real table (state plainly that DoorDash is an unofficial integration)**, how to run, team.

## Definition of done
- [ ] Contracts package matches CONTRACTS + addendum (drift guard green)
- [ ] `pnpm dev` runs 5 services + web; `pnpm health` shows 5 green
- [ ] E2E 1–5 pass against the live services with delivery on mock
- [ ] The live-order button is impossible to press by accident (typed confirmation, and hidden unless live)

## Kickoff prompt
> You are Agent 4. Read CLAUDE.local.md, docs/agents/agent-4-integrator-web.md, docs/CONTRACTS-ADDENDUM.md, and docs/INTEGRATION-REPORT.md. Do task 1 (contracts package) first and push to origin claire immediately, then continue in order, pushing after each task. Keep status/AGENT-4.md updated. Don't touch services/** code; report bugs in status files. Only stop for decisions the addendum doesn't cover.
