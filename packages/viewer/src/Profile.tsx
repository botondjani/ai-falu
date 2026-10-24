import { useEffect, useState } from "react";
import { formatTime, tickToTime, type NameLookup } from "@falu/core";
import type { AgentView, ProfileView } from "@falu/sim";

const KIND_ICON: Record<string, string> = { megfigyelés: "👁", reflexió: "💭", terv: "📋", beszélgetés: "💬", pletyka: "🤫" };

/** Lakó-profil: jellem, titok, hangulat, terv, hírnév, kapcsolatok, pletykák, emlékek. */
export function ProfileDrawer({
  agent,
  profile,
  names,
  hour,
  onClose,
}: {
  agent: AgentView;
  profile: ProfileView | null;
  names: NameLookup;
  hour: number;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"emlékek" | "kapcsolatok" | "pletykák">("emlékek");
  const [memFilter, setMemFilter] = useState<string>("mind");
  useEffect(() => setMemFilter("mind"), [agent.id]);
  const p = profile && profile.id === agent.id ? profile : null;
  const mems = p ? p.memories.filter((m) => memFilter === "mind" || m.kind === memFilter) : [];

  return (
    <div className="drawer">
      <button className="close" onClick={onClose}>
        ✕
      </button>
      <div className="drawer-head">
        <span className="dot big" style={{ background: agent.color }} />
        <div>
          <h2 className="modal-title">{agent.name}</h2>
          <div className="small muted">
            {agent.occupation}
            {p && `, ${p.age} éves`} · {agent.money} tallér
          </div>
        </div>
      </div>
      {p && (
        <>
          <div className="small">
            <b>Jellem:</b> {p.traits.join(", ")}
          </div>
          <div className="small secret">
            <b>Titkos vágy:</b> {p.secretDesire}
          </div>
          <div className="small">
            <b>Hangulat:</b> {p.mood ?? "—"} · <b>Hírnév:</b>{" "}
            <span className={p.reputation.liking >= 0 ? "pos" : "neg"}>szimpátia {p.reputation.liking}</span>,{" "}
            <span className={p.reputation.trust >= 0 ? "pos" : "neg"}>bizalom {p.reputation.trust}</span>{" "}
            <span className="muted">({p.reputation.count} véleményből)</span>
          </div>
        </>
      )}
      <div className="small">
        <b>Most:</b> {agent.activity ? `${agent.activity.kind} · ${names.place(agent.activity.locationId)} – ${agent.activity.reason}` : "—"}
      </div>
      {agent.activity?.say && <div className="say small">„{agent.activity.say}”</div>}
      <div className="bars">
        <div className="small muted">
          éhség {agent.needs.hunger} · energia {agent.needs.energy} · készlet:{" "}
          {Object.entries(agent.inventory).map(([k, v]) => `${k} ×${v}`).join(", ") || "üres"}
        </div>
      </div>
      {p?.plan && (
        <div className="plan">
          <b className="small">Mai cél:</b> <span className="small">{p.plan.goal}</span>
          {p.plan.items.map((it, i) => (
            <div key={i} className={`small plan-item ${hour >= it.fromHour && hour < it.toHour ? "now" : ""}`}>
              {String(it.fromHour).padStart(2, "0")}–{String(it.toHour).padStart(2, "0")} {it.kind} · {names.place(it.locationId)} – {it.goal}
            </div>
          ))}
        </div>
      )}

      <div className="tabs">
        {(["emlékek", "kapcsolatok", "pletykák"] as const).map((t) => (
          <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      {!p && <div className="muted small">Betöltés…</div>}
      {p && tab === "emlékek" && (
        <>
          <div className="mem-filter">
            {["mind", "reflexió", "beszélgetés", "pletyka", "megfigyelés", "terv"].map((k) => (
              <span key={k} className={memFilter === k ? "on" : ""} onClick={() => setMemFilter(k)}>
                {KIND_ICON[k] ?? ""} {k}
              </span>
            ))}
          </div>
          {mems.map((m) => (
            <div key={m.id} className="mem small">
              <span title={m.kind}>{KIND_ICON[m.kind] ?? "•"}</span>{" "}
              <span className="muted">{formatTime(tickToTime(m.tick))}</span> <span className="imp">{"★".repeat(Math.ceil(m.importance / 2))}</span>
              <div>{m.text}</div>
            </div>
          ))}
        </>
      )}
      {p && tab === "kapcsolatok" && (
        <table className="rel-table small">
          <thead>
            <tr>
              <th>kivel</th>
              <th title="ő hogyan látja">ő → ♥ / ✓</th>
              <th title="az illető hogyan látja őt">→ ő ♥ / ✓</th>
            </tr>
          </thead>
          <tbody>
            {[...p.relations]
              .sort((a, b) => Math.abs(b.out.liking) + Math.abs(b.in.liking) - Math.abs(a.out.liking) - Math.abs(a.in.liking))
              .map((r) => (
                <tr key={r.with}>
                  <td>{names.agent(r.with)}</td>
                  <td>
                    <span className={r.out.liking >= 0 ? "pos" : "neg"}>{r.out.liking}</span> /{" "}
                    <span className={r.out.trust >= 0 ? "pos" : "neg"}>{r.out.trust}</span>
                  </td>
                  <td>
                    <span className={r.in.liking >= 0 ? "pos" : "neg"}>{r.in.liking}</span> /{" "}
                    <span className={r.in.trust >= 0 ? "pos" : "neg"}>{r.in.trust}</span>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      )}
      {p && tab === "pletykák" && (
        <>
          <h3 className="small">Róla szóló pletykák</h3>
          {p.gossipAbout.length === 0 && <div className="small muted">nincs</div>}
          {p.gossipAbout.map((g) => (
            <div key={g.id} className={`small mem ${g.sentiment === "rossz" ? "neg" : g.sentiment === "jó" ? "pos" : ""}`}>
              „{g.text}” <span className="muted">– {g.spread} ember tudja</span>
            </div>
          ))}
          <h3 className="small">Amit hallott</h3>
          {p.gossip.length === 0 && <div className="small muted">semmit</div>}
          {p.gossip.map((g) => (
            <div key={g.id} className="small mem">
              {names.agent(g.aboutId)}: „{g.text}” <span className="muted">– {g.spread} ember tudja{g.origin ? ", ő indította" : ""}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
