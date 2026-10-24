import { describe, expect, it } from "vitest";
import { TICKS_PER_DAY, formatTime, hourBetween, phaseOf, tickToTime, timeToTick } from "../src/time";

describe("idő", () => {
  it("6:00-kor indul az 1. nap", () => {
    const t = tickToTime(0);
    expect(t).toMatchObject({ day: 1, hour: 6, minute: 0, phase: "reggel" });
  });

  it("egy nap 288 tick", () => {
    expect(TICKS_PER_DAY).toBe(288);
    expect(tickToTime(TICKS_PER_DAY).day).toBe(2);
    expect(tickToTime(TICKS_PER_DAY).hour).toBe(6);
  });

  it("éjfélkor vált a nap", () => {
    const midnight = timeToTick(2, 0, 0);
    expect(tickToTime(midnight - 1)).toMatchObject({ day: 1, hour: 23, minute: 55 });
    expect(tickToTime(midnight)).toMatchObject({ day: 2, hour: 0, minute: 0 });
  });

  it("timeToTick és tickToTime inverzek", () => {
    for (const tick of [0, 1, 100, 287, 288, 1000, 5000]) {
      const t = tickToTime(tick);
      expect(timeToTick(t.day, t.hour, t.minute)).toBe(tick);
    }
  });

  it("napszakok", () => {
    expect(phaseOf(5)).toBe("hajnal");
    expect(phaseOf(10)).toBe("délelőtt");
    expect(phaseOf(15)).toBe("délután");
    expect(phaseOf(20)).toBe("este");
    expect(phaseOf(23)).toBe("éjszaka");
    expect(phaseOf(2)).toBe("éjszaka");
  });

  it("órák közti intervallum átfordulással", () => {
    expect(hourBetween(23, 22, 6)).toBe(true);
    expect(hourBetween(3, 22, 6)).toBe(true);
    expect(hourBetween(6, 22, 6)).toBe(false);
    expect(hourBetween(12, 8, 17)).toBe(true);
    expect(hourBetween(17, 8, 17)).toBe(false);
  });

  it("formázás", () => {
    expect(formatTime(tickToTime(1))).toBe("1. nap 06:05");
  });
});
