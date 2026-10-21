"""The real app (main.app) with the movement socket's token check mocked — for the local load test only.

    cd backend && LIVE_MOVE_LOAD=1 python -m uvicorn --app-dir scripts live_move_loadapp:app --host 127.0.0.1 --port 18001

Any game id is accepted with the host token ``"H" * 43``; a player token is any 43-char token starting with ``L``
(its player id is derived from it). Nothing reaches Supabase. Refuses to load without LIVE_MOVE_LOAD=1, so it can
never be the Space's app by accident.
"""
from __future__ import annotations

import asyncio
import hashlib
import os
import sys
import uuid
from pathlib import Path

if os.getenv("LIVE_MOVE_LOAD") != "1":
    raise SystemExit("live_move_loadapp is for the local load test only (set LIVE_MOVE_LOAD=1)")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import live_move_api  # noqa: E402
import main  # noqa: E402

HOST_TOKEN = "H" * 43


class LoadVerifier:
    async def verify(self, game_id: str, token: str, role: str) -> live_move_api.Identity:
        await asyncio.sleep(0.005)   # a token check is a round trip; Supabase's own time is not measured here
        if role == "host" and token == HOST_TOKEN:
            return live_move_api.Identity("host", None, "", None, "lobby")
        if role == "player" and token.startswith("L"):
            pid = str(uuid.UUID(bytes=hashlib.sha256(f"{game_id}:{token}".encode()).digest()[:16], version=4))
            return live_move_api.Identity("player", pid, "bot" + token[1:4], None, "lobby")
        raise live_move_api.Refused(live_move_api.CLOSE_BAD_TOKEN, "bad_token")


live_move_api.hub = live_move_api.Hub(verifier=LoadVerifier())
app = main.app
