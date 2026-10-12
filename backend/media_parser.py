import os
import re
import tempfile
import time
import asyncio
from collections import deque
from typing import Callable, Optional
from youtube_transcript_api import YouTubeTranscriptApi
import yt_dlp
from google import genai
from google.genai import types
import random

import audio_pieces
from agents.base import (
    AIError,
    SAFETY_SETTINGS,
    _retry_after_seconds,
    classify_error,
    gemini_keys,
    gemini_models_env,
    provider_error_code,
    thinking_plan,
)
from ocr import OCR_INLINE_MAX_BYTES, OCR_PROMPT, recognize_image

# Recordings of lectures, measured live on the same 2:50 MP3 of a physics lecture (account B, 2026-10-11):
# - whisper-large-v3-turbo, no language, no prompt: 84.6 % of the lecture's words, one ~10 s passage skipped,
#   nothing invented;
# - release 44, whisper-large-v3 first, language ru, the prompt «Запись лекции на русском языке. Тема: {topic}.»
#   with the topic from the file name: 32.0, 75.2 and 76.1 % in three runs. Where the turbo skipped, it wrote
#   sentences nobody said («…мы поистине придерживаемся высокого депрессанта…»), and one run stopped at 45 s
#   with «. . Лекция физика закон Ома. Лекция физика закон Ома. Субтитры создавал DimaTorzok» — the prompt
#   read back and a subtitle credit Whisper picked up in training.
# So a lecture gets the turbo model and no prompt. whisper-large-v3 is not asked by default: the invented
# sentences came only from its runs, and a sentence made up silently is worse for a student than a busy
# message; GROQ_LECTURE_TRANSCRIPTION_MODEL can still name it. The language stays ru: without it Whisper picks
# one language from the first 30 s and then decodes as if it had been given (the reference code,
# openai/whisper transcribe.py), so a Russian lecture comes out the same, and a quiet or musical start cannot
# turn the whole file into another language. A lecture in another language would come out in Russian words —
# the trade the spoken answers (stt.py) already make.
# Temperature 0, as before.
#
# Long recordings, measured 2026-10-12 through the live /api/oral/transcribe (the turbo, language ru, no prompt,
# temperature 0, a QA account; recall = the share of the script's words found in order):
# - the same 2:50 MP3: the whole file 84.0–85.3 % in three runs, the same 25-word passage dropped every time;
#   pieces cut at pauses of about 30 s 92.2–92.8 %, 60 s 90.8–92.2 %, 90 s 91.2–92.2 %, no passage dropped. What
#   still differs is mostly numbers written as digits and a few terms («вултметр», «нихума»).
# - Cut at the last pause before each mark, a piece sometimes ended inside a sentence, and Whisper closed it with
#   «Спасибо.» or the half-sentence again; cut at the longest pause in the second half of the window, neither came
#   back (90.8–92.2 %, no extra words).
# - 19:25 m4a (AAC 64 kbps; six lectures read by an edge-tts voice, pauses up to 7 s, room echo, pink noise): the
#   whole file through production (release 44.6) 86.4 %, four passages dropped (9, 34, 27 and 21 words, one
#   replaced by «19»); 60 s pieces 90.0 %, two dropped (39 and 9); 30 s pieces (15–30 s long) 91.9 %, none dropped.
#   A piece of 15–30 s took 1.6 s (median) end to end.
# Whisper skips passages in its long-form decoding, where it seeks from one 30 s window to the next; a piece of at
# most 30 s is one window and is not skipped. So a recording longer than 32 s goes to Groq in pieces of at most 30 s
# cut at pauses (audio_pieces.py, _transcribe_in_pieces below); a shorter one, as before, whole.
GROQ_LECTURE_MODEL_DEFAULT = "whisper-large-v3-turbo"
TRANSCRIPTION_LANGUAGE = "ru"
# Groq reads these files as they are (flac, mp3, mp4, mpeg, mpga, m4a, ogg, wav, webm); a video lecture
# (MP4, MPEG) goes to Whisper too, its first audio track.
GROQ_MEDIA_TYPES = ("audio/", "video/mp4", "video/mpeg")
GROQ_MEDIA_EXTENSIONS = (".mp3", ".mp4", ".mpeg", ".mpga", ".m4a", ".wav", ".ogg", ".webm", ".flac")

MEDIA_TRANSCRIPTION_PROMPT = (
    "Это запись учебной лекции, чаще всего на русском языке. Запиши дословно всё, что сказано, от начала "
    "до конца, ничего не пропуская и не пересказывая, с обычной пунктуацией, на языке оригинала. "
    "Термины, фамилии и названия пиши так, как их произносит лектор; единицы измерения — полными словами "
    "(«вольт», «вольтметр», а не «В», «Вт»), числа — цифрами. Не добавляй заголовков, пояснений и отметок времени."
)
# Low temperature for a word-for-word transcript; gemini-3 keeps its default, as Google advises (ocr.py).
MEDIA_TRANSCRIPTION_TEMPERATURE = 0.1

MEDIA_PROCESSING_TIMEOUT_MESSAGE = "Расшифровка заняла слишком много времени. Попробуйте файл короче."


class MediaProcessingTimeout(Exception):
    """Google kept the uploaded file in PROCESSING longer than MEDIA_PROCESSING_POLL_SECONDS, or the pieces of a long
    recording did not fit the caller's deadline."""

    def __init__(self, message: str = MEDIA_PROCESSING_TIMEOUT_MESSAGE):
        super().__init__(message)


def media_processing_poll_seconds() -> float:
    try:
        value = float(os.getenv("MEDIA_PROCESSING_POLL_SECONDS", "120") or 120)
    except ValueError:
        return 120.0
    return value if value > 0 else 120.0


def lecture_transcription_models() -> list[str]:
    """Whisper models for a lecture: GROQ_LECTURE_TRANSCRIPTION_MODEL, then GROQ_TRANSCRIPTION_MODEL (the model of
    spoken answers, stt.py) when the first is busy or gone. Both default to whisper-large-v3-turbo, the model that
    measured best, so without them it is the only one and Gemini comes next."""
    models = []
    for name in ("GROQ_LECTURE_TRANSCRIPTION_MODEL", "GROQ_TRANSCRIPTION_MODEL"):
        model = os.getenv(name, "").strip() or GROQ_LECTURE_MODEL_DEFAULT
        if model not in models:
            models.append(model)
    return models


# Where it hears no clear speech, and after the last word, Whisper writes lines of the subtitles it learned from:
# credits of Russian subtitles («Субтитры создавал DimaTorzok» ended a live transcript, 2026-10-11, see above),
# «Продолжение следует…», «Спасибо за просмотр», the same sentence again and again at the end. Only these go: a
# whole sentence, or a credit glued to the end of one; a sentence that merely mentions subtitles or a proofreader
# stays. (stt.py drops more for a spoken answer, where a short phrase is the whole answer.)
# A sentence ends at a line break, or at . ! ? or … before a space, but not at an initial: «Корректор
# А. Егорова» is one sentence.
_SENTENCE_BREAK_RE = re.compile(r"\n\s*|(?<=[.!?…])(?<!\b[А-ЯЁA-Z]\.)\s+")
_CREDIT_LINE = (
    r"(?:Субтитры\s+(?:создавал|сделал|делал|подготовил)а?(?:\s+\S+){1,4}"
    r"|Редактор\s+субтитров(?:\s+\S+){0,6}"
    # A name with initials after it («Корректор А.Егорова»), not «Корректор — это …».
    r"|Корректор(?:ка)?\s+(?:[А-ЯЁ]\.\s?){1,2}[А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?"
    r"|Продолжение\s+следует)"
)
# The whole sentence is a credit.
_CREDIT_SENTENCE_RE = re.compile(_CREDIT_LINE, re.IGNORECASE)
# A credit glued to the end of a sentence (Whisper's pieces do not always end with a full stop: «…большое, Но,
# в точку…» in a live run): after a space, with the capital letter a new piece starts with.
_CREDIT_TAIL_RE = re.compile(r"(?<![ \t])[ \t]+" + _CREDIT_LINE + r"[.!?…»\"']*$")
# This nickname is a credit wherever it stands: no lecture has it.
_NICKNAME_RE = re.compile(r"(?:субтитры\S*\s+(?:\S+\s+)?)?dimatorzok\S*", re.IGNORECASE)
# Only when it stands alone at the very end: a lecturer says it too, and then it carries nothing to learn.
_LAST_THANKS_RE = re.compile(r"спасибо\s+за\s+(?:просмотр|внимание)", re.IGNORECASE)
_WORD_RE = re.compile(r"\w+")


def _sentence_core(sentence: str) -> str:
    return sentence.strip().lstrip("«\"'").rstrip(".!?…»\"' ").strip()


def _sentence_words(sentence: str) -> str:
    return " ".join(_WORD_RE.findall(sentence.lower().replace("ё", "е")))


def _without_made_up_lines(sentence: str) -> str:
    """The sentence without a credit in it; '' when nothing else is left («.» between two sentences included)."""
    if _CREDIT_SENTENCE_RE.fullmatch(_sentence_core(sentence)):
        return ""
    cleaned = _CREDIT_TAIL_RE.sub("", _NICKNAME_RE.sub("", sentence))
    if cleaned != sentence:
        cleaned = re.sub(r"[ \t]{2,}", " ", cleaned).strip()
    return cleaned if _WORD_RE.search(cleaned) else ""


def clean_whisper_transcript(text: str) -> str:
    """Whisper's transcript without the lines it makes up (above): subtitle credits and «Продолжение следует…»
    anywhere, «Спасибо за просмотр/внимание» standing alone at the very end, and a sentence repeated at the end
    kept once (a loop usually repeats a sentence that was said). Everything else stays as it was, spaces and
    line breaks included; '' when nothing else was there."""
    text = (text or "").strip()
    if not text:
        return ""
    pieces: list[list[str]] = []  # [sentence, the space after it]
    start = 0
    for match in _SENTENCE_BREAK_RE.finditer(text):
        pieces.append([text[start:match.start()], match.group()])
        start = match.end()
    pieces.append([text[start:], ""])

    kept: list[list[str]] = []
    changed = 0
    for sentence, space in pieces:
        cleaned = _without_made_up_lines(sentence)
        changed += cleaned != sentence
        if cleaned:
            kept.append([cleaned, space])
        elif kept and space.count("\n") > kept[-1][1].count("\n"):
            kept[-1][1] = space  # a paragraph break after a dropped sentence stays
    while kept and (
        _LAST_THANKS_RE.fullmatch(_sentence_core(kept[-1][0]))
        or (len(kept) > 1 and _sentence_words(kept[-1][0]) == _sentence_words(kept[-2][0]))
    ):
        kept.pop()
        changed += 1
    if changed:
        print(f"Whisper transcript: {changed} made-up sentence(s) dropped or cut")
    return "".join(sentence + space for sentence, space in kept).strip()


def _groq_reads(file_path: str, mime_type: str | None) -> bool:
    return bool(mime_type and mime_type.startswith(GROQ_MEDIA_TYPES)) and file_path.lower().endswith(GROQ_MEDIA_EXTENSIONS)


async def _groq_text(client, file_path: str, mime_type: str, before_request=None) -> str:
    """Whisper's raw text of one file (a whole recording or a piece of one). No prompt: release 44's topic prompt came
    back as text (see above). The next model is asked only when one is busy (429) or not there any more (404); any
    other failure is raised. ``before_request`` is awaited before each request (the pieces' pace)."""
    models = lecture_transcription_models()
    for index, model in enumerate(models):
        if before_request is not None:
            await before_request()
        try:
            with open(file_path, "rb") as audio_file:
                response = await client.audio.transcriptions.create(
                    model=model,
                    file=(os.path.basename(file_path), audio_file, mime_type),
                    language=TRANSCRIPTION_LANGUAGE,
                    response_format="text",
                    temperature=0,
                )
        except Exception as exc:
            gone = provider_error_code(exc) in ("model_decommissioned", "model_not_found")
            if index + 1 < len(models) and (gone or classify_error(exc) in ("rate_limited", "not_found")):
                print(f"Groq transcription: {model} unavailable ({classify_error(exc)}), trying {models[index + 1]}")
                continue
            raise
        return response if isinstance(response, str) else str(getattr(response, "text", "") or "")
    return ""


async def _transcribe_audio_with_groq(file_path: str, mime_type: str | None) -> str:
    """Whisper's text of the whole recording without the lines it makes up (clean_whisper_transcript; '' without a
    key or when nothing else was heard). A failure goes to Gemini at once (transcribe_media_file)."""
    api_key = os.getenv("GROQ_API_KEY", "").strip()
    if not api_key:
        return ""

    from groq import AsyncGroq

    return clean_whisper_transcript(await _groq_text(AsyncGroq(api_key=api_key), file_path, mime_type or "audio/mpeg"))


# The pieces of a long recording (above, audio_pieces.py) go to Groq as the whole file did (the models, language,
# temperature and format above, no prompt), at most GROQ_AUDIO_CONCURRENCY at a time, and the whole process starts at
# most GROQ_AUDIO_RPM of these requests in any 60 s: Groq's free plan allows 20 requests a minute per organization.
# The spoken answers (stt.py, one request each) are not paced here.
GROQ_AUDIO_CONCURRENCY_DEFAULT = 4
GROQ_AUDIO_RPM_DEFAULT = 20
GROQ_AUDIO_WINDOW_SECONDS = 60.0
# A 429 asking for at most 30 s is waited for (10 s when Groq names no time) and the piece tried again, at most
# twice. One asking for longer (the hourly audio allowance used up, say) sends the piece to Gemini at once, and
# Groq rests: every piece of this and later recordings goes to Gemini until that time is up. Any other failure is
# tried once more after a second. Then the piece goes to Gemini; no wait runs past the deadline.
GROQ_BUSY_WAIT_MAX_SECONDS = 30.0
GROQ_BUSY_WAIT_SECONDS = 10.0
GROQ_BUSY_RETRIES = 2
GROQ_PIECE_RETRY_SECONDS = 1.0
# The deadline of a caller that gives none; the analysis stream passes its own (main.py, MEDIA_TRANSCRIBE_TIMEOUT_SECONDS).
PIECES_BUDGET_SECONDS = 480.0
# Pieces cut at a pause at least this long are joined as paragraphs, the others with a space.
PARAGRAPH_PAUSE_SECONDS = 1.5
# At a cut inside a sentence Whisper closed a piece with «Спасибо.» (measured above): a piece that is not the last
# one loses a last sentence that is nothing but thanks or «Продолжение следует…».
_PIECE_END_RE = re.compile(r"спасибо(?:\s+за\s+(?:внимание|просмотр))?|продолжение\s+следует", re.IGNORECASE)

# When this process started the pieces' requests to Groq (time.monotonic()), the last GROQ_AUDIO_WINDOW_SECONDS.
_groq_audio_starts: deque = deque()
# Until when (time.monotonic()) Groq rests after a 429 that asked for more than GROQ_BUSY_WAIT_MAX_SECONDS.
_groq_rests_until = 0.0


class _GroqResting(Exception):
    """Groq rests after a long 429: the piece goes to Gemini."""


def _rest_groq(now: float, seconds: float) -> None:
    global _groq_rests_until
    if now >= _groq_rests_until:
        print(f"Lecture pieces: Groq asks to wait {seconds:.0f} s (429); the pieces go to Gemini until then")
    _groq_rests_until = max(_groq_rests_until, now + seconds)


def _positive_int_env(name: str, default: int) -> int:
    try:
        value = int(os.getenv(name, "") or default)
    except ValueError:
        return default
    return value if value > 0 else default


async def _groq_audio_turn(clock, sleep, deadline: float) -> None:
    """Waits until the process has started fewer than GROQ_AUDIO_RPM pieces' requests in the last 60 s and counts one
    more; _GroqResting while Groq rests (also after the wait), MediaProcessingTimeout when the turn is not before the
    deadline."""
    limit = _positive_int_env("GROQ_AUDIO_RPM", GROQ_AUDIO_RPM_DEFAULT)
    while True:
        now = clock()
        if now < _groq_rests_until:
            raise _GroqResting()
        while _groq_audio_starts and _groq_audio_starts[0] <= now - GROQ_AUDIO_WINDOW_SECONDS:
            _groq_audio_starts.popleft()
        if len(_groq_audio_starts) < limit:
            if now >= deadline:
                raise MediaProcessingTimeout()
            _groq_audio_starts.append(now)
            return
        free_at = _groq_audio_starts[len(_groq_audio_starts) - limit] + GROQ_AUDIO_WINDOW_SECONDS
        if free_at >= deadline:
            raise MediaProcessingTimeout()
        await sleep(free_at - now)


def _without_closing_thanks(text: str) -> str:
    while text:
        breaks = list(_SENTENCE_BREAK_RE.finditer(text))
        last = text[breaks[-1].end():] if breaks else text
        if not _PIECE_END_RE.fullmatch(_sentence_core(last)):
            break
        text = text[:breaks[-1].start()].rstrip() if breaks else ""
    return text


async def _groq_piece_text(client, path: str, clock, sleep, deadline: float) -> Optional[str]:
    """Whisper's text of one piece, or None when it is Gemini's: Groq rests or asks for a long wait (which makes it
    rest), the piece's retries are used up, or the next wait would not end before the deadline (above)."""
    busy_retries, retried = 0, False
    while True:
        try:
            return await _groq_text(client, path, "audio/wav", lambda: _groq_audio_turn(clock, sleep, deadline))
        except MediaProcessingTimeout:
            raise
        except _GroqResting:
            return None
        except Exception as exc:
            kind = classify_error(exc)
            if kind == "rate_limited":
                retry_after = _retry_after_seconds(exc)
                if retry_after is not None and retry_after > GROQ_BUSY_WAIT_MAX_SECONDS:
                    _rest_groq(clock(), retry_after)
                    return None
                wait = GROQ_BUSY_WAIT_SECONDS if retry_after is None else retry_after
                busy_retries += 1
                again = busy_retries <= GROQ_BUSY_RETRIES
            else:
                wait, again, retried = GROQ_PIECE_RETRY_SECONDS, not retried, True
            if not again or clock() + wait >= deadline:
                print(f"Lecture pieces: Groq failed on a piece ({kind}); Gemini transcribes it")
                return None
            if kind == "rate_limited":
                print(f"Lecture pieces: Groq is busy (429), a piece waits {wait:.0f} s")
            await sleep(wait)


async def _piece_text(client, path: str, last: bool, clock, sleep, deadline: float) -> str:
    """The text of one piece: Whisper (_groq_piece_text), else Gemini with the piece's bytes inline. Cleaned as a
    whole transcript is, and without closing thanks unless it is the last piece."""
    text = await _groq_piece_text(client, path, clock, sleep, deadline)
    if text is None:
        if clock() >= deadline:
            raise MediaProcessingTimeout()
        with open(path, "rb") as piece_file:
            data = piece_file.read()
        text = await _transcribe_with_gemini(
            None, "audio/wav", inline=types.Part.from_bytes(data=data, mime_type="audio/wav")
        )
    text = clean_whisper_transcript(text)
    return text if last else _without_closing_thanks(text)


def _join_pieces(pieces: list[audio_pieces.Piece], texts: list[str]) -> str:
    """The pieces' texts in order: a paragraph break where the cut pause lasted PARAGRAPH_PAUSE_SECONDS or more (also
    across a piece with no text), a space elsewhere."""
    joined = ""
    paragraph = False
    for piece, text in zip(pieces, texts):
        if text:
            if joined:
                joined += "\n\n" if paragraph else " "
            joined += text
            paragraph = False
        paragraph = paragraph or piece.pause >= PARAGRAPH_PAUSE_SECONDS
    return joined


async def _transcribe_in_pieces(
    file_path: str,
    progress: Optional[Callable[[float, float], None]] = None,
    deadline: Optional[float] = None,
    clock: Callable[[], float] = time.monotonic,
    sleep=asyncio.sleep,
) -> Optional[str]:
    """The text of a recording longer than 32 s from its pieces (above), or None when it goes whole instead: no Groq
    key, no ffmpeg, a recording of at most 32 s, or ffmpeg failed on it (logged once, without the file's name).

    ``progress(seconds done, seconds in all)`` after each piece; MediaProcessingTimeout when ``deadline`` (a
    ``clock()`` value; time.monotonic() unless a test gives its own clock) comes first. A piece that neither Groq nor
    Gemini could transcribe fails the whole transcription (AIError.busy() when it was rate limiting). The pieces live
    in one temporary directory, removed in the end whatever happens."""
    api_key = os.getenv("GROQ_API_KEY", "").strip()
    if not api_key:
        return None
    exe = audio_pieces.ffmpeg_exe()
    if not exe:
        print("Lecture pieces: no ffmpeg; the recording goes to Whisper whole")
        return None
    started = clock()
    if deadline is None:
        deadline = started + PIECES_BUDGET_SECONDS
    with tempfile.TemporaryDirectory(prefix="meldy-pieces-") as directory:
        try:
            duration, pauses = await audio_pieces.find_pauses(exe, file_path)
            if duration <= audio_pieces.WHOLE_MAX_SECONDS:
                return None
            pieces = audio_pieces.plan_pieces(duration, pauses)
            if len(pieces) < 2:
                return None
            paths = await audio_pieces.cut_pieces(exe, file_path, pieces, directory)
        except audio_pieces.FfmpegError as exc:
            print(f"Lecture pieces: ffmpeg {exc}; the recording goes to Whisper whole")
            return None

        from groq import AsyncGroq

        # No retries inside the SDK: they would start requests the pace does not count. _piece_text retries.
        client = AsyncGroq(api_key=api_key, max_retries=0)
        slots = asyncio.Semaphore(_positive_int_env("GROQ_AUDIO_CONCURRENCY", GROQ_AUDIO_CONCURRENCY_DEFAULT))
        done = 0.0

        async def transcribe(index: int) -> str:
            nonlocal done
            async with slots:
                text = await _piece_text(client, paths[index], index + 1 == len(pieces), clock, sleep, deadline)
            done += pieces[index].end - pieces[index].start
            if progress is not None:
                progress(done, duration)
            return text

        # The first failure cancels the other pieces (and their requests) before the directory goes.
        try:
            async with asyncio.TaskGroup() as group:
                tasks = [group.create_task(transcribe(index)) for index in range(len(pieces))]
        except BaseExceptionGroup as failed:
            raise failed.exceptions[0] from None
        print(f"Lecture pieces: {len(pieces)} pieces of {duration:.0f} s transcribed in {clock() - started:.1f} s")
        return _join_pieces(pieces, [task.result() for task in tasks])


def get_gemini_keys():
    keys = gemini_keys()
    if not keys:
        raise ValueError("GEMINI_API_KEY не настроен для расшифровки аудио.")
    return keys

def extract_youtube_id(url: str) -> str:
    pattern = r"(?:v=|\/)([0-9A-Za-z_-]{11}).*"
    match = re.search(pattern, url)
    if match:
        return match.group(1)
    return ""

async def extract_youtube_transcript(youtube_url: str) -> str:
    video_id = extract_youtube_id(youtube_url)
    if not video_id:
        raise ValueError("Не удалось распознать ссылку на YouTube.")
        
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
        
        # Поддержка разных версий библиотеки
        try:
            api = YouTubeTranscriptApi()
            transcript_list = api.list(video_id)
        except Exception:
            transcript_list = YouTubeTranscriptApi.list_transcripts(video_id)
            
        try:
            transcript = transcript_list.find_transcript(['ru', 'en', 'uk'])
        except Exception:
            # Если нет нужных языков, берём первую попавшуюся транскрипцию
            transcript = next(iter(transcript_list))
            
        # Пытаемся перевести на русский, если язык другой
        if not transcript.language_code.startswith('ru'):
            try:
                transcript = transcript.translate('ru')
            except Exception:
                pass
                
        data = transcript.fetch()
        text_parts = []
        for t in data:
            if isinstance(t, dict) and 'text' in t:
                text_parts.append(t['text'])
            elif hasattr(t, 'text'):
                text_parts.append(t.text)
                
        text = " ".join(text_parts)
        if text.strip():
            return text
            
        raise ValueError("Транскрипция оказалась пустой")
    except Exception as e:
        # Если субтитров нет вообще ни на одном языке
        return await _download_and_transcribe_youtube(youtube_url)

async def _download_and_transcribe_youtube(youtube_url: str) -> str:
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as temp_vid:
            temp_path = temp_vid.name

        ydl_opts = {
            'format': 'worst[ext=mp4]', # Скачиваем в плохом качестве, чтобы сэкономить трафик
            'outtmpl': temp_path,
            'quiet': True,
            'no_warnings': True,
            'extractor_args': {'youtube': ['player_client=android,web']},
        }

        loop = asyncio.get_event_loop()
        def download():
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.download([youtube_url])
                
        await loop.run_in_executor(None, download)

        return await transcribe_media_file(temp_path, "video/mp4")
    except Exception as e:
        error_msg = str(e)
        if "bot" in error_msg.lower() or "sign in" in error_msg.lower():
            raise ValueError(
                "YouTube заблокировал скачивание с серверов платформы (защита от ботов). "
                "Пожалуйста, скачайте это видео самостоятельно в формате MP3/MP4 (например, через любой YouTube Downloader) "
                "и загрузите файл напрямую во вкладку 'Видео / Аудио'."
            )
        raise ValueError(f"Ошибка транскрибации YouTube: {error_msg}")
    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)

def _media_generation_config(model: str) -> types.GenerateContentConfig:
    """Gemini settings for a transcript: thinking off where the model allows it (a transcript needs none,
    and thinking tokens cost and take time), low temperature except gemini-3, the app's safety settings
    (a history lecture about a war is not blocked)."""
    plan = thinking_plan(model, "off")
    config: dict = {"safety_settings": SAFETY_SETTINGS}
    if not model.lower().rsplit("/", 1)[-1].startswith("gemini-3"):
        config["temperature"] = MEDIA_TRANSCRIPTION_TEMPERATURE
    if plan.config is not None:
        config["thinking_config"] = plan.config
    return types.GenerateContentConfig(**config)


async def transcribe_media_file(
    file_path: str,
    mime_type: str = None,
    *,
    progress: Optional[Callable[[float, float], None]] = None,
    deadline: Optional[float] = None,
) -> str:
    """Text of an audio, video or image file.

    Audio and MP4/MPEG video: Groq Whisper first (lecture_transcription_models, Russian, no prompt, its made-up
    lines dropped), then Gemini. A recording longer than 32 s goes to Whisper in pieces of at most 30 s cut at
    pauses when ffmpeg is there (_transcribe_in_pieces): ``progress(seconds done, seconds in all)`` after each
    piece, and MediaProcessingTimeout when ``deadline`` (a time.monotonic() value) comes first. An image (a photo
    of a page) up to OCR_INLINE_MAX_BYTES goes to Gemini inline with the OCR prompt of ocr.py (no Files API); a
    bigger one and audio/video go through the Files API. Models: GEMINI_MODELS.
    """
    is_image = bool(mime_type and mime_type.startswith("image/"))
    if is_image and os.path.getsize(file_path) <= OCR_INLINE_MAX_BYTES:
        with open(file_path, "rb") as image_file:
            data = image_file.read()
        return await recognize_image(data, mime_type)

    if _groq_reads(file_path, mime_type):
        # A failure of the pieces' providers fails the transcription; only ffmpeg's failures send the whole file.
        groq_text = await _transcribe_in_pieces(file_path, progress, deadline)
        if groq_text is None:
            try:
                groq_text = await _transcribe_audio_with_groq(file_path, mime_type)
            except Exception as exc:
                print(f"Groq transcription failed ({type(exc).__name__}); trying Gemini")
        if groq_text:
            return groq_text

    return await _transcribe_with_gemini(file_path, mime_type, is_image)


async def _transcribe_with_gemini(
    file_path: Optional[str], mime_type: Optional[str], is_image: bool = False, *, inline: Optional[types.Part] = None
) -> str:
    """Gemini's text of the file through the Files API, or of ``inline`` (a piece of a long recording, its bytes in
    the request): every key of GEMINI_API_KEY in random order, the models of GEMINI_MODELS in turn. AIError.busy()
    when a model was rate limited and none answered, ValueError otherwise."""
    keys = get_gemini_keys()
    shuffled_keys = list(keys)
    random.shuffle(shuffled_keys)

    loop = asyncio.get_running_loop()
    last_error = None
    rate_limited = False

    gemini_models = gemini_models_env()
    prompt = OCR_PROMPT if is_image else MEDIA_TRANSCRIPTION_PROMPT

    for key in shuffled_keys:
        try:
            client = genai.Client(api_key=key)

            myfile = None
            if inline is None:
                # Загружаем файл в Gemini
                myfile = await loop.run_in_executor(
                    None,
                    lambda: client.files.upload(
                        file=file_path,
                        config=types.UploadFileConfig(mime_type=mime_type) if mime_type else None,
                    ),
                )

            try:
                # Ожидаем завершения процессинга на стороне Google, но не дольше
                # MEDIA_PROCESSING_POLL_SECONDS: другой ключ обработал бы файл не быстрее.
                poll_deadline = loop.time() + media_processing_poll_seconds()
                while myfile is not None and myfile.state.name == "PROCESSING":
                    if loop.time() >= poll_deadline:
                        raise MediaProcessingTimeout()
                    await asyncio.sleep(2)
                    myfile = await loop.run_in_executor(None, lambda: client.files.get(name=myfile.name))

                if myfile is not None and myfile.state.name == "FAILED":
                    raise ValueError("Ошибка обработки медиа-файла серверами Google.")

                response = None
                for model_name in gemini_models:
                    # A model that refuses a transcript setting (invalid_argument) is asked once more
                    # without settings, as before they were added.
                    configs = (None,) if is_image else (_media_generation_config(model_name), None)
                    for config in configs:
                        try:
                            response = await client.aio.models.generate_content(
                                model=model_name,
                                contents=[inline if myfile is None else myfile, prompt],
                                config=config,
                            )
                            break
                        except Exception as model_err:
                            response = None
                            kind = classify_error(model_err)
                            if kind == "rate_limited":
                                rate_limited = True
                            if config is None or kind != "invalid_argument":
                                break
                    if response and getattr(response, "text", None):
                        break

                if not response or not getattr(response, "text", None):
                    raise ValueError("Модели Gemini не справились с задачей.")

                return response.text

            finally:
                if myfile is not None:
                    try:
                        await loop.run_in_executor(None, lambda: client.files.delete(name=myfile.name))
                    except:
                        pass
        except MediaProcessingTimeout:
            raise
        except Exception as e:
            if classify_error(e) == "rate_limited":
                rate_limited = True
            last_error = str(e)
            continue

    if rate_limited:
        raise AIError.busy()
    raise ValueError(f"Не удалось расшифровать медиа. Убедитесь, что ключи активны. Последняя ошибка: {last_error}")
