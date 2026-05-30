import os
import asyncio
from dotenv import load_dotenv

# Load env variables from backend/.env
load_dotenv(dotenv_path='backend/.env')

import sys
# Add absolute path to backend and current folder
sys.path.append(os.path.abspath('backend'))
sys.path.append(os.path.abspath('backend/agents'))

from agents.career_course import CareerCourseAgent

async def main():
    api_key = os.getenv("GROQ_API_KEY")
    print(f"GROQ_API_KEY exists: {bool(api_key)}")
    if not api_key:
        print("ERROR: GROQ_API_KEY is not set.")
        return
        
    agent = CareerCourseAgent(api_key=api_key)
    
    profession = "Frontend-разработчик"
    level = "Junior"
    salary = "120000"
    user_materials = "Студент изучал HTML, CSS и базовый JavaScript."
    vacancy_text = """
    - Frontend Developer (Зарплата: от 100000 RUR)
      Требования: Знание HTML5, CSS3, ES6+, React, TypeScript, адаптивная верстка.
      Обязанности: Разработка интерфейсов, рефакторинг кода, интеграция с REST API.
    """
    
    try:
        print("Generating course...")
        course_data = await agent.generate_course(
            profession=profession,
            level=level,
            salary=salary,
            user_materials=user_materials,
            vacancy_context=vacancy_text,
            age=23,
            gender="Мужской",
            location="Москва",
            extra_context="совмещаю с основной работой, 2 часа в день"
        )
        print("SUCCESS! Generated course keys:", list(course_data.keys()))
        if "modules" in course_data:
            print(f"Modules count: {len(course_data['modules'])}")
            print("First module sample:")
            import json
            print(json.dumps(course_data['modules'][0], indent=2, ensure_ascii=False)[:600])
    except Exception as e:
        print(f"FAILED with error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(main())
