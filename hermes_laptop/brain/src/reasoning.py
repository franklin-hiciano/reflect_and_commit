from __future__ import annotations

import json
import re

from openai import OpenAI

from .config import BrainConfig
from .models import AgentState, BrowserToolName, ToolDecision
from .prompts import build_reasoning_messages


JSON_BLOCK_RE = re.compile(r"\{.*\}", re.DOTALL)


class ReasoningEngine:
    def __init__(self, config: BrainConfig):
        self._config = config
        self._client = OpenAI(
            api_key=config.openai_api_key,
            base_url=config.openai_base_url,
        )

    def decide(self, state: AgentState) -> ToolDecision:
        messages = build_reasoning_messages(state)
        response = self._client.chat.completions.create(
            model=self._config.model,
            messages=messages,
            temperature=0.2,
            response_format={"type": "json_object"},
        )

        content = response.choices[0].message.content or "{}"
        payload = self._parse_json(content)

        kind = payload.get("kind", "tool")
        if kind not in {"tool", "complete", "human", "failed"}:
            kind = "failed"
            payload["reason"] = f"Invalid kind from model: {kind}"

        method = payload.get("method")
        if kind == "tool":
            try:
                method = BrowserToolName(method)
            except Exception:
                return ToolDecision(
                    kind="failed",
                    reason=f"Unsupported tool method: {method}",
                )

        return ToolDecision(
            kind=kind,
            method=method,
            params=payload.get("params") or {},
            summary=payload.get("summary"),
            reason=payload.get("reason"),
        )

    @staticmethod
    def _parse_json(content: str) -> dict:
        try:
            return json.loads(content)
        except json.JSONDecodeError:
            match = JSON_BLOCK_RE.search(content)
            if not match:
                raise
            return json.loads(match.group(0))
