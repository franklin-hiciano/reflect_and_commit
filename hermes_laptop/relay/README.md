# Hermes WebSocket Relay (Phase 1)

State-blind JSON-RPC tunnel pairing Modal **brain** ↔ laptop **actuator** through outbound WebSocket connections.

See [docs/1-phase-relay.md](../docs/1-phase-relay.md) for the full specification.

## Quick start

```bash
cd relay
bun install
bun start
```

Health check:

```bash
curl http://localhost:8787/health
```

Connect clients:

```
ws://localhost:8787/tunnel?session_id=<uuid>&role=brain
ws://localhost:8787/tunnel?session_id=<uuid>&role=actuator
```

## Environment

| Variable | Default |
|----------|---------|
| `RELAY_PORT` | `8787` |
| `SESSION_TTL_MS` | `300000` |
| `PENDING_QUEUE_MAX` | `50` |
| `BRAIN_WAKE_WEBHOOK_URL` | _(unset)_ |

## Tests

```bash
bun test
```
