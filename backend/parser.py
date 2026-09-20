import io
import re
from typing import Optional


def extract_text(contents: bytes, filename: str) -> str:
    ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else "txt"

    if ext == "pdf":
        return _extract_pdf(contents)
    elif ext == "docx":
        return _extract_docx(contents)
    elif ext in ("html", "htm"):
        return _extract_html(contents)
    elif ext in ("txt", "md"):
        return _extract_text(contents)
    else:
        return _extract_text(contents)


def _extract_pdf(contents: bytes) -> str:
    try:
        from PyPDF2 import PdfReader
        reader = PdfReader(io.BytesIO(contents))
        text_parts = []
        for page in reader.pages:
            page_text = page.extract_text()
            if page_text:
                text_parts.append(page_text)
        return clean_extracted_text("\n\n".join(text_parts))
    except Exception as e:
        raise ValueError(f"Ошибка чтения PDF: {e}")


def _extract_docx(contents: bytes) -> str:
    try:
        from docx import Document
        doc = Document(io.BytesIO(contents))
        text_parts = []
        for para in doc.paragraphs:
            if para.text.strip():
                text_parts.append(para.text)
        return clean_extracted_text("\n".join(text_parts))
    except Exception as e:
        raise ValueError(f"Ошибка чтения DOCX: {e}")


def _extract_text(contents: bytes) -> str:
    # BOM must win over heuristic decoding. Without this, UTF-16 files are
    # decoded as CP1251 because CP1251 accepts every byte sequence.
    if contents.startswith((b"\xff\xfe", b"\xfe\xff", b"\xff\xfe\x00\x00", b"\x00\x00\xfe\xff")):
        return clean_extracted_text(contents.decode("utf-16" if not contents.startswith((b"\xff\xfe\x00\x00", b"\x00\x00\xfe\xff")) else "utf-32"))
    if contents.startswith(b"\xef\xbb\xbf"):
        return clean_extracted_text(contents.decode("utf-8-sig"))

    # UTF-16 without a BOM has a high NUL-byte ratio. Detect it before the
    # single-byte fallbacks so it cannot become readable-looking gibberish.
    sample = contents[:4096]
    if sample and sample.count(b"\x00") / len(sample) > 0.20:
        for encoding in ("utf-16-le", "utf-16-be"):
            try:
                return clean_extracted_text(contents.decode(encoding))
            except UnicodeDecodeError:
                pass

    for encoding in ("utf-8", "cp1251", "cp866", "latin-1"):
        try:
            decoded = contents.decode(encoding)
            cleaned = clean_extracted_text(decoded)
            if _looks_like_text(cleaned):
                return cleaned
        except UnicodeDecodeError:
            continue
    return clean_extracted_text(contents.decode("utf-8", errors="replace"))


def clean_extracted_text(text: str) -> str:
    """Remove transport/control noise while preserving normal Unicode text."""
    text = text.replace("\ufeff", "")
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = text.replace("\x00", "")
    text = re.sub(r"[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]", "", text)
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _looks_like_text(text: str) -> bool:
    if not text:
        return False
    replacement_count = text.count("\ufffd")
    if replacement_count > max(2, len(text) // 200):
        return False
    printable = sum(char.isprintable() or char in "\n\t" for char in text)
    return printable / len(text) >= 0.85


def _extract_html(contents: bytes) -> str:
    try:
        from bs4 import BeautifulSoup
        html_str = _extract_text(contents)
        soup = BeautifulSoup(html_str, "html.parser")
        
        # Remove script and style elements
        for script in soup(["script", "style", "header", "footer", "nav"]):
            script.decompose()
            
        # Get text
        text = soup.get_text(separator="\n")
        
        # Clean up spacing and empty lines
        lines = (line.strip() for line in text.splitlines())
        chunks = (phrase.strip() for line in lines for phrase in line.split("  "))
        text = "\n".join(chunk for chunk in chunks if chunk)
        
        return clean_extracted_text(text)
    except Exception as e:
        raise ValueError(f"Ошибка чтения HTML: {e}")
