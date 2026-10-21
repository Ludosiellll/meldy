"""Game modes on top of a movement room (docs/live/MOVE.md §8).

A room without a mode is the bare movement sandbox. A mode brings its map, its ``RoomHooks`` (what happens each tick),
its own JSON messages and the link to the live game's state in the database. ``make_mode`` picks it from the game's
settings, as ``live_host_state`` returns them when the host's screen opens the room.

Modes: ``"stand"`` — A «Встань на ответ» (``live_move_stand.py``, docs/live/MODE_STAND.md). Mode B «Убеги от
Дедлайна» (``"run"``) will be a new module and one more branch in ``make_mode``.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Protocol

import live_move as lm

if TYPE_CHECKING:  # the api module imports this one
    from live_move_api import Conn, RoomRunner


class GameSource(Protocol):
    """The live game's database as a mode reads and writes it (``live_move_api.SupabaseGameSource``; a fake in tests).
    Both calls raise on a refusal or a network error (an exception with ``status`` when there is one)."""

    async def host_state(self, game_id: str, host_token: str, since_rev: int | None) -> dict[str, Any]: ...

    async def stand_close(self, game_id: str, host_token: str, qi: int, answers: list[dict[str, Any]]) -> dict[str, Any]: ...


class Mode:
    """One per room. The runner calls these; everything else is the mode's own business."""

    kind = ""
    hooks: lm.RoomHooks

    def game_map(self) -> lm.GameMap | None:
        """The map the room starts with (None: the reference map)."""
        return None

    def attach(self, room: lm.Room) -> None:
        """The room exists (its hooks are this mode's)."""

    def start(self) -> None:
        """The room's tick task runs: start the mode's own tasks."""

    def stop(self) -> None:
        """The room closed: cancel the mode's tasks."""

    def on_join(self, conn: "Conn") -> None:
        """A socket got its welcome (a new player, a reconnect or a host screen): send it the mode's picture."""

    def on_command(self, conn: "Conn", op: Any, obj: dict[str, Any]) -> bool:
        """A host command; True when the mode handled it (the default handling is skipped)."""
        return False


def make_mode(host_state: dict[str, Any] | None, runner: "RoomRunner", source: GameSource) -> Mode | None:
    """The mode of this live game, or None for the plain room. ``host_state``: the host's ``live_host_state`` at the
    room's opening (its ``settings.mode``)."""
    settings = (host_state or {}).get("settings") or {}
    mode = settings.get("mode") if isinstance(settings, dict) else None
    if mode == "stand":
        from live_move_stand import StandMode

        return StandMode(runner, host_state or {}, source)
    # Mode B «Убеги от Дедлайна» ("run") goes here.
    return None
