from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Protocol
from uuid import uuid4

import redis

from .config import BrainConfig
from .models import AgentState, ExecutionStatus


def utc_now_iso() -> str:
    return datetime.now(UTC).isoformat()


def state_key(session_id: str) -> str:
    return f"agent_state:{session_id}"


def lock_key(session_id: str) -> str:
    return f"agent_lock:{session_id}"


class StateStore(Protocol):
    def get(self, session_id: str) -> AgentState | None: ...

    def save(self, state: AgentState) -> None: ...

    def delete(self, session_id: str) -> None: ...

    def acquire_step_lock(self, session_id: str, ttl_seconds: int) -> bool: ...

    def release_step_lock(self, session_id: str) -> None: ...


class RedisStateStore:
    def __init__(self, config: BrainConfig):
        self._config = config
        self._client = redis.from_url(config.redis_url, decode_responses=True)

    def get(self, session_id: str) -> AgentState | None:
        raw = self._client.get(state_key(session_id))
        if not raw:
            return None
        return AgentState.model_validate_json(raw)

    def save(self, state: AgentState) -> None:
        state.updated_at = utc_now_iso()
        payload = state.model_dump_json()
        self._client.set(
            state_key(state.session_id),
            payload,
            ex=self._config.state_ttl_seconds,
        )

    def delete(self, session_id: str) -> None:
        self._client.delete(state_key(session_id))

    def acquire_step_lock(self, session_id: str, ttl_seconds: int) -> bool:
        return bool(
            self._client.set(lock_key(session_id), "1", nx=True, ex=ttl_seconds)
        )

    def release_step_lock(self, session_id: str) -> None:
        self._client.delete(lock_key(session_id))


class MemoryStateStore:
    def __init__(self):
        self._states: dict[str, str] = {}
        self._locks: set[str] = set()

    def get(self, session_id: str) -> AgentState | None:
        raw = self._states.get(session_id)
        if not raw:
            return None
        return AgentState.model_validate_json(raw)

    def save(self, state: AgentState) -> None:
        state.updated_at = utc_now_iso()
        self._states[state.session_id] = state.model_dump_json()

    def delete(self, session_id: str) -> None:
        self._states.pop(session_id, None)
        self._locks.discard(session_id)

    def acquire_step_lock(self, session_id: str, ttl_seconds: int) -> bool:
        del ttl_seconds
        if session_id in self._locks:
            return False
        self._locks.add(session_id)
        return True

    def release_step_lock(self, session_id: str) -> None:
        self._locks.discard(session_id)


def create_initial_state(
    *,
    session_id: str,
    goal: str,
    user_id: str | None = None,
) -> AgentState:
    now = utc_now_iso()
    return AgentState(
        session_id=session_id,
        user_id=user_id,
        current_goal=goal,
        step_counter=0,
        conversation_history=[
            {
                "role": "user",
                "content": goal,
            }
        ],
        execution_status=ExecutionStatus.IDLE,
        created_at=now,
        updated_at=now,
    )


def new_session_id() -> str:
    return str(uuid4())


def merge_actuator_frame(state: AgentState, frame: dict) -> None:
    method = frame.get("method")
    params = frame.get("params") or {}

    if isinstance(method, str) and method.startswith("relay."):
        return

    if method == "browser.snapshot":
        state.last_dom_summary = params.get("dom_summary") or params.get("summary")
        state.last_known_url = params.get("url") or state.last_known_url
        state.conversation_history.append(
            {
                "role": "tool",
                "content": json.dumps(
                    {
                        "type": "snapshot",
                        "url": state.last_known_url,
                        "dom_summary": state.last_dom_summary,
                    }
                ),
            }
        )
        return

    if isinstance(method, str) and method.endswith(".result"):
        state.last_known_url = params.get("url") or state.last_known_url
        state.conversation_history.append(
            {
                "role": "tool",
                "content": json.dumps({"method": method, "params": params}),
            }
        )
        if params.get("status") == "error":
            state.last_error = params.get("message") or "Actuator reported error"
        else:
            state.last_error = None
        return

    state.conversation_history.append(
        {
            "role": "tool",
            "content": json.dumps(frame),
        }
    )
