import { TICKS_PER_DAY } from "@falu/core";
import type { EventStore } from "../store";
import { costUsd } from "./pricing";
import type { LlmClient, LlmRequest, LlmUsage, ModelTier } from "./types";

export interface BudgetConfig {
  /** Összes valós költés ($) egy futásban. */
  maxUsdTotal: number;
  /** Valós naptári napi költés ($), minden futásra együtt. */
  maxUsdPerRealDay: number;
  /** Hívások száma szimulált naponként. */
  maxCallsPerSimDay: number;
}

export interface LlmStats {
  mock: boolean;
  calls: number;
  failures: number;
  fallbacks: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Valós költés (mock módban 0). */
  usd: number;
  /** Mennyibe került volna valódi API-val (mock módban becslés). */
  estimatedUsd: number;
  callsToday: number;
  budget: BudgetConfig;
  budgetExceeded?: string;
}

export class BudgetExceededError extends Error {}

export interface LlmResult<T> {
  data: T | null;
  error?: string;
}

/**
 * Minden LLM-hívás ezen megy át: modellválasztás, költségkeret, validálás + 1 újrapróba,
 * naplózás az llm_calls táblába, statisztika a UI-nak.
 */
export class LlmGateway {
  readonly stats: LlmStats;
  private callsBySimDay = new Map<number, number>();

  constructor(
    private client: LlmClient,
    private models: Record<ModelTier, string>,
    budget: BudgetConfig,
    private store?: EventStore,
    private runId?: number,
  ) {
    this.stats = {
      mock: client.mock,
      calls: 0,
      failures: 0,
      fallbacks: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      usd: store && runId !== undefined ? store.llmSpend(runId) : 0,
      estimatedUsd: 0,
      callsToday: 0,
      budget,
    };
  }

  get mock() {
    return this.client.mock;
  }

  /** Elérte-e a keretet; ha igen, az okot adja. */
  checkBudget(tick: number): string | undefined {
    const b = this.stats.budget;
    const day = Math.floor(tick / TICKS_PER_DAY);
    const calls = this.callsBySimDay.get(day) ?? 0;
    this.stats.callsToday = calls;
    let reason: string | undefined;
    if (calls >= b.maxCallsPerSimDay) reason = `elérte a napi hívásplafont (${b.maxCallsPerSimDay})`;
    else if (!this.client.mock && this.stats.usd >= b.maxUsdTotal) reason = `elérte az összköltség-plafont ($${b.maxUsdTotal})`;
    else if (!this.client.mock && this.store && this.store.llmSpendToday() >= b.maxUsdPerRealDay)
      reason = `elérte a mai költségplafont ($${b.maxUsdPerRealDay})`;
    this.stats.budgetExceeded = reason;
    return reason;
  }

  async call<T>(req: LlmRequest<T>, validate?: (data: T) => string | undefined): Promise<LlmResult<T>> {
    const reason = this.checkBudget(req.tick);
    if (reason) throw new BudgetExceededError(reason);
    const day = Math.floor(req.tick / TICKS_PER_DAY);

    const model = this.models[req.tier];
    let extra: string | undefined;
    let lastError = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      // A hívást rögtön lefoglaljuk, hogy a párhuzamos kérések se lépjék túl a plafont.
      this.callsBySimDay.set(day, (this.callsBySimDay.get(day) ?? 0) + 1);
      const t0 = Date.now();
      let usage: LlmUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
      let raw: unknown = null;
      let error: string | undefined;
      let data: T | null = null;
      try {
        const res = await this.client.complete(req, model, extra);
        usage = res.usage;
        raw = res.json;
        const parsed = req.schema.safeParse(res.json);
        if (!parsed.success) error = `séma: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`;
        else {
          error = validate?.(parsed.data);
          if (!error) data = parsed.data;
        }
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
      this.account(req, model, usage, Date.now() - t0, raw, error);
      if (data !== null) return { data };
      lastError = error ?? "ismeretlen hiba";
      extra = `Az előző válaszod érvénytelen volt (${lastError}). Válaszolj újra, a szabályok szerint.`;
    }
    this.stats.failures++;
    return { data: null, error: lastError };
  }

  noteFallback() {
    this.stats.fallbacks++;
  }

  private account(req: LlmRequest<unknown>, model: string, u: LlmUsage, latencyMs: number, raw: unknown, error?: string) {
    const s = this.stats;
    const est = costUsd(model, u);
    const real = this.client.mock ? 0 : est;
    s.calls++;
    s.inputTokens += u.inputTokens;
    s.outputTokens += u.outputTokens;
    s.cacheReadTokens += u.cacheReadTokens;
    s.cacheWriteTokens += u.cacheWriteTokens;
    s.usd += real;
    s.estimatedUsd += est;
    this.stats.callsToday = this.callsBySimDay.get(Math.floor(req.tick / TICKS_PER_DAY)) ?? 0;
    if (this.store && this.runId !== undefined) {
      this.store.recordLlmCall(this.runId, {
        tick: req.tick,
        agentId: req.agentId,
        purpose: req.purpose,
        model,
        mock: this.client.mock,
        usage: u,
        costUsd: real,
        estCostUsd: est,
        latencyMs,
        ok: !error,
        error,
        response: raw,
      });
    }
  }
}
