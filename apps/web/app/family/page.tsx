"use client";
import { useCallback, useRef, useState } from "react";
import { z } from "zod";
import { MessageSchema, OrderSchema, type Message, type Order } from "@care-circle/contracts";
import { Phone, type PhoneOwner } from "@/components/phone/Phone";
import { PasskeyModal } from "@/components/PasskeyModal";
import { SAMPLE_MESSAGES, SAMPLE_ORDERS } from "@/lib/fixtures";
import { explain, svc } from "@/lib/svc";
import { usePoll } from "@/lib/usePoll";

const OWNERS: PhoneOwner[] = [
  { id: "mem_lisa", name: "Lisa", relation: "Daughter", tz: "America/Chicago", city: "Chicago" },
  { id: "mem_danny", name: "Danny", relation: "Grandson", tz: "America/Denver", city: "Denver" },
  { id: "mem_mark", name: "Mark", relation: "Son", tz: "Europe/London", city: "London" },
];

type Action = NonNullable<Message["actions"]>[number];
interface Snapshot { inboxes: Record<string, Message[]>; orders: Order[]; sample: boolean; problem?: string }

export default function FamilyPhones() {
  const [toasts, setToasts] = useState<Record<string, string>>({});
  const [passkey, setPasskey] = useState<{ owner: PhoneOwner; msg: Message; action: Action }>();
  const [tick, setTick] = useState(0); // bump to refresh right after an action
  const sampleRef = useRef(false);

  const snap = usePoll<Snapshot>(async (signal) => {
    const [inboxes, orders] = await Promise.all([
      Promise.all(OWNERS.map((o) => svc("family", `/messages?memberId=${o.id}`, { schema: z.array(MessageSchema), signal }))),
      svc("money", "/orders?seniorId=sen_rose", { schema: z.array(OrderSchema), signal }),
    ]);
    const failed = inboxes.find((r) => !r.ok);
    if (failed && !failed.ok) {
      sampleRef.current = true;
      return { inboxes: SAMPLE_MESSAGES, orders: SAMPLE_ORDERS, sample: true, problem: explain(failed) };
    }
    sampleRef.current = false;
    return {
      inboxes: Object.fromEntries(OWNERS.map((o, i) => [o.id, (inboxes[i] as { data: Message[] }).data])),
      orders: orders.ok ? orders.data : [],
      sample: false,
      problem: orders.ok ? undefined : `Fraud details unavailable: ${explain(orders)}`,
    };
  }, 1500, [tick]);

  const toast = useCallback((memberId: string, text: string) => {
    setToasts((t) => ({ ...t, [memberId]: text }));
    setTimeout(() => setToasts((t) => (t[memberId] === text ? { ...t, [memberId]: "" } : t)), 4000);
  }, []);

  const ordersById = Object.fromEntries((snap?.orders ?? []).map((o) => [o.id, o]));

  const onAct = (owner: PhoneOwner) => async (msg: Message, action: Action) => {
    if (/release|approve/i.test(action.action)) { setPasskey({ owner, msg, action }); return; }
    if (sampleRef.current) { toast(owner.id, "Sample data: nothing was sent."); return; }
    const r = await svc("family", `/messages/${msg.id}/act`, { method: "POST", body: { action: action.action, payload: action.payload } });
    toast(owner.id, r.ok ? `Sent: ${action.label}` : explain(r));
    setTick((n) => n + 1);
  };

  const onReply = (owner: PhoneOwner) => async (text: string) => {
    if (sampleRef.current) { toast(owner.id, "Sample data: nothing was sent."); return; }
    const r = await svc("family", "/messages/reply", { method: "POST", body: { fromMemberId: owner.id, body: text } });
    if (!r.ok) toast(owner.id, explain(r));
    setTick((n) => n + 1);
  };

  const releaseWithPasskey = async (): Promise<string | undefined> => {
    if (!passkey) return;
    const holdId: string | undefined = passkey.action.payload?.holdId;
    if (!holdId) return "This card doesn't say which hold it's about (payload.holdId is missing; D5 requires { orderId, holdId }).";
    if (sampleRef.current) { toast(passkey.owner.id, "Sample data: nothing was released."); return; }
    const r = await svc("money", `/holds/${holdId}/resolve`, {
      method: "POST",
      body: {
        decision: "release",
        byMemberId: passkey.owner.id,
        method: "passkey_web",
        passkeyAssertion: { simulated: true, memberId: passkey.owner.id, at: new Date().toISOString() },
      },
    });
    if (!r.ok) return explain(r);
    toast(passkey.owner.id, "Released with passkey.");
    setTick((n) => n + 1);
  };

  return (
    <main className="px-5 py-8">
      <div className="mx-auto max-w-[1120px]">
        <h1 className="text-3xl font-bold">Rose's family, on their phones</h1>
        <p className="mt-1 max-w-[62ch] text-[17px] text-heron">
          What Lisa, Danny, and Mark see in their chat with Care Circle. Buttons here do exactly what a tap on a real phone would.
        </p>
        {snap?.sample && (
          <p role="status" className="mt-4 rounded-lg border border-honey bg-honey/15 px-4 py-2 text-[15px]">
            Showing sample messages. {snap.problem}
          </p>
        )}
        {!snap?.sample && snap?.problem && (
          <p role="status" className="mt-4 rounded-lg border border-heron/30 bg-white px-4 py-2 text-[15px] text-heron">{snap.problem}</p>
        )}
      </div>
      <div className="mt-8 flex justify-center gap-8 overflow-x-auto pb-6">
        {OWNERS.map((o) => (
          <Phone
            key={o.id}
            owner={o}
            messages={snap?.inboxes[o.id]}
            ordersById={ordersById}
            onAct={onAct(o)}
            onReply={onReply(o)}
            toast={toasts[o.id] || undefined}
          />
        ))}
      </div>
      {passkey && (
        <PasskeyModal
          memberName={passkey.owner.name}
          summary={ordersById[passkey.action.payload?.orderId]?.fraud.familyFacingSummary ?? passkey.msg.body}
          onApprove={releaseWithPasskey}
          onClose={() => setPasskey(undefined)}
        />
      )}
    </main>
  );
}
