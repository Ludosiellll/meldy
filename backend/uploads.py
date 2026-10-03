"""Upload limits and the "is any AI provider configured" gate.

Router modules import these from here, never from ``main`` (that would be an
import cycle). Environment variables are read at call time.
"""
import os

from fastapi import HTTPException, UploadFile

AI_UNAVAILABLE_DETAIL = "Анализ временно недоступен. Попробуйте позже."

_DEFAULT_MAX_UPLOAD_BYTES = 15 * 1024 * 1024
_MIB = 1024 * 1024
_READ_CHUNK = 1024 * 1024


def max_upload_bytes() -> int:
    """MAX_UPLOAD_BYTES (default 15 MiB)."""
    raw = os.getenv("MAX_UPLOAD_BYTES", "").strip()
    try:
        value = int(raw) if raw else _DEFAULT_MAX_UPLOAD_BYTES
    except ValueError:
        return _DEFAULT_MAX_UPLOAD_BYTES
    return value if value > 0 else _DEFAULT_MAX_UPLOAD_BYTES


def _size_label(limit: int) -> str:
    if limit >= _MIB and limit % _MIB == 0:
        return f"{limit // _MIB} МБ"
    if limit >= _MIB // 10:
        return f"{limit / _MIB:.1f}".replace(".", ",") + " МБ"
    if limit >= 1024:
        return f"{limit // 1024} КБ"
    return f"{limit} байт"


def upload_too_large_detail(limit: int | None = None) -> str:
    return f"Файл слишком большой. Максимальный размер: {_size_label(limit or max_upload_bytes())}"


async def read_upload_with_limit(file: UploadFile) -> bytes:
    """Read an upload with a hard cap so one request cannot exhaust memory (413 above it)."""
    limit = max_upload_bytes()
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(_READ_CHUNK)
        if not chunk:
            break
        total += len(chunk)
        if total > limit:
            raise HTTPException(status_code=413, detail=upload_too_large_detail(limit))
        chunks.append(chunk)
    return b"".join(chunks)


def ai_configured() -> bool:
    """True when at least one AI provider key (Groq or Gemini) is set."""
    return bool(os.getenv("GROQ_API_KEY", "").strip() or os.getenv("GEMINI_API_KEY", "").strip())
