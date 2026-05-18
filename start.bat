@echo off
echo ================================
echo  AI Student Assistant Launcher
echo ================================
echo.

set /p GROQ_API_KEY="Введите Groq API Key: "

echo.
echo Запуск бэкенда на http://localhost:8000 ...
start "Backend" cmd /k "cd /d %~dp0backend && set GROQ_API_KEY=%GROQ_API_KEY% && python -m uvicorn main:app --reload --port 8000"

timeout /t 3 /nobreak >nul

echo Запуск фронтенда на http://localhost:3000 ...
start "Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"

echo.
echo ================================
echo  Готово! Откройте http://localhost:3000
echo ================================
pause
