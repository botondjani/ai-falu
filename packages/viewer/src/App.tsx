import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { describeEvent, formatTime, lookupFrom, tickToTime } from "@falu/core";
import { VillageRenderer } from "./renderer";
import { useSim, type TickFrame } from "./useSim";

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
    rendererRef.current?.frame(f.tick, f.tickMs, f.agents, f.moves);
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
          <div className={`conn ${state.connected ? "ok" : "bad"}`}>{state.connected ? "élő" : "nincs kapcsolat…"}</div>
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

        <section>
          <h2>Lakók</h2>
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
                {a.activity ? `${a.activity.kind} · ${names.place(a.activity.locationId)}` : "—"}
              </div>
              <Bar label="éhség" value={a.needs.hunger} color="#e67e22" />
              <Bar label="energia" value={a.needs.energy} color="#3498db" />
              {selected === a.id && (
                <div className="small detail">
                  <div>Miért: {a.activity?.reason ?? "—"}</div>
                  <div>Készlet: {Object.entries(a.inventory).map(([k, v]) => `${k} ×${v}`).join(", ") || "üres"}</div>
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
            </div>
          ))}
        </section>
      </aside>
    </div>
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
