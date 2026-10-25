import { existsSync } from "node:fs";
import { AnthropicClient } from "./llm/anthropic";
import { GeminiClient } from "./llm/gemini";
import type { BudgetConfig } from "./llm/gateway";
import { MockClient } from "./llm/mock";
import type { LlmClient, ModelTier } from "./llm/types";

/** .env betöltése, ha van (Node beépített betöltője). */
export function loadDotEnv() {
  for (const p of [".env", "../../.env"]) {
    if (existsSync(p)) {
      process.loadEnvFile(p);
      return;
    }
  }
}

const num = (v: string | undefined, d: number) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : d);

export function llmConfig() {
  const env = process.env;
  // Alapból Gemini; LLM_PROVIDER=anthropic esetén Claude.
  const provider = env.LLM_PROVIDER === "anthropic" ? ("anthropic" as const) : ("gemini" as const);
  const defaults =
    provider === "gemini"
      ? { routine: "gemini-3.5-flash-lite", strong: "gemini-3.8-flash" }
      : { routine: "claude-haiku-5-5", strong: "claude-sonnet-5-5" };
  const models: Record<ModelTier, string> = {
    routine: env.LLM_MODEL_ROUTINE || defaults.routine,
    strong: env.LLM_MODEL_STRONG || defaults.strong,
  };
  const budget: BudgetConfig = {
    maxUsdTotal: num(env.LLM_MAX_USD_TOTAL, 5),
    maxUsdPerRealDay: num(env.LLM_MAX_USD_PER_DAY, 2),
    maxCallsPerSimDay: num(env.LLM_MAX_CALLS_PER_SIM_DAY, 600),
  };
  const onBudget = env.LLM_ON_BUDGET === "autopilot" ? ("autopilot" as const) : ("pause" as const);
  const apiKey = (provider === "gemini" ? env.GEMINI_API_KEY : env.ANTHROPIC_API_KEY) || undefined;
  return { provider, models, budget, onBudget, apiKey };
}

/** A beállított szolgáltató kliense; kulcs nélkül (vagy --mock esetén) mock. */
export function makeClient(cfg: ReturnType<typeof llmConfig>, mock = false): LlmClient {
  if (mock || !cfg.apiKey) return new MockClient();
  return cfg.provider === "gemini" ? new GeminiClient(cfg.apiKey) : new AnthropicClient(cfg.apiKey);
}
