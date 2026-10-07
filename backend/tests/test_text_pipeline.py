import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from parser import extract_text
from utils import build_source_chunks, find_source_ids, is_safe_public_url, parse_llm_json


class TextPipelineTests(unittest.TestCase):
    def test_utf8_bom_is_decoded_without_bom(self):
        self.assertEqual(extract_text("Привет, лекция".encode("utf-8-sig"), "note.txt"), "Привет, лекция")

    def test_utf16_is_not_decoded_as_cp1251(self):
        self.assertEqual(extract_text("Формула и конспект".encode("utf-16"), "note.txt"), "Формула и конспект")

    def test_cp1251_is_supported(self):
        self.assertEqual(extract_text("Беларусь".encode("cp1251"), "note.txt"), "Беларусь")

    def test_cp866_is_not_misread_as_cp1251(self):
        self.assertEqual(
            extract_text("Привет, конспект".encode("cp866"), "note.txt"),
            "Привет, конспект",
        )

    def test_pasted_utf8_text_round_trips(self):
        # Вставленный текст браузер отправляет как Blob 'pasted-text.txt': UTF-8 без BOM.
        pasted = (
            "  Лекция 3. Эластичность спроса\r\n\r\n"
            "Цена\tКоличество\r\n"
            "Рост цены на 10 % снижает спрос 📉 — «ёлка» и naïve.  \r\n"
            "\r\n\r\n\r\n"
            "Итог: спрос эластичен.\r\n"
        )
        self.assertEqual(
            extract_text(pasted.encode("utf-8"), "pasted-text.txt"),
            "Лекция 3. Эластичность спроса\n\n"
            "Цена\tКоличество\n"
            "Рост цены на 10 % снижает спрос 📉 — «ёлка» и naïve.\n\n"
            "Итог: спрос эластичен.",
        )

    def test_demo_lecture_round_trips_unchanged(self):
        demo = (Path(__file__).resolve().parent / "fixtures" / "demo_lecture_v0.txt").read_text(encoding="utf-8")
        self.assertEqual(len(demo), 5364)
        self.assertEqual(extract_text(demo.encode("utf-8"), "pasted-text.txt"), demo)

    def test_url_analyzer_rejects_private_and_non_http_targets(self):
        rejected = [
            "http://127.0.0.1:8000/docs",
            "http://localhost/admin",
            "http://10.0.0.4/private",
            "http://169.254.169.254/latest/meta-data",
            "file:///etc/passwd",
        ]
        for url in rejected:
            with self.subTest(url=url):
                self.assertFalse(is_safe_public_url(url))

        self.assertTrue(is_safe_public_url("https://example.com/article"))

    def test_llm_json_code_fence_is_parsed(self):
        self.assertEqual(parse_llm_json('```json\n{"content":"Текст"}\n```'), {"content": "Текст"})

    def test_source_chunks_are_numbered_and_match_generated_items(self):
        text = "Квантовая механика описывает состояние частицы.\n\nСуперпозиция означает сочетание нескольких состояний до измерения."
        chunks = build_source_chunks(text)
        self.assertEqual([chunk["id"] for chunk in chunks], ["S01", "S02"])
        self.assertEqual(find_source_ids("Что такое суперпозиция?", chunks), ["S02"])

    def test_a_saved_text_keeps_its_fragments(self):
        # summary_json.grounding, доказательства сверки и пункты ответа называют фрагменты по [S01]…:
        # текст, сохранённый до 2026-10-07 (DOCX без пустых строк), режется так же, словами до 850 знаков.
        words = [f"термин{n}" for n in range(200)]
        saved = "\n".join(" ".join(words[start:start + 20]) for start in range(0, 200, 20))
        chunks = build_source_chunks(saved)
        self.assertEqual([chunk["id"] for chunk in chunks], ["S01", "S02", "S03"])
        self.assertEqual(" ".join(chunk["text"] for chunk in chunks).split(), words)
        self.assertTrue(all(len(chunk["text"]) <= 850 for chunk in chunks))
        # 10 слов по 7 знаков и 85 по 8, каждое с пробелом, — 845 знаков; 96-е уже не входит в 850.
        self.assertEqual(chunks[0]["text"].split()[-1], "термин94")


if __name__ == "__main__":
    unittest.main()
