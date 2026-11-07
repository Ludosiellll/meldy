"""SEC-3 (audit 07.11): a page fetched for «Разобрать лекцию» by link is read up to PAGE_MAX_BYTES and within
PAGE_DEADLINE_S — an endless body no longer fills the Space's memory."""
import asyncio
from types import SimpleNamespace

import pytest

import utils


class Endless:
    """A streamed response: `chunks` pieces of 64 KB (None — without end), counted as they are read."""

    def __init__(self, status=200, headers=None, chunks=None, piece=b"<p>" + b"a" * 65530 + b"</p>"):
        self.status_code = status
        self.headers = headers or {}
        self.encoding = "utf-8"
        self.read = 0
        self.chunks = chunks
        self.piece = piece

    async def aiter_bytes(self):
        n = 0
        while self.chunks is None or n < self.chunks:
            n += 1
            self.read += len(self.piece)
            yield self.piece


class Client:
    def __init__(self, responses):
        self.responses = responses
        self.streamed = []

    def stream(self, method, url, **kwargs):
        response = self.responses[url]
        self.streamed.append(url)

        class Ctx:
            async def __aenter__(self_inner):
                return response

            async def __aexit__(self_inner, *args):
                return False

        return Ctx()


@pytest.fixture
def public(monkeypatch):
    async def ok(url):
        return None

    monkeypatch.setattr(utils, "_assert_public_target", ok)


def test_an_endless_page_is_cut_at_the_cap(public):
    page = Endless(chunks=None)
    client = Client({"https://example.org/x": page})
    response = asyncio.run(utils._get_public_response(client, "https://example.org/x"))
    assert response.status_code == 200
    assert len(response.text.encode()) <= utils.PAGE_MAX_BYTES
    # It stopped reading right after the cap, not at the end of the stream.
    assert page.read <= utils.PAGE_MAX_BYTES + len(page.piece)


def test_a_normal_page_is_read_whole(public):
    page = Endless(chunks=3)
    client = Client({"https://example.org/y": page})
    response = asyncio.run(utils._get_public_response(client, "https://example.org/y"))
    assert response.text == (page.piece * 3).decode()


def test_a_redirect_is_followed_without_reading_its_body(public):
    hop = Endless(status=302, headers={"location": "/z"}, chunks=None)
    end = Endless(chunks=1)
    client = Client({"https://example.org/y": hop, "https://example.org/z": end})
    response = asyncio.run(utils._get_public_response(client, "https://example.org/y"))
    assert response.status_code == 200 and hop.read == 0
    assert client.streamed == ["https://example.org/y", "https://example.org/z"]


def test_a_slow_page_stops_at_the_deadline(public, monkeypatch):
    monkeypatch.setattr(utils, "PAGE_DEADLINE_S", 0.2)

    class Slow(Endless):
        async def aiter_bytes(self):
            while True:
                await asyncio.sleep(0.05)
                yield b"a"

    client = Client({"https://example.org/s": Slow()})
    with pytest.raises(ValueError):
        asyncio.run(utils._get_public_response(client, "https://example.org/s"))
