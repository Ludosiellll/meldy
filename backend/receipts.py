"""Квитанция анализа: какие основные разделы не получились в анализе какого текста — за подписью сервера.

Поток анализа (/api/analyze, /media, /url) кладёт её в событие results, если основной раздел не
получился; браузер хранит её в summary_json.receipt материала. «Создать … заново» бесплатно только
для раздела из квитанции своего материала и только по тексту, хеш которого в ней записан
(main._section_repair_text): строку materials владелец правит сам, а квитанцию без ключа сервера
не подделать (HMAC-SHA256).

Ключ — ANALYSIS_RECEIPT_KEY; без неё он выводится из ключей провайдеров ИИ (их знает только
сервер). Смена ключа делает прежние квитанции недействительными: починка тогда стоит как раздел.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from typing import Any, Iterable, Optional

VERSION = "r1"
# Длиннее — не квитанция сервера (у неё ~250 знаков): такую строку даже не разбираем.
MAX_LENGTH = 2000
_KEY_LABEL = b"meldy analysis receipt\0"


def _key() -> Optional[bytes]:
    explicit = os.getenv("ANALYSIS_RECEIPT_KEY", "").strip()
    if explicit:
        return hashlib.sha256(_KEY_LABEL + explicit.encode("utf-8")).digest()
    secrets = [os.getenv(name, "").strip() for name in ("GROQ_API_KEY", "GEMINI_API_KEY")]
    if not any(secrets):
        return None
    return hashlib.sha256(_KEY_LABEL + "\0".join(secrets).encode("utf-8")).digest()


def text_hash(text: str) -> str:
    """SHA-256 текста без различий в пробелах и переносах строк."""
    return hashlib.sha256(" ".join(text.split()).encode("utf-8", "surrogatepass")).hexdigest()


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _sign(key: bytes, signed: str) -> bytes:
    return hmac.new(key, signed.encode("ascii"), hashlib.sha256).digest()


def issue(user_id: Optional[str], text: str, failed: Iterable[str]) -> Optional[str]:
    """Квитанция владельцу user_id на текст text: разделы failed можно создать заново бесплатно.

    None — нет ключа, владельца или неудавшихся разделов.
    """
    key = _key()
    sections = sorted({name for name in failed if isinstance(name, str) and name})
    if key is None or not user_id or not sections:
        return None
    payload = {"u": user_id, "h": text_hash(text), "f": sections, "t": int(time.time())}
    body = _b64(json.dumps(payload, separators=(",", ":"), ensure_ascii=True).encode("ascii"))
    signed = f"{VERSION}.{body}"
    return f"{signed}.{_b64(_sign(key, signed))}"


def covers(receipt: Any, user_id: Optional[str], text: str, section: str) -> bool:
    """Выдал ли сервер эту квитанцию владельцу user_id на этот текст и есть ли в ней раздел."""
    key = _key()
    if key is None or not user_id or not isinstance(receipt, str) or len(receipt) > MAX_LENGTH:
        return False
    parts = receipt.split(".")
    if len(parts) != 3 or parts[0] != VERSION:
        return False
    try:
        if not hmac.compare_digest(_sign(key, f"{parts[0]}.{parts[1]}"), _unb64(parts[2])):
            return False
        payload = json.loads(_unb64(parts[1]))
    except (ValueError, UnicodeError):  # битый base64 или JSON
        return False
    failed = payload.get("f") if isinstance(payload, dict) else None
    return (
        isinstance(failed, list)
        and section in failed
        and payload.get("u") == user_id
        and payload.get("h") == text_hash(text)
    )
