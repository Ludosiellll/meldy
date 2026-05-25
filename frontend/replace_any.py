import os
import re

SRC_DIR = r"d:\Для пробной\frontend\src"

def process_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    original = content

    # Add imports to top if we use these types
    types_to_import = set()

    if 'flashcards.ts' in filepath:
        content = content.replace('cards: any[]', 'cards: Flashcard[]')
        content = content.replace('(r: any)', '(r: Flashcard)')
        content = content.replace('(c: any)', '(c: Flashcard)')
        types_to_import.add('Flashcard')
        
    elif 'quests.ts' in filepath:
        content = content.replace('(s: any)', '(s: StudySession)')
        content = content.replace('(e: any)', '(e: ExamResult)')
        types_to_import.update(['StudySession', 'ExamResult'])

    elif 'AgentCards.tsx' in filepath:
        content = content.replace('icon: any;', 'icon: React.ElementType;')
        
    elif 'ExpressPrepView.tsx' in filepath:
        content = content.replace('summaryJson: any', 'summaryJson: SummaryInfo')
        types_to_import.add('SummaryInfo')

    elif 'FlashcardsView.tsx' in filepath:
        content = content.replace('data: any', 'data: FlashcardsInfo')
        content = content.replace('(_: any, i: number)', '(_: Flashcard, i: number)')
        content = content.replace('(c: any, i: number)', '(c: Flashcard, i: number)')
        types_to_import.update(['FlashcardsInfo', 'Flashcard'])

    elif 'QuizView.tsx' in filepath:
        content = content.replace('data: any', 'data: QuizInfo')
        content = content.replace('(q: any, i: number)', '(q: QuizQuestion, i: number)')
        types_to_import.update(['QuizInfo', 'QuizQuestion'])

    elif 'ResultsPanel.tsx' in filepath:
        content = content.replace('(c: any, i: number)', '(c: Flashcard, i: number)')
        content = content.replace('(q: any, i: number)', '(q: QuizQuestion, i: number)')
        types_to_import.update(['Flashcard', 'QuizQuestion'])

    elif 'SummaryView.tsx' in filepath:
        content = content.replace('data: any', 'data: SummaryInfo')
        types_to_import.add('SummaryInfo')

    elif 'Analytics.tsx' in filepath:
        content = content.replace('(a: any)', '(a: Achievement)')
        content = content.replace('(s: any)', '(s: StudySession)')
        content = content.replace('(e: any, i)', '(e: ExamResult, i: number)')
        content = content.replace('(m: any)', '(m: Mistake)')
        content = content.replace('(a: number, s: any)', '(a: number, s: StudySession)')
        content = content.replace('(v: number, _: any, props: any)', '(v: number, _: unknown, props: any)')
        types_to_import.update(['Achievement', 'StudySession', 'ExamResult', 'Mistake'])

    elif 'Analyze.tsx' in filepath:
        content = content.replace('catch (err: any)', 'catch (err: Error | any)')
        content = content.replace('handleSSE = (d: any)', 'handleSSE = (d: Record<string, any>)')

    elif 'Career.tsx' in filepath:
        content = content.replace('(t: any)', '(t: Term)')
        types_to_import.add('Term')

    elif 'Dashboard.tsx' in filepath:
        content = content.replace('icon: any;', 'icon: React.ElementType;')
        content = content.replace('(s: any)', '(s: StudySession)')
        content = content.replace('(c: any)', '(c: Flashcard)')
        content = content.replace('(m: any)', '(m: Material)')
        types_to_import.update(['StudySession', 'Flashcard', 'Material'])

    elif 'KnowledgeMap.tsx' in filepath:
        content = content.replace('details?: any;', 'details?: any;')
        content = content.replace('summaryJson: any', 'summaryJson: SummaryInfo')
        content = content.replace('(t: any)', '(t: Term)')
        types_to_import.update(['SummaryInfo', 'Term'])

    elif 'MaterialDetail.tsx' in filepath:
        content = content.replace('(prev: any)', '(prev: Material)')
        content = content.replace('material: any', 'material: Material')
        content = content.replace('setMaterial: any', 'setMaterial: React.Dispatch<React.SetStateAction<Material | null>>')
        types_to_import.add('Material')

    elif 'Messages.tsx' in filepath:
        content = content.replace('material: any', 'material: Material')
        types_to_import.add('Material')

    elif 'Planner.tsx' in filepath:
        content = content.replace('(s: any)', '(s: any)')
        content = content.replace('(t: any)', '(t: any)')
        content = content.replace('(day: any, i: number)', '(day: any, i: number)')
        content = content.replace('(sum: number, t: any)', '(sum: number, t: any)')
        content = content.replace('(task: any, j: number)', '(task: any, j: number)')
    
    elif 'Library.tsx' in filepath:
        content = content.replace('<any[]>', '<Material[]>')
        types_to_import.add('Material')
        
    elif 'SocialHub.tsx' in filepath:
        content = content.replace('searchResults: any[]', 'searchResults: any[]')
        
    if content != original:
        if types_to_import:
            # find depth
            depth = filepath.replace(SRC_DIR, '').count(os.sep)
            prefix = '../' * (depth - 1) if depth > 1 else './'
            if depth == 1:
                prefix = './'
            import_stmt = f"import {{ {', '.join(types_to_import)} }} from '{prefix}types';\n"
            # insert after last import
            last_import_idx = content.rfind('import ')
            if last_import_idx != -1:
                end_of_line = content.find('\\n', last_import_idx)
                if end_of_line != -1:
                    content = content[:end_of_line+1] + import_stmt + content[end_of_line+1:]
                else:
                    content = import_stmt + content
            else:
                content = import_stmt + content

        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"Updated {filepath}")

for root, _, files in os.walk(SRC_DIR):
    for file in files:
        if file.endswith(('.ts', '.tsx')) and file != 'index.ts' and file != 'types.ts':
            process_file(os.path.join(root, file))

