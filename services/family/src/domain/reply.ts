import type { Message } from "../contracts-local.js";
import type { Deps } from "../deps.js";
import { AppError, badRequest } from "../deps.js";
import type { AvailabilityBlock } from "../seed-data.js";
import { findMember } from "./circle.js";
import { sendMessage } from "./messages.js";
import { attachVoiceNote, latestVoiceNoteOrder } from "./orders.js";
import { requestSchedule } from "./scheduling/proposals.js";

interface Intent {
  intent: "schedule" | "availability" | "other";
  kind: "video_call" | "visit";
  withNames: string[];
  includeKids: boolean;
  preferredWindow: string;
  availability: AvailabilityBlock[];
}

const INTENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["intent", "kind", "withNames", "includeKids", "preferredWindow", "availability"],
  properties: {
    intent: { type: "string", enum: ["schedule", "availability", "other"] },
    kind: { type: "string", enum: ["video_call", "visit"] },
    withNames: { type: "array", items: { type: "string" } },
    includeKids: { type: "boolean" },
    preferredWindow: { type: "string" },
    availability: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["days", "start", "end"],
        properties: { days: { type: "string" }, start: { type: "string" }, end: { type: "string" } },
      },
    },
  },
};

const SCHEDULE_RE = /\b(set ?up|schedule|arrange|plan|book|organi[sz]e|find a time)\b.*\b(call|video|facetime|chat|visit)\b|\b(call|visit) with (mom|mum|grandma|nana|rose)\b|\bsee (mom|mum|grandma|nana|rose)\b/i;

function fallbackIntent(body: string, names: string[]): Intent {
  const schedule = SCHEDULE_RE.test(body);
  const withNames = names.filter((n) => new RegExp(`\\b${n}\\b`, "i").test(body));
  if (/\b(everyone|whole family|all of us)\b/i.test(body)) withNames.push("everyone");
  const pref = body.match(/\b(this weekend|next week|weekend|weekday|(mon|tues|wednes|thurs|fri|satur|sun)day|morning|afternoon|evening)\b[^.,!?]*/i)?.[0] ?? "";
  return {
    intent: schedule ? "schedule" : "other",
    kind: /\bvisit\b/i.test(body) ? "visit" : "video_call",
    withNames,
    includeKids: /\b(mia|kids?|we|us)\b/i.test(body),
    preferredWindow: pref,
    availability: [],
  };
}

/** Inbound WhatsApp-mock message: store it, then act on it (schedule request, poll reply, voice note). */
export async function handleReply(deps: Deps, body: { fromMemberId: string; body?: string; voiceNoteUrl?: string }): Promise<Message> {
  if (!body?.fromMemberId) throw badRequest("fromMemberId is required");
  const found = await findMember(deps, body.fromMemberId);
  if (!found) throw new AppError(404, "NOT_FOUND", `member ${body.fromMemberId} not found`);
  const text = (body.body ?? "").trim();
  if (!text && !body.voiceNoteUrl) throw badRequest("body or voiceNoteUrl is required");
  const { member, senior } = found;

  const inbound = await sendMessage(deps, {
    toMemberId: member.id, fromMemberId: member.id, direction: "in",
    kind: body.voiceNoteUrl ? "voice_note" : "text", body: text || "Voice note", mediaUrl: body.voiceNoteUrl,
  });

  if (body.voiceNoteUrl) {
    const orderId = await latestVoiceNoteOrder(deps, member.id);
    if (orderId) {
      await attachVoiceNote(deps, { orderId, memberId: member.id, url: body.voiceNoteUrl });
      await sendMessage(deps, { toMemberId: member.id, kind: "text", body: `Got it! Your voice note will play for ${senior.name} when the groceries arrive.` });
    }
    if (!text) return inbound;
  }

  const circle = await deps.store.circle.get(senior.id);
  const names = (circle?.members ?? []).filter((m) => m.id !== member.id).map((m) => m.name);
  let intent: Intent | null = null;
  if (deps.muse.enabled) {
    intent = await deps.muse.json<Intent>({
      name: "parse_reply",
      schema: INTENT_SCHEMA,
      timeoutMs: 12_000,
      effort: "low",
      system: `Classify a family member's WhatsApp message to Care Circle, the helper for their mother/grandmother ${senior.name}.
intent=schedule if they want to set up a call or visit with ${senior.name}. intent=availability if they are telling us when they're free.
withNames: other family members they want included (from: ${names.join(", ")}; use "everyone" for the whole family).
includeKids: true if they mention their kids / Mia / "we". preferredWindow: their time preference in a few words, or "".
availability: weekly blocks in THEIR local time, days like "mon-fri" or "sat-sun", times "HH:MM" 24h. Empty unless intent=availability.`,
      user: text,
    });
  }
  if (!intent) intent = fallbackIntent(text, names);

  if (intent.intent === "schedule") {
    try {
      await requestSchedule(deps, {
        seniorId: senior.id, kind: intent.kind, memberIds: [member.id, ...intent.withNames],
        includeDependents: intent.includeKids && !!member.dependents?.length,
        initiatedBy: "member", preferredWindow: intent.preferredWindow || undefined,
      }, { requestedBy: member.id });
    } catch (err) {
      const msg = err instanceof AppError && err.code === "NO_SLOTS"
        ? `I couldn't find a time that fits ${senior.name}'s routine this week. Could you suggest a day?`
        : `Sorry, I couldn't set that up just now. Could you try again in a minute?`;
      await sendMessage(deps, { toMemberId: member.id, kind: "text", body: msg });
      deps.log.warn({ err: String(err) }, "reply → schedule request failed");
    }
  } else if (intent.intent === "availability" && intent.availability.length) {
    const valid = intent.availability.filter((b) => /^\d{1,2}:\d{2}$/.test(b.start) && /^\d{1,2}:\d{2}$/.test(b.end) && b.days);
    if (valid.length) {
      await deps.store.availability.put({ id: member.id, blocks: valid, updatedAt: deps.clock.now().toISOString() });
      await sendMessage(deps, { toMemberId: member.id, kind: "text", body: `Thanks! I'll use those times when planning calls with ${senior.name}.` });
    }
  }
  return inbound;
}
