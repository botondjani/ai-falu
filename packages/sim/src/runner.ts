import { TICKS_PER_DAY, createWorld, stepWorld, type SimEvent, type StepResult, type VillagerSeed, type World } from "@falu/core";
import type { AgentView, SimStatus } from "./protocol";

export interface RunnerOptions {
  seed: string;
  villagers: VillagerSeed[];
  /** Valós másodperc egy szimulált napra. */
  secondsPerDay: number;
}

type TickListener = (r: StepResult, world: World) => void;

/** A szimuláció óraműve: valós időben vagy egy ütemben (headless) lépteti a világot. */
export class Runner {
  readonly world: World;
  private timer: NodeJS.Timeout | null = null;
  private listeners: TickListener[] = [];
  private recent: SimEvent[] = [];
  secondsPerDay: number;
  pausedReason?: string;

  constructor(opts: RunnerOptions) {
    this.world = createWorld(opts.seed, opts.villagers);
    this.secondsPerDay = opts.secondsPerDay;
  }

  get tickMs(): number {
    return (this.secondsPerDay * 1000) / TICKS_PER_DAY;
  }

  onTick(fn: TickListener) {
    this.listeners.push(fn);
  }

  step(): StepResult {
    const r = stepWorld(this.world);
    this.recent.push(...r.events);
    if (this.recent.length > 200) this.recent.splice(0, this.recent.length - 200);
    for (const l of this.listeners) l(r, this.world);
    return r;
  }

  start() {
    if (this.timer) return;
    this.pausedReason = undefined;
    const loop = () => {
      this.step();
      this.timer = setTimeout(loop, this.tickMs);
    };
    this.timer = setTimeout(loop, this.tickMs);
  }

  pause(reason?: string) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pausedReason = reason;
  }

  get running() {
    return this.timer !== null;
  }

  status(): SimStatus {
    return { running: this.running, speed: this.secondsPerDay, pausedReason: this.pausedReason };
  }

  recentEvents(): SimEvent[] {
    return [...this.recent];
  }

  /** Headless futás, ember és várakozás nélkül. */
  runTicks(n: number) {
    for (let i = 0; i < n; i++) this.step();
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
