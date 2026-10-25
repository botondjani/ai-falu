import { useEffect, useRef, useState } from "react";
import type { SimEvent, TileMap } from "@falu/core";
import type { AgentView, ClientMessage, LlmStats, MarketView, ProfileView, ServerMessage, SimStatus, Summary } from "@falu/sim";

export interface TickFrame {
  tick: number;
  tickMs: number;
  agents: AgentView[];
  moves: Record<string, { x: number; y: number }[]>;
  events: SimEvent[];
}

export interface SimState {
  connected: boolean;
  map: TileMap | null;
  tick: number;
  agents: AgentView[];
  events: SimEvent[];
  status: SimStatus | null;
  llm: LlmStats | null;
  market: MarketView | null;
  /** null: nincs nyitva; "loading": készül; különben a kész összefoglaló. */
  summary: Summary | "loading" | null;
  profile: ProfileView | null;
}

const WS_URL = import.meta.env.VITE_SIM_WS ?? `ws://${location.hostname}:8787`;
const MAX_EVENTS = 300;
const DEMO = import.meta.env.VITE_DEMO === "1" || new URLSearchParams(location.search).has("demo");
/** Legalább ennyi (1 óra) kihagyás után ajánl összefoglalót. */
const SUMMARY_MIN_TICKS = 12;

/** WebSocket-kapcsolat a szimulációhoz; a tick-képkockákat külön callback kapja (a canvas animációhoz). */
export function useSim(onFrame: (f: TickFrame) => void) {
  const [state, setState] = useState<SimState>({
    connected: false,
    map: null,
    tick: 0,
    agents: [],
    events: [],
    status: null,
    llm: null,
    market: null,
    summary: null,
    profile: null,
  });
  const wsRef = useRef<WebSocket | null>(null);
  const frameRef = useRef(onFrame);
  const tickRef = useRef(0);
  frameRef.current = onFrame;

  useEffect(() => {
    let closed = false;
    let retry: ReturnType<typeof setTimeout>;
    const connect = async () => {
      // Demó mód: a szimuláció a böngészőben fut (build: VITE_DEMO=1, vagy ?demo az URL-ben).
      const ws = (DEMO ? new (await import("@falu/sim/browser")).LocalSocket() : new WebSocket(WS_URL)) as WebSocket;
      wsRef.current = ws;
      ws.onopen = () => setState((s) => ({ ...s, connected: true }));
      ws.onclose = () => {
        setState((s) => ({ ...s, connected: false }));
        if (!closed) retry = setTimeout(connect, 1500);
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data) as ServerMessage;
        if (msg.type === "init") {
          setState({
            connected: true,
            map: msg.map,
            tick: msg.tick,
            agents: msg.agents,
            events: msg.recentEvents.slice(-MAX_EVENTS),
            status: msg.status,
            llm: msg.status.llm ?? null,
            market: msg.market,
            summary: msg.tick - msg.lastSeenTick >= SUMMARY_MIN_TICKS ? "loading" : null,
            profile: null,
          });
          if (msg.tick - msg.lastSeenTick >= SUMMARY_MIN_TICKS) ws.send(JSON.stringify({ type: "summary", mode: "since_seen" }));
          frameRef.current({ tick: msg.tick, tickMs: 0, agents: msg.agents, moves: {}, events: [] });
        } else if (msg.type === "tick") {
          frameRef.current(msg);
          setState((s) => ({
            ...s,
            tick: msg.tick,
            agents: msg.agents,
            llm: msg.llm ?? s.llm,
            market: msg.market,
            events: msg.events.length ? [...s.events, ...msg.events].slice(-MAX_EVENTS) : s.events,
          }));
        } else if (msg.type === "profile") {
          setState((s) => ({ ...s, profile: msg.profile }));
        } else if (msg.type === "summary") {
          setState((s) => ({ ...s, summary: msg.summary }));
        } else if (msg.type === "status") {
          setState((s) => ({ ...s, status: msg.status, llm: msg.status.llm ?? s.llm }));
        }
      };
    };
    connect();
    // Ha a fül háttérbe kerül, azt "megnézettnek" vesszük; visszatéréskor jön az összefoglaló.
    let hiddenAtTick = 0;
    const onVis = () => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== ws.OPEN) return;
      if (document.hidden) {
        ws.send(JSON.stringify({ type: "seen" }));
        hiddenAtTick = tickRef.current;
      } else if (tickRef.current - hiddenAtTick >= SUMMARY_MIN_TICKS) {
        setState((s) => ({ ...s, summary: "loading" }));
        ws.send(JSON.stringify({ type: "summary", mode: "since_seen" }));
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      closed = true;
      clearTimeout(retry);
      wsRef.current?.close();
    };
  }, []);

  tickRef.current = state.tick;

  const send = (m: ClientMessage) => wsRef.current?.send(JSON.stringify(m));
  const requestSummary = (mode: "since_seen" | "last_day") => {
    setState((s) => ({ ...s, summary: "loading" }));
    send({ type: "summary", mode });
  };
  const closeSummary = () => setState((s) => ({ ...s, summary: null }));
  const requestProfile = (agentId: string) => send({ type: "profile", agentId });
  return { state, send, requestSummary, closeSummary, requestProfile };
}
