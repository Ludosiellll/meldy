import json
from typing import Any

def repair_json(json_str: str) -> str:
    """Repair truncated or malformed JSON strings by backtracking and closing open structures."""
    json_str = json_str.strip()
    if not json_str:
        return "{}"
        
    # We progressively backtrack from the end to find a cut-off point that can be closed into a valid JSON structure.
    max_backtrack = min(3000, len(json_str))
    
    for trim_len in range(max_backtrack + 1):
        test_str = json_str[:len(json_str) - trim_len].strip()
        if not test_str:
            break
            
        # Strip trailing chars that are invalid before closing brackets
        while test_str and test_str[-1] in (',', ':', '[', '{', '"', '\\', ' ', '\t', '\n', '\r'):
            test_str = test_str[:-1].strip()
            
        if not test_str:
            continue
            
        # Count open structures safely
        state = 'normal'
        stack = []
        i = 0
        valid = True
        
        while i < len(test_str):
            char = test_str[i]
            if state == 'normal':
                if char == '"':
                    state = 'string'
                elif char in ('{', '['):
                    stack.append(char)
                elif char in ('}', ']'):
                    if stack:
                        op = stack.pop()
                        if (char == '}' and op != '{') or (char == ']' and op != '['):
                            valid = False
                            break
                    else:
                        valid = False
                        break
            elif state == 'string':
                if char == '\\':
                    state = 'escape'
                elif char == '"':
                    state = 'normal'
            elif state == 'escape':
                state = 'string'
            i += 1
            
        if not valid or state != 'normal':
            continue
            
        # Close the open brackets/braces
        closed_str = test_str
        for op in reversed(stack):
            if op == '{':
                closed_str += '}'
            elif op == '[':
                closed_str += ']'
                
        try:
            parsed = json.loads(closed_str)
            return closed_str
        except Exception:
            continue
            
    return "{}"

def parse_llm_json(raw: str) -> Any:
    """Utility to extract and parse JSON from LLM string output, with auto-repair support."""
    if not isinstance(raw, str):
        raise ValueError("Ответ модели должен быть строкой")
    json_str = raw.strip().lstrip("\ufeff")
    if "```json" in json_str:
        json_str = json_str.split("```json")[1].split("```")[0]
    elif "```" in json_str:
        json_str = json_str.split("```")[1].split("```")[0]
    
    # Try finding the first JSON bracket if surrounded by conversational text
    if not (json_str.startswith('{') or json_str.startswith('[')):
        start = -1
        for char in ('{', '['):
            idx = json_str.find(char)
            if idx != -1 and (start == -1 or idx < start):
                start = idx
        if start != -1:
            json_str = json_str[start:]
            
    json_str = json_str.strip()
    
    try:
        return json.loads(json_str)
    except Exception as primary_error:
        try:
            repaired = repair_json(json_str)
            return json.loads(repaired)
        except Exception:
            raise primary_error


import re
import math
from typing import List, Dict

def extract_relevant_paragraphs(text: str, query: str, top_k: int = 8, chunk_chars: int = 700) -> str:
    """
    Splits document text into paragraphs/chunks and retrieves the top_k most relevant chunks 
    matching the query using a highly optimized local TF-IDF semantic relevance ranking.
    """
    if not text or not text.strip():
        return ""
        
    # 1. Split text into paragraphs/chunks by double-newlines
    raw_paragraphs = [p.strip() for p in re.split(r'\n\s*\n', text) if p.strip()]
    
    # If paragraphs are too long, split them into chunks of ~chunk_chars characters
    chunks = []
    for p in raw_paragraphs:
        if len(p) <= chunk_chars * 1.5:
            chunks.append(p)
        else:
            words = p.split()
            current_chunk = []
            current_len = 0
            for w in words:
                current_chunk.append(w)
                current_len += len(w) + 1
                if current_len >= chunk_chars:
                    chunks.append(" ".join(current_chunk))
                    current_chunk = []
                    current_len = 0
            if current_chunk:
                chunks.append(" ".join(current_chunk))
                
    if not chunks:
        return text[:25000] # Fallback to start of text

    # 2. Tokenize helper
    def tokenize(s: str) -> List[str]:
        return re.findall(r'[a-zA-Zа-яА-Я0-9]+', s.lower())

    # Tokenize chunks
    chunk_tokens = [tokenize(c) for c in chunks]
    query_tokens = tokenize(query)
    
    if not query_tokens:
        return "\n\n".join(chunks[:top_k])

    # 3. Calculate IDF for each query term across all chunks
    N = len(chunks)
    idf = {}
    for term in query_tokens:
        df = sum(1 for tokens in chunk_tokens if term in tokens)
        idf[term] = math.log((N + 1) / (df + 1)) + 1.0

    # 4. Score each chunk using TF-IDF cosine-like keyword overlap
    scores = []
    for idx, tokens in enumerate(chunk_tokens):
        if not tokens:
            scores.append((idx, 0.0))
            continue
            
        tf = {}
        for term in tokens:
            tf[term] = tf.get(term, 0) + 1
            
        score = 0.0
        for term in query_tokens:
            if term in tf:
                score += (tf[term] / len(tokens)) * idf[term]
                
        unique_matches = sum(1 for term in query_tokens if term in tf)
        if unique_matches > 1:
            score *= (1.0 + 0.15 * unique_matches)
            
        scores.append((idx, score))

    # 5. Sort by relevance score desc and retrieve top_k chunks
    scores.sort(key=lambda x: x[1], reverse=True)
    top_indices = [idx for idx, score in scores[:top_k] if score > 0.0]
    
    if not top_indices:
        return "\n\n".join(chunks[:top_k])

    # Sort matching indices in chronological order of appearance in the original book
    top_indices.sort()
    
    selected_chunks = [chunks[idx] for idx in top_indices]
    return "\n\n".join(selected_chunks)


async def scrape_url(url: str) -> str:
    """
    Scrapes a web page using a hybrid workflow:
    1. Remote Jina Reader API (r.jina.ai/{url}) for JS-heavy/dynamic pages.
    2. Fallback to local httpx + BeautifulSoup for static HTML.
    """
    import httpx

    if not url.startswith(("http://", "https://")):
        url = "https://" + url

    jina_url = f"https://r.jina.ai/{url}"
    try:
        async with httpx.AsyncClient(follow_redirects=True) as client:
            response = await client.get(jina_url, timeout=12.0)
            if response.status_code == 200 and response.text.strip():
                text = response.text
                if "Failed to fetch" not in text and "Error fetching" not in text:
                    return text
    except Exception as e:
        print(f"Jina API extraction failed: {e}")

    # Local fallback
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
        async with httpx.AsyncClient(follow_redirects=True, headers=headers) as client:
            response = await client.get(url, timeout=10.0)
            if response.status_code != 200:
                raise ValueError(f"HTTP error {response.status_code}")
            
            html = response.text
            try:
                from bs4 import BeautifulSoup
                soup = BeautifulSoup(html, "html.parser")
                
                # Clean up the HTML
                for element in soup(["script", "style", "nav", "footer", "form", "iframe", "header", "aside"]):
                    element.decompose()
                    
                body = soup.body if soup.body else soup
                
                text_lines = []
                # Gather headers, paragraphs and list items to keep formatting structure
                for element in body.find_all(["h1", "h2", "h3", "h4", "h5", "h6", "p", "li"]):
                    el_text = element.get_text(strip=True)
                    if not el_text:
                        continue
                    if element.name in ("h1", "h2", "h3", "h4", "h5", "h6"):
                        text_lines.append(f"\n\n# {el_text}\n")
                    elif element.name == "p":
                        text_lines.append(f"\n{el_text}\n")
                    elif element.name == "li":
                        text_lines.append(f"\n* {el_text}")
                
                text = "".join(text_lines).strip()
                
                if not text:
                    text = body.get_text(separator="\n", strip=True)
            except ImportError:
                # RegEx based lightweight fallback if beautifulsoup4 is not yet installed in runtime
                import re
                # Remove scripts and styles
                html_clean = re.sub(r'<(script|style|nav|footer|header|form|iframe|aside)[^>]*>([\s\S]*?)<\/\1>', ' ', html, flags=re.IGNORECASE)
                # Strip other tags
                text = re.sub(r'<[^>]+>', ' ', html_clean)
                # Decode basic HTML entities
                text = text.replace('&nbsp;', ' ').replace('&lt;', '<').replace('&gt;', '>').replace('&amp;', '&')
                # Clean up duplicate newlines/whitespaces
                text = re.sub(r'\s+', ' ', text).strip()
                
            if not text.strip():
                raise ValueError("Извлеченный текст пуст")
                
            return text
    except Exception as e:
        raise ValueError(f"Не удалось прочитать веб-страницу: {e}")



