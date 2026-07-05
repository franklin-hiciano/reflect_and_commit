import type { ServerWebSocket } from "bun";
import type { Role, SocketData } from "./types";
import { CLOSE_CODES } from "./types";
import { SessionManager } from "./session-manager";
import { parseRole, parseSessionId, parseTunnelFrame } from "./validate";
import type { RelayConfig } from "./types";

function loadConfig(): RelayConfig {
  return {
    port: Number(process.env.RELAY_PORT ?? 8787),
    sessionTtlMs: Number(process.env.SESSION_TTL_MS ?? 300_000),
    pendingQueueMax: Number(process.env.PENDING_QUEUE_MAX ?? 50),
    brainWakeWebhookUrl: process.env.BRAIN_WAKE_WEBHOOK_URL ?? null,
  };
}

const config = loadConfig();
const sessions = new SessionManager(config);

const server = Bun.serve<SocketData>({
  port: config.port,

  fetch(req, server) {
    const url = new URL(req.url);

    if (url.pathname === "/health") {
      return Response.json({
        status: "ok",
        sessions: sessions.getSessionCount(),
        connected_legs: sessions.getConnectedLegCount(),
      });
    }

    if (url.pathname !== "/tunnel") {
      return new Response("Not Found", { status: 404 });
    }

    const sessionId = parseSessionId(url.searchParams.get("session_id"));
    const role = parseRole(url.searchParams.get("role"));

    if (!sessionId || !role) {
      return new Response("Missing or invalid session_id / role", { status: 400 });
    }

    if (server.upgrade(req, { data: { sessionId, role } })) {
      return undefined;
    }

    return new Response("WebSocket upgrade failed", { status: 500 });
  },

  websocket: {
    open(ws) {
      const { sessionId, role } = ws.data;
      console.log("[relay] connect", { sessionId, role });
      sessions.attach(sessionId, role, ws);
    },

    message(ws, message) {
      const { sessionId, role } = ws.data;

      if (typeof message !== "string") {
        ws.close(CLOSE_CODES.invalidFrame, "invalid_frame");
        return;
      }

      if (!parseTunnelFrame(message)) {
        ws.close(CLOSE_CODES.invalidFrame, "invalid_frame");
        return;
      }

      sessions.routeMessage(sessionId, role, message);
    },

    close(ws) {
      const { sessionId, role } = ws.data;
      console.log("[relay] disconnect", { sessionId, role });
      sessions.detach(sessionId, role);
    },
  },
});

console.log(`[relay] listening on http://localhost:${server.port}`);
console.log(`[relay] tunnel ws://localhost:${server.port}/tunnel?session_id=<uuid>&role=brain|actuator`);
