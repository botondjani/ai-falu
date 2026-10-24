import { estimateTokens } from "./pricing";
import type { LlmClient, LlmRequest, RawCompletion } from "./types";

/**
 * Mock LLM: API és költség nélkül, determinisztikusan a hívó által adott mock-választ adja.
 * A tokenhasználatot becsli, így a költségszámláló mock módban is mutat "mennyibe került volna" értéket.
 */
export class MockClient implements LlmClient {
  readonly mock = true;

  async complete<T>(req: LlmRequest<T>, model: string): Promise<RawCompletion> {
    const json = req.mock();
    const sys = req.system.reduce((n, b) => n + estimateTokens(b.text), 0);
    const cached = req.system.filter((b) => b.cache).length > 0;
    return {
      json,
      model,
      usage: {
        inputTokens: estimateTokens(req.user) + (cached ? 0 : sys),
        outputTokens: estimateTokens(JSON.stringify(json)) + 60,
        cacheReadTokens: cached ? sys : 0,
        cacheWriteTokens: 0,
      },
    };
  }
}
