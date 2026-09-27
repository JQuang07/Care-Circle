// pnpm demo:run <scenario|all> [--text]
// Plays a demo scenario through voice: audio clips from demo-audio/<scenario>/ via
// /demo/audio-turn, or (with --text, or when a scenario has no clips) the scripted lines
// below via /demo/converse. "@accept" taps the slot buttons as Lisa and Danny.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SECRET = process.env.CC_INTERNAL_SECRET ?? "";
const url = {
  voice: process.env.VOICE_URL ?? "http://localhost:4001",
  money: process.env.MONEY_URL ?? "http://localhost:4002",
  family: process.env.FAMILY_URL ?? "http://localhost:4003",
  delivery: process.env.DELIVERY_URL ?? "http://localhost:4004",
};
type Svc = keyof typeof url;
export const SCRIPTS: Record<string, string[]> = {
  groceries: [
    "Hi, it's Rose. I need a few groceries: whole milk, bananas and wheat bread.",
    "Yes, that's everything. Please go ahead and order it.",
  ],
  family: [
    "I'd love a video call with Lisa and Danny this weekend.",
    "@accept",
    "Did the family pick a time?",
    "Yes, that sounds lovely.",
  ],
  scam: [
    "My grandson Danny just called. He's in jail and needs two thousand dollars in gift cards for bail, and he said not to tell anyone.",
    "Yes, please call Danny.",
    "mem_danny: Grandma, that wasn't me. I'm fine. Please cancel it.",
  ],
  gift: [
    "I want to send a twenty-five dollar gift card from Sweet Crumb Bakery to my granddaughter Mia for her birthday.",
    "Yes, please go ahead.",
  ],
};

async function api<T = any>(svc: Svc, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(url[svc] + path, {
    method,
    headers: { "X-CC-Secret": SECRET, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${svc} ${method} ${path} → ${res.status} ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

export async function resetAll() {
  for (const svc of ["family", "money", "delivery", "voice"] as Svc[]) await api(svc, "POST", "/demo/reset", {});
}

/** Taps the same slot button as Lisa and Danny, like the family phones would. */
export async function acceptAsFamily(proposalId: string, memberIds = ["mem_lisa", "mem_danny"]) {
  let slotId: string | undefined;
  for (const memberId of memberIds) {
    const msgs = await api<any[]>("family", "GET", `/messages?memberId=${memberId}`);
    for (const m of msgs.filter((m) => m.kind === "schedule_proposal").reverse()) {
      const a = (m.actions ?? []).find(
        (a: any) => a.action === "accept_slot" && a.payload?.proposalId === proposalId && (!slotId || a.payload.slotId === slotId),
      );
      if (!a) continue;
      slotId = a.payload.slotId;
      await api("family", "POST", `/messages/${m.id}/act`, { action: a.action, payload: a.payload });
      console.log(`   [tap] ${memberId} accepts ${a.label}`);
      break;
    }
  }
  return api("family", "GET", `/schedule/proposals/${proposalId}`);
}

function clips(scenario: string) {
  const dir = join("demo-audio", scenario);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /\.(mp3|m4a|wav|webm|ogg)$/i.test(f))
    .sort()
    .map((f) => join(dir, f));
}

async function audioTurn(file: string, sessionId: string | undefined, speaker?: string) {
  const form = new FormData();
  form.append("file", new Blob([readFileSync(file)]), file.split(/[\\/]/).pop()!);
  form.append("seniorId", "sen_rose");
  if (sessionId) form.append("sessionId", sessionId);
  if (speaker) form.append("speaker", speaker);
  const res = await fetch(url.voice + "/demo/audio-turn", { method: "POST", headers: { "X-CC-Secret": SECRET }, body: form });
  const body = await res.json();
  if (!res.ok) throw new Error(`audio-turn ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
  return body;
}

export async function run(scenario: string, textOnly = false) {
  const files = textOnly ? [] : clips(scenario);
  const steps: { text?: string; file?: string; speaker?: string; accept?: boolean }[] = files.length
    ? files.flatMap((file) => {
        const sidecar = readFileSync(file.replace(/\.[^.]+$/, ".txt"), "utf8").trim();
        const who = /^(mem_\w+):/.exec(sidecar)?.[1];
        const step = { file, speaker: who };
        // The family accepts between Rose asking for a call and asking whether they picked a time.
        return scenario === "family" && /pick|time\?|answer/i.test(sidecar) ? [{ accept: true }, step] : [step];
      })
    : SCRIPTS[scenario]!.map((line) =>
        line === "@accept"
          ? { accept: true }
          : { text: line.replace(/^mem_\w+:\s*/, ""), speaker: /^(mem_\w+):/.exec(line)?.[1] },
      );
  console.log(`\n=== ${scenario} (${files.length ? "audio" : "text"}) ===`);
  await resetAll();
  let sessionId: string | undefined;
  let proposalId: string | undefined;
  for (const step of steps) {
    if (step.accept) {
      if (!proposalId) throw new Error("No proposal to accept yet");
      const p = await acceptAsFamily(proposalId);
      console.log(`   [proposal] ${p.status}`);
      continue;
    }
    const r = step.file
      ? await audioTurn(step.file, sessionId, step.speaker)
      : await api("voice", "POST", "/demo/converse", { sessionId, seniorId: "sen_rose", text: step.text, speaker: step.speaker });
    sessionId = r.sessionId;
    const who = step.speaker ? step.speaker.replace("mem_", "") : "Rose";
    console.log(`${who}: ${r.transcript ?? step.text}${r.transcribedBy ? `  (${r.transcribedBy})` : ""}`);
    console.log(`AI${r.reasonedBy === "mock" ? " [mock]" : ""}: ${r.reply}`);
    for (const e of r.events ?? []) {
      console.log(`   [${e.type}] ${e.summary}`);
      if (e.type === "proposal.sent") proposalId = e.data.id;
    }
  }
  if (sessionId) await api("voice", "POST", `/demo/converse/${sessionId}/end`, {});
  return check(scenario);
}

async function check(scenario: string) {
  const orders = await api<any[]>("money", "GET", "/orders?seniorId=sen_rose");
  const last = orders.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  let ok = false;
  let detail = "";
  if (scenario === "groceries") {
    // A real DoorDash cart builds after payment (a store search and add per item, then the
    // checkout page): up to a few minutes. Follow money's record of the delivery until it settles.
    let d = last?.fulfilment?.delivery;
    for (let waited = 0; waited < 240_000 && last?.fulfilment?.quoteId && !["dry_run_complete", "failed", "awaiting_live_checkout"].includes(d?.status); waited += 5000) {
      await new Promise((r) => setTimeout(r, 5000));
      d = (await api<any>("money", "GET", `/orders/${last.id}`))?.fulfilment?.delivery;
    }
    const lisa = await api<any[]>("family", "GET", "/messages?memberId=mem_lisa");
    const addTo = lisa.some((m) => m.kind === "add_to_order");
    ok = last?.status === "paid" && d?.status === "dry_run_complete" && addTo;
    detail = `order ${last?.status} $${(last?.request.amountCents / 100).toFixed(2)} store=${last?.fulfilment?.storeName} delivery=${d?.status} lisa add_to_order=${addTo}`;
  } else if (scenario === "family") {
    const up = await api<any[]>("family", "GET", "/schedule/sen_rose/upcoming");
    ok = up.length > 0;
    detail = `scheduled calls: ${up.map((c) => `${c.id} ${c.startUtc} [${c.memberIds.join(",")}]`).join("; ")}`;
  } else if (scenario === "scam") {
    const holds = await api<any[]>("money", "GET", "/holds?seniorId=sen_rose");
    const danny = await api<any[]>("family", "GET", "/messages?memberId=mem_danny");
    const card = danny.some((m) => m.kind === "fraud_card");
    ok = holds.some((h) => h.status === "cancelled") && card && last?.fraud.risk === "high";
    detail = `risk=${last?.fraud.risk} holds=${holds.map((h) => h.status).join(",")} danny fraud_card=${card}`;
  } else if (scenario === "gift") {
    ok = last?.status === "paid" && last?.fraud.risk === "low" && last?.request.recipientMemberId === "mem_lisa";
    detail = `order ${last?.status} risk=${last?.fraud.risk} recipient=${last?.request.recipientMemberId} reason="${last?.request.context.statedReason}"`;
  }
  console.log(`${ok ? "PASS" : "FAIL"} ${scenario}: ${detail}`);
  return ok;
}

const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/demo-run.ts");
if (isMain) {
  const arg = process.argv[2] ?? "all";
  const textOnly = process.argv.includes("--text");
  const list = arg === "all" ? Object.keys(SCRIPTS) : [arg];
  let failed = 0;
  for (const s of list) {
    try {
      if (!(await run(s, textOnly))) failed++;
    } catch (e) {
      failed++;
      console.log(`FAIL ${s}: ${(e as Error).message}`);
    }
  }
  process.exit(failed ? 1 : 0);
}
