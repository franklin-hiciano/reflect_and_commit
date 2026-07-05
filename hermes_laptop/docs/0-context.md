# Document 0: Overarching System Architecture Context

## System Target

The **Zero-UI Background Browser Agent** — a cloud-hosted reasoning engine that acts on the user's local hardware without exposing cloud datacenter fingerprints.

## Core Objective

Orchestrate a high-intelligence LLM stack (Modal + Hermes) to act seamlessly on a user's local machine (Tauri + Playwright). This bypasses proxy billing, datacenter IP bans, and headless-browser fingerprinting by running inside the user's authentic consumer browser context.

```
[Modal Cloud Brain] (Phase 2) ──► WebSocket Relay (Phase 1) ──► Tauri Bridge Daemon (Phase 3)
         ▲                                                               │
         │ (State Loop Via Redis)                                        ▼
 [Upstash Redis State]                                       Local Browser & RAG (Phases 4 & 5)
```

## The Problem

Direct orchestration from cloud platforms (Modal) trips enterprise anti-bot mitigations and risks execution timeouts during long background runs.

## The Solution

Decouple **reasoning** from **execution**:

| Layer | Location | Responsibility |
|-------|----------|----------------|
| Brain | Modal (cloud) | Thinking, DOM interpretation, state machine, one step per invocation |
| Relay | Public edge | NAT-punching bidirectional pipe; state-blind |
| Actuator | User laptop | Playwright, local RAG, telemetry, human checkpoints |

## Phase Map

| Doc | Phase | Deliverable |
|-----|-------|-------------|
| 1 | WebSocket Relay | Session-paired tunnel (`brain` ↔ `actuator`) |
| 2 | Modal Brain | Stateless Hermes step runner + Upstash Redis |
| 3 | Tauri Bridge | Daemon lifecycle, IPC, zombie prevention |
| 4 | Shadow Context | LanceDB + local embeddings + CDP file injection |
| 5 | Checkpoint UI | Live frame stream + human-in-the-loop handoff |

## Interop Contract

Each phase document defines schemas consumed by adjacent phases. Sub-agents should receive **Document 0** as global context plus **one phase document** in isolation.

## Existing Assets

- Hermes agent already deployed on Modal (`modal_deployment/app.py`) — multi-tenant chat endpoint with NFS-backed user memory.
- Phase 2 will refactor this toward ephemeral, Redis-backed single-step execution rather than long-running containers.

## Non-Goals (Phase 0)

- Mobile app automation (iOS/Android native apps)
- Defeating CAPTCHA/2FA without human checkpoints (Phase 5 handles handoff)
- Storing user files in the cloud (Phase 4 keeps assets local)
