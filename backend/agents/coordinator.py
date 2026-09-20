import asyncio
import json
from typing import AsyncGenerator, Dict, Any, Optional

from utils import parse_llm_json
from .base import BaseAgent, build_summarizer_prompt, build_flashcards_prompt, build_quiz_prompt, build_cheatsheet_prompt, build_podcast_prompt, build_missions_prompt


class CoordinatorAgent:
    def __init__(self, api_key: str):
        self.base = BaseAgent(api_key)

    async def process(
        self,
        text: str,
        summary_detail: str = "medium",
        flashcard_count: int = 6,
        quiz_count: int = 5,
        quiz_difficulty: str = "mixed",
        quiz_type: str = "multiple",
        enabled_agents: Optional[list[str]] = None,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        results: Dict[str, Any] = {}

        prompts = {
            "summarizer": build_summarizer_prompt(summary_detail),
            "flashcards": build_flashcards_prompt(flashcard_count),
            "quiz": build_quiz_prompt(quiz_count, quiz_difficulty, quiz_type),
            "cheatsheet": build_cheatsheet_prompt(),
            "podcast": build_podcast_prompt(),
            "missions": build_missions_prompt(),
        }

        async def run_agent(name: str, prompt: str) -> tuple:
            try:
                raw = await self.base.run(prompt, text)
                return (name, self._parse_result(name, raw))
            except Exception as e:
                return (name, {"error": str(e)})

        all_agents = ["summarizer", "flashcards", "quiz", "cheatsheet", "podcast", "missions"]
        if enabled_agents:
            agent_names = [a for a in all_agents if a in enabled_agents]
        else:
            agent_names = all_agents

        if not agent_names:
            agent_names = ["summarizer"]

        agent_labels = {
            "summarizer": "📝 Конспект",
            "flashcards": "🃏 Карточки",
            "quiz": "❓ Тест",
            "cheatsheet": "⚡ Шпаргалка",
            "podcast": "🎙️ Подкаст",
            "missions": "🎮 Миссии",
        }

        for name in agent_names:
            yield {
                "type": "agent_start",
                "agent": name,
                "label": agent_labels[name],
            }
            
        # Запускаем агентов полупараллельно с микро-паузами (Staggered Queue) во избежание 429 лимитов
        async def run_agent_staggered(name: str, prompt: str, delay_seconds: float) -> tuple:
            if delay_seconds > 0:
                await asyncio.sleep(delay_seconds)
            return await run_agent(name, prompt)

        tasks = []
        for i, name in enumerate(agent_names):
            # Сдвиг запуска 0.8 секунд для сглаживания пиковой нагрузки на API
            tasks.append(run_agent_staggered(name, prompts[name], i * 0.8))

        done_count = 0
        for future in asyncio.as_completed(tasks):
            result = await future
            agent_name, agent_result = result
            results[agent_name] = agent_result
            done_count += 1
            yield {
                "type": "agent_done",
                "agent": agent_name,
                "label": agent_labels[agent_name],
                "progress": done_count,
                "total": len(agent_names),
            }

        fallbacks = {
            "summarizer": {"title": "Без названия", "subject": "Конспект", "content": "", "terms": []},
            "flashcards": {"flashcards": []},
            "quiz": {"quiz": []},
            "cheatsheet": {"content": ""},
            "podcast": {"podcast": []},
            "missions": {"missions": []},
        }

        yield {
            "type": "results",
            "summarizer": results.get("summarizer") or fallbacks["summarizer"],
            "flashcards": results.get("flashcards") or fallbacks["flashcards"],
            "quiz": results.get("quiz") or fallbacks["quiz"],
            "cheatsheet": results.get("cheatsheet") or fallbacks["cheatsheet"],
            "podcast": results.get("podcast") or fallbacks["podcast"],
            "missions": results.get("missions") or fallbacks["missions"],
        }

    def _parse_result(self, name: str, raw: str) -> Any:
        try:
            parsed = parse_llm_json(raw)
        except Exception as e:
            if name == "summarizer":
                print(f"Summarizer parse error: {e}, raw: {raw[:100]}")
                return {"content": "", "title": "Конспект не сформирован", "subject": "", "terms": [], "error": "Ответ ИИ пришёл в неверном формате"}
            return {"error": "Ответ ИИ пришёл в неверном формате"}

        if name == "summarizer":
            if isinstance(parsed, dict):
                return parsed
            print(f"Summarizer invalid format (not dict), raw: {raw[:100]}")
            return {"content": str(parsed), "title": "Без названия (fallback)", "subject": "Конспект (fallback)", "terms": [], "error": "Invalid format"}

        if name in ("flashcards", "quiz", "podcast", "missions"):
            if isinstance(parsed, list):
                return {name: parsed}
            if isinstance(parsed, dict):
                if name not in parsed and any(isinstance(v, list) for v in parsed.values()):
                    # If the key is different but contains a list, rename the first list found
                    for k, v in parsed.items():
                        if isinstance(v, list):
                            return {name: v}
                return parsed
            
            return {"error": "Ответ ИИ пришёл в неверном формате"}
            
        return {"content": raw}
