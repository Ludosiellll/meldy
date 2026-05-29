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
            
    if not youtube_url and not file:
         raise HTTPException(
                status_code=400,
                detail="Укажите youtube_url или загрузите файл.",
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
