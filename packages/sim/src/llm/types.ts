import type { z } from "zod";

export type ModelTier = "routine" | "strong";

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface SystemBlock {
  text: string;
  /** Cache breakpoint a blokk végén (a stabil prefix vége). */
  cache?: boolean;
}

export interface LlmRequest<T> {
  purpose: string;
  tick: number;
  agentId?: string;
  tier: ModelTier;
  system: SystemBlock[];
  user: string;
  schema: z.ZodType<T>;
  maxTokens: number;
  effort?: "low" | "medium" | "high";
  /** Mock módban ezt adja vissza a kliens (ugyanazon a validáción megy át). */
  mock: () => unknown;
}

export interface RawCompletion {
  /** A modell JSON-kimenete (még nem validálva a sémán túli szabályokra). */
  json: unknown;
  usage: LlmUsage;
  model: string;
}

export interface LlmClient {
  readonly mock: boolean;
  complete<T>(req: LlmRequest<T>, model: string, extraUser?: string): Promise<RawCompletion>;
}
