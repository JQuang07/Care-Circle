import type { CallEnded, TranscriptTurn } from "../contracts-local.js";

const SECRECY_PHRASES = [
  /keep (this|that|it) (between us|between you and me|to yourself|private|quiet)/i,
  /just between (us|you and me)/i,
  /(don'?t|do not) tell (anyone|anybody|the family|lisa|danny|mark|the kids|my (daughter|son|grandson))/i,
  /this is private/i,
];

const STOPWORDS = new Set(("a an the and or but if so to of in on at for with from by is am are was were be been being i me my " +
  "you your she her he his it its we our they them their this that these those there here just really very " +
  "about what when then than too also not no yes okay ok well oh um uh like have has had do does did will would " +
  "can could should going gonna want know think said says say tell told keep between us").split(" "));

function words(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(Boolean);
}

function inAnySpan(ts: number, spans: { start: number; end: number }[]): boolean {
  return spans.some((s) => ts >= s.start && ts <= s.end);
}

export interface Stripped { publicTurns: TranscriptTurn[]; privateTurns: TranscriptTurn[]; }

/**
 * CONTRACTS §7 rule 4: runs before ANY text reaches a model, hook, nudge, or briefing.
 * - Removes every turn whose ts falls inside a privateSpan (inclusive).
 * - When spans exist, turns with an unparseable ts are treated as private (fail closed).
 * - Defense in depth: if Rose says "keep this between us" and the voice agent missed the span,
 *   that turn and her next two turns are treated as private too.
 */
export function stripPrivate(call: Pick<CallEnded, "transcript" | "privateSpans">): Stripped {
  const spans = (call.privateSpans ?? [])
    .map((s) => ({ start: Date.parse(s.startTs), end: Date.parse(s.endTs) }))
    .filter((s) => !Number.isNaN(s.start) && !Number.isNaN(s.end));
  const publicTurns: TranscriptTurn[] = [];
  const privateTurns: TranscriptTurn[] = [];
  let secrecyCarry = 0;
  for (const turn of call.transcript ?? []) {
    const ts = Date.parse(turn.ts);
    const inSpan = Number.isNaN(ts) ? spans.length > 0 : inAnySpan(ts, spans);
    let isPrivate = inSpan;
    if (turn.speaker === "senior") {
      // Only when the voice agent did NOT cover the request with a span.
      if (SECRECY_PHRASES.some((re) => re.test(turn.text))) { isPrivate = true; secrecyCarry = inSpan ? 0 : 2; }
      else if (secrecyCarry > 0) { isPrivate = true; secrecyCarry--; }
    }
    (isPrivate ? privateTurns : publicTurns).push(turn);
  }
  return { publicTurns, privateTurns };
}

/**
 * Last line of defense after the model: does `text` echo something only said in private?
 * Flags any private content bigram, or any distinctive private word (never said publicly).
 */
export function leaksPrivate(text: string, stripped: Stripped): boolean {
  if (stripped.privateTurns.length === 0) return false;
  const publicWords = new Set(stripped.publicTurns.flatMap((t) => words(t.text)));
  const privWords = stripped.privateTurns.flatMap((t) => words(t.text));
  const distinctive = new Set(privWords.filter((w) => w.length >= 4 && !STOPWORDS.has(w) && !publicWords.has(w)));
  const privBigrams = new Set<string>();
  for (const t of stripped.privateTurns) {
    const ws = words(t.text).filter((w) => !STOPWORDS.has(w));
    for (let i = 0; i + 1 < ws.length; i++) privBigrams.add(`${ws[i]} ${ws[i + 1]}`);
  }
  const tw = words(text);
  if (tw.some((w) => distinctive.has(w) || distinctive.has(w.replace(/'s$/, "")))) return true;
  const content = tw.filter((w) => !STOPWORDS.has(w));
  for (let i = 0; i + 1 < content.length; i++) if (privBigrams.has(`${content[i]} ${content[i + 1]}`)) return true;
  return false;
}
