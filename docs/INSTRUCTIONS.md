# INSTRUCTIONS.md: what to do now, step by step
*Situation: all four branches are merged into `integration` (see `docs/INTEGRATION-REPORT.md`). The next-phase work for each agent is in `docs/agents/`. The contract decisions are in `docs/CONTRACTS-ADDENDUM.md`. Windows CMD commands throughout.*

| Person | Agent | Branch | Next-phase file |
|---|---|---|---|
| Jayden | 1 · Voice | `jayden` | `docs/agents/agent-1-voice.md` |
| Arpit | 2 · Money & Fraud | `arpit` | `docs/agents/agent-2-money.md` |
| Andy | 3 · Family + Delivery | `andy` | `docs/agents/agent-3-family.md` |
| Claire | 4 · Integrator + Web | `claire` | `docs/agents/agent-4-integrator-web.md` |

**Today's goal:** real E2E tests passing against the live services, not just the fakes. That needs money's endpoints first.

---

## Step 1 · Coordinator: land `integration` on `main` (10 min)
```cmd
cd /d %USERPROFILE%\code\Care-Circle
git fetch %USERPROFILE%\Downloads\care-circle-integration.bundle integration:integration
git push origin integration
```
Then on GitHub, open a **pull request from `integration` into `main`** and merge it. It contains `main`, so it merges cleanly.

Post in team chat:
> "Integration is on main. **Before pulling:** Claire, copy CLAUDE.md to CLAUDE.local.md. Arpit, commit your work with git first. Then follow INSTRUCTIONS.md Step 3."

## Step 2 · Coordinator: accept the contract decisions (15 min)
1. Read `docs/CONTRACTS-ADDENDUM.md`. Every decision there is a recommended default (D1–D14).
2. Edit anything you disagree with, **especially D10** (who must accept a call proposal) **and D14/rule 8** (the third-party DoorDash integration).
3. If you change nothing, the addendum is already on `main` and in force. If you edit it, commit and push to `main`, and tell everyone to pull.

**D14 is a team decision.** It adds an unofficial DoorDash integration that can spend real money, with dry run as the default. Everyone should know that before Andy starts it.

## Step 3 · Everyone: sync your branch (10 min)
```cmd
cd /d %USERPROFILE%\code\Care-Circle
git checkout <your-branch>
git add -A
git commit -m "WIP before integration sync"
git fetch origin
git merge origin/main
pnpm install
```

| Person | Extra step |
|---|---|
| **Claire** | **First:** `copy CLAUDE.md CLAUDE.local.md` (the merge untracks your root `CLAUDE.md`) |
| **Arpit** | From now on, commit with git, **never** by uploading through the GitHub website |
| **Andy** | Stop the native PostgreSQL services (admin CMD: `net stop postgresql-x64-16`, and `-17` too if present) |
| **Jayden** | Nothing extra |

If a merge conflict shows up in a `*.md` file, take `main`'s version:
```cmd
git checkout --theirs <file>
git add <file>
git commit
```

## Step 4 · Everyone: environment (10 min)
```cmd
copy .env.example .env
notepad .env
```
- Set **`CC_INTERNAL_SECRET`** to the team secret: **≥24 characters, identical for everyone**, shared privately. Voice won't start otherwise.
- Keep `MOCK=1`, `DELIVERY_PROVIDER=mock`, and `DOORDASH_LIVE_CHECKOUT=0`.
- Fill in only your own keys (Muse for everyone who calls it; Twilio and Deepgram for Jayden; Stripe/Visa for Arpit).
- **Never add `PORT=`** to the root `.env`.

Start Postgres and check that everything runs:
```cmd
docker compose up -d --wait
pnpm seed
pnpm dev
```
In a **second** CMD window:
```cmd
cd /d %USERPROFILE%\code\Care-Circle
pnpm health
```

## Step 5 · Everyone: point Claude Code at your next-phase file (5 min)
Edit your `CLAUDE.local.md` (it stays local and is never committed) so it reads:
```markdown
# My role: Agent N · <name>
@docs/agents/<your-file>.md
@CONTRACTS.md
@docs/CONTRACTS-ADDENDUM.md
@docs/INTEGRATION-REPORT.md
- My branch: <branch>. I only write inside my folder(s) and status/AGENT-N.md.
- Push only with: git push origin <branch>

## Checkpoint gate
After finishing each task (tests pass, committed, pushed), run:
  git fetch origin
  git show origin/main:HOLD.md
If that succeeds, STOP and tell me "Paused at checkpoint". If it fails, continue.
```
Then start Claude Code, check that the files loaded, and paste the **kickoff prompt** at the bottom of your next-phase file:
```cmd
claude --permission-mode acceptEdits
```
Type `/memory` to confirm the files loaded.

## Step 6 · Order of work (who unblocks whom)

| When | Who | What | Unblocks |
|---|---|---|---|
| **First 2h** | Arpit | Money **stubs** pushed | E2E 1, 3, 4, and 5 against the live services |
| First 2h | Claire | Contracts package updated to the addendum | Everyone's types |
| First 2h | Andy | Family fixes (D10, D5, D2, D4) | E2E 2 |
| First 2h | Jayden | Demo endpoints (D1, D3, D4) | E2E 2 and 3 |
| Next | Andy | **DoorDash spike** (1–2h), then the delivery service on the mock provider | Real prices, dry-run orders |
| Next | Arpit | Real orders, pricing via delivery, fraud layers 3/4/2, holds, eval | The scam demo |
| Next | Jayden | Live phone spike (Twilio + Deepgram + Muse), latency log | The real call |
| Next | Claire | Delivery in workspace scripts, E2E extension, delivery UI, safe live-order button | The demo |

**Next checkpoint:** when Arpit reports "money stubs pushed" **and** Andy reports "family fixes pushed":
1. The coordinator raises HOLD (Step 8).
2. Merge all four branches into `main` through PRs (Claire's first).
3. Run `pnpm e2e`.
4. Release HOLD.

## Step 7 · The DoorDash plan (third-party MCP), in order
1. **Spike (Andy, 1–2h):** try the server outside the repo, poke it with MCP Inspector, and write `services/delivery/docs/DOORDASH-SPIKE.md`. **No checkout.** Full steps are in `docs/agents/agent-3-family.md`, Part 2.
2. **Go/no-go:**
   - **No-go:** delivery stays on `mock`, and nothing else changes.
   - **Go:** continue.
3. **Build on mock first.** Every service integrates against `DELIVERY_PROVIDER=mock`. E2E always runs on mock.
4. **Dry run with the real provider,** on Andy's laptop only: set `DELIVERY_PROVIDER=doordash_thirdparty` with `DOORDASH_LIVE_CHECKOUT=0`. Real quotes and a real cart, but nothing is paid.
5. **One live order, on demo day only:**
   - Use the **demo laptop**, the dedicated DoorDash account, and the low-limit card.
   - Set `DOORDASH_LIVE_CHECKOUT=1` and keep `DOORDASH_MAX_ORDER_CENTS` low.
   - A human presses **"Place real order"** in `/demo` and types the confirmation.
   - Record it once, then set `DOORDASH_LIVE_CHECKOUT=0` again.
   - **Always have a mock take recorded as backup.**
6. **README:** state plainly that DoorDash is an unofficial integration, and what was real vs. mocked.

**The rules that must hold** (addendum rule 8):
- Money approves and charges every order first. Delivery re-checks that.
- The cart total is checked against the approved amount and a hard cap.
- Credentials, tokens, and cookies are never committed; they stay in `%USERPROFILE%\code\dd-mcp`, outside the repo.

## Step 8 · Checkpoints (HOLD)
To raise the hold, the coordinator runs:
```cmd
git checkout main
git pull origin main
echo Checkpoint hold. Finish your current task, push, and wait.> HOLD.md
git add HOLD.md
git commit -m "HOLD"
git push origin main
```
Each person waits until their Claude says **"Paused at checkpoint,"** then posts **"paused and pushed"** in team chat.

The coordinator then merges the branches through PRs (Claire's first) and runs:
```cmd
pnpm install
pnpm seed
pnpm dev
pnpm e2e
```

To release the hold:
```cmd
git rm HOLD.md
git commit -m "Release"
git push origin main
```
Everyone then runs `git merge origin/main` and tells their Claude: *"Hold released. Resume from TASKS.md."*

## Step 9 · When to apply v1.1 (groceries catalog, shared meal, restock)
Only **after** money's real endpoints pass E2E 1 against the live services. Then follow `UPDATE-GUIDE.md`, from the v1.1 update zip, at a checkpoint.

With D14, the delivery service's quote **is** the grocery price source. So in Packet A, money's own catalog becomes the **fallback** when delivery is unreachable. Tell Agent 2 before applying.

## Step 10 · Daily routine and fixes

| Situation | Do this |
|---|---|
| Coming back to work | `cd` into the repo → `docker compose up -d --wait` → `git pull origin <branch>` → `claude --permission-mode acceptEdits` → *"Resume from TASKS.md."* |
| Voice won't start | `CC_INTERNAL_SECRET` is shorter than 24 characters, or differs from the team's |
| Family starts on the wrong port | There's a `PORT=` in the root `.env`; remove it |
| `pnpm` not found | `npm install -g pnpm`, then open a new CMD window |
| Port 5432 refused or wrong password | A native PostgreSQL is running. Stop it (Step 3, Andy's row), then `docker compose up -d --wait` |
| Claude wants to edit another agent's folder | Say no; have it write a request in your status file |
| Something you don't know how to decide | Post in team chat. The coordinator decides and updates the addendum. |
