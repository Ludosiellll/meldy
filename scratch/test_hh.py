import asyncio
import os
import sys

# Add both parent directory and current directory to python path
sys.path.append(os.path.abspath('.'))
sys.path.append(os.path.abspath('..'))

from main import fetch_structured_vacancies

async def test():
    print("Testing fetch_structured_vacancies for 'Backend-разработчик' in 'Минск'...")
    vacs = await fetch_structured_vacancies("Backend-разработчик", "Минск")
    print(f"Results: {len(vacs)} items.")
    for idx, v in enumerate(vacs):
        print(f"\n[{idx+1}] {v.get('title')} in {v.get('company')}")
        print(f"    Salary: {v.get('salary')}")
        print(f"    URL: {v.get('url')}")
        print(f"    Source: {v.get('source')}")

asyncio.run(test())
