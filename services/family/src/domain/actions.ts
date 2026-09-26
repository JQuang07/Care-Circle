import type { Message } from "../contracts-local.js";
import type { Deps } from "../deps.js";
import { badRequest, notFound } from "../deps.js";
import { findMember } from "./circle.js";
import { fraudAction } from "./fraud.js";
import { makeWeekly } from "./jobs.js";
import { sendMessage } from "./messages.js";
import { attachVoiceNote } from "./orders.js";
import { declineAll, requestSchedule, respondToProposal } from "./scheduling/proposals.js";

/** D5: keys a client may add to a button's stored payload (the stored payload is authoritative and wins). */
const CLIENT_KEYS = ["voiceNoteUrl", "passkeyAssertion", "note", "slotId"];

/** Pre-D5 names, still accepted so buttons on messages stored before the rename keep working. */
const LEGACY: Record<string, string> = {
  schedule_accept: "accept_slot",
  schedule_decline_all: "decline_all",
  fraud_calling: "calling_her",
  fraud_cancel: "cancel_hold",
  fraud_approve_passkey: "release_hold",
  call_senior: "call_now",
};
const canonical = (action: string) => LEGACY[action] ?? action;

function resolveAction(msg: Message, action: string, clientPayload: any) {
  const options = (msg.actions ?? []).filter((a) => canonical(a.action) === action);
  if (options.length === 0) throw badRequest(`message ${msg.id} has no "${action}" button`, "UNKNOWN_ACTION");
  const chosen = options.find((a) => clientPayload?.slotId && a.payload?.slotId === clientPayload.slotId) ?? options[0];
  const extras = Object.fromEntries(Object.entries(clientPayload ?? {}).filter(([k]) => CLIENT_KEYS.includes(k)));
  return { ...extras, ...chosen.payload };
}

export async function actOnMessage(deps: Deps, messageId: string, body: { action: string; payload?: any }): Promise<unknown> {
  const msg = await deps.store.messages.get(messageId);
  if (!msg) throw notFound(`message ${messageId}`);
  if (!body?.action) throw badRequest("action is required");
  const actor = msg.toMemberId;
  const action = canonical(body.action);
  const payload = resolveAction(msg, action, body.payload);

  switch (action) {
    case "accept_slot":
      return respondToProposal(deps, payload.proposalId, { memberId: actor, slotId: payload.slotId, accept: true });
    case "schedule_decline":
      return respondToProposal(deps, payload.proposalId, { memberId: actor, slotId: payload.slotId, accept: false });
    case "decline_all":
      return declineAll(deps, payload.proposalId, actor);
    case "schedule_request":
      return requestSchedule(deps, { seniorId: payload.seniorId, kind: payload.kind ?? "video_call", memberIds: [actor], initiatedBy: "member" }, { requestedBy: actor });
    case "call_now": {
      // A briefing's button opens the video room; a nudge's button dials Rose.
      if (payload.url) return { ok: true, url: payload.url };
      const found = await findMember(deps, actor);
      return { ok: true, dial: found?.senior.phone };
    }
    case "dismiss":
      return { ok: true };
    case "add_item":
      return { ok: false, comingSoon: true, message: "Adding items to an order is coming soon. You can still send a voice note!" };
    case "record_voice_note": {
      if (!payload.voiceNoteUrl) return { ok: true, next: "record", orderId: payload.orderId, hint: "Record audio, upload it, then resend this action with payload.voiceNoteUrl." };
      const note = await attachVoiceNote(deps, { orderId: payload.orderId, memberId: actor, url: payload.voiceNoteUrl });
      await sendMessage(deps, { toMemberId: actor, fromMemberId: actor, direction: "in", kind: "voice_note", body: "Voice note for the delivery", mediaUrl: note.url });
      return { ok: true, voiceNote: note };
    }
    case "calling_her":
    case "cancel_hold":
    case "release_hold":
      return fraudAction(deps, action, actor, payload);
    case "make_weekly":
      return makeWeekly(deps, payload.scheduledCallId, actor);
    case "decline_weekly":
      return { ok: true };
    case "open_url":
      return { ok: true, url: payload.url };
    default:
      throw badRequest(`unknown action ${body.action}`, "UNKNOWN_ACTION");
  }
}
