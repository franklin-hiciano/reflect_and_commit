import type { ActiveSession, RelayConfig, RelaySocket, Role } from "./types";
import { CLOSE_CODES } from "./types";

type Ws = RelaySocket;

export class SessionManager {
  private sessions = new Map<string, ActiveSession>();
  private connectedLegs = 0;

  constructor(private readonly config: RelayConfig) {}

  getSessionCount(): number {
    return this.sessions.size;
  }

  getConnectedLegCount(): number {
    return this.connectedLegs;
  }

  attach(sessionId: string, role: Role, ws: Ws): boolean {
    let session = this.sessions.get(sessionId);

    if (!session) {
      session = {
        brain: null,
        actuator: null,
        pendingToBrain: [],
        pendingToActuator: [],
        disconnectTimer: null,
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
      };
      this.sessions.set(sessionId, session);
    }

    if (session.disconnectTimer) {
      clearTimeout(session.disconnectTimer);
      session.disconnectTimer = null;
    }

    const existing = role === "brain" ? session.brain : session.actuator;
    if (existing) {
      ws.close(CLOSE_CODES.roleAlreadyConnected, "role_already_connected");
      return false;
    }

    if (role === "brain") {
      session.brain = ws;
      this.flushQueue(session.pendingToBrain, ws);
    } else {
      session.actuator = ws;
      this.flushQueue(session.pendingToActuator, ws);
    }

    this.connectedLegs += 1;
    session.lastActivityAt = Date.now();

    this.notifyPeer(sessionId, role, "relay.peer_connected", { role });

    return true;
  }

  detach(sessionId: string, role: Role): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    if (role === "brain" && session.brain) {
      session.brain = null;
      this.connectedLegs = Math.max(0, this.connectedLegs - 1);
    } else if (role === "actuator" && session.actuator) {
      session.actuator = null;
      this.connectedLegs = Math.max(0, this.connectedLegs - 1);
    }

    this.notifyPeer(sessionId, role, "relay.peer_disconnected", { role });
    this.scheduleExpiry(sessionId, session);
  }

  routeMessage(sessionId: string, role: Role, raw: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    session.lastActivityAt = Date.now();

    const target = role === "brain" ? session.actuator : session.brain;

    if (target && target.readyState === WebSocket.OPEN) {
      target.send(raw);
      return;
    }

    if (role === "actuator") {
      void this.triggerBrainWake(sessionId);
    }

    const queue = role === "brain" ? session.pendingToActuator : session.pendingToBrain;
    this.enqueue(session, role, queue, raw);
  }

  private enqueue(
    session: ActiveSession,
    sourceRole: Role,
    queue: string[],
    raw: string,
  ): void {
    if (queue.length >= this.config.pendingQueueMax) {
      queue.shift();
      const notify = sourceRole === "brain" ? session.brain : session.actuator;
      if (notify?.readyState === WebSocket.OPEN) {
        notify.send(
          JSON.stringify({
            jsonrpc: "2.0",
            method: "relay.queue_overflow",
            params: {
              dropped_oldest: true,
              queue_max: this.config.pendingQueueMax,
              direction: sourceRole === "brain" ? "to_actuator" : "to_brain",
            },
          }),
        );
      }
    }

    queue.push(raw);
  }

  private flushQueue(queue: string[], target: Ws): void {
    if (target.readyState !== WebSocket.OPEN) {
      return;
    }

    while (queue.length > 0) {
      const frame = queue.shift();
      if (frame) {
        target.send(frame);
      }
    }
  }

  private notifyPeer(
    sessionId: string,
    disconnectedRole: Role,
    method: string,
    params: Record<string, unknown>,
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    const peer = disconnectedRole === "brain" ? session.actuator : session.brain;
    if (!peer || peer.readyState !== WebSocket.OPEN) {
      return;
    }

    peer.send(JSON.stringify({ jsonrpc: "2.0", method, params }));
  }

  private scheduleExpiry(sessionId: string, session: ActiveSession): void {
    if (session.brain || session.actuator) {
      return;
    }

    if (session.disconnectTimer) {
      clearTimeout(session.disconnectTimer);
    }

    session.disconnectTimer = setTimeout(() => {
      const current = this.sessions.get(sessionId);
      if (!current || current.brain || current.actuator) {
        return;
      }
      this.sessions.delete(sessionId);
    }, this.config.sessionTtlMs);
  }

  private async triggerBrainWake(sessionId: string): Promise<void> {
    const url = this.config.brainWakeWebhookUrl;
    if (!url) {
      return;
    }

    try {
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          reason: "brain_disconnected",
          timestamp: new Date().toISOString(),
        }),
      });
    } catch (error) {
      console.error("[relay] brain wake webhook failed", {
        sessionId,
        error: String(error),
      });
    }
  }
}
