"""Работа разбора в дочернем процессе (parse_child.py): ответ тот же, что в этом процессе; работа дольше своего
времени или больше своей памяти останавливается по-настоящему (процесс убит), stop() убивает сразу, ошибки работы
приходят как есть. Пределы в тестах — крошечные (доли секунды, десятки мегабайт)."""
import functools
import json
import os
import pickle
import sys
import threading
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import bank_api  # noqa: E402
import bank_parse  # noqa: E402
import child_work  # noqa: E402
import parse_child  # noqa: E402

pytestmark = pytest.mark.skipif(not parse_child.available(), reason="no fork server on this platform")

BACKEND = Path(__file__).resolve().parents[1]
FIXTURES = BACKEND / "tests" / "fixtures" / "banks"
CAP = 64 << 20


def job(work, seconds: float = 30, memory=CAP):
    return parse_child.Job(work, seconds=seconds, memory=memory)


def outcome(call):
    try:
        return json.dumps(call(), ensure_ascii=False)
    except bank_parse.BankError as exc:
        return ("BankError", exc.status, exc.code, exc.detail)


PICTURES = FIXTURES / "wild" / "files" / "w111_pictures.docx"
BANK_FILES = sorted([*FIXTURES.glob("*.docx"), *FIXTURES.glob("*.xlsx"), *FIXTURES.glob("*.txt"), PICTURES])


def test_a_file_parses_the_same_in_a_child_as_in_this_process():
    """Ответ из процесса — тот же JSON байт в байт (порядок ключей тоже), отказ — тот же BankError; картинки
    (with_pictures) приходят теми же байтами."""
    assert len(BANK_FILES) >= 25
    answers = {}
    for path in BANK_FILES:
        work = functools.partial(bank_parse.parse_bank_file, path.read_bytes(), path.name, with_pictures=True)
        answers[path] = outcome(job(work, memory=bank_api.PARSE_MEMORY_BYTES).run)
        assert answers[path] == outcome(work), path.name
    assert any(item["images"] for item in json.loads(answers[PICTURES])["items"])


def test_the_work_runs_in_another_process_without_an_event_loop():
    seen = job(child_work.where).run()
    assert seen["pid"] != os.getpid() and seen["loop"] is False


def test_a_work_past_its_time_is_killed(tmp_path):
    """Цикл, который не кончается: через seconds процесс убит — процессор свободен, а не занят до конца сервера."""
    started = time.monotonic()
    with pytest.raises(parse_child.TooLong):
        job(functools.partial(child_work.spin, str(tmp_path / "pid")), seconds=0.4).run()
    assert 0.4 <= time.monotonic() - started < 3
    assert child_work.gone(child_work.pid_from(tmp_path / "pid"))


@pytest.mark.parametrize("work", ["hungry", "hungry_then_unreadable", "hungry_but_carries_on", "killed"])
def test_a_work_past_its_memory_cap_is_refused(tmp_path, work):
    """Больше памяти, чем можно: MemoryError, завёрнутая в «файл не прочитан» и проглоченная (работа дошла до предела —
    значит, ей уже отказали в памяти), и процесс, убитый сигналом (OOM killer), — всё это TooBig."""
    started = time.monotonic()
    with pytest.raises(parse_child.TooBig):
        job(functools.partial(getattr(child_work, work), str(tmp_path / "pid"))).run()
    assert time.monotonic() - started < 5
    assert child_work.gone(child_work.pid_from(tmp_path / "pid"))


def test_the_work_s_own_errors_come_through_as_they_are():
    with pytest.raises(bank_parse.BankError) as refused:
        job(child_work.refused).run()
    assert (refused.value.status, refused.value.code, refused.value.detail) == (422, "no_items", "Не нашли вопросов.")
    with pytest.raises(KeyError) as broken:  # an error of the parse itself: as it was, with where it happened
        job(child_work.broken).run()
    assert "In the parse process" in broken.value.__notes__[0] and "child_work.py" in broken.value.__notes__[0]
    error = pickle.loads(pickle.dumps(bank_parse.BankError(413, "too_many", "Много.")))
    assert (error.status, error.code, error.detail, str(error)) == (413, "too_many", "Много.", "Много.")


def test_a_work_that_cannot_cross_to_the_child_is_an_error_not_a_quiet_fallback():
    with pytest.raises(Exception) as raised:
        job(lambda: 1).run()
    assert not isinstance(raised.value, parse_child.Unavailable)


def test_stop_kills_the_work_at_once(tmp_path):
    """Отменённый запрос: stop() из другого потока убивает процесс сразу, run() кончается Stopped."""
    running = job(functools.partial(child_work.spin, str(tmp_path / "pid")), seconds=60)
    ended: list = []

    def wait():
        try:
            running.run()
        except BaseException as exc:
            ended.append(exc)

    thread = threading.Thread(target=wait)
    thread.start()
    pid = child_work.pid_from(tmp_path / "pid")
    started = time.monotonic()
    running.stop()
    thread.join(5)
    assert not thread.is_alive() and time.monotonic() - started < 2
    assert len(ended) == 1 and isinstance(ended[0], parse_child.Stopped)
    assert child_work.gone(pid)
    stopped_first = job(child_work.where)
    stopped_first.stop()
    with pytest.raises(parse_child.Stopped):  # stopped before it started: never starts
        stopped_first.run()


def test_the_fork_server_starts_with_the_parse_modules_imported():
    """Процесс работы не платит за импорт: модули разбора уже в сервере форков. Модули backend/ сервер находит,
    если его запустили из backend/ (так работает приложение; иначе каждый процесс импортирует их сам)."""
    loaded = set(parse_child.warm_up())
    assert {"lxml.etree", "docx", "PyPDF2", "defusedxml.ElementTree"} <= loaded
    if (Path.cwd() / "bank_parse.py").exists():
        assert set(parse_child.PRELOAD) <= loaded
