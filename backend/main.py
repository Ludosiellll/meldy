import asyncio
import json
import os
from typing import AsyncGenerator, List

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from parser import extract_text
from agents.coordinator import CoordinatorAgent

app = FastAPI(title="AI Student Assistant", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # HF Spaces uses same origin via nginx
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
async def analyze(
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


from agents.base import BaseAgent

@app.post("/api/chat")
async def chat(req: ChatRequest):
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
async def plan(req: PlanRequest):
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

    system_prompt = f"""Ты — опытный учебный планировщик.
Сегодняшняя дата: {today}
Доступно часов для учебы в день: {req.available_hours_per_day}

Предметы и даты экзаменов:
{subjects_text}{materials_section}{goals_section}

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
        json_str = raw.strip()
        if "```json" in json_str:
            json_str = json_str.split("```json")[1].split("```")[0]
        elif "```" in json_str:
            json_str = json_str.split("```")[1].split("```")[0]
        
        # Находим JSON если вокруг есть текст
        if not (json_str.startswith('{') or json_str.startswith('[')):
            start = json_str.find('{')
            end = json_str.rfind('}')
            if start != -1 and end != -1:
                json_str = json_str[start:end+1]
                
        return json.loads(json_str.strip())
    except:
        return {"plan": []}


class ProfessorQuestionRequest(BaseModel):
    context: str
    history_text: str = ""
    mood: dict = None


class ProfessorEvaluateRequest(BaseModel):
    context: str
    question: str
    student_answer: str


class MissionsGenerateRequest(BaseModel):
    context: str


from agents.base import build_professor_question_prompt, build_professor_evaluation_prompt, build_missions_prompt

@app.post("/api/professor/question")
async def professor_question(req: ProfessorQuestionRequest):
    agent = BaseAgent(api_key=GROQ_API_KEY)
    
    mood_instr = ""
    if req.mood:
        if req.mood['energy_level'] <= 2 or req.mood['mood'] == 'stressed':
            mood_instr = "Студент сегодня не в лучшей форме (устал или в стрессе). Задавай вопросы попроще, будь более снисходительным профессором, давай наводки."
        elif req.mood['energy_level'] >= 4:
            mood_instr = "Студент сегодня в отличной форме и полон энергии. Задавай действительно глубокие, сложные и проверяющие на прочность вопросы. Будь строгим профессором."

    system_prompt = build_professor_question_prompt(req.context, req.history_text)
    if mood_instr:
        system_prompt += f"\n\nКОНТЕКСТ СОСТОЯНИЯ СТУДЕНТА: {mood_instr}"
        
    question = await agent.run(system_prompt, "Задай следующий вопрос для экзамена.")
    return {"question": question.strip()}


@app.post("/api/professor/evaluate")
async def professor_evaluate(req: ProfessorEvaluateRequest):
    agent = BaseAgent(api_key=GROQ_API_KEY)
    system_prompt = build_professor_evaluation_prompt(req.context, req.question, req.student_answer)
    raw = await agent.run(system_prompt, "Оцени мой ответ.")
    
    try:
        json_str = raw.strip()
        if "```json" in json_str:
            json_str = json_str.split("```json")[1].split("```")[0]
        elif "```" in json_str:
            json_str = json_str.split("```")[1].split("```")[0]
        
        if not (json_str.startswith('{') or json_str.startswith('[')):
            start = json_str.find('{')
            end = json_str.rfind('}')
            if start != -1 and end != -1:
                json_str = json_str[start:end+1]
                
        return json.loads(json_str.strip())
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
async def generate_missions(req: MissionsGenerateRequest):
    agent = BaseAgent(api_key=GROQ_API_KEY)
    system_prompt = build_missions_prompt()
    raw = await agent.run(system_prompt, req.context)
    
    try:
        json_str = raw.strip()
        if "```json" in json_str:
            json_str = json_str.split("```json")[1].split("```")[0]
        elif "```" in json_str:
            json_str = json_str.split("```")[1].split("```")[0]
        
        if not (json_str.startswith('{') or json_str.startswith('[')):
            start = json_str.find('{')
            end = json_str.rfind('}')
            if start != -1 and end != -1:
                json_str = json_str[start:end+1]
                
        return json.loads(json_str.strip())
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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
