import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { describeEvent, formatTime, lookupFrom, tickToTime, type DecisionSource } from "@falu/core";
import { VillageRenderer } from "./renderer";
import { useSim, type TickFrame } from "./useSim";
import { RelationGraph } from "./Graph";
import { ProfileDrawer } from "./Profile";
import type { AgentView, ClientMessage, MarketView, Summary } from "@falu/sim";

/** Ezek túl gyakoriak a feedhez. */
const QUIET = new Set(["earned", "produced", "sold", "arrived"]);

const SPEEDS = [
  { label: "lassú (20 perc/nap)", value: 1200 },
  { label: "normál (10 perc/nap)", value: 600 },
  { label: "gyors (2 perc/nap)", value: 120 },
  { label: "turbó (20 mp/nap)", value: 20 },
];

export function App() {
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<VillageRenderer | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const onFrame = useCallback((f: TickFrame) => {
    rendererRef.current?.frame(f.tick, f.tickMs, f.agents, f.moves, f.events);
  }, []);
  const { state, send, requestSummary, closeSummary, requestProfile } = useSim(onFrame);
  const [view, setView] = useState<"map" | "graph">("map");

  // A kiválasztott lakó profilját frissen tartjuk, amíg nyitva van.
  useEffect(() => {
    if (!selected) return;
    requestProfile(selected);
    const t = setInterval(() => requestProfile(selected), 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, state.connected]);

  useEffect(() => {
    const r = new VillageRenderer(hostRef.current!);
    r.onAgentClick = setSelected;
    rendererRef.current = r;
    return () => r.destroy();
  }, []);

  useEffect(() => {
    if (state.map) rendererRef.current?.setMap(state.map).then(() => {
      rendererRef.current?.frame(state.tick, 0, state.agents, {});
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.map]);

  const names = useMemo(() => lookupFrom(state.agents, state.map?.locations ?? []), [state.agents, state.map]);
  const time = tickToTime(state.tick);
  const selectedAgent = state.agents.find((a) => a.id === selected);
  const feed = useMemo(
    () => state.events.filter((e) => !QUIET.has(e.type)).slice(-80).reverse(),
    [state.events],
  );

  return (
    <div className="layout">
      <div className="main">
        <div className="view-tabs">
          <button className={view === "map" ? "on" : ""} onClick={() => setView("map")}>
            🗺 Térkép
          </button>
          <button className={view === "graph" ? "on" : ""} onClick={() => setView("graph")}>
            🕸 Kapcsolatok
          </button>
        </div>
        <div className="map" ref={hostRef} style={{ visibility: view === "map" ? "visible" : "hidden" }} />
        {view === "graph" && <RelationGraph agents={state.agents} selected={selected} onSelect={setSelected} />}
        {selectedAgent && (
          <ProfileDrawer agent={selectedAgent} profile={state.profile} names={names} hour={time.hour} onClose={() => setSelected(null)} />
        )}
      </div>
      {state.summary && <SummaryModal summary={state.summary} onClose={closeSummary} />}
      <aside className="panel">
        <header>
          <h1>Falu</h1>
          <div className="clock">
            {formatTime(time)} · {time.phase}
          </div>
          <div className={`conn ${state.connected ? "ok" : "bad"}`}>
            {state.connected ? `${state.status?.mode ?? "élő"} · #${state.status?.runId ?? "?"}` : "nincs kapcsolat…"}
          </div>
        </header>

        <section className="controls">
          {state.status?.running ? (
            <button onClick={() => send({ type: "pause" })}>⏸ Szünet</button>
          ) : (
            <button onClick={() => send({ type: "resume" })}>▶ Folytatás</button>
          )}
          <select value={state.status?.speed ?? 600} onChange={(e) => send({ type: "speed", secondsPerDay: Number(e.target.value) })}>
            {state.status && !SPEEDS.some((s) => s.value === state.status!.speed) && (
              <option value={state.status.speed}>egyedi ({state.status.speed} mp/nap)</option>
            )}
            {SPEEDS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <button onClick={() => requestSummary("last_day")} title="Az elmúlt nap összefoglalója">
            📜 Mi történt?
          </button>
          {state.status?.pausedReason && <div className="paused">Szünetel: {state.status.pausedReason}</div>}
        </section>

        {state.status?.godMode && <GodPanel agents={state.agents} send={send} />}
        <MarketPanel market={state.market} />

        <section className="agents">
          <h2>Lakók ({state.agents.length})</h2>
          {state.agents.map((a) => (
            <div
              key={a.id}
              className={`agent ${selected === a.id ? "sel" : ""}`}
              onClick={() => setSelected(selected === a.id ? null : a.id)}
            >
              <div className="agent-head">
                <span className="dot" style={{ background: a.color }} />
                <b>{a.name}</b> <span className="muted">{a.occupation}</span>
                <span className="money">{a.money} tallér</span>
              </div>
              <div className="muted small">
                {a.activity ? (
                  <>
                    <span title={SOURCE_TITLE[a.activity.source]}>{SOURCE_ICON[a.activity.source]}</span> {a.activity.kind} ·{" "}
                    {names.place(a.activity.locationId)}
                  </>
                ) : (
                  "—"
                )}
              </div>
              {a.activity?.say && <div className="say small">„{a.activity.say}”</div>}
            </div>
          ))}
        </section>

        <section className="feed">
          <h2>Események</h2>
          {feed.map((e, i) => (
            <div key={`${e.tick}-${i}`} className={`ev ev-${e.type}`}>
              <span className="muted">{String(tickToTime(e.tick).hour).padStart(2, "0")}:{String(tickToTime(e.tick).minute).padStart(2, "0")}</span>{" "}
              {describeEvent(e, names)}
              {e.type === "conversation" && (
                <div className="dialog">
                  {e.lines.map((l, j) => (
                    <div key={j}>
                      <b>{names.agent(l.speaker).split(" ").at(-1)}:</b> {l.text}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </section>
      </aside>
    </div>
  );
}

const SOURCE_ICON: Record<DecisionSource, string> = { llm: "🧠", auto: "⚙", fallback: "⚠", terv: "📋", isten: "⚡" };
const SOURCE_TITLE: Record<DecisionSource, string> = {
  llm: "saját döntés",
  auto: "autopilot (szabály)",
  fallback: "LLM-hiba, autopilot-tartalék",
  terv: "a napi terv szerint",
  isten: "Isten-mód esemény miatt",
};

const GOD_EXAMPLES = ["Hatalmas vihar jön", "Egy idegen érkezik a faluba", "Bál lesz a téren", "Tűz üt ki a boltban", "Valaki kincset talál a folyóparton"];

function GodPanel({ agents, send }: { agents: AgentView[]; send: (m: ClientMessage) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [target, setTarget] = useState("");
  const [thought, setThought] = useState("");
  const [sent, setSent] = useState("");
  const flash = (m: string) => {
    setSent(m);
    setTimeout(() => setSent(""), 3000);
  };
  return (
    <section className="god">
      <h2 onClick={() => setOpen(!open)} style={{ cursor: "pointer" }}>
        ⚡ Isten-mód {open ? "▾" : "▸"}
      </h2>
      {open && (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!text.trim()) return;
              send({ type: "god", text: text.trim() });
              flash("Az esemény a következő pillanatban megtörténik…");
              setText("");
            }}
          >
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Mi történjen? pl. vihar jön" maxLength={300} />
            <button type="submit">Bedob</button>
          </form>
          <div className="examples">
            {GOD_EXAMPLES.map((x) => (
              <span key={x} onClick={() => setText(x)}>
                {x}
              </span>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!target || !thought.trim()) return;
              send({ type: "whisper", agentId: target, text: thought.trim() });
              flash("Elsuttogtad.");
              setThought("");
            }}
          >
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">Kinek suttogsz?</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <input value={thought} onChange={(e) => setThought(e.target.value)} placeholder="egy gondolat…" maxLength={300} />
            <button type="submit">Suttog</button>
          </form>
          {sent && <div className="small say">{sent}</div>}
        </>
      )}
    </section>
  );
}

function SummaryModal({ summary, onClose }: { summary: Summary | "loading"; onClose: () => void }) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={onClose}>
          ✕
        </button>
        <h2 className="modal-title">📜 Amíg nem néztél oda…</h2>
        {summary === "loading" ? (
          <p className="muted">A krónikás épp összeszedi a pletykákat…</p>
        ) : (
          <>
            <div className="muted small">
              {formatTime(tickToTime(summary.fromTick))} – {formatTime(tickToTime(summary.toTick))}
            </div>
            <p className="story">{summary.story}</p>
            {summary.highlights.length > 0 && (
              <div className="highlights">
                {summary.highlights.map((h, i) => (
                  <div key={i} className="hl">
                    <div className="hl-n">{i + 1}</div>
                    <div>
                      <b>{h.title}</b>
                      <div className="small muted">{formatTime(tickToTime(h.tick))}</div>
                      <div className="small">{h.text}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function MarketPanel({ market }: { market: MarketView | null }) {
  const [open, setOpen] = useState(false);
  if (!market) return null;
  return (
    <section className="market">
      <h2 onClick={() => setOpen(!open)} style={{ cursor: "pointer" }}>
        Piac {open ? "▾" : "▸"}
      </h2>
      <div className="small">
        {Object.entries(market.prices).map(([k, v]) => (
          <span key={k} className="price">
            {k} <b>{v}</b>
          </span>
        ))}
        <span className="price">
          kocsmai étel <b>{market.mealPrice}</b>
        </span>
      </div>
      {open && (
        <div className="small muted">
          <div>Bolt: {Object.entries(market.shop).map(([k, v]) => `${k} ×${v}`).join(", ") || "üres"}</div>
          <div>Kocsma: {Object.entries(market.tavern).map(([k, v]) => `${k} ×${v}`).join(", ") || "üres"}</div>
        </div>
      )}
    </section>
  );
}

function Bar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bar" title={`${label}: ${value}`}>
      <span className="bar-label">{label}</span>
      <span className="bar-track">
        <span className="bar-fill" style={{ width: `${value}%`, background: color }} />
      </span>
    </div>
  );
}
