import os
import json
from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel
from typing import Dict, Any
from pywebpush import webpush, WebPushException

router = APIRouter()

# Both set on the Space by .github/workflows/rotate-vapid.yml (the private key as a secret). No default public key:
# the old one's private pair was in the Git history, and a public key without its pair signs nothing.
VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY", "").strip()
VAPID_PUBLIC_KEY = os.getenv("VAPID_PUBLIC_KEY", "").strip()
VAPID_CLAIMS = {"sub": os.getenv("VAPID_CLAIMS_SUB", "mailto:admin@studyforge.local")}

SUBSCRIPTIONS_FILE = "subscriptions.json"

class PushSubscription(BaseModel):
    user_id: str
    subscription: Dict[str, Any]

def load_subscriptions():
    if os.path.exists(SUBSCRIPTIONS_FILE):
        with open(SUBSCRIPTIONS_FILE, "r") as f:
            try:
                return json.load(f)
            except:
                pass
    return {}

def save_subscriptions(subs):
    with open(SUBSCRIPTIONS_FILE, "w") as f:
        json.dump(subs, f)

def _authenticated_user_id(request: Request) -> str:
    user = getattr(request.state, "user", None) or {}
    user_id = user.get("id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Требуется войти в аккаунт")
    return user_id


@router.get("/key")
async def push_key():
    """The VAPID public key the browser subscribes with: set on the Space (VAPID_PUBLIC_KEY, with its private
    pair VAPID_PRIVATE_KEY), so rotating the keys needs no new build. Open without a session (main.PUBLIC_API_PATHS):
    the key is public by design, and the rotation workflow checks it after the Space restarts. configured: both
    halves are set, so a subscription made with this key can be sent to."""
    return {"public_key": VAPID_PUBLIC_KEY or None, "configured": bool(VAPID_PRIVATE_KEY and VAPID_PUBLIC_KEY)}


@router.post("/subscribe")
async def subscribe(request: Request, sub: PushSubscription):
    user_id = _authenticated_user_id(request)
    subs = load_subscriptions()
    subs[user_id] = sub.subscription
    save_subscriptions(subs)
    return {"status": "ok"}

@router.post("/send")
async def send_notification(request: Request):
    if not VAPID_PRIVATE_KEY:
        raise HTTPException(status_code=503, detail="Push-уведомления не настроены")
    data = await request.json()
    user_id = _authenticated_user_id(request)
    message = data.get("message", "Время повторить материалы!")
    
    subs = load_subscriptions()
    if user_id not in subs:
        raise HTTPException(status_code=404, detail="Subscription not found")
        
    sub_info = subs[user_id]
    
    try:
        webpush(
            subscription_info=sub_info,
            data=json.dumps({"title": "Meldy", "body": message, "url": "/review"}),
            vapid_private_key=VAPID_PRIVATE_KEY,
            vapid_claims=VAPID_CLAIMS
        )
        return {"status": "sent"}
    except WebPushException as ex:
        print("WebPushException:", ex)
        if ex.response and ex.response.status_code == 410:
            del subs[user_id]
            save_subscriptions(subs)
        raise HTTPException(status_code=500, detail=str(ex))
