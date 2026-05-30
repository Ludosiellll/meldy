import os
import re

# Define the replacements map
replacements = {
    "slate-150": "slate-100",
    "slate-250": "slate-200",
    "slate-350": "slate-300",
    "slate-405": "slate-400",
    "slate-450": "slate-400",
    "slate-550": "slate-500",
    "slate-750": "slate-700",
    "slate-805": "slate-800",
    "indigo-150": "indigo-100",
    "indigo-550": "indigo-500",
    "indigo-650": "indigo-600",
    "violet-650": "violet-600"
}

src_dir = "src"

def fix_file(filepath):
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            content = f.read()
        
        modified = False
        new_content = content
        for original, target in replacements.items():
            if original in new_content:
                # Use regex or simple replace
                # We want to replace occurrences in classNames or style classes
                new_content = new_content.replace(original, target)
                modified = True
        
        if modified:
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(new_content)
            print(f"Fixed: {filepath}")
    except Exception as e:
        print(f"Error reading/writing {filepath}: {e}")

def main():
    print("Scanning frontend/src directory for invalid Tailwind classes...")
    for root, dirs, files in os.walk(src_dir):
        for file in files:
            if file.endswith((".tsx", ".ts", ".css")):
                filepath = os.path.join(root, file)
                fix_file(filepath)
    print("Tailwind classes cleanup completed!")

if __name__ == "__main__":
    main()
