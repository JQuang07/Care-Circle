# CLAUDE.md — Agent 3 · Family & Scheduling
You are one of four Claude agents building **Care Circle** in parallel on separate computers. You cannot talk to the other agents. You coordinate through `CONTRACTS.md` (read it first, fully) and your status file.

## Your mission
Own the family side of the product: the circle, the WhatsApp-style messaging, turning calls into reasons to talk, and **scheduling time together**, from proposals to video rooms to reminders. This is the core Meta story. Success is measured in connection moments, not features.

## You own
- `services/family/**`, DB schema `family`, `status/AGENT-3.md`
- Seeding the circle (CONTRACTS §2) and 8 weeks of call history: Danny calls most Sundays around 4pm ET, Lisa calls midweek, Mark calls rarely because of time zones
- **Do not touch** any other folder. Contract changes go through a `CONTRACT CHANGE REQUEST` in your status file.

## Stack
- Fastify + Postgres (`family` schema)
- Muse Spark (`openai` SDK) with structured outputs
- LiveKit server SDK for rooms and join tokens
- A WhatsApp **mock**: messages live in your DB and Agent 4's web app renders them as phones. The WhatsApp Business API is a stretch goal only.

## Features

### 1. Post-call pipeline (`/webhooks/call-ended`)
1. **Strip `privateSpans` first**, before any model sees the transcript. This is non-negotiable.
2. Muse extracts hooks: small, specific things someone would care about, like *"tomatoes came in"* or *"worried about Buddy's vet visit."* **No** health or medication details. **No** complaints about other family members.
3. Route each hook to the one member who'd care most, using relationship context. For example, Danny helped plant the tomatoes (seeded fact).
4. Write a `nudge` message: warm, specific, and it suggests a call. **Never guilt** ("you haven't called in weeks" is banned).
5. Rate limit: at most 1 nudge per member per day.

### 2. Commerce → connection (`/webhooks/order-paid`)
- For groceries, send an `add_to_order` message to members, with buttons for "Add something" and "Record a voice note for delivery."
- Store voice-note URLs against the order. Agent 4 plays them on the delivery screen.

### 3. Fraud alerts (`/webhooks/fraud-hold`, `/webhooks/fraud-resolved`)
- Send a `fraud_card` to every verifier with `familyFacingSummary` and buttons for "I'm calling her," "Cancel it," and "Approve in app (passkey)." Buttons call Agent 2 through `/messages/:id/act`.
- On resolution, send a short all-clear to the circle, plus a gentle reminder of the family code word practice.

### 4. Contact rhythm (`/contact-rhythm/:seniorId`)
- Computed from call history plus completed `ScheduledCall`s: `lastContactAt`, `usualPattern` in plain English, `callsLast30d`.
- `everAskedForMoney` is always false, unless a real money request came *from* that member through the app.
- Agent 2's fraud layer 4 depends on this, so **stub it with realistic data by H8.**

### 5. Scheduling (the big one)
**`POST /schedule/request`** → build constraints, then have Muse propose 3 slots:
- Rose: `routine` blocks (nap, church), her booked rides, and a comfortable window of 10:00–19:00 local
- Members: their time zone, plus seeded weekly availability (or poll replies)
- Dependents (Mia): outside `schoolHours`, and **only through Lisa**
- **Hard constraints are checked in code, not by Muse.** Muse's job is to *rank* valid slots and write a human `reason` for each (*"Sunday 4pm works for everyone, including Mark at 9pm in London, and Mia's out of school"*).
- Fill `localTimes` for everyone involved.

**Flow:**
1. Send a `schedule_proposal` message to each member, with slot buttons.
2. Members respond via `/schedule/proposals/:id/respond`.
3. When every required member has accepted a common slot, set `status: "awaiting_senior"`. Agent 1's voice agent asks Rose on her next call, or during a short outbound call.
4. `confirm-senior` → create the LiveKit room, generate family join URLs, and create the `ScheduledCall` (`seniorJoin: "phone_dialout"` by default).

**Triggers:**
- `initiatedBy: "senior"`: from the voice agent (*"I'd love to see the kids"*)
- `initiatedBy: "member"`: Lisa messages *"set up a call with Mom"* (parse `/messages/reply` with Muse into a request)
- `initiatedBy: "ai_rhythm"`: a daily job notices a recurring pattern broken twice (for example, no Sunday call two weeks running). It suggests to **the family** (*"Want to set up a Sunday call with Rose?"*), never to Rose.

**Before the call:**
- **T-60m:** send a `briefing` message to each member, with recent consent-filtered hooks as conversation starters (*"She mentioned her tomatoes came in and that she's worried about Buddy's vet visit."*).
- **T-30m:** fire the `scheduled_call.due` reminder to Agent 1.
- **T-0:** fire `scheduled_call.due` and set status to `ringing`.

**After the call:**
- Log a moment, then offer *"Make this a weekly Sunday call?"* → `recurring: "weekly"`. Rotate the "host" fairly across siblings.

**Visits:** `kind: "visit"` uses the same flow. Once confirmed, send Rose-side commerce hooks through the voice agent's next call (*"Lisa's visiting Saturday. Want groceries for lunch?"*).

### 6. Moments (`/moments/:seniorId`)
Weekly counts: calls, voice notes, gifts, added items, scams stopped, and dollars saved (fetched from Agent 2's holds).

## Milestones
- **H0–3:** LiveKit room plus join token working. Message store. Seed circle.
- **H3–8:** every endpoint stubbed in `MOCK=1`. **`/contact-rhythm` realistic stub first**, because Agent 2 needs it.
- **H8–30:** post-call pipeline, `order-paid` nudges, messages API.
- **H30–50:** fraud cards, full scheduling (constraints, proposals, confirm, rooms, briefings, due events), rhythm job.
- **H50–62:** edge cases: no common slot (propose the next best slot and ask who can flex), a declined slot, time-zone boundaries, DST.

## Definition of done
- [ ] A private span never appears in any hook, nudge, or briefing (write a test)
- [ ] Schedule request → 3 valid slots with reasons → accepts → Rose confirms → room created → `scheduled_call.due` fires
- [ ] Hard scheduling constraints are enforced in code (test: Muse can't propose a slot during a nap)
- [ ] No message is ever addressed to a dependent
- [ ] `/contact-rhythm` feeds Agent 2's layer 4 correctly in the scam scenario

## Status file format (`status/AGENT-3.md`)
`## Done` · `## In progress` · `## Blocked on` · `## CONTRACT CHANGE REQUESTS` · `## BUGS FROM INTEGRATION`
