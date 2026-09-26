import type { Member, Proposal, ScheduleRequestBody, ScheduledCall, Slot } from "../../contracts-local.js";
import type { Deps } from "../../deps.js";
import { AppError, badRequest, conflict, notFound } from "../../deps.js";
import { newId } from "../../ids.js";
import type { ProposalRecord, ScheduledCallRecord } from "../../store/types.js";
import { getCircle, memberName } from "../circle.js";
import { sendMessage } from "../messages.js";
import { formatLocal, formatLocalLong } from "../time.js";
import { buildConstraints, checkSlot, DURATION_MIN } from "./constraints.js";
import { planSlots } from "./planner.js";

const MAX_ROUNDS = 3;

// ---- contract projections (internal fields never leak into API responses) ----
export function toProposal(p: ProposalRecord): Proposal {
  return {
    id: p.id, seniorId: p.seniorId, kind: p.kind, memberIds: p.memberIds, includesDependents: p.includesDependents,
    initiatedBy: p.initiatedBy, slots: p.slots, responses: p.responses, status: p.status,
    ...(p.confirmedSlotId ? { confirmedSlotId: p.confirmedSlotId } : {}),
    ...(p.scheduledCallId ? { scheduledCallId: p.scheduledCallId } : {}),
  };
}

export function toScheduledCall(s: ScheduledCallRecord): ScheduledCall {
  return {
    id: s.id, proposalId: s.proposalId, seniorId: s.seniorId, memberIds: s.memberIds, startUtc: s.startUtc,
    roomName: s.roomName, roomJoinUrl: s.roomJoinUrl, seniorJoin: s.seniorJoin,
    ...(s.recurring ? { recurring: s.recurring } : {}),
    status: s.status,
  };
}

const EVERYONE = /^(everyone|all|family|the family|the kids|kids|children|grandkids|grandchildren)$/i;

/** Accepts ids or names (the voice agent's `who` may be names). Dependents resolve to their parent. */
function resolveWho(members: Member[], raw: string[] | undefined, includeDependents: boolean | undefined) {
  let includeDeps = !!includeDependents;
  if (!raw || raw.length === 0) return { memberIds: members.map((m) => m.id), includeDeps };
  const ids = new Set<string>();
  for (const w of raw) {
    const s = String(w).trim();
    const byId = members.find((m) => m.id === s);
    const byName = members.find((m) => m.name.toLowerCase() === s.toLowerCase());
    const parent = members.find((m) => m.dependents?.some((d) => d.name.toLowerCase() === s.toLowerCase()));
    if (byId || byName) ids.add((byId ?? byName)!.id);
    else if (parent) { ids.add(parent.id); includeDeps = true; }
    else if (EVERYONE.test(s)) { members.forEach((m) => ids.add(m.id)); if (/kid|child|grand/i.test(s)) includeDeps = true; }
    else throw badRequest(`unknown member "${s}"`, "UNKNOWN_MEMBER");
  }
  return { memberIds: [...ids], includeDeps };
}

function slotLines(slots: Slot[], member: Member): string {
  return slots.map((s, i) => `${i + 1}. ${s.localTimes[member.id]} your time: ${s.reason}`).join("\n");
}

function slotActions(p: ProposalRecord, member: Member) {
  return [
    ...p.slots.map((s) => ({ label: s.localTimes[member.id], action: "schedule_accept", payload: { proposalId: p.id, slotId: s.id } })),
    { label: "None of these work", action: "schedule_decline_all", payload: { proposalId: p.id } },
  ];
}

async function sendProposalMessages(deps: Deps, p: ProposalRecord, intro: (m: Member) => string) {
  const { members } = await getCircle(deps, p.seniorId);
  for (const id of p.memberIds) {
    const m = members.find((x) => x.id === id)!;
    const body = `${intro(m)}\n\n${slotLines(p.slots, m)}${p.flexNote ? `\n\n${p.flexNote}` : ""}\n\nTap the times that work for you.`;
    await sendMessage(deps, { toMemberId: m.id, kind: "schedule_proposal", body, actions: slotActions(p, m) });
  }
}

function introFor(p: ProposalRecord, seniorName: string, members: Member[], requestedBy?: string) {
  const what = p.kind === "visit" ? "a visit" : "a video call";
  const withKids = p.includesDependents.length ? ` (with ${p.includesDependents.join(" and ")})` : "";
  return (m: Member) => {
    if (p.initiatedBy === "senior") return `${seniorName} said she'd love to see everyone! Let's find a time for ${what}${withKids}.`;
    if (p.initiatedBy === "ai_rhythm") return `Want to set up a ${what.replace("a ", "")} with ${seniorName}? Here are a few times that work.`;
    const by = requestedBy && requestedBy !== m.id ? memberName(members, requestedBy) : "You";
    return `${by} asked to set up ${what} with ${seniorName}${withKids}. Here are times that work for everyone.`;
  };
}

export interface RequestOptions { requestedBy?: string; }

export async function requestSchedule(deps: Deps, body: ScheduleRequestBody, opts: RequestOptions = {}): Promise<Proposal> {
  if (!body?.seniorId) throw badRequest("seniorId is required");
  const kind = body.kind ?? "video_call";
  if (kind !== "video_call" && kind !== "visit") throw badRequest("kind must be video_call or visit");
  const initiatedBy = body.initiatedBy ?? "member";
  if (!["senior", "member", "ai_rhythm"].includes(initiatedBy)) throw badRequest("invalid initiatedBy");
  const { senior, members } = await getCircle(deps, body.seniorId);
  let { memberIds, includeDeps } = resolveWho(members, body.memberIds, body.includeDependents);
  if (opts.requestedBy && !memberIds.includes(opts.requestedBy)) memberIds.unshift(opts.requestedBy);
  // Dependents are only ever reached through their parent: including them means including the parent.
  if (includeDeps) {
    const parents = members.filter((m) => m.dependents?.length);
    if (!memberIds.some((id) => parents.some((p) => p.id === id))) memberIds.push(...parents.map((p) => p.id));
  }
  const includesDependents = includeDeps
    ? members.filter((m) => memberIds.includes(m.id)).flatMap((m) => (m.dependents ?? []).map((d) => d.name))
    : [];

  const now = deps.clock.now();
  const record: ProposalRecord = {
    id: newId("prop"), seniorId: senior.id, kind, memberIds, includesDependents, initiatedBy,
    slots: [], responses: [], status: "proposed",
    createdAt: now.toISOString(), durationMin: DURATION_MIN[kind], excludedStarts: [], round: 1,
  };
  const constraints = await buildConstraints(deps, { senior, members, memberIds, includeDependents: includesDependents.length > 0, kind, now });
  const plan = await planSlots(deps.muse, constraints, { preferredWindow: body.preferredWindow, now: now.getTime() });
  if (plan.slots.length === 0) {
    throw new AppError(422, "NO_SLOTS", "No time in the next week satisfies Rose's routine and the requested constraints.");
  }
  record.slots = plan.slots;
  record.flexNote = plan.flexNote;
  await deps.store.proposals.put(record);
  await sendProposalMessages(deps, record, introFor(record, senior.name, members, opts.requestedBy));
  return toProposal(record);
}

async function loadProposal(deps: Deps, id: string): Promise<ProposalRecord> {
  const p = await deps.store.proposals.get(id);
  if (!p) throw notFound(`proposal ${id}`);
  return p;
}

function commonSlots(p: ProposalRecord): Slot[] {
  return p.slots.filter((s) => p.memberIds.every((m) => p.responses.some((r) => r.memberId === m && r.slotId === s.id && r.accept)));
}

function deadSlots(p: ProposalRecord): Slot[] {
  return p.slots.filter((s) => p.responses.some((r) => r.slotId === s.id && !r.accept));
}

/** Everyone declined every option: re-plan with fresh slots (up to MAX_ROUNDS). */
async function replan(deps: Deps, p: ProposalRecord): Promise<void> {
  const { senior, members } = await getCircle(deps, p.seniorId);
  p.excludedStarts.push(...p.slots.map((s) => s.startUtc));
  if (p.round >= MAX_ROUNDS) {
    for (const id of p.memberIds) {
      await sendMessage(deps, { toMemberId: id, kind: "text", body: `We couldn't find a time that works for everyone this week. Reply with a day and time that suits you and I'll check it against ${senior.name}'s routine.` });
    }
    return;
  }
  const now = deps.clock.now();
  const c = await buildConstraints(deps, {
    senior, members, memberIds: p.memberIds, includeDependents: p.includesDependents.length > 0,
    kind: p.kind, now, excludedStarts: p.excludedStarts,
  });
  const plan = await planSlots(deps.muse, c, { now: now.getTime() });
  if (plan.slots.length === 0) return;
  p.round += 1;
  p.slots = plan.slots;
  p.flexNote = plan.flexNote;
  p.responses = [];
  p.status = "proposed";
  await sendProposalMessages(deps, p, () => `Thanks! None of those worked, so here are some new options for ${senior.name}.`);
}

export async function respondToProposal(deps: Deps, id: string, body: { memberId: string; slotId: string; accept: boolean }): Promise<Proposal> {
  const p = await loadProposal(deps, id);
  if (!body?.memberId || !body.slotId || typeof body.accept !== "boolean") throw badRequest("memberId, slotId and accept are required");
  if (!p.memberIds.includes(body.memberId)) throw new AppError(403, "NOT_INVITED", `${body.memberId} is not part of this proposal`);
  if (!p.slots.some((s) => s.id === body.slotId)) throw badRequest(`slot ${body.slotId} is not in this proposal`, "UNKNOWN_SLOT");
  if (p.status === "confirmed" || p.status === "cancelled") throw conflict(`proposal is ${p.status}`, "PROPOSAL_CLOSED");

  p.responses = p.responses.filter((r) => !(r.memberId === body.memberId && r.slotId === body.slotId));
  p.responses.push({ memberId: body.memberId, slotId: body.slotId, accept: body.accept });

  const wasAwaiting = p.status === "awaiting_senior";
  const common = commonSlots(p);
  const { senior, members } = await getCircle(deps, p.seniorId);
  if (common.length) {
    p.status = "awaiting_senior";
    if (!wasAwaiting) {
      for (const mid of p.memberIds) {
        await sendMessage(deps, { toMemberId: mid, kind: "text", body: `Everyone's in for ${common[0].localTimes[mid]} (your time). I'll check with ${senior.name} on her next call and confirm.` });
      }
    }
  } else {
    p.status = "proposed";
    if (deadSlots(p).length === p.slots.length) await replan(deps, p);
  }
  await deps.store.proposals.put(p);
  return toProposal(p);
}

export async function declineAll(deps: Deps, id: string, memberId: string): Promise<Proposal> {
  const p = await loadProposal(deps, id);
  let last: Proposal = toProposal(p);
  for (const s of p.slots) last = await respondToProposal(deps, id, { memberId, slotId: s.id, accept: false });
  return last;
}

/** Fair rotation: fewest hosted so far, then least recently hosted, then circle order. */
export async function pickHost(deps: Deps, seniorId: string, memberIds: string[]): Promise<string | undefined> {
  const calls = (await deps.store.scheduledCalls.list({ seniorId })).filter((c) => c.hostMemberId);
  const stats = memberIds.map((id, order) => {
    const hosted = calls.filter((c) => c.hostMemberId === id);
    const last = hosted.map((c) => c.startUtc).sort().pop() ?? "";
    return { id, count: hosted.length, last, order };
  });
  stats.sort((a, b) => a.count - b.count || a.last.localeCompare(b.last) || a.order - b.order);
  return stats[0]?.id;
}

export interface CreateCallInput {
  proposalId: string; seniorId: string; memberIds: string[]; kind: "video_call" | "visit";
  startUtc: string; endUtc: string; recurring?: "weekly";
}

/** Creates the ScheduledCall (+ LiveKit room for video calls) and tells the family. */
export async function createScheduledCall(deps: Deps, input: CreateCallInput): Promise<ScheduledCallRecord> {
  const id = newId("sch");
  const web = deps.cfg.webUrl.replace(/\/$/, "");
  const roomName = input.kind === "visit" ? "" : `cc-${input.seniorId}-${id}`;
  if (input.kind === "video_call") {
    try {
      await deps.rooms.createRoom(roomName, { metadata: JSON.stringify({ scheduledCallId: id, seniorId: input.seniorId }) });
    } catch (err) {
      if (!deps.cfg.mock) throw new AppError(502, "LIVEKIT_UNAVAILABLE", `could not create LiveKit room: ${String(err)}`);
      deps.log.warn({ err: String(err) }, "LiveKit room creation failed (MOCK=1: continuing)");
    }
  }
  const memberJoinUrls: Record<string, string> = {};
  for (const m of input.memberIds) memberJoinUrls[m] = input.kind === "visit" ? `${web}/dashboard` : `${web}/call/${id}?member=${m}`;
  const rec: ScheduledCallRecord = {
    id, proposalId: input.proposalId, seniorId: input.seniorId, memberIds: input.memberIds,
    startUtc: input.startUtc, endUtc: input.endUtc,
    roomName, roomJoinUrl: input.kind === "visit" ? `${web}/dashboard` : `${web}/call/${id}`,
    seniorJoin: "phone_dialout", status: "scheduled",
    ...(input.recurring ? { recurring: input.recurring } : {}),
    kind: input.kind, createdAt: deps.clock.now().toISOString(),
    hostMemberId: await pickHost(deps, input.seniorId, input.memberIds),
    memberJoinUrls,
  };
  await deps.store.scheduledCalls.put(rec);
  return rec;
}

export async function confirmSenior(deps: Deps, id: string, body: { slotId: string }): Promise<ScheduledCall> {
  const p = await loadProposal(deps, id);
  if (!body?.slotId) throw badRequest("slotId is required");
  const slot = p.slots.find((s) => s.id === body.slotId);
  if (!slot) throw badRequest(`slot ${body.slotId} is not in this proposal`, "UNKNOWN_SLOT");
  if (p.status === "confirmed" && p.confirmedSlotId === slot.id && p.scheduledCallId) {
    const existing = await deps.store.scheduledCalls.get(p.scheduledCallId);
    if (existing) return toScheduledCall(existing); // idempotent retry from the voice agent
  }
  if (p.status !== "awaiting_senior") throw conflict(`proposal is ${p.status}; the family hasn't agreed on a time yet`, "NOT_AWAITING_SENIOR");
  if (!commonSlots(p).some((s) => s.id === slot.id)) throw conflict("not every invited member accepted this slot", "SLOT_NOT_AGREED");

  // Re-check hard constraints at confirm time (time passes; other calls get booked).
  const { senior, members } = await getCircle(deps, p.seniorId);
  const now = deps.clock.now();
  const c = await buildConstraints(deps, { senior, members, memberIds: p.memberIds, includeDependents: p.includesDependents.length > 0, kind: p.kind, now });
  const violations = checkSlot(c, { start: Date.parse(slot.startUtc), end: Date.parse(slot.endUtc) }, now.getTime())
    .filter((v) => v !== "outside_horizon" && !v.startsWith("member_unavailable:"));
  if (violations.length) throw conflict(`slot no longer works: ${violations.join(", ")}`, "SLOT_INVALID");

  const sc = await createScheduledCall(deps, {
    proposalId: p.id, seniorId: p.seniorId, memberIds: p.memberIds, kind: p.kind, startUtc: slot.startUtc, endUtc: slot.endUtc,
  });
  p.status = "confirmed";
  p.confirmedSlotId = slot.id;
  p.scheduledCallId = sc.id;
  await deps.store.proposals.put(p);

  const names = p.memberIds.map((m) => memberName(members, m));
  const withKids = p.includesDependents.length ? ` (and ${p.includesDependents.join(" and ")})` : "";
  for (const mid of p.memberIds) {
    const m = members.find((x) => x.id === mid)!;
    const when = formatLocalLong(slot.startUtc, m.tz);
    const host = sc.hostMemberId === mid ? "\nYou're hosting this one, so you'll say hi first." : "";
    if (p.kind === "visit") {
      await sendMessage(deps, { toMemberId: mid, kind: "text", body: `${senior.name} said yes! Visit on ${when} (your time) with ${names.join(", ")}${withKids}.` });
    } else {
      await sendMessage(deps, {
        toMemberId: mid, kind: "text",
        body: `${senior.name} said yes! Video call on ${when} (your time) with ${names.join(", ")}${withKids}. Her regular phone will ring, so no app needed on her side.${host}`,
        actions: [{ label: "Join call", action: "open_url", payload: { url: sc.memberJoinUrls[mid], scheduledCallId: sc.id } }],
      });
    }
  }
  if (p.kind === "visit") {
    // Rose-side commerce hook for the voice agent's next call.
    const who = names.join(" and ");
    await deps.store.seniorHints.put({
      id: newId("evt"), seniorId: p.seniorId, ref: sc.id, createdAt: now.toISOString(),
      text: `${who} ${names.length > 1 ? "are" : "is"} visiting ${formatLocal(slot.startUtc, senior.tz).split(" ")[0]}. Want groceries for lunch?`,
    });
  }
  return toScheduledCall(sc);
}

export async function upcoming(deps: Deps, seniorId: string): Promise<ScheduledCall[]> {
  await getCircle(deps, seniorId);
  const cutoff = deps.clock.now().getTime() - 2 * 3600_000;
  return (await deps.store.scheduledCalls.list({ seniorId }))
    .filter((c) => ["scheduled", "ringing", "live"].includes(c.status) && Date.parse(c.startUtc) >= cutoff)
    .sort((a, b) => a.startUtc.localeCompare(b.startUtc))
    .map(toScheduledCall);
}

export async function getScheduledCall(deps: Deps, id: string): Promise<ScheduledCallRecord> {
  const sc = await deps.store.scheduledCalls.get(id);
  if (!sc) throw notFound(`scheduled call ${id}`);
  return sc;
}

export async function pendingSenior(deps: Deps, seniorId: string): Promise<Proposal[]> {
  await getCircle(deps, seniorId);
  return (await deps.store.proposals.list({ seniorId, status: "awaiting_senior" })).map((p) => {
    // Put agreed slots first so the voice agent can just offer slots[0].
    const common = new Set(commonSlots(p).map((s) => s.id));
    return toProposal({ ...p, slots: [...p.slots].sort((a, b) => Number(common.has(b.id)) - Number(common.has(a.id))) });
  });
}
