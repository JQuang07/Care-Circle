"use client";
/** Shows how the fraud engine reached its decision: all four layers, weights, score. */
import { useEffect, useRef } from "react";
import type { Order } from "@care-circle/contracts";

const LAYERS = [
  { n: 1, name: "Hard rules", note: "Fixed rules in code. No model can override them." },
  { n: 2, name: "Scam-story check", note: "Reads why Rose is buying and compares it to known scam scripts." },
  { n: 3, name: "Rose's usual pattern", note: "Compared with her last 60 days of orders." },
  { n: 4, name: "Family pattern", note: "Compared with how the family really stays in touch." },
] as const;

const TYPOLOGY: Record<string, string> = {
  grandparent_impostor: "Grandparent impostor", government_impostor: "Government impostor", tech_support: "Tech support",
  prize_lottery: "Prize or lottery", romance: "Romance", investment: "Investment", cash_courier: "Cash courier", unknown: "Unknown pattern",
};

const usd = (c: number) => (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

export function FraudDrawer({ order, onClose }: { order: Order; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  const f = order.fraud;
  const maxW = Math.max(1, ...f.signals.map((s) => Math.abs(s.weight)));
  const riskColor = f.risk === "high" ? "bg-alarm" : f.risk === "medium" ? "bg-honey" : "bg-leaf";

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="drawer-title"
      className="ml-auto mr-0 h-dvh max-h-none w-[min(100vw,560px)] bg-white p-0 text-ink shadow-2xl backdrop:bg-ink/40"
    >
      <div className="flex h-full flex-col">
        <header className="border-b border-heron/20 px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id="drawer-title" className="text-2xl font-bold">How we decided</h2>
              <p className="mt-1 text-[15px] text-heron">
                {order.request.payeeDescription ?? order.request.type}, {usd(order.request.amountCents)}
              </p>
            </div>
            <button type="button" onClick={() => ref.current?.close()} className="rounded-lg px-3 py-1.5 text-heron hover:bg-mist">Close</button>
          </div>
          <div className="mt-5">
            <div className="flex items-baseline justify-between">
              <span className="text-[15px]">Risk score</span>
              <span className="text-[15px]"><b className="text-2xl">{Math.round(f.score)}</b> of 100, {f.risk} risk</span>
            </div>
            <div className="mt-2 h-3 overflow-hidden rounded-full bg-mist" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={f.score} aria-label="Risk score">
              <div className={`h-full ${riskColor}`} style={{ width: `${Math.min(100, f.score)}%` }} />
            </div>
            <p className="mt-3 text-[15px]">
              Decision: <b>{{ proceed: "Go ahead", verify_with_family: "Check with family first", hold: "Hold it" }[f.recommendedAction]}</b>
              {f.typology && f.typology !== "unknown" && <> as a likely <b>{TYPOLOGY[f.typology]}</b> scam</>}.
            </p>
            {f.hardStop && (
              <p className="mt-3 rounded-lg bg-alarm/10 px-3 py-2 text-[14.5px] text-alarm">
                A hard rule fired. This purchase can only be released with a family member's passkey.
              </p>
            )}
          </div>
        </header>
        <ol className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {LAYERS.map((L) => {
            const sigs = f.signals.filter((s) => s.layer === L.n);
            return (
              <li key={L.n}>
                <h3 className="text-[17px] font-bold">Layer {L.n}: {L.name}</h3>
                <p className="text-[14px] text-heron">{L.note}</p>
                {sigs.length === 0 ? (
                  <p className="mt-2 text-[14.5px] text-ink/60">Nothing unusual here.</p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {sigs.map((s) => (
                      <li key={s.code} className="rounded-lg border border-heron/20 px-3 py-2">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="text-[15px]">{s.description}</span>
                          <span className="shrink-0 text-[14px] font-bold tabular-nums">+{s.weight}</span>
                        </div>
                        <div className="mt-1.5 h-1.5 rounded-full bg-mist">
                          <div className={`h-full rounded-full ${L.n === 1 ? "bg-alarm" : "bg-heron"}`} style={{ width: `${(Math.abs(s.weight) / maxW) * 100}%` }} />
                        </div>
                        <span className="mt-1 block text-[12.5px] text-ink/50">{s.code}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
          <li className="border-t border-heron/20 pt-5">
            <h3 className="text-[17px] font-bold">What Rose heard</h3>
            <p className="mt-1 text-[15px] leading-relaxed">“{f.seniorFacingMessage || "Nothing; the purchase went through."}”</p>
            {f.familyFacingSummary && (
              <>
                <h3 className="mt-4 text-[17px] font-bold">What the family was told</h3>
                <p className="mt-1 text-[15px] leading-relaxed">{f.familyFacingSummary}</p>
              </>
            )}
          </li>
        </ol>
      </div>
    </dialog>
  );
}
