"""Замер задержек «Ответа вслух» для ворот 3 плана хакатона.

Инструмент владельца: запускается на своём компьютере против работающего сервера Meldy
и ничего не пишет в базу. Делает 20 запросов POST /api/oral/check и 10 запросов
POST /api/oral/evaluate подряд на постоянном синтетическом эталоне (демо-лекция о том,
как обучается нейронная сеть) и печатает p50/p95 против порогов: быстрая проверка —
1,5 с (столько ждёт браузер перед переспросом), протокол — 8 с.

    MELDY_TOKEN=<access token> python backend/scripts/oral_latency_probe.py https://<адрес-сайта> [--json]

Токен — access_token вошедшего пользователя. В консоли открытого сайта Meldy:
    JSON.parse(localStorage.getItem('sb-<ref>-auth-token')).access_token

Каждый запрос уникален: в конец ответа студента дописана метка «(замер <номер запуска>,
запрос N)», номер запуска случайный. Кэш процесса сервера (BaseAgent) хранит ответы по
точному тексту запроса, поэтому ни один замер не отдаётся из кэша — ни внутри серии, ни
при повторном запуске скрипта; перезапускать сервер с AI_CACHE_DISABLED=1 не нужно.
Отдельно отмечаются ответы быстрее четверти медианы своей серии: такой разброс значит,
что часть ответов пришла не от модели. Печатается и самый долгий запрос серии.
Лимиты сервера: /check 40 в минуту, /evaluate 10 в минуту — замер в них укладывается.

Код выхода: 0 — оба порога пройдены и ошибок нет, 1 — порог не пройден или были ошибки,
2 — ошибка ввода, токена или сети.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import secrets
import sys
import time
from typing import Any, Callable, Iterable

CHECK_TARGET_SECONDS = 1.5
EVALUATE_TARGET_SECONDS = 8.0
CHECK_RUNS = 20
EVALUATE_RUNS = 10
REQUEST_TIMEOUT_SECONDS = 30.0
CACHE_SUSPECT_SHARE = 0.25  # ответ быстрее четверти медианы серии — похоже, не от модели

QUESTION = "Как обучается нейронная сеть?"
POINTS = [
    {"id": "p1", "title": "Обучение — подбор весов, минимизирующих функцию потерь", "essential": True,
     "source_quote": "Обучение сети заключается в подборе весов, минимизирующих функцию потерь"},
    {"id": "p2", "title": "Прямой проход: данные проходят слои, сеть выдаёт предсказание", "essential": True,
     "source_quote": "данные подаются на вход, проходят через все слои, и сеть выдаёт предсказание"},
    {"id": "p3", "title": "Обратное распространение ошибки считает градиент по каждому весу", "essential": True,
     "source_quote": "градиент потерь по каждому весу распространяется от выходного слоя к входному"},
    {"id": "p4", "title": "Скорость обучения: маленькая — медленно, большая — осцилляции", "essential": True,
     "source_quote": "Маленькая скорость обеспечивает стабильность, но замедляет сходимость; большая ускоряет обучение, но может вызвать осцилляции"},
    {"id": "p5", "title": "Adam адаптирует скорость обучения для каждого параметра", "essential": False,
     "source_quote": "Оптимизаторы Adam и RMSProp адаптируют скорость обучения для каждого параметра индивидуально"},
]
TRANSCRIPT = (
    "Обучение это подбор весов которые минимизируют функцию потерь сначала прямой проход данные проходят "
    "через слои и сеть выдаёт предсказание потом обратное распространение ошибки по правилу производной "
    "сложной функции считаем градиент по каждому весу а оптимизаторы вроде адам работают для каждого "
    "параметра отдельно"
)


def percentile(values: Iterable[float], p: float) -> float | None:
    """p-й процентиль (0..100) с линейной интерполяцией между соседними рангами; None для пустого ряда."""
    if not 0 <= p <= 100:
        raise ValueError("p must be between 0 and 100")
    data = sorted(float(value) for value in values)
    if not data:
        return None
    rank = (len(data) - 1) * p / 100
    low, high = math.floor(rank), math.ceil(rank)
    if low == high:
        return data[low]
    return data[low] + (data[high] - data[low]) * (rank - low)


def new_run_id() -> str:
    """Случайный номер запуска: повторный запуск скрипта тоже не попадает в кэш сервера."""
    return secrets.token_hex(4)


def transcript_for(run_id: str, index: int) -> str:
    """Ответ студента с меткой запроса: у каждого запроса свой текст, кэш сервера его не знает."""
    return f"{TRANSCRIPT} (замер {run_id}, запрос {index + 1})"


def check_body(run_id: str = "local", index: int = 0) -> dict:
    return {
        "question": QUESTION,
        "points": [{"id": p["id"], "title": p["title"], "essential": p["essential"]} for p in POINTS],
        "transcript": transcript_for(run_id, index),
        "only": None,
        "followup_question": None,
    }


def evaluate_body(run_id: str = "local", index: int = 0) -> dict:
    return {"question": QUESTION, "points": [dict(point) for point in POINTS], "transcript": transcript_for(run_id, index)}


def summarize(samples: list[tuple[int | None, float]], target: float) -> dict:
    """Сводка серии: p50/p95 по успешным ответам, ошибки по кодам, подозрительно быстрые ответы,
    самый долгий запрос (номер в серии с 1), вывод."""
    ok = [seconds for status, seconds in samples if status == 200]
    errors: dict[str, int] = {}
    for status, _ in samples:
        if status != 200:
            label = "network" if status is None else str(status)
            errors[label] = errors.get(label, 0) + 1
    p50, p95 = percentile(ok, 50), percentile(ok, 95)
    slowest = max(range(len(samples)), key=lambda i: samples[i][1]) if samples else None
    return {
        "n": len(samples),
        "ok": len(ok),
        "p50_s": None if p50 is None else round(p50, 3),
        "p95_s": None if p95 is None else round(p95, 3),
        "max_s": None if slowest is None else round(samples[slowest][1], 3),
        "slowest_run": None if slowest is None else slowest + 1,
        "target_s": target,
        "errors": errors,
        "cache_suspect": 0 if p50 is None else sum(1 for seconds in ok if seconds < CACHE_SUSPECT_SHARE * p50),
        "passed": bool(ok) and not errors and p95 is not None and p95 <= target,
    }


def _series(client: Any, path: str, make_body: Callable[[int], dict], runs: int) -> list[tuple[int | None, float]]:
    import httpx

    samples: list[tuple[int | None, float]] = []
    for index in range(runs):
        body = make_body(index)
        started = time.perf_counter()
        try:
            response = client.post(path, json=body)
            status: int | None = response.status_code
        except httpx.HTTPError:
            status = None
        samples.append((status, time.perf_counter() - started))
        if status == 401:
            raise PermissionError("token rejected")
    return samples


def _line(name: str, summary: dict) -> str:
    def seconds(value: float | None) -> str:
        return "—" if value is None else f"{value:.2f} с".replace(".", ",")

    verdict = "пройдено" if summary["passed"] else "не пройдено"
    text = (
        f"{name}: {summary['ok']} из {summary['n']} успешно, p50 {seconds(summary['p50_s'])}, "
        f"p95 {seconds(summary['p95_s'])} (порог p95 {seconds(summary['target_s'])}) — {verdict}"
    )
    if summary["slowest_run"] is not None:
        text += f". Самый долгий — запрос {summary['slowest_run']}: {seconds(summary['max_s'])}"
    if summary["errors"]:
        text += ". Ошибки: " + ", ".join(f"{code} × {count}" for code, count in sorted(summary["errors"].items()))
    if summary["cache_suspect"]:
        text += (
            f". Быстрее четверти медианы: {summary['cache_suspect']} — такие ответы, похоже, пришли не от модели; "
            "проверьте, нет ли кэша между скриптом и сервером"
        )
    return text


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Замер задержек /api/oral/check и /api/oral/evaluate (ворота 3).")
    parser.add_argument("base_url", help="адрес сервера, например https://<space>.hf.space")
    parser.add_argument("--check", type=int, default=CHECK_RUNS, help="сколько запросов /check (по умолчанию 20)")
    parser.add_argument("--evaluate", type=int, default=EVALUATE_RUNS, help="сколько запросов /evaluate (по умолчанию 10)")
    parser.add_argument("--json", action="store_true", help="напечатать сводку в JSON")
    args = parser.parse_args(argv)

    token = os.environ.get("MELDY_TOKEN", "").strip()
    if not token:
        print("Нет токена: задайте переменную окружения MELDY_TOKEN (access_token вошедшего пользователя).", file=sys.stderr)
        return 2
    if args.check < 1 or args.evaluate < 1:
        print("Число запросов должно быть не меньше 1.", file=sys.stderr)
        return 2
    if not args.base_url.startswith(("http://", "https://")):
        print("Адрес сервера должен начинаться с http:// или https://.", file=sys.stderr)
        return 2

    import httpx

    headers = {"Authorization": f"Bearer {token}"}
    run_id = new_run_id()
    try:
        with httpx.Client(base_url=args.base_url.rstrip("/"), headers=headers, timeout=REQUEST_TIMEOUT_SECONDS) as client:
            check = summarize(
                _series(client, "/api/oral/check", lambda index: check_body(run_id, index), args.check),
                CHECK_TARGET_SECONDS,
            )
            evaluate = summarize(
                _series(client, "/api/oral/evaluate", lambda index: evaluate_body(run_id, index), args.evaluate),
                EVALUATE_TARGET_SECONDS,
            )
    except PermissionError:
        print("Сервер не принял токен (401). Возьмите свежий access_token.", file=sys.stderr)
        return 2
    except (httpx.InvalidURL, httpx.UnsupportedProtocol):
        print("Неверный адрес сервера.", file=sys.stderr)
        return 2

    report = {"base_url": args.base_url, "run_id": run_id, "check": check, "evaluate": evaluate}
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(_line("Быстрая проверка /api/oral/check", check))
        print(_line("Протокол /api/oral/evaluate", evaluate))
    return 0 if check["passed"] and evaluate["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
