import { existsSync } from "node:fs";
import type { BudgetConfig } from "./llm/gateway";
import type { ModelTier } from "./llm/types";

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
  const models: Record<ModelTier, string> = {
    routine: env.LLM_MODEL_ROUTINE || "claude-haiku-5-5",
    strong: env.LLM_MODEL_STRONG || "claude-sonnet-5-5",
  };
  const budget: BudgetConfig = {
    maxUsdTotal: num(env.LLM_MAX_USD_TOTAL, 5),
    maxUsdPerRealDay: num(env.LLM_MAX_USD_PER_DAY, 2),
    maxCallsPerSimDay: num(env.LLM_MAX_CALLS_PER_SIM_DAY, 600),
  };
  const onBudget = env.LLM_ON_BUDGET === "autopilot" ? ("autopilot" as const) : ("pause" as const);
  return { models, budget, onBudget, apiKey: env.ANTHROPIC_API_KEY || undefined };
}
