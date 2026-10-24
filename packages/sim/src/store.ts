import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { SimEvent, WorldState } from "@falu/core";
import type { LlmUsage } from "./llm/types";

export interface LlmCallRecord {
  tick: number;
  agentId?: string;
  purpose: string;
  model: string;
  mock: boolean;
  usage: LlmUsage;
  costUsd: number;
  estCostUsd: number;
  latencyMs: number;
  ok: boolean;
  error?: string;
  response: unknown;
}

export interface RunInfo {
  id: number;
  seed: string;
  createdAt: string;
  config: Record<string, unknown>;
  lastTick: number;
}

/**
 * Append-only eseménynapló + napi snapshotok + külső bemenetek (LLM-válaszok, Isten-mód)
 * egy SQLite fájlban. A külső bemenetekből és a seedből a futás pontosan újrajátszható.
 */
export class EventStore {
  readonly db: Database.Database;
  private insertEvent: Database.Statement;
  private insertInput: Database.Statement;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.migrate();
    this.insertEvent = this.db.prepare(
      "INSERT INTO events (run_id, tick, type, agent_id, payload) VALUES (?, ?, ?, ?, ?)",
    );
    this.insertInput = this.db.prepare("INSERT INTO inputs (run_id, tick, kind, key, payload) VALUES (?, ?, ?, ?, ?)");
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        seed TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        config TEXT NOT NULL DEFAULT '{}'
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id INTEGER NOT NULL REFERENCES runs(id),
        tick INTEGER NOT NULL,
        type TEXT NOT NULL,
        agent_id TEXT,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS events_run_tick ON events(run_id, tick);
      CREATE INDEX IF NOT EXISTS events_run_agent ON events(run_id, agent_id, tick);
      CREATE TABLE IF NOT EXISTS snapshots (
        run_id INTEGER NOT NULL REFERENCES runs(id),
        tick INTEGER NOT NULL,
        state TEXT NOT NULL,
        PRIMARY KEY (run_id, tick)
      );
      CREATE TABLE IF NOT EXISTS inputs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id INTEGER NOT NULL REFERENCES runs(id),
        tick INTEGER NOT NULL,
        kind TEXT NOT NULL,
        key TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS inputs_run_tick ON inputs(run_id, tick);
      CREATE TABLE IF NOT EXISTS llm_calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id INTEGER NOT NULL REFERENCES runs(id),
        tick INTEGER NOT NULL,
        agent_id TEXT,
        purpose TEXT NOT NULL,
        model TEXT NOT NULL,
        mock INTEGER NOT NULL,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        cache_read_tokens INTEGER NOT NULL,
        cache_write_tokens INTEGER NOT NULL,
        cost_usd REAL NOT NULL,
        est_cost_usd REAL NOT NULL,
        latency_ms INTEGER NOT NULL,
        ok INTEGER NOT NULL,
        error TEXT,
        response TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS llm_calls_run ON llm_calls(run_id, tick);
      CREATE INDEX IF NOT EXISTS llm_calls_created ON llm_calls(created_at);
    `);
  }

  createRun(seed: string, config: Record<string, unknown> = {}): number {
    const r = this.db.prepare("INSERT INTO runs (seed, config) VALUES (?, ?)").run(seed, JSON.stringify(config));
    return Number(r.lastInsertRowid);
  }

  getRun(id: number): RunInfo | undefined {
    const row = this.db
      .prepare(
        `SELECT r.id, r.seed, r.created_at, r.config,
                MAX(COALESCE((SELECT MAX(tick) FROM events e WHERE e.run_id = r.id), 0),
                    COALESCE((SELECT MAX(tick) - 1 FROM snapshots s WHERE s.run_id = r.id), 0)) AS last_tick
         FROM runs r WHERE r.id = ?`,
      )
      .get(id) as { id: number; seed: string; created_at: string; config: string; last_tick: number } | undefined;
    return row && { id: row.id, seed: row.seed, createdAt: row.created_at, config: JSON.parse(row.config), lastTick: row.last_tick };
  }

  latestRunId(): number | undefined {
    const row = this.db.prepare("SELECT MAX(id) AS id FROM runs").get() as { id: number | null };
    return row.id ?? undefined;
  }

  listRuns(): RunInfo[] {
    const ids = this.db.prepare("SELECT id FROM runs ORDER BY id").all() as { id: number }[];
    return ids.map((r) => this.getRun(r.id)!);
  }

  /** Egy tick eseményei egy tranzakcióban. */
  appendEvents(runId: number, events: SimEvent[]) {
    if (events.length === 0) return;
    this.db.transaction(() => {
      for (const e of events) {
        const agentId = "agentId" in e ? e.agentId : null;
        this.insertEvent.run(runId, e.tick, e.type, agentId, JSON.stringify(e));
      }
    })();
  }

  events(runId: number, fromTick = 0, toTick = Number.MAX_SAFE_INTEGER): SimEvent[] {
    const rows = this.db
      .prepare("SELECT payload FROM events WHERE run_id = ? AND tick >= ? AND tick < ? ORDER BY id")
      .all(runId, fromTick, toTick) as { payload: string }[];
    return rows.map((r) => JSON.parse(r.payload));
  }

  saveSnapshot(runId: number, state: WorldState) {
    this.db
      .prepare("INSERT OR REPLACE INTO snapshots (run_id, tick, state) VALUES (?, ?, ?)")
      .run(runId, state.tick, JSON.stringify(state));
  }

  /** A legutóbbi snapshot, ami legfeljebb `atOrBefore` tickes. */
  loadSnapshot(runId: number, atOrBefore = Number.MAX_SAFE_INTEGER): WorldState | undefined {
    const row = this.db
      .prepare("SELECT state FROM snapshots WHERE run_id = ? AND tick <= ? ORDER BY tick DESC LIMIT 1")
      .get(runId, atOrBefore) as { state: string } | undefined;
    return row && JSON.parse(row.state);
  }

  recordInput(runId: number, tick: number, kind: string, key: string, payload: unknown) {
    this.insertInput.run(runId, tick, kind, key, JSON.stringify(payload));
  }

  inputs(runId: number, fromTick = 0): { tick: number; kind: string; key: string; payload: unknown }[] {
    const rows = this.db
      .prepare("SELECT tick, kind, key, payload FROM inputs WHERE run_id = ? AND tick >= ? ORDER BY id")
      .all(runId, fromTick) as { tick: number; kind: string; key: string; payload: string }[];
    return rows.map((r) => ({ ...r, payload: JSON.parse(r.payload) }));
  }

  recordLlmCall(runId: number, c: LlmCallRecord) {
    this.db
      .prepare(
        `INSERT INTO llm_calls (run_id, tick, agent_id, purpose, model, mock, input_tokens, output_tokens,
           cache_read_tokens, cache_write_tokens, cost_usd, est_cost_usd, latency_ms, ok, error, response)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        runId,
        c.tick,
        c.agentId ?? null,
        c.purpose,
        c.model,
        c.mock ? 1 : 0,
        c.usage.inputTokens,
        c.usage.outputTokens,
        c.usage.cacheReadTokens,
        c.usage.cacheWriteTokens,
        c.costUsd,
        c.estCostUsd,
        c.latencyMs,
        c.ok ? 1 : 0,
        c.error ?? null,
        JSON.stringify(c.response),
      );
  }

  /** Egy futás valós LLM-költése ($). */
  llmSpend(runId: number): number {
    const r = this.db.prepare("SELECT COALESCE(SUM(cost_usd), 0) AS s FROM llm_calls WHERE run_id = ?").get(runId) as { s: number };
    return r.s;
  }

  /** A mai (UTC) valós LLM-költés minden futásra együtt ($). */
  llmSpendToday(): number {
    const r = this.db
      .prepare("SELECT COALESCE(SUM(cost_usd), 0) AS s FROM llm_calls WHERE date(created_at) = date('now')")
      .get() as { s: number };
    return r.s;
  }

  /** Folytatáskor a snapshot utáni (újra lefutó) részt töröljük, hogy ne duplikálódjon. */
  truncateFrom(runId: number, tick: number) {
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM events WHERE run_id = ? AND tick >= ?").run(runId, tick);
      this.db.prepare("DELETE FROM snapshots WHERE run_id = ? AND tick > ?").run(runId, tick);
      this.db.prepare("DELETE FROM inputs WHERE run_id = ? AND tick >= ?").run(runId, tick);
    })();
  }

  close() {
    this.db.close();
  }
}
