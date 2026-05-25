from .base import BaseAgent
import json
import asyncio

def build_career_prompt() -> str:
    return """Ты — карьерный консультант и IT-ментор.
Я предоставлю тебе список тем, терминов и кратких содержаний из материалов, которые изучал студент.
Твоя задача — проанализировать эти знания и составить карьерный профиль.

ОБЯЗАТЕЛЬНО верни ответ в формате JSON без markdown-обёртки (никаких ```json):
{
  "skills": ["Навык 1", "Навык 2"],
  "professions": [
    {"title": "Название профессии", "match": 85}
  ],
  "resume_summary": "Текст 'О себе' для резюме (2-3 абзаца, подчеркивающие знания).",
  "projects": [
    {"title": "Название проекта", "description": "Краткое описание"}
  ]
}

- skills: Выдели 5-10 конкретных хард-скиллов (технологии, концепции, фреймворки, методы), которые следуют из материалов.
- professions: Предложи 2-4 реальные профессии/позиции (например, Frontend Developer, Data Scientist, Менеджер проектов). Укажи процент совпадения (match) от 50 до 100 на основе глубины материалов.
- resume_summary: Напиши профессиональное саммари для CV, будто студент уже ищет стажировку/работу.
- projects: Предложи 2-3 идеи для пет-проектов, которые помогут применить эти знания на практике.
"""

class CareerAgent(BaseAgent):
    """
    Агент для генерации карьерного профиля на основе материалов.
    """
    
    async def process(self, context: str) -> dict:
        """
        context: Сборная строка всех тем и конспектов пользователя.
        """
        prompt = build_career_prompt()
        raw_result = await self.generate_content(prompt, context)
        
        # Парсинг JSON
        try:
            # Очистка от возможных markdown-оберток
            cleaned = raw_result.strip()
            if cleaned.startswith("```json"):
                cleaned = cleaned[7:]
            if cleaned.startswith("```"):
                cleaned = cleaned[3:]
            if cleaned.endswith("```"):
                cleaned = cleaned[:-3]
            
            return json.loads(cleaned.strip())
        except Exception as e:
            # Fallback in case of failure
            return {
                "skills": ["Анализ данных", "Обучаемость"],
                "professions": [{"title": "Студент-исследователь", "match": 100}],
                "resume_summary": "Активно изучаю новые материалы и стремлюсь к профессиональному развитию.",
                "projects": [{"title": "Продолжить обучение", "description": "Изучить больше материалов для точного анализа."}],
                "error": f"JSON Parse Error: {str(e)}"
            }
