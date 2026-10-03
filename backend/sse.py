"""Server-sent events helpers shared by the analysis, mapping and other streams."""
import asyncio
import json
import os
from typing import Any, AsyncIterable, AsyncIterator

KEEPALIVE = ": keepalive\n\n"
SSE_HEADERS = {"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"}

_DEFAULT_KEEPALIVE_SECONDS = 15.0

# Source tasks whose cleanup outlives the consumer (see with_keepalive). The event loop
# keeps only weak references to tasks, so these strong ones last until each task ends.
_CLOSING_SOURCES: set[asyncio.Task] = set()


def sse_event(obj: Any) -> str:
    """One SSE data frame: ``data: <json>`` and a blank line."""
    payload = json.dumps(obj, ensure_ascii=False)
    try:
        payload.encode("utf-8")
    except UnicodeEncodeError:
        # A lone surrogate (e.g. from a broken PDF text layer) cannot be sent as UTF-8;
        # escaped JSON carries it without breaking the stream.
        payload = json.dumps(obj)
    return f"data: {payload}\n\n"


def keepalive_seconds() -> float:
    """SSE_KEEPALIVE_SECONDS, read at call time (tests shorten it)."""
    try:
        value = float(os.getenv("SSE_KEEPALIVE_SECONDS", str(_DEFAULT_KEEPALIVE_SECONDS)))
    except ValueError:
        return _DEFAULT_KEEPALIVE_SECONDS
    return value if value > 0 else _DEFAULT_KEEPALIVE_SECONDS


async def with_keepalive(source: AsyncIterable[str], interval: float | None = None) -> AsyncIterator[str]:
    """Pass the items of ``source`` through in order; send KEEPALIVE while it is silent.

    The source runs inside one background task for its whole life, so a source
    that keeps a task group, a timeout or a lock across its own ``yield``s works
    unchanged. Closing this generator (``aclose()``, client disconnect) cancels
    that task, which closes the source and runs its ``finally`` blocks to the
    end: the cleanup is shielded from further cancels of the consumer (after a
    disconnect Starlette's task group re-sends the cancel on every loop pass),
    and when the consumer stops waiting it finishes in the background. An
    exception raised by the source is re-raised here after the items before it.
    ``interval`` defaults to SSE_KEEPALIVE_SECONDS (15 s), read at call time.
    """
    wait_seconds = keepalive_seconds() if interval is None else max(0.001, float(interval))
    queue: asyncio.Queue = asyncio.Queue(maxsize=1)
    consumer_gone = False

    async def pump() -> None:
        iterator = source.__aiter__()
        try:
            while True:
                try:
                    message = ("item", await iterator.__anext__())
                except StopAsyncIteration:
                    message = ("done", None)
                except Exception as exc:  # the consumer re-raises it in order
                    message = ("error", exc)
                if consumer_gone:
                    return  # nobody reads the queue any more: never wait on it
                await queue.put(message)
                if message[0] != "item":
                    return
        finally:
            aclose = getattr(iterator, "aclose", None)
            if aclose is not None:
                try:
                    await aclose()
                except Exception:
                    pass

    task = asyncio.ensure_future(pump())
    getter: asyncio.Future | None = None
    try:
        while True:
            if getter is None:
                getter = asyncio.ensure_future(queue.get())
            done, _ = await asyncio.wait({getter, task}, timeout=wait_seconds, return_when=asyncio.FIRST_COMPLETED)
            if not done:
                yield KEEPALIVE
                continue
            if getter not in done:
                # The pump finished; its last message may still be on its way.
                if queue.empty() and not getter.done():
                    exc = task.exception() if not task.cancelled() else None
                    if exc is not None:
                        raise exc
                    return
                continue
            kind, value = getter.result()
            getter = None
            if kind == "item":
                yield value
            elif kind == "error":
                raise value
            else:
                return
    finally:
        consumer_gone = True
        if getter is not None and not getter.done():
            getter.cancel()
        if not task.done():
            task.cancel()
            _CLOSING_SOURCES.add(task)
            task.add_done_callback(_CLOSING_SOURCES.discard)
            try:
                # Shielded: cancelling this consumer again must not cancel the cleanup.
                await asyncio.shield(task)
            except BaseException:
                pass
