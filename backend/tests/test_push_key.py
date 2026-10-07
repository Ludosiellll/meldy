"""The VAPID public key comes from the server (push_router GET /api/push/key): rotating keys needs no build.

The key is public by design, so the route is open without a session (main.PUBLIC_API_PATHS): the rotation workflow
(.github/workflows/rotate-vapid.yml) reads it after the Space restarts. The private half never leaves the server.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import push_router  # noqa: E402


@pytest.fixture
def client(monkeypatch):
    import main
    from fastapi.testclient import TestClient

    async def no_session(request):
        raise AssertionError("/api/push/key must not ask for a session")

    monkeypatch.setattr(main, "require_authenticated_user", no_session)
    return TestClient(main.app)


def test_the_key_is_given_without_a_session_and_says_whether_pushes_can_be_signed(client, monkeypatch):
    monkeypatch.setattr(push_router, "VAPID_PUBLIC_KEY", "BNewPublicKey")
    monkeypatch.setattr(push_router, "VAPID_PRIVATE_KEY", "")
    assert client.get("/api/push/key").json() == {"public_key": "BNewPublicKey", "configured": False}
    monkeypatch.setattr(push_router, "VAPID_PRIVATE_KEY", "private-pair")
    body = client.get("/api/push/key").json()
    assert body == {"public_key": "BNewPublicKey", "configured": True} and "private-pair" not in str(body)


def test_no_key_is_made_up_when_the_space_has_none(client, monkeypatch):
    # No default: the old built-in public key's private pair was in the Git history.
    monkeypatch.setattr(push_router, "VAPID_PUBLIC_KEY", "")
    monkeypatch.setattr(push_router, "VAPID_PRIVATE_KEY", "private-pair")
    assert client.get("/api/push/key").json() == {"public_key": None, "configured": False}


def test_the_module_has_no_built_in_public_key(monkeypatch):
    import importlib

    monkeypatch.delenv("VAPID_PUBLIC_KEY", raising=False)
    monkeypatch.delenv("VAPID_PRIVATE_KEY", raising=False)
    fresh = importlib.reload(push_router)
    try:
        assert fresh.VAPID_PUBLIC_KEY == "" and fresh.VAPID_PRIVATE_KEY == ""
    finally:
        importlib.reload(push_router)


def test_subscribing_still_needs_a_session(monkeypatch):
    import main
    from fastapi.testclient import TestClient

    async def refuse(request):
        from fastapi import HTTPException

        raise HTTPException(status_code=401, detail="Требуется войти в аккаунт")

    monkeypatch.setattr(main, "require_authenticated_user", refuse)
    response = TestClient(main.app).post("/api/push/subscribe", json={"user_id": "x", "subscription": {}})
    assert response.status_code == 401
