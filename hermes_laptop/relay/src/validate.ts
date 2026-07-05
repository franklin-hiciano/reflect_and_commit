import type { TunnelFrame } from "./types";

export function parseTunnelFrame(raw: string | Buffer): TunnelFrame | null {
  const text = typeof raw === "string" ? raw : raw.toString("utf8");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }

  const frame = parsed as Record<string, unknown>;

  if (frame.jsonrpc !== "2.0") {
    return null;
  }

  if (typeof frame.method !== "string" || frame.method.length === 0) {
    return null;
  }

  return {
    jsonrpc: "2.0",
    method: frame.method,
    params: frame.params,
    id: frame.id as string | number | null | undefined,
  };
}

export function parseRole(value: string | null): "brain" | "actuator" | null {
  if (value === "brain" || value === "actuator") {
    return value;
  }
  return null;
}

export function parseSessionId(value: string | null): string | null {
  if (!value || value.length === 0) {
    return null;
  }

  // Accept any non-empty session token; UUID v4 is recommended by the spec.
  return value;
}
