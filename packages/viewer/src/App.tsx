import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { describeEvent, formatTime, lookupFrom, tickToTime, type DecisionSource } from "@falu/core";
import { VillageRenderer } from "./renderer";
import { useSim, type TickFrame } from "./useSim";
import type { LlmStats } from "@falu/sim";

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
  const { state, send } = useSim(onFrame);

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
  const feed = useMemo(
    () => state.events.filter((e) => e.type !== "earned" && e.type !== "produced").slice(-80).reverse(),
    [state.events],
  );

  return (
    <div className="layout">
      <div className="map" ref={hostRef} />
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
          {state.status?.pausedReason && <div className="paused">Szünetel: {state.status.pausedReason}</div>}
        </section>

        <CostPanel llm={state.llm} />

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
              {selected === a.id && (a.mood || a.planGoal) && (
                <div className="small muted">
                  {a.mood && <>hangulat: {a.mood}</>}
                  {a.mood && a.planGoal && " · "}
                  {a.planGoal && <>cél: {a.planGoal}</>}
                </div>
              )}
              {selected === a.id && (
                <>
                  <Bar label="éhség" value={a.needs.hunger} color="#e67e22" />
                  <Bar label="energia" value={a.needs.energy} color="#3498db" />
                </>
              )}
              {selected === a.id && (
                <div className="small detail">
                  <div>Miért: {a.activity?.reason ?? "—"}</div>
                  <div>Készlet: {Object.entries(a.inventory).map(([k, v]) => `${k} ×${v}`).join(", ") || "üres"}</div>
                  <div>Ismert pletykák: {a.knownGossip}</div>
                  {a.relations.length > 0 && (
                    <div className="rels">
                      {[...a.relations]
                        .sort((x, y) => Math.abs(y.liking) + Math.abs(y.trust) - Math.abs(x.liking) - Math.abs(x.trust))
                        .slice(0, 6)
                        .map((r) => (
                          <div key={r.with}>
                            {names.agent(r.with)}: <span className={r.liking >= 0 ? "pos" : "neg"}>szimpátia {r.liking}</span>,{" "}
                            <span className={r.trust >= 0 ? "pos" : "neg"}>bizalom {r.trust}</span>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              )}
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

const SOURCE_ICON: Record<DecisionSource, string> = { llm: "🧠", auto: "⚙", fallback: "⚠", terv: "📋" };
const SOURCE_TITLE: Record<DecisionSource, string> = {
  llm: "LLM döntött",
  auto: "autopilot (szabály)",
  fallback: "LLM-hiba, autopilot-tartalék",
  terv: "a napi terv szerint",
};

function CostPanel({ llm }: { llm: LlmStats | null }) {
  if (!llm) return null;
  const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
  return (
    <section className="cost">
      <h2>LLM költség {llm.mock && <span className="badge">mock</span>}</h2>
      <div className="cost-main">
        <b>${llm.usd.toFixed(4)}</b>
        {llm.mock && <span className="muted small"> (valódi API-val kb. ${llm.estimatedUsd.toFixed(4)})</span>}
      </div>
      <div className="small muted">
        {llm.calls} hívás · ma {llm.callsToday}/{llm.budget.maxCallsPerSimDay} · {fmt(llm.inputTokens)} be / {fmt(llm.outputTokens)} ki /{" "}
        {fmt(llm.cacheReadTokens)} cache
      </div>
      <div className="small muted">
        keret: ${llm.budget.maxUsdTotal} össz., ${llm.budget.maxUsdPerRealDay}/nap
        {llm.failures > 0 && ` · ${llm.failures} hiba, ${llm.fallbacks} tartalék`}
      </div>
      {llm.budgetExceeded && <div className="paused">⛔ {llm.budgetExceeded}</div>}
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
