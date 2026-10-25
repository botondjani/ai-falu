import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { GeminiClient, toGeminiSchema } from "../src/llm/gemini";
import { costUsd } from "../src/llm/pricing";

describe("Gemini kliens", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("JSON-séma: $schema nélkül, enumokkal és leírásokkal", () => {
    const s = toGeminiSchema(z.object({ a: z.enum(["x", "y"]).describe("válassz"), n: z.number() })) as Record<string, any>;
    expect(s.$schema).toBeUndefined();
    expect(s.properties.a).toMatchObject({ enum: ["x", "y"], description: "válassz" });
    expect(s.required).toEqual(["a", "n"]);
  });

  it("kérés és tokenhasználat leképezése (hamis fetch-csel)", async () => {
    let body: any;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        body = JSON.parse(String(init.body));
        return new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: '{"ok":true}' }], role: "model" }, finishReason: "STOP" }],
            usageMetadata: { promptTokenCount: 1000, cachedContentTokenCount: 600, candidatesTokenCount: 50, thoughtsTokenCount: 20 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );
    const c = new GeminiClient("test-key");
    const res = await c.complete(
      {
        purpose: "t",
        tick: 0,
        tier: "routine",
        system: [{ text: "rendszer" }, { text: "persona", cache: true }],
        user: "kérdés",
        schema: z.object({ ok: z.boolean() }),
        maxTokens: 500,
        effort: "low",
        mock: () => ({}),
      },
      "gemini-2.5-flash-lite",
    );
    expect(res.json).toEqual({ ok: true });
    expect(res.usage).toEqual({ inputTokens: 400, outputTokens: 70, cacheReadTokens: 600, cacheWriteTokens: 0 });
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.thinkingConfig.thinkingBudget).toBe(0);
    expect(JSON.stringify(body.systemInstruction)).toContain("persona");
    expect(costUsd("gemini-2.5-flash-lite", res.usage)).toBeCloseTo((400 * 0.1 + 70 * 0.4 + 600 * 0.01) / 1e6);
  });
});
