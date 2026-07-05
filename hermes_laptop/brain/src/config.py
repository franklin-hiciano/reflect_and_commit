from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class BrainConfig:
    redis_url: str
    relay_ws_url: str
    openai_api_key: str
    openai_base_url: str
    model: str
    step_lock_ttl_seconds: int
    relay_recv_timeout_seconds: float
    max_steps: int
    state_ttl_seconds: int

    @classmethod
    def from_env(cls) -> BrainConfig:
        redis_url = os.environ.get("UPSTASH_REDIS_URL") or os.environ.get("REDIS_URL")
        if not redis_url:
            raise RuntimeError("UPSTASH_REDIS_URL or REDIS_URL is required")

        openai_api_key = os.environ.get("OPENAI_API_KEY")
        if not openai_api_key:
            raise RuntimeError("OPENAI_API_KEY is required")

        relay_ws_url = os.environ.get("RELAY_WS_URL", "ws://127.0.0.1:8787/tunnel")

        return cls(
            redis_url=redis_url,
            relay_ws_url=relay_ws_url,
            openai_api_key=openai_api_key,
            openai_base_url=os.environ.get(
                "OPENAI_BASE_URL", "https://api.openai.com/v1"
            ),
            model=os.environ.get("BRAIN_MODEL", "gemini-1.5-flash"),
            step_lock_ttl_seconds=int(os.environ.get("STEP_LOCK_TTL_SECONDS", "90")),
            relay_recv_timeout_seconds=float(
                os.environ.get("RELAY_RECV_TIMEOUT_SECONDS", "3.0")
            ),
            max_steps=int(os.environ.get("MAX_STEPS", "200")),
            state_ttl_seconds=int(os.environ.get("STATE_TTL_SECONDS", "604800")),
        )
