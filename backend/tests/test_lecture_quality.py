"""«Разобрать лекцию»: what the live QA run of 2026-10-11 found, item by item.

1. A link to a video page is refused before any charge or fetch (utils.is_video_link, main.analyze_url).
2. A recording goes to Groq's turbo Whisper in Russian with no prompt (the recheck of release 44 found its
   large-v3 with a file-name prompt worse), Whisper's made-up lines go (subtitle credits, a loop at the end),
   Gemini is the fallback with transcript settings, and the text of a recording is marked (transcribed: true).
3. Russian words with Latin letters inside, in every generated lecture material (mixed_script.py).
4. The material prompts take formulas, dates and numbers from the lecture only; the конспект retells each
   section of the lecture shorter, between «Ключевые тезисы» and «Выводы».
5. A web page comes without the addresses of its links, images and reference lists (utils.clean_page_text).
6. PDF text is read by the position of its letters (parser._PdfPage): no spaces inside words, sections kept.
7. A near-empty text ends the stream with a clear no_text error and no model call (the units: test_quota).
8. .doc, voice notes and phone videos are refused with what to do instead (parser.unsupported_format_detail).

The QA inputs (a Chromium-printed PDF of a biology lecture, Whisper's transcripts of one MP3 of a physics
lecture, the QA strings) are used as they were found; the web page is a synthetic Reader answer of the same
shape. Models and providers are fakes.
"""
import asyncio
import io
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from PyPDF2 import PdfReader

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import media_parser  # noqa: E402
import mixed_script  # noqa: E402
import parser as lecture_parser  # noqa: E402
import utils  # noqa: E402
from agents.base import (  # noqa: E402
    SAFETY_SETTINGS,
    SOURCE_FACTS_RULE,
    build_cheatsheet_prompt,
    build_flashcards_prompt,
    build_podcast_prompt,
    build_quick_prep_prompt,
    build_quiz_prompt,
    build_summarizer_prompt,
)
from agents.coordinator import GROUNDING_INSTRUCTION, build_prompts, normalize_settings  # noqa: E402
from parser import (  # noqa: E402
    DOC_LEGACY_DETAIL,
    DOCUMENT_FORMAT_DETAIL,
    MEDIA_FORMAT_DETAIL,
    PPT_LEGACY_DETAIL,
    unsupported_format_detail,
)
from test_analyze_stream import LECTURE, SUMMARY, answer_with, frames, kinds  # noqa: E402
from utils import build_source_chunks, clean_page_text, is_video_link  # noqa: E402

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "lecture_qa"


@pytest.fixture
def api(monkeypatch):
    """The app with a signed-in user, no rate limit, Gemini configured; models are answer_with(...) fakes."""
    import main
    from agents.base import BaseAgent
    from fastapi.testclient import TestClient

    async def fake_user(request):
        return {"id": "user-a"}

    monkeypatch.setattr(main, "require_authenticated_user", fake_user)
    monkeypatch.setattr(main.limiter, "enabled", False)
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-key")
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    monkeypatch.setenv("AI_AGENT_STAGGER_SECONDS", "0")
    monkeypatch.delenv("MAX_UPLOAD_BYTES", raising=False)
    BaseAgent._run_cache.clear()
    yield TestClient(main.app)
    BaseAgent._run_cache.clear()
VIDEO_LINK_DETAIL = (
    "Ссылку на видео Meldy пока не открывает. Если запись лекции есть у вас файлом, загрузите её во вкладке "
    "«Аудио и видео» (до 15 МБ)."
)


# ── 1. Video links ─────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("url", [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ?t=42",
    "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
    "HTTPS://WWW.YOUTUBE.COM/shorts/abc",
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    "https://rutube.ru/video/0123456789abcdef/",
    "https://vk.com/video-12345_678",
    "https://m.vk.com/clip-1_2",
    "https://vk.com/wall-1_2?z=video-1_2%2Fabc",
    "https://vkvideo.ru/video-1_2",
    "https://dzen.ru/video/watch/abc",
    "https://dzen.ru/shorts/abc",
])
def test_video_links_are_recognised(url):
    assert is_video_link(url)


@pytest.mark.parametrize("url", [
    "https://ru.wikipedia.org/wiki/Закон_Ома",
    "https://vk.com/@club1-statya",
    "https://dzen.ru/a/abc",
    "https://notyoutube.com/watch?v=x",
    "https://youtube.com.example.org/lecture",
    "https://example.com/youtube.com/video",
    "",
])
def test_pages_of_text_are_not_video_links(url):
    assert not is_video_link(url)


def test_a_video_link_is_refused_before_any_charge_or_fetch(api, monkeypatch):
    import main

    fetched, charged = [], []

    async def scrape(url):
        fetched.append(url)
        return LECTURE

    async def charge(request, kind, units):
        charged.append(kind)
        raise AssertionError("charged")

    monkeypatch.setattr(main, "scrape_url", scrape)
    monkeypatch.setattr(main.quota, "charge", charge)
    for url in ("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://youtu.be/abc", "rutube.ru/video/x/"):
        response = api.post("/api/analyze/url", data={"url": url})
        assert response.status_code == 400 and response.json() == {"detail": VIDEO_LINK_DETAIL}
    assert fetched == [] and charged == []
    assert main.VIDEO_LINK_DETAIL == VIDEO_LINK_DETAIL


# ── 2. Recordings ──────────────────────────────────────────────────────────────────


# Whisper's text of one synthetic MP3 of a physics lecture (2:50), live on 2026-10-11, with the share of the lecture's
# words it kept in order: the turbo model without a language or a prompt in the morning, release 44's large-v3 with
# a Russian prompt naming the topic of the file name in the evening.
QA_RECORDINGS = {
    "morning": "ohm_whisper_morning.txt",  # 84.6 %: one ~10 s passage skipped, nothing invented
    "run1": "ohm_whisper_r44_run1.txt",  # 32.0 %: stopped at 45 s with the prompt twice and a subtitle credit
    "run2": "ohm_whisper_r44_run2.txt",  # 76.1 %: invented sentences where the turbo skipped
    "run3": "ohm_whisper_r44_run3.txt",  # 75.2 %: the same
}
QA_MADE_UP_TAIL = ". . Лекция физика закон Ома. Лекция физика закон Ома. Субтитры создавал DimaTorzok"


def qa_recording(name: str) -> str:
    return (FIXTURES / QA_RECORDINGS[name]).read_text(encoding="utf-8").strip()


def fake_gemini(monkeypatch, text: str) -> list:
    """genai.Client of media_parser: the upload is ready at once and every model answers ``text``; the calls."""
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-key")
    monkeypatch.delenv("GEMINI_MODELS", raising=False)
    calls = []

    class FakeFiles:
        def upload(self, file=None, config=None):
            return SimpleNamespace(name="files/1", state=SimpleNamespace(name="ACTIVE"))

        def delete(self, name=None):
            pass

    class FakeClient:
        def __init__(self, api_key=None, **kwargs):
            self.files = FakeFiles()

            async def generate_content(model=None, contents=None, config=None):
                calls.append({"model": model, "prompt": contents[1]})
                return SimpleNamespace(text=text)

            self.aio = SimpleNamespace(models=SimpleNamespace(generate_content=generate_content))

    monkeypatch.setattr(media_parser.genai, "Client", FakeClient)
    return calls


class _Busy(Exception):
    status_code = 429


class FakeGroq:
    """groq.AsyncGroq: records every transcription request; ``fail`` — models that answer 429."""

    calls: list = []
    fail: set = set()
    text = "Сегодня мы разберём закон Ома."

    def __init__(self, api_key=None, **kwargs):
        self.audio = SimpleNamespace(transcriptions=SimpleNamespace(create=self.create))

    async def create(self, **kwargs):
        name, _handle, mime = kwargs["file"]
        FakeGroq.calls.append({**{key: value for key, value in kwargs.items() if key != "file"}, "name": name, "mime": mime})
        if kwargs["model"] in FakeGroq.fail:
            raise _Busy("busy")
        return FakeGroq.text


@pytest.fixture
def groq(monkeypatch):
    import groq as groq_module

    FakeGroq.calls, FakeGroq.fail = [], set()
    monkeypatch.setattr(groq_module, "AsyncGroq", FakeGroq)
    monkeypatch.setenv("GROQ_API_KEY", "groq-key")
    monkeypatch.delenv("GROQ_TRANSCRIPTION_MODEL", raising=False)
    monkeypatch.delenv("GROQ_LECTURE_TRANSCRIPTION_MODEL", raising=False)
    return FakeGroq


def test_a_lecture_recording_goes_to_the_turbo_whisper_in_russian_without_a_prompt(groq, tmp_path):
    path = tmp_path / "upload.mp3"
    path.write_bytes(b"ID3 audio")
    assert asyncio.run(media_parser.transcribe_media_file(str(path), "audio/mpeg")) == FakeGroq.text
    [call] = groq.calls
    assert call["model"] == "whisper-large-v3-turbo" and call["language"] == "ru" and call["temperature"] == 0
    # Release 44's «Запись лекции на русском языке. Тема: Лекция физика закон Ома.» came back as text (run1).
    assert "prompt" not in call
    assert call["mime"] == "audio/mpeg" and call["name"] == "upload.mp3"
    assert media_parser.lecture_transcription_models() == ["whisper-large-v3-turbo"]


def test_a_busy_turbo_goes_to_gemini_not_to_large_v3(groq, monkeypatch, tmp_path):
    groq.fail = {"whisper-large-v3-turbo"}
    gemini = fake_gemini(monkeypatch, "Сегодня мы разберём закон Ома.")
    path = tmp_path / "upload.mp3"
    path.write_bytes(b"ID3 audio")
    assert asyncio.run(media_parser.transcribe_media_file(str(path), "audio/mpeg")) == "Сегодня мы разберём закон Ома."
    assert [call["model"] for call in groq.calls] == ["whisper-large-v3-turbo"]
    assert len(gemini) == 1 and gemini[0]["prompt"] == media_parser.MEDIA_TRANSCRIPTION_PROMPT


def test_large_v3_is_asked_only_when_named_and_then_the_turbo_follows_it(groq, monkeypatch, tmp_path):
    monkeypatch.setenv("GROQ_LECTURE_TRANSCRIPTION_MODEL", "whisper-large-v3")
    groq.fail = {"whisper-large-v3"}
    path = tmp_path / "upload.mp4"
    path.write_bytes(b"video")
    # A video lecture (MP4) goes to Whisper too, not straight to Gemini.
    assert asyncio.run(media_parser.transcribe_media_file(str(path), "video/mp4")) == FakeGroq.text
    assert [call["model"] for call in groq.calls] == ["whisper-large-v3", "whisper-large-v3-turbo"]
    assert all("prompt" not in call and call["language"] == "ru" for call in groq.calls)


def test_the_lecture_model_can_be_set_apart_from_the_spoken_answers_model(groq, monkeypatch):
    monkeypatch.setenv("GROQ_TRANSCRIPTION_MODEL", "answers-model")
    assert media_parser.lecture_transcription_models() == ["whisper-large-v3-turbo", "answers-model"]
    monkeypatch.setenv("GROQ_LECTURE_TRANSCRIPTION_MODEL", "lecture-model")
    assert media_parser.lecture_transcription_models() == ["lecture-model", "answers-model"]
    monkeypatch.setenv("GROQ_TRANSCRIPTION_MODEL", "lecture-model")
    assert media_parser.lecture_transcription_models() == ["lecture-model"]


# Whisper's made-up lines.


def test_the_45_second_run_loses_its_subtitle_credit_the_stray_dots_and_the_repeat():
    run1 = qa_recording("run1")
    assert run1.endswith("площади поперечного сечения. " + QA_MADE_UP_TAIL)
    # A loop keeps one copy: Whisper usually repeats a sentence that was said. This one was release 44's prompt,
    # which is not sent any more.
    expected = run1[: run1.index(QA_MADE_UP_TAIL)] + "Лекция физика закон Ома."
    assert media_parser.clean_whisper_transcript(run1) == expected


@pytest.mark.parametrize("name", ["morning", "run2", "run3"])
def test_real_whisper_transcripts_stay_as_they_were(name):
    # Units («1 В», «1 А. Для…»), letters with a dot («Г. «Соединение проводников» И.»), commas where a piece
    # ended: nothing of these is a made-up line of a known shape. Invented speech stays too: the cleanup cannot
    # know it, so the model that wrote it is not asked by default.
    text = qa_recording(name)
    assert media_parser.clean_whisper_transcript(text) == text
    if name == "run2":
        assert "мы поистине придерживаемся высокого депрессанта" in text


@pytest.mark.parametrize("credit", [
    "Субтитры создавал DimaTorzok",
    "Субтитры сделал DimaTorzok.",
    "Субтитры делал DimaTorzok",
    "Субтитры создавала Анна Иванова.",
    "Субтитры сделала Анна Иванова.",
    "Редактор субтитров А.Семкин Корректор А.Егорова",
    "Редактор субтитров А. Синецкая.",
    "Корректор А. Егорова.",
    "Продолжение следует...",
    "Продолжение следует…",
])
def test_subtitle_credits_go_wherever_they_stand(credit):
    before, after = "Сегодня мы разберём закон Ома.", "Сила тока равна напряжению, делённому на сопротивление."
    sentence = credit if credit[-1] in ".…" else credit + "."
    clean = media_parser.clean_whisper_transcript
    assert clean(credit) == ""
    assert clean(f"{before} {sentence} {after}") == f"{before} {after}"
    assert clean(f"{before} {after} {credit}") == f"{before} {after}"


def test_a_credit_glued_to_a_sentence_goes_and_the_sentence_stays():
    clean = media_parser.clean_whisper_transcript
    last = "При параллельном соединении общее сопротивление меньше любого из них"
    assert clean(f"{last} Субтитры создавал DimaTorzok") == last
    assert clean(f"{last} Продолжение следует...") == last
    assert clean("Субтитры сделал DimaTorzok Сегодня мы разберём закон Ома.") == "Сегодня мы разберём закон Ома."
    assert clean("Субтитры: DimaTorzok") == ""


def test_thanks_alone_at_the_very_end_and_a_loop_at_the_end_go():
    clean = media_parser.clean_whisper_transcript
    body = "Итак, запомним главное. При параллельном соединении общее сопротивление меньше любого из них."
    assert clean(body + " Спасибо за внимание!") == body
    assert clean(body + " Спасибо за просмотр.") == body
    assert clean(body + " При параллельном соединении общее сопротивление меньше любого из них." * 3) == body
    assert clean(body + " Спасибо за внимание." * 2 + " Субтитры сделал DimaTorzok") == body
    # A paragraph break after a dropped line stays; a line break ends a sentence.
    assert clean("Первый абзац.\nПродолжение следует...\n\nВторой абзац.") == "Первый абзац.\n\nВторой абзац."
    assert clean("Первый абзац.\n\nСубтитры сделал DimaTorzok\n\nВторой абзац") == "Первый абзац.\n\nВторой абзац"
    assert clean("") == "" and clean("  \n ") == "" and clean(None) == ""


@pytest.mark.parametrize("text", [
    "Субтитры делали вручную, кадр за кадром. Это занимало недели.",
    "Корректор — это специалист, который исправляет ошибки в тексте.",
    "Редактор и корректор проверяют текст перед печатью.",
    "Продолжение следует из второго закона Ньютона.",
    "Спасибо за внимание, а теперь перейдём к задачам.",
    "Спасибо за внимание. А теперь перейдём к задачам.",
    "Всем спасибо за внимание.",
    "Запомните. Запомните. Сила тока равна напряжению, делённому на сопротивление.",
    "Первый абзац лекции.\n\nВторой абзац лекции.",
])
def test_sentences_about_subtitles_thanks_inside_and_repeats_inside_stay(text):
    assert media_parser.clean_whisper_transcript(text) == text


def test_whisper_text_is_cleaned_and_a_text_of_made_up_lines_only_goes_to_gemini(groq, monkeypatch, tmp_path):
    path = tmp_path / "upload.mp3"
    path.write_bytes(b"ID3 audio")
    monkeypatch.setattr(FakeGroq, "text", qa_recording("run1"))
    cleaned = asyncio.run(media_parser.transcribe_media_file(str(path), "audio/mpeg"))
    assert cleaned == media_parser.clean_whisper_transcript(qa_recording("run1")) and "DimaTorzok" not in cleaned

    # Whisper heard nothing it could write: Gemini is asked, as when Whisper answers nothing.
    monkeypatch.setattr(FakeGroq, "text", "Продолжение следует... Субтитры сделал DimaTorzok")
    gemini = fake_gemini(monkeypatch, "Сегодня мы разберём закон Ома.")
    assert asyncio.run(media_parser.transcribe_media_file(str(path), "audio/mpeg")) == "Сегодня мы разберём закон Ома."
    assert len(gemini) == 1


def test_gemini_transcribes_a_recording_with_transcript_settings_when_groq_has_no_key(monkeypatch, tmp_path):
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-key")
    monkeypatch.setenv("GEMINI_MODELS", "gemini-2.5-flash-lite")
    calls = []

    class FakeFiles:
        def upload(self, file=None, config=None):
            return SimpleNamespace(name="files/1", state=SimpleNamespace(name="ACTIVE"))

        def delete(self, name=None):
            pass

    class FakeClient:
        def __init__(self, api_key=None, **kwargs):
            self.files = FakeFiles()

            async def generate_content(model=None, contents=None, config=None):
                calls.append({"model": model, "prompt": contents[1], "config": config})
                return SimpleNamespace(text="Сегодня мы разберём закон Ома.")

            self.aio = SimpleNamespace(models=SimpleNamespace(generate_content=generate_content))

    monkeypatch.setattr(media_parser.genai, "Client", FakeClient)
    path = tmp_path / "talk.wav"
    path.write_bytes(b"RIFF audio")
    assert asyncio.run(media_parser.transcribe_media_file(str(path), "audio/wav")) == "Сегодня мы разберём закон Ома."
    [call] = calls
    assert call["prompt"] == media_parser.MEDIA_TRANSCRIPTION_PROMPT and "русском" in call["prompt"]
    assert call["config"].temperature == media_parser.MEDIA_TRANSCRIPTION_TEMPERATURE
    assert call["config"].thinking_config.thinking_budget == 0  # a transcript needs no thinking
    assert call["config"].safety_settings == SAFETY_SETTINGS


def test_a_model_that_refuses_the_transcript_settings_is_asked_without_them(monkeypatch, tmp_path):
    from google.genai import errors as genai_errors

    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-key")
    monkeypatch.setenv("GEMINI_MODELS", "gemini-2.5-flash-lite")
    configs = []

    class FakeFiles:
        def upload(self, file=None, config=None):
            return SimpleNamespace(name="files/1", state=SimpleNamespace(name="ACTIVE"))

        def delete(self, name=None):
            pass

    class FakeClient:
        def __init__(self, api_key=None, **kwargs):
            self.files = FakeFiles()

            async def generate_content(model=None, contents=None, config=None):
                configs.append(config)
                if config is not None:
                    raise genai_errors.ClientError(400, {"error": {"code": 400, "message": "thinking", "status": "INVALID_ARGUMENT"}})
                return SimpleNamespace(text="Текст записи.")

            self.aio = SimpleNamespace(models=SimpleNamespace(generate_content=generate_content))

    monkeypatch.setattr(media_parser.genai, "Client", FakeClient)
    path = tmp_path / "talk.mp4"
    path.write_bytes(b"video")
    assert asyncio.run(media_parser.transcribe_media_file(str(path), "video/mp4")) == "Текст записи."
    assert len(configs) == 2 and configs[0] is not None and configs[1] is None


def test_the_text_of_a_recording_is_marked_and_its_file_name_is_not_a_prompt(api, monkeypatch):
    import main

    seen = {}

    async def transcribe(path, mime_type=None, **kwargs):
        seen.update(mime=mime_type, kwargs=kwargs)
        return LECTURE

    monkeypatch.setattr(main, "transcribe_media_file", transcribe)
    answer_with(monkeypatch, {"summarizer": SUMMARY})
    response = api.post(
        "/api/analyze/media",
        # A browser that sent no type: the type of a recording comes from its extension.
        files={"file": ("Лекция_физика_закон_Ома.mp3", io.BytesIO(b"ID3 audio"), "application/octet-stream")},
        data={"enabled_agents": json.dumps(["summarizer"])},
    )
    items = [item for item in frames(response.text) if item != "KA"]
    extracted = next(item for item in items if item["type"] == "text_extracted")
    assert extracted["transcribed"] is True and "ocr" not in extracted
    # «Лекция_физика_закон_Ома.mp3» no longer reaches Whisper: release 44 put it in the prompt and got it back.
    assert seen == {"mime": "audio/mpeg", "kwargs": {}}
    assert kinds(items)[-1] == "done"


# ── 3. Latin letters inside Russian words ──────────────────────────────────────────

QA_BROKEN = "рост национаisticских настроений в державах"


def test_a_real_latin_chunk_inside_a_russian_word_is_found():
    text, broken = mixed_script.fix_text(f"Национализм: стремление народов Балкан к независимости и {QA_BROKEN}.")
    assert broken == ["национаisticских"]
    assert "национаisticских" in text  # found, not changed: there is no safe guess for it
    assert mixed_script.fix_text("nationalistских идей")[1] == ["nationalistских"]


def test_single_latin_look_alikes_in_russian_words_are_replaced_silently():
    # Latin o in «тoка», Latin C in «Cтруктура», Latin a in «мaтериал», Latin capital B in «Bолга».
    text, broken = mixed_script.fix_text("Сила тoка. Cтруктура клетки. Новый мaтериал. Bолга.")
    assert text == "Сила тока. Структура клетки. Новый материал. Волга." and broken == []
    assert all(char.isascii() is False for word in ("тока", "Структура") for char in word)


def test_latin_terms_formulas_and_code_stay_as_they_are():
    sample = (
        "SQL-запрос на Python, LaTeX и pH раствора; в Pythonе и Excelем окончания русские. "
        "Формула $v_{ср} = s/t$, код `имяUser = 1` и\n```\nпеременнаяX = 2\n```"
    )
    assert mixed_script.fix_text(sample) == (sample, [])
    # A Russian look-alike inside a Latin word goes back to Latin: «Pythоn» with a Cyrillic о.
    assert mixed_script.fix_text("язык Pythоn")[0] == "язык Python"


def test_the_fallback_drops_only_the_sentences_with_a_broken_word():
    content = (
        "## Причины войны\n\n"
        "- **Империализм:** борьба за колонии.\n"
        f"- **Национализм:** стремление народов к независимости и {QA_BROKEN}.\n"
        f"- Гонка вооружений. Второе предложение, где {QA_BROKEN}. Третье предложение.\n"
    )
    dropped = mixed_script.drop_text(content)
    assert "isticск" not in dropped
    assert dropped == "## Причины войны\n\n- **Империализм:** борьба за колонии.\n- Гонка вооружений. Третье предложение."
    payload = mixed_script.drop_broken({"question": f"Что такое {QA_BROKEN}?", "answer": "Ответ.", "source_ids": ["S01"]})
    assert payload == {"question": "", "answer": "Ответ.", "source_ids": ["S01"]}
    # Code and display formulas are not text: they stay whole, even with Latin next to Cyrillic.
    code = f"Пример. Был {QA_BROKEN}.\n```\nимяUser = 1\n```\n$$\nv_{{ср}} = s/t\n$$\nКонец."
    assert mixed_script.drop_text(code) == "Пример.\n```\nимяUser = 1\n```\n$$\nv_{ср} = s/t\n$$\nКонец."


def _summary(content: str) -> str:
    return json.dumps({"title": "Причины войны", "subject": "История", "content": content, "terms": []}, ensure_ascii=False)


def _answers(*texts):
    queue = list(texts)

    async def next_answer():
        return queue.pop(0) if len(queue) > 1 else queue[0]

    return next_answer


def _post_lecture(client):
    return client.post(
        "/api/analyze",
        files={"file": ("lecture.txt", io.BytesIO(LECTURE.encode("utf-8")), "text/plain")},
        data={"enabled_agents": json.dumps(["summarizer"])},
    )


def test_a_section_with_a_broken_word_is_asked_once_more(api, monkeypatch):
    calls = answer_with(monkeypatch, {"summarizer": _answers(
        _summary(f"Рост цен и {QA_BROKEN}."),
        _summary("Рост цен и рост ставки."),
    )})
    results = next(item for item in frames(_post_lecture(api).text) if item != "KA" and item["type"] == "results")
    assert results["summarizer"]["content"] == "Рост цен и рост ставки."
    assert calls == ["summarizer", "summarizer"]


def test_a_second_broken_answer_loses_the_sentence_and_look_alikes_are_fixed(api, monkeypatch):
    broken = _summary(f"Инфляция — рост цeн. Был {QA_BROKEN}. Ставку повышают.")  # Latin e in «цeн»
    calls = answer_with(monkeypatch, {"summarizer": _answers(broken, broken)})
    results = next(item for item in frames(_post_lecture(api).text) if item != "KA" and item["type"] == "results")
    assert results["sections"]["summarizer"] == {"status": "ok"}
    assert results["summarizer"]["content"] == "Инфляция — рост цен. Ставку повышают."
    assert calls == ["summarizer", "summarizer"]


def test_quick_prep_and_podcast_go_through_the_same_check(api, monkeypatch):
    from agents.base import BaseAgent

    prep = json.dumps({"key_points": ["Главное"], "cheatsheet": f"# Выжимка\n\nИнфляция — рост цен. Был {QA_BROKEN}.",
                       "questions": []}, ensure_ascii=False)
    runs = []

    async def run(self, system_prompt, user_text, **kwargs):
        runs.append(system_prompt[:20])
        return prep

    monkeypatch.setattr(BaseAgent, "run", run)
    response = api.post("/api/quick-prep", json={"context": LECTURE})
    assert response.status_code == 200
    assert response.json()["cheatsheet"] == "# Выжимка\n\nИнфляция — рост цен."
    assert len(runs) == 2  # asked once more, then the sentence went

    lines = iter([
        {"podcast": [{"speaker": "Макс", "text": f"Почему {QA_BROKEN}?"}, {"speaker": "Софья", "text": "Из-за цен."}]},
        {"podcast": [{"speaker": "Макс", "text": "Почему растут цены?"}, {"speaker": "Софья", "text": "Из-за спроса."}]},
    ])

    async def podcast(self, system_prompt, user_text, **kwargs):
        return json.dumps(next(lines), ensure_ascii=False)

    monkeypatch.setattr(BaseAgent, "run", podcast)
    response = api.post("/api/podcast/generate", json={"context": LECTURE})
    assert response.status_code == 200
    assert [line["text"] for line in response.json()["podcast"]] == ["Почему растут цены?", "Из-за спроса."]


# ── 4. Prompts: formulas, dates and numbers from the lecture only ─────────────────

PUSHES = ("ОБЯЗАТЕЛЬНО выписывай", "виджеты-симуляторы", "интерактивные парсеры", "v = s/t", "p = m/V",
          "ключевые формулы, критически важные даты")


def test_the_cheatsheet_prompt_no_longer_demands_formulas_and_omits_the_section_without_them():
    prompt = build_cheatsheet_prompt()
    for push in PUSHES:
        assert push not in prompt, push
    assert SOURCE_FACTS_RULE in prompt
    assert "«условно»" in SOURCE_FACTS_RULE and "«для симулятора»" in SOURCE_FACTS_RULE and "Не придумывай" in SOURCE_FACTS_RULE
    assert "Нет формул в лекции — нет этого раздела." in prompt
    assert "если их нет, этого раздела в выжимке нет совсем" in prompt
    assert "\n# Выжимка\n## Суть в 3 словах\n" in prompt  # the screen hides the first heading (cheatsheetDisplay.ts)


@pytest.mark.parametrize("detail", ["brief", "medium", "detailed"])
def test_the_notes_prompt_takes_facts_from_the_lecture_and_keeps_its_sections(detail):
    prompt = build_summarizer_prompt(detail)
    for push in PUSHES:
        assert push not in prompt, push
    assert SOURCE_FACTS_RULE in prompt
    keeps_sections = "Не сливай разные разделы в один" in prompt
    assert keeps_sections is (detail != "brief")
    assert "3-4 абзаца" not in prompt and "5-6 абзацев" not in prompt


@pytest.mark.parametrize("detail", ["medium", "detailed"])
def test_the_notes_retell_each_section_shorter_between_key_points_and_conclusions(detail):
    # After release 44 the medium notes of the QA biology PDF repeated 322 of its words in order and had neither
    # «Ключевые тезисы» nor «Выводы»: «keep the sections» had become «copy the sections».
    prompt = build_summarizer_prompt(detail)
    heads = ["## Ключевые тезисы", "## <название раздела лекции>", "## Выводы"]
    assert [prompt.index(head) for head in heads] == sorted(prompt.index(head) for head in heads)
    assert "в том же порядке" in prompt and "Не сливай разные разделы в один и не пропускай их" in prompt
    assert "пересказ раздела своими словами" in prompt
    assert "Конспект — это пересказ, а не копия лекции: не переписывай предложения лекции подряд" in prompt
    shorter = {"medium": ("примерно втрое короче самого раздела", "примерно треть объёма лекции"),
               "detailed": ("примерно вдвое короче самого раздела", "не больше половины объёма лекции")}[detail]
    assert all(part in prompt for part in shorter)
    assert "Точно, как в лекции, передавай только определения, формулы, даты, числа и имена" in prompt
    assert SOURCE_FACTS_RULE in prompt
    assert ("## Рекомендации по изучению" in prompt) is (detail == "detailed")
    # What SummaryView renders: content («## » headings are its parts) and terms («Термины», not a part of content).
    for key in ('"title"', '"subject"', '"content"', '"terms"', '"term"', '"definition"'):
        assert key in prompt
    assert "в поле terms, отдельный раздел «Термины» в content не нужен" in prompt


def test_the_brief_notes_and_unknown_levels_keep_their_prompts():
    brief = build_summarizer_prompt("brief")
    assert "краткий конспект: заголовок + 3-5 ключевых тезисов + 1 абзац выводов" in brief
    assert "## Ключевые тезисы" not in brief and "своими словами" not in brief
    assert build_summarizer_prompt("unknown") == build_summarizer_prompt("medium") == build_summarizer_prompt()


def test_no_material_prompt_pushes_formulas_and_every_analysis_prompt_is_grounded():
    for prompt in (build_flashcards_prompt(6), build_quiz_prompt(5), build_podcast_prompt(), build_quick_prep_prompt()):
        for push in PUSHES:
            assert push not in prompt, push
    assert SOURCE_FACTS_RULE in build_quick_prep_prompt()
    assert "формулы, даты и числа — только если они есть в тексте лекции" in build_quick_prep_prompt()
    assert "Не добавляй факты, числа, даты, имена и формулы, которых в нём нет" in build_podcast_prompt()
    prompts = build_prompts(normalize_settings(), build_source_chunks(LECTURE))
    for name in ("summarizer", "flashcards", "quiz", "cheatsheet", "podcast"):
        assert GROUNDING_INSTRUCTION in prompts[name]


# ── 5. Web pages ───────────────────────────────────────────────────────────────────

# The shape of a Reader answer for a Wikipedia article (QA logs/url-extracted.txt), with a text of our own.
READER_PAGE = """Title: Закон Ома

URL Source: https://ru.wikipedia.org/wiki/%D0%97%D0%B0%D0%BA%D0%BE%D0%BD_%D0%9E%D0%BC%D0%B0

Published Time: 2004-05-01T10:00:00Z

Markdown Content:
*   [Главная](https://ru.wikipedia.org/wiki/%D0%93%D0%BB "Главная")
*   [Случайная статья](https://ru.wikipedia.org/wiki/Special:Random)

| Закон Ома |
| --- |
| [![Image 1: Схема цепи с источником {\\displaystyle U} и резистором](https://upload.wikimedia.org/a.png?utm_source=ru)](https://commons.wikimedia.org/wiki/File:Ohm.svg?uselang=ru "Схема") Схема простой цепи |
| Открыт | [Георгом Омом](https://ru.wikipedia.org/wiki/%D0%9E%D0%BC_(%D1%84%D0%B8%D0%B7%D0%B8%D0%BA) "Ом") |
| Формула | ![Image 2: {\\displaystyle I=U/R}](https://wikimedia.org/api/rest_v1/media/math/render/svg/abc) |

**Зако\u0301н О\u0301ма**— эмпирический физический закон, связывающий [силу тока](https://ru.wikipedia.org/wiki/%D0%A1%D0%B8 "Сила тока")[в проводнике](https://ru.wikipedia.org/wiki/%D0%9F "Проводник") с напряжением[[1]](https://ru.wikipedia.org/wiki/%D0%97#cite_note-1) и сопротивлением[**➤**](https://ru.wikipedia.org/wiki/%D0%97#%D0%A4).

Сила тока на участке цепи равна![Image 3: {\\displaystyle I={\\frac {U}{R}}}](https://wikimedia.org/api/rest_v1/media/math/render/svg/def), где ![Image 4: {\\displaystyle R}](https://wikimedia.org/x)— сопротивление участка.

![Image 5: {\\displaystyle U=IR}](https://wikimedia.org/api/rest_v1/media/math/render/svg/ghi).

Основная статья: [Электрическое сопротивление](https://ru.wikipedia.org/wiki/%D0%AD)

[![Image 6](https://upload.wikimedia.org/photo.jpg)](https://commons.wikimedia.org/wiki/File:Photo.jpg)

## Применение

Закон помогает подобрать _предохранитель_ и рассчитать ток через прибор: `I = U / R`. Источник: <https://example.org/ohm>

## Примечания

1.   [↑](https://ru.wikipedia.org/wiki/%D0%97#cite_ref-1 "Обратно к тексту")_Иванов И. И._ Физика.— М.: Наука, 1990.— 300 с.

## Литература

*   _Сивухин Д. В._ Общий курс физики.— М.: Физматлит, 2004.— Т. 3.— 656 с.— [ISBN 5-9221-0227-3](https://ru.wikipedia.org/wiki/Special:BookSources/5922102273).

## Ссылки

*   [Закон Ома на сайте](http://example.org/ohm)(англ.)
"""


def test_a_reader_page_keeps_the_text_of_links_and_loses_addresses_images_and_references():
    text = clean_page_text(READER_PAGE)
    for junk in ("](", "http", "%D0", "![", "[1]", "➤", "↑", "Главная", "Случайная", "Основная статья", "Иванов",
                 "Сивухин", "ISBN", "Примечания", "Литература", "Ссылки", "URL Source", "Markdown Content", "**", "_пред"):
        assert junk not in text, junk
    assert text.startswith("Закон Ома\nСхема простой цепи\nОткрыт | Георгом Омом\nФормула | $I=U/R$\n")
    # The Reader drops spaces between links and before a dash; the stress marks go.
    assert "Закон Ома — эмпирический физический закон, связывающий силу тока в проводнике с напряжением и сопротивлением." in text
    assert "Сила тока на участке цепи равна $I={\\frac {U}{R}}$, где $R$ — сопротивление участка." in text
    assert "\n$U=IR$.\n" in text  # a formula on its own line is text, not a picture
    assert "Закон помогает подобрать предохранитель и рассчитать ток через прибор: `I = U / R`. Источник:" in text
    assert "Применение" in text
    assert len(text) < len(READER_PAGE) / 2


def test_lists_of_the_lecture_itself_stay():
    """One weak sign of a reference («5 с.» — seconds, or pages?) does not drop a list item of the text."""
    page = (
        "Markdown Content:\n- Время реакции — 5 с.\n- Скорость — 10 м/с.\n"
        "- [Закон Ома](https://example.org/ohm) — связывает ток и напряжение\n"
    )
    assert clean_page_text(page) == "- Время реакции — 5 с.\n- Скорость — 10 м/с.\n- Закон Ома — связывает ток и напряжение"


def test_the_qa_page_shape_reads_short_and_fragments_have_no_addresses():
    """The 89 532 characters of the QA page («около 112 мин») were mostly addresses: the text counts now."""
    page = "\n".join([READER_PAGE.split("## Применение")[0]] * 3)
    text = clean_page_text(page)
    for chunk in build_source_chunks(text):
        assert "http" not in chunk["text"] and "](" not in chunk["text"] and "%D0" not in chunk["text"]
    assert len(text) * 4 < len(page)


def test_the_local_fallback_keeps_spaces_between_links_and_skips_menus_and_footnotes():
    html = """<html><body><nav><a href="/">Главная</a></nav><div id="toc">Содержание</div>
    <h1>Закон Ома</h1>
    <p><b>Закон Ома</b> — связывает <a href="/a">силу тока</a> <a href="/b">в проводнике</a> с напряжением<sup class="reference"><a href="#n1">[1]</a></sup>.</p>
    <ul><li><a href="/x">Случайная статья</a></li><li>Сопротивление зависит от <i>материала</i>.</li></ul>
    <table><tr><th>Величина</th><th>Единица</th></tr><tr><td>Ток</td><td>ампер</td></tr></table>
    <h2>Примечания</h2><ol class="references"><li>Иванов И. И. Физика. — М.: Наука, 1990.</li></ol>
    </body></html>"""
    text = clean_page_text(utils._html_page_markdown(html))
    assert "Закон Ома — связывает силу тока в проводнике с напряжением." in text
    assert "- Сопротивление зависит от материала." in text and "Величина | Единица\nТок | ампер" in text
    for junk in ("Главная", "Случайная", "Содержание", "[1]", "Примечания", "Иванов"):
        assert junk not in text, junk


class FakeHttp:
    """httpx.AsyncClient for scrape_url: ``pages`` — URL → (status, text)."""

    pages: dict = {}

    def __init__(self, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def get(self, url, **kwargs):
        status, text = FakeHttp.pages.get(url, (404, ""))
        return SimpleNamespace(status_code=status, text=text, headers={})


@pytest.fixture
def web(monkeypatch):
    import httpx

    async def public(url):
        return None

    monkeypatch.setattr(httpx, "AsyncClient", FakeHttp)
    monkeypatch.setattr(utils, "_assert_public_target", public)
    FakeHttp.pages = {}
    return FakeHttp


def test_scrape_url_cleans_the_reader_text_and_the_local_fallback(web):
    url = "https://ru.wikipedia.org/wiki/Закон_Ома"
    web.pages = {f"https://r.jina.ai/{url}": (200, READER_PAGE)}
    text = asyncio.run(utils.scrape_url(url))
    assert text == clean_page_text(READER_PAGE) and "http" not in text

    web.pages = {url: (200, "<html><body><h1>Закон Ома</h1><p>Сила тока равна <a href='/u'>напряжению</a>, "
                            "делённому на сопротивление.</p></body></html>")}
    assert asyncio.run(utils.scrape_url(url)) == "Закон Ома\nСила тока равна напряжению, делённому на сопротивление."


# ── 6. PDF ─────────────────────────────────────────────────────────────────────────


def test_the_qa_pdf_headings_come_out_whole_and_its_sections_make_the_fragments():
    data = (FIXTURES / "cell_lecture_chromium.pdf").read_bytes()
    # What PyPDF2 alone gave on the live site: 7 of 8 headings split inside words.
    old = "\n".join(page.extract_text() for page in PdfReader(io.BytesIO(data)).pages)
    assert "Строение эук арио тиче ской клетки" in old and "2. М ембрана и цит оплаз ма" in old
    text = lecture_parser.extract_text(data, "Биология_строение_клетки.pdf")
    assert text.startswith("Строение эукариотической клетки\nЛекция 3 курса «Общая биология»\n1. Клеточная теория\n")
    for heading in ("2. Мембрана и цитоплазма", "4. Митохондрии", "5. Рибосомы и синтез белка",
                    "6. Эндоплазматическая сеть и аппарат Гольджи", "7. Лизосомы", "8. Отличия растительной клетки"):
        assert f"\n{heading}\n" in text, heading
    assert "эук арио" not in text and "\n1\n" not in text and not text.endswith("\n2")  # page numbers go
    # One fragment per section of the lecture (was 4 fragments cut by words).
    chunks = build_source_chunks(text)
    assert [chunk["text"].split("\n")[0] for chunk in chunks][1:] == [
        "2. Мембрана и цитоплазма", "3. Ядро", "4. Митохондрии", "5. Рибосомы и синтез белка",
        "6. Эндоплазматическая сеть и аппарат Гольджи", "7. Лизосомы", "8. Отличия растительной клетки",
    ]


def simple_pdf(content: str, *, widths: bool = True) -> bytes:
    """One A4 page with /F1 — Helvetica, WinAnsiEncoding: with ``widths`` every glyph is 0.5 em wide and the
    space 0.25 em; without them (one of the 14 standard fonts) the page is read by PyPDF2 as before."""
    font = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding"
    if widths:
        font += " /FirstChar 32 /LastChar 126 /Widths [" + " ".join(["250"] + ["500"] * 94) + "]"
    data = content.encode("latin-1")
    objects = {
        1: b"<< /Type /Catalog /Pages 2 0 R >>",
        2: b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        3: b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        4: (font + " >>").encode(),
        5: b"<< /Length %d >>\nstream\n" % len(data) + data + b"\nendstream",
    }
    out = io.BytesIO()
    out.write(b"%PDF-1.4\n")
    offsets = {}
    for key in sorted(objects):
        offsets[key] = out.tell()
        out.write(f"{key} 0 obj\n".encode() + objects[key] + b"\nendobj\n")
    xref = out.tell()
    out.write(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode())
    for key in sorted(objects):
        out.write(f"{offsets[key]:010d} 00000 n \n".encode())
    out.write(f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
    return out.getvalue()


@pytest.mark.parametrize("content, expected", [
    # Chromium: a bold heading written in kerning pieces, spaces as characters (PyPDF2: «Stro enie euk ariotic»).
    ("BT /F1 20 Tf 1 0 0 1 72 700 Tm (Stro) Tj 39.5 0 Td (enie euk) Tj 74.8 0 Td (ariotic cells) Tj ET",
     "Stroenie eukariotic cells"),
    # TeX: no space characters, a word gap is a TJ shift; a small shift is kerning.
    ("BT /F1 10 Tf 72 700 Td [(Mean) -333 (fr) -20 (ee) -333 (path)] TJ ET", "Mean free path"),
    # Every word placed on its own, no space characters (PyPDF2: «Onetwosix»).
    ("BT /F1 10 Tf 72 700 Td (One) Tj 17.5 0 Td (two) Tj 17.5 0 Td (six) Tj ET", "One two six"),
    # A superscript stays on its line.
    ("BT /F1 12 Tf 72 700 Td (Area m) Tj /F1 8 Tf 4 Ts (2) Tj /F1 12 Tf 0 Ts ( is S) Tj ET", "Area m2 is S"),
    # Character spacing (Tc) is part of the advance, not a gap.
    ("BT /F1 12 Tf 2 Tc 72 700 Td (Spaced) Tj 0 Tc ( out) Tj ET", "Spaced out"),
    # A wider gap or a bigger font starts a paragraph; the page number far below the text goes.
    ("BT /F1 12 Tf 72 700 Td (First line of a paragraph.) Tj 0 -14 Td (Second line ends it.) Tj ET "
     "BT /F1 16 Tf 72 650 Td (Next part) Tj ET BT /F1 12 Tf 72 630 Td (Body of the next part.) Tj ET "
     "BT /F1 9 Tf 300 40 Td (2) Tj ET",
     "First line of a paragraph.\nSecond line ends it.\n\nNext part\nBody of the next part."),
])
def test_pdf_text_is_read_by_the_position_of_its_letters(content, expected):
    assert lecture_parser.extract_text(simple_pdf(content), "lecture.pdf") == expected


def test_a_page_the_reader_cannot_measure_keeps_pypdf2s_text():
    rotated = simple_pdf("BT /F1 12 Tf 0 1 -1 0 100 100 Tm (Vertical words) Tj ET")
    reader = PdfReader(io.BytesIO(rotated))
    assert lecture_parser._pdf_page_paragraphs(reader.pages[0], reader) is None
    assert lecture_parser.extract_text(rotated, "x.pdf") == "Vertical words"
    standard = simple_pdf("BT /F1 12 Tf 72 700 Td (Standard font) Tj ET", widths=False)  # no /Widths
    reader = PdfReader(io.BytesIO(standard))
    assert lecture_parser._pdf_page_paragraphs(reader.pages[0], reader) is None
    assert lecture_parser.extract_text(standard, "x.pdf") == "Standard font"


# ── 7. Near-empty texts ────────────────────────────────────────────────────────────

ALMOST_EMPTY = "Лекция 1. Введение.\n"  # QA inputs/neg/почти_пусто.txt


def test_a_near_empty_file_ends_with_a_clear_message_before_any_model_call(api, monkeypatch):
    import main

    calls = answer_with(monkeypatch, {"summarizer": SUMMARY})
    response = api.post("/api/analyze", files={"file": ("почти_пусто.txt", io.BytesIO(ALMOST_EMPTY.encode()), "text/plain")})
    assert frames(response.text) == [{"type": "error", "code": "no_text", "message": main.TOO_LITTLE_TEXT_MESSAGES["file"]}]
    assert calls == []
    assert main.TOO_LITTLE_TEXT_MESSAGES["file"].startswith("В файле слишком мало текста: нужно хотя бы 200 знаков")
    assert main.LECTURE_MIN_CHARS == 200
    # Letters and digits count, not spaces and dots.
    padded = ALMOST_EMPTY + " " * 400 + "." * 300
    response = api.post("/api/analyze", files={"file": ("lecture.txt", io.BytesIO(padded.encode()), "text/plain")})
    assert frames(response.text)[-1]["message"] == main.TOO_LITTLE_TEXT_MESSAGES["file"]


def test_a_near_empty_page_recording_or_photo_says_what_was_short(api, monkeypatch):
    import main

    async def scrape(url):
        return "Закон Ома"

    async def transcribe(path, mime_type=None, **kwargs):
        return "Ну что, начнём."

    monkeypatch.setattr(main, "scrape_url", scrape)
    monkeypatch.setattr(main, "transcribe_media_file", transcribe)
    calls = answer_with(monkeypatch, {"summarizer": SUMMARY})
    items = frames(api.post("/api/analyze/url", data={"url": "https://example.com/ohm"}).text)
    assert items[-1] == {"type": "error", "code": "no_text", "message": main.TOO_LITTLE_TEXT_MESSAGES["url"]}
    items = frames(api.post("/api/analyze/media", files={"file": ("talk.mp3", io.BytesIO(b"ID3"), "audio/mpeg")}).text)
    assert items[-1] == {"type": "error", "code": "no_text", "message": main.TOO_LITTLE_TEXT_MESSAGES["recording"]}
    assert calls == []
    for message in main.TOO_LITTLE_TEXT_MESSAGES.values():
        assert "Лимит не списан." in message and "200" in message


# ── 8. Formats ─────────────────────────────────────────────────────────────────────

RECORDINGS = "для записей лекций подходят MP4, MP3, WAV, MPEG и M4A"


def test_format_refusals_say_what_fits_instead():
    assert unsupported_format_detail("Лекция_философия.doc") == DOC_LEGACY_DETAIL
    assert DOC_LEGACY_DETAIL == "Старый формат Word (.doc) не читается. Сохраните файл как DOCX или PDF и загрузите снова."
    assert unsupported_format_detail("Слайды.PPT", media=True) == PPT_LEGACY_DETAIL
    for name in ("голосовое_сообщение.ogg", "note.opus", "screen.webm", "IMG_0001.MOV"):
        detail = unsupported_format_detail(name, media=True)
        extension = name.rsplit(".", 1)[1].upper()
        assert detail.startswith(f"Формат {extension} не подходит: {RECORDINGS}."), detail
        assert "Конвертируйте запись" in detail and "JPG" not in detail and "PNG" not in detail
    assert unsupported_format_detail("voice", "audio/ogg", media=True).startswith(f"Этот формат не подходит: {RECORDINGS}.")
    assert unsupported_format_detail("photo.heic", media=True).startswith("Формат HEIC не подходит: для фото страниц подходят JPG и PNG.")
    assert unsupported_format_detail("table.xlsx", media=True) == MEDIA_FORMAT_DETAIL
    assert unsupported_format_detail("table.xlsx") == DOCUMENT_FORMAT_DETAIL


def test_the_routes_refuse_doc_and_voice_notes_with_these_messages(api):
    import exams_api

    files = {"file": ("Лекция_философия.doc", io.BytesIO(b"\xd0\xcf\x11\xe0"), "application/msword")}
    response = api.post("/api/analyze", files=files)
    assert response.status_code == 400 and response.json() == {"detail": DOC_LEGACY_DETAIL}
    files = {"file": ("голосовое_сообщение.ogg", io.BytesIO(b"OggS"), "audio/ogg")}
    response = api.post("/api/analyze/media", files=files)
    assert response.status_code == 400 and response.json() == {"detail": unsupported_format_detail("x.ogg", media=True)}
    assert ".jpg" not in response.text and ".png" not in response.text
    files = {"file": ("Лекция_философия.doc", io.BytesIO(b"\xd0\xcf\x11\xe0"), "application/msword")}
    response = api.post("/api/extract", files=files)
    assert response.status_code == 415 and response.json() == {"detail": DOC_LEGACY_DETAIL}
    assert exams_api.DOC_LEGACY_DETAIL == DOC_LEGACY_DETAIL
    with pytest.raises(lecture_parser.UnsupportedFormat):
        lecture_parser.extract_text(b"\xd0\xcf\x11\xe0", "old.doc")
