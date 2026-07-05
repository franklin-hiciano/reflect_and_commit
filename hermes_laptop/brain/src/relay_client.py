from __future__ import annotations

import asyncio
import json
from typing import Any
from urllib.parse import urlencode, urlparse, urlunparse

import websockets


class RelayClient:
    def __init__(self, relay_ws_url: str, session_id: str):
        self._relay_ws_url = relay_ws_url
        self._session_id = session_id
        self._ws: websockets.WebSocketClientProtocol | None = None

    @property
    def url(self) -> str:
        parsed = urlparse(self._relay_ws_url)
        query = urlencode({"session_id": self._session_id, "role": "brain"})
        path = parsed.path if parsed.path else "/tunnel"
        return urlunparse(
            (
                parsed.scheme,
                parsed.netloc,
                path,
                parsed.params,
                query,
                parsed.fragment,
            )
        )

    async def connect(self) -> None:
        self._ws = await websockets.connect(self.url, open_timeout=10)

    async def close(self) -> None:
        if self._ws is not None:
            await self._ws.close()
            self._ws = None

    async def send_frame(self, frame: dict[str, Any]) -> None:
        if self._ws is None:
            raise RuntimeError("RelayClient is not connected")
        await self._ws.send(json.dumps(frame))

    async def recv_frames(self, timeout_seconds: float) -> list[dict[str, Any]]:
        if self._ws is None:
            raise RuntimeError("RelayClient is not connected")

        frames: list[dict[str, Any]] = []
        try:
            while True:
                raw = await asyncio.wait_for(self._ws.recv(), timeout=timeout_seconds)
                if isinstance(raw, bytes):
                    raw = raw.decode("utf-8")
                frame = json.loads(raw)
                if _is_relay_control(frame):
                    continue
                frames.append(frame)
        except asyncio.TimeoutError:
            return frames

    async def __aenter__(self) -> RelayClient:
        await self.connect()
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        del exc_type, exc, tb
        await self.close()


def _is_relay_control(frame: dict[str, Any]) -> bool:
    method = frame.get("method")
    return isinstance(method, str) and method.startswith("relay.")
