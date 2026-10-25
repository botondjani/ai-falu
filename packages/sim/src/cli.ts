import { DEMO_VILLAGERS, TICKS_PER_DAY, VILLAGERS, createWorld, describeEvent, lookupFrom, stamp, timeToTick, type World } from "@falu/core";
import { LiveMind, ReplayInputs } from "./agents/mind";
import { loadDotEnv } from "./config";
import { LlmGateway } from "./llm/gateway";
import { MockClient } from "./llm/mock";
import { recordedInputs, verifyRun, worldAt } from "./replay";
import { Runner } from "./runner";
import { startServer } from "./server";
import { EventStore } from "./store";
import { SummaryService } from "./summary/service";
import { summarize } from "./summary/summary";

interface CliArgs {
  days?: number;
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
  villagers: "full" | "demo";
  summary?: number;
  events: { tick: number; text: string }[];
}

const HELP = `Használat: npm run sim -- [kapcsolók]

  --days N          headless futás N napig, összegzéssel (ember nélkül)
  --seed S          véletlen seed (alap: falu)
  --speed MP        valós másodperc / szimulált nap (alap: 600)
  --port P          WebSocket port (alap: 8787)
  --db FILE         SQLite fájl (alap: data/falu.db, ":memory:" is lehet)
  --resume [ID]     futás folytatása (alap: a legutóbbi)
  --replay ID       futás visszajátszása a viewerben
  --from-day D      visszajátszás kezdőnapja (alap: 1)
  --verify ID       determinizmus-ellenőrzés: újraszimulál és összeveti a naplóval
  --list-runs       futások listája
  --llm-agents L    LLM-mel gondolkodó lakók: vesszős lista vagy "all" (alap: all)
  --demo            csak a 3 demó lakó (alap: a teljes, 15 fős falu)
  --summary ID      "Amíg nem néztél oda" összefoglaló egy futásról (--from-day D-től a végéig)
  --event "N:H:SZ"  Isten-mód esemény N. nap H órakor (többször is megadható)
  -v, --verbose     minden esemény kiírása
`;

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    seed: process.env.SIM_SEED ?? "falu",
    port: Number(process.env.SIM_PORT ?? 8787),
    secondsPerDay: Number(process.env.SIM_SECONDS_PER_DAY ?? 600),
    verbose: false,
    db: process.env.SIM_DB ?? "data/falu.db",
    fromDay: 1,
    listRuns: false,
    llmAgents: process.env.SIM_LLM_AGENTS ?? "all",
    villagers: "full",
    events: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`Hiányzó érték: ${a}`);
      return v;
    };
    if (a === "--days") args.days = Number(next());
    else if (a === "--mock") {
      /* régi kapcsoló, már nincs hatása */
    }
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
    else if (a === "--demo") args.villagers = "demo";
    else if (a === "--summary") args.summary = Number(next());
    else if (a === "--event") {
      const m = /^(\d+):(\d+):(.+)$/.exec(next());
      if (!m) throw new Error('--event formátuma: "NAP:ÓRA:szöveg", pl. "2:14:Vihar jön"');
      args.events.push({ tick: timeToTick(Number(m[1]), Number(m[2])), text: m[3] });
    }
    else if (a === "--verbose" || a === "-v") args.verbose = true;
    else if (a === "--help" || a === "-h") {
      console.log(HELP);
      process.exit(0);
    } else throw new Error(`Ismeretlen kapcsoló: ${a}\n\n${HELP}`);
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

  const client = new MockClient();

  if (args.summary !== undefined) {
    const run = store.getRun(args.summary);
    if (!run) throw new Error(`Nincs ilyen futás: ${args.summary}`);
    const from = Math.max(0, timeToTick(args.fromDay, 6));
    const to = run.lastTick + 1;
    const world = worldAt(store, run.id, to);
    const gateway = new LlmGateway(client);
    const s = await summarize(world, store.events(run.id, from, to), from, to, gateway);
    console.log(`\n📜 Amíg nem néztél oda (${stamp(from)} – ${stamp(to)})\n`);
    console.log(s.story + "\n");
    s.highlights.forEach((h, i) => console.log(`  ${i + 1}. ${h.title} (${stamp(h.tick)})\n     ${h.text}`));
    store.close();
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
      inputs: new ReplayInputs(recordedInputs(store, run.id)),
    });
    startServer(runner, args.port, new SummaryService(runner));
    runner.start();
    console.log(`Visszajátszás: #${run.id} ${stamp(fromTick)} → ${stamp(run.lastTick)}  ws://localhost:${args.port}`);
    return;
  }

  const llmAgents = args.llmAgents === "all" ? ("all" as const) : new Set(args.llmAgents.split(",").filter(Boolean));
  const withLlm = (runId: number) => {
    const gateway = new LlmGateway(client);
    const mind = new LiveMind(gateway, { llmAgents }, store, runId);
    for (const e of args.events) mind.enqueueGod(e.text, e.tick);
    return { inputs: mind, gateway, mind };
  };

  const villagers = args.villagers === "demo" ? DEMO_VILLAGERS : VILLAGERS;
  let runner: Runner;
  let gateway: LlmGateway;
  let mind: LiveMind;
  if (args.resume !== undefined) {
    const id = args.resume === "latest" ? store.latestRunId() : args.resume;
    const snap = id !== undefined ? store.loadSnapshot(id) : undefined;
    if (id === undefined || !snap) throw new Error("Nincs folytatható futás");
    // A snapshot utáni naplót eldobjuk; determinisztikusan újra keletkezik.
    store.truncateFrom(id, snap.tick);
    const llm = withLlm(id);
    gateway = llm.gateway;
    mind = llm.mind;
    runner = new Runner({ world: worldAt(store, id, snap.tick), secondsPerDay: args.secondsPerDay, store, runId: id, ...llm });
    console.log(`Folytatás: #${id} ${stamp(snap.tick)}-tól`);
  } else {
    const runId = store.createRun(args.seed, { villagers: villagers.length });
    const llm = withLlm(runId);
    gateway = llm.gateway;
    mind = llm.mind;
    runner = new Runner({
      world: createWorld(args.seed, villagers),
      secondsPerDay: args.secondsPerDay,
      store,
      runId,
      ...llm,
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
    console.log(`\nKész: #${runner.runId}, ${args.days} nap, ${runner.world.state.tick} tick, ${Date.now() - t0} ms`);
    console.log("Események:", counts);
    for (const a of runner.world.state.agents) {
      console.log(
        `  ${a.name.padEnd(14)} pénz: ${String(a.money).padStart(4)}  éhség: ${a.needs.hunger.toFixed(0).padStart(3)}  energia: ${a.needs.energy.toFixed(0).padStart(3)}  készlet: ${JSON.stringify(a.inventory)}`,
      );
    }
    console.log(`Napló: ${args.db}  (visszajátszás: npm run sim -- --replay ${runner.runId})`);
    store.close();
    return;
  }

  startServer(runner, args.port, new SummaryService(runner, gateway, store, runner.runId), {
    god: (text) => mind.enqueueGod(text),
    whisper: (agentId, text) => mind.enqueueWhisper(agentId, text),
  });
  runner.onTick((r, world) => {
    if (args.verbose) for (const e of r.events) console.log(`[${stamp(e.tick)}] ${describeEvent(e, names(world))}`);
  });
  runner.start();
  console.log(
    `Falu szimuláció #${runner.runId} fut: ws://localhost:${args.port}  (1 nap = ${args.secondsPerDay} mp)`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
