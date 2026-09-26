"use client";
import type { Message, Order, Slot } from "@care-circle/contracts";

type Action = NonNullable<Message["actions"]>[number];

export interface BubbleProps {
  msg: Message;
  viewerId: string;
  order?: Order;                       // for fraud_card: the paused order, if we could load it
  onAct: (msg: Message, action: Action) => void;
  pending?: string;                    // label of the button currently in flight
}

const time = (iso: string, tz: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(iso));

const LAYER_NAMES = { 1: "Rule", 2: "Scam pattern", 3: "Unusual for Rose", 4: "Family pattern" } as const;

function Buttons({ msg, onAct, pending, tone = "plain" }: Pick<BubbleProps, "msg" | "onAct" | "pending"> & { tone?: "plain" | "alarm" }) {
  if (!msg.actions?.length) return null;
  return (
    <div className="mt-2 flex flex-col divide-y divide-black/10 border-t border-black/10">
      {msg.actions.map((a) => (
        <button
          key={a.label}
          type="button"
          disabled={!!pending}
          onClick={() => onAct(msg, a)}
          className={`py-2 text-center text-[14px] font-medium disabled:opacity-50 ${tone === "alarm" ? "text-alarm" : "text-[#027eb5]"}`}
        >
          {pending === a.label ? "Sending…" : a.label}
        </button>
      ))}
    </div>
  );
}

function SlotButtons({ msg, viewerId, onAct, pending }: BubbleProps) {
  return (
    <div className="mt-2 grid gap-1.5">
      {(msg.actions ?? []).map((a) => {
        const slot: Slot | undefined = a.payload?.slot;
        const mine = slot?.localTimes[viewerId] ?? a.label;
        const rose = slot?.localTimes["sen_rose"];
        return (
          <button
            key={a.label}
            type="button"
            disabled={!!pending}
            onClick={() => onAct(msg, a)}
            className="rounded-lg border border-[#027eb5]/30 bg-white px-3 py-2 text-left disabled:opacity-50"
          >
            <span className="block text-[15px] font-semibold text-[#027eb5]">{pending === a.label ? "Sending…" : `${mine} your time`}</span>
            {rose && <span className="block text-[12.5px] text-black/60">Rose: {rose}</span>}
            {slot?.reason && <span className="block text-[12.5px] text-black/60">{slot.reason}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function MessageBubble(props: BubbleProps) {
  const { msg, viewerId, order } = props;
  const tz = { mem_lisa: "America/Chicago", mem_danny: "America/Denver", mem_mark: "Europe/London" }[viewerId] ?? "UTC";
  const mine = msg.direction === "in";
  const stamp = <span className="float-right ml-2 mt-1 text-[11px] text-black/45">{time(msg.createdAt, tz)}</span>;
  const shell = `max-w-[86%] rounded-lg px-2.5 py-1.5 text-[14.5px] leading-snug shadow-[0_1px_0.5px_rgb(0_0_0/0.13)] ${
    mine ? "self-end bg-chat-out" : "self-start bg-white"
  }`;

  switch (msg.kind) {
    case "fraud_card":
      return (
        <div className={`flag-in self-stretch overflow-hidden rounded-lg border-2 border-alarm bg-white shadow-md`}>
          <div className="flex items-center gap-2 bg-alarm px-3 py-1.5 text-[13px] font-semibold text-white">
            <span aria-hidden>⚑</span> Purchase paused
          </div>
          <div className="px-3 py-2 text-[14.5px] leading-snug">
            <p>{msg.body}</p>
            {order && order.fraud.signals.length > 0 && (
              <ul className="mt-2 space-y-1 border-l-2 border-alarm/40 pl-2 text-[13px] text-black/75">
                {order.fraud.signals.map((s) => (
                  <li key={s.code}>
                    <span className="font-semibold">{LAYER_NAMES[s.layer]}:</span> {s.description}
                  </li>
                ))}
              </ul>
            )}
            {order && (
              <p className="mt-2 text-[12.5px] text-black/60">
                Risk {order.fraud.risk}, {Math.round(order.fraud.score)} of 100.{order.fraud.hardStop ? " A hard rule fired, so only a family passkey can release it." : ""}
              </p>
            )}
            {stamp}
          </div>
          <Buttons {...props} tone="alarm" />
        </div>
      );
    case "schedule_proposal":
      return (
        <div className={shell}>
          <p className="text-[12px] font-semibold text-leaf">Family time</p>
          <p>{msg.body}</p>
          <SlotButtons {...props} />
          {stamp}
        </div>
      );
    case "add_to_order":
      return (
        <div className={shell}>
          <p>{msg.body}</p>
          <Buttons {...props} />
          <button
            type="button"
            disabled
            title="Voice notes arrive in Phase 2 (needs the web upload endpoint)"
            className="mt-1 w-full rounded-md border border-dashed border-black/20 py-1.5 text-[13px] text-black/45"
          >
            🎙 Record a voice note for Mom
          </button>
          {stamp}
        </div>
      );
    case "briefing":
      return (
        <div className={`${shell} border-l-4 border-heron`}>
          <p className="text-[12px] font-semibold text-heron">Before your call</p>
          <p>{msg.body}</p>
          {stamp}
        </div>
      );
    case "receipt":
      return (
        <div className={shell}>
          <p className="text-[12px] font-semibold text-leaf">Paid</p>
          <p>{msg.body}</p>
          {msg.mediaUrl && <a href={msg.mediaUrl} className="mt-1 block text-[13px] text-[#027eb5] underline">View receipt</a>}
          {stamp}
        </div>
      );
    case "voice_note":
      return (
        <div className={shell}>
          {msg.mediaUrl ? <audio controls src={msg.mediaUrl} className="h-9 w-56" /> : <p>🎙 {msg.body}</p>}
          {stamp}
        </div>
      );
    case "nudge":
      return (
        <div className={`${shell} bg-[#fff8e6]`}>
          <p>{msg.body}</p>
          <Buttons {...props} />
          {stamp}
        </div>
      );
    case "text":
      return (
        <div className={shell}>
          <p className="whitespace-pre-wrap">{msg.body}</p>
          <Buttons {...props} />
          {stamp}
        </div>
      );
    default: {
      // If CONTRACTS.md adds a message kind, this line fails to compile until it's rendered.
      const unhandled: never = msg.kind;
      return <div className={shell}>Unsupported message kind: {String(unhandled)}</div>;
    }
  }
}
