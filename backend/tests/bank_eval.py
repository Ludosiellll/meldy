"""Оценка разбора банка вопросов (bank_parse) на «диком» корпусе с эталоном: fixtures/banks/wild.

    python backend/tests/bank_eval.py                 # по файлам и итог, группы ошибок
    python backend/tests/bank_eval.py --only w006     # файлы, id которых начинается так; с --show — расхождения
    python backend/tests/bank_eval.py --json out.json # итог для сравнения «до/после»
    python -I backend/tests/bank_eval.py --counts A.docx B.txt [--key-file K.docx]
                                                      # чужие файлы без эталона: только числа, без текста

Эталон файла — truth/<id>.json (его пишет make_wild.py). Вопросы разбора сопоставляются с вопросами эталона по
порядку (выравнивание с наибольшим сходством текста; сходство меньше MATCH_AT — не тот вопрос). По каждому вопросу
эталона: найден ли, верен ли текст (пробелы не в счёт), варианты (по порядку файла), ключ, вид, картинки, предмет,
тема, вариант теста. Ключ: «верный», «нет ключа» (missing) или «неверный» (wrong — в том числе придуманный там, где
в файле ключа нет: хуже, чем никакого). Лишние вопросы разбора (false) — те, что не сопоставились ни с одним.

Все доли — от числа вопросов эталона: пропущенный вопрос — ошибка по каждому признаку.
"""
from __future__ import annotations

import argparse
import difflib
import json
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path
from typing import Optional

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

import bank_parse  # noqa: E402
from bank_parse import BankError, parse_bank_file, read_key_file  # noqa: E402

WILD = Path(__file__).resolve().parent / "fixtures" / "banks" / "wild"
MATCH_AT = 0.55  # сходство текстов, начиная с которого вопрос разбора — этот вопрос эталона
CHOICE = ("single", "multiple", "truefalse")
SAME_KIND = {("single", "truefalse"), ("truefalse", "single")}
ASPECTS = ("found", "stem", "options", "key", "kind")
RUS = "абвгдежзик"

_SPACES = re.compile(r"\s+")
_EDGE = re.compile(r"^[\s.,;:!?«»\"'()\-–—]+|[\s.,;:!?«»\"'()\-–—]+$")


def norm(text: Optional[str]) -> str:
    """Текст без разницы в пробелах: неразрывные и табуляции — пробел, подряд — один."""
    text = unicodedata.normalize("NFC", text or "").replace(" ", " ").replace(" ", " ")
    return _SPACES.sub(" ", text).strip()


def loose(text: Optional[str]) -> str:
    """Для сходства и коротких ответов: регистр, «ё», знаки по краям не в счёт."""
    return _EDGE.sub("", norm(text).lower().replace("ё", "е"))


def similarity(a: str, b: str) -> float:
    a, b = loose(a), loose(b)
    if not a or not b:
        return 0.0
    ratio = difflib.SequenceMatcher(None, a, b, autojunk=False).ratio()
    shorter, longer = (a, b) if len(a) <= len(b) else (b, a)
    if len(shorter) >= 12 and shorter in longer:
        ratio = max(ratio, 0.75)  # текст вопроса внутри склеенного или с хвостом — тот же вопрос, но текст неверен
    return ratio


def align(want: list[dict], got: list[dict]) -> dict[int, int]:
    """{индекс вопроса эталона: индекс вопроса разбора} — пары по порядку с наибольшей суммой сходства."""
    n, m = len(want), len(got)
    sims = [[similarity(w["stem"], g["text"]) for g in got] for w in want]
    best = [[0.0] * (m + 1) for _ in range(n + 1)]
    for i in range(n - 1, -1, -1):
        for j in range(m - 1, -1, -1):
            take = best[i + 1][j + 1] + sims[i][j] if sims[i][j] >= MATCH_AT else -1.0
            best[i][j] = max(take, best[i + 1][j], best[i][j + 1])
    pairs: dict[int, int] = {}
    i = j = 0
    while i < n and j < m:
        if sims[i][j] >= MATCH_AT and best[i][j] == best[i + 1][j + 1] + sims[i][j]:
            pairs[i] = j
            i += 1
            j += 1
        elif best[i][j] == best[i + 1][j]:
            i += 1
        else:
            j += 1
    return pairs


def load_cases(root: Path = WILD) -> list[dict]:
    return [json.loads(path.read_text(encoding="utf-8")) for path in sorted((root / "truth").glob("*.json"))]


def run_case(case: dict, root: Path = WILD) -> tuple[Optional[dict], Optional[str]]:
    """Разбор файла случая (с файлом ключа, если он есть) → (результат, None) или (None, код ошибки)."""
    path = root / case["file"]
    try:
        key_file = None
        if case.get("key_file"):
            key_path = root / case["key_file"]
            key_file = read_key_file(key_path.read_bytes(), key_path.name)
        return parse_bank_file(path.read_bytes(), path.name, key_file=key_file, with_pictures=True,
                               format_mode=case.get("format", "auto")), None
    except BankError as exc:
        return None, f"{exc.status}:{exc.code}"


def _match_key(item: dict) -> Optional[dict[int, str]]:
    """Ключ соответствия разбора → {номер слева: буква справа} (из пар или из строки «1-Б, 2-А»)."""
    found: dict[int, str] = {}
    for number, letter in re.findall(r"(\d{1,2})\s*[-–—:=→)]?\s*([а-яёa-z])(?![а-яёa-z])", item.get("answer") or "", re.I):
        found[int(number)] = letter.lower()
    for letter, number in re.findall(r"(?<![а-яёa-z])([а-яёa-z])\s*[-–—:=→)]?\s*(\d{1,2})", item.get("answer") or "", re.I):
        found.setdefault(int(number), letter.lower())
    return found or None


def check_key(want: dict, got: dict) -> str:
    """«ok», «missing» (ключа нет) или «wrong» (другой ключ; ключ там, где в файле его нет)."""
    kind = want["kind"]
    if kind in CHOICE or (kind not in ("open", "order", "match") and want["options"]):
        expected = sorted(want["correct"])
        actual = sorted(got.get("correct") or [])
        if not actual:
            return "ok" if not expected else "missing"
        if actual == expected and len(got["options"]) == len(want["options"]):
            return "ok"
        return "wrong"
    if kind == "open":
        answers = {loose(a) for a in want.get("answers") or []}
        given = loose(got.get("answer"))
        if not given:
            # вопрос с выбором из двух («да»/«нет») — тоже ответ
            if got.get("correct") and got.get("options"):
                given = loose(" ".join(got["options"][i] for i in got["correct"] if i < len(got["options"])))
            else:
                return "ok" if not answers else "missing"
        return "ok" if given in answers else "wrong"
    if kind == "order":
        if not got.get("order"):
            return "ok" if not want.get("order") else "missing"
        return "ok" if got["order"] == want.get("order") and len(got["options"]) == len(want["options"]) else "wrong"
    if kind == "match":
        expected = {want["left"].index(a) + 1: RUS[want["right"].index(b)] for a, b in want.get("pairs") or []}
        if got.get("pairs"):
            pairs = {(loose(a), loose(b)) for a, b in got["pairs"]}
            ok = pairs == {(loose(a), loose(b)) for a, b in want.get("pairs") or []}
            return "ok" if ok else "wrong"
        actual = _match_key(got)
        if not actual:
            return "ok" if not expected else "missing"
        return "ok" if actual == expected else "wrong"
    return "ok"


def check_options(want: dict, got: dict) -> bool:
    if want["kind"] == "open":
        return not got["options"]
    if want["kind"] == "match":
        return True  # списки соответствия разбор показывает как может: не сравниваем
    return [norm(o) for o in got["options"]] == [norm(o) for o in want["options"]]


def _pictures(got: dict) -> int:
    images = got.get("images") or {}
    return len(images.get("stem") or []) + sum(len(keys) for keys in images.get("options") or [])


def score_case(case: dict, result: Optional[dict], error: Optional[str]) -> dict:
    want = case["questions"]
    out = {"id": case["id"], "file": case["file"], "tags": case["tags"], "supported": case.get("supported", True),
           "expected": len(want), "parsed": 0, "found": 0, "false": 0, "stem": 0, "options": 0, "key": 0,
           "key_wrong": 0, "key_missing": 0, "key_invented": 0, "kind": 0, "error": error, "problems": [],
           "reasons": Counter()}
    if result is None:
        out["reasons"][f"rejected {error}"] += len(want)
        out["reasons"]["missed"] += len(want)
        return out
    got = result["items"]
    out["parsed"] = len(got)
    pairs = align(want, got)
    out["found"] = len(pairs)
    out["false"] = len(got) - len(pairs)
    if out["false"]:
        out["reasons"]["false question"] += out["false"]
    subjects = {s["index"]: s["title"] for s in result.get("subjects") or []}
    topics = {t["index"]: t["title"] for t in result.get("topics") or []}
    for i, w in enumerate(want):
        tag = f"#{i + 1}"
        if i not in pairs:
            out["reasons"]["missed"] += 1
            out["problems"].append(f"{tag} missed: {w['stem'][:60]!r}")
            continue
        g = got[pairs[i]]
        if norm(g["text"]) == norm(w["stem"]):
            out["stem"] += 1
        else:
            out["reasons"]["stem"] += 1
            out["problems"].append(f"{tag} stem {norm(g['text'])[:90]!r} != {norm(w['stem'])[:90]!r}")
        if check_options(w, g):
            out["options"] += 1
        else:
            out["reasons"]["options"] += 1
            out["problems"].append(f"{tag} options {g['options'][:6]} != {w['options'][:6]}")
        verdict = check_key(w, g)
        if verdict == "ok":
            out["key"] += 1
        else:
            invented = verdict == "wrong" and not (w["correct"] or w.get("answers") or w.get("order") or w.get("pairs"))
            out["key_invented" if invented else f"key_{verdict}"] += 1
            if invented:
                out["key_wrong"] += 1
            out["reasons"]["key invented" if invented else f"key {verdict}"] += 1
            out["problems"].append(f"{tag} key {verdict}: got correct={g['correct']} answer={g.get('answer')!r} order={g.get('order')} "
                                   f"want correct={w['correct']} answers={w.get('answers')} order={w.get('order')}")
        if g["kind"] == w["kind"] or (w["kind"], g["kind"]) in SAME_KIND:
            out["kind"] += 1
        else:
            out["reasons"]["kind"] += 1
            out["problems"].append(f"{tag} kind {g['kind']} != {w['kind']}")
        if "pictures" in w and _pictures(g) != w["pictures"]:
            out["reasons"]["pictures"] += 1
            out["problems"].append(f"{tag} pictures {_pictures(g)} != {w['pictures']}")
        if "subject" in w and loose(subjects.get(g.get("subject"))) != loose(w["subject"]):
            out["reasons"]["subject"] += 1
            out["problems"].append(f"{tag} subject {subjects.get(g.get('subject'))!r} != {w['subject']!r}")
        if "topic" in w and loose(topics.get(g.get("topic"))) != loose(w["topic"]):
            out["reasons"]["topic"] += 1
            out["problems"].append(f"{tag} topic {topics.get(g.get('topic'))!r} != {w['topic']!r}")
        if "variant" in w:
            titles = [subjects.get(g.get("subject")), topics.get(g.get("topic"))]
            if not any(title and bank_parse.variant_number(title) == w["variant"] for title in titles):
                out["reasons"]["variant"] += 1
                out["problems"].append(f"{tag} variant not told apart (subject/topic {titles})")
    return out


def evaluate(root: Path = WILD, only: Optional[str] = None) -> dict:
    files = []
    for case in load_cases(root):
        if only and not case["id"].startswith(only):
            continue
        result, error = run_case(case, root)
        files.append(score_case(case, result, error))
    total = Counter()
    for entry in files:
        for name in ("expected", "parsed", "found", "false", "stem", "options", "key", "key_wrong", "key_missing", "key_invented", "kind"):
            total[name] += entry[name]
    total["files"] = len(files)
    total["supported_files"] = sum(1 for entry in files if entry["supported"])
    total["rejected_files"] = sum(1 for entry in files if entry["error"])
    total["perfect_files"] = sum(1 for entry in files if not entry["reasons"])
    return {"total": dict(total), "files": files}


def _pct(part: int, whole: int) -> str:
    return f"{100 * part / whole:5.1f}%" if whole else "   - "


def print_report(report: dict, show: bool = False) -> None:
    files = report["files"]
    print(f"{'file':44} {'exp':>4} {'got':>4} {'found':>5} {'false':>5} {'stem':>4} {'opts':>4} {'key':>4} {'wrng':>4} "
          f"{'miss':>4} {'kind':>4}  error")
    for e in files:
        print(f"{e['id'][:44]:44} {e['expected']:4} {e['parsed']:4} {e['found']:5} {e['false']:5} {e['stem']:4} {e['options']:4} "
              f"{e['key']:4} {e['key_wrong']:4} {e['key_missing']:4} {e['kind']:4}  {e['error'] or ''}")
        if show:
            for problem in e["problems"]:
                print(f"    {problem}")
    t = report["total"]
    exp = t["expected"]
    print()
    print(f"TOTAL files {t['files']} (accepted formats {t['supported_files']}), rejected {t['rejected_files']}, "
          f"perfect {t['perfect_files']}")
    print(f"  questions expected {exp}, parsed {t['parsed']}, found {t['found']} ({_pct(t['found'], exp)}), false {t['false']}")
    print(f"  stems right   {t['stem']:5} {_pct(t['stem'], exp)}")
    print(f"  options right {t['options']:5} {_pct(t['options'], exp)}")
    print(f"  keys right    {t['key']:5} {_pct(t['key'], exp)}   wrong {t['key_wrong']} (invented {t['key_invented']}), "
          f"missing {t['key_missing']}")
    print(f"  kinds right   {t['kind']:5} {_pct(t['kind'], exp)}")
    reasons: dict[str, Counter] = defaultdict(Counter)
    for e in files:
        for reason, count in e["reasons"].items():
            reasons[reason][e["id"]] += count
    print("\nFAILURES BY REASON (questions; files)")
    for reason, by_file in sorted(reasons.items(), key=lambda kv: -sum(kv[1].values())):
        listed = " ".join(f"{name.split('_')[0]}({count})" for name, count in by_file.most_common(14))
        more = f" +{len(by_file) - 14}" if len(by_file) > 14 else ""
        print(f"  {reason:22} {sum(by_file.values()):5} q in {len(by_file):3} files: {listed}{more}")
    tags: dict[str, Counter] = defaultdict(Counter)
    for e in files:
        for tag in e["tags"]:
            tags[tag]["files"] += 1
            tags[tag]["expected"] += e["expected"]
            tags[tag]["found"] += e["found"]
            tags[tag]["key"] += e["key"]
            tags[tag]["clean"] += 0 if e["reasons"] else 1
    print("\nBY TAG (files clean/all, found %, keys right %) — worst first")
    rows = sorted(tags.items(), key=lambda kv: (kv[1]["key"] / max(1, kv[1]["expected"]), kv[0]))
    for tag, c in rows:
        if c["key"] == c["expected"] and c["found"] == c["expected"]:
            continue
        print(f"  {tag:28} {c['clean']:3}/{c['files']:<3} found {_pct(c['found'], c['expected'])}  keys {_pct(c['key'], c['expected'])}")


# ── Чужие файлы без эталона: только числа ───────────────────────────────────────


def counts(path: Path, key_path: Optional[Path] = None) -> dict:
    """Числа разбора файла без текста: вопросы, номера, ключи, флаги, виды. Ничего из файла не печатается."""
    out: dict = {"file": path.name}
    key_file = None
    if key_path is not None:
        try:
            key_file = read_key_file(key_path.read_bytes(), key_path.name)
            out["key_file_sections"] = [len(section["keys"]) for section in key_file]
        except BankError as exc:
            out["key_file_error"] = exc.code
    try:
        result = parse_bank_file(path.read_bytes(), path.name, key_file=key_file, with_pictures=True)
    except BankError as exc:
        out["error"] = f"{exc.status}:{exc.code}"
    else:
        items = result["items"]
        numbers = [int(item["label"]) for item in items if item["label"].isdecimal()]
        stats = result["stats"]
        out.update(
            items=len(items), numbered=len(numbers), max_number=max(numbers, default=0), restarts=sum(1 for n in numbers if n == 1),
            with_key=stats["with_key"], no_key=stats["no_key"], ambiguous=stats["ambiguous"], to_check=stats["to_check"],
            duplicates=stats["duplicates"], gaps=len(stats["gaps"]), kinds=stats["kinds"], options=stats["options"],
            layout=result["layout"], key_source=result["key_source"], subjects=len(result["subjects"]), topics=len(result["topics"]),
            flags=dict(Counter(flag for item in items for flag in item["flags"])), skipped=len(result["skipped"]),
            pictures=sum(_pictures(item) for item in items), variant=result.get("variant"),
        )
    try:
        sections = read_key_file(path.read_bytes(), path.name)
        out["as_key_file"] = [len(section["keys"]) for section in sections]
    except BankError:
        pass
    return out


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("--only", help="только случаи, id которых начинается так")
    parser.add_argument("--show", action="store_true", help="расхождения по вопросам")
    parser.add_argument("--json", help="записать итог в файл")
    parser.add_argument("--counts", nargs="+", help="файлы без эталона: только числа")
    parser.add_argument("--key-file", help="файл ключа для --counts")
    args = parser.parse_args(argv)
    if args.counts:
        key_path = Path(args.key_file) if args.key_file else None
        for name in args.counts:
            print(json.dumps(counts(Path(name), key_path), ensure_ascii=False, sort_keys=True))
        return 0
    report = evaluate(only=args.only)
    print_report(report, show=args.show)
    if args.json:
        for entry in report["files"]:
            entry["reasons"] = dict(entry["reasons"])
        Path(args.json).write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
