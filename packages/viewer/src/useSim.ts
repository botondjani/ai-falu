import { useEffect, useRef, useState } from "react";
import type { SimEvent, TileMap } from "@falu/core";
import type { AgentView, ClientMessage, LlmStats, ServerMessage, SimStatus } from "@falu/sim";

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
}

const WS_URL = import.meta.env.VITE_SIM_WS ?? `ws://${location.hostname}:8787`;
const MAX_EVENTS = 300;

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
  });
  const wsRef = useRef<WebSocket | null>(null);
  const frameRef = useRef(onFrame);
  frameRef.current = onFrame;

  useEffect(() => {
    let closed = false;
    let retry: ReturnType<typeof setTimeout>;
    const connect = () => {
      const ws = new WebSocket(WS_URL);
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
          });
          frameRef.current({ tick: msg.tick, tickMs: 0, agents: msg.agents, moves: {}, events: [] });
        } else if (msg.type === "tick") {
          frameRef.current(msg);
          setState((s) => ({
            ...s,
            tick: msg.tick,
            agents: msg.agents,
            llm: msg.llm ?? s.llm,
            events: msg.events.length ? [...s.events, ...msg.events].slice(-MAX_EVENTS) : s.events,
          }));
        } else if (msg.type === "status") {
          setState((s) => ({ ...s, status: msg.status, llm: msg.status.llm ?? s.llm }));
        }
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      wsRef.current?.close();
    };
  }, []);

  const send = (m: ClientMessage) => wsRef.current?.send(JSON.stringify(m));
  return { state, send };
}
