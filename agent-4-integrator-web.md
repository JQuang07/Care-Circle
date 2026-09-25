# CLAUDE.md — Agent 4 · Integrator + Web
You are one of four Claude agents building **Care Circle** in parallel on separate computers. You cannot talk to the other agents. You coordinate through `CONTRACTS.md` (read it first, fully), the status files, and the human coordinator.

## Your mission
Two jobs:
1. **Integrator.** You own the monorepo, the shared types, seed orchestration, and end-to-end tests. You are the one who proves the four pieces work as one product.
2. **Everything judges see on screen.** The family's phones (a WhatsApp simulator), the dashboard, the senior tablet (Plan B), and the demo control panel.

## You own
- Repo root config, `packages/contracts/**`, `apps/web/**`, `e2e/**`, schema `web`, `status/AGENT-4.md`
- **Writing into other agents' status files, under `## BUGS FROM INTEGRATION` only**
- **Do not touch** `services/**` code. Report bugs; don't fix other agents' code.

## Phase 0 (H0–3): scaffold so everyone can start
- pnpm workspaces: `packages/contracts`, `services/voice`, `services/money`, `services/family`, `apps/web`, `e2e`
- `docker-compose.yml` with Postgres. `scripts/init-schemas.sql` creates the `voice`, `money`, `family`, and `web` schemas.
- `packages/contracts`: TypeScript types plus zod schemas **exactly** from CONTRACTS.md §3, with no additions.
- `pnpm dev` runs all four services and web together. `pnpm seed` calls each service's seed script in order: family → money → voice.
- Empty service folders with a Fastify hello-world and `/health`, so the other agents start from a running skeleton.
- **Push to `main` by H3 and tell the human.** Other agents pull before writing code.

## Web app (Next.js + Tailwind)
**`/family`: the WhatsApp simulator (the star of the demo).**
- 2–3 phone frames side by side (Lisa, Danny, Mark), each a WhatsApp-lookalike chat rendering `Message[]` from family `/messages`.
- Render these message kinds: `nudge`, `add_to_order` (buttons plus a voice-note recorder), `fraud_card` (red-flag styling, signals list, action buttons), `schedule_proposal` (slot buttons with each person's local time), `briefing`, `receipt`, `voice_note`.
- Poll every 1.5s; SSE if you have time.
- Passkey approval modal for "Approve in app." Use a real WebAuthn prompt if feasible, otherwise a faithful simulation, and label it as such in dev.

**`/dashboard`: the family view of Rose's week.**
- Connection-moments week view (from `/moments`), upcoming calls, open holds with the "why we paused" text, recent orders.
- **Fraud detail drawer:** shows all four layers' signals with weights, and the final score and risk. Judges love seeing the engine think.

**`/call/:scheduledCallId`: the family video room.** LiveKit React components. Family joins here; Rose appears as an audio tile via phone (Plan A).

**`/tablet`: Plan B for Rose.** Huge text, one big green button, auto-answers only calls from circle members, shows faces large.

**`/demo`: the control panel for recording.**
Buttons that drive `/demo/simulate-inbound` scripts:
1. *Grocery happy path*
2. *"I'd love to see the kids"*
3. *Grandparent scam* ($500 gift cards, "don't tell your mom")
4. *Legit gift card for Mia's birthday* (should pass)
5. *Government impostor* ("Medicare says I owe $300")

Plus: **"Fast-forward to Sunday 4pm"** (a time override for the scheduled call), **"Reset all data,"** and **"Show eval results"** (from money `/eval/results`).

## E2E tests (`pnpm e2e`)
Five scenarios, text-driven through `/demo/simulate-inbound`, asserting across services:
1. Grocery: order `paid` → Lisa has an `add_to_order` message
2. Schedule: proposal → Lisa and Danny accept → Rose confirms (scripted) → `ScheduledCall` exists → fast-forward → voice `/calls/outbound` was hit
3. Scam: order `held`, `hardStop` true → verifier has a `fraud_card` → scripted Danny says "cancel" → hold `cancelled` → moments show 1 scam stopped
4. Mia gift card: order `paid`, risk `low`
5. Privacy: script includes "keep this between us" plus a detail → that detail appears in **no** message

After every checkpoint merge: run `pnpm e2e` and write each failure into the owning agent's status file under `## BUGS FROM INTEGRATION`, including the scenario, the expected versus actual result, and the request/response.

## Checkpoint duties
| Checkpoint | You verify |
|---|---|
| H8 | `pnpm dev` boots all services, `/health` is green everywhere, web renders stub data |
| H30 | E2E 1 passes |
| H50 | E2E 1–5 pass |
| H62 (freeze) | E2E 1–5 pass 10 runs in a row. Seed is demo-ready. |

## Final combine (H62–72)
1. The human merges all four branches to `main`. You run a clean-clone test: `git clone` → `pnpm i` → `docker compose up` → `pnpm seed` → `pnpm dev` → `pnpm e2e`.
2. Write the root `README.md`: what it is, architecture diagram, how to run it, the mock vs. real table (say honestly what's simulated), and the team.
3. Prepare the demo with the human, following the README demo script. Record by H66. Keep a backup recording of every scenario in case something breaks live.
4. Write the submission text: who it's for, how it strengthens connection, and why AI is essential (see the Care Circle concept doc).

## Definition of done
- [ ] Clean clone to a running product in ≤10 commands
- [ ] All 5 E2E scenarios pass 10 runs in a row
- [ ] Every demo-panel button works without a real phone
- [ ] Fraud drawer shows all four layers
- [ ] README states honestly what's mocked (merchants, delivery, WhatsApp, passkey if simulated)

## Status file format (`status/AGENT-4.md`)
`## Done` · `## In progress` · `## Blocked on` · `## CONTRACT CHANGE REQUESTS` · `## Integration report (latest E2E run)`
