import asyncio
import base64
import contextlib
import contextvars
import email.utils
import hashlib
import json
import math
import os
import random
import re
import time
from collections import OrderedDict, deque
from dataclasses import dataclass
from datetime import date, datetime, time as dtime, timedelta, timezone
from typing import Any, Literal, Optional

import httpx
from fastapi import HTTPException
from google import genai
from google.genai import types
from groq import AsyncGroq

from utils import latex_safe_candidates, parse_llm_json


# ---------------------------------------------------------------------------
# Reading a model's answer. utils.parse_llm_json cuts the text at its first ```
# fence, which destroys a valid JSON answer whose string values hold a Markdown
# code block (a programming lecture's summary, a card or a verdict with code).
# Every caller of a JSON answer goes through parse_model_json instead.
# LaTeX the model wrote with one backslash keeps it («$\text{COUNT}$» would be
# TAB + «ext{COUNT}» after json.loads): utils.repair_latex_escapes.
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
    whole answer, so code blocks inside string values survive. Each is read with the
    backslashes of LaTeX commands kept first (utils.repair_latex_escapes), then as it
    is. utils.parse_llm_json is only the fallback, for answers with prose around the
    JSON; as before, it repairs what it can and gives {} for text without JSON, which
    callers treat as unusable.
    """
    if not isinstance(raw, str):
        raise ValueError("Ответ модели должен быть строкой")
    text = raw.strip().lstrip("\ufeff").strip()
    candidates = [text]
    fenced = split_outer_fence(text)
    if fenced is not None:
        candidates.append(fenced[1])
    for candidate in candidates:
        for attempt in latex_safe_candidates(candidate):
            try:
                parsed = json.loads(attempt)
            except (ValueError, RecursionError):
                continue
            if isinstance(parsed, (dict, list)):
                return parsed
    return parse_llm_json(raw)


# Formulas, dates and numbers in a lecture material come from the lecture only. The Выжимка prompt
# used to demand «все формулы … виджеты-симуляторы», and a biology lecture got «Формула энергетического
# обмена (условно для симулятора)» (live QA 2026-10-11); the конспект prompt pushed «v = s/t, p = m/V».
# A material without formulas in the lecture has no formulas.
SOURCE_FACTS_RULE = (
    "Формулы, даты, числа и имена бери только из текста лекции и переписывай их точно. Не придумывай их и не "
    "выводи новые, не пиши оговорок вроде «условно», «для наглядности» или «для симулятора». Формулу из лекции "
    "записывай в LaTeX (через $...$ или $$...$$) и поясняй обозначения. Если в лекции нет формул, их нет и здесь."
)

# The text of a recording is speech recognition: it misspells names and terms («Вт метр» for «вольтметр», «закон
# ОМО»), and the конспект of the live recheck of release 44.1 told the reader so: «вольтметр (в тексте упомянут как
# Вт метр)» (2026-10-11). Every material prompt of a recorded lecture says what its text is (source_rules): the analysis
# and, since the recheck of release 44.2, the materials made after it on the lecture page too, which pass
# summary_json.recognized. mixed_script.check strips such a remark when it comes all the same.
RECORDING_RULE = (
    "\n\nТЕКСТ ИЗ ЗАПИСИ:\nТекст лекции получен распознаванием речи из записи, поэтому в нём могут быть ошибки в "
    "именах, терминах и отдельных словах. Если уверен, какое слово имелось в виду, пиши его правильно — это и значит "
    "передавать имена и термины точно. Никогда не упоминай текст, запись или её распознавание и не пиши пояснений "
    "вроде «в тексте упомянут как…»: пиши так, будто сам слушал лекцию."
)

# The tests of the live recheck of release 44.2 asked «…от его геометрических размеров согласно тексту?» (a recording)
# and «…клеток согласно тексту?» (the biology PDF): the student reads a lecture, not «текст». Every lecture material's
# prompt says so, whatever the source; mixed_script rewrites the fixed phrases that come all the same. Release 44.3's
# rule gave «в лекции», «согласно лекции» as the words to use, and the recheck of 44.3 found the lecture credited in
# nearly every explanation of the test (12 and 17 times in two lectures, none in 44.2): the rule names no phrase now and
# asks for the facts themselves; mixed_script drops a «Согласно лекции, …» at the start of a sentence all the same.
LECTURE_WORD_RULE = (
    "\n\nИСТОЧНИК — ЛЕКЦИЯ:\nЕсли ссылка на источник действительно нужна, называй его лекцией — никогда не текстом. "
    "Не начинай ответы, пояснения и карточки со ссылки на лекцию: сразу пиши сами факты."
)


def source_rules(recording: bool = False) -> str:
    """What the prompt of a lecture material says about its source: a lecture; for a recording, speech recognition too.

    Every place that builds such a prompt adds it: the analysis sections (coordinator.build_prompts, also for
    /api/analyze/section), /api/quick-prep and /api/podcast/generate and /visuals. ``recording``: the lecture's text came
    from a recording (summary_json.recognized == "recording", the stream's text_extracted.transcribed)."""
    return LECTURE_WORD_RULE + (RECORDING_RULE if recording else "")


# The medium and detailed конспект: «Ключевые тезисы», then the lecture's sections in its order, each retold
# shorter in the student's words, then «Выводы» (SummaryView shows every «## » heading of content as a part and
# terms as «Термины»). «3-4 абзаца» merged the 8 sections of the QA biology PDF into one; release 44 asked to keep
# them, and the medium notes of that PDF became the lecture itself — 322 of its words in order, no «Ключевые
# тезисы», no «Выводы» (live recheck 2026-10-11).
NOTES_PLANS = {
    "medium": {
        "points": "3–5",
        "retell": "примерно втрое короче самого раздела: главная мысль, определения и числа из лекции — коротким "
                  "списком или 1–3 предложениями",
        "conclusions": "2–3 предложения",
        "size": "Весь конспект — примерно треть объёма лекции.",
        "terms": "главные термины лекции",
        "advice": "",
    },
    "detailed": {
        "points": "5–7",
        "retell": "примерно вдвое короче самого раздела: главные мысли, определения, примеры и числа из лекции — "
                  "абзацем и списком",
        "conclusions": "3–5 предложений",
        "size": "Весь конспект — не больше половины объёма лекции.",
        "terms": "все термины лекции",
        "advice": "\n## Рекомендации по изучению\n2–4 совета: что повторить и на что обратить внимание — только по "
                  "материалу лекции.",
    },
}


def _notes_plan(detail: str) -> str:
    plan = NOTES_PLANS[detail]
    return f"""
Структура content — разделы «## » строго в этом порядке:
## Ключевые тезисы
{plan["points"]} пунктов: главные мысли всей лекции, каждая одним предложением.
## <название раздела лекции>
Такой заголовок — у каждого раздела лекции (её заголовков и нумерованных пунктов), с его названием, в том же порядке. Не сливай разные разделы в один и не пропускай их. Если явных разделов нет, раздели лекцию на темы в порядке изложения.
Под заголовком — пересказ раздела своими словами, {plan["retell"]}.
## Выводы
{plan["conclusions"]}: что следует из лекции в целом.{plan["advice"]}

Конспект — это пересказ, а не копия лекции: не переписывай предложения лекции подряд и не копируй её абзацы. Пиши просто и ясно, как записал бы для себя внимательный студент. {plan["size"]} Точно, как в лекции, передавай только определения, формулы, даты, числа и имена. Название лекции — только в поле title. Термины с определениями ({plan["terms"]}) — в поле terms, отдельный раздел «Термины» в content не нужен.
"""


def build_summarizer_prompt(detail: str = "medium") -> str:
    if detail == "brief":
        body, plan = "краткий конспект: заголовок + 3-5 ключевых тезисов + 1 абзац выводов", ""
    else:
        detail = detail if detail in NOTES_PLANS else "medium"
        body = ("подробный" if detail == "detailed" else "средний") + " конспект"
        plan = _notes_plan(detail)
    return f"""Ты — опытный преподаватель, который создаёт структурированные конспекты лекций.
Проанализируй предоставленный текст и создай {body}.
{plan}
{SOURCE_FACTS_RULE}

ОБЯЗАТЕЛЬНО верни ответ в формате JSON без markdown-обёртки (никаких ```json):
{{
  "title": "Красивое, емкое и профессиональное название для этого материала (максимум 5-8 слов, отражающее его истинную суть. НЕ используй технические имена файлов или сырые интернет-ссылки, создай человеческое заглавие на основе темы, например: 'Механика свободного падения', 'Сетевые протоколы и модель OSI')",
  "subject": "Краткое название предмета (одно слово, например: Физика, Информатика, История)",
  "content": "Твой полный конспект в формате Markdown. ОБЯЗАТЕЛЬНО используй форматирование: выделяй **жирным** ключевые слова, используй маркированные списки (с дефисом -) для перечисления тезисов, и нумерованные списки для порядка действий. Разделяй абзацы пустой строкой. Используй ## заголовки. Формулы — только те, что есть в тексте лекции, в LaTeX (через $...$ или $$...$$) с пояснением обозначений.",
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


# «Как запомнить» used to be a required section of 2-3 tips, and a model with nothing to offer made one up: «Амперметр —
# Последовательно (обе буквы согласные/сложные), Вольтметр — Параллельно» (live recheck of release 44.1, 2026-10-11).
# The section is written only when a tip really helps, like «Формулы» only when the lecture has formulas.
def build_cheatsheet_prompt() -> str:
    return """Ты — мастер визуального конспектирования и создания выжимок.
Твоя задача — проанализировать предоставленный текст лекции и превратить его в ультра-короткую, сверх-эффективную выжимку на 1 страницу для быстрого повторения за 5 минут до экзамена.

Требования:
1. Выдели ТОЛЬКО самое главное из лекции: фундаментальные термины и определения, законы и правила, а также формулы, даты и числа, если они есть в тексте лекции. Никакой "воды", рассуждений или длинных абзацев.
2. """ + SOURCE_FACTS_RULE + """
3. Раздел «Формулы» пиши, только если в тексте лекции есть формулы; если их нет, этого раздела в выжимке нет совсем.
4. Раздел «Как запомнить» — только если есть приём, который правда помогает запомнить: ассоциация, опорное слово или сравнение для того, что есть в лекции, без новых фактов. Мнемонику добавляй, только если она правда помогает запомнить; созвучие или буквы, которые ничего не объясняют, не пиши. Нет такого приёма — нет и этого раздела.
5. Блок «Где легко ошибиться»: 2-3 места из лекции, которые легко перепутать или забыть.
6. Оформляй строго в Markdown с использованием жирного шрифта и коротких списков.

ОБЯЗАТЕЛЬНАЯ структура:
# Выжимка
## Суть в 3 словах
(Крайне емкое резюме темы)

## Ключевые понятия
(Список критических определений, законов и правил из лекции)

## Формулы
(Только если в лекции есть формулы: каждая в LaTeX с расшифровкой обозначений. Нет формул в лекции — нет этого раздела.)

## Как запомнить
(Только если есть приём, который правда помогает запомнить трудное место лекции: 1-2 приёма. Нет такого приёма — нет этого раздела.)

## Где легко ошибиться
(2-3 места из лекции, которые легко перепутать или забыть)

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
Опирайся только на текст лекции: не добавляй фактов, которых в нём нет. """ + SOURCE_FACTS_RULE + """

ОБЯЗАТЕЛЬНО верни ответ ТОЛЬКО в формате JSON без markdown-обёрток (никаких ```json):
{
  "key_points": [
    "Самый важный тезис №1 — сжато, но содержательно",
    "Самый важный тезис №2",
    "Самый важный тезис №3"
  ],
  "cheatsheet": "Ультра-краткая выжимка в markdown: главные термины, правила и связи из лекции; формулы, даты и числа — только если они есть в тексте лекции. Максимум 150 слов. Используй **жирный** для ключевых слов.",
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


# Gemini models (2026-10-05). The free tier gives every model its own daily quota, and the Flash-Lite
# models get hundreds of requests a day where the full Flash models get a few dozen (web search
# 2026-10-05; the project's real numbers are on the rate-limit page of AI Studio), so the app lives on
# two Flash-Lite models: the newer 3.5 first where quality matters (analysis, list checks, answer
# points), the 3.1 one with the larger quota first for quick checks. On 2026-10-05 the live key
# answered not_found for both 2.5 models, so they are not in the lists.
DEFAULT_GEMINI_MODELS = "gemini-3.5-flash-lite,gemini-3.1-flash-lite"
DEFAULT_GEMINI_FAST_MODELS = "gemini-3.1-flash-lite,gemini-3.5-flash-lite"
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
    """GEMINI_FAST_MODELS; unset — the default quick list, or nothing when GEMINI_MODELS is set (quick calls
    then follow the owner's own list)."""
    named = _model_list(os.getenv("GEMINI_FAST_MODELS", ""))
    if named or _model_list(os.getenv("GEMINI_MODELS", "")):
        return named
    return _model_list(DEFAULT_GEMINI_FAST_MODELS)


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


# --- a pair that answered 429 rests until its quota is back (AI_COOLDOWN) -------------------
# Quotas belong to a model on a key's project (Gemini) or organization (Groq), so a 429 says
# nothing about the next pair: only that (provider, key, model) rests, and the call goes on to the
# next pair at once. How long: until the next midnight in Pacific time when the error names a daily
# quota («PerDay» in its details: Gemini's daily quotas reset then, and its retryDelay of a few
# seconds would only buy another 429), else the Retry-After header or RetryInfo.retryDelay, else
# COOLDOWN_DEFAULT_SECONDS. A call whose every pair rests fails at once with ai_busy, without a
# request. Process memory only: a restart forgets it. AI_COOLDOWN=0 switches it off (every call
# asks every pair again, as before 2026-10-07); the diagnostics probes never look at it.
COOLDOWN_DEFAULT_SECONDS = 60.0
COOLDOWN_MIN_SECONDS = 1.0
COOLDOWN_MAX_SECONDS = 25 * 3600.0  # a day in Pacific time is 23 to 25 hours long
# Right after midnight a daily-quota 429 may still come from the day before; it rests like any other
# 429 instead of a whole day.
DAILY_RESET_GRACE_SECONDS = 600.0
PACIFIC_ZONE = "America/Los_Angeles"
_COOLDOWN: dict[tuple[str, str, str], float] = {}
_OFF_VALUES = ("0", "false", "no", "off")
_RETRY_DELAY_RE = re.compile(r"^\s*(\d{1,7}(?:\.\d{1,9})?)s\s*$")


def cooldown_enabled() -> bool:
    return os.getenv("AI_COOLDOWN", "").strip().lower() not in _OFF_VALUES


def _wall_clock() -> datetime:
    """UTC now, for the Pacific day (tests replace it)."""
    return datetime.now(timezone.utc)


def pair_resting(provider: str, key: str, model: str) -> bool:
    if not cooldown_enabled():
        return False
    entry = (provider, _key_fingerprint(key), model)
    until = _COOLDOWN.get(entry)
    if until is None:
        return False
    if _skip_clock() >= until:
        _COOLDOWN.pop(entry, None)
        return False
    return True


def rest_pair(provider: str, key: str, model: str, seconds: float) -> None:
    entry = (provider, _key_fingerprint(key), model)
    _COOLDOWN[entry] = max(_COOLDOWN.get(entry, 0.0), _skip_clock() + seconds)


def reset_cooldowns() -> None:
    """Forget every resting pair (tests)."""
    _COOLDOWN.clear()


def _pacific_zone() -> Any:
    try:
        from zoneinfo import ZoneInfo

        return ZoneInfo(PACIFIC_ZONE)
    except Exception:  # an image without the tz database: the US rule below
        return None


def _nth_sunday(year: int, month: int, n: int) -> date:
    first = date(year, month, 1)
    return first + timedelta(days=(6 - first.weekday()) % 7 + 7 * (n - 1))


def _us_pacific_offset(moment: datetime) -> int:
    """UTC offset in hours of US Pacific time at ``moment`` by the rule in force since 2007: daylight
    time from the second Sunday of March, 02:00 PST, to the first Sunday of November, 02:00 PDT."""
    year = moment.year
    starts = datetime.combine(_nth_sunday(year, 3, 2), dtime(10), tzinfo=timezone.utc)
    ends = datetime.combine(_nth_sunday(year, 11, 1), dtime(9), tzinfo=timezone.utc)
    return -7 if starts <= moment < ends else -8


def _us_pacific_midnight(day: date) -> datetime:
    """The UTC moment of 00:00 of ``day`` in US Pacific time (never in a switch: they come at 02:00)."""
    for offset in (-8, -7):
        moment = datetime.combine(day, dtime.min, tzinfo=timezone.utc) - timedelta(hours=offset)
        if _us_pacific_offset(moment) == offset:
            return moment
    return datetime.combine(day, dtime.min, tzinfo=timezone.utc) + timedelta(hours=8)


def pacific_day_position(now: datetime, zone: Any = "auto") -> tuple[float, float]:
    """(seconds since the last midnight in Pacific time, seconds until the next one), summer and
    winter time included: the day of a switch lasts 23 or 25 hours. zone=None uses the US rule
    without the tz database."""
    now = now.astimezone(timezone.utc) if now.tzinfo else now.replace(tzinfo=timezone.utc)
    if zone == "auto":
        zone = _pacific_zone()
    if zone is not None:
        day = now.astimezone(zone).date()
        start = datetime.combine(day, dtime.min, tzinfo=zone).astimezone(timezone.utc)
        end = datetime.combine(day + timedelta(days=1), dtime.min, tzinfo=zone).astimezone(timezone.utc)
    else:
        day = (now + timedelta(hours=_us_pacific_offset(now))).date()
        start, end = _us_pacific_midnight(day), _us_pacific_midnight(day + timedelta(days=1))
    return (now - start).total_seconds(), (end - now).total_seconds()


def _error_details(exc: BaseException) -> list:
    """The google.rpc details of a provider error (Gemini: APIError.details, the body's
    error.details), or []."""
    for attribute in ("details", "body"):
        raw = getattr(exc, attribute, None)
        if isinstance(raw, list) and len(raw) == 1:
            raw = raw[0]
        if isinstance(raw, dict):
            error = raw.get("error") if isinstance(raw.get("error"), dict) else raw
            items = error.get("details")
            if isinstance(items, list):
                return items
    return []


def _mentions(value: Any, needle: str, depth: int = 6) -> bool:
    if isinstance(value, str):
        return needle in value
    if depth <= 0:
        return False
    if isinstance(value, dict):
        return any(_mentions(item, needle, depth - 1) for item in value.values())
    if isinstance(value, list):
        return any(_mentions(item, needle, depth - 1) for item in value[:50])
    return False


def _daily_quota(exc: BaseException) -> bool:
    """The 429 names a daily quota: «PerDay» in a quota id of its details
    (GenerateRequestsPerDayPerProjectPerModel-FreeTier)."""
    return _mentions(_error_details(exc), "PerDay")


def _parse_retry_after(value: Any) -> Optional[float]:
    """Seconds from a Retry-After header: a number of seconds or an HTTP date."""
    text = str(value).strip() if value is not None else ""
    if not text:
        return None
    try:
        seconds = float(text)
    except ValueError:
        try:
            when = email.utils.parsedate_to_datetime(text)
        except (TypeError, ValueError, IndexError):
            return None
        if when.tzinfo is None:
            when = when.replace(tzinfo=timezone.utc)
        seconds = (when - _wall_clock()).total_seconds()
    return seconds if math.isfinite(seconds) and seconds >= 0 else None


def _retry_after_seconds(exc: BaseException) -> Optional[float]:
    """Retry-After of the response (Groq sends it), else RetryInfo.retryDelay of the details
    (Gemini: «33s», «0.5s»), else None."""
    headers = getattr(getattr(exc, "response", None), "headers", None)
    if headers is not None:
        try:
            seconds = _parse_retry_after(headers.get("retry-after"))
        except Exception:
            seconds = None
        if seconds is not None:
            return seconds
    for item in _error_details(exc):
        if isinstance(item, dict) and str(item.get("@type", "")).endswith("RetryInfo"):
            match = _RETRY_DELAY_RE.match(str(item.get("retryDelay", "")))
            if match:
                return float(match.group(1))
    return None


def cooldown_for(exc: BaseException) -> tuple[float, str]:
    """(seconds, why) a pair rests after this 429; why is 'day', 'retry' or 'default'."""
    retry = _retry_after_seconds(exc)
    if _daily_quota(exc):
        since, until = pacific_day_position(_wall_clock())
        if since >= DAILY_RESET_GRACE_SECONDS:
            return min(COOLDOWN_MAX_SECONDS, max(COOLDOWN_MIN_SECONDS, until, retry or 0.0)), "day"
    if retry is not None:
        return min(COOLDOWN_MAX_SECONDS, max(COOLDOWN_MIN_SECONDS, retry)), "retry"
    return COOLDOWN_DEFAULT_SECONDS, "default"


def rest_after_429(provider: str, key: str, key_index: Optional[int], model: str, exc: BaseException) -> None:
    """Puts the pair to rest for its 429 (nothing when AI_COOLDOWN=0)."""
    if not cooldown_enabled():
        return
    seconds, why = cooldown_for(exc)
    rest_pair(provider, key, model, seconds)
    where = f"key#{key_index} " if key_index is not None else ""
    print(f"AI {provider} {where}model={model} rests {int(math.ceil(seconds))} s after 429 ({why})")


# --- heavy calls wait in one line for the whole process (AI_HEAVY_CONCURRENCY) ------------------
# The list check (exams_map), the answer points and short lines of the cheat sheet (oral_api,
# oral_sheet) and the analysis of a lecture (agents/coordinator) send long prompts in bulk, and each
# job had only its own limit (MAX_IN_FLIGHT = 3 per list check), so a few jobs at once spent the
# provider's minute before a student's answer got its turn. Those calls hold a heavy_slot() around
# their model call and wait first come, first served while AI_HEAVY_CONCURRENCY (default 6) run;
# 0 lifts the limit. The quick answer check and the protocol never take a slot. The slot is taken
# before a call's own time budget starts, so the wait does not eat it.
DEFAULT_HEAVY_CONCURRENCY = 6


def heavy_concurrency() -> int:
    raw = os.getenv("AI_HEAVY_CONCURRENCY", "").strip()
    if not raw:
        return DEFAULT_HEAVY_CONCURRENCY
    try:
        value = int(raw)
    except ValueError:
        return DEFAULT_HEAVY_CONCURRENCY
    return value if value >= 0 else DEFAULT_HEAVY_CONCURRENCY


class _HeavyLine:
    """Slots handed out in order of arrival; the limit is read on every acquire and release."""

    def __init__(self) -> None:
        self.running = 0
        self.waiters: deque = deque()

    def _room(self) -> bool:
        limit = heavy_concurrency()
        return limit == 0 or self.running < limit

    async def acquire(self) -> None:
        if not self.waiters and self._room():
            self.running += 1
            return
        waiter = asyncio.get_running_loop().create_future()
        self.waiters.append(waiter)
        try:
            await waiter
        except BaseException:
            if waiter.done() and not waiter.cancelled():
                self.release()  # the slot came together with the cancellation: pass it on
            else:
                with contextlib.suppress(ValueError):
                    self.waiters.remove(waiter)
            raise

    def release(self) -> None:
        self.running = max(0, self.running - 1)
        while self.waiters and self._room():
            waiter = self.waiters.popleft()
            if waiter.done():
                continue
            try:
                waiter.set_result(None)
            except RuntimeError:  # its event loop is gone
                continue
            self.running += 1


_HEAVY = _HeavyLine()


@contextlib.asynccontextmanager
async def heavy_slot():
    """One slot of the heavy-call line for the block (AI_HEAVY_CONCURRENCY)."""
    await _HEAVY.acquire()
    try:
        yield
    finally:
        _HEAVY.release()


def heavy_state() -> dict[str, int]:
    return {"limit": heavy_concurrency(), "running": _HEAVY.running, "waiting": len(_HEAVY.waiters)}


def reset_heavy_line() -> None:
    """Forget the heavy-call line (tests)."""
    _HEAVY.running = 0
    _HEAVY.waiters.clear()


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


# Provider codes that refuse the whole account rather than one request (Groq answered every model
# with «organization_restricted» on 2026-10-05): treated like a rejected key, so the models are
# skipped for a while instead of being asked on every call.
ACCOUNT_REFUSAL_CODES = frozenset({"organization_restricted"})


def _account_refused(exc: BaseException) -> bool:
    return provider_error_code(exc) in ACCOUNT_REFUSAL_CODES


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
        return "permission" if _api_key_invalid(exc) or _account_refused(exc) else "invalid_argument"
    if status in (408, 504) or named == "DEADLINE_EXCEEDED":
        return "timeout"
    if isinstance(exc, (httpx.TransportError, ConnectionError) + groq_connection_error):
        return "network"
    return "other"


_PROVIDER_CODE_RE = re.compile(r"^[A-Za-z0-9_.-]{1,40}$")


def provider_error_code(exc: BaseException) -> Optional[str]:
    """The provider's own short code of a failure («model_decommissioned», «invalid_argument»), never its text.

    Groq puts {error: {code, type}} in the body, Gemini a status name; «:thinking» marks a Gemini
    refusal that names the thinking settings.
    """
    body = getattr(exc, "body", None)
    if isinstance(body, dict):
        error = body.get("error") if isinstance(body.get("error"), dict) else body
        for key in ("code", "type", "status"):
            value = error.get(key)
            if isinstance(value, str) and _PROVIDER_CODE_RE.match(value):
                return value.lower()
    status = getattr(exc, "status", None)
    if isinstance(status, str) and _PROVIDER_CODE_RE.match(status):
        return status.lower() + (":thinking" if _mentions_thinking(exc) else "")
    return None


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


# The SDK sends ceil(timeout) as the X-Server-Timeout header, and the Gemini API refuses a deadline
# under 10 s with INVALID_ARGUMENT (seen live 2026-10-05: every model of the 8 s health probe was
# «invalid_argument»; the quick answer check has 2.5 s). The header never goes below this; a shorter
# budget is kept by asyncio.wait_for around the call.
GEMINI_MIN_SERVER_DEADLINE_SECONDS = 10.0


def gemini_http_options(timeout: float) -> Any:
    """HttpOptions for one Gemini request: the budget, but never under the API's 10 s minimum."""
    seconds = max(float(timeout), GEMINI_MIN_SERVER_DEADLINE_SECONDS)
    return types.HttpOptions(timeout=int(seconds * 1000))


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
        "http_options": gemini_http_options(timeout),
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


# --- real answers of one piece of work: an analysis made of cached answers only costs nothing -------------------
class CallCount:
    """The real (not cached) answers the work of a task got: every answer of BaseAgent that a provider gave, and a
    transcription or a recognition the work notes itself (note_real_call). The analysis stream (main._guarded) gives
    its units back when there were none: a repeated analysis came back from the cache in 4.2 s and took 20 units
    (live recheck of release 44.1, 2026-10-11). So do the lecture materials made outside the stream
    (main._paid_by_real_calls; the live recheck of release 44.2)."""

    def __init__(self) -> None:
        self.real = 0


_CALL_COUNT: contextvars.ContextVar[Optional[CallCount]] = contextvars.ContextVar("meldy_call_count", default=None)


def count_calls() -> CallCount:
    """A new count for the current task; the tasks it starts after this (the sections of an analysis) add to it too."""
    count = CallCount()
    _CALL_COUNT.set(count)
    return count


def note_real_call() -> None:
    """A real answer outside BaseAgent — a recording transcribed, a photo recognised — for the current count."""
    count = _CALL_COUNT.get()
    if count is not None:
        count.real += 1


def _record_call(provider: Optional[str], model: Optional[str], ok: bool, ms: int) -> None:
    if ok:
        note_real_call()
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
                "error": classify_error(exc), "detail": provider_error_code(exc), "thinking": label}
    ok = bool(text and text.strip())
    return {"ok": ok, "ms": int((time.monotonic() - started) * 1000), "finish_reason": finish,
            "error": None if ok else "empty", "detail": None, "thinking": label}


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
                "error": classify_error(exc), "detail": provider_error_code(exc)}
    ok = bool(text and text.strip())
    return {"ok": ok, "ms": int((time.monotonic() - started) * 1000), "finish_reason": finish,
            "error": None if ok else "empty", "detail": None}


class BaseAgent:
    # A bounded process-local cache prevents repeated demo requests from
    # burning provider quota without allowing an unbounded memory leak.
    # Values are the raw model text (BaseAgent.forget evicts by value): a cached
    # answer goes through the caller's checks again (validate_section and
    # mixed_script.check in coordinator.py, main._checked_answer), and one they
    # refuse is evicted and asked again. A cache hit is no real call (CallCount).
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

    def __init__(self, api_key: str = "", model: Optional[str] = None, gemini_api_keys: Optional[list[str]] = None):
        self.groq_api_key = (api_key or "").strip()
        # An explicit model overrides GROQ_MODEL for this agent (normal calls only).
        self.model = model
        # Explicit Gemini keys replace GEMINI_API_KEY for this agent (the /try example's own project,
        # try_api.py); None — the keys of the environment, read at every call as before. A pair of these
        # keys that answers 429 rests by its own fingerprint, so the main keys never rest for it.
        self.own_gemini_keys: Optional[list[str]] = (
            None if gemini_api_keys is None else [key.strip() for key in gemini_api_keys if key and key.strip()]
        )
        self.gemini_keys = self._gemini_keys()
        self.groq_client = get_groq_client(self.groq_api_key) if self.groq_api_key else None
        self.safety_settings = SAFETY_SETTINGS

    def _gemini_keys(self) -> list[str]:
        return list(self.own_gemini_keys) if self.own_gemini_keys is not None else gemini_keys()

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
        gemini_timeout: Optional[float] = None,
    ) -> str:
        """Model text for the prompt, or AIError (429 busy, 502 failed, 503 unconfigured, 504 timeout).

        Gemini keys and models are tried first (GEMINI_MODELS, or GEMINI_FAST_MODELS when
        ``fast``), then Groq (GROQ_MODEL / GROQ_FAST_MODEL). ``timeout`` is the budget for the
        whole call across models and providers (AI_CALL_TIMEOUT_SECONDS by default). A pair that
        answered 429 is skipped while it rests (AI_COOLDOWN); with every pair resting the call is
        429 ai_busy at once.

        ``gemini_timeout`` — the part of ``timeout`` Gemini may spend when the Groq fallback can
        still run (a key, its model neither skipped nor resting): a slow Gemini then leaves the rest
        to Groq instead of using up the whole budget. Without a usable fallback Gemini keeps the
        whole budget.
        """
        keys = self._gemini_keys()
        max_chars = 300000 if keys else 80000
        truncated = user_text[:max_chars]
        if len(user_text) > max_chars:
            truncated += f"\n\n[Текст сокращен с {len(user_text)} до {max_chars} символов]"
        return await self._generate(
            system_prompt, truncated, keys=keys, images=None, mime_type=None,
            temperature=temperature, max_tokens=max_tokens, json_mode=json_mode, timeout=timeout,
            fast=fast, thinking=thinking, use_cache=use_cache, meta=meta, gemini_timeout=gemini_timeout,
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
            system_prompt, user_text, keys=self._gemini_keys(), images=list(images_base64 or []), mime_type=mime_type,
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
        gemini_timeout: Optional[float] = None,
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

        if images is not None:
            groq_model_name = groq_vision_model()
        elif fast:
            groq_model_name = groq_fast_model()
        else:
            groq_model_name = self.model or groq_model()

        # Gemini's share of the budget: only when Groq can take over (a key, its pair neither skipped nor
        # resting) does a slow Gemini stop at gemini_timeout and leave the rest to Groq.
        gemini_deadline = deadline
        if (
            gemini_timeout is not None
            and keys
            and self.groq_api_key
            and not model_skipped("groq", self.groq_api_key, groq_model_name)
            and not pair_resting("groq", self.groq_api_key, groq_model_name)
        ):
            gemini_deadline = min(deadline, started + max(0.0, float(gemini_timeout)))

        def remaining() -> float:
            return deadline - loop.time()

        def gemini_remaining() -> float:
            return gemini_deadline - loop.time()

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
                    if pair_resting("gemini", key, model):
                        outcome.note("rate_limited")  # every pair resting: ai_busy at once
                        continue
                    if gemini_remaining() <= MIN_ATTEMPT_SECONDS:
                        outcome.note("timeout")
                        break
                    found = await self._gemini_model_attempts(
                        key, key_index, model, contents, temp, limit, json_flag, mode, gemini_remaining, outcome, secrets,
                    )
                    if found is not None:
                        result = (found[0], "gemini", model, found[2], found[1])
                        break
                if result is not None or gemini_remaining() <= MIN_ATTEMPT_SECONDS:
                    break
            if result is None and gemini_deadline < deadline and gemini_remaining() <= MIN_ATTEMPT_SECONDS:
                print(f"AI gemini share of the budget spent after {elapsed_ms()} ms: the rest goes to groq")

        if result is None and self.groq_api_key:
            model = groq_model_name
            if model_skipped("groq", self.groq_api_key, model):
                pass
            elif pair_resting("groq", self.groq_api_key, model):
                outcome.note("rate_limited")
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
                    elif kind == "rate_limited":
                        rest_after_429("groq", self.groq_api_key, None, model, exc)
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
                if kind == "rate_limited":
                    rest_after_429("gemini", key, key_index, model, exc)  # the next pair at once
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
