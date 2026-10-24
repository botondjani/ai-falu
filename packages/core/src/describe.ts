import { formatTime, tickToTime } from "./time";
import type { SimEvent } from "./types";

export interface NameLookup {
  agent: (id: string) => string;
  place: (id: string) => string;
}

export function lookupFrom(
  agents: { id: string; name: string }[],
  locations: { id: string; name: string }[],
): NameLookup {
  return {
    agent: (id) => agents.find((a) => a.id === id)?.name ?? id,
    place: (id) => locations.find((l) => l.id === id)?.name ?? id,
  };
}

/** Egy esemény emberi nyelven (CLI log, viewer feed). */
export function describeEvent(e: SimEvent, n: NameLookup): string {
  switch (e.type) {
    case "day_started":
      return `── ${e.day}. nap ──`;
    case "activity_started":
      return `${n.agent(e.agentId)}: ${e.kind} (${n.place(e.locationId)}) – ${e.reason}${e.say ? ` – „${e.say}”` : ""}`;
    case "arrived":
      return `${n.agent(e.agentId)} megérkezett: ${n.place(e.locationId)}`;
    case "ate":
      return `${n.agent(e.agentId)} evett (${e.what})`;
    case "produced":
      return `${n.agent(e.agentId)} készített: ${e.qty} ${e.item}`;
    case "paid":
      return `${n.agent(e.agentId)} fizetett ${e.amount} tallért (${e.reason})`;
    case "earned":
      return `${n.agent(e.agentId)} keresett ${e.amount} tallért`;
    case "took":
      return `${n.agent(e.agentId)} hazavitt: ${e.qty} ${e.item}`;
    case "starving":
      return `${n.agent(e.agentId)} nagyon éhes!`;
    case "planned":
      return `${n.agent(e.agentId)} mai célja: ${e.goal}`;
    case "conversation":
      return `${n.agent(e.a)} és ${n.agent(e.b)} beszélgetett (${e.topic})`;
    case "gossip":
      return `${n.agent(e.agentId)} pletykált ${n.agent(e.listenerId)} fülébe ${n.agent(e.aboutId)} kapcsán: „${e.text}”`;
    case "reflected":
      return `${n.agent(e.agentId)} elgondolkodott (${e.mood}): ${e.insights.join(" ")}`;
  }
}

export function stamp(tick: number): string {
  return formatTime(tickToTime(tick));
}
