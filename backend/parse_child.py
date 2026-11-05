"""Работа разбора в дочернем процессе: пределы времени и памяти, которые её действительно останавливают.

Поток Python не остановить: разбор, который пошёл не так (глубоко вложенный DOCX, огромная таблица, регулярное
выражение с перебором, PDF-бомба), шёл бы в потоке сервера минутами, брал бы память и держал место разбора
(bank_api.ParseSlots) и после отмены запроса. Здесь работа идёт в процессе от сервера форков multiprocessing
('forkserver'): он запускается один раз (warm_up при старте приложения или первая работа), модули разбора (PRELOAD)
в нём уже импортированы, и процесс на работу стоит сотые доли секунды, а не импорт. У процесса свои пределы: адресное
пространство (RLIMIT_AS — сколько было при старте плюс memory), процессорное время (RLIMIT_CPU — на случай, если убить
его по часам будет некому), без файла ядра; OOM killer ядра выбирает его первым, а не сервер (oom_score_adj 1000).
Через seconds процесс убивается (SIGKILL): процессор и память освобождаются сразу.

Работа и результат переходят границу процессов через pickle: работа — функция уровня модуля с аргументами
(functools.partial), результат — словари, списки, строки, байты. Исключение работы приходит как есть, с трассировкой
из процесса в заметке (add_note).

Job(work, seconds=…, memory=…).run() — в потоке (держит его до конца работы): результат или исключение работы; TooLong —
вышло время; TooBig — не хватило памяти (MemoryError, в том числе завёрнутая в другое исключение, или процесс убит
сигналом — так кончается нехватка памяти в C-коде и у OOM killer); Stopped — вызван stop(); Unavailable — процесс не
запустить (работу тогда делает вызывающий). stop() — из любого потока, сразу. available() — есть ли на платформе сервер
форков и пределы (на Windows — нет).
"""

from __future__ import annotations

import functools
import math
import multiprocessing
import os
import pickle
import signal
import sys
import threading
import time
import traceback
from typing import Any, Callable, Optional

try:
    import resource
except ImportError:  # Windows: no limits, no fork server
    resource = None  # type: ignore[assignment]

# Imported once, in the fork server: every child starts with them. «uvicorn.main»: a child re-runs the app's main script
# as __mp_main__ (multiprocessing.spawn), in production the uvicorn console script, which imports just that.
# The server imports from its working directory (the app's: backend/); what it cannot import, a child imports itself.
PRELOAD = ["parse_child", "bank_parse", "bank_ai", "lxml.etree", "lxml.html", "docx", "PyPDF2",
           "defusedxml.ElementTree", "uvicorn.main"]
EXIT_NO_MEMORY = 3  # the child could not even say «out of memory»
EXIT_FAILED = 1  # Python's own exit code of a process that failed before or after the work (multiprocessing)
JOIN_SECONDS = 5.0


class TooLong(Exception):
    """Работа шла дольше seconds: процесс убит."""


class TooBig(Exception):
    """Работе не хватило памяти (memory сверх стартовой) или процесс убит так, как кончается нехватка памяти."""


class Stopped(Exception):
    """Вызван stop(): процесс убит."""


class Unavailable(Exception):
    """Процесс для работы не запустить: работу делает вызывающий."""


class ChildFailed(RuntimeError):
    """Процесс кончился без ответа по другой причине, или исключение работы не передать через pickle."""


_server_lock = threading.Lock()
_server_set = False


def available() -> bool:
    return resource is not None and "forkserver" in multiprocessing.get_all_start_methods()


def _context():
    global _server_set
    context = multiprocessing.get_context("forkserver")
    with _server_lock:
        if not _server_set:  # before the server starts: it reads the list once
            context.set_forkserver_preload(PRELOAD)
            _server_set = True
    return context


class Job:
    """Одна работа в своём процессе. run() — в потоке; stop() — из любого потока."""

    def __init__(self, work: Callable[[], Any], *, seconds: float, memory: Optional[int]) -> None:
        self.work, self.seconds, self.memory = work, seconds, memory
        self._lock = threading.Lock()
        self._process: Any = None
        self._stopped = False

    def stop(self) -> None:
        with self._lock:
            self._stopped = True
            if self._process is not None:
                self._process.kill()

    def run(self) -> Any:
        deadline = time.monotonic() + self.seconds
        context = _context()
        receive, send = context.Pipe(duplex=False)
        process = context.Process(target=_child, args=(send, self.work, self.memory, self.seconds), name="parse",
                                  daemon=True)
        started, in_time, message = False, True, None
        try:
            with self._lock:
                if self._stopped:
                    raise Stopped()
            try:
                process.start()  # pickles the work first: a work that cannot be pickled is an error, not Unavailable
            except (OSError, EOFError) as exc:
                raise Unavailable(f"{type(exc).__name__}: {exc}") from None
            finally:
                send.close()  # the child holds its own end: when it dies, this pipe says so (EOF)
            started = True
            with self._lock:
                self._process = process
                if self._stopped:
                    process.kill()
            in_time = receive.poll(max(0.0, deadline - time.monotonic()))
            if in_time:
                try:
                    message = receive.recv()
                except EOFError:  # ended without an answer
                    pass
        finally:
            send.close()
            receive.close()
            code = self._end(process, answered=message is not None) if started else None
        if message is not None:
            kind, value = message
            if kind == "ok":
                return value
            if kind == "memory":
                print(f"Parse child: out of memory ({_megabytes(self.memory)} over its start)")
                raise TooBig()
            raise value
        if self._stopped:
            raise Stopped()
        if not in_time or code == -signal.SIGXCPU:
            print(f"Parse child: stopped after {self.seconds:g} s")
            raise TooLong()
        if code == EXIT_FAILED:
            raise ChildFailed("the parse process failed before or after the work (its error is in the log above)")
        # killed by a signal (SIGKILL of the OOM killer, SIGSEGV/SIGABRT of C code out of memory) or EXIT_NO_MEMORY
        print(f"Parse child: ended without an answer, exit code {code}")
        raise TooBig()

    def _end(self, process, answered: bool) -> Optional[int]:
        """Процесс кончен, объект закрыт: код выхода. Ответивший процесс выходит сам (и допишет свой журнал);
        не ответивший и живой (вышло время, ответ оборвался) — убит."""
        if not answered and process.is_alive():
            process.kill()
        process.join(JOIN_SECONDS)
        if process.exitcode is None:  # answered, but does not exit
            process.kill()
            process.join()
        code = process.exitcode
        with self._lock:
            self._process = None  # stop() no longer touches it
        process.close()
        return code


def _megabytes(size: Optional[int]) -> str:
    return "no cap" if size is None else f"{size / 2 ** 20:g} MB"


# ── В дочернем процессе ─────────────────────────────────────────────────────────


def _child(conn, work: Callable[[], Any], memory: Optional[int], seconds: float) -> None:
    out_of_memory = pickle.dumps(("memory", None))  # ready before the cap: sending it needs no memory
    cap = _limit(memory, seconds)
    try:
        message: Any = ("ok", work())
    except Exception as exc:
        try:
            message = ("memory", None) if _out_of_memory(exc) else ("error", _portable(exc))
        except Exception:  # not even the memory to describe the error
            message = ("memory", None)
    if cap is not None and memory is not None and message[0] != "memory" and _peak() >= cap - memory // 16:
        # it got up to the cap, so an allocation was refused on the way: code that catches every error (a style
        # table, a picture, a fallback reader) may have carried on without it — past the cap is past the cap
        message = ("memory", None)
    try:
        conn.send(message)
    except MemoryError:  # the answer itself does not fit
        message = None
        _answer(conn, out_of_memory)
    except Exception as exc:  # a result that cannot be pickled: a mistake in the work
        conn.send(("error", ChildFailed(f"the result could not be sent: {type(exc).__name__}: {exc}")))


def _answer(conn, data: bytes) -> None:
    try:
        conn.send_bytes(data)
    except BaseException:
        os._exit(EXIT_NO_MEMORY)


def _limit(memory: Optional[int], seconds: float) -> Optional[int]:
    """Пределы процесса; предел адресного пространства в байтах (или None — его нет)."""
    _cap(resource.RLIMIT_CORE, 0)  # a killed parse leaves no core file of its memory behind
    cpu = math.ceil(seconds) + 1  # SIGXCPU at it, SIGKILL a second later: only if nobody kills it by the clock
    _cap(resource.RLIMIT_CPU, cpu, cpu + 1)
    cap = None
    if memory is not None:
        try:
            with open("/proc/self/statm") as statm:  # what the child started with: the server's modules, the work
                size = int(statm.read().split()[0]) * os.sysconf("SC_PAGE_SIZE")
        except (OSError, ValueError):
            print("Parse child: no /proc/self/statm, no memory cap")
        else:
            cap = _cap(resource.RLIMIT_AS, size + memory)  # the hard limit too: the work cannot lift it
    try:
        with open("/proc/self/oom_score_adj", "w") as score:  # raising it needs no privileges
            score.write("1000")
    except OSError:
        pass
    return cap


def _peak() -> int:
    """Наибольшее адресное пространство процесса за его жизнь (VmPeak), в байтах."""
    try:
        with open("/proc/self/status") as status:
            for line in status:
                if line.startswith("VmPeak:"):
                    return int(line.split()[1]) * 1024
    except (OSError, ValueError, IndexError):
        pass
    return 0


def _cap(kind: int, soft: int, hard: Optional[int] = None) -> Optional[int]:
    hard = soft if hard is None else hard
    _, current = resource.getrlimit(kind)
    if current != resource.RLIM_INFINITY:
        soft, hard = min(soft, current), min(hard, current)
    try:
        resource.setrlimit(kind, (soft, hard))
    except (ValueError, OSError) as exc:
        print(f"Parse child: limit {kind} not set: {exc}")
        return None
    return soft


def _out_of_memory(exc: Optional[BaseException]) -> bool:
    """Нехватка памяти — сама или в цепочке: разбор заворачивает ошибки чтения в свои («файл не прочитан»). У lxml
    (libxml2) это не MemoryError, а XMLSyntaxError с кодом ERR_NO_MEMORY."""
    lxml = sys.modules.get("lxml.etree")
    lxml_error = lxml.Error if lxml is not None else ()
    no_memory = lxml.ErrorTypes.ERR_NO_MEMORY if lxml is not None else None
    seen: set[int] = set()
    while exc is not None and id(exc) not in seen:
        if isinstance(exc, MemoryError) or (isinstance(exc, lxml_error) and getattr(exc, "code", None) == no_memory):
            return True
        seen.add(id(exc))
        exc = exc.__cause__ or exc.__context__
    return False


def _portable(exc: Exception) -> Exception:
    note = "In the parse process:\n" + "".join(traceback.format_exception(exc)).rstrip()
    try:
        exc.add_note(note)
        pickle.loads(pickle.dumps(exc))
        return exc
    except Exception:
        failed = ChildFailed(f"{type(exc).__name__}: {exc}")
        failed.add_note(note)
        return failed


def _imported(names: tuple[str, ...]) -> list[str]:
    return [name for name in names if name in sys.modules]


def warm_up() -> list[str]:
    """Запускает сервер форков сейчас (несколько десятых секунды), а не на первой работе: модули PRELOAD, с которыми
    начинает процесс работы."""
    started = time.monotonic()
    loaded = Job(functools.partial(_imported, tuple(PRELOAD)), seconds=60, memory=None).run()
    missing = [name for name in PRELOAD if name not in loaded]
    print(f"Parse child: fork server ready in {(time.monotonic() - started) * 1000:.0f} ms; "
          + (f"not preloaded (imported by each child): {', '.join(missing)}" if missing else "all modules preloaded"))
    return loaded
