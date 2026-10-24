import { useMemo, useState } from "react";
import type { AgentView } from "@falu/sim";

type Metric = "liking" | "trust";

interface Node {
  id: string;
  x: number;
  y: number;
}

const W = 900;
const H = 640;

/** Determinisztikus erőalapú elrendezés: kör kezdőpozícióból, a vonzás a kapcsolat erősségével arányos. */
function layout(agents: AgentView[], metric: Metric): Node[] {
  const n = agents.length;
  const nodes = agents.map((a, i) => ({
    id: a.id,
    x: W / 2 + Math.cos((2 * Math.PI * i) / n) * 250,
    y: H / 2 + Math.sin((2 * Math.PI * i) / n) * 230,
  }));
  const idx = new Map(nodes.map((nd, i) => [nd.id, i]));
  const edges: [number, number, number][] = [];
  for (const a of agents)
    for (const r of a.relations) {
      const j = idx.get(r.with);
      if (j !== undefined) edges.push([idx.get(a.id)!, j, r[metric]]);
    }
  for (let it = 0; it < 300; it++) {
    const fx = new Array(n).fill(0);
    const fy = new Array(n).fill(0);
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const dx = nodes[i].x - nodes[j].x;
        const dy = nodes[i].y - nodes[j].y;
        const d2 = Math.max(100, dx * dx + dy * dy);
        const f = 9000 / d2;
        fx[i] += dx * f * 0.05;
        fy[i] += dy * f * 0.05;
        fx[j] -= dx * f * 0.05;
        fy[j] -= dy * f * 0.05;
      }
    for (const [i, j, v] of edges) {
      // pozitív kapcsolat közelebb húz, negatív kicsit eltol
      const k = (v / 100) * 0.004;
      const dx = nodes[j].x - nodes[i].x;
      const dy = nodes[j].y - nodes[i].y;
      fx[i] += dx * k;
      fy[i] += dy * k;
      fx[j] -= dx * k;
      fy[j] -= dy * k;
    }
    for (let i = 0; i < n; i++) {
      fx[i] += (W / 2 - nodes[i].x) * 0.002;
      fy[i] += (H / 2 - nodes[i].y) * 0.002;
      nodes[i].x = Math.min(W - 60, Math.max(60, nodes[i].x + Math.max(-10, Math.min(10, fx[i]))));
      nodes[i].y = Math.min(H - 40, Math.max(40, nodes[i].y + Math.max(-10, Math.min(10, fy[i]))));
    }
  }
  return nodes;
}

function color(v: number) {
  if (v >= 0) return `rgba(111, 207, 151, ${0.25 + Math.min(1, v / 60) * 0.75})`;
  return `rgba(235, 122, 122, ${0.25 + Math.min(1, -v / 60) * 0.75})`;
}

/** Kapcsolati és hírnévgráf: él = vélemény (A → B), csomópont mérete = hírnév. */
export function RelationGraph({
  agents,
  selected,
  onSelect,
}: {
  agents: AgentView[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const [metric, setMetric] = useState<Metric>("liking");
  const [threshold, setThreshold] = useState(10);
  // az elrendezés csak a lakók halmazától és nagyjából a kapcsolatoktól függjön (ne ugráljon tickenként)
  const layoutKey = agents.map((a) => `${a.id}:${a.relations.map((r) => Math.round(r[metric] / 10)).join(",")}`).join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const nodes = useMemo(() => layout(agents, metric), [layoutKey, metric]);
  const pos = new Map(nodes.map((n) => [n.id, n]));

  const reputation = new Map<string, number>();
  for (const a of agents) {
    const incoming = agents.flatMap((o) => o.relations.filter((r) => r.with === a.id).map((r) => r[metric]));
    reputation.set(a.id, incoming.length ? incoming.reduce((s, v) => s + v, 0) / incoming.length : 0);
  }

  const edges = agents.flatMap((a) =>
    a.relations
      .filter((r) => Math.abs(r[metric]) >= threshold && pos.has(r.with))
      .map((r) => ({ from: a.id, to: r.with, v: r[metric] })),
  );
  const focus = selected ? new Set([selected, ...edges.filter((e) => e.from === selected || e.to === selected).flatMap((e) => [e.from, e.to])]) : null;

  return (
    <div className="graph">
      <div className="graph-controls">
        <button className={metric === "liking" ? "on" : ""} onClick={() => setMetric("liking")}>
          szimpátia
        </button>
        <button className={metric === "trust" ? "on" : ""} onClick={() => setMetric("trust")}>
          bizalom
        </button>
        <label className="small muted">
          küszöb: {threshold}
          <input type="range" min={0} max={60} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
        </label>
        <span className="small muted">Él: A véleménye B-ről (zöld jó, piros rossz). Kör mérete: hírnév (mások átlagos véleménye).</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="graph-svg">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#8b95a5" />
          </marker>
        </defs>
        {edges.map((e) => {
          const a = pos.get(e.from)!;
          const b = pos.get(e.to)!;
          // kis ív, hogy az oda-vissza élek ne fedjék egymást
          const mx = (a.x + b.x) / 2 + (b.y - a.y) * 0.08;
          const my = (a.y + b.y) / 2 - (b.x - a.x) * 0.08;
          const dim = focus && !(e.from === selected || e.to === selected);
          return (
            <path
              key={`${e.from}>${e.to}`}
              d={`M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}`}
              stroke={color(e.v)}
              strokeWidth={1 + Math.abs(e.v) / 20}
              fill="none"
              opacity={dim ? 0.08 : 1}
              markerEnd="url(#arrow)"
            >
              <title>{`${e.from} → ${e.to}: ${e.v}`}</title>
            </path>
          );
        })}
        {agents.map((a) => {
          const p = pos.get(a.id)!;
          const rep = reputation.get(a.id) ?? 0;
          const r = 10 + Math.max(0, rep + 30) / 6;
          const dim = focus && !focus.has(a.id);
          return (
            <g key={a.id} transform={`translate(${p.x},${p.y})`} onClick={() => onSelect(a.id)} style={{ cursor: "pointer" }} opacity={dim ? 0.3 : 1}>
              <circle r={r} fill={a.color} stroke={selected === a.id ? "#fff" : rep >= 0 ? "#6fcf97" : "#eb7a7a"} strokeWidth={selected === a.id ? 3 : 1.5} />
              <text y={r + 13} textAnchor="middle" className="graph-label">
                {a.name}
              </text>
              <text y={r + 25} textAnchor="middle" className="graph-sub">
                hírnév {rep >= 0 ? "+" : ""}
                {Math.round(rep)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
