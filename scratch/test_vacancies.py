import asyncio
import httpx
import re

async def fetch_hh_vacancies(profession: str, location: str = "") -> str:
    url = "https://api.hh.ru/vacancies"
    headers = {
        "User-Agent": "StudyForgeSuperAppDynamicLudosiel/1.0 (denislabyncev935@gmail.com)"
    }
    query_text = f"{profession} {location}".strip()
    params = {
        "text": query_text,
        "per_page": 12,
        "only_with_salary": "true"
    }
    
    async with httpx.AsyncClient() as client:
        response = await client.get(url, headers=headers, params=params, timeout=8.0)
        print(f"HH status: {response.status_code}")
        if response.status_code != 200:
            raise Exception(f"HH API returned status {response.status_code}, text: {response.text[:200]}")
        data = response.json()
        items = data.get("items", [])
        print(f"HH items count: {len(items)}")
        if not items:
            raise Exception("No vacancies found on HH")
        return "HH OK"

async def fetch_trudvsem_vacancies(profession: str, location: str = "") -> str:
    url = "https://opendata.trudvsem.ru/api/v1/vacancies"
    query_text = f"{profession} {location}".strip()
    params = {
        "text": query_text,
        "limit": 10
    }
    async with httpx.AsyncClient() as client:
        response = await client.get(url, params=params, timeout=8.0)
        print(f"TrudVsem status: {response.status_code}")
        if response.status_code != 200:
            raise Exception(f"TrudVsem API returned status {response.status_code}")
        data = response.json()
        results = data.get("results", {})
        vacancies = results.get("vacancies", [])
        print(f"TrudVsem vacancies count: {len(vacancies)}")
        if not vacancies:
            raise Exception("No vacancies found on TrudVsem")
        return "TrudVsem OK"

async def main():
    try:
        print("Testing HH with 'Frontend-разработчик' in 'Москва'")
        res = await fetch_hh_vacancies("Frontend-разработчик", "Москва")
        print(res)
    except Exception as e:
        print(f"HH failed: {e}")
        
    try:
        print("\nTesting TrudVsem with 'Frontend-разработчик' in 'Москва'")
        res = await fetch_trudvsem_vacancies("Frontend-разработчик", "Москва")
        print(res)
    except Exception as e:
        print(f"TrudVsem failed: {e}")

if __name__ == "__main__":
    asyncio.run(main())
