import io
from typing import Optional


def extract_text(contents: bytes, filename: str) -> str:
    ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else "txt"

    if ext == "pdf":
        return _extract_pdf(contents)
    elif ext == "docx":
        return _extract_docx(contents)
    elif ext in ("html", "htm"):
        return _extract_html(contents)
    elif ext in ("txt", "md", "doc"):
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
        return "\n\n".join(text_parts)
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
        return "\n".join(text_parts)
    except Exception as e:
        raise ValueError(f"Ошибка чтения DOCX: {e}")


def _extract_text(contents: bytes) -> str:
    for encoding in ("utf-8", "cp1251", "latin-1"):
        try:
            return contents.decode(encoding)
        except UnicodeDecodeError:
            continue
    return contents.decode("utf-8", errors="replace")


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
        
        return text
    except Exception as e:
        raise ValueError(f"Ошибка чтения HTML: {e}")
