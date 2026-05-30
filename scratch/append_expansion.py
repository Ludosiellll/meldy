import os

path = r"backend/agents/career_course.py"

with open(path, "r", encoding="utf-8", errors="ignore") as f:
    content = f.read()

# Let's verify if the file ends with the closing structures
target = '''                          "explanation": "Отличная отправная точка для вашей карьеры!"
                        }
                    }
                ]
            }'''

replacement = '''                          "explanation": "Отличная отправная точка для вашей карьеры!"
                        }
                    }
                ]
            }

    async def expand_course(self, current_course: dict, additional_focus: str, extra_context: str = "") -> list:
        prompt = build_course_expansion_prompt(current_course, additional_focus, extra_context)
        context = f"ТЕКУЩИЙ КУРС ИМЕЕТ {len(current_course.get('modules', []))} МОДУЛЕЙ. Сгенерируй только новые продвинутые модули."
        
        raw_result = await self.run(prompt, context)
        
        try:
            cleaned = raw_result.strip()
            if cleaned.startswith("```json"):
                cleaned = cleaned[7:]
            if cleaned.startswith("```"):
                cleaned = cleaned[3:]
            if cleaned.endswith("```"):
                cleaned = cleaned[:-3]
            
            data = json.loads(cleaned.strip())
            return data.get("modules", [])
        except Exception as e:
            print(f"CareerCourseAgent expand JSON error: {e}, raw: {raw_result}")
            return []


def build_course_expansion_prompt(current_course: dict, additional_focus: str, extra_context: str = "") -> str:
    profession = current_course.get("profession", "IT-специалист")
    level = current_course.get("level", "Junior")
    existing_modules = current_course.get("modules", [])
    num_existing = len(existing_modules)
    
    modules_summary = "\\n".join([f"- ID: {m.get('id')} | Название: {m.get('title')}" for m in existing_modules])
    expert = get_expert_persona(profession)
    
    return f"""Ты — {expert['title']}.
Твой стиль преподавания и тон: {expert['tone']}

Студент только что успешно завершил твой базовый курс по профессии "{profession}" (уровень: {level}).
Пройденные модули курса:
{modules_summary}

Теперь твоя задача — РАСШИРИТЬ эту учебную программу продвинутыми, узкоспециализированными темами!
Новый фокус/цель обучения, которую выбрал студент:
"{additional_focus}"
{f"Дополнительный контекст/пожелания: {extra_context}" if extra_context else ""}

Спроектируй от 5 до 8 новых продвинутых модулей (модулей повышенной сложности), которые логически продолжают существующие.
Сквозная нумерация ID модулей должна продолжаться! Поскольку у нас уже есть {num_existing} модулей, первый новый модуль должен иметь ID "mod_{num_existing + 1}", второй "mod_{num_existing + 2}" и так далее.

Для каждого продвинутого модуля ты обязан предоставить:
1. Зачем это нужно работодателям: привязка к сложным задачам бизнеса.
2. Подробная теория темы: 2-3 больших, содержательных абзаца с детальным раскрытием концепций.
3. Лучшие отобранные ресурсы в сети с точечными ссылками (Deep Links). Обязательно давай прямые рабочие URL на LeetCode задачи (например, 'https://leetcode.com/problems/group-anagrams/'), MDN, Django/React specs, learn.javascript.ru и т.д.
4. Одно интерактивное практическое задание продвинутого уровня повышенной сложности под одну из песочниц (algo, sql, web, business, design, copywriting, roleplay). Каждое ТЗ практики обязано содержать поле "origin_interview_questions" с указанием компании и каверзных вопросов.

ОБЯЗАТЕЛЬНО верни строго JSON-структуру без markdown-оберток (НИКАКИХ ```json или ```):
{{
  "modules": [
    {{
      "id": "mod_{num_existing + 1}",
      "title": "Название первого продвинутого модуля",
      "description": "Исчерпывающее, глубокое описание продвинутого содержания модуля.",
      "why_needed": "Четкая привязка к сложным вакансиям Middle/Senior.",
      "detailed_theory": "Очень подробный теоретический блок (2-3 абзаца). Разжуй продвинутые архитектурные нюансы.",
      "resources": [
        {{
          "title": "Название продвинутого материала",
          "url": "https://...",
          "description": "Подробное объяснение, как по нему заниматься."
        }}
      ],
      "practice_type": "algo | sql | web | business | design | copywriting | roleplay",
      "practice_task": {{
        "task_description": "Продвинутое ТЗ для песочницы.",
        "origin_interview_questions": "СИМУЛЯЦИЯ РЕАЛЬНОГО СОБЕСЕДОВАНИЯ: Укажи компанию (например, Яндекс, Tinkoff, Google) и хитрые вопросы технического интервьюера по этой теме.",
        "code_template": "function solution() {{\\\\n  // напиши свой код здесь\\\\n}}",
        "test_cases": [
          {{ "input": "[...]", "expected": "..." }}
        ],
        "non_code_options": ["..."],
        "non_code_correct": "...",
        "explanation": "Подробный разбор решения от ИИ."
      }}
    }}
  ]
}}
"""
'''

content_clean = content.replace('\\r\\n', '\\n').replace('\\r', '')
target_clean = target.replace('\\r\\n', '\\n').replace('\\r', '')

if target_clean in content_clean:
    content_clean = content_clean.replace(target_clean, replacement)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content_clean)
    print("SUCCESS APPLIED")
else:
    print("FAILED TO MATCH TARGET")
