"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Calls `load` now and every `ms` while the tab is visible. Skips a tick if the
 * previous one is still in flight, and aborts on unmount.
 */
export function usePoll<T>(load: (signal: AbortSignal) => Promise<T>, ms = 1500, deps: unknown[] = []) {
  const [value, setValue] = useState<T | undefined>(undefined);
  const busy = useRef(false);
  useEffect(() => {
    const ctrl = new AbortController();
    const tick = async () => {
      if (busy.current || document.hidden) return;
      busy.current = true;
      try {
        const v = await load(ctrl.signal);
        if (!ctrl.signal.aborted) setValue(v);
      } finally {
        busy.current = false;
      }
    };
    tick();
    const id = setInterval(tick, ms);
    return () => {
      ctrl.abort();
      clearInterval(id);
      busy.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return value;
}
