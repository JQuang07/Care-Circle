import type { Message } from "../contracts-local.js";
import type { Deps } from "../deps.js";
import { badRequest, notFound } from "../deps.js";
import { findMember } from "./circle.js";
import { fraudAction } from "./fraud.js";
import { makeWeekly } from "./jobs.js";
import { sendMessage } from "./messages.js";
import { attachVoiceNote } from "./orders.js";
import { declineAll, requestSchedule, respondToProposal } from "./scheduling/proposals.js";

/** Keys a client may add to a button's stored payload (everything else comes from the stored action). */
const CLIENT_KEYS = ["voiceNoteUrl", "passkeyAssertion", "note"];

function resolveAction(msg: Message, action: string, clientPayload: any) {
  const options = (msg.actions ?? []).filter((a) => a.action === action);
  if (options.length === 0) throw badRequest(`message ${msg.id} has no "${action}" button`, "UNKNOWN_ACTION");
  const chosen = options.find((a) => clientPayload?.slotId && a.payload?.slotId === clientPayload.slotId) ?? options[0];
  const extras = Object.fromEntries(Object.entries(clientPayload ?? {}).filter(([k]) => CLIENT_KEYS.includes(k)));
  return { ...chosen.payload, ...extras };
}

export async function actOnMessage(deps: Deps, messageId: string, body: { action: string; payload?: any }): Promise<unknown> {
  const msg = await deps.store.messages.get(messageId);
  if (!msg) throw notFound(`message ${messageId}`);
  if (!body?.action) throw badRequest("action is required");
  const actor = msg.toMemberId;
  const payload = resolveAction(msg, body.action, body.payload);

  switch (body.action) {
    case "schedule_accept":
      return respondToProposal(deps, payload.proposalId, { memberId: actor, slotId: payload.slotId, accept: true });
    case "schedule_decline":
      return respondToProposal(deps, payload.proposalId, { memberId: actor, slotId: payload.slotId, accept: false });
    case "schedule_decline_all":
      return declineAll(deps, payload.proposalId, actor);
    case "schedule_request":
      return requestSchedule(deps, { seniorId: payload.seniorId, kind: payload.kind ?? "video_call", memberIds: [actor], initiatedBy: "member" }, { requestedBy: actor });
    case "call_senior": {
      const found = await findMember(deps, actor);
      return { ok: true, dial: found?.senior.phone };
    }
    case "add_item":
      return { ok: false, comingSoon: true, message: "Adding items to an order is coming soon. You can still send a voice note!" };
    case "record_voice_note": {
      if (!payload.voiceNoteUrl) return { ok: true, next: "record", orderId: payload.orderId, hint: "Record audio, upload it, then resend this action with payload.voiceNoteUrl." };
      const note = await attachVoiceNote(deps, { orderId: payload.orderId, memberId: actor, url: payload.voiceNoteUrl });
      await sendMessage(deps, { toMemberId: actor, fromMemberId: actor, direction: "in", kind: "voice_note", body: "Voice note for the delivery", mediaUrl: note.url });
      return { ok: true, voiceNote: note };
    }
    case "fraud_calling":
    case "fraud_cancel":
    case "fraud_approve_passkey":
      return fraudAction(deps, body.action, actor, payload);
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
