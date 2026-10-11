import os
import re
import tempfile
import asyncio
from youtube_transcript_api import YouTubeTranscriptApi
import yt_dlp
from google import genai
from google.genai import types
import random

from agents.base import (
    AIError,
    SAFETY_SETTINGS,
    classify_error,
    gemini_keys,
    gemini_models_env,
    provider_error_code,
    thinking_plan,
)
from ocr import OCR_INLINE_MAX_BYTES, OCR_PROMPT, recognize_image

# Recordings of lectures (live QA 2026-10-11, a 2:50 MP3 through whisper-large-v3-turbo without a
# language): ~10 s of speech lost, «вольтметр» → «Вт метр», «нихрома» → «них ума», «закон Ома» →
# «закон ОМО». A lecture is not a live answer: it gets Groq's most accurate Whisper, the error-sensitive
# whisper-large-v3 (WER 10.3 % against 12 % of the turbo, Groq's speech-to-text docs, checked
# 2026-10-11; same free limits), then the turbo one (GROQ_TRANSCRIPTION_MODEL, the model of spoken
# answers in stt.py) if the first is busy or gone, then Gemini. Whisper is told the language (ru) and
# gets a short Russian prompt with the topic from the file name: the prompt sets the style and the
# spelling of terms (Groq: up to 224 tokens, in the language of the audio). Temperature 0, as Groq advises.
GROQ_LECTURE_MODEL_DEFAULT = "whisper-large-v3"
GROQ_FALLBACK_MODEL_DEFAULT = "whisper-large-v3-turbo"
TRANSCRIPTION_LANGUAGE = "ru"
LECTURE_PROMPT = "Запись лекции на русском языке."
TOPIC_PROMPT = "Запись лекции на русском языке. Тема: {topic}."
TOPIC_MAX_CHARS = 120
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
    """Google kept the uploaded file in PROCESSING longer than MEDIA_PROCESSING_POLL_SECONDS."""

    def __init__(self, message: str = MEDIA_PROCESSING_TIMEOUT_MESSAGE):
        super().__init__(message)


def media_processing_poll_seconds() -> float:
    try:
        value = float(os.getenv("MEDIA_PROCESSING_POLL_SECONDS", "120") or 120)
    except ValueError:
        return 120.0
    return value if value > 0 else 120.0


def recording_topic(filename: str | None) -> str:
    """The topic of a recording from its file name («Лекция_физика_закон_Ома.mp3» → «Лекция физика закон
    Ома»), or '' when the name says nothing: fewer than two Russian words of three letters
    («Запись 12.m4a», «audio_2026-10-11.mp3»)."""
    name = os.path.basename(filename or "")
    stem = name.rsplit(".", 1)[0] if "." in name else name
    words = re.sub(r"[_\s]+", " ", stem).split()
    if sum(1 for word in words if re.fullmatch(r"[А-Яа-яЁё][А-Яа-яЁё-]{2,}", word)) < 2:
        return ""
    return " ".join(words)[:TOPIC_MAX_CHARS].strip()


def lecture_transcription_models() -> list[str]:
    """Whisper models for a lecture, the most accurate first (GROQ_LECTURE_TRANSCRIPTION_MODEL, then
    GROQ_TRANSCRIPTION_MODEL — the model of spoken answers — as the one to fall back on)."""
    models = []
    for name, default in (
        ("GROQ_LECTURE_TRANSCRIPTION_MODEL", GROQ_LECTURE_MODEL_DEFAULT),
        ("GROQ_TRANSCRIPTION_MODEL", GROQ_FALLBACK_MODEL_DEFAULT),
    ):
        model = os.getenv(name, "").strip() or default
        if model not in models:
            models.append(model)
    return models


def _groq_reads(file_path: str, mime_type: str | None) -> bool:
    return bool(mime_type and mime_type.startswith(GROQ_MEDIA_TYPES)) and file_path.lower().endswith(GROQ_MEDIA_EXTENSIONS)


async def _transcribe_audio_with_groq(file_path: str, mime_type: str | None, topic: str = "") -> str:
    """Whisper's text of the recording ('' without a key). The next model is asked only when one is busy
    (429) or not there any more (404): any other failure goes to Gemini at once."""
    api_key = os.getenv("GROQ_API_KEY", "").strip()
    if not api_key:
        return ""

    from groq import AsyncGroq

    client = AsyncGroq(api_key=api_key)
    prompt = TOPIC_PROMPT.format(topic=topic) if topic else LECTURE_PROMPT
    models = lecture_transcription_models()
    for index, model in enumerate(models):
        try:
            with open(file_path, "rb") as audio_file:
                response = await client.audio.transcriptions.create(
                    model=model,
                    file=(os.path.basename(file_path), audio_file, mime_type or "audio/mpeg"),
                    language=TRANSCRIPTION_LANGUAGE,
                    prompt=prompt,
                    response_format="text",
                    temperature=0,
                )
        except Exception as exc:
            gone = provider_error_code(exc) in ("model_decommissioned", "model_not_found")
            if index + 1 < len(models) and (gone or classify_error(exc) in ("rate_limited", "not_found")):
                print(f"Groq transcription: {model} unavailable ({classify_error(exc)}), trying {models[index + 1]}")
                continue
            raise
        if isinstance(response, str):
            return response.strip()
        return str(getattr(response, "text", "") or "").strip()
    return ""

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


async def transcribe_media_file(file_path: str, mime_type: str = None, *, topic: str = "") -> str:
    """Text of an audio, video or image file.

    Audio and MP4/MPEG video: Groq Whisper first (lecture_transcription_models, Russian, ``topic`` —
    recording_topic of the file name — in the prompt), then Gemini. An image (a photo of a page) up to
    OCR_INLINE_MAX_BYTES goes to Gemini inline with the OCR prompt of ocr.py (no Files API);
    a bigger one and audio/video go through the Files API. Models: GEMINI_MODELS.
    """
    is_image = bool(mime_type and mime_type.startswith("image/"))
    if is_image and os.path.getsize(file_path) <= OCR_INLINE_MAX_BYTES:
        with open(file_path, "rb") as image_file:
            data = image_file.read()
        return await recognize_image(data, mime_type)

    if _groq_reads(file_path, mime_type):
        try:
            groq_text = await _transcribe_audio_with_groq(file_path, mime_type, topic)
            if groq_text:
                return groq_text
        except Exception as exc:
            print(f"Groq transcription failed ({type(exc).__name__}); trying Gemini")

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
                while myfile.state.name == "PROCESSING":
                    if loop.time() >= poll_deadline:
                        raise MediaProcessingTimeout()
                    await asyncio.sleep(2)
                    myfile = await loop.run_in_executor(None, lambda: client.files.get(name=myfile.name))
                    
                if myfile.state.name == "FAILED":
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
                                contents=[myfile, prompt],
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
