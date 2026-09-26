import type { Hook, Message, Proposal, ScheduledCall, Member, Senior } from "../contracts-local.js";
import type { AvailabilityBlock, CallRecord } from "../seed-data.js";

export interface Collection<T extends { id: string }> {
  get(id: string): Promise<T | undefined>;
  /** Upsert by id. */
  put(doc: T): Promise<T>;
  /** Equality filter on top-level fields; returns docs in insertion order. */
  list(filter?: Partial<Record<keyof T & string, string | number | boolean>>): Promise<T[]>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
}

export interface CircleDoc { id: string; senior: Senior; members: Member[]; }

export interface HookRecord extends Hook { sourceCallId: string; nudgeSent: boolean; }

export interface ProposalRecord extends Proposal {
  createdAt: string;
  durationMin: number;
  /** Earlier rounds' slot start times, so re-plans don't repeat declined slots. */
  excludedStarts: string[];
  round: number;
  flexNote?: string;
}

export interface ScheduledCallRecord extends ScheduledCall {
  kind: "video_call" | "visit";
  endUtc: string;
  createdAt: string;
  hostMemberId?: string;
  memberJoinUrls: Record<string, string>;
  briefingSentAt?: string;
  reminderSentAt?: string;
  dueSentAt?: string;
  endedAt?: string;
  weeklyOfferSentAt?: string;
}

export interface VoiceNoteRecord { id: string; orderId: string; memberId: string; url: string; createdAt: string; }

export type MomentType = "call" | "voice_note" | "gift" | "added_item" | "scam_stopped";
export interface MomentEvent {
  id: string; seniorId: string; type: MomentType; at: string;
  amountCents?: number; ref?: string;
}

export interface AvailabilityDoc { id: string /* mem_ id */; blocks: AvailabilityBlock[]; updatedAt: string; }

/** Things for the voice agent to mention on Rose's next call (e.g. visit → groceries for lunch). */
export interface SeniorHint { id: string; seniorId: string; text: string; createdAt: string; ref?: string; }

export interface HoldRecord { id: string; orderId: string; seniorId: string; amountCents: number; status: string; createdAt: string; resolvedAt?: string; }

export interface ProcessedDoc { id: string; at: string; }

export interface Store {
  circle: Collection<CircleDoc>;
  calls: Collection<CallRecord>;
  messages: Collection<Message>;
  hooks: Collection<HookRecord>;
  proposals: Collection<ProposalRecord>;
  scheduledCalls: Collection<ScheduledCallRecord>;
  voiceNotes: Collection<VoiceNoteRecord>;
  moments: Collection<MomentEvent>;
  availability: Collection<AvailabilityDoc>;
  seniorHints: Collection<SeniorHint>;
  holds: Collection<HoldRecord>;
  /** Idempotency keys for webhook side effects. */
  processed: Collection<ProcessedDoc>;
  kind: "memory" | "postgres";
  close(): Promise<void>;
}

export const COLLECTIONS = [
  "circle", "calls", "messages", "hooks", "proposals", "scheduledCalls",
  "voiceNotes", "moments", "availability", "seniorHints", "holds", "processed",
] as const;
export type CollectionName = typeof COLLECTIONS[number];
