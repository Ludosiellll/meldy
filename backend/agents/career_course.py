from .base import BaseAgent
import json
from utils import parse_llm_json


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
5. ЯЗЫК УЧЕБНЫХ РЕСУРСОВ: Поскольку студент находится в русскоязычном регионе ({location}), ты ОБЯЗАН подбирать качественные учебные материалы (resources) исключительно на РУССКОМ языке (например, русскоязычные статьи на Хабре, русская документация MDN, русскоязычные разделы Metanit для C#/.NET/Java/Python/C++). Давай ссылки на англоязычные статьи только в крайнем случае, когда нет достойного русскоязычного аналога.
"""

    return f"""Ты — {expert['title']}.
Tвой стиль преподавания и тон: {expert['tone']}

Твоя задача — спроектировать ультимативно глубокую, содержательную и сбалансированную программу обучения (курс) для студента, который хочет освоить профессию "{profession}" (уровень: {level}, целевая зарплата: {salary}).
Этот курс должен быть профессиональным, структурированным и вести ученика от самого нуля (без опыта) до полной готовности к трудоустройству по выбранной вакансии.
{demographics_block}
При проектировании курса опирайся на реальные требования рынка, собранные из свежих вакансий:
{vacancy_context}

ИНСТРУКЦИЯ ПО ГЕНЕРАЦИИ ДВУХ СУЩНОСТЕЙ:
1. **Силлабус (Syllabus)**: Спроектируй ПОЛНЫЙ, СВЕРХОБЪЕМНЫЙ и детальный пошаговый план обучения (дорожную карту) из 25-35 микро-тем, разбитых по 5-8 последовательным главам. План должен быть по-настоящему гигантским, охватывать абсолютно все темы от самых азов (установка, синтаксис, переменные, ветвления, базовые типы) до продвинутых архитектурных паттернов, проектирования систем, баз данных, Docker, DevOps, CI/CD, оптимизации, рефакторинга и тестирования. Каждая глава должна содержать минимум 4-5 детальных микро-тем, чтобы курс ощущался масштабным, полноценным и максимально профессиональным!
2. **Модули (Modules)**: Чтобы не перегружать память и токенные лимиты, сгенерируй в этом запросе СТРОГО первые 2 подробных учебных модуля (mod_1 и mod_2), соответствующие первым 2 микро-темам из твоего силлабуса. Для остальных тем силлабуса детальные модули будут генерироваться постепенно по мере продвижения студента!

Для первых двух модулей ты ОБЯЗАН предоставить:
1. Зачем это нужно работодателям: конкретная привязка к реальным вакансиям.
2. Подробная теория темы: 1-2 емких, содержательных параграфа (каждый из 3-4 предложений). Разбей параграфы через символ "|||" — каждый параграф будет отображаться как отдельный блок с кнопкой «Не понял».
3. Лучшие отобранные ресурсы с ТОЧНЫМИ deep links (не главные страницы — конкретные статьи на Хабре, задачи LeetCode, разделы MDN, руководства Metanit).
4. ТРЁХУРОВНЕВАЯ ПРАКТИКА (это ключевое):
   - Уровень Guided (с подсказками): та же задача но с пошаговыми подсказками-шагами для студентов которые только начинают
   - Уровень Independent (стандарт): полноценное задание без подсказок
   - Уровень Expert (челлендж): то же задание но с дополнительным ограничением (например, "реши за O(n)", "без использования встроенных методов", "добавь обработку ошибок")
5. Симуляция реального собеседования: конкретная компания + каверзные вопросы интервьюера.
6. Шаг сквозного проекта: какой конкретный компонент/файл/функцию студент добавляет в свой сквозной проект в рамках этого модуля.
7. Выбор practice_type строго по следующим правилам:
   - 'algo': для ВСЕХ задач по программированию, алгоритмам, структурам данных, написанию скриптов (Bash, Python, JS, и т.д.), Docker, CI/CD, системному администрированию Linux, Git, серверам и консольным утилитам. Дает студенту текстовый редактор кода с запуском тестов.
   - 'sql': исключительно для написания SQL-запросов и работы с реляционными базами данных (PostgreSQL, MySQL и т.д.).
   - 'web': исключительно для фронтенд-верстки (HTML и CSS, сплит-экран с визуальным превью). НЕ используй это для серверных, системных или скриптовых задач!
   - 'business': для задач управления проектами, расчета продуктовых или бизнес-метрик (например, RICE/ICE, ROI, LTV, CAC).
   - 'design': для UX/UI аудита и поиска визуальных ошибок на макетах.
   - 'copywriting': для написания текстов, коммерческих предложений, маркетинговых постов или технической документации.
   - 'roleplay': для интерактивных диалогов с ИИ-персонажами (клиенты, коллеги, руководители) для тренировки софт-скиллов.

ФОРМАТ ИНТЕРАКТИВНОЙ ПРАКТИКИ ДЛЯ РАЗРАБОТЧИКОВ (КРИТИЧЕСКИ ВАЖНО):
Наша интерактивная песочница на фронтенде запускает код как JavaScript-функцию `solution(...)` для типа практики 'algo'.
Поэтому, даже если профессия связана с C#, Python, Java, C++ или любым другим языком:
1. Ты ОБЯЗАН написать формулировку задачи (`task_description`), шаблон кода (`code_template`) и тесты (`test_cases`) с использованием JavaScript-функции `function solution(...) {{ ... }}`.
2. В описании задания (`task_description`) обязательно добавь понятное примечание на русском языке, например: «(Примечание: Наша песочница проверяет алгоритмы на JavaScript. Напишите решение на JavaScript, логика которого полностью идентична вашему основному стеку [Название стека, например C#])».
3. СТРОЖАЙШЕЕ ПРАВИЛО: В поле 'code_template' вы должны сгенерировать ИСКЛЮЧИТЕЛЬНО пустую сигнатуру функции с соответствующими аргументами (например, function solution(str) {{ \n  // Напишите ваше решение на JavaScript здесь\n }}). Категорически запрещено помещать готовое решение, законченный код или алгоритм внутрь 'code_template'! Студент обязан написать код самостоятельно.
4. Это позволит пользователю без проблем писать код в песочнице и запускать тесты, понимая, что алгоритмическая логика универсальна.

СТРОЖАЙШЕЕ ПРАВИЛО ПРЕДОТВРАЩЕНИЯ ГАЛЛЮЦИНАЦИЙ ССЫЛОК (КРИТИЧЕСКИ ВАЖНО):
- Категорически запрещено выдумывать или генерировать случайные URL-адреса статей на Хабре с выдуманными числовыми ID (например, хаотичные ссылки типа /articles/538742/ ведут на случайные посторонние публикации!).
- Вместо этого используй исключительно 100% надежные и стабильные ресурсы:
  1. Официальные сайты документации: https://learn.microsoft.com/ru-ru/dotnet/, https://docs.python.org/3/, https://react.dev/, https://www.typescriptlang.org/docs/, https://developer.mozilla.org/ru/
  2. Руководства на Metanit (крайне стабильные русские ссылки):
     - По C# и .NET: https://metanit.com/sharp/tutorial/
     - По ASP.NET Core API: https://metanit.com/sharp/aspnet/
     - По Entity Framework Core: https://metanit.com/sharp/entityframework/
     - По TypeScript: https://metanit.com/web/typescript/
     - По JavaScript: https://metanit.com/web/javascript/
     - По Python: https://metanit.com/python/tutorial/
     - По SQL/PostgreSQL: https://metanit.com/sql/postgresql/
     - По React: https://metanit.com/web/react/
  3. Для LeetCode задач используй только реальные известные URL, например: https://leetcode.com/problems/two-sum/, https://leetcode.com/problems/valid-parentheses/
- Если ты хочешь сослаться на тему, для которой не знаешь точной ссылки на Хабре, давай ссылку на главный тематический Хаб (например, https://habr.com/ru/hub/net/, https://habr.com/ru/hub/programming/ или https://habr.com/ru/hub/webdev/). Никаких выдуманных ID статей!

САМООГРАНИЧЕНИЕ ПО ДЛИНЕ И ЦЕЛОСТНОСТИ:
- Пиши содержательно, технично, но без лишней воды. Твой JSON-ответ должен быть СТРОГО полным и законченным. Никаких обрывов в конце генерации!

ОБЯЗАТЕЛЬНО верни строго JSON-структуру без markdown-оберток (НИКАКИХ ```json или ```):
{{
  "profession": "{profession}",
  "salary": "{salary}",
  "level": "{level}",
  "location": "{location}",
  "project_name": "Название сквозного проекта (например: 'Portfolio Website', 'Task Manager API', 'Analytics Dashboard')",
  "project_description": "Краткое описание сквозного проекта — что это будет на выходе курса",
  "insights": "Крайне подробный аналитический обзор рынка труда: тренды, требования, дефицитные скиллы.",
  "syllabus": {{
    "chapters": [
      {{
        "title": "Глава 1. Название главы",
        "topics": [
          {{ "title": "Тема 1 (соответствует mod_1)", "is_completed": true, "module_id": "mod_1" }},
          {{ "title": "Тема 2 (соответствует mod_2)", "is_completed": true, "module_id": "mod_2" }},
          {{ "title": "Тема 3", "is_completed": false }},
          {{ "title": "Тема 4", "is_completed": false }}
        ]
      }},
      {{
        "title": "Глава 2. Название главы 2",
        "topics": [
          {{ "title": "Тема 5", "is_completed": false }},
          {{ "title": "Тема 6", "is_completed": false }}
        ]
      }}
    ]
  }},
  "modules": [
    {{
      "id": "mod_1",
      "title": "Название первого модуля (должно в точности совпадать с Тема 1)",
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
    }},
    {{
      "id": "mod_2",
      "title": "Название второго модуля (должно в точности совпадать с Тема 2)",
      "description": "Исчерпывающее описание второго модуля...",
      "why_needed": "...",
      "detailed_theory": "...",
      "resources": [
        {{
          "title": "...",
          "url": "https://...",
          "description": "..."
        }}
      ],
      "practice_type": "algo",
      "practice_task": {{
        "task_description": "...",
        "origin_interview_questions": "...",
        "code_template": "function solution() {{\\n  // напиши свой код здесь\\n}}",
        "test_cases": [
          {{ "input": "...", "expected": "..." }}
        ],
        "non_code_options": [],
        "non_code_correct": "",
        "explanation": "..."
      }},
      "practice_guided": {{
        "hints": [],
        "simplified_template": ""
      }},
      "practice_expert": {{
        "constraint": "...",
        "bonus_description": "..."
      }},
      "project_thread_step": "..."
    }}
  ]
}}

Пиши исключительно содержательно, но ёмко, чтобы полностью сгенерировать силлабус и эти 2 модуля в рамках лимита токенов.
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

    location = current_course.get("location", "")
    lang_instruction = ""
    if location:
        lang_instruction = f"ЯЗЫК УЧЕБНЫХ РЕСУРСОВ: Поскольку студент из русскоязычного региона ({location}), подбирай учебные материалы и ссылки (resources) строго на РУССКОМ языке (Хабр, Metanit, русская документация, русскоязычные переводы). Давай английские ссылки только при полном отсутствии русскоязычных качественных аналогов."

    return f"""Ты — {expert['title']}.
Твой стиль преподавания и тон: {expert['tone']}

Студент только что успешно завершил базовый курс по профессии "{profession}" (уровень: {level}).
Сквозной проект курса: "{project_name}"

Пройденные модули:
{modules_summary}

Новый фокус/цель обучения: "{additional_focus}"
{f"Дополнительный контекст: {extra_context}" if extra_context else ""}
{lang_instruction}

Спроектируй от 3 до 5 новых ПРОДВИНУТЫХ модулей, которые логически продолжают существующие.
Нумерация ID продолжается: первый новый модуль = "mod_{num_existing + 1}".

Каждый продвинутый модуль обязан содержать:
1. Привязку к сложным вакансиям Middle/Senior уровня.
2. Подробную теорию (2-3 параграфа, разделённых через |||).
3. Deep Links на продвинутые ресурсы (конкретные URL на РУССКОМ языке — Хабр, Metanit, и т.д.).
   СТРОЖАЙШЕЕ ПРАВИЛО ПРЕДОТВРАЩЕНИЯ ГАЛЛЮЦИНАЦИЙ ССЫЛОК (КРИТИЧЕСКИ ВАЖНО):
   - Категорически запрещено выдумывать или генерировать случайные URL-адреса статей на Хабре с выдуманными числовыми ID (например, /articles/538742/ ведут на посторонние статьи!).
   - Вместо этого используй исключительно 100% надежные и стабильные ресурсы:
     - Официальные сайты документации: https://learn.microsoft.com/ru-ru/dotnet/, https://docs.python.org/3/, https://react.dev/, https://www.typescriptlang.org/docs/, https://developer.mozilla.org/ru/
     - Руководства на Metanit (крайне стабильные русские ссылки):
       - По C# и .NET: https://metanit.com/sharp/tutorial/
       - По ASP.NET Core: https://metanit.com/sharp/aspnet/
       - По Entity Framework Core: https://metanit.com/sharp/entityframework/
       - По TypeScript: https://metanit.com/web/typescript/
       - По JavaScript: https://metanit.com/web/javascript/
       - По Python: https://metanit.com/python/tutorial/
       - По SQL/PostgreSQL: https://metanit.com/sql/postgresql/
       - По React: https://metanit.com/web/react/
     - Если ты хочешь сослаться на тему, для которой не знаешь точной ссылки на Хабре, давай ссылку на главный тематический Хаб (например, https://habr.com/ru/hub/net/, https://habr.com/ru/hub/programming/ или https://habr.com/ru/hub/webdev/). Никаких выдуманных ID статей!
4. Трёхуровневую практику: practice_task (Independent) + practice_guided + practice_expert.
5. Симуляцию реального собеседования в крупной компании с origin_interview_questions.
6. Шаг сквозного проекта: что добавляется в "{project_name}" в этом модуле.
7. Выбор practice_type строго по правилам: 'algo' (код, скрипты Bash/Python, системные задачи Linux/Docker/Git/DevOps), 'sql' (базы данных, запросы), 'web' (только HTML/CSS верстка), 'business' (метрики, PM), 'design' (UI/UX макеты), 'copywriting' (тексты, документация), 'roleplay' (переговоры, soft-skills).

ФОРМАТ ИНТЕРАКТИВНОЙ ПРАКТИКИ ДЛЯ РАЗРАБОТЧИКОВ:
Наша интерактивная песочница на фронтенде запускает код как JavaScript-функцию `solution(...)` для типа практики 'algo'.
Поэтому для любого стека:
1. Шаблон кода (`code_template`) и тесты (`test_cases`) пиши с использованием JavaScript-функции `function solution(...) {{ ... }}`.
2. В `task_description` добавь примечание, например: «(Примечание: Песочница проверяет алгоритмы на JavaScript. Напишите аналогичную логику решения на JavaScript для проверки.)».
3. СТРОЖАЙШЕЕ ПРАВИЛО: В поле 'code_template' генерируй ИСКЛЮЧИТЕЛЬНО пустую сигнатуру функции с нужными аргументами (например, function solution(arr) {{ \n  // Напишите ваше решение на JavaScript здесь\n }}). Никогда не пишите готовое решение задачи внутрь шаблона кода!

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
        "bonus_description": "Что демонстрирует решение expert-версию."
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


def build_single_module_prompt(
    profession: str,
    level: str,
    salary: str,
    topic_title: str,
    current_course: dict
) -> str:
    existing_modules = current_course.get("modules", [])
    num_existing = len(existing_modules)
    project_name = current_course.get("project_name", "Сквозной проект")
    expert = get_expert_persona(profession)
    location = current_course.get("location", "")
    
    lang_instruction = ""
    if location:
        lang_instruction = f"ЯЗЫК УЧЕБНЫХ РЕСУРСОВ: Поскольку студент из русскоязычного региона ({location}), подбирай учебные материалы и ссылки (resources) строго на РУССКОМ языке (Хабр, Metanit, русская документация, русскоязычные переводы). Давай английские ссылки только при полном отсутствии русскоязычных качественных аналогов."

    return f"""Ты — {expert['title']}.
Твой стиль преподавания и тон: {expert['tone']}

Студент проходит персональный курс по профессии "{profession}" (уровень: {level}, целевая зарплата: {salary}).
Сквозной проект курса: "{project_name}"

Твоя задача — спроектировать ОДИН ОЧЕНЬ ГЛУБОКИЙ, ПОДРОБНЫЙ И КАЧЕСТВЕННЫЙ УЧЕБНЫЙ МОДУЛЬ строго по теме:
"{topic_title}"

ID этого модуля должен быть: "mod_{num_existing + 1}"

{lang_instruction}

Модуль обязан быть оформлен строго в формате JSON и содержать:
1. "id": "mod_{num_existing + 1}"
2. "title": "{topic_title}"
3. "description": "Исчерпывающее описание содержания модуля."
4. "why_needed": "Конкретная привязка к вакансиям (например: 'В 87% вакансий уровня Middle требуется...')."
5. "detailed_theory": "Параграф 1 с детальным разбором концепции. ||| Параграф 2 с примерами и паттернами. ||| Параграф 3 с архитектурными решениями и нюансами реализации."
6. "resources": [
     {{
       "title": "Название материала",
       "url": "https://конкретная-ссылка.com/точный-путь",
       "description": "Почему именно этот ресурс и как по нему заниматься."
     }}
   ]
   СТРОЖАЙШЕЕ ПРАВИЛО ПРЕДОТВРАЩЕНИЯ ГАЛЛЮЦИНАЦИЙ ССЫЛОК:
   - Категорически запрещено придумывать или генерировать случайные URL-адреса на Хабре с выдуманными числовыми ID (например, ссылки типа /articles/538742/ ведут на посторонние статьи!).
   - Вместо этого используй исключительно 100% надежные и стабильные ресурсы:
     - Официальные сайты документации: https://learn.microsoft.com/ru-ru/dotnet/, https://docs.python.org/3/, https://react.dev/, https://www.typescriptlang.org/docs/, https://developer.mozilla.org/ru/
     - Руководства на Metanit (крайне стабильные русские ссылки):
       - По C# и .NET: https://metanit.com/sharp/tutorial/
       - По ASP.NET Core: https://metanit.com/sharp/aspnet/
       - По Entity Framework Core: https://metanit.com/sharp/entityframework/
       - По TypeScript: https://metanit.com/web/typescript/
       - По JavaScript: https://metanit.com/web/javascript/
       - По Python: https://metanit.com/python/tutorial/
       - По SQL/PostgreSQL: https://metanit.com/sql/postgresql/
       - По React: https://metanit.com/web/react/
     - Если ты хочешь сослаться на тему, для которой не знаешь точной ссылки на Хабре, давай ссылку на главный тематический Хаб (например, https://habr.com/ru/hub/net/, https://habr.com/ru/hub/programming/ или https://habr.com/ru/hub/webdev/). Никаких выдуманных ID статей!
7. "practice_type": "algo | sql | web | business | design | copywriting | roleplay"
   (Выбирай 'algo' для всех задач программирования, написания кода, алгоритмов, скриптов, CI/CD, Git и т.д. в песочнице)
8. "practice_task": {{
     "task_description": "Подробнейшее ТЗ для уровня Independent.",
     "origin_interview_questions": "Компания: [Яндекс/Тинькофф/Авито/Google]. Вопросы на реальном техническом интервью: 1) ... 2) ... 3) ... Каверзные follow-up вопросы интервьюера.",
     "code_template": "function solution() {{\\n  // напиши свой код здесь\\n}}",
     "test_cases": [
       {{ "input": "...", "expected": "..." }}
     ],
     "non_code_options": [],
     "non_code_correct": "",
     "explanation": "Подробный разбор правильного решения."
   }}
9. "practice_guided": {{
     "hints": [
       "Шаг 1: ...",
       "Шаг 2: ..."
     ],
     "simplified_template": "..."
   }}
10. "practice_expert": {{
      "constraint": "Дополнительное ограничение которое делает задачу сложнее",
      "bonus_description": "Что студент докажет решив expert-версию."
    }}
11. "project_thread_step": "Конкретное описание что студент добавляет в сквозной проект в этом модуле."

ФОРМАТ ИНТЕРАКТИВНОЙ ПРАКТИКИ ДЛЯ РАЗРАБОТЧИКОВ (КРИТИЧЕСКИ ВАЖНО):
Наша интерактивная песочница на фронтенде запускает код как JavaScript-функцию `solution(...)` для типа практики 'algo'.
Поэтому, даже если профессия связана с C#, Python, Java, C++ или любым другим языком:
1. Ты ОБЯЗАН написать формулировку задачи (`task_description`), шаблон кода (`code_template`) и тесты (`test_cases`) с использованием JavaScript-функции `function solution(...) {{ ... }}`.
2. В описании задания (`task_description`) обязательно добавь понятное примечание на русском языке, например: «(Примечание: Наша песочница проверяет алгоритмы на JavaScript. Напишите решение на JavaScript, логика которого полностью идентична вашему основному стеку [Название стека, например C#])».
3. СТРОЖАЙШЕЕ ПРАВИЛО: В поле 'code_template' вы должны сгенерировать ИСКЛЮЧИТЕЛЬНО пустую сигнатуру функции с соответствующими аргументами. Категорически запрещено помещать готовое решение внутрь 'code_template'! Студент обязан написать код самостоятельно.

ОБЯЗАТЕЛЬНО верни строго JSON-структуру без markdown-оберток (НИКАКИХ ```json или ```):
{{
  "id": "mod_{num_existing + 1}",
  "title": "{topic_title}",
  "description": "...",
  "why_needed": "...",
  "detailed_theory": "...",
  "resources": [...],
  "practice_type": "...",
  "practice_task": {{...}},
  "practice_guided": {{...}},
  "practice_expert": {{...}},
  "project_thread_step": "..."
}}
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

    async def generate_next_module(
        self,
        profession: str,
        level: str,
        salary: str,
        topic_title: str,
        current_course: dict
    ) -> dict:
        prompt = build_single_module_prompt(profession, level, salary, topic_title, current_course)
        raw_result = await self.run(prompt, f"Сгенерируй один подробный модуль по теме: {topic_title}")
        return self._parse_json(raw_result, {})

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
            return parse_llm_json(raw_result)
        except Exception as e:
            print(f"CareerCourseAgent JSON parse error: {e}, raw[:200]: {raw_result[:200]}")
            return fallback

    def _fallback_course(self, profession: str, salary: str, level: str) -> dict:
        prof_lower = profession.lower()
        is_csharp = any(k in prof_lower for k in ["c#", ".net", "си шарп", "csharp"])
        is_python = any(k in prof_lower for k in ["python", "пайтон", "питон", "django", "fastapi"])
        is_js = any(k in prof_lower for k in ["javascript", "js", "ts", "typescript", "frontend", "react", "vue", "angular", "node"])
        is_technical = any(k in prof_lower for k in ["разработчик", "developer", "программист", "frontend", "backend", "fullstack", "devops", "qa", "тестировщик", "engineer", "инженер", "c#", ".net", "python", "java", "golang", "c++", "c/c++", "ruby", "php", "rust", "swift", "kotlin", "android", "ios"])
        is_sql = any(k in prof_lower for k in ["баз", "данных", "sql", "data", "database", "dba", "аналитик"]) and not is_technical

        modules = []

        if is_csharp:
            project_name = "E-Commerce REST API"
            project_description = "Разработка масштабируемого backend-сервиса интернет-магазина на ASP.NET Core с использованием C#, Entity Framework Core и PostgreSQL."
            insights = f"Стек C#/.NET крайне востребован в корпоративном секторе и финтехе. Основные требования рынка включают глубокие знания ООП, ASP.NET Core Web API, LINQ, Entity Framework и понимание реляционных СУБД. Ваша цель по зарплате в {salary} абсолютно реальна при освоении этих навыков."
            
            # Module 1
            modules.append({
                "id": "mod_1",
                "title": "Базовый C# и ООП на платформе .NET",
                "description": "Изучение базового синтаксиса, системы типов и ключевых принципов ООП в C#.",
                "why_needed": "В 100% вакансий .NET-разработчиков требуется уверенное знание принципов ООП для написания надежного кода.",
                "detailed_theory": "Язык C# является строго типизированным объектно-ориентированным языком программирования. Всё приложение строится на классах и объектах, взаимодействующих между собой. ||| Ключевые столпы ООП — это инкапсуляция, наследование и полиморфизм. ||| Понимание разницы между ссылочными типами (class) и типами значений (struct) критично для эффективного управления памятью в .NET.",
                "resources": [
                    {"title": "Руководство по C# на Metanit", "url": "https://metanit.com/sharp/tutorial/", "description": "Подробнейший русскоязычный учебник по C# и ООП."}
                ],
                "practice_type": "algo",
                "practice_task": {
                    "task_description": "Напишите алгоритм, который проверяет правильность скобочной последовательности. Функция solution(str) принимает строку, содержащую символы '(', ')', '{', '}', '[', ']' и возвращает true, если все скобки закрыты в правильном порядке, иначе false. (Примечание: Наша песочница проверяет алгоритмы на JavaScript. Напишите решение на JavaScript, логика которого полностью идентична C# Stack/List решениям).",
                    "origin_interview_questions": "Компания: Сбер. Вопросы на интервью: 1) В чем разница между ссылочными (class) и значимыми (struct) типами в C#? 2) Где выделяется память под объекты классов и под структуры? 3) Что такое сборщик мусора (GC) в .NET и как он работает?",
                    "code_template": "function solution(str) {\n  // Напишите ваше решение на JavaScript здесь\n  \n}",
                    "test_cases": [
                        { "input": "[\"()[]{}\"]", "expected": "true" },
                        { "input": "[\"(]\"]", "expected": "false" }
                    ],
                    "non_code_options": [],
                    "non_code_correct": "",
                    "explanation": "Использование стека для проверки скобок — это классический алгоритм, демонстрирующий понимание структур данных, аналогичных Stack<T> в C#."
                },
                "practice_guided": {
                    "hints": ["Создайте пустой массив-стек.", "Итерируйтесь по строке.", "Если скобка открывающаяся, кладите её в стек, иначе проверяйте вершину."],
                    "simplified_template": "function solution(str) {\n  let stack = [];\n  // ваш код здесь\n  return true;\n}"
                },
                "practice_expert": {
                    "constraint": "Решите задачу без создания дополнительных объектов-маппингов и с минимальным потреблением памяти (O(1) по дополнительной памяти для круглых скобок).",
                    "bonus_description": "Демонстрирует способность оптимизировать потребление оперативной памяти под высокой нагрузкой (LOH/GC в .NET)."
                },
                "project_thread_step": "Создайте структуру проекта для E-Commerce API на GitHub и добавьте файл README.md с описанием архитектуры."
            })
            
            # Module 2
            modules.append({
                "id": "mod_2",
                "title": "Коллекции, LINQ и веб-запросы на ASP.NET Core",
                "description": "Изучение коллекций .NET, технологии декларативных запросов LINQ и создание простейшего REST API на ASP.NET Core.",
                "why_needed": "LINQ и ASP.NET Core являются базовым стандартом современной промышленной .NET-разработки.",
                "detailed_theory": "Технология LINQ (Language Integrated Query) позволяет писать запросы к коллекциям данных в декларативном стиле, похожем на SQL. ||| Под капотом LINQ использует ленивые вычисления через IEnumerable. ||| Веб-сервисы ASP.NET Core обрабатывают HTTP-запросы в асинхронном режиме с использованием async/await для предотвращения блокировки пула потоков.",
                "resources": [
                    {"title": "Руководство по LINQ в C# на Metanit", "url": "https://metanit.com/sharp/tutorial/15.1.php", "description": "Понятные примеры использования Where, Select, GroupBy, Join."}
                ],
                "practice_type": "algo",
                "practice_task": {
                    "task_description": "Напишите функцию, которая группирует список товаров по категориям и находит самую высокую цену в каждой категории. Функция solution(products) принимает массив объектов товаров {name, category, price} и возвращает объект, где ключи — это категории, а значения — максимальная цена. (Примечание: Наша песочница проверяет алгоритмы на JavaScript. Напишите решение на JavaScript, логика которого полностью идентична C# методам GroupBy и Max).",
                    "origin_interview_questions": "Компания: Тинькофф. Вопросы на интервью: 1) Что такое отложенное выполнение (deferred execution) в LINQ? 2) В чем разница между IEnumerable, IQueryable и IList? 3) Какова сложность поиска элемента по ключу в Dictionary?",
                    "code_template": "function solution(products) {\n  // Напишите ваше решение на JavaScript здесь\n  \n}",
                    "test_cases": [
                        { "input": "[ [{\"name\":\"A\",\"category\":\"Tech\",\"price\":100},{\"name\":\"B\",\"category\":\"Tech\",\"price\":150},{\"name\":\"C\",\"category\":\"Food\",\"price\":50}] ]", "expected": "{\"Tech\":150,\"Food\":50}" }
                    ],
                    "non_code_options": [],
                    "non_code_correct": "",
                    "explanation": "Эта задача эмулирует использование методов GroupBy и Max из пространства имен System.Linq."
                },
                "practice_guided": {
                    "hints": ["Создайте пустой объект-словарь.", "Сравнивайте текущую цену с сохраненной в словаре по категории."],
                    "simplified_template": "function solution(products) {\n  let result = {};\n  // ваш код здесь\n  return result;\n}"
                },
                "practice_expert": {
                    "constraint": "Решите задачу в один проход без использования встроенных вспомогательных методов и с линейной сложностью O(N).",
                    "bonus_description": "Показывает глубокое понимание однопроходных алгоритмов и структур данных."
                },
                "project_thread_step": "Разработайте слой данных (Domain Models) для корзины и товаров и напишите асинхронный контроллер в вашем E-Commerce проекте."
            })

        elif is_python:
            project_name = "FastAPI Backend Application"
            project_description = "Создание высокопроизводительного REST API с использованием FastAPI, SQLAlchemy и PostgreSQL."
            insights = f"Стек Python-разработки активно применяется в веб-разработке и Data Science. FastAPI стал стандартом для создания современных API благодаря поддержке асинхронности и автоматической валидации Pydantic. Зарплатный уровень {salary} абсолютно реален при освоении этих навыков."
            
            # Module 1
            modules.append({
                "id": "mod_1",
                "title": "Основы синтаксиса, списки и словари в Python",
                "description": "Изучение базовых типов данных Python, синтаксиса функций, генераторов списков (list comprehensions) и эффективного использования словарей.",
                "why_needed": "Python-разработчик обязан в совершенстве владеть встроенными структурами данных для эффективной обработки бизнес-логики.",
                "detailed_theory": "Python — это интерпретируемый язык с динамической типизацией. Он поощряет написание читаемого и лаконичного кода (Zen of Python). ||| Списки и словари — это фундаментальные структуры данных. Словари в Python реализованы на базе хэш-таблиц, что обеспечивает мгновенный поиск элементов за амортизированное O(1).",
                "resources": [
                    {"title": "Руководство по Python на Metanit", "url": "https://metanit.com/python/tutorial/", "description": "Понятные русскоязычные уроки для быстрого освоения синтаксиса."}
                ],
                "practice_type": "algo",
                "practice_task": {
                    "task_description": "Напишите функцию, которая принимает список чисел и возвращает список только уникальных элементов в том же порядке. Функция solution(arr) должна удалять дубликаты. (Примечание: Наша песочница проверяет алгоритмы на JavaScript. Напишите решение на JavaScript, логика которого полностью идентична Python решениям с множествами set()).",
                    "origin_interview_questions": "Компания: Яндекс. Вопросы на интервью: 1) В чем разница между mutable и immutable типами в Python? 2) Как под капотом устроен словарь dict и какова сложность поиска? 3) Что такое GIL и как он влияет на многопоточность?",
                    "code_template": "function solution(arr) {\n  // Напишите ваше решение на JavaScript здесь\n  \n}",
                    "test_cases": [
                        { "input": "[[1, 2, 2, 3, 1]]", "expected": "[1, 2, 3]" }
                    ],
                    "non_code_options": [],
                    "non_code_correct": "",
                    "explanation": "Использование хэш-таблицы (Set/set) позволяет решить эту задачу за линейное время O(N) вместо квадратичного O(N^2)."
                },
                "practice_guided": {
                    "hints": ["Создайте объект Set для отслеживания уникальных элементов.", "Итерируйтесь по массиву и добавляйте новые элементы."],
                    "simplified_template": "function solution(arr) {\n  let seen = new Set();\n  // ваш код здесь\n  return [];\n}"
                },
                "practice_expert": {
                    "constraint": "Решите задачу без использования структуры данных Set, сохраняя при этом временную сложность O(N).",
                    "bonus_description": "Показывает глубокое владение базовыми структурами данных."
                },
                "project_thread_step": "Инициализируйте репозиторий проекта FastAPI, настройте виртуальное окружение poetry и установите зависимости."
            })
            
            # Module 2
            modules.append({
                "id": "mod_2",
                "title": "Асинхронность в Python и разработка API с FastAPI",
                "description": "Разбор принципов асинхронности, Event Loop, создание эндпоинтов в FastAPI и валидация данных с помощью Pydantic моделей.",
                "why_needed": "Современный веб-разработчик на Python должен уметь писать высококонкурентные асинхронные API с автоматической валидацией запросов.",
                "detailed_theory": "Асинхронность в Python базируется на библиотеке asyncio и ключевых словах async/await. ||| FastAPI автоматически генерирует интерактивную OpenAPI/Swagger документацию на основе типов Pydantic. ||| Валидация входных данных на уровне Pydantic защищает приложение от некорректных запросов.",
                "resources": [
                    {"title": "Документация FastAPI на русском", "url": "https://fastapi.tiangolo.com/ru/", "description": "Прекрасный официальный учебник с пошаговыми инструкциями."}
                ],
                "practice_type": "algo",
                "practice_task": {
                    "task_description": "Напишите асинхронную функцию, которая выполняет два действия параллельно и возвращает их результаты массивом. Функция solution(p1, p2) принимает два промиса и ожидает их выполнения. (Примечание: Наша песочница проверяет алгоритмы на JavaScript. Напишите решение на JavaScript, логика которого полностью идентична asyncio.gather в Python).",
                    "origin_interview_questions": "Компания: Авито. Вопросы на интервью: 1) В чем разница между многопоточностью (threading) и асинхронностью (asyncio) в Python? 2) Что такое Pydantic и как он осуществляет валидацию типов?",
                    "code_template": "async function solution(p1, p2) {\n  // Напишите ваше решение на JavaScript здесь\n  \n}",
                    "test_cases": [
                        { "input": "[Promise.resolve(1), Promise.resolve(2)]", "expected": "[1, 2]" }
                    ],
                    "non_code_options": [],
                    "non_code_correct": "",
                    "explanation": "Этот алгоритм эмулирует параллельное выполнение задач с помощью Promise.all, что аналогично asyncio.gather() в Python."
                },
                "practice_guided": {
                    "hints": ["Используйте ключевое слово await.", "Используйте Promise.all для группировки промисов."],
                    "simplified_template": "async function solution(p1, p2) {\n  // ваш код здесь\n}"
                },
                "practice_expert": {
                    "constraint": "Реализуйте обработку таймаута: если промисы выполняются дольше 2 секунд, выбросьте исключение 'TimeoutError'.",
                    "bonus_description": "Показывает умение работать со временем выполнения и отменять зависшие асинхронные задачи."
                },
                "project_thread_step": "Разработайте эндпоинты CRUD для управления каталогом товаров с валидацией Pydantic."
            })

        elif is_js:
            project_name = "Interactive Dashboard Application"
            project_description = "Разработка интерактивной панели управления (SPA) на React с использованием TypeScript и TailwindCSS."
            insights = f"Frontend-разработка переживает бум интерактивных веб-приложений. Навыки работы с React, TypeScript и современными методами управления состоянием являются ключевыми для получения оффера на {salary}."
            
            # Module 1
            modules.append({
                "id": "mod_1",
                "title": "Основы JavaScript ES6+ и манипуляции с массивами",
                "description": "Глубокое изучение современного JavaScript: стрелочные функции, деструктуризация, асинхронные запросы (Promises, async/await) и продвинутые методы массивов (.map, .filter, .reduce).",
                "why_needed": "Уверенное владение современным стандартом JavaScript — это обязательное условие для разработки на любых фреймворках (React, Vue, Angular).",
                "detailed_theory": "Современный JavaScript предлагает удобный декларативный синтаксис для работы с данными. ||| Методы массивов .map() и .filter() создают новые массивы на основе исходного, не изменяя его напрямую. ||| Понимание асинхронной модели выполнения (Event Loop) критично для создания отзывчивых интерфейсов.",
                "resources": [
                    {"title": "Современный учебник JavaScript", "url": "https://learn.javascript.ru/", "description": "Лучший в мире русскоязычный учебник по JS с подробным разбором всех тем."}
                ],
                "practice_type": "algo",
                "practice_task": {
                    "task_description": "Напишите функцию solution(users), которая принимает массив объектов пользователей {id, name, age, active} и возвращает отсортированный по возрасту массив имен пользователей, у которых поле active равно true. Использовать методы .filter(), .map() и .sort().",
                    "origin_interview_questions": "Компания: Т-Банк. Вопросы на интервью: 1) В чем разница между var, let и const? 2) Что такое замыкание (closure) в JavaScript? 3) Как работает Event Loop?",
                    "code_template": "function solution(users) {\n  // Напишите ваше решение на JavaScript здесь\n  \n}",
                    "test_cases": [
                        { "input": "[ [{\"name\":\"Иван\",\"age\":25,\"active\":true},{\"name\":\"Анна\",\"age\":20,\"active\":false},{\"name\":\"Олег\",\"age\":30,\"active\":true}] ]", "expected": "[\"Иван\",\"Олег\"]" }
                    ],
                    "non_code_options": [],
                    "non_code_correct": "",
                    "explanation": "Комбинация методов .filter(), .sort() и .map() позволяет лаконично преобразовывать и фильтровать массивы данных."
                },
                "practice_guided": {
                    "hints": ["Отфильтруйте пользователей по полю u.active.", "Отсортируйте массив по возрастанию возраста (a.age - b.age).", "Преобразуйте объекты в имена с помощью map."],
                    "simplified_template": "function solution(users) {\n  // примените filter, sort, map\n  return [];\n}"
                },
                "practice_expert": {
                    "constraint": "Решите задачу в один проход с помощью метода .reduce() без использования промежуточных массивов от фильтрации и сортировки.",
                    "bonus_description": "Показывает превосходное владение методом .reduce() и навыки оптимизации алгоритмов обработки данных."
                },
                "project_thread_step": "Разверните проект с помощью Vite + React + TypeScript и настройте базовую файловую структуру."
            })
            
            # Module 2
            modules.append({
                "id": "mod_2",
                "title": "Управление жизненным циклом компонентов в React",
                "description": "Изучение функциональных компонентов React, хуков состояния useState, эффектов useEffect, правил использования хуков и оптимизации рендеринга.",
                "why_needed": "React является самым популярным frontend-фреймворком на рынке. Умение правильно управлять состоянием и эффектами — ядро frontend-разработки.",
                "detailed_theory": "React строится на компонентном подходе и Virtual DOM. ||| Хук useState позволяет хранить состояние внутри функционального компонента. ||| Хук useEffect используется для синхронизации компонента с внешними системами (API запросы, подписки). Важно правильно указывать массив зависимостей, чтобы избежать бесконечных циклов рендеринга.",
                "resources": [
                    {"title": "Официальная документация React на русском", "url": "https://ru.react.js.org/", "description": "Пошаговое руководство по созданию компонентов и хукам."}
                ],
                "practice_type": "algo",
                "practice_task": {
                    "task_description": "Напишите функцию solution(arr), которая группирует последовательные одинаковые элементы массива в подмассивы. Например: [1, 1, 2, 3, 3] превращается в [[1, 1], [2], [3, 3]]. Это умение группировать данные часто нужно при рендеринге списков по категориям в React.",
                    "origin_interview_questions": "Компания: Самокат. Вопросы на интервью: 1) Что такое Virtual DOM в React и как он оптимизирует обновление интерфейса? 2) В чем разница между управляемыми и неуправляемыми компонентами? 3) Почему нельзя вызывать хуки внутри условий или циклов?",
                    "code_template": "function solution(arr) {\n  // Напишите ваше решение на JavaScript здесь\n  \n}",
                    "test_cases": [
                        { "input": "[[1, 1, 2, 3, 3]]", "expected": "[[1,1],[2],[3,3]]" }
                    ],
                    "non_code_options": [],
                    "non_code_correct": "",
                    "explanation": "Этот алгоритм группировки демонстрирует понимание итеративного прохода массивов и работы с двумерными структурами."
                },
                "practice_guided": {
                    "hints": ["Создайте двумерный массив результатов.", "Используйте вспомогательный массив для накопления одинаковых элементов.", "Не забудьте добавить последний накопленный массив после цикла."],
                    "simplified_template": "function solution(arr) {\n  // ваш код здесь\n  return [];\n}"
                },
                "practice_expert": {
                    "constraint": "Решите задачу без создания временных накопительных массивов, используя только индексы и мутируя исходный массив на месте (in-place).",
                    "bonus_description": "Демонстрирует навыки экстремальной оптимизации алгоритмов по памяти O(1) для мобильных устройств."
                },
                "project_thread_step": "Разработайте интерактивные карточки тем и компонент прогресс-бара с использованием TailwindCSS."
            })

        elif is_sql:
            project_name = "Enterprise Analytics Database"
            project_description = "Проектирование и оптимизация реляционной базы данных для корпоративной аналитической системы продаж."
            insights = f"Специалисты по работе с данными (SQL, Аналитики, Data Engineers) востребованы во всех сферах бизнеса. Умение писать оптимизированные SQL-запросы, понимать планы выполнения и строить схемы данных ценится работодателями. Цель по зарплате {salary} достижима при освоении этих навыков."
            
            # Module 1
            modules.append({
                "id": "mod_1",
                "title": "Проектирование баз данных и базовые SQL запросы",
                "description": "Изучение реляционной модели данных, нормальных форм, написание простых запросов SELECT с фильтрацией WHERE, сортировкой ORDER BY и ограничением количества записей LIMIT.",
                "why_needed": "Любая работа с данными начинается с понимания структуры таблиц и умения извлекать из них базовую информацию.",
                "detailed_theory": "Реляционная база данных организует информацию в виде связанных таблиц с предопределенной структурой. ||| Нормализация данных (до 3-й нормальной формы) позволяет устранить дублирование информации и гарантировать целостность данных. ||| Базовый синтаксис SQL SELECT позволяет считывать конкретные столбцы, отсеивать ненужные строки с помощью WHERE и сортировать результаты.",
                "resources": [
                    {"title": "Интерактивный учебник по SQL на SQL-Academy", "url": "https://sql-academy.org/", "description": "Отличная русскоязычная платформа для практического освоения SQL."}
                ],
                "practice_type": "sql",
                "practice_task": {
                    "task_description": "Напишите SQL-запрос, который выбирает имя (name), отдел (department) и зарплату (salary) сотрудников из таблицы employees, чья зарплата превышает 80000, отсортированных по убыванию зарплаты.",
                    "origin_interview_questions": "Компания: Альфа-Банк. Вопросы на интервью: 1) В чем разница между реляционными и нереляционными базами данных (SQL vs NoSQL)? 2) Что такое первичный (PRIMARY KEY) и внешний (FOREIGN KEY) ключи? 3) Какие нормальные формы вы знаете и зачем они нужны?",
                    "code_template": "SELECT -- Напишите ваш SQL-запрос здесь\n;",
                    "test_cases": [],
                    "non_code_options": [],
                    "non_code_correct": "",
                    "explanation": "Базовый SQL запрос извлекает необходимые поля, фильтрует по числовому условию и сортирует в обратном порядке."
                },
                "practice_guided": {
                    "hints": ["Используйте оператор SELECT для выбора name, department, salary.", "Укажите таблицу FROM employees.", "Добавьте WHERE salary > 80000 и ORDER BY salary DESC."],
                    "simplified_template": "SELECT name, department, salary FROM employees WHERE ...;"
                },
                "practice_expert": {
                    "constraint": "Верните только первых 5 сотрудников с наибольшей зарплатой (используйте LIMIT).",
                    "bonus_description": "Демонстрирует навыки оптимизации трафика данных и пагинации выборок."
                },
                "project_thread_step": "Нарисуйте ER-диаграмму базы данных интернет-магазина, выделив сущности Users, Orders и Products."
            })
            
            # Module 2
            modules.append({
                "id": "mod_2",
                "title": "Объединение таблиц (JOIN) и агрегация данных",
                "description": "Овладение операторами связывания таблиц INNER JOIN, LEFT JOIN, а также группировкой данных с GROUP BY и фильтрацией групп с HAVING.",
                "why_needed": "В реальных базах данных информация разнесена по множеству таблиц. Аналитик обязан уметь объединять их в единые сводные отчеты.",
                "detailed_theory": "Операторы JOIN связывают строки из двух или более таблиц на основе совпадающих значений в ключевых столбцах. ||| Агрегатные функции (SUM, AVG, COUNT, MAX, MIN) позволяют производить математические вычисления над группами строк. ||| Группировка GROUP BY разделяет результат запроса на группы, а ключевое слово HAVING фильтрует эти группы.",
                "resources": [
                    {"title": "Объединение таблиц в SQL (JOIN) на Хабре", "url": "https://habr.com/ru/articles/450516/", "description": "Визуальное объяснение всех типов JOIN с понятными диаграммами Венна."}
                ],
                "practice_type": "sql",
                "practice_task": {
                    "task_description": "Напишите SQL-запрос, который находит общую сумму продаж (sum of sales.amount) по каждому клиенту (customers.name). Объедините таблицы customers и sales с помощью INNER JOIN, сгруппируйте по имени клиента и выведите только тех, у кого общая сумма продаж превышает 5000.",
                    "origin_interview_questions": "Компания: МегаФон. Вопросы на интервью: 1) В чем разница между INNER JOIN и LEFT JOIN? Что произойдет если в правой таблице нет совпадений? 2) В чем отличие WHERE от HAVING?",
                    "code_template": "SELECT -- Напишите ваш SQL-запрос здесь\n;",
                    "test_cases": [],
                    "non_code_options": [],
                    "non_code_correct": "",
                    "explanation": "Этот запрос объединяет таблицы клиентов и продаж, группирует по имени и фильтрует итоговые суммы с помощью HAVING."
                },
                "practice_guided": {
                    "hints": ["Используйте INNER JOIN для объединения таблиц по первичному и внешнему ключам.", "Примените GROUP BY c.name для группировки.", "Используйте HAVING SUM(s.amount) > 5000 для фильтрации групп."],
                    "simplified_template": "SELECT c.name, SUM(s.amount)\nFROM customers c\nINNER JOIN sales s ON ...\nGROUP BY ...\nHAVING ...;"
                },
                "practice_expert": {
                    "constraint": "Добавьте в выборку количество совершенных покупок клиентом (COUNT(s.id)) и отсортируйте результат по убыванию общей суммы.",
                    "bonus_description": "Демонстрирует навыки построения сложных аналитических KPI-отчетов для бизнеса."
                },
                "project_thread_step": "Напишите SQL скрипты миграций для создания таблиц и наполнения их демонстрационными данными."
            })

        else:
            # Generic engineering stack (Java, Go, DevOps, or non-technical)
            project_name = "Core Professional Portfolio Project"
            project_description = f"Проектирование и разработка полноценного прикладного сервиса по специальности {profession}."
            insights = f"Специальность {profession} является крайне востребованной на рынке. Понимание базовых архитектурных принципов, проектирование логики и практическая реализация ключевых бизнес-требований — залог успешного трудоустройства."
            
            # Module 1
            modules.append({
                "id": "mod_1",
                "title": "Основы и фундамент профессиональной деятельности",
                "description": f"Изучение базовых концепций, ключевых инструментов и стандартов работы в сфере {profession}.",
                "why_needed": "Базовые теоретические знания являются обязательным фильтром на любом первичном техническом собеседовании.",
                "detailed_theory": f"Уверенное понимание фундаментальных принципов ({profession}) позволяет избежать типичных архитектурных ошибок на ранних этапах. ||| Код и бизнес-логика должны строиться на принципах чистоты, структурированности и декомпозиции задач.",
                "resources": [
                    {"title": "Основы проектирования информационных систем на Хабре", "url": "https://habr.com/ru/articles/451690/", "description": "Понятная русскоязычная статья об архитектурном планировании."}
                ],
                "practice_type": "algo" if is_technical else "copywriting",
                "practice_task": {
                    "task_description": "Напишите функцию, которая находит самое длинное слово в предложении. Функция solution(sentence) принимает строку и возвращает длину самого длинного слова. (Примечание: Наша песочница проверяет алгоритмы на JavaScript. Напишите решение на JavaScript, логика работы со строками полностью переносится в другие языки программирования)." if is_technical else f"Напишите подробный план развития и внедрения вашего учебного проекта по теме: {profession}.",
                    "origin_interview_questions": "Стандартный вопрос на любом собеседовании: 'Расскажите о себе, своих главных проектах и технологическом стеке, который вы предпочитаете'.",
                    "code_template": "function solution(sentence) {\n  // Напишите ваше решение на JavaScript здесь\n  \n}" if is_technical else "",
                    "test_cases": [
                        { "input": "[\"The quick brown fox jumps over the lazy dog\"]", "expected": "5" }
                    ] if is_technical else [],
                    "non_code_options": [] if is_technical else ["План готов", "Пропустить"],
                    "non_code_correct": "" if is_technical else "План готов",
                    "explanation": "Разделение строки на слова и поиск максимального — линейный и очень эффективный алгоритм с временной сложностью O(N)."
                },
                "practice_guided": {
                    "hints": ["Используйте метод split(' ') для разделения предложения на слова.", "Сравнивайте длину каждого слова с максимальной."] if is_technical else ["Определите 3 ключевые цели.", "Распишите шаги для их достижения."],
                    "simplified_template": "function solution(sentence) {\n  let maxLength = 0;\n  // ваш код здесь\n  return maxLength;\n}" if is_technical else ""
                },
                "practice_expert": {
                    "constraint": "Решите задачу в один проход по строке без выделения дополнительной памяти на массив слов (O(1) по памяти)." if is_technical else "Оформи план в формате OKR с измеримыми результатами",
                    "bonus_description": "Показывает умение оптимизировать аллокации памяти." if is_technical else "Умение ставить цели по OKR — ценный навык."
                },
                "project_thread_step": "Настройте базовый репозиторий на GitHub и оформите README.md по архитектуре."
            })
            
            # Module 2
            modules.append({
                "id": "mod_2",
                "title": "Управление данными и прикладные решения",
                "description": "Разбор принципов проектирования логики, эффективного хранения информации и интеграции с системами баз данных.",
                "why_needed": "Создание надежных коммерческих приложений невозможно без правильного проектирования схем данных и логических связей.",
                "detailed_theory": "Разработка любого современного сервиса требует понимания того, как хранятся и обрабатываются данные. ||| Принципы SOLID и чистая архитектура помогают писать сопровождаемый код, который легко масштабировать под растущие нужды бизнеса.",
                "resources": [
                    {"title": "Принципы SOLID понятным языком на Хабре", "url": "https://habr.com/ru/articles/348286/", "description": "Понятные русскоязычные примеры для каждого принципа SOLID."}
                ],
                "practice_type": "algo" if is_technical else "copywriting",
                "practice_task": {
                    "task_description": "Напишите функцию solution(items), которая принимает массив объектов {name, priority} и возвращает массив, отсортированный по убыванию приоритета (priority). (Примечание: Наша песочница проверяет алгоритмы на JavaScript. Логика сортировки объектов универсальна)." if is_technical else f"Напишите детальное описание схемы хранения данных и модели сущностей для вашего сквозного проекта в рамках {profession}.",
                    "origin_interview_questions": "Расскажите: 1) Как вы обеспечиваете качество и надежность вашей работы? 2) Какие основные архитектурные шаблоны проектирования вы применяли в своих прошлых проектах?",
                    "code_template": "function solution(items) {\n  // Напишите ваше решение на JavaScript здесь\n  \n}" if is_technical else "",
                    "test_cases": [
                        { "input": "[ [{\"name\":\"task1\",\"priority\":3},{\"name\":\"task2\",\"priority\":5},{\"name\":\"task3\",\"priority\":1}] ]", "expected": "[{\"name\":\"task2\",\"priority\":5},{\"name\":\"task1\",\"priority\":3},{\"name\":\"task3\",\"priority\":1}]" }
                    ] if is_technical else [],
                    "non_code_options": [] if is_technical else ["Схема готова", "Пропустить"],
                    "non_code_correct": "" if is_technical else "Схема готова",
                    "explanation": "Сортировка объектов с использованием пользовательского компаратора (функции сравнения) является стандартной операцией."
                },
                "practice_guided": {
                    "hints": ["Используйте встроенный метод сортировки.", "Напишите компаратор: b.priority - a.priority."] if is_technical else ["Опишите основные таблицы или коллекции.", "Укажите связи один-ко-многим и многие-ко-многим."],
                    "simplified_template": "function solution(items) {\n  return items.sort(...);\n}" if is_technical else ""
                },
                "practice_expert": {
                    "constraint": "Реализуйте стабильную сортировку подсчетом (Counting Sort) за линейное время O(N) при условии, что приоритеты лежат в диапазоне от 1 до 5." if is_technical else "Опишите схему хранения в формате JSON Schema с правилами валидации.",
                    "bonus_description": "Показывает глубокие знания алгоритмов специализированной быстрой сортировки." if is_technical else "Демонстрирует навыки системного аналитика и дата-инженера."
                },
                "project_thread_step": "Разработайте схему хранения данных или интерфейсы моделей для сохранения состояния вашего прикладного проекта."
            })

        default_syllabus = {
            "chapters": [
                {
                    "title": "Глава 1. Основы и Введение",
                    "topics": [
                        { "title": modules[0]["title"], "is_completed": True, "module_id": "mod_1" },
                        { "title": modules[1]["title"], "is_completed": True, "module_id": "mod_2" },
                        { "title": "Тема 3. Системный анализ и паттерны проектирования", "is_completed": False },
                        { "title": "Тема 4. Сборка и деплой приложения", "is_completed": False }
                    ]
                },
                {
                    "title": "Глава 2. Продвинутые концепции",
                    "topics": [
                        { "title": "Тема 5. Оптимизация производительности", "is_completed": False },
                        { "title": "Тема 6. Масштабирование и финальный проект", "is_completed": False }
                    ]
                }
            ]
        }

        return {
            "profession": profession,
            "salary": salary,
            "level": level,
            "project_name": project_name,
            "project_description": project_description,
            "insights": insights,
            "modules": modules,
            "syllabus": default_syllabus
        }
