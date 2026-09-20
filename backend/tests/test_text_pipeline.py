import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from parser import extract_text
from utils import build_source_chunks, find_source_ids, parse_llm_json


class TextPipelineTests(unittest.TestCase):
    def test_utf8_bom_is_decoded_without_bom(self):
        self.assertEqual(extract_text("Привет, лекция".encode("utf-8-sig"), "note.txt"), "Привет, лекция")

    def test_utf16_is_not_decoded_as_cp1251(self):
        self.assertEqual(extract_text("Формула и конспект".encode("utf-16"), "note.txt"), "Формула и конспект")

    def test_cp1251_is_supported(self):
        self.assertEqual(extract_text("Беларусь".encode("cp1251"), "note.txt"), "Беларусь")

    def test_llm_json_code_fence_is_parsed(self):
        self.assertEqual(parse_llm_json('```json\n{"content":"Текст"}\n```'), {"content": "Текст"})

    def test_source_chunks_are_numbered_and_match_generated_items(self):
        text = "Квантовая механика описывает состояние частицы.\n\nСуперпозиция означает сочетание нескольких состояний до измерения."
        chunks = build_source_chunks(text)
        self.assertEqual([chunk["id"] for chunk in chunks], ["S01", "S02"])
        self.assertEqual(find_source_ids("Что такое суперпозиция?", chunks), ["S02"])


if __name__ == "__main__":
    unittest.main()
