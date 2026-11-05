"""The child path's safety net (bank_api): imports never break because the server's processes behave otherwise than
measured — the probe at the start, and a child that fails by itself, send the parse back to a thread."""

import functools

import pytest

import bank_api
import parse_child
from bank_parse import parse_bank_text


@pytest.fixture(autouse=True)
def fresh(monkeypatch):
    monkeypatch.setattr(bank_api, "PARSE_IN_CHILD", True)
    monkeypatch.setattr(bank_api, "_child_off", None)
    monkeypatch.setattr(bank_api, "_child_failures", 0)


def test_the_probe_parses_two_questions():
    # two questions, each with its key from the answer line: a probe that tests the real rules, not an empty parse
    assert parse_bank_text(bank_api.PROBE_TEXT)["key_source"] == {"answer_line": 2}


@pytest.mark.skipif(not parse_child.available(), reason="no fork server here")
def test_the_probe_agrees_in_a_real_child_and_the_child_path_stays_on():
    bank_api.warm_up()
    assert bank_api._child_off is None
    assert bank_api._in_child()


@pytest.mark.parametrize("failure", [parse_child.TooBig(), parse_child.TooLong(), parse_child.ChildFailed("no"), parse_child.Unavailable("no")])
def test_a_probe_that_fails_turns_the_child_path_off(monkeypatch, failure):
    monkeypatch.setattr(parse_child, "warm_up", lambda: [])
    monkeypatch.setattr(parse_child, "available", lambda: True)

    def broken(self):
        raise failure

    monkeypatch.setattr(parse_child.Job, "run", broken)
    bank_api.warm_up()
    assert bank_api._child_off is not None
    assert not bank_api._in_child()


def test_a_probe_with_another_answer_turns_the_child_path_off(monkeypatch):
    monkeypatch.setattr(parse_child, "warm_up", lambda: [])
    monkeypatch.setattr(parse_child, "available", lambda: True)
    monkeypatch.setattr(parse_child.Job, "run", lambda self: {"subjects": []})
    bank_api.warm_up()
    assert "differs" in (bank_api._child_off or "")
    assert not bank_api._in_child()


def test_a_child_failing_by_itself_parses_in_a_thread_and_three_turn_the_path_off(monkeypatch):
    def failed(self):
        raise parse_child.ChildFailed("the parse process failed before or after the work")

    monkeypatch.setattr(parse_child.Job, "run", failed)
    work = functools.partial(parse_bank_text, bank_api.PROBE_TEXT)
    expected = work()
    for n in range(1, bank_api.CHILD_FAILURES + 1):
        job = parse_child.Job(work, seconds=5, memory=None)
        assert bank_api._run_job(job) == expected
        assert (bank_api._child_off is None) == (n < bank_api.CHILD_FAILURES)
    assert not bank_api._in_child()


def test_a_time_or_memory_stop_is_the_file_s_not_the_server_s(monkeypatch):
    def too_long(self):
        raise parse_child.TooLong()

    monkeypatch.setattr(parse_child.Job, "run", too_long)
    with pytest.raises(parse_child.TooLong):
        bank_api._run_job(parse_child.Job(functools.partial(parse_bank_text, "x"), seconds=1, memory=None))
    assert bank_api._child_off is None
