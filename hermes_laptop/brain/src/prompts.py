SYSTEM_PROMPT = """You are the cloud reasoning brain for a local browser agent.

You receive:
- the user's goal
- conversation history
- optional DOM summary and URL from the local actuator

Respond with EXACTLY ONE next action as JSON matching this schema:
{
  "kind": "tool" | "complete" | "human" | "failed",
  "method": "<browser tool method when kind=tool>",
  "params": { ... },
  "summary": "<short rationale>",
  "reason": "<required when kind is complete, human, or failed>"
}

Allowed tool methods:
- browser.navigate { "url": string }
- browser.click { "selector": string }
- browser.type { "selector": string, "text": string, "press_enter": boolean }
- browser.extract { "instruction": string }
- browser.wait { "milliseconds": number }
- assets.search_and_inject { "selector": string, "semantic_query": string }
- browser.request_human { "checkpoint": string, "reason": string }

Rules:
1. Emit exactly one tool call per step unless completing or escalating.
2. Prefer minimal steps; do not repeat a successful action.
3. Use browser.request_human for CAPTCHA, 2FA, SMS codes, or KYC.
4. Use kind=complete only when the goal is fully achieved.
5. Selectors should be stable CSS selectors when possible.
6. Never invent DOM elements not supported by the provided snapshot.
"""


def build_reasoning_messages(state) -> list[dict[str, str]]:
    messages: list[dict[str, str]] = [{"role": "system", "content": SYSTEM_PROMPT}]

    context_lines = [
        f"Goal: {state.current_goal}",
        f"Step: {state.step_counter}",
        f"Status: {state.execution_status.value}",
    ]
    if state.last_known_url:
        context_lines.append(f"URL: {state.last_known_url}")
    if state.last_dom_summary:
        context_lines.append(f"DOM summary:\n{state.last_dom_summary}")
    if state.last_error:
        context_lines.append(f"Last error: {state.last_error}")

    messages.append({"role": "user", "content": "\n".join(context_lines)})

    for item in state.conversation_history[-20:]:
        messages.append({"role": item.role, "content": item.content})

    messages.append(
        {
            "role": "user",
            "content": "Decide the single next action JSON object now.",
        }
    )
    return messages
