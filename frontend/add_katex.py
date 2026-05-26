import os
import glob
import re

files = [
    r"d:\Для пробной\frontend\src\components\ExpressPrepView.tsx",
    r"d:\Для пробной\frontend\src\components\SummaryView.tsx",
    r"d:\Для пробной\frontend\src\pages\Career.tsx",
    r"d:\Для пробной\frontend\src\pages\Chat.tsx",
    r"d:\Для пробной\frontend\src\pages\Courses.tsx",
    r"d:\Для пробной\frontend\src\pages\Missions.tsx",
    r"d:\Для пробной\frontend\src\pages\ProfessorExam.tsx",
    r"d:\Для пробной\frontend\src\pages\QuickPrep.tsx",
    r"d:\Для пробной\frontend\src\pages\SocialHub.tsx",
]

imports_to_add = """
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
""".strip()

for f in files:
    with open(f, 'r', encoding='utf-8') as file:
        content = file.read()

    # Skip if already added
    if 'remark-math' in content:
        continue

    # Add imports after the react-markdown import
    content = re.sub(
        r"(import ReactMarkdown from 'react-markdown';)", 
        r"\1\n" + imports_to_add, 
        content
    )

    # Add plugins to ReactMarkdown tags that don't have them
    content = re.sub(
        r'<ReactMarkdown>',
        r'<ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>',
        content
    )
    
    # Also handle <ReactMarkdown children={...} className={...} />
    content = re.sub(
        r'<ReactMarkdown(\s+)',
        r'<ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}\1',
        content
    )
    # Fix double injections just in case
    content = content.replace(
        '<ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]} remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}',
        '<ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}'
    )

    with open(f, 'w', encoding='utf-8') as file:
        file.write(content)

print("Updated ReactMarkdown in files!")
