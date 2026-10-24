# Falu

LLM-vezérelt lakók egy pixeles kis faluban. A világot determinisztikus kód viszi (idő, mozgás, készlet, pénz, éhség), az LLM csak dönt.

> Fejlesztés alatt, a lépések állapota lent.

## Futtatás

```bash
npm install
npm run sim                        # élő szimuláció, WS: ws://localhost:8787
npm run viewer                     # másik terminálban: http://localhost:5173
npm run sim -- --days 5 --mock     # headless, gyors futás, összegzéssel
npm test                           # egységtesztek
npm run typecheck
```

**API-kulcs nélkül is működik:** ha nincs `ANTHROPIC_API_KEY`, a szimuláció automatikusan mock módban fut (autopilot + mock LLM), költség nélkül.

### Napló és visszajátszás

Minden esemény egy append-only SQLite naplóba kerül (`data/falu.db`), naponta snapshottal. A futás seedelt és determinisztikus, ezért bármikor pontosan újrajátszható.

```bash
npm run sim -- --list-runs                 # futások
npm run sim -- --replay 1 --from-day 3     # visszajátszás a viewerben a 3. naptól
npm run sim -- --verify 1                  # újraszimulál és eseményről eseményre összeveti a naplóval
npm run sim -- --resume                    # a legutóbbi futás folytatása az utolsó snapshotból
npm run sim -- --help                      # minden kapcsoló
```

## LLM-döntések és költség

A lakók rutinját (alvás, evés, munkába járás) a szabály-alapú **autopilot** viszi. LLM-hívás csak **döntési ponton** történik: amikor a lakó szabad, nincs sürgős szükséglete, és lejárt az előző döntése. Az LLM egy zárt menüből választ (tevékenység + helyszín + időtartam + egy mondat, amit kimond). A kimenet JSON-sémás (`output_config.format`), és zoddal validálódik. Hibánál egy újrapróba jön, utána biztonságos autopilot-tartalék.

- Modellek: `claude-haiku-5-5` a rutindöntésekhez (`effort: low`), `claude-sonnet-5-5` a későbbi reflexióhoz és összefoglalóhoz.
- Prompt caching: világszabályok + személyleírás = stabil prefix, `cache_control` breakpointtal; a helyzet utána jön.
- **Költségkeret:** összes költés, napi valós költés és hívás/szimulált nap. A keret elérésekor a szimuláció szünetel (`LLM_ON_BUDGET=autopilot` esetén LLM nélkül fut tovább).
- **Mock mód:** API-kulcs nélkül automatikusan ez megy. A lakók determinisztikus, jellemhez illő döntéseket hoznak, a költségszámláló pedig megmutatja, mennyibe került volna valódi API-val.
- Minden hívás az `llm_calls` táblába kerül (tokenek, költség, késleltetés, hiba). A döntések az `inputs` táblába, ezért visszajátszáskor nincs API-hívás.

Melyik lakó dönt LLM-mel: `--llm-agents joska` (alap), `--llm-agents bela,mari` vagy `--llm-agents all`.

Konfiguráció (`.env`, lásd `.env.example`): `ANTHROPIC_API_KEY`, `LLM_MODEL_ROUTINE`, `LLM_MODEL_STRONG`, `LLM_MAX_USD_TOTAL` (5), `LLM_MAX_USD_PER_DAY` (2), `LLM_MAX_CALLS_PER_SIM_DAY` (600), `LLM_ON_BUDGET` (`pause`|`autopilot`).

## Felépítés

| Csomag | Feladat |
|---|---|
| `packages/core` | Determinisztikus világ: térkép, idő (1 tick = 5 perc, 288 tick/nap), A* útkeresés, készlet, seedelt RNG, autopilot, eseménytípusok. I/O nélkül. |
| `packages/sim` | Futtató: tick-loop, SQLite eseménynapló + snapshotok, visszajátszás, WebSocket-szerver, CLI. |
| `packages/viewer` | Vite + React + PixiJS élő nézet, kódból generált pixel-art csempékkel. |

## Állapot

- [x] 1. Tile-világ, időmotor, 3 szabály-alapú lakó, élő viewer
- [x] 2. SQLite eseménynapló, visszajátszás
- [x] 3. LLM-döntés, mock mód, költségszámláló
- [ ] 4. Memória, reflexió, napi terv
- [ ] 5. Beszélgetések, kapcsolatok, pletyka
- [ ] 6. Gazdaság
- [ ] 7. „Amíg nem néztél oda”
- [ ] 8. Isten-mód
- [ ] 9. Kapcsolati gráf, lakóprofil
