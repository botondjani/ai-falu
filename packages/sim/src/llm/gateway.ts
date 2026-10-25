import type { LlmClient, LlmRequest } from "./types";

export interface LlmResult<T> {
  data: T | null;
  error?: string;
}

/** Minden generálás ezen megy át: sémavalidálás, szemantikai ellenőrzés, 1 újrapróba. */
export class LlmGateway {
  calls = 0;
  failures = 0;

  constructor(private client: LlmClient) {}

  get mock() {
    return this.client.mock;
  }

  async call<T>(req: LlmRequest<T>, validate?: (data: T) => string | undefined): Promise<LlmResult<T>> {
    let extra: string | undefined;
    let lastError = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      this.calls++;
      let error: string | undefined;
      try {
        const res = await this.client.complete(req, extra);
        const parsed = req.schema.safeParse(res.json);
        if (!parsed.success) error = `séma: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`;
        else {
          error = validate?.(parsed.data);
          if (!error) return { data: parsed.data };
        }
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
      lastError = error ?? "ismeretlen hiba";
      extra = `Az előző válaszod érvénytelen volt (${lastError}). Válaszolj újra, a szabályok szerint.`;
    }
    this.failures++;
    return { data: null, error: lastError };
  }
}
