import os
import re
import tempfile
import asyncio
from youtube_transcript_api import YouTubeTranscriptApi
import yt_dlp
from google import genai
from google.genai import types
import random

from agents.base import AIError, classify_error, gemini_keys, gemini_models_env
from ocr import OCR_INLINE_MAX_BYTES, OCR_PROMPT, recognize_image

MEDIA_TRANSCRIPTION_PROMPT = (
    "Сделай максимально полную и точную текстовую расшифровку всего, что сказано в этом аудио/видео. "
    "Передай речь дословно на языке оригинала."
)

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


async def _transcribe_audio_with_groq(file_path: str, mime_type: str | None) -> str:
    api_key = os.getenv("GROQ_API_KEY", "").strip()
    if not api_key:
        return ""

    from groq import AsyncGroq

    client = AsyncGroq(api_key=api_key)
    with open(file_path, "rb") as audio_file:
        response = await client.audio.transcriptions.create(
            model=os.getenv("GROQ_TRANSCRIPTION_MODEL", "whisper-large-v3-turbo"),
            file=(os.path.basename(file_path), audio_file, mime_type or "audio/mpeg"),
            response_format="text",
            temperature=0,
        )
    if isinstance(response, str):
        return response.strip()
    return str(getattr(response, "text", "") or "").strip()

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

async def transcribe_media_file(file_path: str, mime_type: str = None) -> str:
    """Text of an audio, video or image file.

    Audio: Groq Whisper first, then Gemini. An image (a photo of a page) up to
    OCR_INLINE_MAX_BYTES goes to Gemini inline with the OCR prompt of ocr.py (no Files API);
    a bigger one and audio/video go through the Files API. Models: GEMINI_MODELS.
    """
    is_image = bool(mime_type and mime_type.startswith("image/"))
    if is_image and os.path.getsize(file_path) <= OCR_INLINE_MAX_BYTES:
        with open(file_path, "rb") as image_file:
            data = image_file.read()
        return await recognize_image(data, mime_type)

    if mime_type and mime_type.startswith("audio/"):
        try:
            groq_text = await _transcribe_audio_with_groq(file_path, mime_type)
            if groq_text:
                return groq_text
        except Exception as exc:
            print(f"Groq audio transcription failed; trying Gemini: {exc}")

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
                    try:
                        response = await client.aio.models.generate_content(
                            model=model_name,
                            contents=[myfile, prompt],
                        )
                        if response and getattr(response, "text", None):
                            break
                    except Exception as model_err:
                        if classify_error(model_err) == "rate_limited":
                            rate_limited = True
                        continue
                        
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
