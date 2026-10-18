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


def test_the_bots_file_link_is_the_one_function_passed_and_only_for_reading(proxy):
    proxy.replies["headers"] = {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": "attachment; filename*=UTF-8''bank.docx",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox",
        "Set-Cookie": "x=1",
    }
    response = proxy.get("/sb/functions/v1/telegram/file?t=" + "a" * 64 + "&forceFunctionRegion=eu-central-1")
    assert response.status_code == 200
    (sent,) = proxy.seen
    assert str(sent.url) == f"{UPSTREAM}/functions/v1/telegram/file?t={'a' * 64}&forceFunctionRegion=eu-central-1"
    assert sent.method == "GET"
    assert response.headers["content-disposition"].startswith("attachment")
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert "set-cookie" not in response.headers
    for method, path in (("post", "/sb/functions/v1/telegram/file?t=x"), ("get", "/sb/functions/v1/telegram"),
                         ("post", "/sb/functions/v1/telegram/tick"), ("get", "/sb/functions/v1/telegram/status"),
                         ("get", "/sb/functions/v1/telegram/file/../setup")):
        assert getattr(proxy, method)(path).status_code == 404, (method, path)
    assert len(proxy.seen) == 1


def test_the_mini_apps_sign_in_passes_as_post_only_with_the_users_headers(proxy):
    proxy.replies.update(json={"status": "linked", "token_hash": "b" * 56},
                         headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Set-Cookie": "x=1"})
    response = proxy.post("/sb/functions/v1/telegram/webapp/session?forceFunctionRegion=eu-central-1",
                          json={"init_data": "auth_date=1&hash=x"},
                          headers={"apikey": "anon", "Authorization": "Bearer user-token", "Origin": "https://evil.example",
                                   "x-client-info": "supabase-js-web/2"})
    assert response.status_code == 200 and response.json()["status"] == "linked"
    sent = proxy.seen[-1]
    assert str(sent.url) == f"{UPSTREAM}/functions/v1/telegram/webapp/session?forceFunctionRegion=eu-central-1"
    assert sent.method == "POST" and b'"init_data"' in sent.content
    assert sent.headers["authorization"] == "Bearer user-token" and sent.headers["apikey"] == "anon"
    # The page's Origin stays behind: the function serves a request without one (the site's own way).
    assert "origin" not in sent.headers
    assert response.headers["cache-control"] == "no-store" and "set-cookie" not in response.headers
    # No linking from the Mini App (security review 2026-10-11): /webapp/link does not pass, nor anything else there.
    for method, path in (("get", "/sb/functions/v1/telegram/webapp/session"), ("post", "/sb/functions/v1/telegram/webapp/link"),
                         ("put", "/sb/functions/v1/telegram/webapp/link"),
                         ("post", "/sb/functions/v1/telegram/webapp"), ("post", "/sb/functions/v1/telegram/webapp/other"),
                         ("post", "/sb/functions/v1/telegram/webapp/session/../../setup")):
        assert getattr(proxy, method)(path).status_code == 404, (method, path)
    assert len(proxy.seen) == 1


def test_a_guests_quiz_picture_passes_as_post_and_options_only(proxy, monkeypatch):
    picture = b"\x89PNG\r\n\x1a\n\x00\x01"

    def handler(request: httpx.Request) -> httpx.Response:
        proxy.seen.append(request)
        return httpx.Response(200, content=picture, headers={
            "Content-Type": "image/png", "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; sandbox", "Access-Control-Allow-Origin": "https://evil.example",
            "Set-Cookie": "x=1",
        })

    monkeypatch.setattr(supabase_proxy, "_transport", httpx.MockTransport(handler))
    body = {"attempt_id": "0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e", "token": "t" * 43, "path": "c/" + "a" * 64 + ".png"}
    response = proxy.post("/sb/functions/v1/quiz-media?forceFunctionRegion=eu-central-1", json=body,
                          headers={"apikey": "anon", "Authorization": "Bearer anon", "Origin": "https://evil.example",
                                   "Cookie": "secret=1"})
    assert response.status_code == 200 and response.content == picture
    sent = proxy.seen[-1]
    assert str(sent.url) == f"{UPSTREAM}/functions/v1/quiz-media?forceFunctionRegion=eu-central-1"
    assert sent.method == "POST" and b'"attempt_id"' in sent.content
    assert sent.headers["authorization"] == "Bearer anon" and sent.headers["apikey"] == "anon"
    assert "origin" not in sent.headers and "cookie" not in sent.headers
    assert response.headers["content-type"] == "image/png"
    assert response.headers["cache-control"] == "private, max-age=3600"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["content-security-policy"] == "default-src 'none'; sandbox"
    assert "set-cookie" not in response.headers and "access-control-allow-origin" not in response.headers

    # OPTIONS passes for this path (a plain one: the CORS middleware answers a browser's preflight itself).
    assert proxy.options("/sb/functions/v1/quiz-media").status_code == 200
    assert proxy.seen[-1].method == "OPTIONS" and len(proxy.seen) == 2
    # Nothing else of the function, and OPTIONS nowhere else.
    for method, path in (("get", "/sb/functions/v1/quiz-media"), ("put", "/sb/functions/v1/quiz-media"),
                         ("delete", "/sb/functions/v1/quiz-media"), ("post", "/sb/functions/v1/quiz-media/x"),
                         ("post", "/sb/functions/v1/quiz-media/../telegram/setup"), ("post", "/sb/functions/v1/quiz"),
                         ("options", "/sb/rest/v1/materials"), ("options", "/sb/storage/v1/object/test-item-images/x"),
                         ("options", "/sb/functions/v1/telegram/webapp/session")):
        assert getattr(proxy, method)(path).status_code == 404, (method, path)
    assert len(proxy.seen) == 2


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
