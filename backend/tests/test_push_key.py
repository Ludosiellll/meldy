"""The VAPID public key comes from the server (push_router GET /api/push/key): rotating keys needs no build."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import push_router  # noqa: E402


@pytest.fixture
def client(monkeypatch):
    import main
    from fastapi.testclient import TestClient

    async def fake_user(request):
        return {"id": "user-a"}

    monkeypatch.setattr(main, "require_authenticated_user", fake_user)
    return TestClient(main.app, headers={"Authorization": "Bearer token-a"})


def test_the_browser_gets_the_servers_public_key_and_whether_pushes_can_be_signed(client, monkeypatch):
    monkeypatch.setattr(push_router, "VAPID_PUBLIC_KEY", "BNewPublicKey")
    monkeypatch.setattr(push_router, "VAPID_PRIVATE_KEY", "")
    assert client.get("/api/push/key").json() == {"public_key": "BNewPublicKey", "configured": False}
    monkeypatch.setattr(push_router, "VAPID_PRIVATE_KEY", "private-pair")
    body = client.get("/api/push/key").json()
    assert body == {"public_key": "BNewPublicKey", "configured": True} and "private-pair" not in str(body)
