"""Edge's read-aloud voices (edge-tts) on whichever of Microsoft's two hosts takes the stream.

Microsoft is moving the read-aloud voices from speech.platform.bing.com to api.msedgeservices.com region by
region (edge-tts issue #490, from 2026-10-10). Where the move has happened, the old host refuses the WebSocket
handshake with 403 while its voice list still answers: this server lost every voice at about 02:51 UTC on
2026-10-12. edge-tts 7.2.8 knows only the old host. The new one takes the same client token as its
subscription key and, checked on 2026-10-12, speaks both Russian voices with edge-tts's own Sec-MS-GEC token.

So a stream goes to the new host first. A host that refuses the handshake (any status) or cannot be reached
hands this stream and every later one to the other host, so either host can go away without a release. An
error in the middle of a stream (a dropped connection, no audio, the time limit) is not a refusal: the host
stays, and the caller's own retries take it.

edge-tts reads the address from the module global ``edge_tts.communicate.WSS_URL`` when a stream connects, so
the choice is that global, shared by the whole process; a host changes only if the global still names the host
that refused, so streams that fail together move it once.
"""
from typing import Optional

import aiohttp
import edge_tts
from edge_tts import communicate as _communicate
from edge_tts.constants import TRUSTED_CLIENT_TOKEN, WSS_URL as OLD_HOST_URL

NEW_HOST_URL = (
    "wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1"
    f"?Ocp-Apim-Subscription-Key={TRUSTED_CLIENT_TOKEN}"
)
# In the order they are tried at start.
HOST_URLS = (NEW_HOST_URL, OLD_HOST_URL)

_communicate.WSS_URL = HOST_URLS[0]


def host_of(url: str) -> str:
    """The host name alone: the address also carries the client token, which stays out of the logs."""
    return url.split("/", 3)[2]


def current_host() -> str:
    return host_of(_communicate.WSS_URL)


def refused_by_host(exc: BaseException) -> bool:
    """The host did not take the stream: the handshake was refused, or the host could not be reached.

    edge-tts answers a 403 by adjusting its clock from the response and trying once more; without a date in the
    response it raises SkewAdjustmentError from the 403 instead, which is the same refusal.
    """
    refusals = (aiohttp.WSServerHandshakeError, aiohttp.ClientConnectorError)
    return isinstance(exc, refusals) or isinstance(exc.__cause__, aiohttp.WSServerHandshakeError)


def _reason(exc: BaseException) -> str:
    refusal = exc if isinstance(exc, aiohttp.WSServerHandshakeError) else exc.__cause__
    if isinstance(refusal, aiohttp.WSServerHandshakeError):
        return f"handshake {refusal.status}"
    return type(exc).__name__


def _move_from(url: str, exc: BaseException) -> None:
    """The next stream goes to the other host, unless a parallel stream has already moved it."""
    if _communicate.WSS_URL != url:
        return
    spare = HOST_URLS[1] if url == HOST_URLS[0] else HOST_URLS[0]
    _communicate.WSS_URL = spare
    print(f"Edge-TTS: {host_of(url)} did not take the stream ({_reason(exc)}); streams now go to {host_of(spare)}")


async def _stream(text: str, voice: str, rate: Optional[str]) -> bytes:
    communicate = edge_tts.Communicate(text, voice) if rate is None else edge_tts.Communicate(text, voice, rate=rate)
    chunks: list[bytes] = []
    async for chunk in communicate.stream():
        if chunk.get("type") == "audio" and chunk.get("data"):
            chunks.append(chunk["data"])
    return b"".join(chunks)


async def _stream_on_current_host(text: str, voice: str, rate: Optional[str]) -> bytes:
    url = _communicate.WSS_URL
    try:
        return await _stream(text, voice, rate)
    except Exception as exc:
        if refused_by_host(exc):
            _move_from(url, exc)
        raise


async def synthesize(text: str, voice: str, rate: Optional[str] = None) -> bytes:
    """The clip of ``text`` (mp3; empty when no audio came); a refused stream is tried once on the other host.

    Audio that came before a refusal (edge-tts streams a long text over several connections) is dropped: the
    other host speaks the whole text again.
    """
    try:
        return await _stream_on_current_host(text, voice, rate)
    except Exception as exc:
        if not refused_by_host(exc):
            raise
    return await _stream_on_current_host(text, voice, rate)
