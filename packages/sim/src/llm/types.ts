import type { z } from "zod";

export type ModelTier = "routine" | "strong";

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
  /** A generált JSON-kimenet (még nem validálva). */
  json: unknown;
}

/** A lakók "elméjét" adó generátor. Jelenleg a beépített, szabály- és sablonalapú (mock) generátor. */
export interface LlmClient {
  readonly mock: boolean;
  complete<T>(req: LlmRequest<T>, extraUser?: string): Promise<RawCompletion>;
}
