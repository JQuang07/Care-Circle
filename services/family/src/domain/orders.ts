import type { Order } from "../contracts-local.js";
import type { Deps } from "../deps.js";
import { badRequest } from "../deps.js";
import { newId } from "../ids.js";
import { CREDENTIAL_FUNDED_BY, MERCHANTS } from "../seed-data.js";
import type { VoiceNoteRecord } from "../store/types.js";
import { getCircle } from "./circle.js";
import { sendMessage } from "./messages.js";
import { once } from "./once.js";

export function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function itemSummary(order: Order): string {
  const names = (order.request.items ?? []).map((i) => i.name.toLowerCase());
  if (names.length === 0) return "";
  if (names.length <= 3) return ` (${names.join(", ")})`;
  return ` (${names.slice(0, 3).join(", ")} + ${names.length - 3} more)`;
}

/** order.paid → receipts for funders; groceries → "add something?" to the whole circle. */
export async function handleOrderPaid(deps: Deps, order: Order): Promise<void> {
  if (!order?.id || !order.seniorId || !order.request) throw badRequest("invalid Order payload");
  if (!(await once(deps, `order-paid:${order.id}`))) return;
  const { senior, members } = await getCircle(deps, order.seniorId);
  const merchant = order.request.merchantId ? MERCHANTS[order.request.merchantId]?.name : undefined;
  const at = merchant ?? order.request.payeeDescription ?? "the store";

  if (order.request.type === "gift") {
    await deps.store.moments.put({ id: newId("evt"), seniorId: senior.id, type: "gift", at: deps.clock.now().toISOString(), amountCents: order.request.amountCents, ref: order.id });
  }

  for (const funderId of CREDENTIAL_FUNDED_BY.filter((id) => members.some((m) => m.id === id))) {
    await sendMessage(deps, {
      toMemberId: funderId, kind: "receipt",
      body: `Receipt: ${senior.name} paid ${dollars(order.request.amountCents)} at ${at}${itemSummary(order)}. Paid from the family card.`,
      ...(order.receiptUrl ? { mediaUrl: order.receiptUrl } : {}),
    });
  }

  if (order.request.type === "groceries") {
    for (const m of members) {
      await sendMessage(deps, {
        toMemberId: m.id, kind: "add_to_order",
        body: `${senior.name} just ordered groceries from ${at}${itemSummary(order)}. Want to send a voice note with the delivery? She'd love to hear from you.`,
        actions: [
          // v1 has no add-items backend: the button is shown but labelled as coming soon.
          { label: "Add something (coming soon)", action: "add_item", payload: { orderId: order.id, comingSoon: true } },
          { label: "Record a voice note for delivery", action: "record_voice_note", payload: { orderId: order.id } },
        ],
      });
    }
  }
}

export async function attachVoiceNote(deps: Deps, input: { orderId: string; memberId: string; url: string }): Promise<VoiceNoteRecord> {
  if (!input.url) throw badRequest("voiceNoteUrl is required", "VOICE_NOTE_URL_REQUIRED");
  const rec: VoiceNoteRecord = { id: newId("vn"), orderId: input.orderId, memberId: input.memberId, url: input.url, createdAt: deps.clock.now().toISOString() };
  await deps.store.voiceNotes.put(rec);
  const found = (await deps.store.circle.list()).find((c) => c.members.some((m) => m.id === input.memberId));
  if (found) {
    await deps.store.moments.put({ id: newId("evt"), seniorId: found.senior.id, type: "voice_note", at: rec.createdAt, ref: rec.id });
  }
  return rec;
}

export async function voiceNotesForOrder(deps: Deps, orderId: string) {
  const notes = await deps.store.voiceNotes.list({ orderId });
  const circles = await deps.store.circle.list();
  const name = (id: string) => circles.flatMap((c) => c.members).find((m) => m.id === id)?.name ?? id;
  return notes.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((n) => ({ ...n, memberName: name(n.memberId) }));
}

/** Most recent grocery order this member was offered a voice note for (last 48h). */
export async function latestVoiceNoteOrder(deps: Deps, memberId: string): Promise<string | undefined> {
  const since = deps.clock.now().getTime() - 48 * 3600_000;
  const msgs = (await deps.store.messages.list({ toMemberId: memberId, kind: "add_to_order" }))
    .filter((m) => Date.parse(m.createdAt) >= since)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return msgs[0]?.actions?.find((a) => a.action === "record_voice_note")?.payload?.orderId;
}
