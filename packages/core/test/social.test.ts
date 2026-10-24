import { describe, expect, it } from "vitest";
import {
  adjustRelation,
  applyConversation,
  conversationCandidates,
  getRelation,
  initialRelation,
  knownGossip,
  type Conversation,
} from "../src/social";
import { VILLAGERS } from "../src/seed/villagers";
import { timeToTick } from "../src/time";
import { createWorld, type World } from "../src/world";
import type { SimEvent } from "../src/types";

function conv(over: Partial<Conversation> = {}): Conversation {
  return {
    a: "bela",
    b: "mari",
    topic: "időjárás",
    lines: [
      { speaker: "bela", text: "Szép idő van." },
      { speaker: "mari", text: "Az bizony." },
    ],
    memoryA: "Mari kedves volt.",
    memoryB: "Béla ma morcos.",
    deltaA: { trust: 3, liking: 4 },
    deltaB: { trust: -2, liking: -1 },
    ...over,
  };
}

/** Két lakó ugyanazon a helyen, ráérve. */
function place(w: World, ids: string[], loc: string) {
  for (const id of ids) {
    const a = w.state.agents.find((x) => x.id === id)!;
    a.activity = { kind: "szórakozik", locationId: loc, reason: "", source: "auto", startedTick: 0, arrived: true };
    a.needs = { hunger: 10, energy: 80 };
  }
}

describe("kapcsolatok", () => {
  it("kezdő vélemények a seed-kapcsolatból", () => {
    expect(initialRelation("régi barát").trust).toBeGreaterThan(0);
    expect(initialRelation("gyanakszik rá").trust).toBeLessThan(0);
    const w = createWorld("t", VILLAGERS);
    expect(getRelation(w.state, "mari", "joska").trust).toBeLessThan(0);
    expect(getRelation(w.state, "pista", "eszter").liking).toBeGreaterThan(0);
    expect(getRelation(w.state, "bela", "lajos")).toEqual({ trust: 0, liking: 0 });
  });

  it("-100..100 közé szorítva", () => {
    const w = createWorld("t", VILLAGERS);
    adjustRelation(w.state, "a", "b", { trust: 500, liking: -500 });
    expect(getRelation(w.state, "a", "b")).toEqual({ trust: 100, liking: -100 });
  });
});

describe("beszélgetés", () => {
  it("jelöltek: csak egy helyen lévő, ráérő párok; determinisztikus", () => {
    const w = createWorld("t", VILLAGERS);
    w.state.tick = timeToTick(1, 19);
    place(w, ["bela", "mari", "joska"], "kocsma");
    let found: [string, string][] = [];
    for (let i = 0; i < 100 && found.length === 0; i++) {
      w.state.tick++;
      found = conversationCandidates(w.state, w.map);
    }
    expect(found).toHaveLength(1);
    expect(conversationCandidates(w.state, w.map)).toEqual(found);
    // éjjel nincs beszélgetés
    w.state.tick = timeToTick(1, 23);
    for (let i = 0; i < 50; i++, w.state.tick++) expect(conversationCandidates(w.state, w.map)).toEqual([]);
  });

  it("cooldown: ugyanaz a pár 3 órán belül nem beszélget újra", () => {
    const w = createWorld("t", VILLAGERS);
    w.state.tick = timeToTick(1, 19);
    place(w, ["bela", "mari"], "kocsma");
    applyConversation(w.state, conv(), []);
    for (let i = 0; i < 30; i++) {
      w.state.tick++;
      expect(conversationCandidates(w.state, w.map)).toEqual([]);
    }
  });

  it("hatás: esemény, emlékek mindkét félnél, kapcsolatváltozás (korlátozva)", () => {
    const w = createWorld("t", VILLAGERS);
    const before = getRelation(w.state, "bela", "mari");
    const events: SimEvent[] = [];
    applyConversation(w.state, conv({ deltaA: { trust: 50, liking: 4 } }), events);
    expect(events[0]).toMatchObject({ type: "conversation", a: "bela", b: "mari" });
    expect(getRelation(w.state, "bela", "mari")).toEqual({ trust: before.trust + 15, liking: before.liking + 4 });
    const mem = (id: string) => w.state.memories.filter((m) => m.agentId === id && m.kind === "beszélgetés");
    expect(mem("bela")).toHaveLength(1);
    expect(mem("mari")[0].text).toMatch(/Béla ma morcos/);
  });
});

describe("pletyka", () => {
  it("új pletyka: a hallgató emléket kap, véleménye romlik az alanyról, és tovább adhatja", () => {
    const w = createWorld("t", VILLAGERS);
    const events: SimEvent[] = [];
    const before = getRelation(w.state, "mari", "gabor");
    applyConversation(
      w.state,
      conv({ gossip: { teller: "bela", aboutId: "gabor", text: "Gábor elköltötte a kútpénzt.", sentiment: "rossz" } }),
      events,
    );
    const g = w.state.gossip[0];
    expect(g.knownBy).toEqual(["bela", "mari"]);
    expect(events.some((e) => e.type === "gossip" && e.fresh)).toBe(true);
    expect(getRelation(w.state, "mari", "gabor").liking).toBeLessThan(before.liking);
    expect(w.state.memories.some((m) => m.agentId === "mari" && m.kind === "pletyka")).toBe(true);
    expect(w.state.agents.find((a) => a.id === "mari")!.surprised).toBe(true);

    // Mari továbbadja Terinek ugyanazt a pletykát
    applyConversation(
      w.state,
      conv({ a: "mari", b: "teri", gossip: { teller: "mari", aboutId: "gabor", text: "x", sentiment: "rossz", gossipId: g.id } }),
      [],
    );
    expect(w.state.gossip).toHaveLength(1);
    expect(g.knownBy).toEqual(["bela", "mari", "teri"]);
    expect(knownGossip(w.state, "teri")[0].text).toBe("Gábor elköltötte a kútpénzt.");
  });

  it("ismert pletyka újrahallása nem ad új emléket", () => {
    const w = createWorld("t", VILLAGERS);
    const c = conv({ gossip: { teller: "bela", aboutId: "gabor", text: "Pletyka.", sentiment: "semleges" } });
    applyConversation(w.state, c, []);
    const n = w.state.memories.filter((m) => m.kind === "pletyka").length;
    applyConversation(w.state, { ...c, gossip: { ...c.gossip!, gossipId: 1 } }, []);
    expect(w.state.memories.filter((m) => m.kind === "pletyka").length).toBe(n);
  });

  it("nem ismert pletykát nem lehet továbbadni (új pletyka lesz belőle)", () => {
    const w = createWorld("t", VILLAGERS);
    applyConversation(w.state, conv({ gossip: { teller: "bela", aboutId: "gabor", text: "A.", sentiment: "rossz" } }), []);
    applyConversation(
      w.state,
      conv({ a: "teri", b: "rozsi", gossip: { teller: "teri", aboutId: "gabor", text: "B.", sentiment: "rossz", gossipId: 1 } }),
      [],
    );
    expect(w.state.gossip).toHaveLength(2);
    expect(w.state.gossip[1].originId).toBe("teri");
  });
});
