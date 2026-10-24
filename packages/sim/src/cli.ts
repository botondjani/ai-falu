import { DEMO_VILLAGERS, TICKS_PER_DAY, describeEvent, lookupFrom, stamp, type World } from "@falu/core";
import { Runner } from "./runner";
import { startServer } from "./server";

interface CliArgs {
  days?: number;
  mock: boolean;
  seed: string;
  port: number;
  secondsPerDay: number;
  verbose: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    mock: false,
    seed: process.env.SIM_SEED ?? "falu",
    port: Number(process.env.SIM_PORT ?? 8787),
    secondsPerDay: Number(process.env.SIM_SECONDS_PER_DAY ?? 600),
    verbose: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--days") args.days = Number(next());
    else if (a === "--mock") args.mock = true;
    else if (a === "--seed") args.seed = next();
    else if (a === "--port") args.port = Number(next());
    else if (a === "--speed") args.secondsPerDay = Number(next());
    else if (a === "--verbose" || a === "-v") args.verbose = true;
    else throw new Error(`Ismeretlen kapcsoló: ${a}`);
  }
  return args;
}

const names = (w: World) => lookupFrom(w.state.agents, w.map.locations);

function main() {
  const args = parseArgs(process.argv.slice(2));
  const runner = new Runner({ seed: args.seed, villagers: DEMO_VILLAGERS, secondsPerDay: args.secondsPerDay });

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
    runner.runTicks(args.days * TICKS_PER_DAY);
    console.log(`\nKész: ${args.days} nap, ${runner.world.state.tick} tick, ${Date.now() - t0} ms`);
    console.log("Események:", counts);
    for (const a of runner.world.state.agents) {
      console.log(
        `  ${a.name.padEnd(14)} pénz: ${String(a.money).padStart(4)}  éhség: ${a.needs.hunger.toFixed(0).padStart(3)}  energia: ${a.needs.energy.toFixed(0).padStart(3)}  készlet: ${JSON.stringify(a.inventory)}`,
      );
    }
    return;
  }

  startServer(runner, args.port);
  runner.onTick((r, world) => {
    if (args.verbose) for (const e of r.events) console.log(`[${stamp(e.tick)}] ${describeEvent(e, names(world))}`);
  });
  runner.start();
  console.log(`Falu szimuláció fut: ws://localhost:${args.port}  (1 nap = ${args.secondsPerDay} mp, seed: ${args.seed})`);
}

main();
