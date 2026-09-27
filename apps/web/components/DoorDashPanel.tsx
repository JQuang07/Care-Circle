"use client";
/**
 * /demo · DoorDash controls (D14). Quoting is harmless and always available. "Place real
 * order" is rendered ONLY when delivery reports the real provider AND live checkout, and
 * only for deliveries waiting on a person. It needs a name and the typed phrase, and goes
 * through the server-side proxy (which checks the phrase again and adds the secret).
 */
import { useState } from "react";
import { z } from "zod";
import { DeliveryHealthSchema, DeliveryOrderSchema, QuoteSchema, type DeliveryOrder, type Quote } from "@care-circle/contracts";
import { DryRunBadge } from "@/components/DeliveryStatus";
import { CHECKOUT_PHRASE } from "@/lib/services";
import { explain, svc } from "@/lib/svc";
import { usePoll } from "@/lib/usePoll";

const usd = (c: number) => (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
const DEFAULT_ITEMS = "milk, wheat bread, eggs, bananas";

export function DoorDashPanel() {
  const [items, setItems] = useState(DEFAULT_ITEMS);
  const [quote, setQuote] = useState<Quote>();
  const [quoteErr, setQuoteErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [placed, setPlaced] = useState<{ ok: boolean; text: string }>();

  const state = usePoll(async (signal) => {
    const [health, orders] = await Promise.all([
      svc("delivery", "/health", { schema: DeliveryHealthSchema, signal }),
      svc("delivery", "/orders?seniorId=sen_rose", { schema: z.array(DeliveryOrderSchema), signal }),
    ]);
    return { health: health.ok ? health.data : undefined, healthErr: health.ok ? undefined : explain(health), orders: orders.ok ? orders.data : [] };
  }, 3000);

  const h = state?.health;
  const armed = h?.provider === "doordash_thirdparty" && h.liveCheckout === true;
  const waiting = armed ? (state?.orders ?? []).filter((d) => d.status === "awaiting_live_checkout") : [];

  const getQuote = async () => {
    setBusy(true);
    setQuoteErr(undefined);
    const list = items.split(/[,\n]/).map((s) => s.trim()).filter(Boolean).map((name) => ({ name, qty: 1 }));
    const r = await svc("delivery", "/quote", { method: "POST", body: { kind: "grocery", items: list }, schema: QuoteSchema });
    setBusy(false);
    if (r.ok) setQuote(r.data);
    else { setQuote(undefined); setQuoteErr(explain(r)); }
  };

  return (
    <section aria-labelledby="dd-h" className="mt-10 rounded-xl bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="dd-h" className="text-xl font-bold">Groceries delivery (DoorDash)</h2>
        <p className="text-[14px] text-heron">
          {h ? <>Provider <b className="text-ink">{h.provider}</b>{armed ? <span className="ml-2 font-bold text-alarm">LIVE CHECKOUT ARMED</span> : <span className="ml-2"><DryRunBadge /></span>}</>
             : state?.healthErr ?? "Checking delivery…"}
        </p>
      </div>
      <p className="mt-1 text-[14.5px] text-heron">
        An unofficial third-party integration. Orders are dry runs unless the demo laptop has explicitly armed live checkout.
      </p>

      <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); getQuote(); }}>
        <label className="grow text-[14px]">
          <span className="block text-heron">Items (comma-separated)</span>
          <input value={items} onChange={(e) => setItems(e.target.value)} className="mt-1 w-full rounded-lg border border-heron/40 px-3 py-2 text-[15px]" />
        </label>
        <button type="submit" disabled={busy} className="rounded-lg bg-ink px-4 py-2.5 text-[15px] font-bold text-white disabled:opacity-60">
          {busy ? "Quoting…" : "Quote groceries (DoorDash)"}
        </button>
      </form>
      {quoteErr && <p role="status" className="mt-2 text-[14px] text-alarm">{quoteErr}</p>}
      {quote && <QuoteTable quote={quote} />}

      {waiting.map((d) => <PlaceRealOrder key={d.deliveryId} delivery={d} onResult={setPlaced} />)}
      {placed && <p role="status" className={`mt-3 text-[14.5px] ${placed.ok ? "text-leaf" : "text-alarm"}`}>{placed.text}</p>}
    </section>
  );
}

function QuoteTable({ quote }: { quote: Quote }) {
  return (
    <div className="mt-4 overflow-x-auto">
      <p className="text-[14.5px]"><b>{quote.storeName}</b> <span className="text-heron">· quote {quote.quoteId} · {quote.provider}</span></p>
      <table className="mt-2 w-full text-left text-[14.5px]">
        <thead className="text-[13px] text-heron">
          <tr><th className="py-1 pr-3 font-normal">Asked for</th><th className="py-1 pr-3 font-normal">Qty</th><th className="py-1 pr-3 font-normal">Store has</th><th className="py-1 text-right font-normal">Price</th></tr>
        </thead>
        <tbody>
          {quote.lines.map((l, i) => (
            <tr key={i} className="border-t border-mist align-top">
              <td className="py-1.5 pr-3">{l.requested}</td>
              <td className="py-1.5 pr-3 tabular-nums">{l.qty}</td>
              <td className="py-1.5 pr-3">
                {l.status === "matched" && l.matched?.name}
                {l.status === "not_found" && <span className="text-alarm">Not found</span>}
                {l.status === "ambiguous" && (
                  <span className="text-heron">Which one? {l.options?.map((o) => `${o.name} (${usd(o.priceCents)})`).join(" · ")}</span>
                )}
              </td>
              <td className="py-1.5 text-right tabular-nums">{l.matched ? usd(l.matched.priceCents * l.matched.qty) : "–"}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="text-[14.5px]">
          <tr className="border-t border-heron/30"><td colSpan={3} className="py-1 text-heron">Subtotal</td><td className="py-1 text-right tabular-nums">{usd(quote.subtotalCents)}</td></tr>
          <tr><td colSpan={3} className="py-1 text-heron">Fees and tax (estimate)</td><td className="py-1 text-right tabular-nums">{usd(quote.feesCents)}</td></tr>
          <tr className="font-bold"><td colSpan={3} className="py-1">Total</td><td className="py-1 text-right tabular-nums">{usd(quote.totalCents)}</td></tr>
        </tfoot>
      </table>
    </div>
  );
}

function PlaceRealOrder({ delivery, onResult }: { delivery: DeliveryOrder; onResult: (r: { ok: boolean; text: string }) => void }) {
  const [name, setName] = useState("");
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = name.trim().length > 0 && phrase === CHECKOUT_PHRASE && !busy;

  const place = async () => {
    setBusy(true);
    const r = await svc("delivery", `/orders/${delivery.deliveryId}/checkout`, {
      method: "POST", body: { confirmedBy: name.trim(), confirmPhrase: phrase }, schema: DeliveryOrderSchema,
    });
    setBusy(false);
    onResult(r.ok
      ? { ok: true, text: `Real order placed at ${r.data.storeName} by ${r.data.confirmedBy ?? name.trim()}. Status: ${r.data.status}${r.data.etaText ? `, ETA ${r.data.etaText}` : ""}.` }
      : { ok: false, text: explain(r) });
  };

  return (
    <div className="mt-6 rounded-xl border-2 border-alarm p-4">
      <p className="text-[13px] font-bold uppercase tracking-wide text-alarm">Real order: this charges a real card</p>
      <p className="mt-1 text-[17px]"><b>{delivery.storeName}</b>, {usd(delivery.cartTotalCents)} <span className="text-[14px] text-heron">(approved {usd(delivery.approvedAmountCents)}, order {delivery.orderId})</span></p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-[14px]">
          <span className="block text-heron">Your name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" className="mt-1 w-full rounded-lg border border-heron/40 px-3 py-2 text-[15px]" />
        </label>
        <label className="text-[14px]">
          <span className="block text-heron">Type <b className="text-ink">{CHECKOUT_PHRASE}</b> to confirm</span>
          <input value={phrase} onChange={(e) => setPhrase(e.target.value)} autoComplete="off" spellCheck={false}
            onPaste={(e) => e.preventDefault()} className="mt-1 w-full rounded-lg border border-heron/40 px-3 py-2 font-mono text-[15px]" />
        </label>
      </div>
      <button type="button" disabled={!ready} onClick={place} className="mt-3 rounded-lg bg-alarm px-4 py-2.5 text-[15px] font-bold text-white disabled:opacity-40">
        {busy ? "Placing…" : "Place real order"}
      </button>
    </div>
  );
}
