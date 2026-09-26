# Integration Report: all branches → `integration`
*Merged: `claire` (Agent 4) → `andy` (Agent 3) → `jayden` (Agent 1) → `arpit` (Agent 2), on top of `main`.*

## 1. Result at a glance

| Check | Result |
|---|---|
| `pnpm install --frozen-lockfile` from a fresh clone | ✅ |
| `pnpm typecheck` (all packages) | ✅ |
| Family tests (Agent 3) | ✅ 78 passed, 1 skipped (Postgres test needs a DB) |
| Voice tests (Agent 1) | ✅ 35/35 |
| Money tests (Agent 2) | ✅ 74/74 (Layer 1 + combine only) |
| Contracts self-test | ✅ |
| Web build (`pnpm build:web`) | ✅ All routes compile |
| E2E self-test (fake stack) | ✅ 5/5 |
| `pnpm health`, live services, `MOCK=1` | ✅ voice, money, family green (web not started in that run) |
| **Real E2E against the merged services** | ❌ **0/5.** See §3. Expected at this stage: money has no endpoints yet. |

**Team mapping:** jayden = Agent 1 (voice) · arpit = Agent 2 (money) · andy = Agent 3 (family) · claire = Agent 4 (integrator + web)

## 2. What the merge changed (beyond combining branches)

| Change | Why |
|---|---|
| Kept Agent 3's and Agent 1's real `package.json`, `index.ts`, `tsconfig.json`, and status files over Agent 4's placeholder skeletons | The skeletons were placeholders "for owners to replace" |
| Deleted `services/family/src/seed.ts` (skeleton) | Agent 3's seed lives at `src/scripts/seed.ts` |
| Deleted `services/family/package-lock.json` and `services/voice/package-lock.json` | The repo is a pnpm workspace; npm lockfiles fight `pnpm-lock.yaml` |
| Deleted root `Combine.ts`, `Layer1.ts`, `Layer1test.ts`, `Types.TS` (arpit) | Older browser-uploaded copies of `services/money/src/fraud/*` |
| Added `test` script + vitest to `services/money/package.json` | Agent 2's tests had no runner in the workspace |
| Added root `.gitignore` | There wasn't one; `node_modules`, `.env`, and build output were all trackable |
| **Untracked root `CLAUDE.md`** (claire had committed her Agent 4 brief there) | Four different root `CLAUDE.md` files would conflict at every merge |
| Deleted root `AGENT-4.md` (identical to `status/AGENT-4.md`) and `CONTRACTS copy.md` (identical to `CONTRACTS.md`) | Duplicates cause confusion over which one is "the law" |
| Added root `.env.example` | The README tells people to copy it, but it didn't exist |
| Untracked `apps/web/tsconfig.tsbuildinfo` | Build artifact that changes on every build |
| Refreshed `pnpm-lock.yaml` | Covers the real voice and family dependencies |

**No application code was changed** in any agent's service.

## 3. Why the real E2E fails (and who fixes what)

| Scenario | First failure | Owner |
|---|---|---|
| E2E 1 grocery, 3 scam, 4 Mia gift, 5 privacy | `money GET /orders?seniorId=sen_rose → 404`. **Money has no endpoints yet.** | **Agent 2** |
| E2E 2 schedule | Voice → family `/schedule/request` works, and Lisa and Danny get 3 slot buttons and accept. But the proposal never reaches `awaiting_senior`, because family invited **Mark too** (all members, when none are named) and waits for **every** invitee. The test expects Lisa + Danny to be enough. | **Coordinator decision** (§5, D10), then Agent 3 |
| E2E 2 (warning) | Slot buttons carry no `slot` object, so the web can't show local times (Agent 4's CCR-05) | Agent 3 (cheap to add) |

## 4. Next steps per agent

### Agent 2 · Arpit (money): **the critical path. Everyone else is blocked on you.**
1. **Stop uploading files through the GitHub website.** Commit with git from your cloned repo folder (`git add -A`, `git commit`, `git push origin arpit`). Web uploads created the duplicate root files.
2. **Merge `main` after this integration lands**, and run `pnpm install` at the root.
3. **Phase 1 stubs NOW** (`MOCK=1`, canned data per CONTRACTS §4): `/fraud/assess`, `/orders/draft`, `/orders/:id/confirm`, `/orders?seniorId=`, `/holds/:id/resolve`, `/holds?seniorId=`, `/credentials/:seniorId`, `/eval/results`. This alone unblocks E2E 1, 3, 4, and 5 against real services.
4. **Seed:** credential + 60 days of order history + **a simple FreshMart price list** (so voice never invents totals; Agent 1's CCR-6).
5. **Wire the fraud engine into the endpoints:** Layer 1 (done) → Layer 3 baseline → Layer 4 (family `/contact-rhythm` is **live now**) → Layer 2 Muse. Holds + cooling-off + events (`order.paid`, `fraud.hold_created`, `fraud.hold_resolved`) to family.
6. Replace `src/fraud/types.ts` with imports from `@care-circle/contracts`.
7. **Coordinator: consider rebalancing.** Agent 3's core is done and waiting. With Arpit's OK, Agent 3's Claude could build the money *mock stubs + seed + eval JSON* on a separate branch while Arpit's Claude does the real engine.

### Agent 1 · Jayden (voice)
1. **Live spike, which is still unverified:** Twilio + tunnel + Deepgram + Muse, and measure real latency (the ≤1.5s target is untested).
2. Implement Agent 4's **CCR-03** (`GET /demo/calls`) and **CCR-04** (`POST /demo/simulate-verification`). E2E 2 and 3 need them.
3. `POST /demo/reset` (CCR-01).
4. **Team secret:** voice refuses `CC_INTERNAL_SECRET` shorter than 24 characters. Everyone must use the same long secret.
5. After money stubs land: run with `MOCK_DEPENDENCIES=0` against real money and family, and verify the scam → verification call → cancel flow.
6. SIP dial-out bridge: still unverified. Decide on Plan A vs. Plan B (tablet) by H44.

### Agent 3 · Andy (family)
1. **Fix E2E 2 once the coordinator decides D10** (who must accept). Suggested rule: a proposal is ready when every *named* member accepts; when none are named, when **≥2 invitees accept a common slot**. Anyone who hasn't answered stays invited and gets the join link.
2. Put `slot: Slot` (and `proposalId`, `slotId`) in each slot button's payload (Agent 4's CCR-05).
3. Switch `src/contracts-local.ts` to `@care-circle/contracts` (it exists now).
4. Config: drop the `env.PORT` fallback. Use only `FAMILY_PORT ?? 4003`, so a stray `PORT` in the root `.env` can't move family onto voice's port.
5. Update the README/status for the pnpm workspace (`pnpm --filter @care-circle/family dev|test`); npm lockfiles are gone.
6. **Your Postgres blocker (Windows):** a native PostgreSQL service owns port 5432. In an **admin** CMD, run `net stop postgresql-x64-16` and `net stop postgresql-x64-17`, then `docker compose up -d --wait` from the repo root, with `DATABASE_URL=postgres://cc:cc@localhost:5432/care_circle`.
7. Align demo endpoints with Agent 4: you built `/demo/time-travel`; they call `/demo/fire-due`. Decision D2 picks one. Easiest: you add `/demo/fire-due` as a thin alias.
8. Then you're free for the v1.1 packets (UPDATE-GUIDE.md), or to help Agent 2 (above).

### Agent 4 · Claire (integrator + web)
1. **Before pulling `main`:** copy your root `CLAUDE.md` to `CLAUDE.local.md`. The merge untracks `CLAUDE.md`, and pulling may delete your local copy.
2. Re-run `pnpm e2e` against the integrated services after money stubs land. File results in the status files.
3. Reconcile your CCRs with Agent 3's (they overlap: reset, fast-forward, action payloads, `/moments?week=`). One list for the coordinator.
4. `/call/:id`: use family's LiveKit join endpoint (Agent 3's CCR-1).
5. Voice-note recording/upload (your planned next step).
6. Own the root `.env.example` and `.gitignore` added here, and adjust as needed.

## 5. Coordinator decisions needed (consolidated CCRs)

| # | Decision | Recommendation |
|---|---|---|
| D1 | Demo reset on every service (A4 CCR-01; family already has it) | Approve |
| D2 | Fast-forward: `/demo/fire-due` (A4) vs. `/demo/time-travel` (A3) | Keep both; family adds the alias |
| D3 | Voice demo call log + scripted verification (A4 CCR-03/04) | Approve; Agent 1 builds |
| D4 | Reminder vs. due discriminator (A1 CCR-1, A3 CCR-3) | Add a `phase: "reminder" \| "due"` field to the webhook body (additive) |
| D5 | Message action names + payloads (A4 CCR-05, A3 CCR-8) | Adopt one table; slot buttons carry `{ proposalId, slotId, slot }` |
| D6 | `everAskedForMoney`: literal `false` → `boolean` (A4 CCR-06) | Approve |
| D7 | Mia's gift (A1 CCR-3, A4 CCR-08) | Add `birthday` to dependents; a gift for a dependent routes via the parent (`recipientMemberId: mem_lisa`) and doesn't trip the non-member gift-card rule |
| D8 | Cancel a hold from the app without a passkey (A3 CCR-4) | Approve (cancel is always allowed) |
| D9 | Authoritative prices (A1 CCR-6) | Money owns a FreshMart price list now; the full catalog comes with v1.1 Packet A |
| D10 | **Who must accept a schedule proposal** (new, from this run) | Named members; otherwise ≥2 accepts on a common slot |
| D11 | Additive fields: `CallEnded.scheduledCallId`, ride `scheduledFor`, `seniorHints`, family LiveKit join + proposal-by-id endpoints (A3 CCR-1/2/5/6) | Approve |
| D12 | `/moments?week=` format (A3 CCR-7, A4 CCR-09) | ISO week in Rose's time zone; omitted means the current week |
| D13 | Shared secret | One ≥24-character secret for the whole team, shared privately |

After deciding, the coordinator edits `CONTRACTS.md` once, and everyone pulls.

## 6. v1.1 update timing
Apply the v1.1 update (UPDATE-GUIDE.md) **after Agent 2's stubs are in and E2E 1 passes against the real services.** Packet A is heaviest on money, which is behind. If money is still catching up at H30, apply Packet A to Agents 1, 3, and 4 only, or defer it.
