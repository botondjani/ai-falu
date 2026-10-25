# Falu

15 LLM-vezérelt lakó egy pixeles kis faluban: dolgoznak, kereskednek, pletykálnak, barátkoznak, összevesznek. Te főleg nézed, néha beleszólsz. A legjobb rész az **„Amíg nem néztél oda”**: visszatéréskor a krónikás elmeséli, mi történt.

**Alapelv:** a világot determinisztikus kód viszi (idő, mozgás, útkeresés, éhség, pénz, készlet, árak), az LLM csak dönt (mit csináljon a lakó, mit mondjon, mit gondoljon).

## Gyors indítás

```bash
npm install
npm run sim                     # élő szimuláció (WebSocket: ws://localhost:8787)
npm run viewer                  # másik terminálban → http://localhost:5173
```

**LLM: Google Gemini** (alap). A könnyű feladatokat (terv, döntés, beszélgetés) a `gemini-3.5-flash-lite`, a nehezebbeket (reflexió, összefoglaló, Isten-mód) a `gemini-3.8-flash` végzi. `LLM_PROVIDER=anthropic` mellett Claude-dal is fut.

**API-kulcs nélkül is működik:** ha nincs `GEMINI_API_KEY`, automatikusan **mock módban** fut. A lakók determinisztikus, jellemhez illő döntéseket hoznak, sablonos párbeszédeket folytatnak, a költségszámláló pedig mutatja, mennyibe került volna valódi API-val. Valódi LLM-hez másold a `.env.example`-t `.env`-be, és írd be a kulcsot (Google AI Studio → API keys). A `.env` nem kerül a gitbe, **a kulcsot soha ne írd a kódba**.

```bash
npm run sim -- --days 5 --mock  # headless, kb. 1-2 mp, összegzéssel
npm test                        # egységtesztek (vitest)
npm run typecheck
```

### CLI

| Kapcsoló | Leírás |
|---|---|
| `--days N` | headless futás N napig, összegzéssel |
| `--mock` | LLM nélkül (kulcs nélkül ez az alap) |
| `--speed MP` | valós másodperc / szimulált nap (alap 600 = 10 perc) |
| `--seed S` | seed (alap: `falu`) |
| `--llm-agents L` | LLM-mel gondolkodó lakók: `all` (alap) vagy vesszős lista; a többi autopiloton fut |
| `--demo` | csak 3 lakó |
| `--event "N:H:szöveg"` | Isten-mód esemény N. nap H órakor (forgatókönyvekhez, többször is megadható) |
| `--list-runs` | futások listája |
| `--resume [ID]` | futás folytatása az utolsó snapshotból |
| `--replay ID [--from-day D]` | visszajátszás a viewerben (API-hívás nélkül) |
| `--verify ID` | újraszimulálás és eseményenkénti összevetés a naplóval |
| `--summary ID [--from-day D]` | „Amíg nem néztél oda” a terminálban |
| `--db FILE`, `--port P`, `-v` | SQLite fájl, WS port, minden esemény kiírása |

## Élesítés HTTPS-címen (Render)

A szimuláció egy Node-folyamat, ami ugyanazon a porton szolgálja ki a weboldalt és a WebSocketet, így egy HTTPS-cím mögött is működik (`wss://`).

1. [render.com](https://render.com) → **New → Blueprint** → válaszd ki ezt a GitHub-repót. A `render.yaml` mindent beállít.
2. Telepítéskor a Render bekéri a titkokat:
   - `GEMINI_API_KEY`: a Gemini-kulcsod (a Google AI Studióban, az API keys menüben kapod),
   - `SIM_PASSWORD`: jelszó a faluhoz, hogy más ne használja a keretedet.
3. Kész: `https://ai-falu.onrender.com/?pw=JELSZÓ` (az első megnyitás után a böngésző megjegyzi a jelszót).

Tudnivalók:
- A `starter` csomag kb. $7/hó. Az ingyenes csomag 15 perc tétlenség után elalszik (ilyenkor a falu sem él), és nincs tartós lemeze.
- Újraindítás után a falu a legutóbbi napi snapshotból folytatódik (`SIM_AUTO_RESUME=1`, adatbázis a `/data` lemezen).
- **Költség:** a beállított sebességgel (1 nap = 1 óra) ez kb. $3–4 lenne naponta, de a `LLM_MAX_USD_PER_DAY=1` keret után a falu aznap LLM nélkül, autopiloton él tovább. A sebességet és a keretet a Render Environment fülén állíthatod.
- Docker máshol is fut: `docker build -t falu . && docker run -p 8787:8787 -e GEMINI_API_KEY=... -e SIM_PASSWORD=... falu`

## Költségbecslés

15 lakó egy szimulált napja nagyjából **90 LLM-hívás** (alapértelmezett Gemini-modellekkel):

| Hívás | Modell | Db / nap | Kb. token (be / ki) | Kb. $ / nap |
|---|---|---|---|---|
| Napi terv, döntés, beszélgetés | gemini-3.5-flash-lite ($0.30 / $2.50) | ~75 | 1.5k / 0.4k | 0.11 |
| Esti reflexió | gemini-3.8-flash ($0.75 / $3.75*) | 15 | 1.5k / 0.6k | 0.05 |
| **Összesen** | | **~90** | | **≈ $0.15 / szimulált nap** |

\* 2026. december 31-ig akciós ár; 2027-től $1.50 / $7.50, ekkor kb. $0.20 / nap.

- 10 perces napokkal ez óránként kb. **$1** folyamatos futásnál. Egy „Amíg nem néztél oda” összefoglaló kb. $0.01.
- Olcsóbb változat: `LLM_MODEL_ROUTINE=gemini-2.5-flash-lite` ($0.10 / $0.40), ekkor kb. $0.06 / nap.
- A becslés a mock mód tokenmérésén alapul. A pontos költést a viewer költségpanelje és az `llm_calls` tábla mutatja.
- **Költségkeret:** összes költés futásonként, napi valós költés és hívás/szimulált nap. A keret elérésekor a szimuláció szünetel; `LLM_ON_BUDGET=autopilot` mellett LLM nélkül fut tovább.

Mitől olcsó:
- A rutint (alvás, evés, munkába járás, vásárlás éhség esetén) szabály-alapú autopilot viszi, LLM nélkül.
- A napi tervet a lakó LLM nélkül követi. Csak terv nélküli időben vagy váratlan esemény után (fontos új emlék: pletyka, Isten-mód, suttogás) kérdezi az LLM-et.
- A beszélgetés egyetlen hívás (az egész párbeszéd + emlékek + véleményváltozás + pletyka).
- **Prompt caching:** a világszabályok és a személyleírás stabil prefix, a változó helyzet utána jön. A Gemini ezt automatikusan cache-eli; Claude-nál `cache_control` breakpoint jelöli.

## Konfiguráció (`.env`)

| Változó | Alap | Leírás |
|---|---|---|
| `LLM_PROVIDER` | `gemini` | `gemini` vagy `anthropic` |
| `GEMINI_API_KEY` / `ANTHROPIC_API_KEY` | – | nélküle mock mód |
| `LLM_MODEL_ROUTINE` | `gemini-3.5-flash-lite` | terv, döntés, beszélgetés |
| `LLM_MODEL_STRONG` | `gemini-3.8-flash` | reflexió, összefoglaló, Isten-mód |
| `LLM_MAX_USD_TOTAL` | 5 | futásonkénti keret ($) |
| `LLM_MAX_USD_PER_DAY` | 2 | valós napi keret ($), minden futásra együtt |
| `LLM_MAX_CALLS_PER_SIM_DAY` | 600 | hívás / szimulált nap |
| `LLM_ON_BUDGET` | `pause` | `pause` vagy `autopilot` |
| `SIM_LLM_AGENTS` | `all` | ki gondolkodik LLM-mel |
| `SIM_SECONDS_PER_DAY` | 600 | sebesség |
| `SIM_SEED`, `SIM_PORT`, `SIM_DB` | `falu`, 8787, `data/falu.db` | |
| `VITE_SIM_WS` | `ws://<host>:8787` | viewer → szimuláció |

## A viewer

- **Térkép:** kódból generált pixel-art falu (házak, kocsma, bolt, pékség, kovácsműhely, tér, mező, erdő, folyó), mozgó lakók, beszédbuborékok (a párbeszédek soronként), napszak szerinti sötétedés. A lakóra kattintva megnyílik a profilja.
- **Kapcsolatok:** irányított gráf (A véleménye B-ről; zöld jó, piros rossz, vastagság = erősség). A kör mérete a hírnév, vagyis mások átlagos véleménye. Szimpátia és bizalom között lehet váltani, a küszöb állítható.
- **Lakó-profil:** jellem, titkos vágy, hangulat, hírnév, mai terv (az aktuális lépés kiemelve), emlékek típus szerint szűrve (megfigyelés, beszélgetés, pletyka, reflexió, terv), kapcsolatok mindkét irányból, róla szóló és általa ismert pletykák (hányan tudják).
- **Oldalsáv:** óra, szünet és sebesség, ⚡ Isten-mód, LLM-költség, piac (árak, készletek), lakók (🧠 LLM, 📋 terv, ⚙ autopilot, ⚡ Isten-mód, ⚠ tartalék), eseményfolyam.
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
- 15 lakó a `packages/core/src/seed/villagers.json` fájlban (név, kor, foglalkozás, jellem, titkos vágy, kapcsolatok). A fájl LLM-mel készült és rögzítve van; újragenerálás: `npm run generate-villagers -- --count 15 --theme "..."`.
- **Memória** (Generative Agents mintájára): megfigyelések szabály szerinti fontossággal. Visszakereséskor a pontszám = frissesség (óránként 0.98-as lecsengés) + fontosság/10 + 1.5 × relevancia (kulcsszó-egyezés). A régi, kis jelentőségű emlékek naponta törlődnek.
- **Napi terv** (6:00): 3–7 lépés. **Esti reflexió** (21:30): 1–3 magasabb szintű tanulság fontossággal („Béla nem megbízható.”) és hangulat.
- **Beszélgetés:** ráérő lakók egy helyen (a kocsmában és a téren gyakrabban), cooldownnal. Egy hívásban 4–6 replika, mindkét fél emléke, véleményváltozás (±15) és opcionálisan pletyka.
- **Pletyka** azonosítóval terjed. Aki hallja, emléket kap, és megváltozik a véleménye az alanyról; csak az adható tovább, amit a mondó ismer.
- Minden LLM-kimenet JSON-sémás (Gemininél `responseJsonSchema`, Claude-nál `output_config.format`; zod), szemantikailag validált. Hibánál egy újrapróba jön (a hibaüzenettel), utána biztonságos tartalék (autopilot vagy sablon).

### Isten-mód
- **Esemény:** egy hívás az okosabb modellel a szöveget mechanikus hatásokra fordítja (hazamenekülés, gyűlés, készlet, pénz, hangulat, új lakó érkezése). Minden érintett fontos emléket kap. Kulcs nélkül kulcsszavas értelmezés fut.
- **Suttogás:** egy gondolat a lakó fejében, ami befolyásolja a következő döntését és a beszélgetéseit.

### „Amíg nem néztél oda”
- A szerver tárolja az utolsó megtekintést. A naplóból determinisztikusan pontozott **tények** készülnek (pletyka-terjedés, megromlott vagy javult kapcsolat, éhezés, árváltozás, kereset, reflexiók, Isten-mód), ezekből egy hívás az okosabb modellel 5–10 mondatos, színes, kicsit humoros elbeszélést ír, és sorszámmal kiemeli a 3 legfontosabbat. Az összefoglalók gyorsítótárazva vannak.

### Napló, determinizmus, visszajátszás
- Minden esemény append-only **SQLite** naplóba kerül (`events`), napi snapshottal (`snapshots`). A külső bemenetek (LLM-döntés, terv, reflexió, beszélgetés, Isten-mód, suttogás) az `inputs` táblába, a hívások részletei az `llm_calls` táblába mennek.
- A szimuláció seedelt és determinisztikus: a seedből és a rögzített bemenetekből bármely futás pontosan újrajátszható, API-hívás nélkül (`--verify` ezt ellenőrzi).

## Felépítés

| Csomag | Feladat |
|---|---|
| `packages/core` | Determinisztikus világ, I/O nélkül: térkép, idő, A*, RNG, készlet, gazdaság, autopilot, memória, kapcsolatok és pletyka, Isten-mód hatások, eseménytípusok. |
| `packages/sim` | Futtató: tick-loop, LLM-gateway (Anthropic és mock, keret, validálás), elme (terv, döntés, beszélgetés, reflexió, Isten-mód), összefoglaló, SQLite napló, visszajátszás, WebSocket-szerver, CLI. |
| `packages/viewer` | Vite + React + PixiJS élő nézet, SVG kapcsolati gráf, profilpanel. |

## Egyszerűsítések

- A relevancia kulcsszó-egyezés, embedding nincs (olcsó és determinisztikus).
- A kereskedés a boltban kódból történik (a termelő „leszállítja” a fölösleget). Az LLM a vásárlás idejét választja meg, az alkut nem.
- Évszakok még nincsenek, csak napszakok.
- Egyszerre egy viewer és egy futás feltételezett (az utolsó megtekintés futásonként egy érték).

## Állapot

- [x] 1. Tile-világ, időmotor, szabály-alapú lakók, élő viewer
- [x] 2. SQLite eseménynapló, visszajátszás
- [x] 3. LLM-döntés, mock mód, költségszámláló
- [x] 4. Memória, reflexió, napi terv
- [x] 5. Beszélgetések, kapcsolatok, pletyka
- [x] 6. Gazdaság
- [x] 7. „Amíg nem néztél oda”
- [x] 8. Isten-mód
- [x] 9. Kapcsolati gráf, lakóprofil
