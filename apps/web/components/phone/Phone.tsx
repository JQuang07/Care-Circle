"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Message, Order } from "@care-circle/contracts";
import { MessageBubble } from "./MessageBubble";
import { deliveryView, type DeliveryInfo } from "@/lib/delivery";

export interface PhoneOwner { id: string; name: string; relation: string; tz: string; city: string }

type Action = NonNullable<Message["actions"]>[number];

export function Phone(props: {
  owner: PhoneOwner;
  messages: Message[] | undefined;
  ordersById: Record<string, Order>;
  delivery?: DeliveryInfo;
  onAct: (msg: Message, action: Action) => Promise<void>;
  onReply: (text: string) => Promise<void>;
  toast?: string;
}) {
  const { owner, messages, ordersById, delivery, onAct, onReply, toast } = props;
  const [clock, setClock] = useState("");
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<string | undefined>();
  const scroller = useRef<HTMLDivElement>(null);
  const newest = useRef<HTMLDivElement>(null);
  const newestId = useRef<string | undefined>(undefined);

  useEffect(() => {
    const f = () => setClock(new Intl.DateTimeFormat("en-US", { timeZone: owner.tz, hour: "numeric", minute: "2-digit" }).format(new Date()));
    f();
    const id = setInterval(f, 20_000);
    return () => clearInterval(id);
  }, [owner.tz]);

  const act = async (msg: Message, a: Action) => {
    setPending(a.label);
    try { await onAct(msg, a); } finally { setPending(undefined); }
  };

  const sorted = [...(messages ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const latest = sorted[sorted.length - 1]?.id;

  // A NEW message always comes into view, even if this phone was scrolled up (say, after
  // tapping a slot). Tall ones, like a fraud card, align to their top so the headline shows.
  useLayoutEffect(() => {
    if (!latest || latest === newestId.current) return;
    newestId.current = latest;
    const c = scroller.current, el = newest.current;
    if (!c || !el) return;
    const cr = c.getBoundingClientRect(), er = el.getBoundingClientRect();
    c.scrollTop += er.height > cr.height - 16 ? er.top - cr.top - 8 : er.bottom - cr.bottom + 12;
  }, [latest]);

  return (
    <figure className="flex w-[340px] shrink-0 flex-col items-center gap-3">
      <figcaption className="text-center">
        <span className="block text-xl font-bold">{owner.name}</span>
        <span className="text-[15px] text-heron">{owner.relation} in {owner.city}, {clock}</span>
      </figcaption>
      <div className="relative h-[640px] w-full rounded-[44px] border-[10px] border-ink bg-ink shadow-xl">
        <div className="flex h-full flex-col overflow-hidden rounded-[34px] bg-chat-wall font-[family-name:var(--font-phone)]">
          <div className="flex items-center justify-between bg-chat-bar px-5 pt-2 text-[12px] font-semibold text-white">
            <span>{clock}</span><span aria-hidden>▂▄▆ ◔</span>
          </div>
          <header className="flex items-center gap-3 bg-chat-bar px-3 pb-2.5 pt-1.5 text-white">
            <div aria-hidden className="grid size-9 place-items-center rounded-full bg-white/20 text-[15px] font-bold">CC</div>
            <div className="leading-tight">
              <p className="text-[15.5px] font-semibold">Care Circle</p>
              <p className="text-[12px] text-white/75">Rose's helper</p>
            </div>
          </header>
          {/* column-reverse: the browser keeps the newest message in view as others load or grow */}
          <div ref={scroller} className="flex flex-1 flex-col-reverse gap-1.5 overflow-y-auto px-2.5 py-3" aria-live="polite">
            {messages === undefined && <p className="m-auto text-[13px] text-black/50">Loading messages…</p>}
            {messages?.length === 0 && (
              <p className="m-auto max-w-[80%] rounded-lg bg-[#fff8e6] px-3 py-2 text-center text-[13px] text-black/60">
                No messages yet. Run a scenario from Demo controls.
              </p>
            )}
            {[...sorted].reverse().map((m) => {
              const order = m.actions?.map((a) => ordersById[a.payload?.orderId]).find(Boolean);
              return (
                <div key={m.id} ref={m.id === latest ? newest : undefined} className="flex flex-col">
                <MessageBubble
                  msg={m}
                  viewerId={owner.id}
                  order={order}
                  delivery={order && deliveryView(order, delivery?.byOrderId[order.id])}
                  liveCheckout={delivery?.liveCheckout ?? false}
                  onAct={act}
                  pending={pending && m.actions?.some((a) => a.label === pending) ? pending : undefined}
                />
                </div>
              );
            })}
          </div>
          {toast && <p role="status" className="mx-2 mb-1 rounded-md bg-ink/85 px-2 py-1 text-center text-[12.5px] text-white">{toast}</p>}
          <form
            className="flex items-center gap-2 bg-[#f0f0f0] px-2 py-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const text = draft.trim();
              if (!text) return;
              setDraft("");
              await onReply(text);
            }}
          >
            <label className="sr-only" htmlFor={`reply-${owner.id}`}>Message as {owner.name}</label>
            <input
              id={`reply-${owner.id}`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={`Message as ${owner.name}`}
              className="min-w-0 flex-1 rounded-full bg-white px-4 py-2 text-[14.5px] outline-none"
            />
            <button type="submit" aria-label="Send" className="grid size-10 place-items-center rounded-full bg-chat-bar text-white">➤</button>
          </form>
        </div>
      </div>
    </figure>
  );
}
