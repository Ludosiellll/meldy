import asyncio
import json
import os
from datetime import date
from typing import AsyncGenerator, List

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from parser import extract_text
from agents.coordinator import CoordinatorAgent
from utils import parse_llm_json

app = FastAPI(title="AI Student Assistant", version="1.0.0")

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

origins = os.getenv("CORS_ALLOW_ORIGINS", "*").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")


class HealthResponse(BaseModel):
    status: str
    groq_configured: bool


@app.get("/api/health", response_model=HealthResponse)
async def health():
    return HealthResponse(
        status="ok",
        groq_configured=bool(GROQ_API_KEY),
    )


async def event_stream(
    file: UploadFile,
    summary_detail: str = "medium",
    flashcard_count: int = 6,
    quiz_count: int = 5,
    quiz_difficulty: str = "mixed",
    quiz_type: str = "multiple",
) -> AsyncGenerator[str, None]:
    """SSE stream of agent progress."""
    try:
        contents = await file.read()
        text = extract_text(contents, file.filename or "file.txt")

        if not text.strip():
            yield f"data: {json.dumps({'type': 'error', 'message': 'Не удалось извлечь текст из файла'})}\n\n"
            return

        yield f"data: {json.dumps({'type': 'text_extracted', 'length': len(text), 'text': text})}\n\n"

        coordinator = CoordinatorAgent(api_key=GROQ_API_KEY)

        async for event in coordinator.process(
            text,
            summary_detail=summary_detail,
            flashcard_count=flashcard_count,
            quiz_count=quiz_count,
            quiz_difficulty=quiz_difficulty,
            quiz_type=quiz_type,
        ):
            yield f"data: {json.dumps(event)}\n\n"

        yield f"data: {json.dumps({'type': 'done'})}\n\n"

    except Exception as e:
        yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"


@app.post("/api/analyze")
@limiter.limit("5/minute")
async def analyze(
    request: Request,
    file: UploadFile = File(...),
    summary_detail: str = Form("medium"),
    flashcard_count: int = Form(6),
    quiz_count: int = Form(5),
    quiz_difficulty: str = Form("mixed"),
    quiz_type: str = Form("multiple"),
):
    if not GROQ_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="GROQ_API_KEY не настроен на сервере",
        )

    allowed_extensions = (".pdf", ".txt", ".docx", ".md", ".doc")
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in allowed_extensions:
        raise HTTPException(
            status_code=400,
            detail=f"Неподдерживаемый формат. Поддерживаются: {', '.join(allowed_extensions)}",
        )

    return StreamingResponse(
        event_stream(file, summary_detail, flashcard_count, quiz_count, quiz_difficulty, quiz_type),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


class ChatMessage(BaseModel):
    role: str
    content: str

from media_parser import extract_youtube_transcript, transcribe_media_file
import tempfile

async def event_stream_media(
    youtube_url: str = None,
    file: UploadFile = None,
    summary_detail: str = "medium",
    flashcard_count: int = 6,
    quiz_count: int = 5,
    quiz_difficulty: str = "mixed",
    quiz_type: str = "multiple",
) -> AsyncGenerator[str, None]:
    try:
        text = ""
        if youtube_url:
            yield f"data: {json.dumps({'type': 'status', 'message': 'Извлечение субтитров YouTube или скачивание аудио...'})}\n\n"
            text = await extract_youtube_transcript(youtube_url)
        elif file:
            yield f"data: {json.dumps({'type': 'status', 'message': 'Загрузка медиа в ИИ для транскрипции (до 2 минут)...'})}\n\n"
            with tempfile.NamedTemporaryFile(delete=False, suffix=os.path.splitext(file.filename or "")[1].lower()) as tmp:
                content = await file.read()
                tmp.write(content)
                tmp_path = tmp.name
            try:
                text = await transcribe_media_file(tmp_path, file.content_type)
            finally:
                if os.path.exists(tmp_path):
                    os.remove(tmp_path)
        
        if not text or not text.strip():
            yield f"data: {json.dumps({'type': 'error', 'message': 'Не удалось получить текст из медиа.'})}\n\n"
            return
            
        yield f"data: {json.dumps({'type': 'text_extracted', 'length': len(text), 'text': text})}\n\n"

        coordinator = CoordinatorAgent(api_key=GROQ_API_KEY)

        async for event in coordinator.process(
            text,
            summary_detail=summary_detail,
            flashcard_count=flashcard_count,
            quiz_count=quiz_count,
            quiz_difficulty=quiz_difficulty,
            quiz_type=quiz_type,
        ):
            yield f"data: {json.dumps(event)}\n\n"

        yield f"data: {json.dumps({'type': 'done'})}\n\n"

    except Exception as e:
        yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"


@app.post("/api/analyze/media")
@limiter.limit("3/minute")
async def analyze_media(
    request: Request,
    youtube_url: str = Form(None),
    file: UploadFile = File(None),
    summary_detail: str = Form("medium"),
    flashcard_count: int = Form(6),
    quiz_count: int = Form(5),
    quiz_difficulty: str = Form("mixed"),
    quiz_type: str = Form("multiple"),
):
    if not GROQ_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="GROQ_API_KEY не настроен на сервере",
        )

    if file:
        allowed_extensions = (".mp4", ".mp3", ".wav", ".mpeg", ".m4a")
        ext = os.path.splitext(file.filename or "")[1].lower()
        if ext not in allowed_extensions:
            raise HTTPException(
                status_code=400,
                detail=f"Неподдерживаемый формат медиа. Поддерживаются: {', '.join(allowed_extensions)}",
            )
            
    if not youtube_url and not file:
         raise HTTPException(
                status_code=400,
                detail="Укажите youtube_url или загрузите файл.",
         )

    return StreamingResponse(
        event_stream_media(youtube_url, file, summary_detail, flashcard_count, quiz_count, quiz_difficulty, quiz_type),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


class ChatRequest(BaseModel):
    message: str
    context: str
    history: List[ChatMessage]
    extra_params: dict = {}


class PlanSubject(BaseModel):
    name: str
    exam_date: str
    color: str


class PlanRequest(BaseModel):
    subjects: List[PlanSubject]
    available_hours_per_day: int = 2
    context_materials: str = ""
    user_goals: str = ""
    mood: dict = None


from agents.base import BaseAgent

@app.post("/api/chat")
@limiter.limit("20/minute")
async def chat(request: Request, req: ChatRequest):
    agent = BaseAgent(api_key=GROQ_API_KEY)
    
    system_prompt = f"""Ты — умный AI-ассистент студента. 
Ты помогаешь разобраться в учебном материале, предоставленном ниже.
Отвечай на вопросы развёрнуто и понятно. 
Если вопрос вообще не касается темы материала, всё равно попытайся помочь, но упомяни, что в материале этого нет.

МАТЕРИАЛ ДЛЯ СПРАВКИ:
{req.context[:25000]}"""

    history_text = "\n".join([f"{msg.role}: {msg.content}" for msg in req.history[-5:]])
    full_user_query = f"ИСТОРИЯ ДИАЛОГА:\n{history_text}\n\nТЕКУЩИЙ ВОПРОС: {req.message}"

    # Добавляем контекст настроения пользователя
    mood_context = ""
    if "mood" in req.extra_params:
        m = req.extra_params["mood"]
        mood_context = f"\n\nТЕКУЩЕЕ СОСТОЯНИЕ СТУДЕНТА: {m['mood']}, энергия: {m['energy_level']}/5. "
        if m.get('notes'):
            mood_context += f"Причина состояния со слов студента: '{m['notes']}' (учитывай это только если текст осмысленный). "
        if m['energy_level'] <= 2:
            mood_context += "Студент устал. Отвечай максимально просто, кратко и поддерживающе."
        elif m['mood'] == 'stressed':
            mood_context += "Студент в стрессе. Будь максимально вежлив, подбадривай и не давай слишком сложной информации."
        elif m['energy_level'] >= 4:
            mood_context += "Студент полон сил. Можешь давать более глубокие, сложные и детальные пояснения."

    system_prompt += mood_context

    reply = await agent.run(system_prompt, full_user_query)
    return {"reply": reply}


@app.post("/api/plan")
@limiter.limit("5/minute")
async def plan(request: Request, req: PlanRequest):
    agent = BaseAgent(api_key=GROQ_API_KEY)
    
    subjects_text = "\n".join([
        f"- {s.name}: экзамен {s.exam_date}"
        for s in req.subjects
    ])
    today = __import__('datetime').date.today().isoformat()

    materials_section = ""
    if req.context_materials:
        materials_section = f"""

КОНСПЕКТЫ СТУДЕНТА (используй их для составления конкретных тем и задач):
{req.context_materials[:20000]}"""

    goals_section = ""
    if req.user_goals:
        goals_section = f"""

ПОЖЕЛАНИЯ СТУДЕНТА (учи́тывай при планировании):
{req.user_goals}"""

    mood_info = ""
    if req.mood:
        m = req.mood
        mood_info = f"\n\nТЕКУЩЕЕ СОСТОЯНИЕ СТУДЕНТА: {m.get('mood')}, энергия: {m.get('energy_level')}/5. "
        if m.get('notes'):
            mood_info += f"Причина состояния со слов студента: '{m['notes']}' (учитывай это только если текст осмысленный). "
        if m.get('energy_level', 3) <= 2:
            mood_info += "Студент очень устал, планируй максимально легкие и короткие задачи."
        elif m.get('energy_level', 3) >= 4:
            mood_info += "Студент полон сил, можно планировать интенсивную работу."

    system_prompt = f"""Ты — опытный учебный планировщик.
Сегодняшняя дата: {today}
Доступно часов для учебы в день: {req.available_hours_per_day}

Предметы и даты экзаменов:
{subjects_text}{materials_section}{goals_section}{mood_info}

ВАЖНО: Проанализируй конспекты студента и сам определи, какой конспект к какому предмету относится (по названиям, терминам, темам). Если конспект не подходит ни к одному предмету — игнорируй его.

Создай детальный ежедневный план подготовки для КАЖДОГО из перечисленных предметов.
Распредели время между предметами пропорционально их сложности и близости экзамена.
Для каждого дня указывай конкретные темы или задачи, основанные на конспектах студента.
Если по какому-то предмету нет конспектов — предложи общие темы для изучения.

ОБЯЗАТЕЛЬНО верни ответ в формате JSON:
{{
  "plan": [
    {{
      "date": "YYYY-MM-DD",
      "tasks": [
        {{"subject": "Название предмета", "task": "Что именно сделать", "hours": 1}}
      ]
    }}
  ]
}}"""

    raw = await agent.run(system_prompt, "Сгенерируй план подготовки.")
    
    try:
        return parse_llm_json(raw)
    except:
        return {"plan": []}


class ProfessorQuestionRequest(BaseModel):
    context: str
    history_text: str = ""
    mood: dict = None
    socratic_mode: bool = False


class ProfessorEvaluateRequest(BaseModel):
    context: str
    question: str
    student_answer: str


class MissionsGenerateRequest(BaseModel):
    context: str


from agents.base import build_professor_question_prompt, build_professor_evaluation_prompt, build_missions_prompt, build_quick_prep_prompt, build_mistakes_practice_prompt

@app.post("/api/professor/question")
@limiter.limit("15/minute")
async def professor_question(request: Request, req: ProfessorQuestionRequest):
    agent = BaseAgent(api_key=GROQ_API_KEY)
    
    if req.mood:
        mood_instr = f"Студент сейчас в настроении: {req.mood.get('mood')}, энергия {req.mood.get('energy_level')}/5. "
        if req.mood.get('notes'):
            mood_instr += f"Причина состояния: '{req.mood['notes']}' (учитывай это только если текст осмысленный). "
        if req.mood.get('energy_level', 3) <= 2 or req.mood.get('mood') == 'stressed':
            mood_instr += "Студент сегодня не в лучшей форме (устал или в стрессе). Задавай вопросы попроще, будь более снисходительным профессором, давай наводки."
        elif req.mood.get('energy_level', 3) >= 4:
            mood_instr += "Студент сегодня в отличной форме и полон энергии. Задавай действительно глубокие, сложные и проверяющие на прочность вопросы. Будь строгим профессором."

    # Сократовский режим
    if req.socratic_mode:
        socratic_instr = """

СОКРАТОВСКИЙ РЕЖИМ АКТИВЕН:
Не просто задавай вопрос — веди Сократовский диалог. Это означает:
1. Задай первый вопрос по теме.
2. После каждого ответа студента (из истории) — НЕ принимай ответ просто так. Задавай уточняющий вопрос, который:
   - Оспаривает ответ («А почему именно так?»)
   - Просит пример («Можешь привести конкретный пример?»)
   - Углубляет понимание («А что будет, если условие X изменится?»)
   - Проверяет границы знания («Верно ли это всегда, или есть исключения?»)
Цель — не поймать на ошибке, а помочь студенту самому дойти до глубокого понимания."""
    else:
        socratic_instr = ""

    system_prompt = build_professor_question_prompt(req.context, req.history_text)
    if mood_instr:
        system_prompt += f"\n\nКОНТЕКСТ СОСТОЯНИЯ СТУДЕНТА: {mood_instr}"
    system_prompt += socratic_instr
        
    question = await agent.run(system_prompt, "Задай следующий вопрос для экзамена.")
    return {"question": question.strip()}


@app.post("/api/professor/evaluate")
@limiter.limit("15/minute")
async def professor_evaluate(request: Request, req: ProfessorEvaluateRequest):
    agent = BaseAgent(api_key=GROQ_API_KEY)
    system_prompt = build_professor_evaluation_prompt(req.context, req.question, req.student_answer)
    raw = await agent.run(system_prompt, "Оцени мой ответ.")
    
    try:
        return parse_llm_json(raw)
    except Exception as e:
        return {
            "score": 50,
            "grade": "3",
            "verdict": f"Произошла ошибка при анализе ответа. Сырой комментарий: {raw}",
            "correct_points": ["Ответ получен системой"],
            "errors": [f"Ошибка парсинга: {str(e)}"],
            "missing_points": ["Пожалуйста, сформулируйте ответ более академично"]
        }


@app.post("/api/missions/generate")
@limiter.limit("5/minute")
async def generate_missions(request: Request, req: MissionsGenerateRequest):
    agent = BaseAgent(api_key=GROQ_API_KEY)
    system_prompt = build_missions_prompt()
    raw = await agent.run(system_prompt, req.context)
    
    try:
        return parse_llm_json(raw)
    except Exception as e:
        return {
            "missions": [
                {
                    "id": 1,
                    "title": "Введение в тему",
                    "explanation": f"Не удалось автоматически сформировать квест. Сырой текст ИИ: {raw}",
                    "question": "Готовы ли вы начать изучение самостоятельно?",
                    "options": ["A) Да, готов!", "B) Нет, нужно время", "C) Хочу перечитать конспект"],
                    "correct": "A",
                    "hint": "Выберите вариант А"
                }
            ]
        }


class QuickPrepRequest(BaseModel):
    context: str


@app.post("/api/quick-prep")
@limiter.limit("5/minute")
async def quick_prep(request: Request, req: QuickPrepRequest):
    agent = BaseAgent(api_key=GROQ_API_KEY)
    system_prompt = build_quick_prep_prompt()
    raw = await agent.run(system_prompt, req.context[:15000])

    try:
        return parse_llm_json(raw)
    except Exception:
        return {
            "key_points": ["Изучите основные термины темы", "Разберитесь с ключевыми определениями", "Повторите главные выводы лекции"],
            "cheatsheet": "Не удалось автоматически создать шпаргалку. Обратитесь к оригинальному материалу.",
            "questions": [
                {"question": "Какие главные понятия этой темы вы знаете?", "answer": "Обратитесь к тексту лекции для детального ответа."},
                {"question": "Как вы можете применить эти знания на практике?", "answer": "Подумайте о конкретных примерах из материала."}
            ]
        }


class MistakesPracticeRequest(BaseModel):
    mistakes: List[dict]


@app.post("/api/mistakes/practice")
@limiter.limit("5/minute")
async def mistakes_practice(request: Request, req: MistakesPracticeRequest):
    agent = BaseAgent(api_key=GROQ_API_KEY)
    system_prompt = build_mistakes_practice_prompt(req.mistakes)
    raw = await agent.run(system_prompt, "Сгенерируй проверочный тест по моим ошибкам.")

    try:
        return parse_llm_json(raw)
    except Exception:
        return {
            "practice": [
                {
                    "id": 1,
                    "mistake_id": "",
                    "question": "Какое ключевое правило нужно соблюдать, чтобы не допускать повторных ошибок?",
                    "options": [
                        "A) Внимательно анализировать свои неверные ответы и пояснения",
                        "B) Заучивать правильные формулировки наизусть без понимания",
                        "C) Стараться реже заглядывать в дневник ошибок",
                        "D) Проходить только простые темы для хорошего настроения"
                    ],
                    "correct": "A",
                    "explanation": "Осознанный разбор неверных ответов и верных решений — единственный путь к реальному прогрессу."
                }
            ]
        }


# ── Career Navigator ──────────────────────────────────────────────────────────

class CareerRequest(BaseModel):
    materials_context: str  # Сборка всех конспектов юзера

from agents.career import CareerAgent

@app.post("/api/career/generate")
@limiter.limit("5/minute")
async def career_generate(request: Request, req: CareerRequest):
    if not req.materials_context.strip():
        raise HTTPException(status_code=400, detail="Нет материалов для анализа. Сначала загрузите хотя бы один конспект.")

    agent = CareerAgent(api_key=GROQ_API_KEY)
    try:
        result = await agent.process(req.materials_context[:60000])
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка генерации карьерного профиля: {str(e)}")



ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY", "")

# ElevenLabs voice IDs (multilingual v2 — отлично говорят по-русски)
ELEVENLABS_VOICES = {
    "professor": "onwK4e9ZLuTAKqWW03F9",  # Daniel — глубокий, академический
    "male":      "pNInz6obpgDQGcFmaJgB",  # Adam — естественный мужской
    "female":    "21m00Tcm4TlvDq8ikWAM",  # Rachel — спокойный женский
}

class TTSRequest(BaseModel):
    text: str
    role: str = "professor"  # professor | male | female


@app.post("/api/tts")
@limiter.limit("30/minute")
async def text_to_speech(request: Request, req: TTSRequest):
    if not ELEVENLABS_API_KEY:
        raise HTTPException(status_code=503, detail="ElevenLabs API key не настроен")

    voice_id = ELEVENLABS_VOICES.get(req.role, ELEVENLABS_VOICES["professor"])
    text = req.text.strip()[:4000]  # ElevenLabs ограничение на запрос

    import httpx

    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
    headers = {
        "xi-api-key": ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
    }
    payload = {
        "text": text,
        "model_id": "eleven_multilingual_v2",
        "voice_settings": {
            "stability": 0.5,
            "similarity_boost": 0.75,
            "style": 0.0,
            "use_speaker_boost": True,
        },
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(url, headers=headers, json=payload)
            if resp.status_code != 200:
                raise HTTPException(status_code=resp.status_code, detail=f"ElevenLabs error: {resp.text}")
            audio_bytes = resp.content

        from fastapi.responses import Response
        return Response(content=audio_bytes, media_type="audio/mpeg")
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="ElevenLabs timeout")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
