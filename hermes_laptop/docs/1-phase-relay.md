# Document 1: Phase 1 — The WebSocket Relay Tunnel

## Objective

Build a high-throughput, low-latency, **state-blind** JSON-RPC relay that punctures residential NATs and routes bidirectional control signals without open incoming ports on the client.

Both `brain` (Modal) and `actuator` (laptop) connect **outbound** to the relay. The relay never initiates connections to clients.

---

## Architecture Review Notes (Deviations from Raw Plan)

These adjustments keep Phase 1 interoperable with later phases:

| Original plan item | Adjustment | Reason |
|--------------------|------------|--------|
| Cloudflare Workers | **Prefer Bun on a single VPS/Fly machine** | Workers cannot share an in-memory `Map` across isolates; you'd need Durable Objects and a different design |
| Hard-coded Modal webhook | **`BRAIN_WAKE_WEBHOOK_URL` env var** | Relay stays transport-only; Phase 2 owns orchestration wake logic |
| `ws://` only | **`wss://` in production** behind TLS terminator | Required for browser Mixed Content and credential safety |
| UUID-only `session_id` | **Treat UUID as capability secret** | No separate auth in v1; document that leaking `session_id` grants full session access |
| Queue overflow unspecified | **Drop oldest frame + emit `relay.queue_overflow` error to brain** | Prevents silent starvation under backpressure |

---

## Runtime

- **Runtime:** Bun 1.x (Node.js compatible)
- **Port:** `RELAY_PORT` (default `8787`)
- **State:** In-process `Map<string, ActiveSession>` — single instance only for v1

---

## Connection URL

```
wss://relay.example.com/tunnel?session_id=<uuid>&role=brain|actuator
```

### Query parameters

| Param | Required | Values |
|-------|----------|--------|
| `session_id` | yes | UUID v4 |
| `role` | yes | `brain` \| `actuator` |

Invalid/missing params → HTTP 400 before upgrade.

Duplicate role on same session → close new socket with code `4001` (`role_already_connected`).

---

## Session Model

```typescript
interface ActiveSession {
  brain: WebSocket | null;
  actuator: WebSocket | null;
  pendingToBrain: string[];     // raw JSON strings, max 50
  pendingToActuator: string[];  // raw JSON strings, max 50
  disconnectTimer: Timer | null;
  createdAt: number;
  lastActivityAt: number;
}

const sessions = new Map<string, ActiveSession>();
```

### Lifecycle

1. First connection for a `session_id` creates the session entry.
2. On disconnect of either leg, **do not delete** the session for `SESSION_TTL_MS` (default 300_000 ms).
3. Reconnect within TTL restores pairing; `pendingQueue` drains to newly connected peer.
4. After TTL with zero connected legs, delete session and drop queue.

---

## Frame Schema (Validation)

Every WebSocket text frame must parse as JSON and satisfy:

```typescript
interface TunnelFrame {
  jsonrpc: "2.0";
  method: string;           // non-empty
  params?: unknown;
  id?: string | number | null;
}
```

Reject (close socket `4002`, reason `invalid_frame`) when:

- Not valid JSON
- Missing `jsonrpc: "2.0"` or `method`
- Binary frames (unsupported in v1)

The relay **does not** interpret `method` or `params` — it forwards the raw string verbatim.

### Reserved relay → client methods (injected by relay)

| method | When |
|--------|------|
| `relay.peer_connected` | Other role joined session |
| `relay.peer_disconnected` | Other role left |
| `relay.queue_overflow` | Brain sent while actuator offline and queue was full |
| `relay.error` | Generic relay errors |

---

## Routing Logic

```
ON message FROM role:
  validate frame
  IF role == "brain":
    IF actuator connected → forward verbatim to actuator
    ELSE enqueue in pendingToActuator (drop oldest if len >= 50, notify brain on drop)
  IF role == "actuator":
    IF brain connected → forward verbatim to brain
    ELSE POST BRAIN_WAKE_WEBHOOK_URL (if configured) with { session_id, reason: "brain_disconnected" }
         enqueue in pendingToBrain (same queue rules)
```

### Brain wake webhook

```http
POST ${BRAIN_WAKE_WEBHOOK_URL}
Content-Type: application/json

{
  "session_id": "<uuid>",
  "reason": "brain_disconnected",
  "timestamp": "<ISO8601>"
}
```

Fire-and-forget; log failures. Phase 2 Modal endpoint implements rehydration.

---

## Health & Observability

| Endpoint | Response |
|----------|----------|
| `GET /health` | `{ "status": "ok", "sessions": N, "connected_legs": M }` |
| `GET /metrics` | Optional Prometheus text format (session count, queue depth histogram) |

Log fields: `session_id`, `role`, `event` (connect, disconnect, forward, queue, reject).

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `RELAY_PORT` | `8787` | HTTP + WebSocket listen port |
| `SESSION_TTL_MS` | `300000` | Session retention after last disconnect |
| `PENDING_QUEUE_MAX` | `50` | Max queued frames per session |
| `BRAIN_WAKE_WEBHOOK_URL` | _(empty)_ | Optional wake URL when actuator sends and brain is offline |

---

## Client Integration (Phase 2 & 3)

**Brain (Modal)** after each Redis rehydration step:

1. Open `wss://.../tunnel?session_id=X&role=brain`
2. Send tool invocation frame to actuator
3. Wait for actuator response frame (or timeout → update Redis, exit)
4. Close socket; container terminates

**Actuator (local orchestrator)**:

1. Maintain persistent `role=actuator` connection
2. On tool frame → execute Playwright action → reply with result frame
3. On disconnect → exponential backoff reconnect within SESSION_TTL

---

## Example Frames

Brain → actuator (forwarded verbatim):

```json
{
  "jsonrpc": "2.0",
  "id": "step-14",
  "method": "browser.click",
  "params": { "selector": "#submit", "session_id": "..." }
}
```

Actuator → brain:

```json
{
  "jsonrpc": "2.0",
  "id": "step-14",
  "method": "browser.click.result",
  "params": { "status": "ok", "url": "https://admin.shopify.com/..." }
}
```

---

## Acceptance Criteria

- [ ] Brain and actuator pair through relay with no inbound ports on laptop
- [ ] Actuator offline: up to 50 brain frames queued, delivered on reconnect
- [ ] Either leg disconnects: session survives 300s
- [ ] Malformed JSON rejected without affecting peer
- [ ] Duplicate `role` rejected
- [ ] `GET /health` returns session stats
- [ ] Optional webhook fires when actuator sends and brain absent

---

## Implementation Location

```
hermes_laptop/relay/
  src/server.ts
  src/session-manager.ts
  src/types.ts
  src/validate.ts
  package.json
```

Run: `bun run src/server.ts`
