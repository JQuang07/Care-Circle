/** Normalize so curly quotes, "do not", and extra spaces can't dodge patterns. */
export function normalize(s = ''): string {
  return s
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc`]/g, "'")
    .replace(/\bdo not\b/g, "don't")
    .replace(/\bdont\b/g, "don't")
    .replace(/\s+/g, ' ')
    .trim();
}

export const SECRECY_PATTERNS: RegExp[] = [
  /\bdon't tell\b/,
  /\bkeep (it|this|that) (a )?secret\b/,
  /\bbetween (you and me|us)\b/,
  /\bdon't (call|contact|talk to) (your|the) (family|kids|children|son|daughter|bank)\b/,
];

export const CASH_COURIER_PATTERNS: RegExp[] = [
  /\b(someone|somebody|a courier|a driver|an agent|a man|a woman|my (friend|associate|lawyer))\b.{0,40}\b(pick up|pick-up|collect|come get|come for)\b.{0,20}\b(cash|money|the envelope)\b/,
  /\bcourier\b.{0,40}\b(cash|money)\b/,
  /\b(cash|money)\b.{0,30}\b(will be|to be|gets?) (picked up|collected)\b/,
];

export const fmtUsd = (cents: number) =>
  `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
