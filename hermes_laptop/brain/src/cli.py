from __future__ import annotations

import argparse
import json

from .config import BrainConfig
from .models import StepTrigger
from .reasoning import ReasoningEngine
from .state import (
    MemoryStateStore,
    RedisStateStore,
    create_initial_state,
    new_session_id,
)
from .step_runner import StepRunner


def _store(config: BrainConfig, use_memory: bool):
    if use_memory:
        return MemoryStateStore()
    return RedisStateStore(config)


def cmd_start(args: argparse.Namespace) -> None:
    config = BrainConfig.from_env()
    store = _store(config, args.memory)
    session_id = args.session_id or new_session_id()
    state = create_initial_state(
        session_id=session_id,
        goal=args.goal,
        user_id=args.user_id,
    )
    store.save(state)
    print(json.dumps({"session_id": session_id, "goal": args.goal}, indent=2))


def cmd_execute(args: argparse.Namespace) -> None:
    config = BrainConfig.from_env()
    store = _store(config, args.memory)
    runner = StepRunner(config, store, ReasoningEngine(config))
    trigger = StepTrigger(session_id=args.session_id, trigger=args.trigger)
    result = runner.run(trigger)
    print(result.model_dump_json(indent=2))


def main() -> None:
    parser = argparse.ArgumentParser(description="Hermes brain local CLI")
    parser.add_argument("--memory", action="store_true", help="Use in-memory state")

    sub = parser.add_subparsers(dest="command", required=True)

    start = sub.add_parser("start", help="Create a session")
    start.add_argument("--goal", required=True)
    start.add_argument("--session-id")
    start.add_argument("--user-id")
    start.set_defaults(func=cmd_start)

    execute = sub.add_parser("execute", help="Run one brain step")
    execute.add_argument("--session-id", required=True)
    execute.add_argument(
        "--trigger",
        choices=["start", "brain_wake", "manual"],
        default="manual",
    )
    execute.set_defaults(func=cmd_execute)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
