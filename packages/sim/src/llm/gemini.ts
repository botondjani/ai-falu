import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import type { LlmClient, LlmRequest, RawCompletion } from "./types";

/** Gondolkodási keret (token) az effort szint szerint; a rutinhívások gondolkodás nélkül mennek. */
const THINKING: Record<string, number> = { low: 0, medium: 1024, high: 4096 };

/** A zod-sémából Gemini-kompatibilis JSON-séma (a "$schema" kulcsot a Gemini nem fogadja). */
export function toGeminiSchema(schema: z.ZodType): unknown {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest;
}

/** Google Gemini API-kliens strukturált (JSON-sémás) kimenettel. A prompt cachinget a Gemini automatikusan végzi. */
export class GeminiClient implements LlmClient {
  readonly mock = false;
  private ai: GoogleGenAI;

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async complete<T>(req: LlmRequest<T>, model: string, extraUser?: string): Promise<RawCompletion> {
    let budget = THINKING[req.effort ?? "low"] ?? 0;
    if (/pro/.test(model)) budget = Math.max(128, budget); // a Pro nem tud gondolkodás nélkül futni
    const res = await this.ai.models.generateContent({
      model,
      contents: extraUser ? `${req.user}\n\n${extraUser}` : req.user,
      config: {
        systemInstruction: req.system.map((b) => b.text).join("\n\n"),
        responseMimeType: "application/json",
        responseJsonSchema: toGeminiSchema(req.schema),
        maxOutputTokens: req.maxTokens + budget,
        thinkingConfig: { thinkingBudget: budget },
      },
    });
    const finish = res.candidates?.[0]?.finishReason;
    if (finish && finish !== "STOP") throw new Error(`A válasz nem fejeződött be rendben (${finish})`);
    const text = res.text;
    if (!text) throw new Error("Üres válasz");
    const u = res.usageMetadata ?? {};
    const cached = u.cachedContentTokenCount ?? 0;
    return {
      json: JSON.parse(text),
      model,
      usage: {
        inputTokens: Math.max(0, (u.promptTokenCount ?? 0) - cached),
        outputTokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
        cacheReadTokens: cached,
        cacheWriteTokens: 0,
      },
    };
  }
}
