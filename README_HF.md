---
title: StudyForge — AI-анализ учебных материалов
emoji: 🎓
colorFrom: indigo
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
---

# StudyForge — AI-анализ учебных материалов

Три AI-агента параллельно создают конспект, карточки и тест из любой лекции.

## Использование

1. Откройте приложение
2. Загрузите PDF/DOCX/TXT файл или нажмите «Демо без файла»
3. Дождитесь завершения анализа (~15 сек)
4. Изучайте конспект, карточки и тест

## Переменные окружения

Установите в Settings → Repository secrets:

- `GROQ_API_KEY` — ключ API от [console.groq.com](https://console.groq.com) (бесплатно)
- `GEMINI_API_KEY` — ключи API от Google AI Studio (для аудио/подкастов). Можно указать несколько ключей через запятую для обхода лимитов.
