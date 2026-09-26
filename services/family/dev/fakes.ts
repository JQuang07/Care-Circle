// Fake voice (:4001) and money (:4002) services for local dev until Agents 1 and 2 ship.
// Usage: npm run fakes            (skips a port that's already taken by the real service)
import Fastify from "fastify";
import { DateTime } from "luxon";
import { loadConfig } from "../src/config.js";

const cfg = loadConfig();
const port = (url: string) => Number(new URL(url).port);

// ---------- money ----------
const money = Fastify({ logger: { level: "info" } });
const nextTuesdayRide = DateTime.now().setZone("America/New_York").plus({ weeks: 1 }).set({ weekday: 2, hour: 10, minute: 30, second: 0, millisecond: 0 });
const orders: any[] = [
  {
    id: "ord_seed_ride1", seniorId: "sen_rose", status: "paid", createdAt: new Date().toISOString(),
    request: { seniorId: "sen_rose", type: "ride", merchantId: "mer_ridemock", items: [{ name: "Ride to the library", qty: 1 }], amountCents: 1800,
      pickupAt: nextTuesdayRide.toUTC().toISO(), context: { transcriptExcerpt: "Book me a ride to the library Tuesday morning." } },
    fraud: { risk: "low", score: 5, hardStop: false, signals: [], recommendedAction: "proceed", seniorFacingMessage: "", familyFacingSummary: "" },
  },
];
const holds: any[] = [];

money.get("/health", async () => ({ ok: true, service: "money", mock: true, fake: "agent-3-dev" }));
money.get<{ Querystring: { seniorId?: string } }>("/orders", async (req) => orders.filter((o) => !req.query.seniorId || o.seniorId === req.query.seniorId));
money.get<{ Querystring: { seniorId?: string } }>("/holds", async (req) => holds.filter((h) => !req.query.seniorId || h.seniorId === req.query.seniorId));
money.post<{ Params: { id: string }; Body: any }>("/holds/:id/resolve", async (req, reply) => {
  const h = holds.find((x) => x.id === req.params.id);
  if (!h) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "hold not found" } });
  if ((req.body as any).decision === "release" && (req.body as any).method !== "passkey_web") {
    return reply.code(403).send({ error: { code: "PASSKEY_REQUIRED", message: "high-risk release requires passkey_web" } });
  }
  h.status = (req.body as any).decision === "cancel" ? "cancelled" : "released";
  h.resolution = { decision: (req.body as any).decision, byMemberId: (req.body as any).byMemberId, method: (req.body as any).method, at: new Date().toISOString() };
  const order = orders.find((o) => o.id === h.orderId);
  if (order) order.status = h.status === "cancelled" ? "cancelled" : "approved";
  // Real money would fire fraud.hold_resolved to family; the fake does too.
  fetch(`${cfg.familyUrl}/webhooks/fraud-resolved`, {
    method: "POST", headers: { "content-type": "application/json", "X-CC-Secret": cfg.internalSecret },
    body: JSON.stringify({ order, hold: h }),
  }).catch((e) => money.log.warn(String(e)));
  return h;
});
/** Dev-only: register an order/hold so family can be driven end to end (used by dev/scenario.ts). */
money.post<{ Body: { order: any; hold?: any } }>("/__fake/register", async (req) => {
  orders.push(req.body.order);
  if (req.body.hold) holds.push(req.body.hold);
  return { ok: true };
});

// ---------- voice ----------
const voice = Fastify({ logger: { level: "info" } });
const dueEvents: any[] = [];
voice.get("/health", async () => ({ ok: true, service: "voice", mock: true, fake: "agent-3-dev" }));
voice.post<{ Body: any }>("/webhooks/scheduled-call-due", async (req) => {
  const phase = req.headers["x-cc-phase"] ?? "due";
  dueEvents.push({ phase, at: new Date().toISOString(), call: (req.body as any) });
  voice.log.info({ phase, scheduledCallId: (req.body as any)?.id, roomName: (req.body as any)?.roomName }, "scheduled_call.due received (fake voice would dial Rose now)");
  return { ok: true };
});
voice.post<{ Body: any }>("/calls/outbound", async (req) => ({ callId: `call_fake_${Date.now()}`, ...(req.body as any) }));
voice.get("/__fake/due-events", async () => dueEvents);

async function tryListen(app: typeof money, p: number, name: string) {
  try {
    await app.listen({ port: p, host: "0.0.0.0" });
  } catch (err: any) {
    if (err.code === "EADDRINUSE") console.log(`[fakes] :${p} in use (real ${name} running?) ??skipping fake ${name}`);
    else throw err;
  }
}
await tryListen(money, port(cfg.moneyUrl), "money");
await tryListen(voice, port(cfg.voiceUrl), "voice");
