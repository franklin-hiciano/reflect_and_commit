import type { ServerWebSocket } from "bun";

export type Role = "brain" | "actuator";

export type RelaySocket = ServerWebSocket<SocketData>;

export interface TunnelFrame {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
  id?: string | number | null;
}

export interface ActiveSession {
  brain: RelaySocket | null;
  actuator: RelaySocket | null;
  pendingToBrain: string[];
  pendingToActuator: string[];
  disconnectTimer: ReturnType<typeof setTimeout> | null;
  createdAt: number;
  lastActivityAt: number;
}

export interface SocketData {
  sessionId: string;
  role: Role;
}

export interface RelayConfig {
  port: number;
  sessionTtlMs: number;
  pendingQueueMax: number;
  brainWakeWebhookUrl: string | null;
}

export const CLOSE_CODES = {
  roleAlreadyConnected: 4001,
  invalidFrame: 4002,
  invalidParams: 4003,
} as const;
