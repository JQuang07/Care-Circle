import type { Message, MessageAction, MessageKind } from "../contracts-local.js";
import type { Deps } from "../deps.js";
import { AppError, badRequest } from "../deps.js";
import { newId } from "../ids.js";
import { findMember } from "./circle.js";
import { redactCodeWord } from "./codeword.js";

export interface OutgoingMessage {
  toMemberId: string;
  kind: MessageKind;
  body: string;
  actions?: MessageAction[];
  mediaUrl?: string;
  fromMemberId?: string;
  direction?: "out" | "in";
}

/**
 * The single write path for messages. Rule 3 (CONTRACTS §7): nobody under 18 is ever messaged,
 * so the recipient must be a circle member. Dependents are not members and have no id, so this rejects them.
 */
export async function sendMessage(deps: Deps, m: OutgoingMessage): Promise<Message> {
  const found = await findMember(deps, m.toMemberId);
  if (!found) throw new AppError(422, "NOT_A_MEMBER", `refusing to message ${m.toMemberId}: not a circle member`);
  const msg: Message = {
    id: newId("msg"),
    toMemberId: m.toMemberId,
    ...(m.fromMemberId ? { fromMemberId: m.fromMemberId } : {}),
    direction: m.direction ?? "out",
    kind: m.kind,
    // Outbound text never contains the family code word; inbound is stored as the member wrote it.
    body: (m.direction ?? "out") === "out" ? redactCodeWord(m.body) : m.body,
    ...(m.actions?.length ? { actions: m.actions } : {}),
    ...(m.mediaUrl ? { mediaUrl: m.mediaUrl } : {}),
    createdAt: deps.clock.now().toISOString(),
  };
  await deps.store.messages.put(msg);
  return msg;
}

export async function listMessages(deps: Deps, memberId: string): Promise<Message[]> {
  if (!memberId) throw badRequest("memberId is required");
  if (!(await findMember(deps, memberId))) throw new AppError(404, "NOT_FOUND", `member ${memberId} not found`);
  const msgs = await deps.store.messages.list({ toMemberId: memberId });
  return msgs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
