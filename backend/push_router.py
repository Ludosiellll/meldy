import os
import json
from pathlib import Path
from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel
from typing import Dict, Any
from pywebpush import webpush, WebPushException

router = APIRouter()

_private_key_path = Path(__file__).resolve().with_name("private_key.pem")
VAPID_PRIVATE_KEY = os.getenv(
    "VAPID_PRIVATE_KEY",
    _private_key_path.read_text(encoding="utf-8").strip() if _private_key_path.exists() else "",
)
VAPID_PUBLIC_KEY = os.getenv("VAPID_PUBLIC_KEY", "BEdVrUuTGrqZWpxNBc3tfNP0N4CtLzEAlH3U64D4WMKkfps-96rEJj6ntl2_2MnFzRNupEWQ1uzl4kBAcjrtRiQ")
VAPID_CLAIMS = {"sub": "mailto:admin@studyforge.local"}

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

@router.post("/subscribe")
async def subscribe(sub: PushSubscription):
    subs = load_subscriptions()
    subs[sub.user_id] = sub.subscription
    save_subscriptions(subs)
    return {"status": "ok"}

@router.post("/send")
async def send_notification(request: Request):
    data = await request.json()
    user_id = data.get("user_id")
    message = data.get("message", "Время повторить материалы!")
    
    subs = load_subscriptions()
    if user_id not in subs:
        raise HTTPException(status_code=404, detail="Subscription not found")
        
    sub_info = subs[user_id]
    
    try:
        webpush(
            subscription_info=sub_info,
            data=json.dumps({"title": "StudyForge", "body": message, "url": "/review"}),
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
