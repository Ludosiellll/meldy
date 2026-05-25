import asyncio
import json
from typing import AsyncGenerator, Dict, Any, Optional

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

        agent_names = ["summarizer", "flashcards", "quiz", "cheatsheet", "podcast", "missions"]
        agent_labels = {
            "summarizer": "📝 Конспект",
            "flashcards": "🃏 Карточки",
            "quiz": "❓ Тест",
            "cheatsheet": "⚡ Шпаргалка",
            "podcast": "🎙️ Подкаст",
            "missions": "🎮 Миссии",
        }

        # Запускаем агентов ПОСЛЕДОВАТЕЛЬНО для стабильности (особенно для Gemini Free)
        done_count = 0
        for name in agent_names:
            yield {
                "type": "agent_start",
                "agent": name,
                "label": agent_labels[name],
            }
            
            # Выполняем запрос
            agent_name, result = await run_agent(name, prompts[name])
            results[agent_name] = result
            
            done_count += 1
            yield {
                "type": "agent_done",
                "agent": agent_name,
                "label": agent_labels[agent_name],
                "progress": done_count,
                "total": 6,
            }
            
            # Небольшая пауза между запросами для обхода лимитов
            if done_count < 6:
                await asyncio.sleep(1)

        yield {
            "type": "results",
            "summarizer": results.get("summarizer", {"error": "Нет результата"}),
            "flashcards": results.get("flashcards", {"error": "Нет результата"}),
            "quiz": results.get("quiz", {"error": "Нет результата"}),
            "cheatsheet": results.get("cheatsheet", {"error": "Нет результата"}),
            "podcast": results.get("podcast", {"error": "Нет результата"}),
            "missions": results.get("missions", {"error": "Нет результата"}),
        }

    def _parse_result(self, name: str, raw: str) -> Any:
        if name in ("flashcards", "quiz", "podcast", "summarizer", "missions"):
            try:
                json_str = raw.strip()
                # Try to extract from markdown blocks
                if "```json" in json_str:
                    json_str = json_str.split("```json")[1].split("```")[0]
                elif "```" in json_str:
                    json_str = json_str.split("```")[1].split("```")[0]
                
                # If still no luck, try to find the first '{' or '[' and last '}' or ']'
                if not (json_str.startswith('{') or json_str.startswith('[')):
                    start_idx = -1
                    for char in ('{', '['):
                        idx = json_str.find(char)
                        if idx != -1 and (start_idx == -1 or idx < start_idx):
                            start_idx = idx
                    
                    if start_idx != -1:
                        end_char = '}' if json_str[start_idx] == '{' else ']'
                        end_idx = json_str.rfind(end_char)
                        if end_idx != -1:
                            json_str = json_str[start_idx:end_idx+1]

                parsed = json.loads(json_str.strip())
                
                # Normalize results: ensure {"quiz": [...]} or {"flashcards": [...]}
                if isinstance(parsed, list):
                    return {name: parsed}
                if isinstance(parsed, dict):
                    if name not in parsed and any(isinstance(v, list) for v in parsed.values()):
                        # If the key is different but contains a list, rename the first list found
                        for k, v in parsed.items():
                            if isinstance(v, list):
                                return {name: v}
                    return parsed
                
                return {"error": "Invalid format", "raw": raw}
            except Exception as e:
                return {"error": f"Parse error: {str(e)}", "raw": raw}
        return {"content": raw}
