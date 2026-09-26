# Care Circle

A phone helper for Rose (81). She orders groceries by voice, her family stays in the loop on WhatsApp, and every purchase goes through a four-layer scam check. It also books family video calls that ring her regular phone.

> This is the **build-phase README**. The final one (architecture, mock vs. real table, demo script, team) lands at H62. The build plan is in [`docs/BUILD-KIT.md`](docs/BUILD-KIT.md), and the shared interfaces are in [`CONTRACTS.md`](CONTRACTS.md).

## Run it

You need Node 22.12+, pnpm 10 (`corepack enable`), and Docker.

```bash
pnpm install
cp .env.example .env          # fill in API keys; MOCK=1 works without them
docker compose up -d --wait   # Postgres with the voice/money/family/web schemas
pnpm seed                     # family → money → voice
pnpm dev                      # all four services, labeled output
pnpm health                   # expect four green rows
```

Then open http://localhost:3000.

| Page | What it is |
|---|---|
| `/family` | Lisa's, Danny's, and Mark's phones: the WhatsApp-style chat with Care Circle |
| `/dashboard` | Rose's week, paused purchases, and "How we decided" (all four fraud layers) |
| `/demo` | Recording controls: run each scenario without a real phone |
| `/tablet` | Plan B for Rose: one big button, auto-answers only her family |

## Tests

| Command | What it proves |
|---|---|
| `pnpm e2e` | The five cross-service scenarios pass against the running services |
| `pnpm e2e:10` | The freeze gate: ten passing runs in a row |
| `pnpm e2e:selftest` | The tests themselves are sound, checked against an in-memory fake on ports 5001–5003 |
| `pnpm typecheck` | Every package typechecks, including the guard that keeps the contract types and zod schemas in sync |

When `pnpm e2e` fails, it writes `e2e/reports/latest.md`. Each failure is grouped under the status file of the agent who owns it, with the request and response that failed.

## Layout and ownership

| Path | Owner |
|---|---|
| `packages/contracts/` | Agent 4. Mirrors CONTRACTS.md §3; changes only after the human edits CONTRACTS.md |
| `services/voice/` · `:4001` | Agent 1 |
| `services/money/` · `:4002` | Agent 2 |
| `services/family/` · `:4003` | Agent 3 |
| `apps/web/` · `:3000`, `e2e/` | Agent 4 |
| `status/AGENT-N.md` | Agent N, except the `BUGS FROM INTEGRATION` section, which Agent 4 writes |

Each service writes only its own Postgres schema and reaches the others through the HTTP APIs in CONTRACTS.md. The browser never calls services directly: the web app proxies through `/api/svc`, adds `X-CC-Secret` on the server, and exposes only an allowlist of paths.
