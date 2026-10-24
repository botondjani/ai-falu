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

## Felépítés

| Csomag | Feladat |
|---|---|
| `packages/core` | Determinisztikus világ: térkép, idő (1 tick = 5 perc, 288 tick/nap), A* útkeresés, készlet, seedelt RNG, autopilot, eseménytípusok. I/O nélkül. |
| `packages/sim` | Futtató: tick-loop, SQLite eseménynapló + snapshotok, visszajátszás, WebSocket-szerver, CLI. |
| `packages/viewer` | Vite + React + PixiJS élő nézet, kódból generált pixel-art csempékkel. |

## Állapot

- [x] 1. Tile-világ, időmotor, 3 szabály-alapú lakó, élő viewer
- [x] 2. SQLite eseménynapló, visszajátszás
- [ ] 3. LLM-döntés, mock mód, költségszámláló
- [ ] 4. Memória, reflexió, napi terv
- [ ] 5. Beszélgetések, kapcsolatok, pletyka
- [ ] 6. Gazdaság
- [ ] 7. „Amíg nem néztél oda”
- [ ] 8. Isten-mód
- [ ] 9. Kapcsolati gráf, lakóprofil
