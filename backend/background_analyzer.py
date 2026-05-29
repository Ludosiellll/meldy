import asyncio
import json
import os
import httpx
from datetime import datetime
from agents.coordinator import CoordinatorAgent
from media_parser import extract_youtube_transcript, transcribe_media_file

GROQ_API_KEY = os.getenv("GROQ_API_KEY")

async def run_background_analysis(
    user_id: str,
    source_file_name: str,
    text: str,
    youtube_url: str,
    tmp_path: str,
    content_type: str,
    queue: asyncio.Queue,
    params: dict
):
    try:
        if youtube_url:
            await queue.put({"type": "status", "message": "Извлечение субтитров YouTube или скачивание аудио..."})
            text = await extract_youtube_transcript(youtube_url)
        elif tmp_path:
            await queue.put({"type": "status", "message": "Загрузка медиа в ИИ для транскрипции (до 2 минут)..."})
            try:
                text = await transcribe_media_file(tmp_path, content_type)
            finally:
                if os.path.exists(tmp_path):
                    os.remove(tmp_path)
                    
        if not text or not text.strip():
            await queue.put({"type": "error", "message": "Не удалось получить текст из файла/медиа."})
            return
            
        await queue.put({"type": "text_extracted", "length": len(text), "text": text})
        
        coordinator = CoordinatorAgent(api_key=GROQ_API_KEY)
        results = {}
        async for event in coordinator.process(text, **params):
            await queue.put(event)
            if event["type"] == "results":
                results = event
                
        material_id = None
        supabase_url = os.getenv("SUPABASE_URL")
        supabase_key = os.getenv("SUPABASE_KEY")
        
        if user_id and supabase_url and supabase_key:
            try:
                headers = {
                    "apikey": supabase_key,
                    "Authorization": f"Bearer {supabase_key}",
                    "Content-Type": "application/json",
                    "Prefer": "return=representation"
                }
                async with httpx.AsyncClient() as client:
                    # 1. Биллинг (20 токенов)
                    today = datetime.now().strftime('%Y-%m-%d')
                    usage_url = f"{supabase_url}/rest/v1/ai_usage"
                    res = await client.get(usage_url, headers=headers, params={"user_id": f"eq.{user_id}", "date": f"eq.{today}"})
                    data = res.json() if res.status_code == 200 else []
                    if data and isinstance(data, list) and len(data) > 0:
                        await client.patch(f"{usage_url}?id=eq.{data[0]['id']}", headers=headers, json={"requests_count": data[0]["requests_count"] + 20})
                    else:
                        await client.post(usage_url, headers=headers, json={"user_id": user_id, "date": today, "requests_count": 20})
                        
                    # 2. Сохранение материала
                    title = source_file_name.rsplit('.', 1)[0] if source_file_name else 'Без названия'
                    mat_data = {
                        "user_id": user_id,
                        "title": title,
                        "subject": results.get("summarizer", {}).get("subject", ""),
                        "original_text": text,
                        "summary_json": {
                            "content": results.get("summarizer", {}).get("content", ""),
                            "terms": results.get("summarizer", {}).get("terms", []),
                            "cheatsheet": results.get("cheatsheet", {}).get("content", ""),
                            "podcast": results.get("podcast", {}).get("podcast", [])
                        },
                        "missions_json": results.get("missions", {}),
                        "flashcards_json": results.get("flashcards", {}),
                        "quiz_json": results.get("quiz", {})
                    }
                    m_res = await client.post(f"{supabase_url}/rest/v1/materials", headers=headers, json=mat_data)
                    m_data = m_res.json() if m_res.status_code in (200, 201) else []
                    material_id = m_data[0]["id"] if isinstance(m_data, list) and m_data else None
                    
            except Exception as e:
                print(f"DB Save Error: {e}")
                
        await queue.put({"type": "done", "material_id": material_id})
        await queue.put(None)
    except Exception as e:
        await queue.put({"type": "error", "message": str(e)})
        await queue.put(None)

async def stream_from_queue(queue: asyncio.Queue):
    try:
        while True:
            event = await queue.get()
            if event is None:
                break
            yield f"data: {json.dumps(event)}\n\n"
            if event.get("type") in ("error", "done"):
                break
    except asyncio.CancelledError:
        print("Client disconnected, background task continues...")
        raise
