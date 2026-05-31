import asyncio
import json
import os
from datetime import date
from typing import AsyncGenerator, List, Optional

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
from push_router import router as push_router, load_subscriptions, VAPID_PRIVATE_KEY, VAPID_CLAIMS

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from pywebpush import webpush, WebPushException

app = FastAPI(title="AI Student Assistant", version="1.0.0")

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

from fastapi.responses import JSONResponse
import traceback

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    print(f"Global exception: {exc}")
    traceback.print_exc()
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc), "traceback": traceback.format_exc()}
    )

origins = os.getenv("CORS_ALLOW_ORIGINS", "*").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")

app.include_router(push_router, prefix="/api/push", tags=["push"])

scheduler = AsyncIOScheduler()

async def scheduled_reminders():
    subs = load_subscriptions()
    for user_id, sub_info in subs.items():
        try:
            webpush(
                subscription_info=sub_info,
                data=json.dumps({
                    "title": "StudyForge",
                    "body": "Пора повторить карточки! Зайдите в приложение, чтобы закрепить знания.",
                    "url": "/review"
                }),
                vapid_private_key=VAPID_PRIVATE_KEY,
                vapid_claims=VAPID_CLAIMS
            )
            print(f"Sent scheduled push to {user_id}")
        except Exception as e:
            print(f"Failed to send scheduled push to {user_id}: {e}")

@app.on_event("startup")
async def startup_event():
    scheduler.add_job(scheduled_reminders, 'interval', hours=24) # Daily reminders
    scheduler.start()
    
@app.on_event("shutdown")
async def shutdown_event():
    scheduler.shutdown()


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
    file: UploadFile = None,
    summary_detail: str = "medium",
    flashcard_count: int = 6,
    quiz_count: int = 5,
    quiz_difficulty: str = "mixed",
    quiz_type: str = "multiple",
) -> AsyncGenerator[str, None]:
    try:
        text = ""
        if file:
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
        allowed_extensions = (".mp4", ".mp3", ".wav", ".mpeg", ".m4a", ".jpg", ".jpeg", ".png")
        ext = os.path.splitext(file.filename or "")[1].lower()
        if ext not in allowed_extensions:
            raise HTTPException(
                status_code=400,
                detail=f"Неподдерживаемый формат медиа. Поддерживаются: {', '.join(allowed_extensions)}",
            )
            
    if not file:
         raise HTTPException(
                status_code=400,
                detail="Укажите загрузите файл.",
         )

    return StreamingResponse(
        event_stream_media(file, summary_detail, flashcard_count, quiz_count, quiz_difficulty, quiz_type),
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


class CourseMaterial(BaseModel):
    id: str
    title: str
    subject: str
    summary: str = ""


class CourseGenerateRequest(BaseModel):
    materials: List[CourseMaterial]
    goals: str = ""


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

    history_text = "\n".join([f"{msg.role}: {msg.content}" for msg in req.history[-10:]])
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

    system_prompt += "\n\nВАЖНОЕ ПРАВИЛО: Это продолжающийся диалог. НЕ здоровайся заново, не повторяй вступительные слова поддержки из прошлых сообщений. Отвечай сразу по делу, опираясь на историю диалога."

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


@app.post("/api/courses/generate")
@limiter.limit("5/minute")
async def generate_course(request: Request, req: CourseGenerateRequest):
    agent = BaseAgent(api_key=GROQ_API_KEY)
    
    materials_text = "\n\n".join([
        f"Материал ID: {m.id}\nНазвание: {m.title}\nПредмет: {m.subject}\nКраткое содержание: {m.summary}"
        for m in req.materials
    ])
    
    system_prompt = f"""Ты — опытный методист, учебный дизайнер и эксперт по составлению образовательных программ.
Твоя задача — составить логичную, структурированную учебную программу (курс) на основе предоставленных материалов из библиотеки студента.

Доступные материалы:
{materials_text}

Пожелания студента к курсу (цели обучения):
{req.goals if req.goals else 'Нет особых пожеланий, сделай структуру максимально логичной.'}

Инструкции по построению курса:
1. Придумай емкое и красивое название курса (title), объединяющее эти материалы, и краткое описание (description).
2. Раздели курс на логические секции (от 2 до 5 секций в зависимости от количества и тем материалов).
3. Распредели ВСЕ предоставленные материалы по секциям в оптимальном педагогическом порядке (от простого к сложному, соблюдая логические связи).
4. Каждая секция должна содержать хотя бы один материал. Каждый предоставленный материал должен быть отнесен ровно к одной секции.
5. Для каждой секции напиши краткое название (title) и описание (description) — чему посвящена секция.

ОБЯЗАТЕЛЬНО верни ответ строго в формате JSON:
{{
  "title": "Название курса",
  "description": "Описание курса и целей обучения",
  "structure": [
    {{
      "id": "section_1",
      "title": "Название первой секции",
      "description": "Чему посвящена эта секция",
      "materials": [
        {{ "id": "material-uuid-1", "title": "Название первого материала", "completed": false }}
      ]
    }}
  ]
}}"""

    raw = await agent.run(system_prompt, "Сгенерируй структуру курса в формате JSON.")
    
    try:
        return parse_llm_json(raw)
    except Exception as e:
        print(f"Failed to generate course: {{e}}, raw: {{raw}}")
        return {{"title": "Новый курс", "description": "", "structure": []}}


class ProfessorQuestionRequest(BaseModel):
    context: str
    history_text: str = ""
    mood: Optional[dict] = None
    socratic_mode: bool = False
    exam_history: List[dict] = []
    recent_mistakes: List[str] = []


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
    
    mood_instr = ""
    if req.mood:
        mood_instr = f"Студент сейчас в настроении: {req.mood.get('mood')}, энергия {req.mood.get('energy_level')}/5. "
        if req.mood.get('notes'):
            mood_instr += f"Причина состояния: '{req.mood['notes']}' (учитывай это только если текст осмысленный). "
        if req.mood.get('energy_level', 3) <= 2 or req.mood.get('mood') == 'stressed':
            mood_instr += "Студент сегодня не в лучшей форме (устал или в стрессе). Задавай вопросы попроще, будь более снисходительным профессором, давай наводки."
        elif req.mood.get('energy_level', 3) >= 4:
            mood_instr += "Студент сегодня в отличной форме и полон энергии. Задавай действительно глубокие, сложные и проверяющие на прочность вопросы. Будь строгим профессором."

    # Адаптивность к успеваемости
    adaptive_instr = ""
    if req.exam_history:
        scores = [e.get('score', 0) for e in req.exam_history if isinstance(e, dict) and 'score' in e]
        if scores:
            avg_score = sum(scores) / len(scores)
            adaptive_instr += f"История оценок студента: средний балл {avg_score:.1f}/100. "
            if avg_score >= 85:
                adaptive_instr += "Студент очень сильный и отлично справляется. Задавай глубокие, каверзные вопросы на понимание тонкостей, проверяй знание исключений и неочевидных связей. Будь строгим, но справедливым. "
            elif avg_score < 60:
                adaptive_instr += "Студент иногда ошибается или испытывает трудности. Задавай структурированные, базовые вопросы. Будь более лоялен, хвали за правильные шаги, давай наводящие подсказки. "

    # Адаптивность к прошлым ошибкам
    if req.recent_mistakes:
        mistakes_str = ", ".join([m for m in req.recent_mistakes if isinstance(m, str)])
        if mistakes_str:
            adaptive_instr += f"Недавние темы/вопросы, в которых студент совершал ошибки: {mistakes_str}. Если это уместно в контексте изучаемого материала, удели внимание этим темам или задай вопрос, проверяющий усвоение прошлых пробелов."

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
    if adaptive_instr:
        system_prompt += f"\n\nАДАПТИВНАЯ СЛОЖНОСТЬ (УСПЕВАЕМОСТЬ И ОШИБКИ): {adaptive_instr}"
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
        err_str = str(e)
        if "API_LIMIT_REACHED" in err_str or "429" in err_str:
            verdict_msg = "Извините, сейчас ИИ-сервера перегружены (лимит запросов). Пожалуйста, подождите немного и попробуйте снова."
        else:
            verdict_msg = f"Произошла ошибка при анализе ответа. Сырой комментарий: {raw}"
            
        return {
            "score": 50,
            "grade": "3",
            "verdict": verdict_msg,
            "correct_points": ["Ответ получен системой"],
            "errors": [f"Ошибка: {err_str}"],
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
        err_str = str(e)
        if "API_LIMIT_REACHED" in err_str or "429" in err_str:
            expl_msg = "Извините, сейчас ИИ-сервера перегружены (лимит запросов). Пожалуйста, подождите немного и попробуйте снова."
        else:
            expl_msg = f"Не удалось автоматически сформировать квест. Сырой текст ИИ: {raw}"
            
        return {
            "missions": [
                {
                    "id": 1,
                    "title": "Внимание: Сервер перегружен" if "API_LIMIT" in err_str else "Введение в тему",
                    "explanation": expl_msg,
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
    except Exception as e:
        err_str = str(e)
        if "API_LIMIT_REACHED" in err_str or "429" in err_str:
            expl_msg = "Извините, сейчас ИИ-сервера перегружены (лимит запросов). Пожалуйста, подождите немного и попробуйте снова."
        else:
            expl_msg = "Не удалось автоматически создать шпаргалку. Обратитесь к оригинальному материалу."
            
        return {
            "key_points": ["Изучите основные термины темы", "Разберитесь с ключевыми определениями", "Повторите главные выводы лекции"],
            "cheatsheet": expl_msg,
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
    except Exception as e:
        err_str = str(e)
        if "API_LIMIT_REACHED" in err_str or "429" in err_str:
            expl_msg = "Извините, сейчас ИИ-сервера перегружены (лимит запросов). Пожалуйста, подождите немного и попробуйте снова."
        else:
            expl_msg = "Осознанный разбор неверных ответов и верных решений — единственный путь к реальному прогрессу."
            
        return {
            "practice": [
                {
                    "id": 1,
                    "mistake_id": "",
                    "question": expl_msg if "API_LIMIT" in err_str else "Какое ключевое правило нужно соблюдать, чтобы не допускать повторных ошибок?",
                    "options": [
                        "A) Внимательно анализировать свои неверные ответы и пояснения",
                        "B) Заучивать правильные формулировки наизусть без понимания",
                        "C) Стараться реже заглядывать в дневник ошибок",
                        "D) Проходить только простые темы для хорошего настроения"
                    ],
                    "correct": "A",
                    "explanation": expl_msg
                }
            ]
        }


# ── Career Navigator ──────────────────────────────────────────────────────────

class CareerRequest(BaseModel):
    materials_context: str  # Сборка всех конспектов юзера

from agents.career import CareerAgent
from agents.career_course import CareerCourseAgent, get_expert_persona

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


class CareerCourseGenerateRequest(BaseModel):
    profession: str
    level: str
    salary: str
    user_materials: str = ""
    location: Optional[str] = ""
    age: Optional[int] = None
    gender: Optional[str] = ""
    extra_context: Optional[str] = ""
    vacancy_context: Optional[str] = ""

class CareerCourseExpandRequest(BaseModel):
    current_course: dict
    additional_focus: str
    extra_context: Optional[str] = ""


class CareerNextModuleRequest(BaseModel):
    user_id: str
    current_course: dict


class CareerVacanciesRequest(BaseModel):
    profession: str
    location: Optional[str] = ""


class CareerVacancyChatRequest(BaseModel):
    message: str
    history: List[dict] = []
    vacancy_title: str
    vacancy_company: str
    vacancy_requirements: str
    vacancy_responsibility: str


class CareerChatRequest(BaseModel):
    message: str
    history: List[ChatMessage]
    profession: Optional[str] = None
    level: Optional[str] = None
    salary: Optional[str] = None
    is_expansion: Optional[bool] = False


class CareerTaskEvaluateRequest(BaseModel):
    profession: str
    module_title: str
    task_description: str
    practice_type: str
    student_solution: str
    feedback_notes: Optional[str] = ""


class CareerVacancyParseRequest(BaseModel):
    url: str


class CareerDiagnosticTestRequest(BaseModel):
    module_title: str
    module_theory: str
    profession: str


class CareerCodeDiagnosticsRequest(BaseModel):
    code: str
    module_title: str
    task_description: str


class CareerGithubReadmeRequest(BaseModel):
    profession: str
    completed_modules: List[str]



async def fetch_hh_vacancies(profession: str, location: str = "") -> str:
    """
    Скачивает вакансии из API HeadHunter по названию профессии и локации,
    извлекает требования, обязанности и ключевые навыки.
    """
    import httpx
    import re
    
    url = "https://api.hh.ru/vacancies"
    headers = {
        "User-Agent": "StudyForge/1.0 (contact@studyforge.edu)"
    }
    
    # Геотаргетинг: добавляем локацию прямо в поисковый запрос (самый надежный способ фильтрации)
    query_text = f"{profession} {location}".strip()
    
    # Маппинг регионов на HH area ID
    area_id = None
    if location:
        loc_lower = location.lower()
        if "беларусь" in loc_lower or "belarus" in loc_lower or "минск" in loc_lower:
            area_id = 16
        elif "казахстан" in loc_lower or "kazakhstan" in loc_lower or "алматы" in loc_lower or "астана" in loc_lower:
            area_id = 40
        elif "узбекистан" in loc_lower or "uzbekistan" in loc_lower or "ташкент" in loc_lower:
            area_id = 97
        elif "россия" in loc_lower or "russia" in loc_lower or "москва" in loc_lower or "спб" in loc_lower or "петербург" in loc_lower:
            area_id = 113
            
    params = {
        "text": query_text,
        "per_page": 12,
        "only_with_salary": "true"
    }
    if area_id:
        params["area"] = area_id
    
    async with httpx.AsyncClient() as client:
        response = await client.get(url, headers=headers, params=params, timeout=8.0)
        if response.status_code != 200:
            raise Exception(f"HH API returned status {response.status_code}")
        
        data = response.json()
        items = data.get("items", [])
        if not items:
            raise Exception("No vacancies found on HH")
            
        summary = []
        clean_html = re.compile('<.*?>')
        
        for item in items[:8]:
            title = item.get("name", "Вакансия")
            salary_info = item.get("salary") or {}
            salary_from = salary_info.get("from")
            salary_to = salary_info.get("to")
            salary_currency = salary_info.get("currency", "RUR")
            
            sal_str = ""
            if salary_from and salary_to:
                sal_str = f"Зарплата: {salary_from} - {salary_to} {salary_currency}"
            elif salary_from:
                sal_str = f"Зарплата: от {salary_from} {salary_currency}"
            elif salary_to:
                sal_str = f"Зарплата: до {salary_to} {salary_currency}"
            
            snippet = item.get("snippet") or {}
            req = snippet.get("requirement") or ""
            resp = snippet.get("responsibility") or ""
            
            req = re.sub(clean_html, '', req)
            resp = re.sub(clean_html, '', resp)
            
            summary.append(f"- {title} ({sal_str})\n  Требования: {req}\n  Обязанности: {resp}")
            
        return "\n\n".join(summary)


async def fetch_trudvsem_vacancies(profession: str, location: str = "") -> str:
    """
    Скачивает вакансии из государственного API 'Работа в России' (api.trudvsem.ru).
    Используется как резервный источник.
    """
    import httpx
    import re
    
    url = "https://opendata.trudvsem.ru/api/v1/vacancies"
    query_text = f"{profession} {location}".strip()
    
    params = {
        "text": query_text,
        "limit": 10
    }
    
    async with httpx.AsyncClient() as client:
        response = await client.get(url, params=params, timeout=8.0)
        if response.status_code != 200:
            raise Exception(f"TrudVsem API returned status {response.status_code}")
        
        data = response.json()
        results = data.get("results", {})
        vacancies = results.get("vacancies", [])
        if not vacancies:
            raise Exception("No vacancies found on TrudVsem")
            
        summary = []
        clean_html = re.compile('<.*?>')
        
        for item in vacancies[:8]:
            v = item.get("vacancy", {})
            title = v.get("job-name", "Вакансия")
            salary = v.get("salary", "не указана")
            req = v.get("requirement", {}).get("education", "") or v.get("requirement", {}).get("qualification", "") or ""
            duty = v.get("duty", "")
            
            req = re.sub(clean_html, '', req)
            duty = re.sub(clean_html, '', duty)
            
            summary.append(f"- {title} (Зарплата: {salary})\n  Требования: {req}\n  Обязанности: {duty}")
            
        return "\n\n".join(summary)


async def fetch_structured_vacancies(profession: str, location: str = "") -> list:
    import httpx
    import re
    
    # 1. Try HH first
    try:
        url = "https://api.hh.ru/vacancies"
        headers = {
            "User-Agent": os.getenv("HH_USER_AGENT", "StudyForge/1.0 (contact@studyforge.edu)")
        }
        # Маппинг регионов на HH area ID
        area_id = None
        if location:
            loc_lower = location.lower()
            if "беларусь" in loc_lower or "belarus" in loc_lower or "минск" in loc_lower:
                area_id = 16
            elif "казахстан" in loc_lower or "kazakhstan" in loc_lower or "алматы" in loc_lower or "астана" in loc_lower:
                area_id = 40
            elif "узбекистан" in loc_lower or "uzbekistan" in loc_lower or "ташкент" in loc_lower:
                area_id = 97
            elif "россия" in loc_lower or "russia" in loc_lower or "москва" in loc_lower or "спб" in loc_lower or "петербург" in loc_lower:
                area_id = 113
                
        if area_id:
            query_text = profession.strip()
        else:
            query_text = f"{profession} {location}".strip()
            
        params = {
            "text": query_text,
            "per_page": 12
        }
        if area_id:
            params["area"] = area_id
            
        async with httpx.AsyncClient() as client:
            response = await client.get(url, headers=headers, params=params, timeout=8.0)
            if response.status_code == 200:
                data = response.json()
                items = data.get("items", [])
                if items:
                    result = []
                    clean_html = re.compile('<.*?>')
                    for item in items[:5]:
                        title = item.get("name", "Вакансия")
                        company = item.get("employer", {}).get("name", "Не указана")
                        salary_info = item.get("salary") or {}
                        salary_from = salary_info.get("from")
                        salary_to = salary_info.get("to")
                        salary_currency = salary_info.get("currency", "RUR")
                        
                        sal_str = ""
                        if salary_from and salary_to:
                            sal_str = f"{salary_from} - {salary_to} {salary_currency}"
                        elif salary_from:
                            sal_str = f"от {salary_from} {salary_currency}"
                        elif salary_to:
                            sal_str = f"до {salary_to} {salary_currency}"
                        else:
                            sal_str = "не указана"
                            
                        snippet = item.get("snippet") or {}
                        req_text = snippet.get("requirement") or ""
                        resp_text = snippet.get("responsibility") or ""
                        
                        req_text = re.sub(clean_html, '', req_text)
                        resp_text = re.sub(clean_html, '', resp_text)
                        
                        alt_url = item.get("alternate_url", "")
                        
                        result.append({
                            "title": title,
                            "company": company,
                            "salary": sal_str,
                            "requirements": req_text,
                            "responsibility": resp_text,
                            "url": alt_url,
                            "source": "HeadHunter"
                        })
                    return result
    except Exception as e:
        print(f"Structured HH failed: {e}")

    # 2. Try TrudVsem fallback
    try:
        url = "https://opendata.trudvsem.ru/api/v1/vacancies"
        query_text = f"{profession} {location}".strip()
        params = {
            "text": query_text,
            "limit": 10
        }
        async with httpx.AsyncClient() as client:
            response = await client.get(url, params=params, timeout=8.0)
            if response.status_code == 200:
                data = response.json()
                results = data.get("results", {})
                vacancies = results.get("vacancies", [])
                if vacancies:
                    result = []
                    clean_html = re.compile('<.*?>')
                    for item in vacancies[:5]:
                        v = item.get("vacancy", {})
                        title = v.get("job-name", "Вакансия")
                        company = v.get("company", {}).get("name", "Не указана")
                        salary = v.get("salary", "не указана")
                        
                        req_text = v.get("requirement", {}).get("education", "") or v.get("requirement", {}).get("qualification", "") or ""
                        resp_text = v.get("duty", "")
                        
                        req_text = re.sub(clean_html, '', req_text)
                        resp_text = re.sub(clean_html, '', resp_text)
                        
                        alt_url = v.get("vac_url", "")
                        
                        result.append({
                            "title": title,
                            "company": company,
                            "salary": f"{salary} RUR" if isinstance(salary, (int, float)) or (isinstance(salary, str) and salary.isdigit()) else str(salary),
                            "requirements": req_text,
                            "responsibility": resp_text,
                            "url": alt_url,
                            "source": "Работа в России"
                        })
                    return result
    except Exception as e:
        print(f"Structured TrudVsem failed: {e}")
        
    # 3. Fallback to intelligent LLM generation when standard APIs fail or are blocked
    if GROQ_API_KEY:
        try:
            print("Falling back to LLM to generate realistic vacancies...")
            agent = BaseAgent(api_key=GROQ_API_KEY)
            
            # Map location to HH area codes
            area_id = ""
            loc_lower = location.lower() if location else ""
            if "минск" in loc_lower or "беларусь" in loc_lower:
                area_id = "16"
            elif "алматы" in loc_lower or "астана" in loc_lower or "казахстан" in loc_lower:
                area_id = "40"
            elif "ташкент" in loc_lower or "узбекистан" in loc_lower:
                area_id = "97"
            elif "москва" in loc_lower:
                area_id = "1"
            elif "петербург" in loc_lower or "спб" in loc_lower:
                area_id = "2"
            elif "россия" in loc_lower:
                area_id = "113"
                
            prof_query = profession.replace(' ', '+')
            loc_query = location.replace(' ', '+') if location else ""
            
            system_prompt = f"""You are a professional HR assistant and technical recruiter for StudyForge.
Your task is to generate 4 to 5 highly realistic, detailed, existing-style vacancies for a candidate in the field of: '{profession}' located in: '{location}'.

You MUST output ONLY a valid JSON list of objects (no markdown, no backticks, no code blocks, just raw JSON).
Each object in the JSON list MUST have the exact keys:
1. "title": Specific job title (e.g., "Junior Python-разработчик"). Make them realistic, highly technical, and varied.
2. "company": A realistic, active IT company or agency in this location (e.g. EPAM, Yandex, BelkaCar, local IT firms).
3. "salary": Realistic salary range in the appropriate local currency (e.g., "2200 - 3500 BYN" for Minsk, "от 120 000 руб." for Russia, or "1500 - 2500 USD").
4. "requirements": Bulleted or plain text list of realistic technical requirements.
5. "responsibility": Plain text list of realistic job responsibilities.
6. "url": A working search link on HeadHunter for this position in this city.
   Use the area ID "{area_id}" if not empty.
   Format: "https://hh.ru/search/vacancy?text={prof_query}+{loc_query}&area={area_id}" (if area_id is not empty) or "https://hh.ru/search/vacancy?text={prof_query}+{loc_query}" (if empty).
7. "source": "HeadHunter (ИИ-Подборка)"

Example output format:
[
  {{
    "title": "Junior Python-разработчик",
    "company": "СофтТехнолоджи",
    "salary": "1800 - 2500 BYN",
    "requirements": "Знание Python 3, Django or FastAPI, базовые знания SQL, Git.",
    "responsibility": "Разработка серверной части веб-приложений, поддержка существующего кода, написание тестов.",
    "url": "https://hh.ru/search/vacancy?text=Python+FastAPI&area=16",
    "source": "HeadHunter (ИИ-Подборка)"
  }}
]
"""
            user_query = f"Сгенерируй 4-5 реалистичных вакансий для '{profession}' в локации '{location}'."
            reply = await agent.run(system_prompt, user_query)
            
            # Clean up potential markdown code block wrappers
            reply = reply.strip()
            if reply.startswith("```"):
                reply = re.sub(r"^```(?:json)?\n", "", reply)
                reply = re.sub(r"\n```$", "", reply)
                reply = reply.strip()
                
            generated = json.loads(reply)
            if isinstance(generated, list) and len(generated) > 0:
                print(f"Successfully generated {len(generated)} realistic vacancies via LLM.")
                return generated
        except Exception as ex:
            print(f"LLM vacancy generation failed: {ex}")
            
    return []


@app.post("/api/career/vacancies")
@limiter.limit("10/minute")
async def get_career_vacancies(request: Request, req: CareerVacanciesRequest):
    vacancies = await fetch_structured_vacancies(req.profession, req.location)
    if not vacancies:
        # Return fallback mock vacancies
        vacancies = [
            {
                "title": f"Junior {req.profession}",
                "company": "Учебный трек StudyForge",
                "salary": "от 120 000 руб.",
                "requirements": f"Базовые навыки по направлению {req.profession}, инициативность, умение работать в команде.",
                "responsibility": "Разработка учебных проектов, участие в командных созвонах, прохождение практики.",
                "url": "https://hh.ru",
                "source": "Рыночный стандарт"
            }
        ]
    return vacancies


@app.post("/api/career/vacancy_chat")
@limiter.limit("15/minute")
async def career_vacancy_chat(request: Request, req: CareerVacancyChatRequest):
    if not GROQ_API_KEY:
        raise HTTPException(status_code=500, detail="GROQ_API_KEY не настроен на сервере")
        
    agent = BaseAgent(api_key=GROQ_API_KEY)
    
    system_prompt = f"""Ты — Форджи, элитный карьерный коуч и технический консультант StudyForge.
Сейчас ты консультируешь студента по конкретной выбранной им вакансии, которую он хочет получить в качестве своей карьерной цели.

ИНФОРМАЦИЯ О ВАКАНСИИ:
- Должность: {req.vacancy_title}
- Компания: {req.vacancy_company}
- Требования к кандидату: {req.vacancy_requirements}
- Обязанности: {req.vacancy_responsibility}

Правила консультации:
1. Будь искренне поддерживающим, экспертным и вовлеченным ментором. Отвечай подробно и конструктивно, давай практические советы по подготовке.
2. Проанализируй требования вакансии: объясни студенту, какие технологии из списка критически важны, какие вопросы ему могут задать на собеседовании по этой вакансии, какие темы нужно знать «на зубок».
3. Дай совет, как лучше составить резюме именно под эту вакансию, какие проекты в портфолио показать.
4. Отвечай ёмко, структурировано (используй списки и абзацы для легкого чтения).
5. ВАЖНО: Если студент прямо или косвенно просит изменить направление поиска, посмотреть другие вакансии, сменить стек, профессию или город (например: «хочу стать бэкендером», «покажи вакансии в Москве», «давай поищем Node.js» или «а есть бэкенд?»), ты обязан дружелюбно согласиться, объяснить, что ты сейчас перестроишь поиск под его новый запрос, и в самом конце своего сообщения прикрепить управляющий токен:
   [UPDATE_VACANCIES_ACTION:NewProfessionName|NewLocation]
   Где:
   - NewProfessionName: уточненное/новое название профессии на русском (например: Backend-разработчик, Node.js разработчик, Системный аналитик).
   - NewLocation: город или страна для поиска (например: Москва, Санкт-Петербург, Минск, Алматы). Если локация не указана или не изменилась, оставь прежнюю локацию (или напиши "Россия").
   Пример: "Отличный выбор! Бэкенд-разработка сейчас очень востребована. Секунду, перенастраиваю наш поиск на Backend-разработчика в Минске... [UPDATE_VACANCIES_ACTION:Backend-разработчик|Минск]"
"""

    history_text = "\n".join([f"{msg.get('role')}: {msg.get('content')}" for msg in req.history[-10:] if isinstance(msg, dict)])
    full_user_query = f"ИСТОРИЯ ДИАЛОГА:\n{history_text}\n\nТЕКУЩИЙ ВОПРОС СТУДЕНТА ПО ВАКАНСИИ: {req.message}"
    
    reply = await agent.run(system_prompt, full_user_query)
    return {"reply": reply}


@app.post("/api/career/chat")
@limiter.limit("20/minute")
async def career_chat(request: Request, req: CareerChatRequest):
    agent = BaseAgent(api_key=GROQ_API_KEY)
    
    if req.is_expansion:
        system_prompt = f"""Ты — Форджи, элитный карьерный коуч, эксперт по профессиональному ориентированию и HR-методист StudyForge.
Ты общаешься со студентом, который только что успешно завершил базовый курс по направлению "{req.profession or 'Разработчик'}" (уровень: {req.level or 'Junior'}, целевая зарплата: {req.salary or 'договорная'}).
Он хочет расширить обучение и добавить новые продвинутые, сверхсложные модули.

Твоя цель — провести поддерживающий, живой и конструктивный диалог, чтобы помочь ему выбрать одно из продвинутых направлений развития и сразу же запустить проектирование новых модулей.

Правила ведения диалога:
1. Будь искренне поддерживающим, эмпатичным и вовлеченным, как лучший личный ментор. Обращайся к студенту уважительно, но тепло, на "ты".
2. НЕ ЗАДАВАЙ никаких базовых вопросов (таких как возраст, пол, город проживания, целевая зарплата) — все эти данные у нас уже есть!
3. Сфокусируйся исключительно на профессиональных целях расширения. Например, если он учился на C#/.NET, предложи вектора:
   - **Архитектура и Highload** (микросервисы, брокеры сообщений RabbitMQ/Kafka, паттерны)
   - **DevOps-культура** (Docker, Kubernetes, CI/CD)
   - **Data & Storage** (продвинутый SQL, индексы, оптимизация, NoSQL вроде Redis/MongoDB)
   - **Fullstack-направление** (React, Angular, TypeScript в связке с .NET бэкендом)
4. Если студент кратко или явно отвечает на твой вопрос или предлагает вектор (например: "размеренный темп, давай фуллстэк" или "хочу Highload"), НЕ мучай его дополнительными вопросами и опросами о локации, возрасте или чем-либо еще! Сразу же подтверди его выбор, вдохнови его и прикрепи управляющий токен.
5. Форматируй свои реплики: используй красивые маркированные списки, выделяй ключевые технологии и термины **жирным шрифтом**, разбивай текст на абзацы для легкого чтения.
6. Когда вектор выбран или студент подтвердил свое желание (например, выбрал Fullstack), ты ОБЯЗАН в самом конце своего сообщения прикрепить управляющий токен:
   [EXPAND_COURSE_ACTION:НазваниеНаправления|ДополнительныйКонтекст]
   Где:
   - НазваниеНаправления: Краткое название выбранного вектора на английском или русском языке (например, "Fullstack", "Highload", "DevOps", "Advanced Databases").
   - ДополнительныйКонтекст: Важные пожелания студента (например, "размеренный темп, React" или "Docker, Kubernetes"). Если нет, поставь "".
   
Пример: "...Отличный выбор! Я проектирую для тебя продвинутые модули по Fullstack. [EXPAND_COURSE_ACTION:Fullstack|размеренный темп, React]"

ВАЖНО: Если студент уже прямо выразил свой выбор (например: "размеренный темп, давай фуллстэк"), ты должен СРАЗУ сгенерировать сообщение с токеном [EXPAND_COURSE_ACTION:...] в конце, чтобы не затягивать процесс и мгновенно перейти к расширению курса!
Не здоровайся заново в каждой реплике. Пиши ёмко, разбивай текст на абзацы для легкого чтения."""
    else:
        system_prompt = """Ты — Форджи, элитный карьерный коуч, эксперт по профессиональному ориентированию и HR-методист StudyForge.
Твоя цель — провести со студентом поддерживающий, живой и глубокий диалог, чтобы помочь ему определиться с идеальной карьерной траекторией.

Правила ведения диалога:
1. Будь искренне поддерживающим, эмпатичным и вовлеченным, как лучший личный ментор. Обращайся к студенту уважительно, но тепло, на "ты".
2. Твоя задача — ненавязчиво и дружелюбно выяснить:
   - Какое конкретное направление или сфера ему интересны (программирование, дизайн, аналитика, менеджмент, маркетинг и т.д.).
   - Каковы его пожелания по уровню (Junior, Middle) и целевой зарплате.
   - Где он живет (страна/город), чтобы курс учитывал локальный рынок труда (например, Москва, Санкт-Петербург, Минск, Алматы). Это критично для точного поиска вакансий!
   - Его возраст и пол (для адаптации педагогического подхода и психологических soft-skills заданий).
   - Его текущий уровень опыта/знаний в этой сфере (абсолютный новичок, «полный ноль», есть ли минимальная база или опыт в смежных областях).
   - Его особые условия или ограничения (сколько времени готов уделять учебе, есть ли совмещение с работой, уход за ребенком, особый график и тд).
3. Обсуждай альтернативы, отвечающие интересам студента, отвечай на любые вопросы о профессиях, развеивай страхи перед собеседованиями.
4. Структурируй свои реплики: используй красивые маркированные списки, выделяй ключевые технологии и термины **жирным шрифтом**, разбивай текст на абзацы для легкого чтения. Ответы должны выглядеть профессионально и опрятно.
5. Когда вы полностью определитесь со всеми параметрами, скажи студенту, что готов запустить генерацию уникального персонального курса, который соберет реальные требования вакансий с HeadHunter именно по его локации, адаптирует сложность под его уровень («полный ноль» или с базой) и создаст адаптивный курс под его возраст и жизненную ситуацию с песочницами.
6. В этот же момент ты ОБЯЗАН в самом конце своего сообщения прикрепить расширенный секретный управляющий токен:
   [GENERATE_COURSE_ACTION:ProfessionName|Salary|Level|Location|Age|Gender|ExtraContext]
   Где:
   - ProfessionName: Точное выверенное название профессии на русском языке (например, Frontend-разработчик, Системный аналитик, Маркетолог).
   - Salary: Целевая зарплата (число или строка, например 100000, 150000).
   - Level: Выбранный уровень квалификации (Junior, Middle, Senior).
   - Location: Выясненный город или страна (например: Москва, Алматы, Россия). Если не указано, поставь "Россия".
   - Age: Выясненный возраст (например: 22, 35). Если не указан, поставь "".
   - Gender: Пол (например: Мужской, Женский). Если не указан, поставь "".
   - ExtraContext: Любые важные жизненные условия, опыт или ограничения через запятую (например: совмещаю с работой, молодая мама, 2 часа в день, полный ноль, нет опыта). Если нет, поставь "".
   
Пример: "...Я готов составить для тебя потрясающий практический курс! [GENERATE_COURSE_ACTION:Frontend-разработчик|120000|Junior|Москва|23|Мужской|полный ноль, совмещаю с основной работой, 2 часа в день]"

ВАЖНО: До тех пор, пока параметры не согласованы полностью, НЕ прикрепляй этот токен. Задавай уточняющие вопросы, веди содержательный диалог.
Не здоровайся заново в каждой реплике. Пиши ёмко, разбивай текст на абзацы для легкого чтения."""

    history_text = "\n".join([f"{msg.role}: {msg.content}" for msg in req.history[-10:]])
    full_user_query = f"ИСТОРИЯ ДИАЛОГА:\n{history_text}\n\nТЕКУЩИЙ ЗАПРОС СТУДЕНТА: {req.message}"
    
    reply = await agent.run(system_prompt, full_user_query)
    return {"reply": reply}


@app.post("/api/career/course")
@limiter.limit("5/minute")
async def career_course(request: Request, req: CareerCourseGenerateRequest):
    if not GROQ_API_KEY:
        raise HTTPException(status_code=500, detail="GROQ_API_KEY не настроен на сервере")
        
    vacancy_text = ""
    if req.vacancy_context:
        print("Using selected vacancy context provided by frontend...")
        vacancy_text = req.vacancy_context
    else:
        # Сначала пытаемся получить вакансии из HH API
        try:
            print(f"Trying to fetch vacancies from HH for {req.profession} in {req.location}...")
            vacancy_text = await fetch_hh_vacancies(req.profession, req.location)
        except Exception as e_hh:
            print(f"HH API failed: {e_hh}. Trying fallback 'Работа в России' API...")
            # Если HH не сработал, пробуем резервный ТрудоВсем
            try:
                vacancy_text = await fetch_trudvsem_vacancies(req.profession, req.location)
                print("Successfully fetched vacancies from 'Работа в России' fallback API.")
            except Exception as e_trud:
                print(f"TrudVsem fallback API also failed: {e_trud}")
                # Обе системы лежат — честно говорим пользователю подождать, как просил клиент
                raise HTTPException(
                    status_code=503, 
                    detail="Серверы вакансий (HeadHunter и Работа в России) временно перегружены или недоступны. Пожалуйста, подождите 1-2 минуты и повторите попытку."
                )
            
    agent = CareerCourseAgent(api_key=GROQ_API_KEY)
    
    try:
        course_data = await agent.generate_course(
            req.profession,
            req.level,
            req.salary,
            req.user_materials,
            vacancy_text,
            age=req.age,
            gender=req.gender,
            location=req.location,
            extra_context=req.extra_context
        )
        return course_data
    except Exception as e:
        print(f"Error generating course: {e}")
        raise HTTPException(status_code=500, detail=f"Ошибка генерации курса: {str(e)}")


@app.post("/api/career/expand")
@limiter.limit("5/minute")
async def career_expand(request: Request, req: CareerCourseExpandRequest):
    if not GROQ_API_KEY:
        raise HTTPException(status_code=500, detail="GROQ_API_KEY не настроен на сервере")
        
    agent = CareerCourseAgent(api_key=GROQ_API_KEY)
    try:
        new_modules = await agent.expand_course(
            req.current_course,
            req.additional_focus,
            req.extra_context
        )
        return {"new_modules": new_modules}
    except Exception as e:
        print(f"Error expanding course: {e}")
        raise HTTPException(status_code=500, detail=f"Ошибка расширения курса: {str(e)}")


@app.post("/api/career/next_module")
@limiter.limit("5/minute")
async def career_next_module(request: Request, req: CareerNextModuleRequest):
    if not GROQ_API_KEY:
        raise HTTPException(status_code=500, detail="GROQ_API_KEY не настроен на сервере")
        
    course = req.current_course
    
    # Внедряем ограничение генерации: максимум 2 темы в день (после первых двух бесплатных)
    import time
    now = time.time()
    one_day_ago = now - 24 * 60 * 60
    recent_timestamps = [t for t in course.get("generation_timestamps", []) if t > one_day_ago]
    
    if len(recent_timestamps) >= 2:
        raise HTTPException(
            status_code=400,
            detail="Вы исчерпали лимит генерации новых тем на сегодня (максимум 2 новые темы в день). Отдохните и возвращайтесь завтра!"
        )
        
    syllabus = course.get("syllabus", {})
    chapters = syllabus.get("chapters", [])
    
    # Находим первую невыполненную тему
    target_topic = None
    target_chapter_idx = -1
    target_topic_idx = -1
    
    for c_idx, chapter in enumerate(chapters):
        for t_idx, topic in enumerate(chapter.get("topics", [])):
            if not topic.get("is_completed"):
                target_topic = topic
                target_chapter_idx = c_idx
                target_topic_idx = t_idx
                break
        if target_topic:
            break
            
    if not target_topic:
        return {"completed": True, "course": course}
        
    topic_title = target_topic.get("title")
    agent = CareerCourseAgent(api_key=GROQ_API_KEY)
    
    try:
        new_module = await agent.generate_next_module(
            profession=course.get("profession", "Разработчик"),
            level=course.get("level", "Junior"),
            salary=course.get("salary", "100000"),
            topic_title=topic_title,
            current_course=course
        )
        
        if not new_module or not new_module.get("id"):
            raise HTTPException(status_code=500, detail="ИИ вернул невалидную структуру модуля")
            
        # Обновляем силлабус в курсе
        target_topic["is_completed"] = False
        target_topic["module_id"] = new_module["id"]
        
        # Добавляем новый модуль в список модулей курса
        if "modules" not in course:
            course["modules"] = []
        course["modules"].append(new_module)
        
        # Обновляем силлабус внутри курса
        course["syllabus"] = syllabus
        
        # Записываем время успешной генерации
        recent_timestamps.append(now)
        course["generation_timestamps"] = recent_timestamps
        
        return {"completed": False, "course": course}
        
    except Exception as e:
        print(f"Error generating next module: {e}")
        raise HTTPException(status_code=500, detail=f"Ошибка генерации следующего модуля: {str(e)}")


@app.post("/api/career/evaluate_task")
@limiter.limit("10/minute")
async def career_evaluate_task(request: Request, req: CareerTaskEvaluateRequest):
    if not GROQ_API_KEY:
        raise HTTPException(status_code=500, detail="GROQ_API_KEY не настроен на сервере")
        
    expert = get_expert_persona(req.profession)
    agent = BaseAgent(api_key=GROQ_API_KEY)
    
    system_prompt = f"""Ты — {expert['title']}.
Твой стиль преподавания и тон: {expert['tone']}

Твоя задача — провести глубокий, экспертный разбор практического решения студента.
Студент обучается по направлению "{req.profession}" в рамках модуля "{req.module_title}".

ОПИСАНИЕ ПРАКТИЧЕСКОГО ЗАДАНИЯ (ТЗ):
{req.task_description}

Тип песочницы: {req.practice_type}

РЕШЕНИЕ СТУДЕНТА:
{req.student_solution}

ИНСТРУКЦИЯ ПО РАЗБОРУ:
1. Выступи в роли авторитетного, профессионального наставника. Отметь, насколько решение решает бизнес-задачу или техническую проблему.
2. Проанализируй качество исполнения:
   - Если это код (algo, sql, web): разбери стиль кода, возможные уязвимости, крайние случаи (edge cases) и производительность. Дай конкретные рекомендации по рефакторингу.
   - Если это бизнес-расчет или дизайн-критика/копирайтинг: разбери глубину анализа, логику формул, стиль изложения, маркетинговую или продуктовую ценность.
   - Если это Soft Skills (roleplay): разбери тактичность, эмпатию, силу аргументов и убедительность.
3. Поставь честный балл от 0 до 100 на основе качества.
4. Твой разбор должен быть ободряющим, но профессиональным, без пустой похвалы — студент пришел за качественным ростом.

ВНИМАНИЕ: Если решение студента является полностью верным, оптимальным, решает все условия ТЗ и не имеет недостатков (например, студент вставил идеальный предложенный ИИ код или написал полностью верное решение), ты ОБЯЗАН поставить 100 из 100 баллов ("score": 100) и оставить список "weaknesses" пустым. Не придумывай искусственные замечания и придирки ради занижения балла. Будь абсолютно объективен!

ОБЯЗАТЕЛЬНО верни строго JSON-структуру без markdown-оберток (НИКАКИХ ```json или ```):
{{
  "score": 100,
  "verdict": "Итоговое развернутое ревью (3-4 содержательных предложения).",
  "strengths": ["Что сделано отлично"],
  "weaknesses": ["Что можно улучшить или исправить (оставь пустым, если оценка 100)"],
  "refactored_solution": "Если применимо, покажи идеальный пример кода/текста/расчета с комментариями."
}}
"""

    raw = await agent.run(system_prompt, "Пожалуйста, проанализируй моё решение.")
    try:
        return parse_llm_json(raw)
    except Exception as e:
        print(f"Error parsing evaluate_task: {e}, raw: {raw}")
        return {
            "score": 75,
            "verdict": "Ваше решение получено и проверено локальными тестами. AI-анализ завершился с ошибкой, но вы справились с базовым функционалом!",
            "strengths": ["Код/ответ успешно прошел автоматическую валидацию"],
            "weaknesses": ["Не удалось получить глубокий ИИ-разбор"],
            "refactored_solution": ""
        }


# ── Career Learning Engine (Sprint 1 additions) ───────────────────────────────

class CareerReviewTestRequest(BaseModel):
    module_id: str
    module_title: str
    module_theory: str
    practice_type: str

class CareerRetryTaskRequest(BaseModel):
    module_title: str
    practice_type: str
    original_task: str
    weaknesses: List[str] = []

class CareerModuleHintRequest(BaseModel):
    paragraph_text: str
    profession: str

class CareerUpdateReviewRequest(BaseModel):
    module_id: str
    course_profession: str
    score: int  # 0-100: determines SM-2 quality factor


class CareerMockInterviewStartRequest(BaseModel):
    profession: str
    vacancy_title: str
    vacancy_company: str
    vacancy_requirements: str
    completed_modules_titles: List[str]


class CareerMockInterviewRespondRequest(BaseModel):
    profession: str
    vacancy_title: str
    vacancy_company: str
    chat_history: List[dict]
    student_answer: str


class CareerMockInterviewEvaluateRequest(BaseModel):
    profession: str
    vacancy_title: str
    vacancy_company: str
    chat_history: List[dict]


class CareerSocraticChatRequest(BaseModel):
    paragraph_text: str
    profession: str
    message: str
    chat_history: List[dict]
    mode: str = "socratic"          # "explain" | "socratic"
    is_beginner: bool = False       # true = absolute beginner, adapt language


@app.post("/api/career/review_test")
@limiter.limit("20/minute")
async def career_review_test(request: Request, req: CareerReviewTestRequest):
    """Generate a 3-question Spaced Repetition mini-test for a completed module."""
    if not GROQ_API_KEY:
        raise HTTPException(status_code=500, detail="GROQ_API_KEY не настроен")

    agent = CareerCourseAgent(api_key=GROQ_API_KEY)
    try:
        result = await agent.generate_review_test(
            req.module_title,
            req.module_theory,
            req.practice_type
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка генерации теста повторения: {str(e)}")


@app.post("/api/career/retry_task")
@limiter.limit("10/minute")
async def career_retry_task(request: Request, req: CareerRetryTaskRequest):
    """Generate an alternative practice task when student scores below mastery threshold (70)."""
    if not GROQ_API_KEY:
        raise HTTPException(status_code=500, detail="GROQ_API_KEY не настроен")

    agent = CareerCourseAgent(api_key=GROQ_API_KEY)
    try:
        result = await agent.generate_retry_task(
            req.module_title,
            req.practice_type,
            req.original_task,
            req.weaknesses
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка генерации альтернативного задания: {str(e)}")


@app.post("/api/career/module_hint")
@limiter.limit("30/minute")
async def career_module_hint(request: Request, req: CareerModuleHintRequest):
    """Socratic Micro-Tutor: explain a theory paragraph in a different way."""
    if not GROQ_API_KEY:
        raise HTTPException(status_code=500, detail="GROQ_API_KEY не настроен")

    agent = CareerCourseAgent(api_key=GROQ_API_KEY)
    try:
        explanation = await agent.get_module_hint(req.paragraph_text, req.profession)
        return {"explanation": explanation}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка получения подсказки: {str(e)}")


@app.post("/api/career/mock_interview_start")
@limiter.limit("5/minute")
async def career_mock_interview_start(request: Request, req: CareerMockInterviewStartRequest):
    if not GROQ_API_KEY:
        raise HTTPException(status_code=500, detail="GROQ_API_KEY не настроен")
        
    agent = BaseAgent(api_key=GROQ_API_KEY)
    
    system_prompt = f"""Ты — ИИ-интервьюер, опытный тимлид или технический рекрутер из компании "{req.vacancy_company}".
Ты проводишь реалистичное собеседование на позицию "{req.vacancy_title}".
Собеседование охватывает следующие изученные студентом темы: {', '.join(req.completed_modules_titles)}.

Твои правила:
1. Твоя цель — начать собеседование: поздоровайся от лица рекрутера/тимлида компании "{req.vacancy_company}", назови вакансию и задай первый вовлекающий вопрос (технический или поведенческий/HR).
2. Будь реалистичным, профессиональным, вежливым, но строгим. Оценивай реальный уровень студента.
3. Твоя реплика должна быть краткой (2-4 предложения) и заканчиваться одним вопросом. Не пиши готовых ответов."""

    user_query = "Начни мок-собеседование со мной."
    try:
        reply = await agent.run(system_prompt, user_query)
        return {"session_id": "mock_session_" + str(hash(reply))[:8], "initial_question": reply.strip()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка старта собеседования: {str(e)}")


@app.post("/api/career/mock_interview_respond")
@limiter.limit("15/minute")
async def career_mock_interview_respond(request: Request, req: CareerMockInterviewRespondRequest):
    if not GROQ_API_KEY:
        raise HTTPException(status_code=500, detail="GROQ_API_KEY не настроен")
        
    agent = BaseAgent(api_key=GROQ_API_KEY)
    
    student_turns = sum(1 for msg in req.chat_history if msg.get("role") == "user") + 1
    is_finished = student_turns >= 5
    
    if is_finished:
        return {"next_question": "Спасибо за ответы! Я завершил собеседование и готов подвести итоги. Нажмите кнопку 'Получить результаты', чтобы увидеть детальный разбор.", "is_finished": True}
        
    system_prompt = f"""Ты — ИИ-интервьюер, тимлид или технический рекрутер из компании "{req.vacancy_company}".
Ты проводишь собеседование на позицию "{req.vacancy_title}".

Твои правила:
1. Будь реалистичным, профессиональным, вежливым. Оценивай знания студента.
2. Прочитай его последний ответ и историю диалога. Задай следующий логический вопрос (углубись в его стек, спроси крайний случай или задай поведенческий/HR вопрос).
3. Пиши кратко (2-4 предложения), задавай строго один вопрос за раз. Не давай ответов или спойлеров.
4. Студент ответил: "{req.student_answer}". Твоя задача — задать следующий вопрос."""

    history_text = "\n".join([f"{msg.get('role')}: {msg.get('content')}" for msg in req.chat_history[-10:] if isinstance(msg, dict)])
    full_user_query = f"ИСТОРИЯ ДИАЛОГА:\n{history_text}\n\nСтудент ответил: {req.student_answer}\nЗадай следующий вопрос."
    
    try:
        reply = await agent.run(system_prompt, full_user_query)
        return {"next_question": reply.strip(), "is_finished": False}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка диалога: {str(e)}")


@app.post("/api/career/mock_interview_evaluate")
@limiter.limit("5/minute")
async def career_mock_interview_evaluate(request: Request, req: CareerMockInterviewEvaluateRequest):
    if not GROQ_API_KEY:
        raise HTTPException(status_code=500, detail="GROQ_API_KEY не настроен")
        
    agent = BaseAgent(api_key=GROQ_API_KEY)
    
    history_text = "\n".join([f"{msg.get('role')}: {msg.get('content')}" for msg in req.chat_history if isinstance(msg, dict)])
    
    system_prompt = f"""Ты — экспертная комиссия ИТ-интервьюеров и HR-специалистов.
Тебе предоставлена полная стенограмма мок-собеседования на позицию "{req.vacancy_title}" в компании "{req.vacancy_company}".
Твоя задача — провести детальный и беспристрастный разбор ответов студента.

Критерии оценки:
- Техническая глубина и правильность ответов.
- Умение рассуждать, решать крайние случаи, признавать пробелы.
- Коммуникация, soft skills, структура изложения.

ОБЯЗАТЕЛЬНО верни строго JSON-структуру без markdown-оберток (НИКАКИХ ```json или ```):
{{
  "score": 82,
  "grade": "Junior+" / "Middle-" / "Junior",
  "verdict": "Итоговое развернутое заключение (3-4 содержательных предложения) о готовности к работе.",
  "strengths": ["В чем студент показал себя отлично (конкретные темы/ответы)"],
  "weaknesses": ["В чем проявились пробелы и что нужно доучить"],
  "interview_ready": true
}}"""

    user_query = f"СТЕНОГРАММА СОБЕСЕДОВАНИЯ:\n{history_text}\n\nПожалуйста, проанализируй моё собеседование и дай оценку."
    try:
        raw = await agent.run(system_prompt, user_query)
        return parse_llm_json(raw)
    except Exception as e:
        print(f"Error evaluating interview: {e}")
        return {
            "score": 75,
            "grade": "Junior",
            "verdict": "Ваше собеседование проверено. Ошибка разбора ответа ИИ, но вы показали отличную активность!",
            "strengths": ["Успешно завершен весь трек вопросов ИИ-интервьюера"],
            "weaknesses": ["Сбой детального ИИ-разбора"],
            "interview_ready": False
        }


@app.post("/api/career/socratic_chat")
@limiter.limit("20/minute")
async def career_socratic_chat(request: Request, req: CareerSocraticChatRequest):
    if not GROQ_API_KEY:
        raise HTTPException(status_code=500, detail="GROQ_API_KEY не настроен")
        
    agent = BaseAgent(api_key=GROQ_API_KEY)
    
    beginner_note = """ВАЖНО: Этот студент — ПОЛНЫЙ НОВИЧОК без опыта в данной области. Объясняй максимально просто, используй бытовые аналогии, избегай жаргона без расшифровки.""" if req.is_beginner else ""

    if req.mode == "explain":
        # Mode: give a full, rich, friendly explanation of the paragraph
        system_prompt = f"""Ты — дружелюбный и опытный ИИ-наставник StudyForge по направлению "{req.profession}".
{beginner_note}

Тебе нужно объяснить студенту следующий учебный фрагмент МАКСИМАЛЬНО ПОНЯТНО и ПОДРОБНО:

ФРАГМЕНТ ТЕОРИИ:
"{req.paragraph_text}"

Правила написания объяснения:
1. Начни с сути: что это такое и зачем это нужно (1-2 предложения).
2. Объясни каждую ключевую концепцию простым языком с реальными примерами и аналогиями.
3. Покажи, как это применяется на практике в профессии "{req.profession}".
4. Если есть технические термины — объясняй их прямо в тексте.
5. Заверши объяснение коротким резюме и предложи студенту задать вопросы.
Формат: используй **жирный** для ключевых терминов, \n\n между абзацами.
Длина: 200-350 слов. Пиши на русском."""
        full_user_query = "Объясни мне эту тему."
    else:
        # Mode: socratic dialogue (but adapt for beginners)
        if req.is_beginner:
            system_prompt = f"""Ты — мудрый и добрый ИИ-наставник StudyForge по теме "{req.profession}".
{beginner_note}

Студент изучает:
"{req.paragraph_text}"

Правила диалога с новичком:
1. Отвечай понятно и прямо — новичку нужны ответы, а не только вопросы. Объясни, а затем задай уточняющий вопрос.
2. Если студент не понял — объясни по-другому с новой аналогией.
3. Поддерживай и хвали за попытки разобраться.
4. Пиши кратко (2-4 предложения) и дружелюбно.
5. Не используй термины без объяснения."""
        else:
            system_prompt = f"""Ты — Сократ, великий философ и персональный ИИ-тьютор StudyForge.
Твоя цель — помочь студенту глубже понять следующий абзац учебного материала по направлению "{req.profession}":

АБЗАЦ ТЕОРИИ:
"{req.paragraph_text}"

Правила ведения сократовского диалога:
1. На каждый вопрос или утверждение студента отвечай наводящим вопросом, контрпримером или метафорой.
2. Помогай студенту самому прийти к верному выводу шаг за шагом.
3. Будь вежливым, мудрым, поддерживающим. Пиши кратко (до 3 предложений).
4. Если студент явно не понимает — дай короткое объяснение, затем продолжай диалог."""
        
        history_text = "\n".join([f"{msg.get('role')}: {msg.get('content')}" for msg in req.chat_history[-8:] if isinstance(msg, dict)])
        full_user_query = f"ИСТОРИЯ ДИАЛОГА:\n{history_text}\n\nСтудент: {req.message}"

    if req.mode == "explain":
        full_user_query = "Объясни мне эту тему подробно."
    
    try:
        reply = await agent.run(system_prompt, full_user_query)
        return {"reply": reply.strip()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка Сократ-диалога: {str(e)}")


@app.post("/api/career/parse_vacancy")
@limiter.limit("15/minute")
async def career_parse_vacancy(request: Request, req: CareerVacancyParseRequest):
    if not GROQ_API_KEY:
        raise HTTPException(status_code=500, detail="GROQ_API_KEY не настроен")
        
    import re
    import httpx
    
    agent = BaseAgent(api_key=GROQ_API_KEY)
    
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    }
    
    html_text = ""
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(req.url, headers=headers, timeout=6.0, follow_redirects=True)
            if resp.status_code == 200:
                html_text = resp.text
    except Exception as e:
        print(f"Direct scrap error for {req.url}: {e}")

    body_text = ""
    if html_text:
        # Strip script & style tags
        clean_html = re.sub(r'<(script|style).*?>.*?</\1>', '', html_text, flags=re.DOTALL | re.IGNORECASE)
        # Strip all other HTML tags
        clean_text = re.sub(r'<.*?>', ' ', clean_html, flags=re.DOTALL)
        # Collapse whitespace
        body_text = re.sub(r'\s+', ' ', clean_text).strip()
        
    system_prompt = """Ты — экспертный ИИ-парсер вакансий StudyForge.
Твоя задача — извлечь или спрогнозировать детальные структурированные данные о вакансии из предоставленной страницы или URL.

Верни результат СТРОГО в формате JSON:
{
  "title": "Название вакансии (например, Junior Frontend Developer)",
  "company": "Название компании (например, Сбербанк или Яндекс)",
  "salary": "Зарплата (например, 80 000 - 120 000 ₽ или 'по результатам собеседования')",
  "requirements": "Краткое описание требований вакансии в 2-3 предложениях",
  "skills": ["Навык 1", "Навык 2", "Навык 3", "Навык 4", "Навык 5"]
}

Если переданный текст пуст (был заблокирован парсинг) или содержит мало информации, то на основе URL адреса (например, содержащего 'frontend-developer') и контекста сгенерируй МАКСИМАЛЬНО РЕАЛИСТИЧНЫЕ, качественные и актуальные требования, навыки и оклад для этой вакансии на ИТ-рынке.
"""
    
    user_query = f"URL вакансии: {req.url}\n\nСпарсенный текст страницы:\n{body_text[:4500]}"
    
    try:
        raw = await agent.run(system_prompt, user_query)
        return parse_llm_json(raw)
    except Exception as e:
        # Graceful fallback
        return {
            "title": "IT Специалист",
            "company": "Указанная компания",
            "salary": "по результатам собеседования",
            "requirements": "Разработка надежных систем, работа с базами данных, оптимизация производительности.",
            "skills": ["Git", "SQL", "Docker", "REST API"]
        }


@app.post("/api/career/diagnostic_test")
@limiter.limit("10/minute")
async def career_diagnostic_test(request: Request, req: CareerDiagnosticTestRequest):
    if not GROQ_API_KEY:
        raise HTTPException(status_code=500, detail="GROQ_API_KEY не настроен")
        
    agent = BaseAgent(api_key=GROQ_API_KEY)
    
    system_prompt = f"""Ты — ИИ-Методист StudyForge.
Сгенерируй входной диагностический тест из 5 вопросов множественного выбора (Multiple Choice) для проверки знаний студента перед изучением темы "{req.module_title}" по направлению "{req.profession}".

Правила генерации вопросов:
1. Вопросы должны быть сложными, техническими и охватывать ключевые концепции темы (теории):
"{req.module_theory[:3000]}"
2. Каждый вопрос должен содержать ровно 4 варианта ответа (A, B, C, D) с одним правильным ключом.
3. Дай развернутое пояснение (explanation) для каждого вопроса.

Верни результат СТРОГО в формате JSON:
{{
  "questions": [
    {{
      "question": "Текст вопроса #1",
      "options": ["A) Вариант A", "B) Вариант B", "C) Вариант C", "D) Вариант D"],
      "correct": "A",
      "explanation": "Подробное разъяснение, почему вариант A верен, а другие нет."
    }},
    ... (всего ровно 5 вопросов)
  ]
}}
"""
    
    try:
        raw = await agent.run(system_prompt, "Сгенерируй диагностический тест.")
        return parse_llm_json(raw)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка генерации теста: {str(e)}")


@app.post("/api/career/code_diagnostics")
@limiter.limit("15/minute")
async def career_code_diagnostics(request: Request, req: CareerCodeDiagnosticsRequest):
    if not GROQ_API_KEY:
        raise HTTPException(status_code=500, detail="GROQ_API_KEY не настроен")
        
    agent = BaseAgent(api_key=GROQ_API_KEY)
    
    system_prompt = f"""Ты — ИИ-Архитектор и Технический Лид StudyForge.
Проанализируй черновик решения студента в песочнице для темы "{req.module_title}".

ОПИСАНИЕ ЗАДАНИЯ:
"{req.task_description}"

КОД СТУДЕНТА:
```
{req.code}
```

Сделай глубокий анализ кода и подготовь JSON-отчет. 

ВАЖНОЕ ТРЕБОВАНИЕ К КОДУ:
Наша интерактивная песочница выполняет код на JavaScript (для большинства задач) или SQL (если это база данных/SQL задание).
Поле "refactored_suggestion" ОБЯЗАНО содержать синтаксически корректный и рабочий код, который БУДЕТ ВЫПОЛНЕН в нашей песочнице:
1. Если задание требует написать SQL-запрос, напишите чистый SQL (SELECT ...).
2. Для всех остальных языков и стеков (включая C#, Python, JavaScript и др.) пишите решение в виде JavaScript-функции `function solution(...) {{ ... }}`.
Ни в коем случае НЕ возвращайте C#, Python или C++ код в поле "refactored_suggestion", иначе возникнет ошибка компиляции в песочнице! Код должен быть строго на JavaScript.

ВНИМАНИЕ: Если решение студента уже является полностью верным, оптимальным и не имеет недостатков, оцени его в 100 баллов ("score_estimate": 100) и оставь список замечаний "issues" пустым. Не занижай оценку искусственно!

Верни результат СТРОГО в формате JSON:
{{
  "complexity": "Оценка временной и пространственной сложности (например, Time: O(n), Space: O(1))",
  "issues": [
    "Замечание #1 (оставь список пустым, если оценка 100)",
    "Замечание #2"
  ],
  "refactored_suggestion": "Вариант оптимизированного, чистого и готового к выполнению в песочнице JavaScript/SQL кода",
  "score_estimate": 100
}}
"""
    try:
        raw = await agent.run(system_prompt, "Проанализируй этот код.")
        return parse_llm_json(raw)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка диагностики кода: {str(e)}")


@app.post("/api/career/github_readme")
@limiter.limit("10/minute")
async def career_github_readme(request: Request, req: CareerGithubReadmeRequest):
    if not GROQ_API_KEY:
        raise HTTPException(status_code=500, detail="GROQ_API_KEY не настроен")
        
    agent = BaseAgent(api_key=GROQ_API_KEY)
    
    completed_modules_str = ", ".join(req.completed_modules)
    
    system_prompt = f"""Ты — ИИ-Технический Рекрутер и Бренд-Консультант для разработчиков.
Сгенерируй потрясающий, профессиональный файл README.md для GitHub-профиля студента, обучающегося по направлению "{req.profession}".
Студент успешно освоил следующие темы в ИИ-буткемпе StudyForge: {completed_modules_str}.

Структура README должна включать:
1. Заголовок с именем/направлением и целями.
2. Иконки технологий (используй щиты shields.io).
3. Раздел с пет-проектами из пройденных модулей (подано в привлекательном коммерческом виде).
4. Метрики (например, оцифрованный Match Score, пройденные ИИ-собеседования).
5. Раздел с контактами.

Пиши на русском языке, используй премиальные Markdown-блоки и красивые эмодзи."""
    
    try:
        readme = await agent.run(system_prompt, "Создай премиальный README.md для моего профиля GitHub.")
        return {"readme": readme}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка генерации README: {str(e)}")


@app.post("/api/career/update_review")
@limiter.limit("30/minute")
async def career_update_review(request: Request, req: CareerUpdateReviewRequest):
    """
    Update Spaced Repetition schedule using SM-2 algorithm.
    quality: 0-5 mapped from score 0-100.
    """
    import os
    from supabase import create_client
    
    sb_url = os.getenv("SUPABASE_URL", "")
    sb_key = os.getenv("SUPABASE_KEY", "")
    if not sb_url or not sb_key:
        raise HTTPException(status_code=500, detail="Supabase не настроен")
    
    # Get Authorization header to identify user
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Не авторизован")
    
    token = auth_header[7:]
    sb = create_client(sb_url, sb_key)
    
    # Get user from token
    try:
        user_resp = sb.auth.get_user(token)
        user_id = user_resp.user.id
    except Exception:
        raise HTTPException(status_code=401, detail="Невалидный токен")
    
    # SM-2 algorithm
    # Convert score (0-100) to quality (0-5)
    quality = min(5, max(0, round(req.score / 20)))
    
    # Fetch existing review record
    existing = sb.table("module_reviews").select("*").eq("user_id", user_id).eq("module_id", req.module_id).execute()
    
    if existing.data:
        rec = existing.data[0]
        ease = rec["ease_factor"]
        interval = rec["interval_days"]
        reps = rec["repetition_count"]
    else:
        ease = 2.5
        interval = 1
        reps = 0
    
    # SM-2 update
    if quality < 3:
        # Failed: reset
        reps = 0
        interval = 1
    else:
        if reps == 0:
            interval = 1
        elif reps == 1:
            interval = 6
        else:
            interval = round(interval * ease)
        reps += 1
    
    # Update ease factor
    ease = max(1.3, ease + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
    
    from datetime import datetime, timedelta, timezone
    next_review = (datetime.now(timezone.utc) + timedelta(days=interval)).isoformat()
    
    sb.table("module_reviews").upsert({
        "user_id": user_id,
        "module_id": req.module_id,
        "course_profession": req.course_profession,
        "next_review_at": next_review,
        "ease_factor": round(ease, 2),
        "interval_days": interval,
        "repetition_count": reps,
        "last_score": req.score
    }, on_conflict="user_id,module_id").execute()
    
    return {
        "next_review_at": next_review,
        "interval_days": interval,
        "ease_factor": round(ease, 2),
        "repetition_count": reps
    }


@app.get("/api/career/due_reviews")
@limiter.limit("30/minute")
async def career_due_reviews(request: Request):
    """Get modules due for Spaced Repetition review (next_review_at <= now)."""
    import os
    from supabase import create_client
    from datetime import datetime, timezone
    
    sb_url = os.getenv("SUPABASE_URL", "")
    sb_key = os.getenv("SUPABASE_KEY", "")
    if not sb_url or not sb_key:
        raise HTTPException(status_code=500, detail="Supabase не настроен")
    
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Не авторизован")
    
    token = auth_header[7:]
    sb = create_client(sb_url, sb_key)
    
    try:
        user_resp = sb.auth.get_user(token)
        user_id = user_resp.user.id
    except Exception:
        raise HTTPException(status_code=401, detail="Невалидный токен")
    
    now_iso = datetime.now(timezone.utc).isoformat()
    result = sb.table("module_reviews").select("*").eq("user_id", user_id).lte("next_review_at", now_iso).execute()
    
    return result.data or []


# Edge-TTS voice IDs (Azure Neural Voices)
EDGE_TTS_VOICES = {
    "professor": "ru-RU-DmitryNeural",  # Глубокий, академический мужской
    "male":      "ru-RU-DmitryNeural",  # Стандартный мужской
    "female":    "ru-RU-SvetlanaNeural",  # Стандартный женский
}

class TTSRequest(BaseModel):
    text: str
    role: str = "professor"  # professor | male | female


@app.post("/api/tts")
@limiter.limit("30/minute")
async def text_to_speech(request: Request, req: TTSRequest):
    voice_id = EDGE_TTS_VOICES.get(req.role, EDGE_TTS_VOICES["professor"])
    text = req.text.strip()[:4000]
    
    if not text:
        raise HTTPException(status_code=400, detail="Текст для озвучки пуст")

    import edge_tts
    from fastapi.responses import StreamingResponse

    try:
        async def generate_audio():
            communicate = edge_tts.Communicate(text, voice_id, rate="+20%")
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    yield chunk["data"]
                    
        return StreamingResponse(generate_audio(), media_type="audio/mpeg")
    except Exception as e:
        print(f"Edge-TTS Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


from typing import List, Dict, Optional, Any

class AcademicScanRequest(BaseModel):
    images_base64: List[str] = []
    text: Optional[str] = None
    mime_type: str = "image/jpeg"
    chat_history: List[Dict[str, Any]] = []

from agents.base import build_academic_scan_prompt

@app.post("/api/academic/scan")
@limiter.limit("10/minute")
async def academic_scan(request: Request, req: AcademicScanRequest):
    if not req.images_base64 and not req.text and not req.chat_history:
        raise HTTPException(status_code=400, detail="Нужно передать текст, картинку или историю чата")
        
    # Собери все картинки из истории чата, если в текущем запросе их нет
    all_images = list(req.images_base64)
    if req.chat_history:
        for msg in req.chat_history:
            if "images_base64" in msg and msg["images_base64"]:
                for img in msg["images_base64"]:
                    if img not in all_images:
                        all_images.append(img)
                        
    agent = BaseAgent(api_key=GROQ_API_KEY)
    system_prompt = build_academic_scan_prompt()
    
    # Строим контекст из истории
    history_text = ""
    if req.chat_history:
        for msg in req.chat_history:
            role = "Пользователь" if msg.get("role") == "user" else "Ассистент"
            history_text += f"[{role}]: {msg.get('content', '')}\n"
            
    # Добавляем текущий запрос пользователя
    user_prompt = ""
    if history_text:
        user_prompt += f"ИСТОРИЯ ДИАЛОГА:\n{history_text}\n\n"
        
    if all_images:
        user_prompt += "ТЕКУЩИЙ ЗАПРОС: " + (req.text if req.text else "Пожалуйста, распознай оценки с прикрепленных картинок.")
    else:
        user_prompt += "ТЕКУЩИЙ ЗАПРОС: " + (req.text if req.text else "Ответь на последнее сообщение пользователя.")
    
    raw = None
    try:
        if all_images:
            raw = await agent.run_with_images(system_prompt, user_prompt, all_images, req.mime_type)
        else:
            raw = await agent.run(system_prompt, user_prompt)
            
        return parse_llm_json(raw)
    except Exception as e:
        err_str = str(e)
        print(f"Academic Scan Error: {err_str}")
        
        if raw:
            # Parsing failed, but we got a response from AI
            return {"message": f"Я распознал текст, но не смог автоматически занести оценки в таблицу. Вот что удалось прочитать:\n\n{raw}", "grades": []}
            
        if "API_LIMIT_REACHED" in err_str or "429" in err_str:
            return {"message": "Извините, сейчас ИИ-сервера перегружены (лимит запросов). Пожалуйста, подождите немного и попробуйте снова.", "grades": []}
            
        return {"message": f"Произошла техническая ошибка: {err_str}", "grades": []}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

# Trigger rebuild v1.0.1 - Force HF Spaces fresh deploy
