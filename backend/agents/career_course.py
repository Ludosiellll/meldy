from .base import BaseAgent
import json


def get_expert_persona(profession: str) -> dict:
    prof_lower = profession.lower()
    if any(k in prof_lower for k in ["разработчик", "developer", "программист", "frontend", "backend", "fullstack", "devops", "qa", "тестировщик", "engineer", "инженер"]):
        return {
            "title": "Элитный Технический Архитектор & Principal Engineer",
            "tone": "Глубокий технический разбор, архитектурный подход, чистота кода, масштабируемость систем и алгоритмическая эффективность O(N).",
            "radar_axes": ["Algorithms", "System Design", "Code Quality", "DevOps", "SQL/Data", "Soft Skills"]
        }
    elif any(k in prof_lower for k in ["аналитик", "analyst", "sql", "data", "дата", "scientist", "аналитика"]):
        return {
            "title": "Principal DBA & Ведущий Дата-Сайентист",
            "tone": "Фокус на оптимизацию запросов, правильность выборок, работу с индексами, статистическую достоверность и data-driven выводы.",
            "radar_axes": ["SQL/Queries", "Statistics", "Python/R", "Visualization", "Business Logic", "Soft Skills"]
        }
    elif any(k in prof_lower for k in ["дизайнер", "designer", "ui", "ux", "верстка", "figma", "графика"]):
        return {
            "title": "Креативный Директор & Шеф UI/UX лаборатории",
            "tone": "Внимание к пиксельной точности, сеткам, контрастности, типографике, пользовательским паттернам (F-pattern, Z-pattern) и эргономике.",
            "radar_axes": ["Visual Design", "UX Research", "Prototyping", "Typography", "Accessibility", "Soft Skills"]
        }
    elif any(k in prof_lower for k in ["менеджер", "manager", "pm", "product", "project", "продукт", "проект", "scrum", "agile"]):
        return {
            "title": "VP of Product & Agile Coach крупного финтех-гиганта",
            "tone": "Ориентация на бизнес-метрики (ROI, LTV, CAC), приоритезацию по RICE/ICE, управление рисками, юнит-экономику и стратегическое планирование.",
            "radar_axes": ["Strategy", "Metrics/Analytics", "Team Leadership", "Agile/Scrum", "Stakeholders", "Soft Skills"]
        }
    elif any(k in prof_lower for k in ["маркетолог", "marketing", "маркетинг", "smm", "seo", "контент", "content", "реклама", "ads", "копирайт"]):
        return {
            "title": "Chief Marketing Officer & Growth Hacking Expert",
            "tone": "Фокус на конверсию, воронки, A/B тестирование, ROI рекламных кампаний, сегментацию аудитории и контент-стратегию.",
            "radar_axes": ["Content Strategy", "SEO/SEM", "Analytics", "Copywriting", "Paid Ads", "Soft Skills"]
        }
    elif any(k in prof_lower for k in ["финанс", "бухгалт", "accountant", "finance", "economist", "экономист"]):
        return {
            "title": "CFO & Финансовый директор с 15-летним опытом в FMCG",
            "tone": "Точность в расчётах, понимание P&L, Cash Flow, EBITDA. Работа с отчётностью, налоговым планированием и финансовым моделированием.",
            "radar_axes": ["Financial Modeling", "Accounting", "Tax Law", "Excel/BI", "Reporting", "Soft Skills"]
        }
    else:
        return {
            "title": "Элитный Карьерный Коуч & Эксперт-Практик в своей области",
            "tone": "Глубокое понимание рынка труда, профессиональных стандартов, переговорных навыков и построения карьерной траектории.",
            "radar_axes": ["Core Skills", "Industry Knowledge", "Communication", "Problem Solving", "Leadership", "Soft Skills"]
        }


def build_course_designer_prompt(
    profession: str,
    level: str,
    salary: str,
    user_materials: str,
    vacancy_context: str,
    age: int = None,
    gender: str = "",
    location: str = "",
    extra_context: str = ""
) -> str:
    expert = get_expert_persona(profession)

    demographics_block = ""
    if age or gender or location or extra_context:
        demographics_block = f"""
УЧИТЫВАЙ ПЕРСОНАЛЬНЫЙ ПРОФИЛЬ СТУДЕНТА ПРИ ПРОЕКТИРОВАНИИ:
- Возраст: {age if age else 'Не указан'}
- Пол: {gender if gender else 'Не указан'}
- Локация (город/страна): {location if location else 'Не указана'}
- Особые жизненные обстоятельства/условия: {extra_context if extra_context else 'Не указаны'}

ИНСТРУКЦИЯ ПО АДАПТАЦИИ:
1. Если студент — подросток/студент: давай более простые и яркие жизненные метафоры, фокусируйся на стажировках и бесплатном опенсорсе.
2. Если студент — взрослый свитчер (сменил профессию): делай упор на переносе его прошлого жизненного опыта, жёстком тайм-менеджменте и быстром выходе на фриланс или джуниор-позиции.
3. Если есть особые семейные/жизненные условия (например, молодая мама, совмещение с тяжёлой работой): оптимизируй нагрузку, планируй короткие 1-часовые учебные спринты.
4. Локация и валюта: строй карьерные инсайты строго под рынок указанного региона (Беларусь — BYN, Казахстан — ₸, Россия — ₽).
"""

    return f"""Ты — {expert['title']}.
Твой стиль преподавания и тон: {expert['tone']}

Твоя задача — спроектировать ультимативно глубокую, колоссальную по объёму и ценности учебную программу (курс) для студента, который хочет освоить профессию "{profession}" (уровень: {level}, целевая зарплата: {salary}).
Этот курс должен быть во много раз подробнее, глубже и практичнее, чем любые коммерческие курсы на рынке.
{demographics_block}
При проектировании курса опирайся на реальные требования рынка, собранные из свежих вакансий:
{vacancy_context}

Спроектируй от 10 до 14 крупных, последовательных и детализированных модулей.

Для каждого модуля ты ОБЯЗАН предоставить:
1. Зачем это нужно работодателям: конкретная привязка к реальным вакансиям.
2. Подробная теория темы: 2-3 больших, содержательных абзаца. Разбей на отдельные параграфы через символ "|||" — каждый параграф будет отображаться как отдельный блок с кнопкой «Не понял».
3. Лучшие отобранные ресурсы с ТОЧНЫМИ deep links (не главные страницы — конкретные статьи, задачи LeetCode, разделы MDN).
4. ТРЁХУРОВНЕВАЯ ПРАКТИКА (это ключевое):
   - Уровень Guided (с подсказками): та же задача но с пошаговыми подсказками-шагами для студентов которые только начинают
   - Уровень Independent (стандарт): полноценное задание без подсказок
   - Уровень Expert (челлендж): то же задание но с дополнительным ограничением (например, "реши за O(n)", "без использования встроенных методов", "добавь обработку ошибок")
5. Симуляция реального собеседования: конкретная компания + каверзные вопросы интервьюера.
6. Шаг сквозного проекта: какой конкретный компонент/файл/функцию студент добавляет в свой сквозной проект в рамках этого модуля.

КРИТИЧЕСКИЙ РЕЖИМ ТОЧНЫХ ССЫЛОК: Запрещено давать общие ссылки вроде 'https://leetcode.com'. Обязательно прямые рабочие URL на конкретные задачи LeetCode (например, 'https://leetcode.com/problems/two-sum/'), точные статьи MDN, разделы документации.

ОБЯЗАТЕЛЬНО верни строго JSON-структуру без markdown-оберток (НИКАКИХ ```json или ```):
{{
  "profession": "{profession}",
  "salary": "{salary}",
  "level": "{level}",
  "location": "{location}",
  "project_name": "Название сквозного проекта (например: 'Portfolio Website', 'Task Manager API', 'Analytics Dashboard')",
  "project_description": "Краткое описание сквозного проекта — что это будет на выходе курса",
  "insights": "Крайне подробный аналитический обзор рынка труда: тренды, требования, дефицитные скиллы.",
  "modules": [
    {{
      "id": "mod_1",
      "title": "Название первого модуля",
      "description": "Исчерпывающее описание содержания модуля.",
      "why_needed": "Привязка к вакансиям (например: 'В 87% вакансий уровня Middle требуется...').",
      "detailed_theory": "Параграф 1 с детальным разбором концепции. ||| Параграф 2 с примерами и паттернами. ||| Параграф 3 с архитектурными решениями и нюансами реализации.",
      "resources": [
        {{
          "title": "Название материала",
          "url": "https://конкретная-ссылка.com/точный-путь",
          "description": "Почему именно этот ресурс и как по нему заниматься."
        }}
      ],
      "practice_type": "algo | sql | web | business | design | copywriting | roleplay",
      "practice_task": {{
        "task_description": "Подробнейшее ТЗ для уровня Independent.",
        "origin_interview_questions": "Компания: [Яндекс/Тинькофф/Авито/Google]. Вопросы на реальном техническом интервью: 1) ... 2) ... 3) ... Каверзные follow-up вопросы интервьюера.",
        "code_template": "function solution() {{\\n  // напиши свой код здесь\\n}}",
        "test_cases": [
          {{ "input": "[2, 7, 11, 15]", "expected": "[0, 1]" }},
          {{ "input": "[3, 2, 4]", "expected": "[1, 2]" }},
          {{ "input": "[3, 3]", "expected": "[0, 1]" }}
        ],
        "non_code_options": ["Вариант А", "Вариант B"],
        "non_code_correct": "Ответ или ключ",
        "explanation": "Подробный разбор правильного решения."
      }},
      "practice_guided": {{
        "hints": [
          "Шаг 1: Сначала разберись с...",
          "Шаг 2: Используй конструкцию...",
          "Шаг 3: Проверь крайний случай когда..."
        ],
        "simplified_template": "// Guided version\\nfunction solution(input) {{\\n  // Шаг 1: ..\\n  // Шаг 2: ..\\n  return result;\\n}}"
      }},
      "practice_expert": {{
        "constraint": "Дополнительное ограничение которое делает задачу сложнее (например: 'Реши за O(n) без дополнительной памяти', 'Без использования .map()/.filter()', 'Добавь полную обработку ошибок и TypeScript типы')",
        "bonus_description": "Что студент докажет решив expert-версию — какой навык это демонстрирует на собеседовании."
      }},
      "project_thread_step": "Конкретное описание что студент добавляет в сквозной проект в этом модуле: файл/компонент/функцию/раздел."
    }}
  ]
}}

Ты ОБЯЗАН спроектировать полноценный учебный трек из 10-14 глубоких модулей. Описания должны быть колоссальными по объёму.
Конспекты пользователя для адаптивного усиления тем (если есть):
{user_materials[:10000]}
"""


def build_course_expansion_prompt(
    current_course: dict,
    additional_focus: str,
    extra_context: str = ""
) -> str:
    profession = current_course.get("profession", "IT-специалист")
    level = current_course.get("level", "Junior")
    existing_modules = current_course.get("modules", [])
    num_existing = len(existing_modules)
    project_name = current_course.get("project_name", "Сквозной проект")

    modules_summary = "\n".join([
        f"- ID: {m.get('id')} | Название: {m.get('title')} | Оценка студента: {m.get('score', 'не пройден')}/100"
        for m in existing_modules
    ])
    expert = get_expert_persona(profession)

    return f"""Ты — {expert['title']}.
Твой стиль преподавания и тон: {expert['tone']}

Студент только что успешно завершил базовый курс по профессии "{profession}" (уровень: {level}).
Сквозной проект курса: "{project_name}"

Пройденные модули:
{modules_summary}

Новый фокус/цель обучения: "{additional_focus}"
{f"Дополнительный контекст: {extra_context}" if extra_context else ""}

Спроектируй от 5 до 8 новых ПРОДВИНУТЫХ модулей, которые логически продолжают существующие.
Нумерация ID продолжается: первый новый модуль = "mod_{num_existing + 1}".

Каждый продвинутый модуль обязан содержать:
1. Привязку к сложным вакансиям Middle/Senior уровня.
2. Подробную теорию (2-3 параграфа, разделённых через |||).
3. Deep Links на продвинутые ресурсы (конкретные URL, не главные страницы).
4. Трёхуровневую практику: practice_task (Independent) + practice_guided + practice_expert.
5. Симуляцию реального собеседования в крупной компании с origin_interview_questions.
6. Шаг сквозного проекта: что добавляется в "{project_name}" в этом модуле.

ОБЯЗАТЕЛЬНО верни строго JSON без markdown-оберток (НИКАКИХ ```json или ```):
{{
  "modules": [
    {{
      "id": "mod_{num_existing + 1}",
      "title": "Название первого продвинутого модуля",
      "description": "Исчерпывающее описание продвинутого содержания.",
      "why_needed": "Привязка к сложным вакансиям Middle/Senior.",
      "detailed_theory": "Параграф 1 с продвинутыми концепциями. ||| Параграф 2 с архитектурными паттернами. ||| Параграф 3 с примерами из production-систем.",
      "resources": [
        {{
          "title": "Название продвинутого материала",
          "url": "https://конкретная-ссылка.com/точный-путь",
          "description": "Как по нему заниматься."
        }}
      ],
      "practice_type": "algo | sql | web | business | design | copywriting | roleplay",
      "practice_task": {{
        "task_description": "Продвинутое ТЗ без подсказок.",
        "origin_interview_questions": "Компания: [название]. Вопросы интервьюера: 1) ... 2) ... 3) ...",
        "code_template": "function solution() {{\\n  // напиши свой код здесь\\n}}",
        "test_cases": [{{ "input": "[...]", "expected": "..." }}],
        "non_code_options": ["..."],
        "non_code_correct": "...",
        "explanation": "Подробный разбор решения."
      }},
      "practice_guided": {{
        "hints": ["Шаг 1: ...", "Шаг 2: ...", "Шаг 3: ..."],
        "simplified_template": "// Guided version\\nfunction solution() {{\\n  // hints here\\n}}"
      }},
      "practice_expert": {{
        "constraint": "Дополнительное ограничение повышенной сложности.",
        "bonus_description": "Что демонстрирует решение expert-версии."
      }},
      "project_thread_step": "Что добавляется в {project_name} в этом модуле."
    }}
  ]
}}
"""


def build_review_test_prompt(module_title: str, module_theory: str, practice_type: str) -> str:
    return f"""Ты — строгий эксперт по созданию проверочных тестов для Spaced Repetition системы.

Студент изучал модуль: "{module_title}"
Тип практики: {practice_type}
Ключевые концепции из теории:
{module_theory[:3000]}

Твоя задача — создать ровно 3 вопроса для быстрой проверки через Spaced Repetition.
Вопросы должны проверять ПОНИМАНИЕ, а не механическое запоминание.
Сложность: средняя. Время на вопрос: 30-60 секунд.

ОБЯЗАТЕЛЬНО верни строго JSON без markdown-оберток:
{{
  "questions": [
    {{
      "id": 1,
      "question": "Чёткий вопрос на понимание концепции",
      "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
      "correct": "A",
      "explanation": "Почему именно этот ответ верен — объяснение для студента."
    }},
    {{
      "id": 2,
      "question": "Вопрос на применение знаний",
      "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
      "correct": "B",
      "explanation": "..."
    }},
    {{
      "id": 3,
      "question": "Вопрос на типичную ошибку или edge case",
      "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
      "correct": "C",
      "explanation": "..."
    }}
  ]
}}
"""


def build_retry_task_prompt(module_title: str, practice_type: str, original_task: str, weaknesses: list) -> str:
    weaknesses_str = "\n".join([f"- {w}" for w in weaknesses]) if weaknesses else "Не указаны"
    return f"""Ты — опытный педагог-методист.

Студент проходил практическое задание по модулю "{module_title}" (тип: {practice_type}) и не достиг порога мастерства (70 баллов).

Оригинальное задание:
{original_task[:2000]}

Слабые стороны студента по итогам ревью:
{weaknesses_str}

Твоя задача — создать АЛЬТЕРНАТИВНОЕ задание той же темы, но с другими данными и немного другим углом подхода. Задание должно:
1. Проверять те же концепции что и оригинал
2. Иметь другие входные данные / сценарий
3. Быть чуть легче там, где студент ошибся — но не тривиальным

ОБЯЗАТЕЛЬНО верни строго JSON без markdown-оберток:
{{
  "task_description": "Полное новое ТЗ для студента",
  "code_template": "function solution() {{\\n  // твой код здесь\\n}}",
  "test_cases": [
    {{ "input": "...", "expected": "..." }},
    {{ "input": "...", "expected": "..." }},
    {{ "input": "...", "expected": "..." }}
  ],
  "non_code_options": ["..."],
  "non_code_correct": "...",
  "explanation": "Объяснение правильного подхода с акцентом на слабые места студента.",
  "guided_hints": ["Шаг 1: ...", "Шаг 2: ...", "Шаг 3: ..."]
}}
"""


def build_module_hint_prompt(paragraph_text: str, profession: str) -> str:
    expert = get_expert_persona(profession)
    return f"""Ты — {expert['title']}. {expert['tone']}

Студент читает теорию по профессии "{profession}" и не понял следующий абзац:

---
{paragraph_text}
---

Объясни ЭТУ ЖЕ КОНЦЕПЦИЮ по-другому:
1. Используй другую аналогию из реальной жизни
2. Приведи конкретный пример из практики (реальный код, реальный сценарий)
3. Объясни простыми словами как будто студенту 16 лет, но без потери смысла
4. В конце — одно короткое резюме «Суть в одном предложении»

Отвечай напрямую, без вступлений вроде «Конечно!» или «Отличный вопрос!».
Длина ответа: 3-5 абзацев. Используй markdown для форматирования.
"""


class CareerCourseAgent(BaseAgent):

    async def generate_course(
        self,
        profession: str,
        level: str,
        salary: str,
        user_materials: str,
        vacancy_context: str,
        age: int = None,
        gender: str = "",
        location: str = "",
        extra_context: str = ""
    ) -> dict:
        prompt = build_course_designer_prompt(
            profession, level, salary, user_materials, vacancy_context,
            age, gender, location, extra_context
        )
        context = f"РЕАЛЬНЫЕ ТРЕБОВАНИЯ ИЗ ВАКАНСИЙ С РЫНКА ТРУДА:\n{vacancy_context}\n\nПожалуйста, сгенерируй ультимативный подробнейший курс."

        raw_result = await self.run(prompt, context)
        return self._parse_json(raw_result, self._fallback_course(profession, salary, level))

    async def expand_course(
        self,
        current_course: dict,
        additional_focus: str,
        extra_context: str = ""
    ) -> list:
        prompt = build_course_expansion_prompt(current_course, additional_focus, extra_context)
        context = f"ТЕКУЩИЙ КУРС ИМЕЕТ {len(current_course.get('modules', []))} МОДУЛЕЙ. Сгенерируй только новые продвинутые модули."

        raw_result = await self.run(prompt, context)
        data = self._parse_json(raw_result, {"modules": []})
        return data.get("modules", [])

    async def generate_review_test(
        self,
        module_title: str,
        module_theory: str,
        practice_type: str
    ) -> dict:
        prompt = build_review_test_prompt(module_title, module_theory, practice_type)
        raw_result = await self.run(prompt, "Создай 3 вопроса для Spaced Repetition теста.")
        return self._parse_json(raw_result, {"questions": []})

    async def generate_retry_task(
        self,
        module_title: str,
        practice_type: str,
        original_task: str,
        weaknesses: list
    ) -> dict:
        prompt = build_retry_task_prompt(module_title, practice_type, original_task, weaknesses)
        raw_result = await self.run(prompt, "Создай альтернативное задание.")
        return self._parse_json(raw_result, {
            "task_description": f"Повторная попытка по теме: {module_title}",
            "code_template": "function solution() {\n  // твой код здесь\n}",
            "test_cases": [],
            "non_code_options": [],
            "non_code_correct": "",
            "explanation": "Разбор задания.",
            "guided_hints": []
        })

    async def get_module_hint(self, paragraph_text: str, profession: str) -> str:
        prompt = build_module_hint_prompt(paragraph_text, profession)
        raw_result = await self.run(prompt, "Объясни этот абзац по-другому.")
        return raw_result.strip()

    def _parse_json(self, raw_result: str, fallback: dict) -> dict:
        try:
            cleaned = raw_result.strip()
            if cleaned.startswith("```json"):
                cleaned = cleaned[7:]
            if cleaned.startswith("```"):
                cleaned = cleaned[3:]
            if cleaned.endswith("```"):
                cleaned = cleaned[:-3]
            return json.loads(cleaned.strip())
        except Exception as e:
            print(f"CareerCourseAgent JSON parse error: {e}, raw[:200]: {raw_result[:200]}")
            return fallback

    def _fallback_course(self, profession: str, salary: str, level: str) -> dict:
        return {
            "profession": profession,
            "salary": salary,
            "level": level,
            "project_name": f"Учебный проект по {profession}",
            "project_description": "Сквозной проект который будет расти вместе с курсом.",
            "insights": f"Специальность {profession} крайне востребована на рынке. Начните с базовых концепций.",
            "modules": [
                {
                    "id": "mod_1",
                    "title": f"Основы и введение в {profession}",
                    "description": "Изучение базовых концепций и инструментов.",
                    "why_needed": "Базовые требования в 95% вакансий.",
                    "detailed_theory": f"Для работы в качестве {profession} необходимо понимать базовые принципы. ||| Этот модуль закладывает теоретический фундамент. ||| Практические навыки строятся на крепкой теории.",
                    "resources": [{"title": "Официальная документация", "url": "https://developer.mozilla.org", "description": "Начните с официальных источников."}],
                    "practice_type": "copywriting",
                    "practice_task": {
                        "task_description": f"Напишите краткий план обучения на первый месяц в сфере {profession}",
                        "origin_interview_questions": "Стандартный вопрос на любом собеседовании: 'Расскажите о себе и своём опыте'",
                        "code_template": "",
                        "test_cases": [],
                        "non_code_options": ["План готов", "Пропустить"],
                        "non_code_correct": "План готов",
                        "explanation": "Отличная отправная точка!"
                    },
                    "practice_guided": {"hints": ["Шаг 1: Определи 3 главные темы", "Шаг 2: Оцени время на каждую", "Шаг 3: Запиши конкретные ресурсы"], "simplified_template": ""},
                    "practice_expert": {"constraint": "Оформи план в формате OKR с измеримыми результатами", "bonus_description": "Умение ставить цели по OKR — ценный навык."},
                    "project_thread_step": "Создай README.md для своего учебного репозитория."
                }
            ]
        }
