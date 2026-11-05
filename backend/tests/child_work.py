"""Работы для дочернего процесса разбора в тестах (parse_child.py, bank_api.ParseSlots): функции уровня модуля — их
передаёт pickle. Подменный разбор — с подписью parse_bank_text(text, **options) или read_key_file(contents, name): в
text (contents) — путь файла, куда процесс пишет свой pid, чтобы тест видел, жив ли процесс (pid_from, gone)."""
import asyncio
import os
import signal
import time
from pathlib import Path

from bank_parse import BankError


def note_pid(path) -> None:
    if path:
        Path(path.decode() if isinstance(path, bytes) else path).write_text(str(os.getpid()))


def where(text: str = "", **options) -> dict:
    """Где идёт работа: процесс и есть ли в нём цикл событий."""
    try:
        asyncio.get_running_loop()
        loop = True
    except RuntimeError:
        loop = False
    return {"pid": os.getpid(), "loop": loop}


def spin(text: str = "", **options) -> None:
    """Разбор, который не кончается: занят процессор (поток такой не остановить)."""
    note_pid(text)
    while True:
        pass


def spin_key(contents: bytes, name: str) -> None:
    spin(contents.decode())


def hungry(text: str = "", **options) -> None:
    """Разбору всё мало памяти (bytearray заполнен нулями: память занята по-настоящему)."""
    note_pid(text)
    pieces = []
    while True:
        pieces.append(bytearray(4 << 20))


def hungry_then_unreadable(text: str = "", **options) -> None:
    """Как bank_parse._file_input: нехватка памяти заворачивается в «файл не прочитан»."""
    try:
        hungry(text)
    except Exception:
        raise BankError(422, "unreadable", "Не удалось прочитать файл.") from None


def hungry_but_carries_on(text: str = "", **options) -> dict:
    """Как код, который ловит любую ошибку (таблица стилей, картинка) и идёт дальше без того, что не прочитал."""
    try:
        hungry(text)
    except Exception:
        pass
    return {"items": []}


def killed(text: str = "", **options) -> None:
    """Процесс убит сигналом — так его убивает OOM killer ядра."""
    note_pid(text)
    os.kill(os.getpid(), signal.SIGKILL)


def refused(text: str = "", **options) -> None:
    raise BankError(422, "no_items", "Не нашли вопросов.")


def broken(text: str = "", **options) -> None:
    raise KeyError("missing")


# ── Помощники тестов (в этом процессе) ──────────────────────────────────────────


def pid_from(path: Path, within: float = 5.0) -> int:
    """pid, который записала работа (ждёт, пока она начнётся)."""
    deadline = time.monotonic() + within
    while time.monotonic() < deadline:
        if path.exists() and path.read_text():
            return int(path.read_text())
        time.sleep(0.01)
    raise AssertionError("the work never started")


def gone(pid: int, within: float = 3.0) -> bool:
    """Процесса больше нет (или он зомби, которого вот-вот заберёт сервер форков)."""
    deadline = time.monotonic() + within
    while time.monotonic() < deadline:
        try:
            state = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()[0]
        except (OSError, IndexError):
            return True
        if state in ("Z", "X"):
            return True
        time.sleep(0.02)
    return False
