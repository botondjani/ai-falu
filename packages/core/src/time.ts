export const MINUTES_PER_TICK = 5;
export const TICKS_PER_HOUR = 60 / MINUTES_PER_TICK;
export const TICKS_PER_DAY = 24 * TICKS_PER_HOUR;
/** A szimuláció reggel 6-kor indul. */
export const START_HOUR = 6;

export type DayPhase = "hajnal" | "reggel" | "délelőtt" | "délután" | "este" | "éjszaka";

export interface SimTime {
  tick: number;
  day: number; // 1-től
  hour: number; // 0-23
  minute: number; // 0-55
  minuteOfDay: number;
  phase: DayPhase;
}

export function tickToTime(tick: number): SimTime {
  const totalMinutes = tick * MINUTES_PER_TICK + START_HOUR * 60;
  const day = Math.floor(totalMinutes / (24 * 60)) + 1;
  const minuteOfDay = totalMinutes % (24 * 60);
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  return { tick, day, hour, minute, minuteOfDay, phase: phaseOf(hour) };
}

export function phaseOf(hour: number): DayPhase {
  if (hour >= 4 && hour < 6) return "hajnal";
  if (hour >= 6 && hour < 9) return "reggel";
  if (hour >= 9 && hour < 12) return "délelőtt";
  if (hour >= 12 && hour < 18) return "délután";
  if (hour >= 18 && hour < 22) return "este";
  return "éjszaka";
}

/** Az adott nap adott órájának tickje (a nap 1-től számozva). */
export function timeToTick(day: number, hour: number, minute = 0): number {
  const totalMinutes = (day - 1) * 24 * 60 + hour * 60 + minute - START_HOUR * 60;
  return Math.floor(totalMinutes / MINUTES_PER_TICK);
}

export function formatTime(t: SimTime): string {
  return `${t.day}. nap ${String(t.hour).padStart(2, "0")}:${String(t.minute).padStart(2, "0")}`;
}

/** Igaz, ha az óra a [from, to) intervallumban van; átfordulást (pl. 22→6) is kezel. */
export function hourBetween(hour: number, from: number, to: number): boolean {
  return from <= to ? hour >= from && hour < to : hour >= from || hour < to;
}
