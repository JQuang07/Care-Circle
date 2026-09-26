import { createHash } from "node:crypto";

/** CONTRACTS §2 familyCodeWordHash (sha256 of the lowercase phrase). Family never stores the plaintext. */
export const FAMILY_CODE_WORD_HASH = process.env.FAMILY_CODE_WORD_HASH
  ?? "378bc7cbdeefca4053d7b78d38c4462941abe18fb1ded6f28a75e5a721f0e1c4";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

function windows(text: string): { phrase: string; start: number; end: number }[] {
  const tokens = [...text.matchAll(/[A-Za-z']+/g)].map((m) => ({ w: m[0].toLowerCase().replace(/'s$/, ""), start: m.index!, end: m.index! + m[0].length }));
  const out: { phrase: string; start: number; end: number }[] = [];
  for (let i = 0; i < tokens.length; i++) {
    for (let n = 1; n <= 3 && i + n <= tokens.length; n++) {
      const slice = tokens.slice(i, i + n);
      out.push({ phrase: slice.map((t) => t.w).join(" "), start: slice[0].start, end: slice[n - 1].end });
    }
  }
  return out;
}

/** Does the text contain the family code word (any 1–3 word window hashing to it)? */
export function containsCodeWord(text: string, hash = FAMILY_CODE_WORD_HASH): boolean {
  return windows(text).some((w) => sha(w.phrase) === hash);
}

/** Last-line guard for anything sent to the family: the code word is never written down. */
export function redactCodeWord(text: string, hash = FAMILY_CODE_WORD_HASH): string {
  const hits = windows(text).filter((w) => sha(w.phrase) === hash).sort((a, b) => b.start - a.start);
  let out = text;
  for (const h of hits) out = out.slice(0, h.start) + "[family code word]" + out.slice(h.end);
  return out;
}
