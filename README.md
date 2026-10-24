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

### Lakosság

A falu 15 lakója a `packages/core/src/seed/villagers.json` fájlban van: név, kor, foglalkozás, jellem, titkos vágy, kapcsolatok, otthon és munkahely. A fájl LLM-mel készült, és rögzítve van, ezért minden futás ugyanabból indul. Újragenerálás (API-kulccsal, egy Sonnet-hívás, kb. $0.05):

```bash
npm run generate-villagers -- --count 15 --theme "egy kicsit misztikus falu"
```

`--demo` kapcsolóval csak a 3 demó lakó fut.

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

### Memória, terv, reflexió

- **Memória** (Generative Agents mintájára): a lakók megfigyelései a fontos eseményekből jönnek (kód, fontosság szabály szerint). Visszakereséskor a pontszám = frissesség (óránként 0.98-as lecsengés) + fontosság/10 + 1.5 × relevancia. A relevanciát kulcsszó-egyezéssel számoljuk (embedding nincs, olcsó és determinisztikus). A régi, kis jelentőségű megfigyelések naponta törlődnek.
- **Napi terv** (reggel 6:00, Haiku): 3–7 időrendi lépés. Amíg a terv lefedi az időt és nem történik semmi váratlan, a lakó **LLM nélkül** követi.
- **Váratlan helyzet**: egy fontos (≥5) új emlék után a következő döntést újra az LLM hozza.
- **Esti reflexió** (21:30, Sonnet): 1–3 magasabb szintű tanulság fontossággal („Béla nem megbízható”) és hangulat.

### Beszélgetés, kapcsolatok, pletyka

- Ha két ráérő lakó (pihen, szórakozik, sétál) ugyanott van, kis eséllyel beszélgetni kezdenek: a kocsmában és a téren gyakrabban, mint máshol. Párokra 3 órás, lakóra 1 órás cooldown van. A jelölteket determinisztikusan választjuk (seed + tick).
- Egy beszélgetés **egy** Haiku-hívás: 4–6 replika felváltva, mindkét fél emléke, véleményváltozás (bizalom, szimpátia; legfeljebb ±15) és opcionálisan pletyka egy harmadik lakóról.
- **Kapcsolatok:** irányított vélemények (A → B) -100..100 között, kezdetben a seed-kapcsolatokból.
- **Pletyka:** azonosítóval terjed. Aki hallja, emléket kap (fontosság 5, ezért a következő döntését az LLM hozza), és romlik vagy javul a véleménye az alanyról. Csak az a pletyka adható tovább, amit a mondó tényleg ismer.

### Gazdaság

- **Termelési láncok** (óránként): mező → gabona; pék: 1 gabona → 2 kenyér; erdő → fa; kovács: 1 fa → 1 szerszám; folyó → hal; füvesasszony → gyógyfű. Szerszámmal a földműves, a favágó és a halász többet termel, de a szerszám néha eltörik. Ebből jön a szerszám iránti kereslet.
- **Bolt = piac:** a termelők eladják a fölösleget a boltnak, a lakók ott vesznek kenyeret, a pék és a kovács ott veszi az alapanyagot. Az ár a készlettől függ: alapár × √(célkészlet / készlet), 0.5× és 2.5× között. A bolt az ár 70%-áért vásárol fel, a különbözet a boltos haszna.
- **Városi vásár:** reggelente a célszint másfélszerese fölötti készletet a boltos elviszi a városba (alapár 50%-áért). Ez a falu külső piaca és pénzforrása; enélkül a bolt megtelik, és a termelők pénz nélkül maradnak.
- **Kocsma:** az étel a kocsma készletéből megy (kenyér vagy hal, a kenyér ára + 3 tallér), a kocsmáros a boltból tölti fel.
- **Bér:** a bíró és a nyugdíjas tanítónő órabért kap a falutól, a zenészt a kocsmáros fizeti.
- Éhes lakó: otthoni étel, ha nincs, akkor vásárlás a boltban, ha az sincs, akkor a kocsma. Az LLM is választhatja a `vásárol` tevékenységet; a promptban benne vannak az aktuális árak.

### „Amíg nem néztél oda”

- A szerver tárolja, mikor nézted utoljára a falut (a viewer bezárása vagy háttérbe kerülése számít). Visszatéréskor, ha legalább egy játékóra eltelt, automatikusan megjelenik az összefoglaló. A **📜 Mi történt?** gomb az elmúlt napot foglalja össze.
- Menete: a naplóból determinisztikusan **pontozott tények** lesznek (pletyka terjedése, megromlott vagy javult kapcsolat, éhezés, árváltozás, nagy kereset, reflexiók, Isten-mód események), a legfontosabb 25-ből pedig **egy Sonnet-hívás** ír 5–10 mondatos, színes, kicsit humoros elbeszélést, és kiválasztja a 3 legfontosabb eseményt (sorszámmal, hogy ne találjon ki semmit).
- Mock módban és hiba esetén sablonos elbeszélés készül ugyanazokból a tényekből. Az összefoglalók gyorsítótárazva vannak.
- Terminálból: `npm run sim -- --summary 1 --from-day 2`

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
- [x] 4. Memória, reflexió, napi terv
- [x] 5. Beszélgetések, kapcsolatok, pletyka
- [x] 6. Gazdaság
- [x] 7. „Amíg nem néztél oda”
- [ ] 8. Isten-mód
- [ ] 9. Kapcsolati gráf, lakóprofil
