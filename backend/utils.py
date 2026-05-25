import json
from typing import Any

def parse_llm_json(raw: str) -> Any:
    """Utility to extract and parse JSON from LLM string output."""
    json_str = raw.strip()
    if "```json" in json_str:
        json_str = json_str.split("```json")[1].split("```")[0]
    elif "```" in json_str:
        json_str = json_str.split("```")[1].split("```")[0]
    
    if not (json_str.startswith('{') or json_str.startswith('[')):
        start = -1
        for char in ('{', '['):
            idx = json_str.find(char)
            if idx != -1 and (start == -1 or idx < start):
                start = idx
        
        if start != -1:
            end_char = '}' if json_str[start] == '{' else ']'
            end = json_str.rfind(end_char)
            if end != -1:
                json_str = json_str[start:end+1]
                
    return json.loads(json_str.strip())
