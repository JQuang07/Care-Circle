# Jayden / Agent 1 — Mac setup

Repo: `/Users/jquang/Documents/College/hackgt-13/Care-Circle`. Branch: `jayden`.

## Completed

Synced with integrated main; installed dependencies with pinned pnpm 10.34.5; created ignored root `.env` and `CLAUDE.local.md`; implemented all five required voice coding tasks and optional order-status tool. Unit/transport tests and workspace type checks passed. Five actual service processes passed health using temporary in-memory storage and a private test secret; the runbook grocery script produced a paid mock order. This does not verify Postgres or the team secret.

## Finish common setup

1. Finish `brew install --cask docker-desktop` in your Mac Terminal, entering the administrator password there. Open Docker Desktop and complete first-run setup.
2. Obtain the team secret and set root `.env` → `CC_INTERNAL_SECRET` (at least 24 characters). It was intentionally left blank. Never commit it.
3. Keep `MOCK=1`, `MOCK_DEPENDENCIES=0`, `DELIVERY_PROVIDER=mock`, `DOORDASH_LIVE_CHECKOUT=0`. Never add root `PORT`.
4. Use pnpm 10.34.5: `npm install -g pnpm@10.34.5` in your Terminal, or prefix pnpm commands with `npm exec --yes --package=pnpm@10.34.5 --`.
5. Stop any temporary test processes before starting the full stack:

```sh
cd /Users/jquang/Documents/College/hackgt-13/Care-Circle
docker compose up -d --wait
pnpm seed
pnpm dev
```

In another Terminal at the same repo:

```sh
pnpm health
pnpm --filter @care-circle/voice test
pnpm e2e
```

Expect five green health rows. See `status/AGENT-1.md` for other agents' integration issues.

## Real phone — still unverified

Add root `.env` keys: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_NUMBER`, `DEEPGRAM_API_KEY`, `META_API_KEY`, `MUSE_MODEL=muse-spark-1.3`, and `DIAL_ALLOWLIST` containing consenting adult test numbers. Coordinate with Andy to store the actual Rose/Danny test numbers in family.

Run `ngrok http 4001`; set the HTTPS tunnel URL as `PUBLIC_BASE_URL`. Set the Twilio number's POST voice webhook to `<PUBLIC_BASE_URL>/twilio/voice`.

Keys alone do not enable live voice. Keep root `MOCK=1` for the other services. Stop the full mock process group, run the other services separately with root `.env` loaded, then start voice from the root:

```sh
pnpm exec dotenv -e .env -- env MOCK=0 pnpm --filter @care-circle/voice dev
```

Do not also run full `pnpm dev`: it would start a second voice process on port 4001.

- Make 10 real calls, then run `pnpm exec dotenv -e .env -- pnpm --filter @care-circle/voice latency`.
- Measure audible end-to-end latency too. The script excludes STT endpointing and phone network delay. Target: at most 1.5 seconds.
- Run five real verification flows using Danny's stored consenting test number.
- By H44 choose SIP or tablet and record evidence in `status/AGENT-1.md`. SIP needs a real LiveKit project/trunk; compose currently provisions only Postgres.
- A real delivery order can only be confirmed by a human in web `/demo`.

## Continue development

Edit only `services/voice/` and `status/AGENT-1.md`. Push only `git push origin jayden`. After each tested, committed, pushed task, fetch origin and inspect `origin/main:HOLD.md`; if it exists, stop at the checkpoint.

`CLAUDE.local.md` already imports the Agent 1 role and contracts if you use Claude Code. Installing another assistant is not required to do this work in Codex.
