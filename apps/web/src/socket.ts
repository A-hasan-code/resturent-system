import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import { onConnStatus, onServerMoved, reportLost, serverOrigin } from "./server";

let socket: Socket | null = null;
let token: string | null = null;
let failures = 0;

function open() {
  socket?.disconnect();
  if (!token) return;
  const origin = serverOrigin() || undefined;
  socket = io(origin, {
    auth: { token },
    transports: ["websocket", "polling"],
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  });
  socket.on("connect", () => {
    failures = 0;
  });
  socket.on("connect_error", () => {
    failures += 1;
    if (failures === 3) void reportLost();
  });
  socket.on("auth.error", () => window.dispatchEvent(new Event("hotel:unauthorized")));
}

onServerMoved(() => open());
onConnStatus((s) => {
  if (s === "ok" && socket && !socket.connected) open();
});

export function connectSocket(t: string | null) {
  token = t;
  if (!t) {
    socket?.disconnect();
    socket = null;
    return;
  }
  open();
}

/** Subscribe to a realtime server event for the lifetime of the component. */
export function useSocketEvent<T = unknown>(event: string, handler: (payload: T) => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const fn = (p: T) => ref.current(p);
    let current: Socket | null = null;
    const attach = () => {
      current?.off(event, fn);
      current = socket;
      current?.on(event, fn);
    };
    attach();
    const t = setInterval(() => {
      if (current !== socket) attach();
    }, 1000);
    return () => {
      clearInterval(t);
      current?.off(event, fn);
    };
  }, [event]);
}
