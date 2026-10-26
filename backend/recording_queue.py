"""One long lecture recording is transcribed at a time; the others wait their turn (2026-10-26).

Why. Groq's free plan gives the whole site 20 transcription requests a minute and 7 200 s of audio an hour
(media_parser.py), and a long recording's pieces take all of it for minutes: two at once would only slow both down and
push the spoken answers of other people to the slower Gemini. So a recording longer than LONG_SECONDS waits until the
one before it is done, and the page hears where it is (main.event_stream_media sends the status lines). A shorter one
never waits.

Guards before any unit is charged (main.analyze_media): at most MAX_WAITING recordings wait, and one person has at most
one long recording waiting or in work. A recording still waiting after MAX_WAIT_SECONDS gives up with its units back.

One process serves the site (Dockerfile: one uvicorn worker), so the queue lives in its memory; a release starts it
empty, and the recordings it held end with their streams.
"""
from __future__ import annotations

import asyncio
import math
import time
from collections import deque
from typing import Callable, Optional

# Longer than this, a recording waits its turn; a shorter one goes at once.
LONG_SECONDS = 10 * 60
# Recordings that may wait at the same time; one more is refused before the charge.
MAX_WAITING = 4
# A recording that waited this long gives up (its units go back).
MAX_WAIT_SECONDS = 15 * 60
# Seconds of work per second of audio at 15 Groq requests a minute: 19 min 25 s took 2 min 10 s at 20 a minute
# (Tech_Map, 2026-10-12), which is 0.11; with a quarter fewer requests and the analysis after it, 0.15.
WORK_PER_AUDIO_SECOND = 0.15
# How often the page hears a waiting recording's place.
STATUS_EVERY_SECONDS = 10.0

WAIT_MESSAGE = "Сейчас Meldy распознаёт другую длинную запись. Ваша в очереди, начнём примерно через {minutes} мин."
FULL_MESSAGE = (
    "Сейчас Meldy распознаёт несколько длинных записей. Попробуйте через {minutes} мин — лимит не списан."
)
OWN_MESSAGE = "Ваша прошлая длинная запись ещё распознаётся. Дождитесь её, а потом загрузите следующую — лимит не списан."
TIMEOUT_MESSAGE = (
    "Очередь длинных записей не дошла до вашей за 15 минут. Попробуйте ещё раз позже — лимит не списан."
)


class Ticket:
    """One long recording's place: waiting until ``active`` is set, then in work until it leaves."""

    def __init__(self, seconds: float, owner: Optional[str]) -> None:
        self.seconds = max(0.0, float(seconds or 0))
        self.owner = owner
        self.started: Optional[float] = None
        self.joined: Optional[float] = None
        self._turn = asyncio.Event()

    @property
    def active(self) -> bool:
        return self._turn.is_set()

    async def wait_turn(self, timeout: float) -> bool:
        """True once it is this recording's turn; False after ``timeout`` seconds without it."""
        try:
            await asyncio.wait_for(self._turn.wait(), timeout)
        except (asyncio.TimeoutError, TimeoutError):
            return False
        return True


class RecordingQueue:
    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._active: Optional[Ticket] = None
        self._waiting: deque[Ticket] = deque()

    def _work(self, ticket: Ticket) -> float:
        return ticket.seconds * WORK_PER_AUDIO_SECOND

    def _active_left(self) -> float:
        if self._active is None:
            return 0.0
        spent = self._clock() - (self._active.started or self._clock())
        return max(0.0, self._work(self._active) - spent)

    def wait_seconds(self, ticket: Optional[Ticket] = None) -> float:
        """About how long until ``ticket``'s turn (None: until a newcomer's)."""
        total = self._active_left()
        for other in self._waiting:
            if other is ticket:
                break
            total += self._work(other)
        return total

    @staticmethod
    def minutes(seconds: float) -> int:
        return max(1, math.ceil(seconds / 60))

    def refusal(self, owner: Optional[str]) -> Optional[str]:
        """Why a new long recording cannot join now, or None. Checked before the charge."""
        if owner and any(ticket.owner == owner for ticket in self._tickets()):
            return OWN_MESSAGE
        if len(self._waiting) >= MAX_WAITING:
            return FULL_MESSAGE.format(minutes=self.minutes(self.wait_seconds()))
        return None

    def _tickets(self):
        if self._active is not None:
            yield self._active
        yield from self._waiting

    def join(self, seconds: float, owner: Optional[str] = None) -> Ticket:
        ticket = Ticket(seconds, owner)
        ticket.joined = self._clock()
        if self._active is None and not self._waiting:
            self._start(ticket)
        else:
            self._waiting.append(ticket)
        return ticket

    def _start(self, ticket: Ticket) -> None:
        self._active = ticket
        ticket.started = self._clock()
        ticket._turn.set()

    def leave(self, ticket: Ticket) -> None:
        """The recording is done, failed or its page is gone: its place goes to the next one."""
        if ticket is self._active:
            self._active = None
            if self._waiting:
                self._start(self._waiting.popleft())
        else:
            try:
                self._waiting.remove(ticket)
            except ValueError:
                pass

    def status(self, ticket: Ticket) -> str:
        return WAIT_MESSAGE.format(minutes=self.minutes(self.wait_seconds(ticket)))

    @property
    def waiting(self) -> int:
        return len(self._waiting)


QUEUE = RecordingQueue()
