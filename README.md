# Falu

15 lakó egy pixeles kis faluban: dolgoznak, kereskednek, pletykálnak, barátkoznak, összevesznek. Te főleg nézed, néha beleszólsz. A legjobb rész az **„Amíg nem néztél oda”**: visszatéréskor a krónikás elmeséli, mi történt.

**Alapelv:** a világot determinisztikus kód viszi (idő, mozgás, útkeresés, éhség, pénz, készlet, árak). A lakók döntéseit, párbeszédeit, terveit és gondolatait a beépített, jellemhez illő generátor adja; API-kulcs és költség nincs.

**Kipróbálható online:** https://botondjani.github.io/ai-falu/

## Gyors indítás

```bash
npm install
npm run sim                     # élő szimuláció (WebSocket: ws://localhost:8787)
npm run viewer                  # másik terminálban → http://localhost:5173
```

```bash
npm run sim -- --days 5         # headless, kb. 1-2 mp, összegzéssel
npm test                        # egységtesztek (vitest)
npm run typecheck
```

### CLI

| Kapcsoló | Leírás |
|---|---|
| `--days N` | headless futás N napig, összegzéssel |
| `--speed MP` | valós másodperc / szimulált nap (alap 600 = 10 perc) |
| `--seed S` | seed (alap: `falu`) |
| `--llm-agents L` | tervező/döntő elmével bíró lakók: `all` (alap) vagy vesszős lista; a többi csak szabályok szerint él |
| `--demo` | csak 3 lakó |
| `--event "N:H:szöveg"` | Isten-mód esemény N. nap H órakor (forgatókönyvekhez, többször is megadható) |
| `--list-runs` | futások listája |
| `--resume [ID]` | futás folytatása az utolsó snapshotból |
| `--replay ID [--from-day D]` | visszajátszás a viewerben |
| `--verify ID` | újraszimulálás és eseményenkénti összevetés a naplóval |
| `--summary ID [--from-day D]` | „Amíg nem néztél oda” a terminálban |
| `--db FILE`, `--port P`, `-v` | SQLite fájl, WS port, minden esemény kiírása |

## A viewer

- **Térkép:** kódból generált pixel-art falu (házak, kocsma, bolt, pékség, kovácsműhely, tér, mező, erdő, folyó), mozgó lakók, beszédbuborékok (a párbeszédek soronként), napszak szerinti sötétedés. A lakóra kattintva megnyílik a profilja.
- **Kapcsolatok:** irányított gráf (A véleménye B-ről; zöld jó, piros rossz, vastagság = erősség). A kör mérete a hírnév, vagyis mások átlagos véleménye. Szimpátia és bizalom között lehet váltani, a küszöb állítható.
- **Lakó-profil:** jellem, titkos vágy, hangulat, hírnév, mai terv (az aktuális lépés kiemelve), emlékek típus szerint szűrve (megfigyelés, beszélgetés, pletyka, reflexió, terv), kapcsolatok mindkét irányból, róla szóló és általa ismert pletykák (hányan tudják).
- **Oldalsáv:** óra, szünet és sebesség, ⚡ Isten-mód, piac (árak, készletek), lakók (🧠 saját döntés, 📋 terv, ⚙ autopilot, ⚡ Isten-mód, ⚠ tartalék), eseményfolyam.
- **📜 Amíg nem néztél oda:** visszatéréskor automatikusan megjelenik, a „Mi történt?” gomb az elmúlt napot foglalja össze.

## Hogyan működik

### Világ és idő
- 48×32-es csempetérkép, 1 tick = 5 játékperc, 288 tick egy nap; a szimuláció reggel 6-kor indul. A* útkeresés csempeköltséggel (út olcsó, erdő drága, víz és fal járhatatlan).
- Éhség és energia; éjjel alvás, éhesen evés (otthon, boltban vásárolva vagy a kocsmában).

### Gazdaság
- **Termelési láncok:** mező → gabona; pék: gabona → kenyér; erdő → fa; kovács: fa → szerszám; folyó → hal; füvesasszony → gyógyfű. Szerszámmal többet lehet termelni, de a szerszám néha eltörik, ebből van kereslet rá.
- **Bolt = piac:** a termelők eladják a fölösleget, a lakók itt vásárolnak. Ár = alapár × √(célkészlet / készlet), 0.5× és 2.5× között; a bolt az ár 70%-áért vásárol fel.
- **Városi vásár:** reggelente a fölösleg a városba megy (külső piac, pénzforrás), így a bolt nem telik meg.
- **Kocsma:** étel a saját készletből. **Bér:** a bíró és a tanítónő a falutól, a zenész a kocsmárostól kap.

### Lakók és elme
- 15 lakó a `packages/core/src/seed/villagers.json` fájlban (név, kor, foglalkozás, jellem, titkos vágy, kapcsolatok).
- **Memória** (Generative Agents mintájára): megfigyelések szabály szerinti fontossággal. Visszakereséskor a pontszám = frissesség (óránként 0.98-as lecsengés) + fontosság/10 + 1.5 × relevancia (kulcsszó-egyezés). A régi, kis jelentőségű emlékek naponta törlődnek.
- **Napi terv** (6:00): 3–7 lépés. **Esti reflexió** (21:30): 1–3 magasabb szintű tanulság fontossággal („Béla nem megbízható.”) és hangulat.
- **Beszélgetés:** ráérő lakók egy helyen (a kocsmában és a téren gyakrabban), cooldownnal. Egy hívásban 4–6 replika, mindkét fél emléke, véleményváltozás (±15) és opcionálisan pletyka.
- **Pletyka** azonosítóval terjed. Aki hallja, emléket kap, és megváltozik a véleménye az alanyról; csak az adható tovább, amit a mondó ismer.
- Minden generált kimenet sémával (zod) és szemantikailag validált; hibánál biztonságos tartalék (autopilot vagy sablon).

### Isten-mód
- **Esemény:** a szöveg kulcsszavai alapján (vihar, idegen, ünnep, tűz, kincs) mechanikus hatások lesznek (hazamenekülés, gyűlés, készlet, pénz, hangulat, új lakó érkezése). Minden érintett fontos emléket kap.
- **Suttogás:** egy gondolat a lakó fejében, ami befolyásolja a következő döntését és a beszélgetéseit.

### „Amíg nem néztél oda”
- A szerver tárolja az utolsó megtekintést. A naplóból determinisztikusan pontozott **tények** készülnek (pletyka-terjedés, megromlott vagy javult kapcsolat, éhezés, árváltozás, kereset, reflexiók, Isten-mód), ezekből 5–10 mondatos, kicsit humoros elbeszélés készül, kiemelve a 3 legfontosabbat. Az összefoglalók gyorsítótárazva vannak.

### Napló, determinizmus, visszajátszás
- Minden esemény append-only **SQLite** naplóba kerül (`events`), napi snapshottal (`snapshots`). A külső bemenetek (döntés, terv, reflexió, beszélgetés, Isten-mód, suttogás) az `inputs` táblába kerülnek.
- A szimuláció seedelt és determinisztikus: a seedből és a rögzített bemenetekből bármely futás pontosan újrajátszható (`--verify` ezt ellenőrzi).

## Felépítés

| Csomag | Feladat |
|---|---|
| `packages/core` | Determinisztikus világ, I/O nélkül: térkép, idő, A*, RNG, készlet, gazdaság, autopilot, memória, kapcsolatok és pletyka, Isten-mód hatások, eseménytípusok. |
| `packages/sim` | Futtató: tick-loop, generátor-réteg (validálás, tartalék), elme (terv, döntés, beszélgetés, reflexió, Isten-mód), összefoglaló, SQLite napló, visszajátszás, WebSocket-szerver, CLI. |
| `packages/viewer` | Vite + React + PixiJS élő nézet, SVG kapcsolati gráf, profilpanel. |

## Egyszerűsítések

- A relevancia kulcsszó-egyezés, embedding nincs (olcsó és determinisztikus).
- A kereskedés a boltban kódból történik (a termelő „leszállítja” a fölösleget). A lakó a vásárlás idejét választja meg, az alkut nem.
- Évszakok még nincsenek, csak napszakok.
- Egyszerre egy viewer és egy futás feltételezett (az utolsó megtekintés futásonként egy érték).

## Állapot

- [x] 1. Tile-világ, időmotor, szabály-alapú lakók, élő viewer
- [x] 2. SQLite eseménynapló, visszajátszás
- [x] 3. Döntési réteg (terv/döntés generátor, validálás)
- [x] 4. Memória, reflexió, napi terv
- [x] 5. Beszélgetések, kapcsolatok, pletyka
- [x] 6. Gazdaság
- [x] 7. „Amíg nem néztél oda”
- [x] 8. Isten-mód
- [x] 9. Kapcsolati gráf, lakóprofil
