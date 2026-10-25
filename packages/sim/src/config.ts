import { existsSync } from "node:fs";

/** .env betöltése, ha van (Node beépített betöltője). */
export function loadDotEnv() {
  for (const p of [".env", "../../.env"]) {
    if (existsSync(p)) {
      process.loadEnvFile(p);
      return;
    }
  }
}
