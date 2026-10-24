import { DEMO_VILLAGERS, TICKS_PER_DAY, createWorld, describeEvent, lookupFrom, stamp, timeToTick, type World } from "@falu/core";
import { LiveDecisions, ReplayDecisions } from "./agents/decision";
import { llmConfig, loadDotEnv } from "./config";
import { AnthropicClient } from "./llm/anthropic";
import { LlmGateway } from "./llm/gateway";
import { MockClient } from "./llm/mock";
import { recordedDecisions, verifyRun, worldAt } from "./replay";
import { Runner } from "./runner";
import { startServer } from "./server";
import { EventStore } from "./store";

interface CliArgs {
  days?: number;
  mock: boolean;
  seed: string;
  port: number;
  secondsPerDay: number;
  verbose: boolean;
  db: string;
  resume?: number | "latest";
  replay?: number;
  fromDay: number;
  verify?: number;
  listRuns: boolean;
  llmAgents: string;
}

const HELP = `Használat: npm run sim -- [kapcsolók]

  --days N          headless futás N napig, összegzéssel (ember nélkül)
  --mock            LLM nélkül (API-kulcs nélkül automatikusan ez)
  --seed S          véletlen seed (alap: falu)
  --speed MP        valós másodperc / szimulált nap (alap: 600)
  --port P          WebSocket port (alap: 8787)
  --db FILE         SQLite fájl (alap: data/falu.db, ":memory:" is lehet)
  --resume [ID]     futás folytatása (alap: a legutóbbi)
  --replay ID       futás visszajátszása a viewerben
  --from-day D      visszajátszás kezdőnapja (alap: 1)
  --verify ID       determinizmus-ellenőrzés: újraszimulál és összeveti a naplóval
  --list-runs       futások listája
  --llm-agents L    LLM-mel döntő lakók: vesszős lista vagy "all" (alap: joska)
  -v, --verbose     minden esemény kiírása
`;

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    mock: false,
    seed: process.env.SIM_SEED ?? "falu",
    port: Number(process.env.SIM_PORT ?? 8787),
    secondsPerDay: Number(process.env.SIM_SECONDS_PER_DAY ?? 600),
    verbose: false,
    db: process.env.SIM_DB ?? "data/falu.db",
    fromDay: 1,
    listRuns: false,
    llmAgents: process.env.SIM_LLM_AGENTS ?? "joska",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`Hiányzó érték: ${a}`);
      return v;
    };
    if (a === "--days") args.days = Number(next());
    else if (a === "--mock") args.mock = true;
    else if (a === "--seed") args.seed = next();
    else if (a === "--port") args.port = Number(next());
    else if (a === "--speed") args.secondsPerDay = Number(next());
    else if (a === "--db") args.db = next();
    else if (a === "--resume") args.resume = argv[i + 1] && !argv[i + 1].startsWith("-") ? Number(next()) : "latest";
    else if (a === "--replay") args.replay = Number(next());
    else if (a === "--from-day") args.fromDay = Number(next());
    else if (a === "--verify") args.verify = Number(next());
    else if (a === "--list-runs") args.listRuns = true;
    else if (a === "--llm-agents") args.llmAgents = next();
    else if (a === "--verbose" || a === "-v") args.verbose = true;
    else if (a === "--help" || a === "-h") {
      console.log(HELP);
      process.exit(0);
    } else throw new Error(`Ismeretlen kapcsoló: ${a}\n\n${HELP}`);
  }
  // API-kulcs nélkül mindig mock mód: a falu így is teljesen működik (autopilot + mock LLM).
  if (!process.env.ANTHROPIC_API_KEY && !args.mock) {
    console.log("Nincs ANTHROPIC_API_KEY – mock módban fut (költség nélkül).");
    args.mock = true;
  }
  return args;
}

const names = (w: World) => lookupFrom(w.state.agents, w.map.locations);

async function main() {
  loadDotEnv();
  const args = parseArgs(process.argv.slice(2));
  const store = new EventStore(args.db);

  if (args.listRuns) {
    for (const r of store.listRuns()) {
      console.log(`#${r.id}  seed=${r.seed}  ${r.createdAt}  eddig: ${stamp(r.lastTick)}  ${JSON.stringify(r.config)}`);
    }
    return;
  }

  if (args.verify !== undefined) {
    const t0 = Date.now();
    const res = verifyRun(store, args.verify);
    if (res.ok) console.log(`OK: #${args.verify} determinisztikus (${res.events} esemény, ${res.ticks} tick, ${Date.now() - t0} ms)`);
    else {
      console.error(`ELTÉRÉS a(z) ${res.firstMismatch!.index}. eseménynél:`);
      console.error("  napló: ", JSON.stringify(res.firstMismatch!.expected));
      console.error("  újra:  ", JSON.stringify(res.firstMismatch!.actual));
      process.exitCode = 1;
    }
    return;
  }

  if (args.replay !== undefined) {
    const run = store.getRun(args.replay);
    if (!run) throw new Error(`Nincs ilyen futás: ${args.replay}`);
    const fromTick = Math.max(0, timeToTick(args.fromDay, 6));
    const world = worldAt(store, run.id, fromTick);
    const runner = new Runner({
      world,
      secondsPerDay: args.secondsPerDay,
      runId: run.id,
      mode: "visszajátszás",
      stopAtTick: run.lastTick + 1,
      decisions: new ReplayDecisions(recordedDecisions(store, run.id)),
    });
    startServer(runner, args.port);
    runner.start();
    console.log(`Visszajátszás: #${run.id} ${stamp(fromTick)} → ${stamp(run.lastTick)}  ws://localhost:${args.port}`);
    return;
  }

  const cfg = llmConfig();
  const client = args.mock || !cfg.apiKey ? new MockClient() : new AnthropicClient(cfg.apiKey);
  const llmAgents = args.llmAgents === "all" ? ("all" as const) : new Set(args.llmAgents.split(",").filter(Boolean));
  const withLlm = (runId: number) => {
    const gateway = new LlmGateway(client, cfg.models, cfg.budget, store, runId);
    return {
      decisions: new LiveDecisions(gateway, { llmAgents, onBudget: cfg.onBudget }, store, runId),
      llmStats: () => gateway.stats,
    };
  };

  let runner: Runner;
  if (args.resume !== undefined) {
    const id = args.resume === "latest" ? store.latestRunId() : args.resume;
    const snap = id !== undefined ? store.loadSnapshot(id) : undefined;
    if (id === undefined || !snap) throw new Error("Nincs folytatható futás");
    // A snapshot utáni naplót eldobjuk; determinisztikusan újra keletkezik.
    store.truncateFrom(id, snap.tick);
    runner = new Runner({ world: worldAt(store, id, snap.tick), secondsPerDay: args.secondsPerDay, store, runId: id, ...withLlm(id) });
    console.log(`Folytatás: #${id} ${stamp(snap.tick)}-tól`);
  } else {
    const runId = store.createRun(args.seed, { mock: client.mock, villagers: DEMO_VILLAGERS.length, llmAgents: args.llmAgents });
    runner = new Runner({
      world: createWorld(args.seed, DEMO_VILLAGERS),
      secondsPerDay: args.secondsPerDay,
      store,
      runId,
      ...withLlm(runId),
    });
  }

  const shutdown = () => {
    runner.pause();
    runner.flush();
    store.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  if (args.days !== undefined) {
    // Headless: lefut a megadott napokig, összegzést ír, kilép.
    const counts: Record<string, number> = {};
    runner.onTick((r, world) => {
      for (const e of r.events) {
        counts[e.type] = (counts[e.type] ?? 0) + 1;
        if (args.verbose || e.type === "day_started") console.log(`[${stamp(e.tick)}] ${describeEvent(e, names(world))}`);
      }
    });
    const t0 = Date.now();
    await runner.runTicks(args.days * TICKS_PER_DAY);
    runner.flush();
    if (runner.pausedReason) console.log(`\nLeállt: ${runner.pausedReason}`);
    console.log(`\nKész: #${runner.runId}, ${args.days} nap, ${runner.world.state.tick} tick, ${Date.now() - t0} ms  (${client.mock ? "mock" : "LLM"} mód)`);
    console.log("Események:", counts);
    for (const a of runner.world.state.agents) {
      console.log(
        `  ${a.name.padEnd(14)} pénz: ${String(a.money).padStart(4)}  éhség: ${a.needs.hunger.toFixed(0).padStart(3)}  energia: ${a.needs.energy.toFixed(0).padStart(3)}  készlet: ${JSON.stringify(a.inventory)}`,
      );
    }
    const st = runner.llmStats();
    if (st) {
      console.log(
        `LLM: ${st.calls} hívás (${st.failures} sikertelen, ${st.fallbacks} autopilot-tartalék), ` +
          `${st.inputTokens} be / ${st.outputTokens} ki / ${st.cacheReadTokens} cache token, ` +
          (st.mock ? `mock – valódi API-val kb. $${st.estimatedUsd.toFixed(4)}` : `$${st.usd.toFixed(4)}`),
      );
    }
    console.log(`Napló: ${args.db}  (visszajátszás: npm run sim -- --replay ${runner.runId})`);
    store.close();
    return;
  }

  startServer(runner, args.port);
  runner.onTick((r, world) => {
    if (args.verbose) for (const e of r.events) console.log(`[${stamp(e.tick)}] ${describeEvent(e, names(world))}`);
  });
  runner.start();
  console.log(
    `Falu szimuláció #${runner.runId} fut: ws://localhost:${args.port}  (1 nap = ${args.secondsPerDay} mp, ${client.mock ? "mock" : "LLM"} mód)`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
