import os, base64, json

BASE = r"d:\Для пробной\frontend\src"
os.makedirs(os.path.join(BASE, "components"), exist_ok=True)

files = json.load(open(os.path.join(os.path.dirname(__file__), "frontend_files.json"), encoding="utf-8"))
for path, b64 in files.items():
    full = os.path.join(BASE, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "wb") as f:
        f.write(base64.b64decode(b64))
    print(f"OK: {path}")
print("DONE")
