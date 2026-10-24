import type { VillagerSeed } from "../types";
import villagers from "./villagers.json";

/** A falu kezdő lakossága (LLM-mel generálva, majd rögzítve; újragenerálás: npm run generate-villagers). */
export const VILLAGERS = villagers as VillagerSeed[];
