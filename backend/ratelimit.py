"""Shared rate limiter for main.py and the router modules.

Every module decorates its routes with this one ``limiter`` object, so turning
it off (``main.limiter.enabled = False`` in tests) turns off every limit, and
the 429 answer has the same Russian JSON body everywhere.
"""
import time

from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

RATE_LIMIT_DETAIL = "Слишком много запросов. Подождите минуту и повторите."

limiter = Limiter(key_func=get_remote_address)


def user_or_ip_key(request: Request) -> str:
    """Rate-limit key: the signed-in user when the auth middleware set one, else the IP.

    Students behind one school NAT or the hosting proxy share an IP, so per-IP
    limits would throttle a whole class (or every visitor behind the HF proxy).
    """
    user = getattr(request.state, "user", None)
    if isinstance(user, dict) and user.get("id"):
        return f"user:{user['id']}"
    return get_remote_address(request)


def _retry_after_seconds(request: Request) -> int | None:
    """Seconds until the exceeded window resets, when the limiter can tell."""
    current = getattr(request.state, "view_rate_limit", None)
    active = getattr(request.app.state, "limiter", None) or limiter
    if not current:
        return None
    try:
        reset_at, _remaining = active.limiter.get_window_stats(current[0], *current[1])
        return max(1, int(reset_at - time.time()) + 1)
    except Exception:
        return None


def rate_limit_exceeded_handler(request: Request, exc: RateLimitExceeded) -> Response:
    """429 with a plain Russian ``detail`` (slowapi's default body has none)."""
    response = JSONResponse({"detail": RATE_LIMIT_DETAIL}, status_code=429)
    active = getattr(request.app.state, "limiter", None) or limiter
    try:
        response = active._inject_headers(response, getattr(request.state, "view_rate_limit", None))
    except Exception:
        pass
    if "retry-after" not in response.headers:
        seconds = _retry_after_seconds(request)
        response.headers["Retry-After"] = str(seconds if seconds is not None else 60)
    return response
