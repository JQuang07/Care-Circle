# COMMON-SETUP.md: every teammate, every computer (about 20 minutes)
This gets **your** laptop running the **whole** merged app (voice, money, family, delivery, web) so your Claude builds against everyone's real code. Your agent file (`docs/agents/agent-N-*.md`) tells you when to do this.

Commands are **Windows CMD**. Claude Code on Windows runs its own commands in Git Bash; `pnpm`, `git`, `curl`, and `docker` work the same there.

## 0. One-time installs (skip what you have)
```cmd
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Docker.DockerDesktop -e
winget install Anthropic.ClaudeCode
```
Open a **new** CMD window afterwards so the new commands are found, then:
```cmd
npm install -g pnpm
```
Start **Docker Desktop** once from the Start menu and wait until it says it's running.

## 1. Get the repo on YOUR branch, working in place
Work **inside the cloned repo folder**. Don't copy it elsewhere, and never upload files through the GitHub website.
```cmd
mkdir %USERPROFILE%\code
cd /d %USERPROFILE%\code
git clone https://github.com/JQuang07/Care-Circle.git
cd Care-Circle
git checkout <your-branch>
```
Already cloned? Save your work first, then pull `main` into your branch:
```cmd
cd /d %USERPROFILE%\code\Care-Circle
git checkout <your-branch>
git add -A
git commit -m "WIP before sync"
git fetch origin
git merge origin/main
```
If a merge conflict shows up in a `*.md` file, keep main's version: `git checkout --theirs <file>`, then `git add <file>` and `git commit`.

## 2. Install and configure
```cmd
pnpm install
copy .env.example .env
notepad .env
```
In `.env`:
- `CC_INTERNAL_SECRET=` **the team secret** (≥24 characters, identical for everyone, shared privately, never committed)
- Keep `MOCK=1`, `MOCK_DEPENDENCIES=0`, `DELIVERY_PROVIDER=mock`, and `DOORDASH_LIVE_CHECKOUT=0`
- Add only **your own** API keys (your agent file lists them)
- **Never** add `PORT=`

## 3. Database, seed, run
```cmd
docker compose up -d --wait
pnpm seed
pnpm dev
```
Leave `pnpm dev` running in that window. Open a **second** CMD window:
```cmd
cd /d %USERPROFILE%\code\Care-Circle
pnpm health
```
**Expected: 5 green rows** (voice, money, family, delivery, web). The web row can take about 30 seconds on first start.

## 4. Point Claude Code at your role
Create `CLAUDE.local.md` in the repo root. It's gitignored, so it stays on your computer:
```cmd
notepad CLAUDE.local.md
```
```markdown
# My role: Agent N · <name>
@docs/agents/<your-agent-file>.md
@docs/agents/COMMON-SETUP.md
@CONTRACTS.md
@docs/CONTRACTS-ADDENDUM.md
@docs/INTEGRATION-REPORT.md
- My branch: <branch>. I only write inside my folder(s) and status/AGENT-N.md.
- Push only with: git push origin <branch>
- `pnpm dev` is already running in another window; use `pnpm health` and curl to check services.

## Checkpoint gate
After each task (tests pass, committed, pushed): run `git fetch origin` then `git show origin/main:HOLD.md`.
If that succeeds, STOP and say "Paused at checkpoint". If it fails, continue.
```
Start Claude:
```cmd
claude --permission-mode acceptEdits
```
Type `/memory` to confirm the files loaded, then paste the **kickoff prompt** at the bottom of your agent file.

## Everyday restart
```cmd
cd /d %USERPROFILE%\code\Care-Circle
docker compose up -d --wait
git pull origin <your-branch>
pnpm dev
```
Then, in a second window, `claude --permission-mode acceptEdits` → "Resume from TASKS.md."

## Troubleshooting
| Problem | Fix |
|---|---|
| Voice won't start | `CC_INTERNAL_SECRET` is shorter than 24 characters, or differs from the team's |
| A service starts on the wrong port | There's a `PORT=` in `.env`; delete it |
| Port 5432 refused, or wrong password | A native PostgreSQL is running. In an admin CMD: `net stop postgresql-x64-16` (and `-17`), then `docker compose up -d --wait` |
| `pnpm` not found | `npm install -g pnpm`, then open a new CMD window |
| Claude wants to edit another agent's folder | Say no; have it write a request in your status file |
