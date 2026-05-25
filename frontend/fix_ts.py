import os
import re

def fix_file(path, replacements):
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    for old, new in replacements:
        content = content.replace(old, new)
        
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)

base = r"d:\Для пробной\frontend\src"

fix_file(os.path.join(base, "api", "flashcards.ts"), [
    ("(r: Flashcard)", "(r: any)"),
    ("(c: Flashcard)", "(c: any)")
])

fix_file(os.path.join(base, "api", "quests.ts"), [
    ("(e: ExamResult)", "(e: any)"),
    ("(a: number, s: StudySession) => a + (s.cards_reviewed ?? 0)", "(a: number, s: StudySession) => a + (s.cards_reviewed || 0)")
])

fix_file(os.path.join(base, "components", "ExpressPrepView.tsx"), [
    ("summaryJson: SummaryInfo", "summaryJson: any")
])

fix_file(os.path.join(base, "components", "FlashcardsView.tsx"), [
    ("import { FlashcardsInfo, Flashcard } from '../types';", "import { FlashcardsInfo, Flashcard } from '../types/index';"),
    ("import { FlashcardsInfo, Flashcard } from './types';", "import { FlashcardsInfo, Flashcard } from '../types/index';"),
    ("import {  } from '../types';", "import { FlashcardsInfo, Flashcard } from '../types/index';")
])
# Add explicit import if missing
with open(os.path.join(base, "components", "FlashcardsView.tsx"), 'r', encoding='utf-8') as f:
    c = f.read()
    if 'FlashcardsInfo' not in c[:300]:
        c = "import { FlashcardsInfo, Flashcard } from '../types/index';\n" + c
        with open(os.path.join(base, "components", "FlashcardsView.tsx"), 'w', encoding='utf-8') as fw:
            fw.write(c)

fix_file(os.path.join(base, "components", "QuizView.tsx"), [
    ("data: QuizInfo", "data: any") # to fix error/raw
])

fix_file(os.path.join(base, "components", "ResultsPanel.tsx"), [
    ("results.summarizer?.raw", "(results.summarizer as any)?.raw")
])

fix_file(os.path.join(base, "components", "SummaryView.tsx"), [
    ("data?.raw", "(data as any)?.raw")
])

fix_file(os.path.join(base, "pages", "Analytics.tsx"), [
    ("subject: e.subject", "subject: (e as any).subject")
])

with open(os.path.join(base, "pages", "Career.tsx"), 'r', encoding='utf-8') as f:
    c = f.read()
    if 'Term' not in c[:300]:
        c = "import { Term } from '../types/index';\n" + c
        with open(os.path.join(base, "pages", "Career.tsx"), 'w', encoding='utf-8') as fw:
            fw.write(c)
            
fix_file(os.path.join(base, "pages", "Dashboard.tsx"), [
    ("s.cards_reviewed;", "s.cards_reviewed || 0;"),
    ("(c: Flashcard)", "(c: any)")
])

fix_file(os.path.join(base, "pages", "KnowledgeMap.tsx"), [
    ("summaryJson?.raw", "(summaryJson as any)?.raw"),
    ("(details as string)", "String(details)"),
    ("new Date(details)", "new Date(details as string)"),
    ("Object.keys(details)", "Object.keys(details as any)"),
    ("details[key]", "(details as any)[key]")
])

fix_file(os.path.join(base, "pages", "Library.tsx"), [
    ("<Material[]>", "<any[]>")
])

fix_file(os.path.join(base, "pages", "ProfessorExam.tsx"), [
    ("event: unknown", "event: any"),
    ("e: unknown", "e: any"),
    ("err: unknown", "err: any")
])
