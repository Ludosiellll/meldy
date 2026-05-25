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
    keys = [k.strip() for k in raw_keys.split(",") if k.strip()]
    if not keys:
        raise ValueError("GEMINI_API_KEY не настроен для расшифровки аудио.")
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
        # Пробуем мгновенно вытащить субтитры (это бесплатно и быстро)
        transcript_list = YouTubeTranscriptApi.get_transcript(video_id, languages=['ru', 'en', 'uk'])
        text = " ".join([t['text'] for t in transcript_list])
        return text
    except Exception as e:
        # Если субтитров нет, скачиваем и транскрибируем через Gemini
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
        }

        loop = asyncio.get_event_loop()
        def download():
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.download([youtube_url])
                
        await loop.run_in_executor(None, download)

        return await transcribe_media_file(temp_path, "video/mp4")
    except Exception as e:
        raise ValueError(f"Ошибка транскрибации YouTube: {str(e)}")
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
