import { DateTime } from "luxon";
import type { CallEnded, Hook, Member, TranscriptTurn } from "../contracts-local.js";
import type { Deps } from "../deps.js";
import { newId } from "../ids.js";
import { RELATIONSHIP_FACTS } from "../seed-data.js";
import type { HookRecord } from "../store/types.js";
import { getCircle } from "./circle.js";
import { sendMessage } from "./messages.js";
import { leaksPrivate, stripPrivate, type Stripped } from "./privacy.js";
import { computeContactRhythm } from "./rhythm.js";
import { hasGuilt, hookTextAllowed } from "./safety.js";

interface Candidate { text: string; forMemberId: string; nudgeText: string; }

const EXTRACT_SCHEMA = (memberIds: string[]) => ({
  type: "object",
  additionalProperties: false,
  required: ["hooks"],
  properties: {
    hooks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "forMemberId", "nudgeText"],
        properties: {
          text: { type: "string", description: "Third person, short, specific. e.g. 'Her tomatoes came in'" },
          forMemberId: { type: "string", enum: memberIds },
          nudgeText: { type: "string" },
        },
      },
    },
  },
});

const SYSTEM = `You help a family stay close to their elderly mother/grandmother.
From a phone-call transcript, extract up to 3 "hooks": small, specific, warm things a family member would enjoy asking her about
(e.g. "Her tomatoes came in", "She's worried about Buddy's vet visit", "She finished the quilt for the church sale").
Rules (strict):
- NO health, medical, medication, pharmacy, doctor, or symptom details. Skip them entirely.
- NO complaints about any family member. NO money, purchases, scams, or fraud topics.
- Only use what the transcript says. Never invent details.
- Route each hook to the ONE family member who would care most, using the relationship notes.
- Never mention a family code word or password, even if she says one.
- nudgeText: 1-2 warm sentences to that member that call her by her name, mention the hook, and suggest a call. Never guilt:
  never say or imply they haven't called, "it's been a while", "she's lonely", etc. Light and specific.
Return JSON only.`;

function transcriptText(turns: TranscriptTurn[], seniorName: string, members: Member[]): string {
  return turns.map((t) => {
    const who = t.speaker === "senior" ? seniorName : t.speaker === "agent" ? "Care Circle" : (members.find((m) => m.id === t.speaker)?.name ?? "Family");
    return `${who}: ${t.text}`;
  }).join("\n");
}

// ---- Deterministic fallback (MOCK / Muse unavailable) ----
const HOOK_PATTERNS = [
  /came in/i, /bloom/i, /finished/i, /started/i, /worried about/i, /excited/i, /can'?t wait/i, /planted/i,
  /\bbaked?\b/i, /\bmade\b/i, /\bsaw\b/i, /birthday/i, /recital/i, /\bgame\b/i, /\bfeeder\b/i,
  /crossword/i, /quilt/i, /visit/i, /looking forward/i, /first time/i, /\bpie\b/i,
];

function toThirdPerson(sentence: string): string {
  let s = sentence.trim().replace(/[.!]+$/, "");
  s = s.replace(/^(oh|well|so|and|you know|guess what)[,!]?\s+/i, "");
  const map: [RegExp, string][] = [
    [/\bI'm\b/g, "she's"], [/\bI am\b/g, "she is"], [/\bI've\b/g, "she's"], [/\bI'll\b/g, "she'll"],
    [/\bI was\b/g, "she was"], [/\bI\b/g, "she"], [/\bmy\b/gi, "her"], [/\bme\b/g, "her"], [/\bmine\b/g, "hers"], [/\bmyself\b/g, "herself"],
  ];
  for (const [re, rep] of map) s = s.replace(re, rep);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function scoreMember(text: string, memberId: string): number {
  const lower = text.toLowerCase();
  return RELATIONSHIP_FACTS.filter((f) => f.memberId === memberId)
    .reduce((n, f) => n + f.keywords.filter((k) => new RegExp(`\\b${k}`, "i").test(lower)).length, 0);
}

function fallbackNudge(seniorName: string, hookText: string): string {
  const lowered = hookText.charAt(0).toLowerCase() + hookText.slice(1);
  return `${seniorName} mentioned that ${lowered}. She'd love to tell you about it. Maybe give her a call this week?`;
}

function fallbackExtract(turns: TranscriptTurn[], seniorName: string, members: Member[], fallbackOrder: string[]): Candidate[] {
  const sentences = turns.filter((t) => t.speaker === "senior")
    .flatMap((t) => t.text.split(/(?<=[.!?])\s+/))
    .filter((s) => s.length > 8 && s.length < 180 && HOOK_PATTERNS.some((re) => re.test(s)));
  const out: Candidate[] = [];
  for (const s of sentences) {
    const text = toThirdPerson(s);
    if (!hookTextAllowed(text)) continue;
    const ranked = members.map((m) => ({ id: m.id, score: scoreMember(text, m.id) })).sort((a, b) => b.score - a.score);
    const forMemberId = ranked[0].score > 0 ? ranked[0].id : fallbackOrder[0];
    out.push({ text, forMemberId, nudgeText: fallbackNudge(seniorName, text) });
    if (out.length >= 3) break;
  }
  return out;
}

async function sentNudgeToday(deps: Deps, member: Member): Promise<boolean> {
  const today = DateTime.fromJSDate(deps.clock.now()).setZone(member.tz).toISODate();
  const nudges = await deps.store.messages.list({ toMemberId: member.id, kind: "nudge" });
  return nudges.some((n) => DateTime.fromISO(n.createdAt).setZone(member.tz).toISODate() === today);
}

export interface PipelineResult { hooks: Hook[]; nudgesSent: number; dropped: number; }

/** call.ended → hooks → nudges. privateSpans are stripped before anything else sees the transcript. */
export async function runPostCallPipeline(deps: Deps, call: CallEnded): Promise<PipelineResult> {
  // 1. Privacy first. Nothing below this line may read call.transcript.
  const stripped: Stripped = stripPrivate(call);
  const turns = stripped.publicTurns;
  if (call.kind === "verification" || turns.length === 0) return { hooks: [], nudgesSent: 0, dropped: 0 };

  const { senior, members } = await getCircle(deps, call.seniorId);
  const rhythm = await computeContactRhythm(deps, call.seniorId);
  // Least-recently-in-touch first: tie-breaker for hooks with no obvious owner.
  const fallbackOrder = [...rhythm.perMember]
    .sort((a, b) => (a.lastContactAt ?? "").localeCompare(b.lastContactAt ?? ""))
    .map((p) => p.memberId);

  // 2. Extract (Muse) or fall back.
  let candidates: Candidate[] | null = null;
  if (deps.muse.enabled) {
    const relationships = members.map((m) => {
      const facts = RELATIONSHIP_FACTS.filter((f) => f.memberId === m.id).map((f) => f.fact).join(" ");
      return `- ${m.id} (${m.name}, ${senior.name}'s ${m.relation}): ${facts}`;
    }).join("\n");
    const res = await deps.muse.json<{ hooks: Candidate[] }>({
      name: "extract_hooks",
      schema: EXTRACT_SCHEMA(members.map((m) => m.id)),
      timeoutMs: 40_000, // async webhook work: nobody is waiting
      system: SYSTEM,
      user: `Senior: ${senior.name}\nFamily:\n${relationships}\n\nTranscript:\n${transcriptText(turns, senior.name, members)}`,
    });
    candidates = res?.hooks ?? null;
  }
  if (!candidates) candidates = fallbackExtract(turns, senior.name, members, fallbackOrder);

  // 3. Code-side filters: content rules + private-leak check (model output is never trusted blindly).
  const memberIds = new Set(members.map((m) => m.id));
  let dropped = 0;
  const kept: Candidate[] = [];
  for (const c of candidates.slice(0, 3)) {
    if (!memberIds.has(c.forMemberId) || !hookTextAllowed(c.text) || leaksPrivate(c.text, stripped)) { dropped++; continue; }
    let nudgeText = c.nudgeText;
    if (!nudgeText || hasGuilt(nudgeText) || !hookTextAllowed(nudgeText) || leaksPrivate(nudgeText, stripped)) {
      nudgeText = fallbackNudge(senior.name, c.text);
    }
    kept.push({ ...c, nudgeText });
  }

  // 4. Store + nudge (max 1 nudge per member per local day).
  const hooks: Hook[] = [];
  let nudgesSent = 0;
  for (const c of kept) {
    const member = members.find((m) => m.id === c.forMemberId)!;
    const canNudge = !(await sentNudgeToday(deps, member));
    const rec: HookRecord = {
      id: newId("hook"), seniorId: call.seniorId, text: c.text, forMemberId: c.forMemberId,
      nudgeText: c.nudgeText, createdAt: deps.clock.now().toISOString(),
      sourceCallId: call.callId, nudgeSent: canNudge,
    };
    await deps.store.hooks.put(rec);
    if (canNudge) {
      await sendMessage(deps, {
        toMemberId: member.id, kind: "nudge", body: c.nudgeText,
        actions: [
          { label: `Call ${senior.name}`, action: "call_now", payload: { hookId: rec.id } },
          { label: "Not now", action: "dismiss", payload: { hookId: rec.id } },
        ],
      });
      nudgesSent++;
    }
    hooks.push(toHook(rec));
  }
  return { hooks, nudgesSent, dropped };
}

export function toHook(r: HookRecord): Hook {
  return { id: r.id, seniorId: r.seniorId, text: r.text, forMemberId: r.forMemberId, nudgeText: r.nudgeText, createdAt: r.createdAt };
}

/** Recent hooks for briefings (already consent-filtered at extraction time). */
export async function recentHooks(deps: Deps, seniorId: string, days = 14, limit = 3): Promise<HookRecord[]> {
  const since = deps.clock.now().getTime() - days * 24 * 3600 * 1000;
  return (await deps.store.hooks.list({ seniorId }))
    .filter((h) => Date.parse(h.createdAt) >= since)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}
