import { VILLAGERS, createWorld } from "@falu/core";
import { LiveMind } from "./agents/mind";
import { LlmGateway } from "./llm/gateway";
import { MockClient } from "./llm/mock";
import type { ClientMessage, ServerMessage } from "./protocol";
import { Runner } from "./runner";
import { handleClientMessage, initMessage, tickMessage } from "./session";
import { SummaryService } from "./summary/service";

/**
 * Böngészős demó: a teljes szimuláció a böngészőben fut (mock LLM-mel, szerver és API-kulcs nélkül).
 * WebSocket-szerű felületet ad, így a viewer változtatás nélkül használhatja.
 */
export class LocalSocket {
  readonly OPEN = 1;
  readyState = 1;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  private runner: Runner;
  private summaries: SummaryService;
  private mind: LiveMind;

  constructor(seed = "falu", secondsPerDay = 120) {
    const gateway = new LlmGateway(new MockClient(), { routine: "claude-haiku-5-5", strong: "claude-sonnet-5-5" }, {
      maxUsdTotal: 5,
      maxUsdPerRealDay: 2,
      maxCallsPerSimDay: 600,
    });
    this.mind = new LiveMind(gateway, { llmAgents: "all", onBudget: "autopilot" });
    this.runner = new Runner({ world: createWorld(seed, VILLAGERS), secondsPerDay, inputs: this.mind, llmStats: () => gateway.stats });
    this.summaries = new SummaryService(this.runner, gateway);
    this.runner.onTick((r, w) => this.emit(tickMessage(this.runner, r, w)));
    this.runner.onStatus(() => this.emit({ type: "status", status: this.runner.status() }));
    setTimeout(() => {
      this.onopen?.();
      this.emit(initMessage(this.runner, this.summaries));
      this.runner.start();
    }, 0);
  }

  private emit(m: ServerMessage) {
    this.onmessage?.({ data: JSON.stringify(m) });
  }

  send(data: string) {
    const msg = JSON.parse(data) as ClientMessage;
    void handleClientMessage(msg, this.runner, (m) => this.emit(m), this.summaries, {
      god: (t) => this.mind.enqueueGod(t),
      whisper: (a, t) => this.mind.enqueueWhisper(a, t),
    });
  }

  close() {
    this.runner.pause();
  }
}
