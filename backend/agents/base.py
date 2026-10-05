import asyncio
import base64
import hashlib
import json
import os
import random
import re
import time
from collections import OrderedDict
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Literal, Optional

import httpx
from fastapi import HTTPException
from google import genai
from google.genai import types
from groq import AsyncGroq

from utils import parse_llm_json


# ---------------------------------------------------------------------------
# Reading a model's answer. utils.parse_llm_json cuts the text at its first ```
# fence, which destroys a valid JSON answer whose string values hold a Markdown
# code block (a programming lecture's summary, a card or a verdict with code).
# Every caller of a JSON answer goes through parse_model_json instead.
# ---------------------------------------------------------------------------

_FENCE_TAG_RE = re.compile(r"[A-Za-z0-9_+.-]{0,20}")


def split_outer_fence(text: str) -> Optional[tuple[str, str]]:
    """(language tag in lower case, inside) when ``text`` is one ``` fence around all of it.

    None otherwise (also for a one-line fence). Linear on purpose: no regular expression
    runs over the body, so an answer that degenerated into thousands of blank lines
    cannot stall the event loop.
    """
    if not isinstance(text, str):
        return None
    text = text.strip()
    if len(text) < 7 or not text.startswith("```") or not text.endswith("```"):
        return None
    line_end = text.find("\n")
    if line_end == -1 or line_end > len(text) - 4:
        return None
    tag = text[3:line_end].strip()
    if not _FENCE_TAG_RE.fullmatch(tag):
        return None
    return tag.lower(), text[line_end + 1:-3].strip()


def parse_model_json(raw: Any) -> Any:
    """The JSON value of a model answer (ValueError for a non-string).

    The whole answer is read as JSON first, then the inside of one fence around the
    whole answer, so code blocks inside string values survive. utils.parse_llm_json is
    only the fallback, for answers with prose around the JSON; as before, it repairs
    what it can and gives {} for text without JSON, which callers treat as unusable.
    """
    if not isinstance(raw, str):
        raise ValueError("Ответ модели должен быть строкой")
    text = raw.strip().lstrip("\ufeff").strip()
    candidates = [text]
    fenced = split_outer_fence(text)
    if fenced is not None:
        candidates.append(fenced[1])
    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
        except (ValueError, RecursionError):
            continue
        if isinstance(parsed, (dict, list)):
            return parsed
    return parse_llm_json(raw)


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
  "title": "Красивое, емкое и профессиональное название для этого материала (максимум 5-8 слов, отражающее его истинную суть. НЕ используй технические имена файлов или сырые интернет-ссылки, создай человеческое заглавие на основе темы, например: 'Механика свободного падения', 'Сетевые протоколы и модель OSI')",
  "subject": "Краткое название предмета (одно слово, например: Физика, Информатика, История)",
  "content": "Твой полный конспект в формате Markdown. ОБЯЗАТЕЛЬНО используй форматирование: выделяй **жирным** ключевые слова, используй маркированные списки (с дефисом -) для перечисления тезисов, и нумерованные списки для порядка действий. Разделяй абзацы пустой строкой. Используй ## заголовки. ВАЖНО: Если в тексте присутствуют любые математические, финансовые или физические формулы (например, v = s/t, p = m/V и др.), ОБЯЗАТЕЛЬНО выписывай их в контенте в виде красивых LaTeX формул (через $...$ или $$...$$) и подробно расписывай значение каждого символа!",
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
2. ОБЯЗАТЕЛЬНО выписывай все формулы в стандартном формате LaTeX (через $...$ или $$...$$) и расписывай значение каждого символа, чтобы наши интерактивные парсеры могли отобразить под ними виджеты-симуляторы!
3. Используй мнемонические приемы (например: "Как запомнить формулу...", ассоциативные правила, запоминалки).
4. Добавь блок "Частые ошибки на экзамене": 3 ошибки, на которых обычно ловят преподаватели.
5. Оформляй строго в Markdown с использованием жирного шрифта, коротких списков и блоков цитат для формул.

ОБЯЗАТЕЛЬНАЯ структура:
# Экспресс-шпаргалка
## Суть в 3 словах
(Крайне емкое резюме темы)

## Ключевые понятия и формулы
(Список критических определений или формул в формате LaTeX с расшифровкой)

## Как запомнить
(2-3 совета, как легко запомнить сложные части темы)

## Частые ошибки на экзамене
(3 самые частые ошибки или хитрых вопроса преподавателей)

Пиши на языке исходного текста."""


_PODCAST_VISUAL_GUIDE = """ИЛЛЮСТРАЦИИ (поле "visual"):
Иллюстрация показывается на экране, пока звучит реплика, и показывает ровно то, о чём в этой реплике говорится. Иллюстрация нужна не каждой реплике.
Допустимые значения "type" и форма объекта:
- "term" — термин и определение: {"type": "term", "term": "...", "definition": "..."}
- "steps" — шаги или этапы по порядку, от 2 до 6: {"type": "steps", "title": "...", "items": ["...", "..."]}
- "compare" — сравнение двух понятий, по 1–4 пункта с каждой стороны: {"type": "compare", "title": "...", "left": {"label": "...", "points": ["..."]}, "right": {"label": "...", "points": ["..."]} }
- "formula" — формула в LaTeX без знаков $ и расшифровка до 5 обозначений: {"type": "formula", "title": "...", "latex": "v = \\\\frac{s}{t}", "legend": [{"symbol": "v", "meaning": "..."}]}
- "chart" — столбчатая ("bar") или линейная ("line") диаграмма, от 2 до 8 значений, "value" — число: {"type": "chart", "title": "...", "kind": "bar", "unit": "%", "data": [{"label": "...", "value": 12}, {"label": "...", "value": 30}]}
- "timeline" — события с датами, от 2 до 6: {"type": "timeline", "title": "...", "events": [{"date": "...", "label": "..."}]}
- "diagram" — схема связей: от 2 до 7 узлов и от 1 до 10 стрелок; "from" и "to" — это id узлов из "nodes": {"type": "diagram", "title": "...", "nodes": [{"id": "a", "label": "..."}, {"id": "b", "label": "..."}], "edges": [{"from": "a", "to": "b", "label": "..."}]}
- "fact" — дословная цитата из материала: одно-два предложения, скопированные без изменений (лишнее можно опустить многоточием «…»): {"type": "fact", "title": "...", "text": "..."}
- "question" — вопрос для самопроверки и короткий ответ: {"type": "question", "question": "...", "answer": "..."}
- "scene" — заставка темы: {"type": "scene", "title": "...", "icon": "lightbulb", "caption": "..."}. Значение "icon" — только одно из: brain, book, atom, dna, globe, calculator, chart, clock, lightbulb, users, scale, cpu, leaf, flask, landmark, music, heart, map.

СТРОГИЕ ПРАВИЛА ДЛЯ ИЛЛЮСТРАЦИЙ:
1. "chart" — только если числа прямо названы в материале. Копируй числа и подписи точно: не округляй, не досчитывай, не придумывай. Нет чисел в материале — нет диаграммы.
2. "formula" — только если эта формула есть в материале. Запиши её в LaTeX; обратную косую черту в JSON экранируй (\\\\frac). Химические формулы и уравнения записывай через \\\\ce{...}: "latex": "\\\\ce{6CO2 + 6H2O ->[$h\\\\nu$] C6H12O6 + 6O2}".
3. "timeline" — только с датами, которые есть в материале.
4. "fact" — только дословная цитата: текст копируется из материала слово в слово. Пересказ — это не "fact"; для него подходят "term", "steps" или "compare".
5. Чаще всего используй "term", "steps", "compare", "diagram", "fact" и "question". Не ставь один и тот же тип больше двух раз подряд.
6. Иллюстрация совпадает по смыслу с текстом своей реплики: не забегай вперёд и не возвращайся к прошлой теме.
7. Коротко: заголовки, подписи и названия узлов — до 80 символов, пункты списков — до 120, определения, ответы, цитаты и подписи к сцене — до 280.
8. Без эмодзи, markdown и ссылок внутри полей. Язык иллюстраций — язык материала.
9. Каждая иллюстрация — о своём: один и тот же термин или заголовок не повторяется в разговоре дважды.
10. Иллюстрация первой реплики ([0]) — только "scene": "title" — короткое название темы (до 40 символов), "caption" — одна короткая фраза (до 90 символов) о том, о чём и зачем этот разговор. Подпись — не вопрос и не список вопросов."""


def build_podcast_prompt() -> str:
    return """Ты — автор коротких учебных разговоров. Преврати материал в живой диалог двух ведущих, который помогает понять и запомнить тему.

ВЕДУЩИЕ:
- Макс — любопытный слушатель. Задаёт короткие вопросы, переспрашивает непонятное, пересказывает своими словами.
- Софья — эксперт. Объясняет просто и по делу, приводит бытовые примеры и сравнения, не использует жаргон без пояснения.

ПРАВИЛА РАЗГОВОРА:
1. Всего от 10 до 16 реплик. Ведущие чередуются, первым говорит Макс.
2. Каждая реплика — не больше 45 слов. Живая разговорная речь, без канцелярита, без рекламных интонаций и без приветствий.
3. Первая реплика (Макс) сразу о теме: без приветствия, без обращения к Софье по имени и без пустых фраз вроде «звучит немного сложно» или «давай разберёмся». Она начинается с короткой зацепки — почему эта тема важна, по материалу и без новых фактов, — и заканчивается вопросом по теме.
4. Опирайся только на исходный материал. Не добавляй факты, числа, даты, имена и формулы, которых в нём нет. Бытовой пример допустим только как пояснение, а не как новый факт.
5. Иди по главным идеям материала по порядку: о чём тема, как это устроено, почему это важно, где часто ошибаются.
6. Последняя реплика — короткий итог: одна-две мысли, которые стоит запомнить.
7. Поле "speaker" — строго "Макс" или "Софья", даже если материал на другом языке. Текст реплик пиши на языке исходного материала.
8. У каждой реплики укажи "source_ids" — идентификаторы фрагментов источника ([S01], [S02] и т. д.), на которые она опирается.

""" + _PODCAST_VISUAL_GUIDE + """

КОЛИЧЕСТВО ИЛЛЮСТРАЦИЙ:
Добавь "visual" примерно к 40–60% реплик. У первой реплики "visual" обязателен: только "scene" с коротким названием темы и короткой подписью. У реплики без иллюстрации поля "visual" нет совсем.

ФОРМАТ ОТВЕТА:
Верни только JSON-объект без markdown-обёртки (никаких ```json) и без пояснений до или после него:
{
  "podcast": [
    {"speaker": "Макс", "text": "...", "source_ids": ["S01"], "visual": {"type": "scene", "title": "...", "icon": "book", "caption": "..."} },
    {"speaker": "Софья", "text": "...", "source_ids": ["S01"], "visual": {"type": "term", "term": "...", "definition": "..."} },
    {"speaker": "Макс", "text": "...", "source_ids": ["S02"]}
  ]
}

Пиши на языке исходного текста."""


def build_podcast_visuals_prompt() -> str:
    return """Ты готовишь иллюстрации к уже записанному учебному разговору двух ведущих, Макса и Софьи.
Реплики пронумерованы с нуля: [0], [1], [2] и так далее. Текст реплик менять нельзя, новые реплики добавлять нельзя — нужны только иллюстрации к существующим.

ЧТО СДЕЛАТЬ:
1. Подбери иллюстрации примерно для 40–60% реплик. Реплике [0] нужна иллюстрация типа "scene" с коротким названием темы и короткой подписью.
2. "index" — номер существующей реплики. Одна иллюстрация на реплику.
3. Опирайся на текст реплик и на материал, если он дан. Ничего не придумывай сверх них.

""" + _PODCAST_VISUAL_GUIDE + """

ФОРМАТ ОТВЕТА:
Верни только JSON-объект без markdown-обёртки (никаких ```json) и без пояснений до или после него:
{
  "visuals": [
    {"index": 0, "visual": {"type": "scene", "title": "...", "icon": "book", "caption": "..."} },
    {"index": 2, "visual": {"type": "steps", "title": "...", "items": ["...", "..."]} }
  ]
}

Пиши на языке реплик."""


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


def build_mistakes_practice_prompt(mistakes: list) -> str:
    mistakes_text = ""
    for i, m in enumerate(mistakes):
        mistakes_text += f"\nОшибка №{i+1}:\n- ID: {m.get('id', '')}\n- Вопрос: {m.get('question', '')}\n- Ответ студента: {m.get('student_answer', '')}\n- Правильный ответ: {m.get('correct_answer', '')}\n- Тема: {m.get('topic', '')}\n"
        
    return f"""Ты — эксперт по педагогике и созданию адаптивных тестов.
Твоя задача — проанализировать список ошибок студента из тестов и устных ответов и создать персональный проверочный тест «Работа над ошибками» из ровно 3 вопросов.

ОШИБКИ СТУДЕНТА:
{mistakes_text}

ТРЕБОВАНИЯ К ТЕСТУ:
1. Создай ровно 3 вопроса с выбором ответа (4 варианта: A, B, C, D) на русском языке.
2. Каждый вопрос должен проверять одну конкретную ошибку из списка. В поле "mistake_id" дословно скопируй ID этой ошибки из списка. Не придумывай ID и не оставляй поле пустым.
3. Вопросы не должны полностью копировать исходные вопросы. Перефразируй их, чтобы проверить понимание, а не только запоминание формулировки.
4. Варианты ответов должны быть правдоподобными.
5. Добавь пояснение к каждому вопросу: напомни, в чём состояла прошлая ошибка, и объясни, почему выбранный ответ верен.

ОБЯЗАТЕЛЬНО верни результат в формате JSON без каких-либо markdown-обёрток (никаких ```json):
{{
  "practice": [
    {{
      "id": 1,
      "mistake_id": "[точный ID одной исходной ошибки из списка]",
      "question": "[Новый вопрос на проверку концепции]",
      "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
      "correct": "[Правильная буква: A, B, C или D]",
      "explanation": "[Подробное объяснение с разбором прошлой ошибки]"
    }}
  ]
}}

Пиши на русском языке."""


def build_academic_scan_prompt() -> str:
    current_year = datetime.now().year
    current_date = datetime.now().strftime("%Y-%m-%d")
    return f"""Ты — дружелюбный и умный ИИ-ассистент (Smart Gradebook), который помогает распознавать школьные/университетские оценки по фото.
Пользователь передаёт тебе сообщения (описывающие контекст, например "Я Иванов Иван" или "Это оценки по математике"), а также фотографии электронного дневника, зачётки, обычного школьного дневника или большого классного журнала.
Твоя задача — быть максимально точным, как самый дотошный учитель, чтобы не потерять ни одной оценки и не прихватить чужих.

ОЖИДАЕМЫЕ СИТУАЦИИ И КРИТИЧЕСКИ ВАЖНЫЕ ПРАВИЛА:

1. ИЗОЛЯЦИЯ УЧЕНИКА В БОЛЬШИХ ТАБЛИЦАХ:
- Если на фото общий классный журнал с десятками фамилий, ИЩИ ТОЛЬКО строку пользователя, чье имя указано (даже если оно частичное, например "Денис" -> "Лабынцев Денис").
- Фото может быть снято сбоку, перевернуто или изогнуто. МЫСЛЕННО ПРОВЕДИ ЧЕТКУЮ ПРЯМУЮ ЛИНИЮ от найденной фамилии до конца страницы!
- Собирай оценки СТРОГО по этой линии. Не сбивайся на строки выше или ниже, даже если там много оценок, а у пользователя пусто.
- Если ты сомневаешься, принадлежит ли оценка пользователю, лучше её НЕ БРАТЬ.

2. НЕИЗВЕСТНЫЙ ИЛИ НЕСКОЛЬКО ПРЕДМЕТОВ:
- Если предмет не указан, но на фото дневника (по дням недели) четко видно "Математика: 5", "Физика: 4", то СОЗДАВАЙ разные предметы! Поле `subject` должно быть точным ("Математика", "Физика").
- Если это огромный разворот журнала по одному предмету (как на фото), но предмет нигде не написан и пользователь его не назвал — НЕ ВЫДУМЫВАЙ "Классный журнал", "Предмет 1". Просто верни пустой массив `grades: []` и в `message` спроси: "Привет! Я нашел твои оценки, но забыл спросить: по какому они предмету?".

3. СИСТЕМЫ ОЦЕНИВАНИЯ И КОНВЕРТАЦИЯ:
- РФ (5-балльная): оценки 2, 3, 4, 5. Если написано "5-", "4+", убирай плюсы и минусы, оставляй 5, 4.
- РБ/РК (10/12-балльная): если видишь цифры 6, 7, 8, 9, 10, 11, 12, извлекай их КАК ЕСТЬ, ни в коем случае не конвертируй в 5-балльную шкалу!
- Текстовые: "Отлично" / "Зачет" = 5 (или 10), "Хорошо" = 4 (или 8).

4. ПРОПУСКИ, ДАТЫ И МУСОР:
- Игнорируй: "н", "Н", "у", "б", "осв", "болен", "ДЗ", "КР", "-". Если в клетке "7/н", бери только "7".
- Не путай даты (12.03, 14.05) с оценками. Точка — это не оценка.
- Росписи учителей: иногда они похожи на цифру "2" или "3". Будь внимателен, не засчитывай роспись за оценку.
- Двойные оценки: "5/4", "5 4", "9/10" — это ДВЕ РАЗНЫЕ оценки. Записывай их как два отдельных объекта в массиве `grades`.
- Текущий год: {current_year}. Если год получения оценки не указан явно на фото, используй {current_year} год при формировании даты.

5. КОРРЕКТИРОВКА И УДАЛЕНИЕ (REPLACE_EXISTING):
- Если пользователь пишет "нет, мои оценки 5 4 5", "исправь", "забудь", "очисти", "отсканируй заново" или "вот заново" — ОБЯЗАТЕЛЬНО ставь `"replace_existing": true`. Это удалит старые ошибочные данные перед добавлением новых.
- Если пользователь просто говорит "добавь еще 5 по истории" или кидает новое фото без недовольства — ставь `false`.

6. ОБЩЕНИЕ И ОТЧЕТНОСТЬ (MESSAGE):
- В поле `message` обязательно перечисли ВСЕ найденные оценки через запятую, чтобы пользователь сразу мог проверить результат.
- Пример хорошего сообщения: "Привет! Я нашел 5 оценок по Химии: 5, 4, 5, 5, 4. Добавил их в твой дневник!"

7. НЕУВЕРЕННОСТЬ И ПРОВЕРКА:
- Если качество фото ужасное, таблица слишком кривая, или ты сильно сомневаешься, чью строку читаешь — НЕ сохраняй оценки наугад!
- В этом случае верни пустой массив `grades: []`, а в `message` спроси: "Я не совсем уверен, что правильно нашел твою строку. Твои оценки начинаются на [первые 2-3 цифры, которые ты предполагаешь]? Если да, подтверди, и я их добавлю, либо просто перечисли их вручную текстом".

ОБЯЗАТЕЛЬНО верни ТОЛЬКО JSON:
{{
  "message": "Привет! Я нашел 3 оценки по Физике: 5, 4, 5. Добавил их!",
  "replace_existing": false,
  "grades": [
    {{
      "subject": "Физика",
      "value": 5.0,
      "date": "{current_date}" 
    }}
  ]
}}
Пиши на русском языке, без markdown."""

# ---------------------------------------------------------------------------
# Provider layer: errors, configuration from the environment, shared clients,
# deadlines and the thinking budget. Callers only see BaseAgent.run(...), which
# returns non-empty model text or raises AIError with a fixed Russian detail.
# ---------------------------------------------------------------------------

AI_BUSY_DETAIL = "Сервис ИИ сейчас занят. Подождите минуту и попробуйте ещё раз."
AI_FAILED_DETAIL = "ИИ-сервис сейчас не ответил. Попробуйте ещё раз."
AI_TIMEOUT_DETAIL = "ИИ-сервис не ответил вовремя. Попробуйте ещё раз."
AI_NOT_CONFIGURED_DETAIL = "ИИ-сервис временно недоступен."


class AIError(HTTPException):
    """A provider failure as the browser may see it: status, short code, Russian detail.

    429 ai_busy | 502 ai_failed | 503 ai_unconfigured | 504 ai_timeout. The
    detail never carries provider text, request ids, URLs or env names.
    """

    def __init__(self, status_code: int, code: str = "ai_failed", detail: str = AI_FAILED_DETAIL):
        # Tolerate AIError(422, "<Russian detail>", "some_code"): codes are ASCII identifiers.
        if not code.isascii() and detail.isascii() and detail.replace("_", "").isalnum():
            code, detail = detail, code
        super().__init__(status_code=status_code, detail=detail)
        self.code = code

    @classmethod
    def busy(cls, detail: str = AI_BUSY_DETAIL) -> "AIError":
        return cls(429, "ai_busy", detail)

    @classmethod
    def failed(cls, detail: str = AI_FAILED_DETAIL) -> "AIError":
        return cls(502, "ai_failed", detail)

    @classmethod
    def timeout(cls, detail: str = AI_TIMEOUT_DETAIL) -> "AIError":
        return cls(504, "ai_timeout", detail)

    @classmethod
    def unconfigured(cls, detail: str = AI_NOT_CONFIGURED_DETAIL) -> "AIError":
        return cls(503, "ai_unconfigured", detail)


# Models checked on 2026-10-04 (orchestrator's web check): gemini-2.0-flash is gone; the 2.5
# models have conflicting retirement notices (Vertex AI lists 2026-10-20, the Gemini API page
# names no date), so gemini-3.1-flash-lite (GA) is second and takes over by itself when
# gemini-2.5-flash-lite answers not_found. Groq retired llama-3.3-70b-versatile on 2026-08-16.
DEFAULT_GEMINI_MODELS = "gemini-2.5-flash-lite,gemini-3.1-flash-lite,gemini-2.5-flash"
DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b"
DEFAULT_GROQ_FAST_MODEL = "openai/gpt-oss-20b"
DEFAULT_GROQ_VISION_MODEL = "llama-3.2-90b-vision-preview"

DEFAULT_TEMPERATURE = 0.3
DEFAULT_MAX_TOKENS = 8192
THINKING_ALLOWANCE = 2048
# Groq reasoning models (gpt-oss) spend their hidden reasoning from the same max_tokens as the
# answer: low effort plus this many extra tokens, so a 200-token JSON answer is not cut off.
GROQ_REASONING_ALLOWANCE = 1024
MIN_ATTEMPT_SECONDS = 0.05
MAX_FAST_MODELS = 6

ThinkingMode = Literal["off", "low"]


def _env_float(name: str, default: float) -> float:
    try:
        value = float(os.getenv(name, "").strip() or default)
    except ValueError:
        return default
    return value if value > 0 else default


def _model_list(raw: str) -> list[str]:
    models: list[str] = []
    for item in (raw or "").split(","):
        name = item.strip()
        if name and name not in models:
            models.append(name)
    return models


def gemini_keys() -> list[str]:
    return [key.strip() for key in os.getenv("GEMINI_API_KEY", "").split(",") if key.strip()]


def gemini_models_env() -> list[str]:
    """GEMINI_MODELS (the existing default is kept)."""
    return _model_list(os.getenv("GEMINI_MODELS", "")) or _model_list(DEFAULT_GEMINI_MODELS)


def gemini_fast_models_env() -> list[str]:
    """GEMINI_FAST_MODELS, empty when unset."""
    return _model_list(os.getenv("GEMINI_FAST_MODELS", ""))


def gemini_models(fast: bool = False) -> list[str]:
    if fast:
        return gemini_fast_models_env() or gemini_models_env()
    return gemini_models_env()


def groq_model() -> str:
    return os.getenv("GROQ_MODEL", "").strip() or DEFAULT_GROQ_MODEL


def groq_fast_model() -> str:
    return os.getenv("GROQ_FAST_MODEL", "").strip() or DEFAULT_GROQ_FAST_MODEL


def groq_vision_model() -> str:
    return os.getenv("GROQ_VISION_MODEL", "").strip() or DEFAULT_GROQ_VISION_MODEL


def ai_call_timeout_seconds() -> float:
    """Whole budget of one BaseAgent.run across models and providers."""
    return _env_float("AI_CALL_TIMEOUT_SECONDS", 90.0)


def gemini_request_timeout_seconds() -> float:
    return _env_float("GEMINI_REQUEST_TIMEOUT_SECONDS", 60.0)


def groq_request_timeout_seconds() -> float:
    return _env_float("GROQ_REQUEST_TIMEOUT_SECONDS", 60.0)


def model_skip_seconds() -> float:
    return _env_float("MODEL_SKIP_SECONDS", 600.0)


def cache_disabled() -> bool:
    return os.getenv("AI_CACHE_DISABLED", "").strip().lower() in ("1", "true", "yes", "on")


SAFETY_SETTINGS = [
    types.SafetySetting(category="HARM_CATEGORY_HARASSMENT", threshold="BLOCK_NONE"),
    types.SafetySetting(category="HARM_CATEGORY_HATE_SPEECH", threshold="BLOCK_NONE"),
    types.SafetySetting(category="HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold="BLOCK_NONE"),
    types.SafetySetting(category="HARM_CATEGORY_DANGEROUS_CONTENT", threshold="BLOCK_NONE"),
]


# --- shared clients: one per key, created on first use, reused afterwards -------------
_GENAI_CLIENTS: dict[str, Any] = {}
_GROQ_CLIENTS: dict[str, Any] = {}


def get_genai_client(key: str) -> Any:
    client = _GENAI_CLIENTS.get(key)
    if client is None:
        client = genai.Client(api_key=key)
        _GENAI_CLIENTS[key] = client
    return client


def get_groq_client(key: str) -> Any:
    client = _GROQ_CLIENTS.get(key)
    if client is None:
        client = AsyncGroq(api_key=key, max_retries=1)
        _GROQ_CLIENTS[key] = client
    return client


# --- models that answered not_found / permission are skipped for a while ---------------
_MODEL_SKIP: dict[tuple[str, str, str], float] = {}


def _skip_clock() -> float:
    """Clock of the skip list (tests replace it; asyncio keeps the real one)."""
    return time.monotonic()


def _key_fingerprint(key: str) -> str:
    return hashlib.sha256(key.encode("utf-8")).hexdigest()[:16]


def model_skipped(provider: str, key: str, model: str) -> bool:
    entry = (provider, _key_fingerprint(key), model)
    until = _MODEL_SKIP.get(entry)
    if until is None:
        return False
    if _skip_clock() >= until:
        _MODEL_SKIP.pop(entry, None)
        return False
    return True


def skip_model(provider: str, key: str, model: str) -> None:
    _MODEL_SKIP[(provider, _key_fingerprint(key), model)] = _skip_clock() + model_skip_seconds()


# --- error kinds (never provider text) --------------------------------------------------
ERROR_KINDS = ("not_found", "rate_limited", "permission", "invalid_argument", "timeout", "network", "empty", "other")


def _status_of(exc: BaseException) -> Optional[int]:
    for attr in ("status_code", "code", "status"):
        value = getattr(exc, attr, None)
        if isinstance(value, int) and not isinstance(value, bool):
            return value
    return None


def _api_key_invalid(exc: BaseException) -> bool:
    text = f"{getattr(exc, 'message', '') or ''} {getattr(exc, 'details', '') or ''}"
    return "API_KEY_INVALID" in text or "API key not valid" in text


def classify_error(exc: BaseException) -> str:
    """not_found | rate_limited | permission | invalid_argument | timeout | network | other.

    429 is recognised by the status code or RESOURCE_EXHAUSTED, never by a
    substring of the message.
    """
    if isinstance(exc, (asyncio.TimeoutError, TimeoutError, httpx.TimeoutException)):
        return "timeout"
    try:
        import groq as _groq

        if isinstance(exc, _groq.APITimeoutError):
            return "timeout"
        groq_connection_error: tuple = (_groq.APIConnectionError,)
    except Exception:  # pragma: no cover - groq is a hard dependency
        groq_connection_error = ()
    status = _status_of(exc)
    named = str(getattr(exc, "status", "") or "").upper()
    if status == 429 or named == "RESOURCE_EXHAUSTED":
        return "rate_limited"
    if status == 404 or named == "NOT_FOUND":
        return "not_found"
    if status in (401, 403) or named in ("PERMISSION_DENIED", "UNAUTHENTICATED"):
        return "permission"
    if status == 400 or named in ("INVALID_ARGUMENT", "FAILED_PRECONDITION"):
        return "permission" if _api_key_invalid(exc) else "invalid_argument"
    if status in (408, 504) or named == "DEADLINE_EXCEEDED":
        return "timeout"
    if isinstance(exc, (httpx.TransportError, ConnectionError) + groq_connection_error):
        return "network"
    return "other"


def _mentions_thinking(exc: BaseException) -> bool:
    text = f"{getattr(exc, 'message', '') or ''} {exc}".lower()
    return "thinking" in text


def _scrub(text: str, secrets: list[str]) -> str:
    for secret in secrets:
        if secret:
            text = text.replace(secret, "***")
    return text


def _log_failure(provider: str, key_index: Optional[int], model: str, kind: str, exc: BaseException, secrets: list[str]) -> None:
    where = f"key#{key_index} " if key_index is not None else ""
    detail = _scrub(str(exc), secrets)[:200].replace("\n", " ")
    print(f"AI {provider} call failed: {where}model={model} kind={kind} {type(exc).__name__}: {detail}")


# --- thinking budget ----------------------------------------------------------------------
_THINKING_FIELDS = set(getattr(getattr(types, "ThinkingConfig", None), "model_fields", {}) or {})
_HAS_THINKING_BUDGET = "thinking_budget" in _THINKING_FIELDS
_HAS_THINKING_LEVEL = "thinking_level" in _THINKING_FIELDS and hasattr(types, "ThinkingLevel")


@dataclass(frozen=True)
class ThinkingPlan:
    config: Any          # types.ThinkingConfig or None (provider default)
    allowance: int       # added to max_tokens for max_output_tokens
    label: str           # "off" | "low" | "default"


def _model_family(model: str) -> str:
    name = model.lower().rsplit("/", 1)[-1]
    if name.startswith("gemini-3"):
        return "gemini3"
    if name.startswith("gemini-2.5-pro"):
        return "pro25"
    if name.startswith("gemini-2.5") or name in ("gemini-flash-latest", "gemini-flash-lite-latest"):
        return "flash25"
    if name.startswith(("gemini-2.0", "gemini-1.", "gemma")):
        return "no_thinking"
    return "other"


def thinking_plan(model: str, mode: Optional[str]) -> ThinkingPlan:
    """The thinking config the app sends to ``model`` for ``mode`` (None = provider default).

    'off': gemini-2.5 flash/flash-lite budget 0, gemini-2.5-pro 128, gemini-3* level MINIMAL;
    'low': budget 512 / level LOW. A call that cannot lower thinking keeps the provider
    default and gets THINKING_ALLOWANCE extra output tokens, so thinking does not eat the answer.
    Models that never think (gemini-2.0, 1.x, gemma) get neither a config nor extra tokens:
    gemini-2.0-flash caps the output at 8192 tokens.
    gemini-3* without a mode gets level LOW, not the provider default: Google documents
    «high» as the Gemini 3 default, which would make the fallback model several times slower
    and dearer than the gemini-2.5-flash-lite it replaces.
    """
    family = _model_family(model)
    if family == "no_thinking":
        return ThinkingPlan(None, 0, "none")
    if family == "gemini3" and _HAS_THINKING_LEVEL:
        level = types.ThinkingLevel.MINIMAL if mode == "off" else types.ThinkingLevel.LOW
        return ThinkingPlan(types.ThinkingConfig(thinking_level=level), THINKING_ALLOWANCE, "off" if mode == "off" else "low")
    if mode not in ("off", "low"):
        return ThinkingPlan(None, THINKING_ALLOWANCE, "default")
    if family in ("flash25", "pro25") and _HAS_THINKING_BUDGET:
        if mode == "off":
            budget = 128 if family == "pro25" else 0
        else:
            budget = 512
        return ThinkingPlan(types.ThinkingConfig(thinking_budget=budget), budget, mode)
    return ThinkingPlan(None, THINKING_ALLOWANCE, "default")


def _finish_reason_name(value: Any) -> Optional[str]:
    if value is None:
        return None
    name = getattr(value, "name", None)
    if isinstance(name, str) and name:
        return name
    text = str(value)
    return text.rsplit(".", 1)[-1] if text else None


def _gemini_response_text(response: Any) -> str:
    try:
        text = getattr(response, "text", None)
    except Exception:
        text = None
    return text if isinstance(text, str) else ""


def _gemini_finish_reason(response: Any) -> Optional[str]:
    candidates = getattr(response, "candidates", None) or []
    if candidates:
        return _finish_reason_name(getattr(candidates[0], "finish_reason", None))
    feedback = getattr(response, "prompt_feedback", None)
    if feedback is not None and getattr(feedback, "block_reason", None) is not None:
        return "BLOCKED"
    return None


def _is_max_tokens(finish_reason: Optional[str]) -> bool:
    return (finish_reason or "").upper() in ("MAX_TOKENS", "LENGTH")


async def _gemini_generate(
    client: Any,
    model: str,
    contents: Any,
    *,
    temperature: float,
    max_output_tokens: int,
    json_mode: bool,
    thinking_config: Any,
    timeout: float,
) -> tuple[str, Optional[str]]:
    config_args: dict[str, Any] = {
        "temperature": temperature,
        "max_output_tokens": max_output_tokens,
        "response_mime_type": "application/json" if json_mode else "text/plain",
        "safety_settings": SAFETY_SETTINGS,
        "http_options": types.HttpOptions(timeout=max(1, int(timeout * 1000))),
    }
    if thinking_config is not None:
        config_args["thinking_config"] = thinking_config
    response = await asyncio.wait_for(
        client.aio.models.generate_content(
            model=model,
            contents=contents,
            config=types.GenerateContentConfig(**config_args),
        ),
        timeout=timeout,
    )
    return _gemini_response_text(response), _gemini_finish_reason(response)


def groq_reasoning_model(model: str) -> bool:
    """openai/gpt-oss-*: a reasoning model whose hidden reasoning shares max_tokens with the answer."""
    return (model or "").strip().lower().rsplit("/", 1)[-1].startswith("gpt-oss")


async def _groq_generate(
    client: Any,
    model: str,
    messages: list[dict[str, Any]],
    *,
    temperature: float,
    max_tokens: int,
    json_mode: bool,
    timeout: float,
) -> tuple[str, Optional[str]]:
    reasoning = groq_reasoning_model(model)
    kwargs: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens + (GROQ_REASONING_ALLOWANCE if reasoning else 0),
        "timeout": timeout,
    }
    if reasoning:
        # Low effort and no reasoning text in the answer (sent as body fields, which every SDK
        # version passes through). No response_format: Groq's JSON mode validates the raw
        # generation of a reasoning model and refuses good answers (400 json_validate_failed);
        # the prompt asks for JSON and parse_model_json reads it.
        kwargs["extra_body"] = {"reasoning_effort": "low", "include_reasoning": False}
    elif json_mode:
        kwargs["response_format"] = {"type": "json_object"}
    response = await asyncio.wait_for(client.chat.completions.create(**kwargs), timeout=timeout)
    choices = getattr(response, "choices", None) or []
    if not choices:
        return "", None
    message = getattr(choices[0], "message", None)
    content = getattr(message, "content", None) if message is not None else None
    return (content if isinstance(content, str) else ""), _finish_reason_name(getattr(choices[0], "finish_reason", None))


def _groq_system_prompt(system_prompt: str, user_text: str, json_mode: bool) -> str:
    # Groq's JSON mode refuses a request whose messages never mention JSON.
    if json_mode and "json" not in f"{system_prompt}\n{user_text}".lower():
        return system_prompt + "\n\nОтвет — только JSON-объект."
    return system_prompt


@dataclass
class _Outcome:
    rate_limited: bool = False
    timed_out: bool = False
    attempts: int = 0
    last_kind: Optional[str] = None
    # The provider and model of the latest attempt (the call log names them for a failure too).
    provider: Optional[str] = None
    model: Optional[str] = None

    def note(self, kind: str) -> None:
        self.last_kind = kind
        if kind == "rate_limited":
            self.rate_limited = True
        elif kind == "timeout":
            self.timed_out = True

    def error(self, configured: bool) -> AIError:
        if not configured:
            return AIError.unconfigured()
        if self.rate_limited:
            return AIError.busy()
        if self.timed_out:
            return AIError.timeout()
        return AIError.failed()


def _fill_meta(meta: Optional[dict], **values: Any) -> None:
    if isinstance(meta, dict):
        meta.update(values)


# --- which model answered: the last real answer of this process and call observers ----------
# GET /api/health shows last_answer(); quota.py observes every call to log it for the user.
_LAST_ANSWER: dict[str, Any] = {}
_CALL_OBSERVERS: list = []


def last_answer() -> dict[str, Any]:
    """{provider, model, at} of the latest real (not cached) answer in this process; {} before one."""
    return dict(_LAST_ANSWER)


def add_call_observer(observer) -> None:
    """observer(record) after every real model call of BaseAgent: provider, model, ok, ms.

    A cache hit is not a call. A failed call names the provider and model of its last attempt.
    Observers run synchronously and must not block; an exception in one is logged and ignored.
    """
    if observer not in _CALL_OBSERVERS:
        _CALL_OBSERVERS.append(observer)


def _record_call(provider: Optional[str], model: Optional[str], ok: bool, ms: int) -> None:
    if ok and provider and model:
        at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
        _LAST_ANSWER.update(provider=provider, model=model, at=at)
    record = {"provider": provider, "model": model, "ok": bool(ok), "ms": max(0, int(ms))}
    for observer in list(_CALL_OBSERVERS):
        try:
            observer(dict(record))
        except Exception as exc:  # the call log never breaks an answer
            print(f"AI call observer failed: {type(exc).__name__}")


# --- diagnostics probes: direct calls that ignore the skip list and the cache -------------
async def probe_gemini_call(
    key: str,
    model: str,
    prompt: str,
    *,
    max_tokens: int = 200,
    json_mode: bool = True,
    thinking: Optional[str] = None,
    temperature: float = 0.0,
    timeout: float = 12.0,
) -> dict[str, Any]:
    """One Gemini call with the app's thinking config; error kinds only."""
    plan = thinking_plan(model, thinking)
    started = time.monotonic()
    label = plan.label
    try:
        client = get_genai_client(key)
        try:
            text, finish = await _gemini_generate(
                client, model, prompt, temperature=temperature, max_output_tokens=max_tokens + plan.allowance,
                json_mode=json_mode, thinking_config=plan.config, timeout=timeout,
            )
        except Exception as exc:
            if plan.config is None or classify_error(exc) != "invalid_argument" or not _mentions_thinking(exc):
                raise
            label = "default"
            remaining = max(0.5, timeout - (time.monotonic() - started))
            text, finish = await _gemini_generate(
                client, model, prompt, temperature=temperature, max_output_tokens=max_tokens + THINKING_ALLOWANCE,
                json_mode=json_mode, thinking_config=None, timeout=remaining,
            )
    except Exception as exc:
        return {"ok": False, "ms": int((time.monotonic() - started) * 1000), "finish_reason": None,
                "error": classify_error(exc), "thinking": label}
    ok = bool(text and text.strip())
    return {"ok": ok, "ms": int((time.monotonic() - started) * 1000), "finish_reason": finish,
            "error": None if ok else "empty", "thinking": label}


async def probe_gemini_list(key: str, timeout: float = 12.0) -> tuple[list[str], Optional[str]]:
    """Model names (without 'models/') that support generateContent, or an error kind."""

    async def collect() -> list[str]:
        client = get_genai_client(key)
        names: list[str] = []
        pager = await client.aio.models.list(config={"page_size": 100})
        async for model in pager:
            actions = getattr(model, "supported_actions", None) or []
            if actions and "generateContent" not in actions:
                continue
            name = str(getattr(model, "name", "") or "").rsplit("/", 1)[-1]
            if name and name not in names:
                names.append(name)
            if len(names) >= 200:
                break
        return names

    try:
        return await asyncio.wait_for(collect(), timeout=timeout), None
    except Exception as exc:
        return [], classify_error(exc)


async def probe_groq_call(
    key: str,
    model: str,
    prompt: str,
    *,
    max_tokens: int = 200,
    json_mode: bool = True,
    timeout: float = 12.0,
) -> dict[str, Any]:
    started = time.monotonic()
    try:
        client = get_groq_client(key)
        text, finish = await _groq_generate(
            client, model,
            [{"role": "system", "content": _groq_system_prompt(prompt, "", json_mode)},
             {"role": "user", "content": "Проверка связи."}],
            temperature=0.0, max_tokens=max_tokens, json_mode=json_mode, timeout=timeout,
        )
    except Exception as exc:
        return {"ok": False, "ms": int((time.monotonic() - started) * 1000), "finish_reason": None,
                "error": classify_error(exc)}
    ok = bool(text and text.strip())
    return {"ok": ok, "ms": int((time.monotonic() - started) * 1000), "finish_reason": finish,
            "error": None if ok else "empty"}


class BaseAgent:
    # A bounded process-local cache prevents repeated demo requests from
    # burning provider quota without allowing an unbounded memory leak.
    # Values are the raw model text (BaseAgent.forget evicts by value).
    _run_cache = OrderedDict()
    _cache_info: dict = {}
    _max_cache_entries = max(16, int(os.getenv("AI_CACHE_ENTRIES", "128")))

    @classmethod
    def _cache_get(cls, key):
        value = cls._run_cache.get(key)
        if value is not None:
            cls._run_cache.move_to_end(key)
        return value

    @classmethod
    def _cache_set(cls, key, value, info: Optional[dict] = None):
        cls._run_cache[key] = value
        cls._run_cache.move_to_end(key)
        if info is not None:
            cls._cache_info[key] = info
        while len(cls._run_cache) > cls._max_cache_entries:
            old_key, _ = cls._run_cache.popitem(last=False)
            cls._cache_info.pop(old_key, None)

    @classmethod
    def forget(cls, raw: str) -> None:
        """Evict every cached answer equal to ``raw`` so a retry asks the model again."""
        if raw is None:
            return
        for key in [key for key, value in list(cls._run_cache.items()) if value == raw]:
            cls._run_cache.pop(key, None)
            cls._cache_info.pop(key, None)

    def __init__(self, api_key: str = "", model: Optional[str] = None):
        self.groq_api_key = (api_key or "").strip()
        # An explicit model overrides GROQ_MODEL for this agent (normal calls only).
        self.model = model
        self.gemini_keys = gemini_keys()
        self.groq_client = get_groq_client(self.groq_api_key) if self.groq_api_key else None
        self.safety_settings = SAFETY_SETTINGS

    async def run(
        self,
        system_prompt: str,
        user_text: str,
        *,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        json_mode: Optional[bool] = None,
        timeout: Optional[float] = None,
        fast: bool = False,
        thinking: Optional[ThinkingMode] = None,
        use_cache: bool = True,
        meta: Optional[dict] = None,
    ) -> str:
        """Model text for the prompt, or AIError (429 busy, 502 failed, 503 unconfigured, 504 timeout).

        Gemini keys and models are tried first (GEMINI_MODELS, or GEMINI_FAST_MODELS when
        ``fast``), then Groq (GROQ_MODEL / GROQ_FAST_MODEL). ``timeout`` is the budget for the
        whole call across models and providers (AI_CALL_TIMEOUT_SECONDS by default).
        """
        keys = gemini_keys()
        max_chars = 300000 if keys else 80000
        truncated = user_text[:max_chars]
        if len(user_text) > max_chars:
            truncated += f"\n\n[Текст сокращен с {len(user_text)} до {max_chars} символов]"
        return await self._generate(
            system_prompt, truncated, keys=keys, images=None, mime_type=None,
            temperature=temperature, max_tokens=max_tokens, json_mode=json_mode, timeout=timeout,
            fast=fast, thinking=thinking, use_cache=use_cache, meta=meta,
        )

    async def run_with_images(
        self,
        system_prompt: str,
        user_text: str,
        images_base64: list[str],
        mime_type: str = "image/jpeg",
        *,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        json_mode: Optional[bool] = None,
        timeout: Optional[float] = None,
        use_cache: bool = True,
        meta: Optional[dict] = None,
    ) -> str:
        """Same contract as run(); Gemini gets the images inline, Groq uses GROQ_VISION_MODEL."""
        return await self._generate(
            system_prompt, user_text, keys=gemini_keys(), images=list(images_base64 or []), mime_type=mime_type,
            temperature=temperature, max_tokens=max_tokens, json_mode=json_mode, timeout=timeout,
            fast=False, thinking=None, use_cache=use_cache, meta=meta,
        )

    async def _generate(
        self,
        system_prompt: str,
        text: str,
        *,
        keys: list[str],
        images: Optional[list[str]],
        mime_type: Optional[str],
        temperature: Optional[float],
        max_tokens: Optional[int],
        json_mode: Optional[bool],
        timeout: Optional[float],
        fast: bool,
        thinking: Optional[str],
        use_cache: bool,
        meta: Optional[dict],
    ) -> str:
        loop = asyncio.get_running_loop()
        started = loop.time()
        temp = DEFAULT_TEMPERATURE if temperature is None else float(temperature)
        limit = DEFAULT_MAX_TOKENS if max_tokens is None else max(1, int(max_tokens))
        json_flag = ("JSON" in system_prompt or "json" in system_prompt) if json_mode is None else bool(json_mode)
        if thinking not in (None, "off", "low"):
            thinking = None
        mode = thinking if thinking is not None else ("off" if fast else None)
        thinking_label = mode or "default"

        image_digest = None
        if images is not None:
            image_digest = hashlib.sha256("\n".join(images).encode("utf-8")).hexdigest() + f":{mime_type}"
        cache_key = (system_prompt, text, temp, limit, json_flag, bool(fast), mode, image_digest)
        caching = bool(use_cache) and not cache_disabled()

        def elapsed_ms() -> int:
            return int((loop.time() - started) * 1000)

        if caching:
            cached = self._cache_get(cache_key)
            if cached is not None:
                info = self._cache_info.get(cache_key) or {}
                print("DEBUG: [Cache Hit] Возвращаем кэшированный ответ для ИИ-агента.")
                _fill_meta(meta, provider=info.get("provider"), model=info.get("model"), ms=elapsed_ms(),
                           cached=True, thinking=info.get("thinking", thinking_label),
                           finish_reason=info.get("finish_reason"))
                return cached

        budget = ai_call_timeout_seconds() if timeout is None else max(0.0, float(timeout))
        deadline = started + budget
        outcome = _Outcome()
        secrets = list(keys) + ([self.groq_api_key] if self.groq_api_key else [])

        def remaining() -> float:
            return deadline - loop.time()

        result: Optional[tuple[str, str, str, str, Optional[str]]] = None  # text, provider, model, thinking, finish

        if keys:
            full_prompt = f"{system_prompt}\n\nЗАПРОС:\n{text}"
            if images is not None:
                try:
                    contents: Any = [full_prompt] + [
                        types.Part.from_bytes(data=base64.b64decode(img), mime_type=mime_type or "image/jpeg")
                        for img in images
                    ]
                except Exception as exc:
                    print(f"AI image payload rejected: {type(exc).__name__}")
                    _fill_meta(meta, provider=None, model=None, ms=elapsed_ms(), cached=False,
                               thinking=thinking_label, finish_reason=None, error="invalid_argument")
                    raise AIError.failed()
            else:
                contents = full_prompt
            order = list(enumerate(keys))
            random.shuffle(order)
            models = gemini_models(fast)
            for key_index, key in order:
                for model in models:
                    if model_skipped("gemini", key, model):
                        continue
                    if remaining() <= MIN_ATTEMPT_SECONDS:
                        outcome.note("timeout")
                        break
                    found = await self._gemini_model_attempts(
                        key, key_index, model, contents, temp, limit, json_flag, mode, remaining, outcome, secrets,
                    )
                    if found is not None:
                        result = (found[0], "gemini", model, found[2], found[1])
                        break
                if result is not None or remaining() <= MIN_ATTEMPT_SECONDS:
                    break

        if result is None and self.groq_api_key:
            if images is not None:
                model = groq_vision_model()
            elif fast:
                model = groq_fast_model()
            else:
                model = self.model or groq_model()
            if model_skipped("groq", self.groq_api_key, model):
                pass
            elif remaining() <= MIN_ATTEMPT_SECONDS:
                outcome.note("timeout")
            else:
                if images is not None:
                    user_content: Any = [{"type": "text", "text": text}] + [
                        {"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{img}"}} for img in images
                    ]
                else:
                    user_content = text
                messages = [
                    {"role": "system", "content": _groq_system_prompt(system_prompt, text, json_flag)},
                    {"role": "user", "content": user_content},
                ]
                outcome.attempts += 1
                outcome.provider, outcome.model = "groq", model
                try:
                    answer, finish = await _groq_generate(
                        get_groq_client(self.groq_api_key), model, messages,
                        temperature=temp, max_tokens=limit, json_mode=json_flag,
                        timeout=min(remaining(), groq_request_timeout_seconds()),
                    )
                except Exception as exc:
                    kind = classify_error(exc)
                    outcome.note(kind)
                    _log_failure("groq", None, model, kind, exc, secrets)
                    if kind in ("not_found", "permission"):
                        skip_model("groq", self.groq_api_key, model)
                else:
                    if answer and answer.strip():
                        result = (answer, "groq", model, "default", finish)
                    else:
                        outcome.note("empty")
                        print(f"AI groq call returned empty text: model={model} finish_reason={finish}")

        if result is None:
            error = outcome.error(configured=bool(keys or self.groq_api_key))
            ms = elapsed_ms()
            _fill_meta(meta, provider=None, model=None, ms=ms, cached=False, thinking=thinking_label,
                       finish_reason=None, error=outcome.last_kind or error.code)
            if outcome.attempts:
                _record_call(outcome.provider, outcome.model, False, ms)
            raise error

        answer, provider, model, used_thinking, finish = result
        if caching:
            self._cache_set(cache_key, answer, {"provider": provider, "model": model, "thinking": used_thinking,
                                                "finish_reason": finish})
        ms = elapsed_ms()
        _fill_meta(meta, provider=provider, model=model, ms=ms, cached=False, thinking=used_thinking,
                   finish_reason=finish)
        _record_call(provider, model, True, ms)
        return answer

    async def _gemini_model_attempts(
        self,
        key: str,
        key_index: int,
        model: str,
        contents: Any,
        temperature: float,
        max_tokens: int,
        json_mode: bool,
        mode: Optional[str],
        remaining,
        outcome: _Outcome,
        secrets: list[str],
    ) -> Optional[tuple[str, Optional[str], str]]:
        """Up to three calls of one model: the planned config, then once without a rejected
        thinking config, or once with thinking off after an empty MAX_TOKENS answer."""
        plan = thinking_plan(model, mode)
        attempts: list[tuple[Any, int, str]] = [(plan.config, max_tokens + plan.allowance, plan.label)]
        retried_thinking = False
        retried_length = False
        index = 0
        while index < len(attempts):
            config, output_tokens, label = attempts[index]
            index += 1
            left = remaining()
            if left <= MIN_ATTEMPT_SECONDS:
                outcome.note("timeout")
                return None
            outcome.attempts += 1
            outcome.provider, outcome.model = "gemini", model
            try:
                client = get_genai_client(key)
                answer, finish = await _gemini_generate(
                    client, model, contents, temperature=temperature, max_output_tokens=output_tokens,
                    json_mode=json_mode, thinking_config=config,
                    timeout=min(left, gemini_request_timeout_seconds()),
                )
            except Exception as exc:
                kind = classify_error(exc)
                outcome.note(kind)
                _log_failure("gemini", key_index, model, kind, exc, secrets)
                if kind in ("not_found", "permission"):
                    skip_model("gemini", key, model)
                    return None
                if kind == "invalid_argument" and config is not None and not retried_thinking and _mentions_thinking(exc):
                    retried_thinking = True
                    attempts.append((None, max_tokens + THINKING_ALLOWANCE, "default"))
                    continue
                return None
            if answer and answer.strip():
                return answer, finish, label
            outcome.note("empty")
            print(f"AI gemini call returned empty text: key#{key_index} model={model} finish_reason={finish}")
            if _is_max_tokens(finish) and not retried_length:
                retried_length = True
                off = thinking_plan(model, "off")
                if off.label == "none":
                    return None  # a model without thinking has no room to gain
                if retried_thinking:
                    # This model rejected the thinking config: only more room is left to try.
                    attempts.append((None, max_tokens + 2 * THINKING_ALLOWANCE, "default"))
                else:
                    attempts.append((off.config, max_tokens + off.allowance + THINKING_ALLOWANCE, off.label))
                continue
            return None
        return None
