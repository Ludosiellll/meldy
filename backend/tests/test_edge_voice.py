"""edge_voice: a stream goes to Microsoft's new host first; a host that refuses it hands this stream and the
next ones to the other host; an error in the middle of a stream keeps the host.

edge-tts is never reached: edge_tts.Communicate is a fake that answers by the address edge-tts would connect to
(edge_tts.communicate.WSS_URL when the stream starts).
"""
import asyncio
import importlib
import sys
import types
from pathlib import Path

import aiohttp
import pytest
import yarl
from multidict import CIMultiDict, CIMultiDictProxy

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import edge_voice  # noqa: E402
from edge_tts import communicate as edge_communicate  # noqa: E402
from edge_tts.constants import TRUSTED_CLIENT_TOKEN  # noqa: E402
from edge_tts.exceptions import NoAudioReceived, SkewAdjustmentError  # noqa: E402

NEW, OLD = edge_voice.NEW_HOST_URL, edge_voice.OLD_HOST_URL
NEW_HOST, OLD_HOST = "api.msedgeservices.com", "speech.platform.bing.com"
CLIP = b"ID3" + bytes(range(256)) * 8
TEXT, VOICE = "Спрос и предложение.", "ru-RU-DmitryNeural"


def handshake_refused(status: int) -> aiohttp.WSServerHandshakeError:
    request = aiohttp.RequestInfo(yarl.URL(NEW), "GET", CIMultiDictProxy(CIMultiDict()))
    return aiohttp.WSServerHandshakeError(request, (), status=status, message="Invalid response status")


def host_unreachable() -> aiohttp.ClientConnectorError:
    key = types.SimpleNamespace(host=NEW_HOST, port=443, ssl=True)
    return aiohttp.ClientConnectorDNSError(key, OSError(-2, "Name or service not known"))


class FakeService:
    """Answers by host. ok — the clip in two chunks; a number — the handshake refused with that status;
    unreachable — the host cannot be reached; no-date — a 403 without a date (edge-tts's SkewAdjustmentError);
    late-403 — some audio, then the next connection of a long text refused; drop — some audio, then the
    connection breaks; silent — no audio (NoAudioReceived)."""

    def __init__(self, new="ok", old="ok", pause=False):
        self.outcomes = {NEW: new, OLD: old}
        self.pause = pause
        self.streams = []

    def communicate(self):
        service = self
        unset = object()

        class Communicate:
            def __init__(self, text, voice, rate=unset):
                self.call = {"text": text, "voice": voice}
                if rate is not unset:
                    self.call["rate"] = rate

            async def stream(self):
                url = edge_communicate.WSS_URL
                service.streams.append({"host": edge_voice.host_of(url), **self.call})
                outcome = service.outcomes[url]
                if service.pause:
                    await asyncio.sleep(0)  # parallel streams all connect before the first answer
                if isinstance(outcome, int):
                    raise handshake_refused(outcome)
                if outcome == "unreachable":
                    raise host_unreachable()
                if outcome == "no-date":
                    raise SkewAdjustmentError("No server date in headers.") from handshake_refused(403)
                if outcome == "silent":
                    raise NoAudioReceived("No audio was received.")
                yield {"type": "WordBoundary", "offset": 1}
                yield {"type": "audio", "data": CLIP[:1000]}
                if outcome == "late-403":
                    raise handshake_refused(403)
                if outcome == "drop":
                    raise aiohttp.ServerDisconnectedError()
                yield {"type": "audio", "data": CLIP[1000:]}

        return Communicate


@pytest.fixture
def service(monkeypatch):
    """Every test starts on the new host, as the server does."""
    import edge_tts

    monkeypatch.setattr(edge_communicate, "WSS_URL", NEW)

    def install(**outcomes):
        fake = FakeService(**outcomes)
        monkeypatch.setattr(edge_tts, "Communicate", fake.communicate())
        return fake

    return install


def hosts(fake):
    return [stream["host"] for stream in fake.streams]


def synthesize(rate=None):
    return asyncio.run(edge_voice.synthesize(TEXT, VOICE, rate=rate))


def test_the_server_starts_on_the_new_host(monkeypatch):
    monkeypatch.setattr(edge_communicate, "WSS_URL", OLD)
    importlib.reload(edge_voice)
    assert edge_communicate.WSS_URL == NEW
    assert edge_voice.current_host() == NEW_HOST
    # The same client token, as the subscription key of the new host.
    assert NEW == f"wss://{NEW_HOST}/tts/cognitiveservices/websocket/v1?Ocp-Apim-Subscription-Key={TRUSTED_CLIENT_TOKEN}"
    assert edge_voice.host_of(OLD) == OLD_HOST


def test_a_stream_on_a_working_new_host_makes_one_connection(service):
    fake = service(new="ok", old=403)
    assert synthesize(rate="+20%") == CLIP
    assert fake.streams == [{"host": NEW_HOST, "text": TEXT, "voice": VOICE, "rate": "+20%"}]
    assert edge_communicate.WSS_URL == NEW


def test_without_a_rate_edge_tts_keeps_its_own(service):
    fake = service()
    assert synthesize() == CLIP
    assert fake.streams == [{"host": NEW_HOST, "text": TEXT, "voice": VOICE}]


def test_a_refused_new_host_hands_this_stream_and_the_next_ones_to_the_old_host(service, capsys):
    fake = service(new=403, old="ok")
    assert synthesize() == CLIP
    assert synthesize() == CLIP
    assert hosts(fake) == [NEW_HOST, OLD_HOST, OLD_HOST]
    assert edge_communicate.WSS_URL == OLD
    log = capsys.readouterr().out
    assert f"{NEW_HOST} did not take the stream (handshake 403); streams now go to {OLD_HOST}" in log
    assert TRUSTED_CLIENT_TOKEN not in log


def test_a_refused_old_host_hands_the_streams_back_to_the_new_host(service, monkeypatch):
    monkeypatch.setattr(edge_communicate, "WSS_URL", OLD)
    fake = service(new="ok", old=403)
    assert synthesize() == CLIP
    assert hosts(fake) == [OLD_HOST, NEW_HOST]
    assert edge_communicate.WSS_URL == NEW


@pytest.mark.parametrize("refusal", [404, 503, "unreachable", "no-date"])
def test_any_refused_handshake_or_unreachable_host_counts(service, refusal):
    fake = service(new=refusal, old="ok")
    assert synthesize() == CLIP
    assert hosts(fake) == [NEW_HOST, OLD_HOST]
    assert edge_communicate.WSS_URL == OLD


def test_audio_that_came_before_a_refusal_is_dropped(service):
    fake = service(new="late-403", old="ok")
    assert synthesize() == CLIP
    assert hosts(fake) == [NEW_HOST, OLD_HOST]


@pytest.mark.parametrize("failure, error", [("drop", aiohttp.ServerDisconnectedError), ("silent", NoAudioReceived)])
def test_an_error_in_the_middle_of_a_stream_keeps_the_host_for_the_callers_retries(service, failure, error):
    fake = service(new=failure, old="ok")
    with pytest.raises(error):
        synthesize()
    assert hosts(fake) == [NEW_HOST]
    assert edge_communicate.WSS_URL == NEW


def test_when_both_hosts_refuse_the_refusal_reaches_the_caller(service):
    fake = service(new=403, old=403)
    with pytest.raises(aiohttp.WSServerHandshakeError) as refused:
        synthesize()
    assert refused.value.status == 403
    # Each refusal moved the streams on: the next one starts again where this one started.
    assert hosts(fake) == [NEW_HOST, OLD_HOST]
    assert edge_communicate.WSS_URL == NEW


def test_parallel_refused_streams_move_the_host_once(service, monkeypatch, capsys):
    import edge_tts

    fake = FakeService(new=403, old="ok", pause=True)
    monkeypatch.setattr(edge_tts, "Communicate", fake.communicate())

    async def three_at_once():
        return await asyncio.gather(*(edge_voice.synthesize(TEXT, VOICE) for _ in range(3)))

    assert asyncio.run(three_at_once()) == [CLIP] * 3
    assert sorted(hosts(fake)) == sorted([NEW_HOST] * 3 + [OLD_HOST] * 3)
    assert edge_communicate.WSS_URL == OLD
    assert capsys.readouterr().out.count("did not take the stream") == 1


def test_api_tts_and_the_deep_health_check_both_go_through_it(service):
    import health_deep
    import main

    fake = service(new=403, old="ok")
    assert asyncio.run(main._synthesize_edge_tts(TEXT, VOICE)) == CLIP
    assert asyncio.run(health_deep.synthesize("Проверка", VOICE)) == CLIP
    assert fake.streams == [
        {"host": NEW_HOST, "text": TEXT, "voice": VOICE, "rate": main.TTS_RATE},
        {"host": OLD_HOST, "text": TEXT, "voice": VOICE, "rate": main.TTS_RATE},
        {"host": OLD_HOST, "text": "Проверка", "voice": VOICE},
    ]
