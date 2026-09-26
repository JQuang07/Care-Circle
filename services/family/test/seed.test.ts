import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { generateCallHistory } from "../src/seed-data.js";
import { describePattern } from "../src/domain/rhythm.js";

const DAY = 86_400_000;

describe("8 weeks of seeded call history", () => {
  // Every weekday and a few times of day, so the rhythm looks right whenever the demo runs.
  const nows = Array.from({ length: 14 }, (_, i) => new Date(Date.parse("2026-09-28T13:00:00Z") + i * DAY + (i % 3) * 5 * 3600_000));

  it.each(nows.map((n) => [n.toISOString(), n]))("is realistic at %s", (_label, now) => {
    const calls = generateCallHistory(now as Date);
    const t = (now as Date).getTime();
    expect(calls.every((c) => Date.parse(c.startedAt) < t)).toBe(true);
    expect(calls.every((c) => Date.parse(c.startedAt) > t - 60 * DAY)).toBe(true);
    const of = (id: string) => calls.filter((c) => c.memberId === id);
    const last = (id: string) => Math.max(...of(id).map((c) => Date.parse(c.startedAt)));

    // Danny: 6–8 Sunday calls around 4pm ET; last one within the past 7 days.
    expect(of("mem_danny").length).toBeGreaterThanOrEqual(6);
    for (const c of of("mem_danny")) {
      const et = DateTime.fromISO(c.startedAt, { zone: "America/New_York" });
      expect(et.weekday).toBe(7);
      expect(Math.abs(et.hour * 60 + et.minute - 16 * 60)).toBeLessThanOrEqual(20);
    }
    expect(t - last("mem_danny")).toBeLessThanOrEqual(7 * DAY);
    // Lisa: midweek every week; last call within ~7 days.
    expect(of("mem_lisa").length).toBeGreaterThanOrEqual(8);
    expect(t - last("mem_lisa")).toBeLessThanOrEqual(7 * DAY + 3600_000);
    // Mark: rarely.
    expect(of("mem_mark").length).toBeLessThanOrEqual(2);
    expect(of("mem_mark").length).toBeGreaterThanOrEqual(1);

    expect(describePattern(of("mem_danny"), "America/New_York", now as Date)).toBe("Sundays ~4pm");
    expect(describePattern(of("mem_lisa"), "America/New_York", now as Date)).toMatch(/^Midweek, usually Wednesdays ~7pm$/);
    expect(describePattern(of("mem_mark"), "America/New_York", now as Date)).toMatch(/once a month/);
  });
});
