# Integration Report v2: branch `integration-v2`
*Fresh merge from `main`: `claire` (Agent 4) → `andy` (Agent 3) → `jayden` (Agent 1) → `arpit` (Agent 2), plus the new delivery service.*

**Team:** jayden = Agent 1 (voice) · arpit = Agent 2 (money) · andy = Agent 3 (family + delivery) · claire = Agent 4 (integrator + web)

## 1. Results

| Check | Result |
|---|---|
| Fresh install + `pnpm typecheck` (all packages) | ✅ |
| Money tests (Agent 2) | ✅ 114 passed, 1 skipped (Postgres) |
| Family tests (Agent 3) | ✅ 78 passed, 1 skipped (Postgres) |
| Voice tests (Agent 1) | ✅ 35/35 |
| **Delivery tests (new)** | ✅ 15/15 (every safety gate, plus the DoorDash tool mapping) |
| E2E self-test (fake stack) | ✅ 5/5 |
| `pnpm health` with the live services | ✅ voice, money, family, delivery (web not started in that run) |
| **Delivery ↔ real DoorDash MCP server** | ✅ Connected over HTTP; all 10 tools found; login check answered "not logged in" (no account yet) |
| **Cross-service delivery flow** | ✅ quote (with fees) → delivery refuses the unpaid order → money confirms → delivery `dry_run_complete` → simulated `delivered` → events reached money and family |
| **Real E2E against the live services** | ❌ 0/5. Four causes, each assigned below |

## 2. What the merge changed

| Change | Why |
|---|---|
| Kept Agent 3's and Agent 1's real service files over Agent 4's placeholder skeletons | The skeletons were placeholders |
| **Moved Arpit's `care-circle-agent2/services/money` → `services/money`, and his status file → `status/AGENT-2.md`** | His web upload nested the service in a new folder the workspace couldn't see |
| Added a money `seed` script (`src/scripts/seed-cli.ts`) | The root `pnpm seed` calls every service's `seed` |
| Removed the npm lockfiles in family and voice | This is a pnpm workspace |
| Root `.gitignore` + `.env.example`; untracked Claire's committed root `CLAUDE.md`; removed the duplicate `AGENT-4.md` and `CONTRACTS copy.md` | Repo hygiene; four different root `CLAUDE.md` files would conflict at every merge |
| **New `services/delivery` (:4004)**, registered in `pnpm dev`, `dev:services`, `health`, `seed`; new `pnpm dd:check` | D14: the DoorDash integration |

No other agent's application code was changed.

## 3. Why the real E2E fails, and who fixes it

| # | Symptom | Cause | Owner (task) |
|---|---|---|---|
| 1 | E2E 1: the grocery order stays `approved`, never `paid` | Voice only accepts a bare "yes"; *"Yes, that's everything. Please go ahead…"* is ignored | Agent 1 (task 1, D16) |
| 2 | E2E 3/5: no fraud card, no family messages | With `MOCK=1`, money uses a fake family and never sends events | Agent 2 (task 1, D15) |
| 3 | E2E 2: the proposal never reaches Rose | Family waits for **all** invitees, including Mark | Agent 3 (task 1, D10) |
| 4 | E2E 4: "false hold" | The test picked up E2E 3's scam order | Agent 4 (task 2) |
| 5 | Delivery events → 404 | Money and family don't have `/webhooks/delivery-status` yet | Agent 2 (task 3), Agent 3 (task 5) |

## 4. The four runbooks
Each teammate follows `docs/agents/COMMON-SETUP.md`, then their own file. Each file has an ordered task list, verification commands, a "service is up" checklist, their DoorDash part, and a kickoff prompt.

| Person | File | Critical first task |
|---|---|---|
| Jayden | `docs/agents/agent-1-voice.md` | D16 confirmation fix |
| Arpit | `docs/agents/agent-2-money.md` | D15 mock semantics (events to family); **git, not web uploads** |
| Andy | `docs/agents/agent-3-family.md` | D10; delivery webhook; connect DoorDash (Part 4) |
| Claire | `docs/agents/agent-4-integrator-web.md` | Save `CLAUDE.md` → `CLAUDE.local.md` **before pulling**; contracts package |

**When all four finish their Part 1:** `pnpm health` shows 5 green, E2E 1–5 pass against the live services with delivery on mock, and a paid grocery order produces a DoorDash dry-run cart (or a mock one).

## v3 · Demo MVP finish (`integration-v3`, one machine)
Details and open issues: [`docs/FINISH-PROGRESS.md`](FINISH-PROGRESS.md). How to run it: README, "Run the demo".

| Check | Result |
|---|---|
| `pnpm typecheck` (7 packages) | ✅ |
| Unit tests | ✅ voice 55 · family 103 · money 132 (+1 skipped) · delivery 16 · contracts |
| `pnpm demo:run all` (audio clips → Muse Voice Transcribe → Muse → tools) | ✅ 4/4: groceries paid and dry run, family call scheduled, scam hold cancelled by Danny, Mia's gift low risk and paid |
| `/stage` in a headless browser | ✅ 4/4 scenarios reach their event cards, with the family phones live |
| `pnpm e2e`, voice on Muse | 11/13: E2E 1–4 pass. E2E 5's script names no grocery items, so Muse asks instead of guessing |
| `pnpm e2e`, `VOICE_REASONER=mock` | 12/13: E2E 2 fails only because the test used a second voice instance |
| Real DoorDash cart | ❌ Not verified. The MCP server on :3100 rejects the `.env` token with 401. Restart it with the `.env` token (or update `.env`), then restart `pnpm dev` |

Changes to other agents' services are logged in `status/AGENT-1.md` (voice) and `status/AGENT-4.md` (web).
