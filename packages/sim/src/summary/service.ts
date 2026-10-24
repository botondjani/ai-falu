import { TICKS_PER_DAY, type SimEvent } from "@falu/core";
import type { LlmGateway } from "../llm/gateway";
import type { Runner } from "../runner";
import type { EventStore } from "../store";
import { summarize, type Summary } from "./summary";

/** Ennyi idő (tick) kell, hogy legyen mit összefoglalni. */
export const MIN_SUMMARY_TICKS = 12;

/** Az utolsó megtekintés nyilvántartása és az összefoglalók (gyorsítótárazva). */
export class SummaryService {
  private memLastSeen = 0;

  constructor(
    private runner: Runner,
    private gateway?: LlmGateway,
    private store?: EventStore,
    private runId?: number,
  ) {}

  lastSeen(): number {
    return (this.store && this.runId !== undefined ? this.store.getLastSeen(this.runId) : undefined) ?? this.memLastSeen;
  }

  markSeen(tick = this.runner.world.state.tick) {
    this.memLastSeen = tick;
    if (this.store && this.runId !== undefined) this.store.setLastSeen(this.runId, tick);
  }

  private events(fromTick: number, toTick: number): SimEvent[] {
    if (this.store && this.runId !== undefined) return this.store.events(this.runId, fromTick, toTick);
    return this.runner.recentEvents().filter((e) => e.tick >= fromTick && e.tick < toTick);
  }

  async between(fromTick: number, toTick: number): Promise<Summary> {
    const cached = this.store && this.runId !== undefined ? this.store.getSummary<Summary>(this.runId, fromTick, toTick) : undefined;
    if (cached) return cached;
    const s = await summarize(this.runner.world, this.events(fromTick, toTick), fromTick, toTick, this.gateway);
    if (this.store && this.runId !== undefined && !s.empty) this.store.saveSummary(this.runId, fromTick, toTick, s);
    return s;
  }

  /** Az utolsó megtekintés óta (vagy az elmúlt nap). */
  async sinceSeen(mode: "since_seen" | "last_day" = "since_seen"): Promise<Summary> {
    const now = this.runner.world.state.tick;
    const from = mode === "last_day" ? Math.max(0, now - TICKS_PER_DAY) : Math.min(this.lastSeen(), now);
    return this.between(from, now);
  }
}
