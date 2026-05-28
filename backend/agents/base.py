from groq import AsyncGroq
import os
import random
import asyncio
import google.generativeai as genai
from google.generativeai.types import SafetySettingDict, HarmCategory, HarmBlockThreshold
from fastapi import HTTPException

def build_summarizer_prompt(detail: str = "medium") -> str:
    detail_map = {
        "brief": "краткий конспект: заголовок + 3-5 ключевых тезисов + 1 абзац выводов",
        "medium": "средний конспект: заголовок + ключевые тезисы + основное содержание 3-4 абзаца + термины + выводы",
        "detailed": "подробный конспект: заголовок + ключевые тезисы + развёрнутое содержание 5-6 абзацев + все термины и определения + выводы + рекомендации по изучению",
    }
    body = detail_map.get(detail, detail_map["medium"])
    return f"""Ты — опытный преподаватель, который создаёт структурированные конспекты лекций.
Проанализируй предоставленный текст и создай {body}.

ОБЯЗАТЕЛЬНО верни ответ в формате JSON без markdown-обёртки (никаких ```json):
{{
  "subject": "Краткое название предмета (одно слово, например: Физика, Информатика, История)",
  "content": "Твой полный конспект в формате Markdown (с использованием ## заголовков, жирного шрифта, списков и т.д.)",
  "terms": [
    {{"term": "Слово или концепция", "definition": "Его точное определение"}}
  ]
}}

Пиши на языке исходного текста."""


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


def build_cheatsheet_prompt() -> str:
    return """Ты — мастер визуального конспектирования и создания шпаргалок.
Твоя задача — проанализировать предоставленный текст лекции и превратить его в ультра-короткую, сверх-эффективную шпаргалку на 1 страницу для быстрого повторения за 5 минут до экзамена.

Требования:
1. Выдели ТОЛЬКО самое главное: ключевые формулы, критически важные даты, фундаментальные термины и законы. Никакой "воды", рассуждений или длинных абзацев.
2. Используй мнемонические приемы (например: "Как запомнить формулу...", ассоциативные правила, запоминалки).
3. Добавь блок "3 частые ловушки на экзамене" (ошибки, на которых обычно ловят преподаватели).
4. Оформляй строго в Markdown с использованием жирного шрифта, коротких списков и блоков цитат для формул.

ОБЯЗАТЕЛЬНАЯ структура:
# ⚡ Экспресс-шпаргалка
## 🔑 Суть в 3 словах
(Крайне емкое резюме темы)

## 📌 Фундаментальные понятия & Формулы
(Список критических определений или формул с расшифровкой)

## 💡 Мнемоника (Лайфхаки запоминания)
(2-3 совета, как легко запомнить сложные части темы)

## ⚠️ Экзаменационные ловушки
(3 самые частые ошибки или хитрых вопроса преподавателей)

Пиши на языке исходного текста."""


def build_podcast_prompt() -> str:
    return """Ты — сценарист популярных образовательных подкастов.
Твоя задача — превратить сухой текст лекции в живой, веселый и увлекательный разговорный скрипт диалога двух ведущих: Макса (любопытный ведущий, задает простые вопросы) и Софьи (умный эксперт, объясняет на пальцах с юмором и понятными примерами).

Требования:
1. Скрипт должен состоять из реплик Макса и Софьи.
2. Разговорный, дружелюбный стиль, аналогии из реальной жизни.
3. Сложные темы переводятся на уровень метафор (например: "процессор — это шеф-повар на кухне...").
4. Длина: 8-12 реплик на каждого спикера (около 2-3 минут аудио).

ОБЯЗАТЕЛЬНО верни ответ в формате JSON без markdown-обёртки (никаких ```json):
{{
  "podcast": [
    {{"speaker": "Макс", "text": "..."}},
    {{"speaker": "Софья", "text": "..."}}
  ]
}}

Пиши на языке исходного текста."""


def build_missions_prompt() -> str:
    return """Ты — гейм-дизайнер образовательных систем (EdTech). 
Твоя задача — проанализировать предоставленный текст лекции и превратить его в увлекательную игру из 3 последовательных микро-миссий (квестов).

Каждая миссия должна содержать:
1. Яркое название.
2. Фрагмент теории, объясненный "для 5-классника" с юмором и аналогиями (до 150 слов).
3. Проверочный вопрос с 3 вариантами ответа (A, B, C).
4. Правильный ответ (A, B или C).
5. Короткая подсказка.

ОБЯЗАТЕЛЬНО верни результат в формате JSON без markdown-обёртки (никаких ```json):
{
  "missions": [
    {
      "id": 1,
      "title": "Миссия 1: [Название]",
      "explanation": "[Простое объяснение части лекции с аналогией]",
      "question": "[Простой вопрос на понимание сути]",
      "options": ["A) ...", "B) ...", "C) ..."],
      "correct": "A",
      "hint": "[Подсказка]"
    }
  ]
}

Пиши на языке исходного текста."""


def build_quick_prep_prompt() -> str:
    return """Ты — экстренный помощник студента, у которого осталось ровно 5 минут до пары или экзамена.
Твоя задача — проанализировать лекцию и создать ультра-компактный материал для мгновенного освежения памяти.

ОБЯЗАТЕЛЬНО верни ответ ТОЛЬКО в формате JSON без markdown-обёрток (никаких ```json):
{
  "key_points": [
    "Самый важный тезис №1 — сжато, но содержательно",
    "Самый важный тезис №2",
    "Самый важный тезис №3"
  ],
  "cheatsheet": "Ультра-краткая шпаргалка в markdown: только термины, формулы, ключевые связи. Максимум 150 слов. Используй **жирный** для ключевых слов.",
  "questions": [
    {
      "question": "Разогревочный вопрос №1 — простой, на ключевое понятие",
      "answer": "Чёткий и конкретный ответ в 1-2 предложения"
    },
    {
      "question": "Разогревочный вопрос №2 — чуть глубже, на понимание связи",
      "answer": "Чёткий ответ в 1-2 предложения"
    }
  ]
}

Пиши на языке исходного текста."""


def build_professor_question_prompt(context: str, history_text: str = "") -> str:
    return f"""Ты — строгий, но справедливый профессор университета. 
Твоя цель — провести устный экзамен со студентом по предоставленному ниже учебному материалу.

МАТЕРИАЛ ЛЕКЦИИ:
{context[:25000]}

ИСТОРИЯ ПРЕДЫДУЩИХ ВОПРОСОВ И ОТВЕТОВ:
{history_text}

ИНСТРУКЦИЯ:
1. Изучи лекционный материал.
2. Посмотри на историю беседы (если она есть), чтобы не повторяться.
3. Сформулируй ОДИН глубокий, интересный открытый вопрос по материалу. Вопрос должен проверять понимание сути, причинно-следственных связей или формул, а не просто требовать зазубренного определения.
4. Отвечай строго в роли профессора. Обращайся к студенту уважительно, но академично.
5. Не пиши никаких вступлений, приветствий (если это не самый первый вопрос) или лишнего текста. Только сам вопрос от лица профессора.

Пиши на языке исходного текста."""


def build_professor_evaluation_prompt(context: str, question: str, student_answer: str) -> str:
    return f"""Ты — авторитетный профессор университета. Твоя задача — объективно оценить устный ответ студента на экзаменационный вопрос.
Ты должен сопоставить ответ студента с реальным содержанием лекции.

МАТЕРИАЛ ЛЕКЦИИ:
{context[:25000]}

ЭКЗАМЕНАЦИОННЫЙ ВОПРОС:
{question}

ОТВЕТ СТУДЕНТА:
{student_answer}

ИНСТРУКЦИЯ ПО ОЦЕНКЕ:
Проанализируй ответ студента по следующим критериям:
1. Какие факты, термины или логические цепочки студент назвал абсолютно верно (в соответствии с лекцией)?
2. Допустил ли студент прямые ошибки, неточности или ложные утверждения?
3. Какие критически важные аспекты или детали из лекции, напрямую относящиеся к вопросу, студент вообще забыл упомянуть (упущенные ключевые моменты)?
4. Поставь честную академическую оценку:
   - 5 (Отлично) — глубокое понимание, все важные моменты упомянуты, ошибок нет.
   - 4 (Хорошо) — твердое понимание, но упущены мелкие детали или есть незначительная неточность.
   - 3 (Удовлетворительно) — базовое представление, но ответ поверхностный, много упущено или есть заметные ошибки.
   - 2 (Неудовлетворительно) — студент не понимает тему, говорит не о том, или допустил грубые ошибки.

ОБЯЗАТЕЛЬНО верни ответ строго в формате JSON без каких-либо markdown-обёрток (никаких ```json):
{{
  "score": 0-100,
  "grade": "5", "4", "3" или "2",
  "verdict": "Развернутый вердикт профессора (обращение к студенту с объяснением оценки, 3-4 предложения)",
  "correct_points": ["Список верных утверждений и фактов, сказанных студентом"],
  "errors": ["Список конкретных ошибок или ложных суждений в ответе студента"],
  "missing_points": ["Список важных фактов из лекции, которые студент забыл рассказать для идеального ответа"]
}}

Пиши на языке исходного текста."""


def build_mistakes_practice_prompt(mistakes: list) -> str:
    mistakes_text = ""
    for i, m in enumerate(mistakes):
        mistakes_text += f"\nОшибка №{i+1}:\n- Вопрос: {m.get('question', '')}\n- Ответ студента: {m.get('student_answer', '')}\n- Правильный ответ: {m.get('correct_answer', '')}\n- Тема: {m.get('topic', '')}\n"
        
    return f"""Ты — эксперт по педагогике и созданию адаптивных тестов.
Твоя задача — проанализировать список ошибок, которые студент совершил на устном экзамене, и создать персональный проверочный тест «Работа над ошибками» из ровно 3 вопросов.

ОШИБКИ СТУДЕНТА:
{mistakes_text}

ТРЕБОВАНИЯ К ТЕСТУ:
1. Создай ровно 3 вопроса с выбором ответа (4 варианта: A, B, C, D) на русском языке.
2. Вопросы должны проверять понимание тех понятий, в которых студент ошибся, но НЕ должны полностью копировать исходные вопросы. Сделай их чуть другими или перефразируй, чтобы проверить реальное понимание, а не просто заучивание.
3. Варианты ответов должны быть правдоподобными.
4. Добавь подробное объяснение (explanation) для каждого вопроса. В объяснении обязательно укажи, в чем состояло прошлое заблуждение студента (ссылаясь на его неверный ответ) и почему правильный вариант действительно верен.

ОБЯЗАТЕЛЬНО верни результат в формате JSON без каких-либо markdown-обёрток (никаких ```json):
{{
  "practice": [
    {{
      "id": 1,
      "mistake_id": "[id исходной ошибки, если можно сопоставить, или пусто]",
      "question": "[Новый вопрос на проверку концепции]",
      "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
      "correct": "[Правильная буква: A, B, C или D]",
      "explanation": "[Подробное объяснение с разбором прошлой ошибки]"
    }}
  ]
}}

Пиши на русском языке."""


def build_academic_scan_prompt() -> str:
    return """Ты — дружелюбный и умный ИИ-ассистент (Smart Gradebook), который помогает распознавать школьные/университетские оценки по фото.
Пользователь передаёт тебе сообщения (описывающие контекст, например "Я Иванов Иван" или "Это оценки по математике"), а также фотографии электронного дневника или зачётки.
Твоя задача — внимательно изучить историю сообщений, чтобы понять, чьи оценки искать и по какому предмету, а затем извлечь нужные оценки из картинки или текста.

КРИТИЧЕСКИ ВАЖНЫЕ ПРАВИЛА:
1. Изоляция ученика: Если на фото представлен общий классный журнал с множеством фамилий, ищи ТОЛЬКО строку пользователя, чье имя/фамилия указаны в запросе (например, "Лабынцев Денис"). Извлекай оценки ИСКЛЮЧИТЕЛЬНО из его строки! Категорически запрещено собирать оценки других учеников. Обрати внимание, что фото может быть перевернуто или снято под углом. Мысленно проведи ровную линию от фамилии до конца таблицы и собирай оценки строго по этой линии, не сбиваясь на соседние строки сверху или снизу! Лучше найти меньше оценок, чем прихватить чужие.
2. Неизвестный предмет: Если в истории сообщений и на фото НЕ указано название предмета, НЕ выдумывай его (не пиши "Классный журнал", "Неизвестно" и т.д.). В этом случае верни пустой массив `grades` `[]` и в поле `message` задай уточняющий вопрос: "Привет! Я нашел твои оценки, но забыл спросить: по какому они предмету?".
3. Отчетность: В поле `message` обязательно перечисли ВСЕ найденные оценки через запятую (например: "Привет! Я нашел 7 оценок по Технике коммуникаций: 9, 9, 8, 9, 9, 7, 9. Добавил их в твой дневник!").

Правила конвертации и фильтрации:
- Если оценка текстовая ("Отлично", "Зачет"), преобразуй её в числовую исходя из контекста (Отлично = 5). 
- Игнорируй пропуски ("н", "Н", "у", "б"). Если стоит "7/н", извлекай только 7. 
- Если стоит несколько оценок ("5 4", "5/4"), извлеки как отдельные записи.
- Беларусь (10-балльная система): Если видишь оценки от 6 до 10, извлекай их как есть, не конвертируй в 5-балльную.
- Оценки от руки: будь внимателен к нечетким цифрам карандашом/ручкой. Зачеркнутые: бери только финальную (исправленную).
- Не путай даты (12.05) с оценками. Точки (".") — это не оценки.

ОБЯЗАТЕЛЬНО верни ТОЛЬКО JSON:
{
  "message": "Привет! Я нашел 3 оценки по Физике: 5.0, 4.0, 5.0. Добавил их!",
  "grades": [
    {
      "subject": "Название предмета",
      "value": 5.0,
      "date": "2024-05-28" 
    }
  ]
}
Пиши на русском языке, без markdown."""

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
            truncated += f"\n\n[Текст сокращен с {len(user_text)} до {max_chars} символов]"

        gemini_errors = []
        json_mode = "JSON" in system_prompt or "json" in system_prompt

        if self.gemini_keys:
            shuffled_keys = list(self.gemini_keys)
            import random
            random.shuffle(shuffled_keys)
            
            for key in shuffled_keys:
                try:
                    genai.configure(api_key=key)
                    GEMINI_MODELS = [
                        "gemini-3.1-flash-lite",
                        "gemini-3-flash-preview",
                        "gemini-3.1-pro-preview",
                        "gemini-2.5-flash",
                        "gemini-2.0-flash",
                        "gemini-1.5-flash",
                    ]
                    
                    response_text = None
                    last_err = None
                    
                    for model_name in GEMINI_MODELS:
                        try:
                            model_loaded = genai.GenerativeModel(model_name)
                            full_prompt = f"{system_prompt}\n\nЗАПРОС:\n{truncated}"
                            response = await model_loaded.generate_content_async(
                                full_prompt,
                                generation_config=genai.types.GenerationConfig(
                                    temperature=0.3,
                                    max_output_tokens=8192,
                                    response_mime_type="application/json" if json_mode else "text/plain"
                                ),
                                safety_settings=self.safety_settings
                            )
                            if response and response.text:
                                response_text = response.text
                                break
                        except Exception as e:
                            last_err = str(e)
                            continue
                            
                    if response_text:
                        return response_text
                        
                    gemini_errors.append(f"Key {key[:6]}... error: {last_err[:100] if last_err else 'No text'}")
                    continue
                except Exception as e:
                    gemini_errors.append(f"Key {key[:6]}... fatal error: {str(e)[:100]}")
                    continue

        if self.groq_client:
            try:
                kwargs = {
                    "model": self.model,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": truncated},
                    ],
                    "temperature": 0.3,
                    "max_tokens": 8192,
                }
                if json_mode:
                    kwargs["response_format"] = {"type": "json_object"}
                    
                response = await self.groq_client.chat.completions.create(**kwargs)
                return response.choices[0].message.content or ""
            except Exception as e:
                groq_err = str(e)
                if "429" in groq_err:
                    debug_info = "\n".join(gemini_errors) if gemini_errors else "Ключи Gemini не найдены"
                    raise HTTPException(status_code=429, detail="API_LIMIT_REACHED")
                raise HTTPException(status_code=500, detail=f"Ошибка ИИ (Groq): {groq_err}")
        
        raise HTTPException(status_code=500, detail="Ошибка: API ключи не настроены.")

    async def run_with_images(self, system_prompt: str, user_text: str, images_base64: list[str], mime_type: str = "image/jpeg") -> str:
        gemini_errors = []
        json_mode = "JSON" in system_prompt or "json" in system_prompt

        if self.gemini_keys:
            shuffled_keys = list(self.gemini_keys)
            import random
            random.shuffle(shuffled_keys)
            
            for key in shuffled_keys:
                try:
                    genai.configure(api_key=key)
                    GEMINI_MODELS = [
                        "gemini-3.1-flash-lite",
                        "gemini-3.0-flash-lite",
                        "gemini-2.5-flash",
                        "gemini-2.0-flash-lite-preview-02-05",
                        "gemini-1.5-flash",
                    ]
                    
                    response_text = None
                    last_err = None
                    
                    for model_name in GEMINI_MODELS:
                        try:
                            model_loaded = genai.GenerativeModel(model_name)
                            full_prompt = f"{system_prompt}\n\nЗАПРОС:\n{user_text}"
                            image_parts = [{"mime_type": mime_type, "data": img} for img in images_base64]
                            response = await model_loaded.generate_content_async(
                                [full_prompt] + image_parts,
                                generation_config=genai.types.GenerationConfig(
                                    temperature=0.3,
                                    max_output_tokens=8192,
                                    response_mime_type="application/json" if json_mode else "text/plain"
                                ),
                                safety_settings=self.safety_settings
                            )
                            if response and response.text:
                                response_text = response.text
                                break
                        except Exception as e:
                            last_err = str(e)
                            continue
                            
                    if response_text:
                        return response_text
                        
                    gemini_errors.append(f"Key {key[:6]}... error: {last_err[:100] if last_err else 'No text'}")
                    continue
                except Exception as e:
                    gemini_errors.append(f"Key {key[:6]}... fatal error: {str(e)[:100]}")
                    continue

        if self.groq_client:
            try:
                # Use llama-3.2-90b-vision-preview
                kwargs = {
                    "model": "llama-3.2-90b-vision-preview",
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": [
                            {"type": "text", "text": user_text}
                        ] + [{"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{img}"}} for img in images_base64]},
                    ],
                    "temperature": 0.3,
                    "max_tokens": 8192,
                }
                if json_mode:
                    kwargs["response_format"] = {"type": "json_object"}
                    
                response = await self.groq_client.chat.completions.create(**kwargs)
                return response.choices[0].message.content or ""
            except Exception as e:
                groq_err = str(e)
                if "429" in groq_err:
                    raise HTTPException(status_code=429, detail="API_LIMIT_REACHED")
                raise HTTPException(status_code=500, detail=f"Ошибка ИИ (Groq Vision): {groq_err}")
        
        raise HTTPException(status_code=500, detail="Ошибка: API ключи не настроены.")
