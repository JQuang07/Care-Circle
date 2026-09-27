import { randomUUID } from "node:crypto";
import type { Config } from "./config.js";
import {
  ApiError,
  type Circle,
  type Order,
  type OrderRequest,
  type Proposal,
  type Hold,
} from "./types.js";
export interface Dependencies {
  call<T = unknown>(
    service: "money" | "family" | "delivery",
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<T>;
}
export class HttpDependencies implements Dependencies {
  constructor(private c: Config) {}
  async call<T>(
    service: "money" | "family" | "delivery",
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<T> {
    // Never retry money mutations automatically: the shared contract has no idempotency key.
    const res = await fetch(
      ({
        money: this.c.moneyUrl,
        family: this.c.familyUrl,
        delivery: this.c.deliveryUrl,
      }[service]) + path,
      {
        method,
        headers: {
          "X-CC-Secret": this.c.secret,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        // A grocery draft waits for delivery's live DoorDash quote (a store search per item).
        signal: AbortSignal.timeout(path === "/orders/draft" ? 180_000 : 10_000),
      },
    );
    if (res.status >= 400 && res.status < 500) {
      // A 4xx is a refusal: nothing changed, so the reasoner may hear why.
      const detail = (await res.json().catch(() => ({}))) as {
        error?: { code?: string; message?: string };
      };
      console.warn(`[voice] ${service} ${method} ${path} → ${res.status}`, detail.error?.message ?? "");
      throw new ApiError(
        422,
        detail.error?.code || "DEPENDENCY_REJECTED",
        `${service} refused: ${detail.error?.message ?? res.status}`,
      );
    }
    if (!res.ok)
      throw new ApiError(
        502,
        "DEPENDENCY_ERROR",
        `${service} returned ${res.status}; the action was not retried.`,
      );
    return (await res.json()) as T;
  }
}
export class MockDependencies implements Dependencies {
  orders: Order[] = [];
  holds: Hold[] = [];
  events: unknown[] = [];
  proposals: Proposal[] = [];
  resolutions: unknown[] = [];
  circle: Circle = {
    senior: { id: "sen_rose", name: "Rose", phone: "+1555010000" },
    members: [
      {
        id: "mem_lisa",
        name: "Lisa",
        phone: "+1555010001",
        isVerifier: true,
        dependents: [{ name: "Mia", age: 9 }],
      },
      {
        id: "mem_danny",
        name: "Danny",
        phone: "+1555010002",
        isVerifier: true,
      },
      { id: "mem_mark", name: "Mark", phone: "+1555010003", isVerifier: false },
    ],
  };
  async call<T>(
    service: "money" | "family" | "delivery",
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<T> {
    return this.handle(service, method, path, body) as T;
  }
  private handle(
    service: string,
    method: string,
    path: string,
    body: unknown,
  ): unknown {
    if (path.startsWith("/circle/")) return structuredClone(this.circle);
    if (path.startsWith("/contact-rhythm/"))
      return { seniorId: "sen_rose", perMember: [] };
    if (path.startsWith("/credentials/"))
      return {
        seniorId: "sen_rose",
        perPurchaseCapCents: 15000,
        monthlyCapCents: 80000,
        spentThisMonthCents: 12000,
      };
    if (path === "/fraud/assess" || path === "/orders/draft") {
      const req = body as OrderRequest;
      // Demo fixture only; Agent 2 owns the real four-layer assessment.
      const suspicious =
        /keep.*secret|don't tell|do not tell|trouble|medicare|wire|crypto/i.test(
          req.context.transcriptExcerpt,
        ) || req.amountCents > 15000;
      const fraud = {
        risk: suspicious ? ("high" as const) : ("low" as const),
        score: suspicious ? 92 : 5,
        hardStop: suspicious,
        signals: [],
        recommendedAction: suspicious ? "hold" : "proceed",
        suggestedVerifierId: "mem_danny",
        seniorFacingMessage:
          "This looks like a trick a lot of people get calls about. Let’s check with your family first.",
        familyFacingSummary:
          "Mock assessment, not the production fraud engine.",
      };
      if (path === "/fraud/assess") return fraud;
      const order: Order = {
        id: `ord_${randomUUID()}`,
        seniorId: req.seniorId,
        request: req,
        status: suspicious ? "held" : "approved",
        fraud,
        createdAt: new Date().toISOString(),
      };
      if (suspicious) {
        order.holdId = `hold_${randomUUID()}`;
        this.holds.push({
          id: order.holdId,
          orderId: order.id,
          seniorId: req.seniorId,
          status: "open",
        });
      }
      this.orders.push(order);
      return structuredClone(order);
    }
    if (path.startsWith("/orders?")) return structuredClone(this.orders);
    if (path.startsWith("/holds?")) return structuredClone(this.holds);
    if (/^\/orders\/.+\/confirm$/.test(path)) {
      const order = this.orders.find((o) => o.id === path.split("/")[2]);
      if (!order || order.status !== "approved")
        throw new ApiError(409, "HELD", "Cannot pay this order");
      order.status = "paid";
      return structuredClone(order);
    }
    if (/^\/holds\/.+\/resolve$/.test(path)) {
      const hold = this.holds.find((h) => h.id === path.split("/")[2]);
      if (!hold) throw new ApiError(404, "NOT_FOUND", "Hold missing");
      const b = body as { decision: string };
      const order = this.orders.find((o) => o.id === hold.orderId)!;
      if (
        b.decision === "release" &&
        (order.fraud.risk === "high" || order.fraud.hardStop)
      )
        throw new ApiError(409, "PASSKEY_REQUIRED", "App approval required");
      hold.status = b.decision === "cancel" ? "cancelled" : "released";
      order.status = b.decision === "cancel" ? "cancelled" : "approved";
      this.resolutions.push(body);
      return hold;
    }
    if (path.includes("/pending-senior"))
      return structuredClone(
        this.proposals.filter((p) => p.status === "awaiting_senior"),
      );
    if (path === "/schedule/request") {
      const p: Proposal = {
        id: `prop_${randomUUID()}`,
        status: "proposed",
        slots: [
          {
            id: "slot_sunday",
            startUtc: "2026-09-27T20:00:00Z",
            endUtc: "2026-09-27T20:30:00Z",
            reason: "Family availability",
            localTimes: { sen_rose: "Sunday at 4 PM" },
          },
        ],
      };
      this.proposals.push(p);
      return p;
    }
    if (path.includes("/confirm-senior")) {
      const p = this.proposals.find((p) => p.id === path.split("/")[3]);
      if (!p || p.status !== "awaiting_senior")
        throw new ApiError(409, "NOT_READY", "Family has not accepted yet");
      p.status = "confirmed";
      return {
        id: `sch_${randomUUID()}`,
        proposalId: p.id,
        seniorId: "sen_rose",
        memberIds: ["mem_lisa", "mem_danny"],
        startUtc: p.slots[0]!.startUtc,
        roomName: "care-circle-demo",
        roomJoinUrl: "http://localhost:3000/call/demo",
        seniorJoin: "phone_dialout",
        status: "scheduled",
      };
    }
    if (path === "/webhooks/call-ended") {
      this.events.push(structuredClone(body));
      return { ok: true };
    }
    if (path.includes("/upcoming")) return [];
    throw new ApiError(501, "MOCK_UNSUPPORTED", `${service} ${method} ${path}`);
  }
}
