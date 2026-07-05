from __future__ import annotations

import asyncio
from typing import Protocol

from .config import BrainConfig
from .models import (
    AgentState,
    BrowserToolName,
    ExecutionStatus,
    StepResult,
    StepTrigger,
    ToolDecision,
)
from .reasoning import ReasoningEngine
from .relay_client import RelayClient
from .state import StateStore, merge_actuator_frame


class StepRunner:
    def __init__(
        self,
        config: BrainConfig,
        store: StateStore,
        reasoning: ReasoningEngine | None = None,
    ):
        self._config = config
        self._store = store
        self._reasoning = reasoning or ReasoningEngine(config)

    def run(self, trigger: StepTrigger) -> StepResult:
        return asyncio.run(self.run_async(trigger))

    async def run_async(self, trigger: StepTrigger) -> StepResult:
        state = self._store.get(trigger.session_id)
        if state is None:
            raise KeyError(f"Unknown session_id: {trigger.session_id}")

        if state.execution_status in {
            ExecutionStatus.COMPLETED,
            ExecutionStatus.FAILED,
        }:
            return StepResult(
                session_id=state.session_id,
                step_counter=state.step_counter,
                execution_status=state.execution_status,
                message="Session already terminal",
            )

        if state.step_counter >= self._config.max_steps:
            state.execution_status = ExecutionStatus.FAILED
            state.last_error = "Max steps exceeded"
            self._store.save(state)
            return StepResult(
                session_id=state.session_id,
                step_counter=state.step_counter,
                execution_status=state.execution_status,
                message=state.last_error,
            )

        if not self._store.acquire_step_lock(
            trigger.session_id, self._config.step_lock_ttl_seconds
        ):
            return StepResult(
                session_id=state.session_id,
                step_counter=state.step_counter,
                execution_status=state.execution_status,
                message="Step already in progress",
            )

        try:
            state.execution_status = ExecutionStatus.REASONING
            self._store.save(state)

            relay = RelayClient(self._config.relay_ws_url, trigger.session_id)
            await relay.connect()
            try:
                if trigger.actuator_frame:
                    merge_actuator_frame(state, trigger.actuator_frame)

                queued = await relay.recv_frames(
                    self._config.relay_recv_timeout_seconds
                )
                for frame in queued:
                    merge_actuator_frame(state, frame)

                if state.execution_status == ExecutionStatus.NEEDS_HUMAN_INTERVENTION:
                    return self._finalize(
                        state,
                        message="Waiting for human checkpoint",
                    )

                decision = self._reasoning.decide(state)
                return await self._apply_decision(state, decision, relay)
            finally:
                await relay.close()
        finally:
            self._store.release_step_lock(trigger.session_id)

    async def _apply_decision(
        self,
        state: AgentState,
        decision: ToolDecision,
        relay: RelayClient,
    ) -> StepResult:
        if decision.kind == "complete":
            state.execution_status = ExecutionStatus.COMPLETED
            if decision.summary or decision.reason:
                state.conversation_history.append(
                    {
                        "role": "assistant",
                        "content": decision.summary or decision.reason or "Complete",
                    }
                )
            self._store.save(state)
            return self._finalize(state, message=decision.reason or "Goal complete")

        if decision.kind == "human":
            state.execution_status = ExecutionStatus.NEEDS_HUMAN_INTERVENTION
            state.conversation_history.append(
                {
                    "role": "assistant",
                    "content": decision.reason or "Human intervention required",
                }
            )
            self._store.save(state)
            return self._finalize(
                state,
                message=decision.reason or "Human intervention required",
            )

        if decision.kind == "failed":
            state.execution_status = ExecutionStatus.FAILED
            state.last_error = decision.reason or "Reasoning failed"
            self._store.save(state)
            return self._finalize(state, message=state.last_error)

        if decision.method == BrowserToolName.REQUEST_HUMAN:
            state.execution_status = ExecutionStatus.NEEDS_HUMAN_INTERVENTION
            self._store.save(state)
            return self._finalize(
                state,
                message=decision.params.get("reason")
                or "Human checkpoint requested",
            )

        command_id = f"step-{state.step_counter + 1}"
        frame = {
            "jsonrpc": "2.0",
            "id": command_id,
            "method": decision.method.value if decision.method else "browser.wait",
            "params": decision.params,
        }

        await relay.send_frame(frame)

        state.step_counter += 1
        state.last_command_id = command_id
        state.execution_status = ExecutionStatus.AWAITING_ACTUATOR
        if decision.summary:
            state.conversation_history.append(
                {"role": "assistant", "content": decision.summary}
            )
        self._store.save(state)

        return StepResult(
            session_id=state.session_id,
            step_counter=state.step_counter,
            execution_status=state.execution_status,
            dispatched_method=frame["method"],
            message="Command dispatched to actuator",
        )

    def _finalize(self, state: AgentState, message: str) -> StepResult:
        return StepResult(
            session_id=state.session_id,
            step_counter=state.step_counter,
            execution_status=state.execution_status,
            message=message,
        )
