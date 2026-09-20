import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Copy, Download, RotateCcw, FileText, Layers, HelpCircle, Gamepad2, Edit3, ShieldCheck, AlertTriangle, Check, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { AnalysisResults, QuizQuestion, Flashcard } from '../types';
import SummaryView from './SummaryView';
import FlashcardsView from './FlashcardsView';
import QuizView from './QuizView';
import toast from 'react-hot-toast';
import { updateMaterialTitle } from '../api/materials';
import { getResultDisplayTitle } from '../utils/resultPresentation';

type Tab = 'summary' | 'flashcards' | 'quiz' | 'missions' | 'podcast' | 'shorts';

const AGENT_LABELS: Record<string, string> = {
  summarizer: 'Конспект',
  flashcards: 'Карточки',
  quiz: 'Тест',
  cheatsheet: 'Шпаргалка',
  podcast: 'Подкаст',
  missions: 'Миссии',
};

function extractCleanContent(data: any): string {
  let raw = data?.content || (data as any)?.raw || '';
  if (typeof raw === 'string' && raw.trimStart().startsWith('{')) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.content) raw = parsed.content;
    } catch {
      const match = raw.match(/"content"\s*:\s*"([\s\S]*?)(?:"\s*[,}])/);
      if (match) raw = match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
    }
  }
  if (!raw && typeof data === 'string') {
    raw = data;
    if (raw.trimStart().startsWith('{')) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed?.content) raw = parsed.content;
      } catch {}
    }
  }
  const jsonTailIdx = raw.search(/\s*[,"]?\s*"terms"\s*:/);
  if (jsonTailIdx > 0) raw = raw.slice(0, jsonTailIdx);
  return raw.trim();
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function parseMarkdownToHtml(md: string): string {
  if (!md) return '';
  let html = escapeHtml(md).replace(/\r\n/g, '\n');
  
  // Headers
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
  
  // Bold
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  
  // Italic
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
  
  // Bullet lists & numbered lists line-by-line
  let lines = html.split('\n');
  let inList = false;
  let inOrderedList = false;
  
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (line.startsWith('* ') || line.startsWith('- ')) {
      let content = line.substring(2);
      if (!inList) {
        lines[i] = '<ul>\n<li>' + content + '</li>';
        inList = true;
      } else {
        lines[i] = '<li>' + content + '</li>';
      }
    } else if (/^\d+\.\s/.test(line)) {
      let content = line.replace(/^\d+\.\s/, '');
      if (!inOrderedList) {
        lines[i] = '<ol>\n<li>' + content + '</li>';
        inOrderedList = true;
      } else {
        lines[i] = '<li>' + content + '</li>';
      }
    } else {
      let extra = '';
      if (inList) {
        extra += '</ul>\n';
        inList = false;
      }
      if (inOrderedList) {
        extra += '</ol>\n';
        inOrderedList = false;
      }
      
      if (line !== '' && !line.startsWith('<h') && !line.startsWith('<ul') && !line.startsWith('<ol') && !line.startsWith('<li')) {
        lines[i] = extra + '<p>' + line + '</p>';
      } else {
        lines[i] = extra + lines[i];
      }
    }
  }
  
  html = lines.join('\n');
  if (inList) html += '\n</ul>';
  if (inOrderedList) html += '\n</ol>';
  
  return html;
}

function buildHtmlExport(results: AnalysisResults, displayTitle: string): string {
  const date = new Date().toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const time = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  
  const cleanSummary = extractCleanContent(results.summarizer);
  const summaryHtml = parseMarkdownToHtml(cleanSummary) || '<p style="color:#94a3b8">Нет данных</p>';
  
  const flashcards = results.flashcards?.flashcards || [];
  const quiz = results.quiz?.quiz || [];

  const flashcardsHtml = flashcards.map((c: Flashcard, i: number) =>
    `<div class="card">
      <p class="card-q">Карточка ${i+1}: ${escapeHtml(c.question)}</p>
      <p class="card-a">${escapeHtml(c.answer)}</p>
    </div>`
  ).join('\n');

  const quizHtml = quiz.map((q: QuizQuestion, i: number) => {
    const options = (q.options || []).map((o: string) => {
      const isCorrect = o.startsWith(q.correct);
      return `<li class="${isCorrect ? 'correct' : ''}">${escapeHtml(o)}${isCorrect ? ' ✓' : ''}</li>`;
    }).join('\n');
    return `<div class="card">
      <p class="card-q">${i+1}. ${escapeHtml(q.question)}</p>
      <ul class="opt-list">${options}</ul>
      ${q.explanation ? `<p class="explanation">Пояснение: ${escapeHtml(q.explanation)}</p>` : ''}
    </div>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>StudyForge — ${escapeHtml(displayTitle)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
    color: #1e293b;
    line-height: 1.7;
    max-width: 760px;
    margin: 0 auto;
    padding: 48px 32px 64px;
    background: #fff;
    font-size: 15px;
  }
  /* Header */
  .doc-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding-bottom: 20px;
    margin-bottom: 28px;
    border-bottom: 1px solid #e2e8f0;
  }
  .doc-logo {
    width: 36px; height: 36px;
    background: #0f766e;
    border-radius: 8px;
    display: flex; align-items: center; justify-content: center;
    color: white; font-weight: 900; font-size: 16px;
    letter-spacing: -1px; flex-shrink: 0;
  }
  .doc-header-text h1 {
    font-size: 13px; font-weight: 700;
    color: #0f766e; letter-spacing: 0.05em;
    text-transform: uppercase; margin: 0;
  }
  .doc-header-text p {
    font-size: 12px; color: #94a3b8; margin: 0;
  }
  /* Material title */
  .doc-title {
    font-size: 22px;
    font-weight: 800;
    color: #0f172a;
    line-height: 1.3;
    margin-bottom: 6px;
  }
  .doc-meta {
    color: #94a3b8;
    font-size: 13px;
    margin-bottom: 36px;
  }
  /* Section headings */
  h2 {
    font-size: 17px;
    font-weight: 700;
    margin: 36px 0 16px;
    padding-bottom: 10px;
    border-bottom: 2px solid #0f766e;
    color: #0f172a;
  }
  h3 {
    font-size: 14px;
    font-weight: 700;
    margin: 18px 0 8px;
    color: #334155;
  }
  p { margin-bottom: 12px; color: #334155; }
  ul, ol { margin-bottom: 16px; padding-left: 22px; color: #334155; }
  li { margin-bottom: 5px; }
  strong { color: #0f172a; font-weight: 600; }
  .section { margin-bottom: 24px; }

  /* Cards (flashcards, quiz) */
  .card {
    margin-bottom: 14px;
    padding: 16px;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    page-break-inside: avoid;
  }
  .card-q {
    font-weight: 600;
    color: #0f172a;
    margin-bottom: 8px;
    font-size: 14px;
  }
  .card-a {
    color: #334155;
    border-top: 1px solid #f1f5f9;
    padding-top: 8px;
    font-size: 14px;
  }
  .opt-list {
    list-style: none;
    padding: 0;
    margin: 6px 0 0;
  }
  .opt-list li {
    padding: 6px 12px;
    margin: 4px 0;
    border-radius: 6px;
    font-size: 13px;
    background: #f8fafc;
    color: #334155;
  }
  .opt-list li.correct {
    background: #d1fae5;
    font-weight: 600;
    color: #065f46;
  }
  .explanation {
    margin-top: 8px;
    font-style: italic;
    color: #64748b;
    font-size: 13px;
    border-top: 1px solid #f1f5f9;
    padding-top: 8px;
  }
  @media print {
    body { padding: 0 24px; }
    .doc-header { page-break-after: avoid; }
    h2 { page-break-after: avoid; }
    .section { page-break-inside: avoid; }
    .card { page-break-inside: avoid; }
  }
</style>
</head>
<body>
<div class="doc-header">
  <div class="doc-logo">SF</div>
  <div class="doc-header-text">
    <h1>StudyForge</h1>
    <p>Материал подготовлен ${date}, ${time}</p>
  </div>
</div>

<h2 class="doc-title" style="border:none;margin-top:0;padding-bottom:0;font-size:22px">${escapeHtml(displayTitle)}</h2>
<p class="doc-meta">${date}</p>

<div class="section">
<h2>Конспект</h2>
<div style="line-height:1.8">${summaryHtml}</div>
</div>

${flashcards.length > 0 ? `<div class="section">
<h2>Карточки (${flashcards.length})</h2>
${flashcardsHtml}
</div>` : ''}

${quiz.length > 0 ? `<div class="section">
<h2>Тест (${quiz.length})</h2>
${quizHtml}
</div>` : ''}

</body>
</html>`;
}

export default function ResultsPanel({ results, onReset, textLength, analysisDuration, sourceFileName, materialId, embedded = false }: {
  results: AnalysisResults; onReset: () => void; textLength?: number; analysisDuration?: number; sourceFileName?: string; materialId?: string; embedded?: boolean;
}) {
  const [tab, setTab] = useState<Tab>('summary');
  const [copied, setCopied] = useState(false);
  const [showExport, setShowExport] = useState(false);

  const derivedTitle = useMemo(
    () => getResultDisplayTitle(results, sourceFileName),
    [results, sourceFileName],
  );
  const [currentTitle, setCurrentTitle] = useState(derivedTitle);
  const [isEditing, setIsEditing] = useState(false);
  const [editVal, setEditVal] = useState(derivedTitle);

  const flashcardCount = results.flashcards?.flashcards?.length || 0;
  const quizCount = results.quiz?.quiz?.length || 0;
  const exerciseCount = flashcardCount + quizCount;
  const readingMinutes = textLength ? Math.max(1, Math.round(textLength / 800)) : null;

  const tabs = useMemo(() => {
    const rawTabs: { id: Tab; label: string; icon: JSX.Element; count?: number }[] = [
      { id: 'summary', label: 'Конспект', icon: <FileText className="w-4 h-4" /> },
      { id: 'flashcards', label: 'Карточки', icon: <Layers className="w-4 h-4" />, count: flashcardCount },
      { id: 'quiz', label: 'Тест', icon: <HelpCircle className="w-4 h-4" />, count: quizCount },
      { id: 'missions', label: 'Миссии', icon: <Gamepad2 className="w-4 h-4" /> },
    ];

    return rawTabs.filter(t => {
      if (t.id === 'summary') return !!(results.summarizer?.content || (results.summarizer as { raw?: string })?.raw);
      if (t.id === 'flashcards') return flashcardCount > 0;
      if (t.id === 'quiz') return quizCount > 0;
      if (t.id === 'missions') return !!(results.missions?.missions?.length || (results.missions as unknown as { length?: number })?.length);
      return true;
    });
  }, [results, flashcardCount, quizCount]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (!(e.target as Element).closest('.export-menu-container')) {
        setShowExport(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (tabs.length > 0 && !tabs.find(t => t.id === tab)) {
      setTab(tabs[0].id);
    }
  }, [tab, tabs]);

  useEffect(() => {
    setCurrentTitle(derivedTitle);
    setEditVal(derivedTitle);
  }, [derivedTitle]);

  const saveManualTitle = async () => {
    if (!materialId || !editVal.trim()) return;
    try {
      await updateMaterialTitle(materialId, editVal.trim());
      setCurrentTitle(editVal.trim());
      setIsEditing(false);
      toast.success('Название сохранено');
    } catch (e) {
      toast.error('Не удалось сохранить название');
    }
  };



  const getContent = () => {
    if (tab === 'summary') return results.summarizer?.content || (results.summarizer as any)?.raw || '';
    if (tab === 'flashcards') return JSON.stringify(results.flashcards?.flashcards || results.flashcards, null, 2);
    if (tab === 'missions') return JSON.stringify(results.missions?.missions || results.missions, null, 2);
    return JSON.stringify(results.quiz?.quiz || results.quiz, null, 2);
  };

  const handleCopy = () => { navigator.clipboard.writeText(getContent()); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  const handleDownloadHtml = () => {
    const baseName = currentTitle.replace(/[\\/:*?"<>|]+/g, '_');
    const dateStr = new Date().toISOString().slice(0, 10);
    const html = buildHtmlExport(results, currentTitle);
    const b = new Blob([html], { type: 'text/html' });
    const u = URL.createObjectURL(b);
    const a = document.createElement('a');
    a.href = u;
    a.download = `studyforge_${baseName}_${dateStr}.html`;
    a.click();
    URL.revokeObjectURL(u);
  };

  const handleExportAnki = () => {
    try {
      const cards = results.flashcards?.flashcards || results.flashcards || [];
      const tsv = cards.map((c: any) => `${c.question.replace(/\n/g, ' ')}\t${c.answer.replace(/\n/g, '<br>')}`).join('\n');
      
      const b = new Blob([tsv], { type: 'text/tab-separated-values;charset=utf-8' });
      const u = URL.createObjectURL(b);
      const a = document.createElement('a');
      a.href = u;
      const baseName = (sourceFileName || 'deck').replace(/\.[^.]+$/, '');
      a.download = `studyforge_${baseName}.txt`;
      a.click();
      URL.revokeObjectURL(u);
    } catch (err) {
      console.error(err);
      toast.error('Ошибка при экспорте Anki');
    }
  };

  const handlePrintPdf = () => {
    // Build a standalone printable HTML page in isolation so that none of the
    // app's UI (sidebar, header, audio players, etc.) leaks into the PDF.
    const html = buildHtmlExport(results, currentTitle);
    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) {
      toast.error('Разрешите открытие всплывающих окон в браузере для печати.');
      return;
    }
    win.document.write(html);
    win.document.close();
    // Small delay to allow fonts/styles to load before printing
    setTimeout(() => {
      win.focus();
      win.print();
    }, 600);
  };

  return (
    <div className="py-4 md:py-6">
      <header className="border-b border-slate-200 dark:border-slate-800 pb-5 md:pb-6 no-print">
        <div className={`flex flex-col gap-5 ${embedded ? 'sm:flex-row sm:justify-end' : 'lg:flex-row lg:items-start lg:justify-between'}`}>
          {!embedded && (
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                Материал обработан
              </div>

              {isEditing ? (
                <div className="flex max-w-2xl items-center gap-2">
                  <input
                    type="text"
                    value={editVal}
                    onChange={event => setEditVal(event.target.value)}
                    onKeyDown={event => {
                      if (event.key === 'Enter') saveManualTitle();
                      if (event.key === 'Escape') setIsEditing(false);
                    }}
                    className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-lg font-semibold text-slate-900 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    placeholder="Название материала"
                    aria-label="Название материала"
                    autoFocus
                  />
                  <button onClick={saveManualTitle} className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-teal-600 text-white transition hover:bg-teal-500" aria-label="Сохранить название">
                    <Check className="h-4 w-4" />
                  </button>
                  <button onClick={() => setIsEditing(false)} className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-300 text-slate-500 transition hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800" aria-label="Отменить изменение">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <div className="group flex min-w-0 items-start gap-2">
                  <h1 className="max-w-3xl text-balance text-2xl font-semibold leading-tight tracking-[-0.02em] text-slate-950 dark:text-slate-50 md:text-3xl">
                    {currentTitle}
                  </h1>
                  {materialId && (
                    <button
                      onClick={() => { setEditVal(currentTitle); setIsEditing(true); }}
                      className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-400 opacity-70 transition hover:bg-slate-100 hover:text-teal-700 focus-visible:opacity-100 dark:hover:bg-slate-800 dark:hover:text-teal-300 md:opacity-0 md:group-hover:opacity-100"
                      aria-label="Изменить название"
                    >
                      <Edit3 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                {textLength ? <span>{textLength.toLocaleString('ru-RU')} символов</span> : null}
                {textLength && readingMinutes ? <span aria-hidden="true">·</span> : null}
                {readingMinutes ? <span>около {readingMinutes} мин чтения</span> : null}
                {exerciseCount > 0 ? <span aria-hidden="true">·</span> : null}
                {exerciseCount > 0 ? <span>{exerciseCount} заданий для практики</span> : null}
                {!textLength && analysisDuration ? <span>{analysisDuration} сек на обработку</span> : null}
              </div>
            </div>
          )}

          <div className="flex w-full items-center gap-2 sm:w-auto sm:justify-end">
            <div className="relative export-menu-container">
              <button
                onClick={() => setShowExport(value => !value)}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-transparent px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                aria-expanded={showExport}
              >
                <Download className="h-4 w-4" />
                <span>Экспорт</span>
              </button>

              <AnimatePresence>
                {showExport && (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 6 }}
                    transition={{ duration: 0.12 }}
                    className="absolute right-0 top-full z-50 mt-2 flex w-56 flex-col gap-1 rounded-lg border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-850"
                  >
                    <button onClick={() => { handleCopy(); setShowExport(false); }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
                      <Copy className="h-4 w-4" />{copied ? 'Скопировано' : 'Копировать'}
                    </button>
                    {(tab === 'summary' || tab === 'flashcards' || tab === 'quiz') && (
                      <button onClick={() => { handlePrintPdf(); setShowExport(false); }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
                        <Download className="h-4 w-4" />Печать или PDF
                      </button>
                    )}
                    {tab === 'flashcards' && (
                      <button onClick={() => { handleExportAnki(); setShowExport(false); }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
                        <Download className="h-4 w-4" />Файл для Anki
                      </button>
                    )}
                    {(tab === 'summary' || tab === 'flashcards' || tab === 'quiz') && (
                      <button onClick={() => { handleDownloadHtml(); setShowExport(false); }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
                        <Download className="h-4 w-4" />Скачать HTML
                      </button>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <button onClick={onReset} className="inline-flex h-10 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-cyan-400 px-4 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-950 sm:flex-none">
              <RotateCcw className="h-4 w-4" />Новый анализ
            </button>
          </div>
        </div>

        {results.grounding?.source_count ? (
          <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
            <ShieldCheck className="h-4 w-4 text-teal-600 dark:text-teal-400" />
            <span>Основано на {results.grounding.source_count} фрагментах исходника</span>
            {results.grounding.citable_items > 0 ? (
              <><span aria-hidden="true">·</span><span>{results.grounding.citable_items} подтверждённых связей</span></>
            ) : null}
          </div>
        ) : null}

        {!!results.warnings?.length && (
          <div className="mt-4 space-y-2" role="status">
            {results.warnings.map(warning => (
              <p key={warning.agent} className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Раздел «{AGENT_LABELS[warning.agent] || warning.agent}» не создан. Остальные результаты доступны.
              </p>
            ))}
          </div>
        )}
      </header>

      {tabs.length > 1 && (
        <nav className="no-print -mx-4 flex overflow-x-auto border-b border-slate-200 px-4 dark:border-slate-800 md:mx-0 md:px-0" aria-label="Разделы результата">
          {tabs.map(item => {
            const isActive = tab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setTab(item.id)}
                className={`relative flex shrink-0 items-center gap-2 border-b-2 px-1 py-4 text-sm font-medium transition ${isActive ? 'border-cyan-400 text-slate-950 dark:text-white' : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'}`}
                aria-current={isActive ? 'page' : undefined}
              >
                {item.icon}
                <span>{item.label}</span>
                {item.count !== undefined ? <span className="text-xs tabular-nums text-slate-400">{item.count}</span> : null}
              </button>
            );
          })}
        </nav>
      )}

      <motion.div key={tab} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className={`${tabs.length > 1 ? 'pt-6' : 'pt-7'} min-h-[260px] printable-section`}>
        {tab === 'summary' && (
          <article className="max-w-[820px]">
            <SummaryView data={results.summarizer} sources={results.grounding?.sources} />
          </article>
        )}
        {tab === 'flashcards' && <FlashcardsView data={results.flashcards} sources={results.grounding?.sources} />}
        {tab === 'quiz' && <QuizView data={results.quiz} sources={results.grounding?.sources} />}
        {tab === 'missions' && (
          <div className="flex min-h-[260px] max-w-xl flex-col items-start justify-center border-y border-slate-200 py-10 dark:border-slate-800">
            <Gamepad2 className="mb-4 h-7 w-7 text-teal-600 dark:text-teal-400" />
            <h2 className="text-xl font-semibold text-slate-950 dark:text-slate-50">Учебная миссия</h2>
            <p className="mt-2 max-w-md text-sm leading-6 text-slate-600 dark:text-slate-400">Пройдите короткий сценарий по материалу и проверьте, как применяются ключевые идеи.</p>
            <Link to={materialId ? `/play?materialId=${materialId}` : '/play'} className="mt-5 inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-500">
              Начать миссию
            </Link>
          </div>
        )}
      </motion.div>
    </div>
  );
}
