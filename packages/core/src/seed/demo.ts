import type { VillagerSeed } from "../types";

/** Az 1. lépés három kézzel írt lakója. */
export const DEMO_VILLAGERS: VillagerSeed[] = [
  {
    id: "bela",
    name: "Kovács Béla",
    age: 47,
    occupation: "kovács",
    traits: ["morcos", "szorgalmas", "büszke"],
    secretDesire: "Szeretné, ha a falu őt választaná bírónak.",
    homeId: "haz_1",
    workplaceId: "kovacs",
    produces: "szerszám",
    color: "#c0392b",
    relationships: [{ with: "mari", kind: "régi barát" }],
  },
  {
    id: "mari",
    name: "Pék Mari",
    age: 38,
    occupation: "pék",
    traits: ["kedves", "pletykás", "korán kelő"],
    secretDesire: "Titokban városi cukrászdát nyitna.",
    homeId: "haz_2",
    workplaceId: "pekseg",
    produces: "kenyér",
    color: "#f39c12",
    relationships: [
      { with: "bela", kind: "régi barát" },
      { with: "joska", kind: "gyanakszik rá" },
    ],
  },
  {
    id: "joska",
    name: "Szabó Jóska",
    age: 29,
    occupation: "földműves",
    traits: ["lusta", "vicces", "nagyravágyó"],
    secretDesire: "Meg akarja venni a kocsmát.",
    homeId: "haz_3",
    workplaceId: "mezo",
    produces: "gabona",
    color: "#27ae60",
    money: 12,
    inventory: {},
  },
];
