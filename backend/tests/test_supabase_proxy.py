"""Запасной путь к Supabase (/sb/…, supabase_proxy.py): что уходит в Supabase и что возвращается.

Supabase — подменённый транспорт httpx (supabase_proxy._transport).
"""
import sys
from pathlib import Path

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import supabase_proxy  # noqa: E402

UPSTREAM = "https://proxy-test.supabase.invalid"


@pytest.fixture
def proxy(monkeypatch):
    import main
    from fastapi.testclient import TestClient

    monkeypatch.setenv("SUPABASE_URL", UPSTREAM)
    monkeypatch.setattr(main.limiter, "enabled", False)
    seen: list[httpx.Request] = []
    replies: dict = {"status": 200, "json": [{"id": 1}], "headers": {}}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if replies.get("fail"):
            raise httpx.ConnectError("down")
        return httpx.Response(replies["status"], json=replies["json"], headers=replies["headers"])

    monkeypatch.setattr(supabase_proxy, "_transport", httpx.MockTransport(handler))
    client = TestClient(main.app)
    client.seen, client.replies, client.main = seen, replies, main
    yield client


def test_a_rest_read_goes_to_the_project_with_its_raw_query_and_only_supabase_headers(proxy):
    proxy.replies["headers"] = {"Content-Range": "0-0/1", "Set-Cookie": "x=1", "Server": "cloudflare"}
    response = proxy.get(
        "/sb/rest/v1/materials?select=id,title&created_at=gte.2026-10-05T00:00:00%2B00:00&or=(a.eq.1,b.eq.2)",
        headers={"apikey": "anon", "Authorization": "Bearer user-token", "Cookie": "secret=1",
                 "Prefer": "count=exact", "X-Forwarded-For": "1.2.3.4"},
    )
    assert response.status_code == 200 and response.json() == [{"id": 1}]
    (sent,) = proxy.seen
    assert str(sent.url).startswith(f"{UPSTREAM}/rest/v1/materials?")
    assert sent.url.query.decode() == "select=id,title&created_at=gte.2026-10-05T00:00:00%2B00:00&or=(a.eq.1,b.eq.2)"
    assert sent.headers["apikey"] == "anon" and sent.headers["authorization"] == "Bearer user-token"
    assert sent.headers["prefer"] == "count=exact"
    assert "cookie" not in sent.headers and "x-forwarded-for" not in sent.headers
    assert response.headers["content-range"] == "0-0/1"
    assert "set-cookie" not in response.headers and response.headers.get("server") != "cloudflare"


def test_auth_and_writes_pass_their_method_and_body(proxy):
    proxy.replies.update(status=201, json={"access_token": "t"})
    response = proxy.post("/sb/auth/v1/token?grant_type=password", json={"email": "a@b.ru", "password": "p"},
                          headers={"apikey": "anon"})
    assert response.status_code == 201
    (sent,) = proxy.seen
    assert sent.method == "POST" and sent.url.path == "/auth/v1/token" and b'"email"' in sent.content
    proxy.patch("/sb/rest/v1/materials?id=eq.5", json={"title": "Новое"}, headers={"apikey": "anon"})
    assert proxy.seen[-1].method == "PATCH" and "Новое".encode() in proxy.seen[-1].content


@pytest.mark.parametrize("path", [
    "/sb/pg/meta/tables",           # не auth/rest/storage
    "/sb/functions/v1/anything",
    "/sb/rest/v1/%2e%2e/%2e%2e/pg", # выход из rest/v1
    "/sb/",
])
def test_only_auth_rest_and_storage_paths_are_passed(proxy, path):
    assert proxy.get(path).status_code == 404
    assert proxy.seen == []


def test_an_unreachable_supabase_is_a_plain_russian_502(proxy, capsys):
    proxy.replies["fail"] = True
    response = proxy.get("/sb/rest/v1/materials?select=id", headers={"apikey": "anon"})
    assert response.status_code == 502 and response.json()["message"] == supabase_proxy.UNREACHABLE_DETAIL
    assert "ConnectError" in capsys.readouterr().out


def test_the_way_needs_no_meldy_session_and_keys_its_limit_by_the_users_session(proxy):
    from starlette.requests import Request

    # Не под /api/: вход Meldy не нужен, права решают ключ и токен в самом запросе (RLS).
    assert proxy.get("/sb/rest/v1/materials?select=id").status_code == 200

    def key(headers):
        scope = {"type": "http", "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()],
                 "client": ("10.0.0.7", 1234)}
        return supabase_proxy._caller_key(Request(scope))

    signed_in = key({"apikey": "anon", "Authorization": "Bearer user-token"})
    assert signed_in.startswith("sb:") and "user-token" not in signed_in
    assert key({"apikey": "anon", "Authorization": "Bearer anon"}) == "sb-ip:10.0.0.7"  # аноним — по адресу
    assert key({}) == "sb-ip:10.0.0.7"
