# CONTRACTS.md — the shared law
**Every agent reads this before writing code.** Build against it and stub whatever you depend on.
**Only the human edits this file.** To change it, write a `CONTRACT CHANGE REQUEST` in your `status/AGENT-N.md`.

---

## 0. Conventions
- **Language:** TypeScript. Types live in `packages/contracts` (Agent 4 maintains them from this file).
- **Money:** integer cents, currency `"USD"`.
- **Time:** ISO 8601 UTC strings. Time zones are IANA names (`America/Chicago`).
- **IDs:** prefixed strings: `sen_`, `mem_`, `mer_`, `ord_`, `hold_`, `call_`, `prop_`, `slot_`, `sch_`, `msg_`, `hook_`.
- **Service-to-service auth:** header `X-CC-Secret: ${CC_INTERNAL_SECRET}` on every internal call and webhook.
- **Errors:** `{ "error": { "code": string, "message": string } }` with the proper HTTP status.
- **Health check:** every service exposes `GET /health → { ok: true, service, mock: boolean }`.
- **Mock mode:** every service runs with `MOCK=1` and returns canned data per this contract.

## 1. Ports and env

| Service | Owner | Port | Base URL env |
|---|---|---|---|
| voice | Agent 1 | 4001 | `VOICE_URL` |
| money | Agent 2 | 4002 | `MONEY_URL` |
| family | Agent 3 | 4003 | `FAMILY_URL` |
| web | Agent 4 | 3000 | `WEB_URL` |

Shared `.env` keys: `DATABASE_URL`, `CC_INTERNAL_SECRET`, `META_API_KEY`, `MUSE_MODEL` (default `muse-spark-1.1`; check docs for newer), `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_NUMBER`, `STT_PROVIDER` (`muse` | `fallback`), `TTS_PROVIDER`, `TTS_API_KEY`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `PAYMENTS_PROVIDER` (`visa` | `stripe`), `VISA_*`, `STRIPE_SECRET_KEY`.

**Database:** one Postgres, schemas `voice`, `money`, `family`, `web`. You write **only** your own schema, and you never read another agent's schema. Use the APIs.

## 2. Seed data (fixed IDs; everyone uses these)

```ts
senior:  { id: "sen_rose", name: "Rose", age: 81, tz: "America/New_York",
           phone: "+1555010000", language: "en",
           routine: [ {label:"nap", days:"daily", start:"13:00", end:"15:00"},
                      {label:"church", days:"sun", start:"09:30", end:"12:00"} ] }

members: [
  { id:"mem_lisa",  name:"Lisa",  relation:"daughter", tz:"America/Chicago", phone:"+1555010001",
    whatsapp:true, isVerifier:true,  dependents:[{ name:"Mia", age:9, schoolHours:"08:00-15:30 mon-fri" }] },
  { id:"mem_danny", name:"Danny", relation:"grandson", tz:"America/Denver",  phone:"+1555010002",
    whatsapp:true, isVerifier:true },
  { id:"mem_mark",  name:"Mark",  relation:"son",      tz:"Europe/London",   phone:"+1555010003",
    whatsapp:true, isVerifier:false } ]
// Mia (9) is NOT a member. Kids under 18 are reached only through their parent.

merchants: [
  { id:"mer_freshmart", name:"FreshMart",        category:"grocery"  },
  { id:"mer_cornerrx",  name:"CornerRx",         category:"pharmacy" },
  { id:"mer_crumb",     name:"Sweet Crumb Bakery", category:"bakery" },
  { id:"mer_ridemock",  name:"RideMock",         category:"rides"    } ]

credential: { seniorId:"sen_rose", perPurchaseCapCents:15000, monthlyCapCents:80000,
              blockedCategories:["wire","crypto","money_transfer","gift_card_nonmember"],
              fundedBy:["mem_lisa","mem_mark"] }

familyCodeWordHash: "<sha256 of 'blue heron'>"   // demo only
```
Seed also includes 60 days of Rose's order history, owned and seeded by Agent 2, and 8 weeks of call history (Sunday calls with Danny, and so on), owned and seeded by Agent 3.

## 3. Shared types

```ts
type OrderType = "groceries" | "ride" | "gift" | "pharmacy_refill" | "other";

interface OrderRequest {
  seniorId: string;
  type: OrderType;
  merchantId?: string;             // absent if unknown or new payee
  payeeDescription?: string;       // e.g. "Target gift cards", "man named Kevin"
  items: { name: string; qty: number; priceCents?: number }[];
  amountCents: number;
  recipientMemberId?: string;      // for gifts to circle members
  context: {
    statedReason?: string;         // Rose's own words about WHY
    transcriptExcerpt: string;     // last ~60s of conversation
    claimedRelative?: string;      // e.g. "my grandson" / "Danny"
    urgencyOrSecrecy?: boolean;    // voice agent's quick flag
  };
}

type ScamTypology = "grandparent_impostor" | "government_impostor" | "tech_support" |
  "prize_lottery" | "romance" | "investment" | "cash_courier" | "unknown";

interface FraudSignal { layer: 1|2|3|4; code: string; description: string; weight: number; }

interface FraudAssessment {
  risk: "low" | "medium" | "high";
  score: number;                   // 0–100
  hardStop: boolean;               // true if any layer-1 rule fired
  typology?: ScamTypology;
  signals: FraudSignal[];
  recommendedAction: "proceed" | "verify_with_family" | "hold";
  suggestedVerifierId?: string;    // who to call (a mem_ with isVerifier)
  seniorFacingMessage: string;     // warm, never scolding, <= 2 sentences
  familyFacingSummary: string;     // plain-English "why we paused"
}

interface Order {
  id: string; seniorId: string; request: OrderRequest;
  status: "draft" | "approved" | "held" | "cancelled" | "paid";
  fraud: FraudAssessment; holdId?: string; receiptUrl?: string; createdAt: string;
}

interface Hold {
  id: string; orderId: string; seniorId: string;
  status: "open" | "released" | "cancelled" | "expired_cooling_off";
  createdAt: string; coolingOffUntil: string;   // +24h
  resolution?: { decision: "release" | "cancel"; byMemberId: string;
                 method: "verbal_on_verification_call" | "passkey_web"; at: string };
}

interface TranscriptTurn { speaker: "senior" | "agent" | string /* mem_ id */; text: string; ts: string; }

interface CallEnded {
  callId: string; seniorId: string; kind: "inbound" | "verification" | "scheduled_family_call";
  startedAt: string; endedAt: string;
  transcript: TranscriptTurn[];
  privateSpans: { startTs: string; endTs: string }[];  // "keep this between us"
}

interface Hook { id: string; seniorId: string; text: string; forMemberId: string; nudgeText: string; createdAt: string; }

interface Slot { id: string; startUtc: string; endUtc: string; reason: string;
                 localTimes: Record<string /* sen_ or mem_ */, string /* "Sun 4:00 PM" */>; }

interface Proposal {
  id: string; seniorId: string; kind: "video_call" | "visit";
  memberIds: string[]; includesDependents: string[];   // e.g. ["Mia"]
  initiatedBy: "senior" | "member" | "ai_rhythm";
  slots: Slot[]; responses: { memberId: string; slotId: string; accept: boolean }[];
  status: "proposed" | "awaiting_senior" | "confirmed" | "cancelled";
  confirmedSlotId?: string; scheduledCallId?: string;
}

interface ScheduledCall {
  id: string; proposalId: string; seniorId: string; memberIds: string[];
  startUtc: string; roomName: string; roomJoinUrl: string;   // family joins here
  seniorJoin: "phone_dialout" | "tablet";                      // Plan A / Plan B
  recurring?: "weekly";
  status: "scheduled" | "ringing" | "live" | "done" | "missed";
}

interface ContactRhythm {
  seniorId: string;
  perMember: { memberId: string; lastContactAt?: string; usualPattern?: string; // "Sundays ~4pm"
               callsLast30d: number; everAskedForMoney: false }[];
}

interface Message {   // WhatsApp mock
  id: string; toMemberId: string; fromMemberId?: string; direction: "out" | "in";
  kind: "nudge" | "add_to_order" | "fraud_card" | "schedule_proposal" | "briefing" | "receipt" | "text" | "voice_note";
  body: string; actions?: { label: string; action: string; payload: any }[];
  mediaUrl?: string; createdAt: string;
}
```

## 4. Endpoints

### money (Agent 2) · :4002
| Method | Path | Body → Response |
|---|---|---|
| POST | `/fraud/assess` | `OrderRequest` → `FraudAssessment` (no side effects; the voice agent may call mid-conversation) |
| POST | `/orders/draft` | `OrderRequest` → `Order` (status `approved` or `held`; creates a `Hold` if held) |
| POST | `/orders/:id/confirm` | `{}` → `Order` (status `paid`, `receiptUrl`). Rejected if held or cancelled. |
| POST | `/holds/:id/resolve` | `{ decision, byMemberId, method, passkeyAssertion? }` → `Hold`. **High-risk release requires `method:"passkey_web"`.** |
| GET | `/holds?seniorId=` | → `Hold[]` |
| GET | `/credentials/:seniorId` | → caps plus `spentThisMonthCents` |
| GET | `/orders?seniorId=` | → `Order[]` |
| GET | `/eval/results` | → latest eval-set run summary (for the demo panel) |

### voice (Agent 1) · :4001
| Method | Path | Body → Response |
|---|---|---|
| POST | `/twilio/voice` | Twilio webhook (inbound call) |
| WS | `/twilio/stream` | Twilio media stream |
| POST | `/calls/verification` | `{ seniorId, holdId, memberId }` → `{ callId }`. Bridges Rose plus the member's **stored** phone. |
| POST | `/calls/outbound` | `{ seniorId, purpose:"scheduled_family_call"|"reminder", scheduledCallId?, roomName? }` → `{ callId }` |
| POST | `/demo/simulate-inbound` | `{ seniorId, script: string[] }` → `{ callId }`. Text-driven call for E2E and demo without a phone. |

### family (Agent 3) · :4003
| Method | Path | Body → Response |
|---|---|---|
| GET | `/circle/:seniorId` | → `{ senior, members }` (phones included, internal only) |
| GET | `/contact-rhythm/:seniorId` | → `ContactRhythm` |
| POST | `/schedule/request` | `{ seniorId, kind, memberIds? , includeDependents?: boolean, initiatedBy, preferredWindow?: string }` → `Proposal` |
| POST | `/schedule/proposals/:id/respond` | `{ memberId, slotId, accept }` → `Proposal` |
| POST | `/schedule/proposals/:id/confirm-senior` | `{ slotId }` → `ScheduledCall` |
| GET | `/schedule/:seniorId/upcoming` | → `ScheduledCall[]` |
| GET | `/proposals/:seniorId/pending-senior` | → `Proposal[]` (the voice agent asks Rose about these) |
| GET | `/messages?memberId=` | → `Message[]` (WhatsApp mock inbox) |
| POST | `/messages/:id/act` | `{ action, payload }` → result (button taps) |
| POST | `/messages/reply` | `{ fromMemberId, body, voiceNoteUrl? }` → `Message` |
| GET | `/moments/:seniorId?week=` | → `{ calls, voiceNotes, gifts, addedItems, scamsStopped, savedCents }` |

## 5. Webhooks (events)
Everything is POSTed with `X-CC-Secret`. The receiver returns `200` quickly and processes async.

| Event | From → To | Path on receiver | Payload |
|---|---|---|---|
| `call.ended` | voice → family | `POST /webhooks/call-ended` | `CallEnded` |
| `order.paid` | money → family | `POST /webhooks/order-paid` | `Order` |
| `fraud.hold_created` | money → family | `POST /webhooks/fraud-hold` | `{ order: Order, hold: Hold }` |
| `fraud.hold_resolved` | money → family | `POST /webhooks/fraud-resolved` | `{ order: Order, hold: Hold }` |
| `scheduled_call.due` | family → voice | `POST /webhooks/scheduled-call-due` | `ScheduledCall` (fires at T-0; a `reminder` fires at T-30m) |

## 6. Voice agent tools (Muse function calling, implemented by Agent 1 as HTTP calls)

| Tool | Calls |
|---|---|
| `check_budget()` | `GET money /credentials/:seniorId` |
| `precheck_purchase(req)` | `POST money /fraud/assess` |
| `place_order(req)` | `POST money /orders/draft` → if approved and Rose confirms aloud → `POST /orders/:id/confirm` |
| `start_verification_call(holdId, memberId)` | `POST voice /calls/verification` (local) |
| `resolve_hold_verbal(holdId, decision, memberId)` | `POST money /holds/:id/resolve` with `method:"verbal_on_verification_call"`. **`cancel` is always allowed. `release` is only allowed if risk ≠ high.** |
| `get_family_context()` | `GET family /circle/:seniorId` + `/contact-rhythm/:seniorId` |
| `request_family_time(kind, who, when?)` | `POST family /schedule/request` |
| `get_pending_proposals()` | `GET family /proposals/:seniorId/pending-senior` |
| `confirm_family_time(proposalId, slotId)` | `POST family /schedule/proposals/:id/confirm-senior` |
| `mark_private()` | local: start a `privateSpan` ("keep this between us") |

## 7. Non-negotiable rules (all agents)
1. Layer-1 fraud hard stops are deterministic code. **No model output can bypass them.**
2. Verification calls use the phone number **stored in the circle**, never one given by a caller.
3. Nobody under 18 is ever a member, messaged, or called directly.
4. `privateSpans` are removed **before** any text reaches hook extraction or briefings.
5. The AI never impersonates a family member and never clones a voice.
6. The AI speaks once at the start of a family call, then leaves it.
