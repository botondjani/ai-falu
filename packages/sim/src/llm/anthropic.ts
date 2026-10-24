import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { LlmClient, LlmRequest, RawCompletion } from "./types";

/** Valódi Anthropic API-kliens strukturált (JSON-sémás) kimenettel és prompt cachinggel. */
export class AnthropicClient implements LlmClient {
  readonly mock = false;
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey, maxRetries: 2, timeout: 60_000 });
  }

  async complete<T>(req: LlmRequest<T>, model: string, extraUser?: string): Promise<RawCompletion> {
    const res = await this.client.messages.parse({
      model,
      max_tokens: req.maxTokens,
      system: req.system.map((b) => ({
        type: "text" as const,
        text: b.text,
        ...(b.cache ? { cache_control: { type: "ephemeral" as const } } : {}),
      })),
      messages: [{ role: "user", content: extraUser ? `${req.user}\n\n${extraUser}` : req.user }],
      output_config: { format: zodOutputFormat(req.schema), ...(req.effort ? { effort: req.effort } : {}) },
    });
    if (res.stop_reason === "refusal") throw new Error("A modell elutasította a kérést");
    if (res.stop_reason === "max_tokens") throw new Error("A válasz elérte a max_tokens korlátot");
    if (res.parsed_output == null) throw new Error("Nem értelmezhető JSON-válasz");
    return {
      json: res.parsed_output,
      model: res.model,
      usage: {
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
        cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: res.usage.cache_creation_input_tokens ?? 0,
      },
    };
  }
}
