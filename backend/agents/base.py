from groq import AsyncGroq


def build_summarizer_prompt(detail: str = "medium") -> str:
    detail_map = {
        "brief": "краткий конспект: заголовок + 3-5 ключевых тезисов + 1 абзац выводов",
        "medium": "средний конспект: заголовок + ключевые тезисы + основное содержание 3-4 абзаца + термины + выводы",
        "detailed": "подробный конспект: заголовок + ключевые тезисы + развёрнутое содержание 5-6 абзацев + все термины и определения + выводы + рекомендации по изучению",
    }
    body = detail_map.get(detail, detail_map["medium"])
    return f"""Ты — опытный преподаватель, который создаёт структурированные конспекты лекций.
Проанализируй предоставленный текст и создай {body}.

ОБЯЗАТЕЛЬНАЯ структура ответа (используй эти заголовки):
## 📌 Тема
(одна строка — главная тема материала)

## 🔑 Ключевые тезисы
(нумерованный список 3-7 пунктов, каждый — 1 предложение)

## 📖 Основное содержание
(2-5 абзацев с главными идеями, каждый абзац начинается с жирного подзаголовка)

## 📚 Термины и определения
(нумерованный список: **термин** — определение)

## 💡 Выводы
(2-3 предложения, подводящие итог)

Форматируй строго в Markdown с заголовками уровня ##. Пиши на языке исходного текста."""


def build_flashcards_prompt(count: int = 6) -> str:
    return f"""Ты — эксперт по созданию обучающих карточек.
На основе предоставленного текста создай ровно {count} карточек «вопрос-ответ» для запоминания ключевых концепций.

Требования:
1. Каждая карточка: чёткий вопрос → развёрнутый ответ (2-4 предложения)
2. Покрывай ключевые концепции текста
3. Карточки разного уровня сложности: примерно треть лёгкие, треть средние, треть сложные
4. Формулируй вопросы так, чтобы ответ требовал понимания, а не простого копирования

Верни результат ТОЛЬКО в формате JSON (без markdown-обёрток):
{{"flashcards": [{{"id": 1, "question": "...", "answer": "..."}}]}}

Пиши на языке исходного текста."""


def build_quiz_prompt(count: int = 5, difficulty: str = "mixed", qtype: str = "multiple") -> str:
    diff_map = {
        "easy": "все вопросы лёгкого уровня (базовые факты)",
        "medium": "все вопросы среднего уровня (понимание и применение)",
        "hard": "все вопросы сложного уровня (анализ и синтез)",
        "mixed": f"вопросы разной сложности: примерно {max(1, count//3)} лёгких, {max(1, count//3)} средних, остальные сложные",
    }
    diff_text = diff_map.get(difficulty, diff_map["mixed"])

    if qtype == "truefalse":
        type_text = 'Каждый вопрос — утверждение, на которое нужно ответить «Верно» или «Неверно». Формат вариантов: ["A) Верно", "B) Неверно"]'
    else:
        type_text = "Каждый вопрос имеет 4 варианта ответа (A, B, C, D). Только один правильный. Варианты должны быть правдоподобными, без очевидно нелепых дистракторов."

    return f"""Ты — эксперт по созданию проверочных тестов.
На основе предоставленного текста создай тест из {count} вопросов.
{diff_text}. {type_text}

ВАЖНО: Верни ТОЛЬКО JSON-объект. Не добавляй никаких вступительных или заключительных слов, пояснений или markdown-разметки (никаких ```json).

{{
  "quiz": [
    {{
      "id": 1,
      "question": "...",
      "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
      "correct": "A",
      "explanation": "..."
    }}
  ]
}}

Пиши на языке исходного текста."""

import os
import random
import asyncio
from groq import AsyncGroq
import google.generativeai as genai
from google.generativeai.types import SafetySettingDict, HarmCategory, HarmBlockThreshold

# ... (промпты без изменений)

class BaseAgent:
    def __init__(self, api_key: str, model: str = "llama-3.3-70b-versatile"):
        self.groq_api_key = api_key
        self.model = model
        
        # Читаем ключи
        raw_keys = os.getenv("GEMINI_API_KEY", "")
        self.gemini_keys = [k.strip() for k in raw_keys.split(",") if k.strip()]
        
        if self.groq_api_key:
            self.groq_client = AsyncGroq(api_key=self.groq_api_key)
        else:
            self.groq_client = None

        self.safety_settings: list[SafetySettingDict] = [
            {"category": HarmCategory.HARM_CATEGORY_HARASSMENT, "threshold": HarmBlockThreshold.BLOCK_NONE},
            {"category": HarmCategory.HARM_CATEGORY_HATE_SPEECH, "threshold": HarmBlockThreshold.BLOCK_NONE},
            {"category": HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, "threshold": HarmBlockThreshold.BLOCK_NONE},
            {"category": HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, "threshold": HarmBlockThreshold.BLOCK_NONE},
        ]

    async def run(self, system_prompt: str, user_text: str) -> str:
        max_chars = 300000 if self.gemini_keys else 80000
        truncated = user_text[:max_chars]
        if len(user_text) > max_chars:
            truncated += f"\n\n[Текст сокращён с {len(user_text)} до {max_chars} символов]"

        gemini_errors = []

        if self.gemini_keys:
            # Пробуем ключи по очереди
            shuffled_keys = list(self.gemini_keys)
            random.shuffle(shuffled_keys)
            
            for key in shuffled_keys:
                try:
                    # Настраиваем библиотеку под конкретный ключ
                    genai.configure(api_key=key)
                    
                    GEMINI_MODELS = [
                        "gemini-3.1-flash-lite",
                        "gemini-2.5-flash-preview-05-20",
                        "gemini-2.0-flash",
                        "gemini-1.5-flash",
                    ]
                    
                    model_loaded = None
                    model_error = None
                    for model_name in GEMINI_MODELS:
                        try:
                            model_loaded = genai.GenerativeModel(model_name)
                            break
                        except Exception as e:
                            model_error = str(e)
                            continue
                    
                    if not model_loaded:
                        gemini_errors.append(f"Не удалось загрузить ни одну Gemini модель: {model_error}")
                        continue  # переходим к следующему ключу
                    
                    full_prompt = f"{system_prompt}\n\nТЕКСТ ДЛЯ АНАЛИЗА:\n{truncated}"
                    
                    # Делаем запрос
                    response = await model_loaded.generate_content_async(
                        full_prompt,
                        generation_config=genai.types.GenerationConfig(
                            temperature=0.3,
                            max_output_tokens=8192,
                        ),
                        safety_settings=self.safety_settings
                    )
                    
                    if response and response.text:
                        return response.text
                    
                    gemini_errors.append(f"Key {key[:6]}... returned empty text")
                except Exception as e:
                    err_msg = str(e)
                    gemini_errors.append(f"Key {key[:6]}... error: {err_msg[:100]}")
                    continue

        # Если дошли сюда - Gemini не сработал. Пробуем Groq.
        if self.groq_client:
            try:
                response = await self.groq_client.chat.completions.create(
                    model=self.model,
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": truncated},
                    ],
                    temperature=0.3,
                    max_tokens=8192,
                )
                return response.choices[0].message.content or ""
            except Exception as e:
                groq_err = str(e)
                if "429" in groq_err:
                    debug_info = "\n".join(gemini_errors) if gemini_errors else "Ключи Gemini не найдены"
                    return f"Ошибка: Лимиты ИИ исчерпаны.\n\nGemini ошибки:\n{debug_info}\n\nGroq ошибка: 429."
                return f"Ошибка ИИ (Groq): {groq_err}"
        
        return "Ошибка: API ключи не настроены."
