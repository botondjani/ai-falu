import { TICKS_PER_DAY, stepWorld, type SimEvent, type StepResult, type World } from "@falu/core";
import type { AgentView, SimStatus } from "./protocol";
import type { EventStore } from "./store";

export interface RunnerOptions {
  world: World;
  /** Valós másodperc egy szimulált napra. */
  secondsPerDay: number;
  /** Ha meg van adva, minden eseményt és napi snapshotot ide ír. */
  store?: EventStore;
  runId?: number;
  mode?: SimStatus["mode"];
  /** Ennél a ticknél megáll (pl. visszajátszás vége). */
  stopAtTick?: number;
}

type TickListener = (r: StepResult, world: World) => void;

/** A szimuláció óraműve: valós időben vagy egy ütemben (headless) lépteti a világot. */
export class Runner {
  readonly world: World;
  readonly store?: EventStore;
  readonly runId?: number;
  readonly mode: SimStatus["mode"];
  stopAtTick?: number;
  secondsPerDay: number;
  pausedReason?: string;
  private timer: NodeJS.Timeout | null = null;
  private listeners: TickListener[] = [];
  private statusListeners: (() => void)[] = [];
  private recent: SimEvent[] = [];

  constructor(opts: RunnerOptions) {
    this.world = opts.world;
    this.secondsPerDay = opts.secondsPerDay;
    this.store = opts.store;
    this.runId = opts.runId;
    this.mode = opts.mode ?? "élő";
    this.stopAtTick = opts.stopAtTick;
    if (this.store && this.runId !== undefined && this.world.state.tick % TICKS_PER_DAY === 0) {
      this.store.saveSnapshot(this.runId, this.world.state);
    }
  }

  get tickMs(): number {
    return (this.secondsPerDay * 1000) / TICKS_PER_DAY;
  }

  onTick(fn: TickListener) {
    this.listeners.push(fn);
  }

  onStatus(fn: () => void) {
    this.statusListeners.push(fn);
  }

  step(): StepResult {
    const r = stepWorld(this.world);
    if (this.store && this.runId !== undefined) {
      this.store.appendEvents(this.runId, r.events);
      if (this.world.state.tick % TICKS_PER_DAY === 0) this.store.saveSnapshot(this.runId, this.world.state);
    }
    this.recent.push(...r.events);
    if (this.recent.length > 300) this.recent.splice(0, this.recent.length - 300);
    for (const l of this.listeners) l(r, this.world);
    return r;
  }

  start() {
    if (this.timer || this.atEnd()) return;
    this.pausedReason = undefined;
    const loop = () => {
      this.step();
      if (this.atEnd()) {
        this.timer = null;
        this.pause("visszajátszás vége");
        return;
      }
      this.timer = setTimeout(loop, this.tickMs);
    };
    this.timer = setTimeout(loop, this.tickMs);
    this.emitStatus();
  }

  setSpeed(secondsPerDay: number) {
    this.secondsPerDay = secondsPerDay;
    this.emitStatus();
  }

  pause(reason?: string) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pausedReason = reason;
    this.emitStatus();
  }

  private atEnd() {
    return this.stopAtTick !== undefined && this.world.state.tick >= this.stopAtTick;
  }

  private emitStatus() {
    for (const l of this.statusListeners) l();
  }

  get running() {
    return this.timer !== null;
  }

  status(): SimStatus {
    return {
      running: this.running,
      speed: this.secondsPerDay,
      pausedReason: this.pausedReason,
      mode: this.mode,
      runId: this.runId,
    };
  }

  recentEvents(): SimEvent[] {
    return [...this.recent];
  }

  /** Headless futás, ember és várakozás nélkül. */
  runTicks(n: number) {
    for (let i = 0; i < n && !this.atEnd(); i++) this.step();
  }

  /** Leállításkor snapshot, hogy a folytatás ne a nap elejéről induljon. */
  flush() {
    if (this.store && this.runId !== undefined) this.store.saveSnapshot(this.runId, this.world.state);
  }

  agentViews(): AgentView[] {
    return this.world.state.agents.map((a) => ({
      id: a.id,
      name: a.name,
      occupation: a.occupation,
      color: a.color,
      pos: a.pos,
      activity: a.activity ? { kind: a.activity.kind, locationId: a.activity.locationId, reason: a.activity.reason } : null,
      needs: { hunger: Math.round(a.needs.hunger), energy: Math.round(a.needs.energy) },
      money: a.money,
      inventory: a.inventory,
    }));
  }
}
