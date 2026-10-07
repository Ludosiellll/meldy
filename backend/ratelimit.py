"""Shared rate limiter for main.py and the router modules.

Every module decorates its routes with this one ``limiter`` object, so turning
it off (``main.limiter.enabled = False`` in tests) turns off every limit, and
the 429 answer has the same Russian JSON body everywhere.
"""
import ipaddress
import time

from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

RATE_LIMIT_DETAIL = "Слишком много запросов. Подождите минуту и повторите."
# Дневные потолки бесплатных вызовов модели (быстрая проверка ответа, распознавание голоса, озвучка,
# раздел заново): ждать минуту бесполезно.
RATE_LIMIT_DAY_DETAIL = "На сегодня предел этой функции исчерпан — он обновится завтра."
RATE_LIMIT_HOUR_DETAIL = "Слишком много запросов за час. Подождите немного и повторите."

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


def _address(value: str) -> str | None:
    """One X-Forwarded-For entry as an IP address (a port after it dropped), or None (a name, «unknown», garbage)."""
    text = value.strip()
    if text.startswith("[") and "]" in text:
        text = text[1:text.index("]")]  # [2001:db8::1]:443
    elif text.count(":") == 1:
        text = text.split(":", 1)[0]  # 203.0.113.5:443
    try:
        return str(ipaddress.ip_address(text))
    except ValueError:
        return None


def visitor_ip(request: Request) -> str:
    """The visitor's own address behind the Hugging Face proxy, for limits of paths open without an account.

    On the Space (checked 2026-10-07 against a public httpbin Space) the HF proxy puts the visitor's
    address last in X-Forwarded-For — whatever the visitor sent stays to its left — and the container's
    nginx appends the proxy's own address after it ($proxy_add_x_forwarded_for). uvicorn trusts nginx
    and takes that last address, the HF proxy, which is the same for every visitor
    (get_remote_address). So the visitor is the address before the last. A request with one address
    came without the HF proxy (nginx run locally): that address. No usable address — the connection's.
    """
    raw = ",".join(request.headers.getlist("x-forwarded-for"))
    entries = [entry for entry in (part.strip() for part in raw.split(",")) if entry]
    if entries:
        found = _address(entries[-2] if len(entries) >= 2 else entries[-1])
        if found is not None:
            return found
    return get_remote_address(request)


def visitor_ip_key(request: Request) -> str:
    """Rate-limit key of a visitor without an account: their address (visitor_ip); an IPv6 address by its
    /64 network, which one home or phone usually gets whole."""
    address = visitor_ip(request)
    try:
        parsed = ipaddress.ip_address(address)
    except ValueError:
        return f"visitor:{address}"
    if parsed.version == 6 and parsed.ipv4_mapped is not None:
        parsed = parsed.ipv4_mapped
    if parsed.version == 6:
        return f"visitor:{ipaddress.ip_network(f'{parsed}/64', strict=False)}"
    return f"visitor:{parsed}"


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


def _detail_for(exc: RateLimitExceeded) -> str:
    """The detail for the window that was exceeded (minute — the default text)."""
    try:
        granularity = exc.limit.limit.GRANULARITY.name
    except AttributeError:
        return RATE_LIMIT_DETAIL
    if granularity in ("day", "month", "year"):
        return RATE_LIMIT_DAY_DETAIL
    if granularity == "hour":
        return RATE_LIMIT_HOUR_DETAIL
    return RATE_LIMIT_DETAIL


def rate_limit_exceeded_handler(request: Request, exc: RateLimitExceeded) -> Response:
    """429 with a plain Russian ``detail`` (slowapi's default body has none); a spent day or hour
    says so instead of «подождите минуту»."""
    response = JSONResponse({"detail": _detail_for(exc)}, status_code=429)
    active = getattr(request.app.state, "limiter", None) or limiter
    try:
        response = active._inject_headers(response, getattr(request.state, "view_rate_limit", None))
    except Exception:
        pass
    if "retry-after" not in response.headers:
        seconds = _retry_after_seconds(request)
        response.headers["Retry-After"] = str(seconds if seconds is not None else 60)
    return response
