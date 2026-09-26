# INSTRUCTIONS.md: landing `integration-v2` and getting everyone running
Windows CMD. The coordinator does steps 1–3; each teammate then follows their runbook.

## 1 · Pause pushes (2 min)
Post in team chat: *"Push what you have now, then pause pushing for 20 minutes while I land the merge."*
Then check that nobody pushed since the merge. Each line should print nothing:
```cmd
cd /d %USERPROFILE%\code\Care-Circle
git fetch origin
git fetch %USERPROFILE%\Downloads\care-circle-integration-v2.bundle integration-v2:integration-v2
git log integration-v2..origin/andy --oneline
git log integration-v2..origin/arpit --oneline
git log integration-v2..origin/claire --oneline
git log integration-v2..origin/jayden --oneline
```
If one prints commits, merge that branch in first:
```cmd
git checkout integration-v2
git merge origin/<branch>
```
Conflicts will be on files the integration moved or cleaned: keep the cleanup and keep the owner's code in their own folder. Then run `pnpm install && pnpm typecheck` and commit.

**If Arpit uploaded through the website again:** his files land in a new top-level folder. Move them into `services\money\` (overwriting), delete the stray folder, and commit.

## 2 · Land it on `main` (5 min)
```cmd
git push origin integration-v2
```
On GitHub, open a pull request from **`integration-v2` into `main`** and merge it.

The old `integration` branch on GitHub is superseded. After the PR is merged, delete it:
```cmd
git push origin --delete integration
```

## 3 · Tell the team (copy this message)
> integration-v2 is on main. Before you pull:
> - **Claire:** `copy CLAUDE.md CLAUDE.local.md` first.
> - **Arpit:** from now on, work only inside the cloned repo and push with git; no website uploads.
> - **Andy:** stop native Postgres (admin CMD: `net stop postgresql-x64-16` and `-17`).
>
> Then everyone: follow `docs/agents/COMMON-SETUP.md`, then your own file in `docs/agents/`, and paste its kickoff prompt into Claude Code.
> Team secret: I'll DM it (≥24 characters, same for everyone).

## 4 · Next checkpoint
Hold it when **all four Part-1 critical tasks** are pushed:
- Jayden: D16 (confirmation fix)
- Arpit: D15 (events reach family)
- Andy: D10 + the delivery webhook
- Claire: the contracts package

Raise HOLD:
```cmd
git checkout main
git pull origin main
echo Checkpoint hold. Finish your task, push, wait.> HOLD.md
git add HOLD.md
git commit -m "HOLD"
git push origin main
```
Once everyone posts "paused and pushed," merge the four branches into `main` (Claire's first) and run:
```cmd
pnpm install
pnpm seed
pnpm dev
```
Then, in a second window: `pnpm health` (5 green) and `pnpm e2e`.

Release the hold:
```cmd
git rm HOLD.md
git commit -m "Release"
git push origin main
```

## 5 · DoorDash rollout (Andy, on his own laptop, any time)
Follow `docs/agents/agent-3-family.md` Part 4 and `services/delivery/README.md`:
1. Install the MCP server outside the repo, log in once, and run it on port 3100 with a token.
2. Run `pnpm dd:check`, then do a dry run.
3. Place **one** live order, on demo day only, confirmed by a person in web `/demo`.

Everyone else stays on `DELIVERY_PROVIDER=mock`.

## 6 · v1.1 (grocery catalog, shared meal, smart restock)
Only after E2E 1–5 pass against the live services. Then follow `UPDATE-GUIDE.md` at a checkpoint. With D14 in place, delivery's quote is the grocery price source, and money's own catalog is the fallback.
