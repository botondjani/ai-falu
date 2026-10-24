import { TICKS_PER_DAY, knownGossip, stepWorld, type ExternalInputs, type SimEvent, type StepResult, type World } from "@falu/core";
import type { InputProvider } from "./agents/mind";
import { BudgetExceededError, type LlmStats } from "./llm/gateway";
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
  /** Külső (LLM vagy rögzített) bemenetek forrása. */
  inputs?: InputProvider;
  llmStats?: () => LlmStats | undefined;
}

type TickListener = (r: StepResult, world: World) => void;

/** A szimuláció óraműve: valós időben vagy egy ütemben (headless) lépteti a világot. */
export class Runner {
  readonly world: World;
  readonly store?: EventStore;
  readonly runId?: number;
  readonly mode: SimStatus["mode"];
  stopAtTick?: number;
  readonly inputs?: InputProvider;
  readonly llmStats: () => LlmStats | undefined;
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
    this.inputs = opts.inputs;
    this.llmStats = opts.llmStats ?? (() => undefined);
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

  /**
   * Egy tick: előbb a döntési ponton álló lakók külső döntései (LLM), aztán a determinisztikus lépés.
   * Keret elérésekor nem lép, hanem null-t ad és szünetel.
   */
  async advance(): Promise<StepResult | null> {
    let external: ExternalInputs = {};
    if (this.inputs) {
      try {
        external = await this.inputs.collect(this.world);
      } catch (e) {
        if (e instanceof BudgetExceededError) {
          this.pause(`költségkeret: ${e.message}`);
          return null;
        }
        throw e;
      }
    }
    const r = this.step(external);
    this.inputs?.observe?.(r.events);
    return r;
  }

  step(external: ExternalInputs = {}): StepResult {
    const r = stepWorld(this.world, external);
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
    const loop = async () => {
      const t0 = Date.now();
      try {
        const r = await this.advance();
        if (!r || !this.timer) return; // szünet közben
      } catch (e) {
        console.error("Hiba a tick közben:", e);
        this.timer = null;
        this.pause(`hiba: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
      if (this.atEnd()) {
        this.timer = null;
        this.pause("visszajátszás vége");
        return;
      }
      this.timer = setTimeout(loop, Math.max(0, this.tickMs - (Date.now() - t0)));
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
      llm: this.llmStats(),
      mode: this.mode,
      runId: this.runId,
    };
  }

  recentEvents(): SimEvent[] {
    return [...this.recent];
  }

  /** Headless futás, ember és várakozás nélkül. Leáll, ha elfogy a keret. */
  async runTicks(n: number): Promise<void> {
    for (let i = 0; i < n && !this.atEnd(); i++) {
      if (!(await this.advance())) return;
    }
  }

  /** Leállításkor snapshot, hogy a folytatás ne a nap elejéről induljon. */
  flush() {
    if (this.store && this.runId !== undefined) this.store.saveSnapshot(this.runId, this.world.state);
  }

  agentViews(): AgentView[] {
    const st = this.world.state;
    return st.agents.map((a) => ({
      id: a.id,
      name: a.name,
      occupation: a.occupation,
      color: a.color,
      pos: a.pos,
      activity: a.activity
        ? {
            kind: a.activity.kind,
            locationId: a.activity.locationId,
            reason: a.activity.reason,
            source: a.activity.source,
            say: a.activity.say,
          }
        : null,
      needs: { hunger: Math.round(a.needs.hunger), energy: Math.round(a.needs.energy) },
      money: a.money,
      inventory: a.inventory,
      mood: a.mood,
      planGoal: a.plan?.goal,
      relations: Object.entries(st.relations)
        .filter(([k, r]) => k.startsWith(`${a.id}>`) && (r.trust !== 0 || r.liking !== 0))
        .map(([k, r]) => ({ with: k.slice(a.id.length + 1), ...r })),
      knownGossip: knownGossip(st, a.id).length,
    }));
  }
}
