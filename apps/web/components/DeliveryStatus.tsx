"use client";
import { STATUS_WORDS, type DeliveryView } from "@/lib/delivery";

/** Shown on every delivery unless delivery /health reports `liveCheckout: true`. */
export function DryRunBadge() {
  return (
    <span
      title="Delivery is in dry-run mode: the cart is built, but nothing is ordered or charged by DoorDash."
      className="whitespace-nowrap rounded border border-honey bg-honey/20 px-1.5 py-0.5 align-middle text-[11.5px] font-bold uppercase tracking-wide text-ink"
    >
      Dry run
    </span>
  );
}

/**
 * Store, status, ETA, tracking link, and anything the store didn't have.
 * `variant="chat"` is sized for the phone mock; `"row"` for the dashboard table.
 */
export function DeliveryStatus({ view, liveCheckout, variant }: { view: DeliveryView; liveCheckout: boolean; variant: "chat" | "row" }) {
  const small = variant === "chat" ? "text-[12.5px]" : "text-[13.5px]";
  const link = variant === "chat" ? "text-[#027eb5]" : "text-ink";
  const done = view.status === "delivered" || view.status === "failed";
  const eta = done ? undefined : view.etaText;
  return (
    <div className={`${variant === "chat" ? "mt-2 rounded-md bg-black/[0.04] px-2 py-1.5" : "mt-1"} ${small}`}>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span aria-hidden>🛵</span>
        <span className="font-semibold">{view.storeName}</span>
        {view.status && (
          <span className={view.status === "failed" ? "font-semibold text-alarm" : view.status === "delivered" ? "text-leaf" : "text-black/65"}>
            {STATUS_WORDS[view.status]}
          </span>
        )}
        {!liveCheckout && <DryRunBadge />}
      </p>
      {(eta || view.trackingUrl) && (
        <p className="mt-0.5 text-black/65">
          {eta && <>ETA {eta}</>}
          {eta && view.trackingUrl && " · "}
          {view.trackingUrl && (
            <a href={view.trackingUrl} target="_blank" rel="noopener noreferrer" className={`${link} underline underline-offset-2`}>Track it</a>
          )}
        </p>
      )}
      {view.failureReason && <p className="mt-0.5 text-alarm">{view.failureReason}</p>}
      {view.unmatchedItems.length > 0 && (
        <p className="mt-0.5 text-black/65">
          <span className="font-semibold">Store didn't have:</span> {view.unmatchedItems.join(", ")}
        </p>
      )}
    </div>
  );
}
