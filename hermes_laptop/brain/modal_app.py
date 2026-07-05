from __future__ import annotations

import modal

from src.config import BrainConfig
from src.models import (
    AgentState,
    ExecutionStatus,
    StartSessionRequest,
    StartSessionResponse,
    StepTrigger,
)
from src.reasoning import ReasoningEngine
from src.state import RedisStateStore, create_initial_state, new_session_id
from src.step_runner import StepRunner

image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install(
        "pydantic>=2.7",
        "redis>=5.0",
        "openai>=1.30",
        "websockets>=12.0",
        "httpx>=0.27",
    )
    .add_local_python_source("src")
)

app = modal.App("hermes-stateless-brain", image=image)


def _runner() -> StepRunner:
    config = BrainConfig.from_env()
    store = RedisStateStore(config)
    return StepRunner(config, store, ReasoningEngine(config))


def _execute_step_url() -> str | None:
    return modal.current_function_call_id() and None


@app.function(
    secrets=[modal.Secret.from_name("hermes-brain")],
    timeout=60,
)
@modal.web_endpoint(method="POST")
def start_session(payload: dict):
    request = StartSessionRequest.model_validate(payload)
    config = BrainConfig.from_env()
    store = RedisStateStore(config)

    session_id = request.session_id or new_session_id()
    state = create_initial_state(
        session_id=session_id,
        goal=request.goal,
        user_id=request.user_id,
    )
    store.save(state)

    execute_step.spawn(
        {
            "session_id": session_id,
            "trigger": "start",
        }
    )

    return StartSessionResponse(
        session_id=session_id,
        execution_status=ExecutionStatus.IDLE,
    ).model_dump()


@app.function(
    secrets=[modal.Secret.from_name("hermes-brain")],
    timeout=60,
)
def execute_step(payload: dict):
    trigger = StepTrigger.model_validate(payload)
    runner = _runner()
    result = runner.run(trigger)
    return result.model_dump()


@app.function(
    secrets=[modal.Secret.from_name("hermes-brain")],
    timeout=60,
)
@modal.web_endpoint(method="POST")
def execute_step_webhook(payload: dict):
    """Relay brain-wake target. Accepts relay webhook or direct actuator callbacks."""
    session_id = payload.get("session_id")
    if not session_id:
        return {"error": "session_id is required"}, 400

    trigger_payload = {
        "session_id": session_id,
        "trigger": payload.get("trigger", "brain_wake"),
        "reason": payload.get("reason"),
    }

    if "actuator_frame" in payload:
        trigger_payload["actuator_frame"] = payload["actuator_frame"]

    result = execute_step.remote(trigger_payload)
    return result


@app.function(
    secrets=[modal.Secret.from_name("hermes-brain")],
    timeout=30,
)
@modal.web_endpoint(method="GET")
def get_session(session_id: str):
    config = BrainConfig.from_env()
    store = RedisStateStore(config)
    state = store.get(session_id)
    if state is None:
        return {"error": "not found"}, 404
    return state.model_dump()


@app.function(
    secrets=[modal.Secret.from_name("hermes-brain")],
    timeout=30,
)
@modal.web_endpoint(method="POST")
def resume_session(payload: dict):
    session_id = payload.get("session_id")
    if not session_id:
        return {"error": "session_id is required"}, 400

    config = BrainConfig.from_env()
    store = RedisStateStore(config)
    state = store.get(session_id)
    if state is None:
        return {"error": "not found"}, 404

    if state.execution_status != ExecutionStatus.NEEDS_HUMAN_INTERVENTION:
        return {"error": "session is not awaiting human intervention"}, 409

    state.execution_status = ExecutionStatus.IDLE
    store.save(state)

    result = execute_step.remote(
        {
            "session_id": session_id,
            "trigger": "manual",
            "reason": "human_resume",
        }
    )
    return result
