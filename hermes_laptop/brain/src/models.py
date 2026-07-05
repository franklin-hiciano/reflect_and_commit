from __future__ import annotations

from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field


class ExecutionStatus(str, Enum):
    IDLE = "IDLE"
    REASONING = "REASONING"
    AWAITING_ACTUATOR = "AWAITING_ACTUATOR"
    NEEDS_HUMAN_INTERVENTION = "NEEDS_HUMAN_INTERVENTION"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant", "tool"]
    content: str


class BrowserToolName(str, Enum):
    NAVIGATE = "browser.navigate"
    CLICK = "browser.click"
    TYPE = "browser.type"
    EXTRACT = "browser.extract"
    SEARCH_ASSETS = "assets.search_and_inject"
    WAIT = "browser.wait"
    REQUEST_HUMAN = "browser.request_human"


class ToolDecision(BaseModel):
    kind: Literal["tool", "complete", "human", "failed"]
    method: BrowserToolName | None = None
    params: dict[str, Any] = Field(default_factory=dict)
    summary: str | None = None
    reason: str | None = None


class AgentState(BaseModel):
    session_id: str
    user_id: str | None = None
    current_goal: str
    step_counter: int = 0
    conversation_history: list[ChatMessage] = Field(default_factory=list)
    last_known_url: str | None = None
    last_dom_summary: str | None = None
    execution_status: ExecutionStatus = ExecutionStatus.IDLE
    last_command_id: str | None = None
    last_error: str | None = None
    created_at: str
    updated_at: str


class StepTrigger(BaseModel):
    session_id: str
    trigger: Literal["start", "brain_wake", "manual"] = "manual"
    reason: str | None = None
    actuator_frame: dict[str, Any] | None = None


class StepResult(BaseModel):
    session_id: str
    step_counter: int
    execution_status: ExecutionStatus
    dispatched_method: str | None = None
    message: str


class StartSessionRequest(BaseModel):
    goal: str
    session_id: str | None = None
    user_id: str | None = None


class StartSessionResponse(BaseModel):
    session_id: str
    execution_status: ExecutionStatus
    execute_step_url: str | None = None
