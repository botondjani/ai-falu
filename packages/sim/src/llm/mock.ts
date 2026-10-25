import type { LlmClient, LlmRequest, RawCompletion } from "./types";

/** Beépített generátor: API nélkül, determinisztikusan a hívó által adott sablonos választ adja. */
export class MockClient implements LlmClient {
  readonly mock = true;

  async complete<T>(req: LlmRequest<T>): Promise<RawCompletion> {
    return { json: req.mock() };
  }
}
