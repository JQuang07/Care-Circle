"use client";
/**
 * "Approve in app" for releasing a hold. CONTRACTS.md §4: a high-risk release needs
 * method "passkey_web". This is a SIMULATED passkey prompt for now (labeled on screen);
 * a real WebAuthn ceremony needs challenge/verify endpoints that aren't in the contract
 * yet (CCR-07). The UI and the request body stay the same either way.
 */
import { useEffect, useRef, useState } from "react";

export function PasskeyModal(props: {
  memberName: string;
  summary: string;
  onApprove: () => Promise<string | undefined>; // returns an error message, if any
  onClose: () => void;
}) {
  const [state, setState] = useState<"ask" | "checking" | "error">("ask");
  const [error, setError] = useState<string>();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);

  return (
    <dialog
      ref={dialog}
      onClose={props.onClose}
      className="m-auto w-[min(92vw,420px)] rounded-2xl bg-white p-0 text-ink shadow-2xl backdrop:bg-ink/50"
    >
      <div className="p-6">
        <p className="rounded bg-honey/25 px-2 py-1 text-[13px] text-ink/80">Simulated passkey (dev build). No real credential is checked yet.</p>
        <h2 className="mt-4 text-xl font-bold">Release this purchase?</h2>
        <p className="mt-2 text-[15px] leading-relaxed text-ink/80">{props.summary}</p>
        <div className="mt-5 grid place-items-center rounded-xl border border-heron/30 py-6">
          <span aria-hidden className="text-4xl">{state === "checking" ? "…" : "🔑"}</span>
          <p className="mt-2 text-[15px]">{state === "checking" ? "Checking your passkey" : `Use your passkey to confirm you're ${props.memberName}`}</p>
        </div>
        {state === "error" && <p role="alert" className="mt-3 text-[14px] text-alarm">{error}</p>}
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={() => dialog.current?.close()} className="rounded-lg px-4 py-2 text-heron hover:bg-mist">Keep it paused</button>
          <button
            type="button"
            disabled={state === "checking"}
            onClick={async () => {
              setState("checking");
              const e = await props.onApprove();
              if (e) { setError(e); setState("error"); } else dialog.current?.close();
            }}
            className="rounded-lg bg-ink px-4 py-2 font-semibold text-white disabled:opacity-60"
          >
            Release with passkey
          </button>
        </div>
      </div>
    </dialog>
  );
}
