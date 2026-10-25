import type { LlmUsage } from "./types";

/** $ / millió token. Cache-olvasás 0.1×, cache-írás 1.25× az input árának (Gemininél nincs írási díj). */
export const PRICING: Record<string, { input: number; output: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-opus-5-5": { input: 4, output: 20 },
  "gemini-2.5-flash-lite": { input: 0.1, output: 0.4 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "gemini-2.5-pro": { input: 1.25, output: 10 },
};

export function costUsd(model: string, u: LlmUsage): number {
  const p = PRICING[model] ?? PRICING["claude-sonnet-5-5"];
  return (
    (u.inputTokens * p.input +
      u.outputTokens * p.output +
      u.cacheReadTokens * p.input * 0.1 +
      u.cacheWriteTokens * p.input * 1.25) /
    1_000_000
  );
}

/** Durva tokenbecslés mock módhoz (magyar szövegre ~3.2 karakter/token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.2);
}
