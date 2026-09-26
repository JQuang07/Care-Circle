/** Injectable clock. The demo panel can fast-forward it ("Sunday 4pm"). */
export interface Clock {
  now(): Date;
  /** Shift virtual time so that now() returns `to`. */
  travelTo(to: Date): void;
  reset(): void;
}

export function systemClock(): Clock {
  let offsetMs = 0;
  return {
    now: () => new Date(Date.now() + offsetMs),
    travelTo: (to) => { offsetMs = to.getTime() - Date.now(); },
    reset: () => { offsetMs = 0; },
  };
}

export function fixedClock(start: Date | string): Clock & { advance(ms: number): void } {
  let t = new Date(start).getTime();
  const initial = t;
  return {
    now: () => new Date(t),
    travelTo: (to) => { t = to.getTime(); },
    reset: () => { t = initial; },
    advance: (ms) => { t += ms; },
  };
}
