import os
import re
import tempfile
import asyncio
from youtube_transcript_api import YouTubeTranscriptApi
import yt_dlp
import google.generativeai as genai
import random

def get_gemini_key():
    raw_keys = os.getenv("GEMINI_API_KEY", "")
    keys = [k.strip() for k in raw_keys.split(",") if k.strip() and k.strip().startswith("AIza")]
    if not keys:
        raise ValueError("Среди GEMINI_API_KEY нет ключей формата AIza (остальные форматы не поддерживают загрузку файлов).")
    return random.choice(keys)

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
    key = get_gemini_key()
    genai.configure(api_key=key)
    
    loop = asyncio.get_event_loop()
    
    # Загружаем файл в Gemini
    myfile = await loop.run_in_executor(None, lambda: genai.upload_file(file_path, mime_type=mime_type))
    
    try:
        # Ожидаем завершения процессинга на стороне Google
        while myfile.state.name == "PROCESSING":
            await asyncio.sleep(2)
            myfile = await loop.run_in_executor(None, lambda: genai.get_file(myfile.name))
            
        if myfile.state.name == "FAILED":
            raise ValueError("Ошибка обработки медиа-файла серверами Google.")
            
        # Ищем рабочую модель
        GEMINI_MODELS = [
            "gemini-3.1-flash-lite",
            "gemini-2.5-flash-preview-05-20",
            "gemini-2.0-flash",
            "gemini-1.5-flash",
        ]
        
        response = None
        for model_name in GEMINI_MODELS:
            try:
                model = genai.GenerativeModel(model_name)
                is_image = mime_type and mime_type.startswith('image/')
                if is_image:
                    prompt = "Внимательно изучи это изображение. Это фотография конспекта, школьной доски или страницы учебника. Извлеки АБСОЛЮТНО ВЕСЬ текст, который ты видишь. Сохрани структуру: заголовки, списки, абзацы. Если видишь математические формулы, запиши их в формате LaTeX (KaTeX). Если часть текста неразборчива, напиши [неразборчиво], но постарайся восстановить по контексту. Твоя единственная цель - сделать идеальный текстовый слепок изображения без лишних комментариев."
                else:
                    prompt = "Сделай максимально полную и точную текстовую расшифровку всего, что сказано в этом аудио/видео. Передай речь дословно на языке оригинала."
                
                response = await model.generate_content_async([myfile, prompt])
                if response and response.text:
                    break
            except Exception:
                continue
                
        if not response or not response.text:
            raise ValueError("Ни одна модель Gemini не смогла расшифровать медиа. Убедитесь, что ключи активны.")
            
        return response.text
    finally:
        try:
            await loop.run_in_executor(None, lambda: genai.delete_file(myfile.name))
        except:
            pass
