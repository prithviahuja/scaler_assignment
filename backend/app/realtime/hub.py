"""In-process websocket hub.

One user may have several sockets open (multiple tabs), so connections are
tracked as a set per user id. Every outbound event is a JSON envelope:

    {"type": "message:new", "payload": {...}}

Fan-out is always *by user id* — routes resolve a conversation to its member
ids first. That keeps the hub free of database knowledge and makes it trivial
to swap for Redis pub/sub if this ever ran on more than one worker.
"""

from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from typing import Any, Iterable

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionHub:
    def __init__(self) -> None:
        self._connections: dict[int, set[WebSocket]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def connect(self, user_id: int, websocket: WebSocket) -> bool:
        """Register a socket. Returns True if this is the user's first one."""
        async with self._lock:
            was_offline = not self._connections[user_id]
            self._connections[user_id].add(websocket)
            return was_offline

    async def disconnect(self, user_id: int, websocket: WebSocket) -> bool:
        """Unregister a socket. Returns True if the user has none left."""
        async with self._lock:
            sockets = self._connections.get(user_id)
            if not sockets:
                return True
            sockets.discard(websocket)
            if not sockets:
                self._connections.pop(user_id, None)
                return True
            return False

    def is_online(self, user_id: int) -> bool:
        return bool(self._connections.get(user_id))

    def online_user_ids(self) -> list[int]:
        return list(self._connections.keys())

    async def send_to_user(self, user_id: int, event_type: str, payload: Any) -> None:
        sockets = list(self._connections.get(user_id, ()))
        if not sockets:
            return
        envelope = {"type": event_type, "payload": payload}
        dead: list[WebSocket] = []
        for socket in sockets:
            try:
                await socket.send_json(envelope)
            except Exception:  # client vanished mid-send
                dead.append(socket)
        for socket in dead:
            await self.disconnect(user_id, socket)

    async def broadcast(
        self,
        user_ids: Iterable[int],
        event_type: str,
        payload: Any,
        exclude_user_id: int | None = None,
    ) -> None:
        targets = {uid for uid in user_ids if uid != exclude_user_id}
        await asyncio.gather(
            *(self.send_to_user(uid, event_type, payload) for uid in targets),
            return_exceptions=True,
        )


hub = ConnectionHub()
