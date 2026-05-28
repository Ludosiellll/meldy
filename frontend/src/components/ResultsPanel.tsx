import { useState } from 'react';
import { motion } from 'framer-motion';
import { Copy, Download, RotateCcw, FileText, Layers, HelpCircle, Hash, Clock, Cpu, Gamepad2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { AnalysisResults, QuizQuestion, Flashcard } from '../types';
import SummaryView from './SummaryView';
import FlashcardsView from './FlashcardsView';
import QuizView from './QuizView';
import toast from 'react-hot-toast';

type Tab = 'summary' | 'flashcards' | 'quiz' | 'missions';

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

function parseMarkdownToHtml(md: string): string {
  if (!md) return '';
  let html = md.replace(/\r\n/g, '\n');
  
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

function buildHtmlExport(results: AnalysisResults, sourceFileName?: string): string {
  const date = new Date().toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const time = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  
  const cleanSummary = extractCleanContent(results.summarizer);
  const summaryHtml = parseMarkdownToHtml(cleanSummary) || '<p style="color:#94a3b8">Нет данных</p>';
  
  const flashcards = results.flashcards?.flashcards || [];
  const quiz = results.quiz?.quiz || [];

  const flashcardsHtml = flashcards.map((c: Flashcard, i: number) =>
    `<div class="card">
      <p class="card-q">Карточка ${i+1}: ${c.question}</p>
      <p class="card-a">${c.answer}</p>
    </div>`
  ).join('\n');

  const quizHtml = quiz.map((q: QuizQuestion, i: number) => {
    const options = (q.options || []).map((o: string) => {
      const isCorrect = o.startsWith(q.correct);
      return `<li class="${isCorrect ? 'correct' : ''}">${o}${isCorrect ? ' ✓' : ''}</li>`;
    }).join('\n');
    return `<div class="card">
      <p class="card-q">${i+1}. ${q.question}</p>
      <ul class="opt-list">${options}</ul>
      ${q.explanation ? `<p class="explanation">💡 ${q.explanation}</p>` : ''}
    </div>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>StudyForge — ${sourceFileName || 'Анализ материала'}</title>
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
    background: #4f46e5;
    border-radius: 8px;
    display: flex; align-items: center; justify-content: center;
    color: white; font-weight: 900; font-size: 16px;
    letter-spacing: -1px; flex-shrink: 0;
  }
  .doc-header-text h1 {
    font-size: 13px; font-weight: 700;
    color: #4f46e5; letter-spacing: 0.05em;
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
    border-bottom: 2px solid #4f46e5;
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
    <p>ИИ-анализ учебных материалов · ${date}, ${time}</p>
  </div>
</div>

<h2 class="doc-title" style="border:none;margin-top:0;padding-bottom:0;font-size:22px">${sourceFileName ? sourceFileName.replace(/\.[^.]+$/, '') : 'Учебный материал'}</h2>
<p class="doc-meta">${date}</p>

<div class="section">
<h2>📝 Конспект</h2>
<div style="line-height:1.8">${summaryHtml}</div>
</div>

${flashcards.length > 0 ? `<div class="section">
<h2>🃏 Карточки (${flashcards.length})</h2>
${flashcardsHtml}
</div>` : ''}

${quiz.length > 0 ? `<div class="section">
<h2>❓ Тест (${quiz.length})</h2>
${quizHtml}
</div>` : ''}

</body>
</html>`;
}

export default function ResultsPanel({ results, onReset, textLength, analysisDuration, sourceFileName, materialId }: {
  results: AnalysisResults; onReset: () => void; textLength?: number; analysisDuration?: number; sourceFileName?: string; materialId?: string;
}) {
  const [tab, setTab] = useState<Tab>('summary');
  const [copied, setCopied] = useState(false);

  const flashcardCount = results.flashcards?.flashcards?.length || 0;
  const quizCount = results.quiz?.quiz?.length || 0;

  const tabs: { id: Tab; label: string; icon: JSX.Element; count?: number }[] = [
    { id: 'summary', label: 'Конспект', icon: <FileText className="w-4 h-4" /> },
    { id: 'flashcards', label: 'Карточки', icon: <Layers className="w-4 h-4" />, count: flashcardCount },
    { id: 'quiz', label: 'Тест', icon: <HelpCircle className="w-4 h-4" />, count: quizCount },
    { id: 'missions', label: 'Миссии', icon: <Gamepad2 className="w-4 h-4" />, count: results.missions?.missions?.length || 0 },
  ];

  const getContent = () => {
    if (tab === 'summary') return results.summarizer?.content || (results.summarizer as any)?.raw || '';
    if (tab === 'flashcards') return JSON.stringify(results.flashcards?.flashcards || results.flashcards, null, 2);
    if (tab === 'missions') return JSON.stringify(results.missions?.missions || results.missions, null, 2);
    return JSON.stringify(results.quiz?.quiz || results.quiz, null, 2);
  };

  const handleCopy = () => { navigator.clipboard.writeText(getContent()); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  const handleDownloadHtml = () => {
    const baseName = (sourceFileName || 'demo').replace(/\.[^.]+$/, '');
    const dateStr = new Date().toISOString().slice(0, 10);
    const html = buildHtmlExport(results, sourceFileName);
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
    const html = buildHtmlExport(results, sourceFileName);
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
    <div className="py-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 no-print">
        <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">Результаты</h2>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={handleCopy}
            className="flex-1 md:flex-none items-center justify-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-2 rounded-lg text-xs sm:text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition border border-slate-200 dark:border-slate-700 flex whitespace-nowrap">
            <Copy className="w-3.5 h-3.5 sm:w-4 sm:h-4" />{copied ? 'Скопировано' : 'Копировать'}
          </button>
          {(tab === 'summary' || tab === 'flashcards' || tab === 'quiz') && (
            <button onClick={handlePrintPdf}
              className="flex-1 md:flex-none items-center justify-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-2 rounded-lg text-xs sm:text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition border border-slate-200 dark:border-slate-700 flex whitespace-nowrap">
              <Download className="w-3.5 h-3.5 sm:w-4 sm:h-4" />В PDF / Печать
            </button>
          )}
          {tab === 'flashcards' && (
            <button onClick={handleExportAnki}
              title="Anki — это популярная бесплатная программа для запоминания информации с помощью интервального повторения. Эта кнопка скачает файл, который можно сразу импортировать в Anki."
              className="flex-1 md:flex-none items-center justify-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-2 rounded-lg text-xs sm:text-sm font-bold text-white bg-blue-500 hover:bg-blue-600 transition shadow-sm flex whitespace-nowrap">
              <Download className="w-3.5 h-3.5 sm:w-4 sm:h-4" />В Anki (.txt)
            </button>
          )}
          {(tab === 'summary' || tab === 'flashcards' || tab === 'quiz') && (
            <button onClick={handleDownloadHtml}
              className="flex-1 md:flex-none items-center justify-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-2 rounded-lg text-xs sm:text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition border border-slate-200 dark:border-slate-700 flex whitespace-nowrap">
              <Download className="w-3.5 h-3.5 sm:w-4 sm:h-4" />Скачать HTML
            </button>
          )}
          <button onClick={onReset}
            className="w-full md:w-auto items-center justify-center gap-1 sm:gap-1.5 px-3 py-2.5 sm:py-2 rounded-lg text-sm font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition flex mt-1 md:mt-0 whitespace-nowrap">
            <RotateCcw className="w-4 h-4" />Новый анализ
          </button>
        </div>
      </div>

      {/* Статистика */}
      <div className="flex overflow-x-auto pb-4 gap-3 mb-2 snap-x -mx-4 px-4 md:mx-0 md:px-0 md:grid md:grid-cols-3 md:pb-0 hide-scrollbar no-print">
        <div className="card p-3 flex items-center gap-3 shrink-0 snap-start min-w-[160px] md:min-w-0">
          <div className="w-8 h-8 rounded-lg bg-brand-50 dark:bg-brand-900/30 flex items-center justify-center shrink-0">
            <Hash className="w-4 h-4 text-brand-500 dark:text-brand-400" />
          </div>
          <div>
            <p className="text-xs text-slate-400 dark:text-slate-500">Символов</p>
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{textLength?.toLocaleString() || '—'}</p>
            <p className="text-xs text-slate-400 dark:text-slate-500">{textLength ? `~${Math.round(textLength / 5)} слов` : '—'}</p>
          </div>
        </div>
        <div className="card p-3 flex items-center gap-3 shrink-0 snap-start min-w-[160px] md:min-w-0">
          <div className="w-10 h-10 rounded-lg bg-emerald-50 dark:bg-emerald-900/30 flex items-center justify-center shrink-0">
            <Clock className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />
          </div>
          <div>
            <p className="text-xs text-slate-400 dark:text-slate-500">Время чтения</p>
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
              {textLength ? `~${Math.max(1, Math.round(textLength / 800))} мин` : (analysisDuration ? `${analysisDuration} сек` : '—')}
            </p>
          </div>
        </div>
        <div className="card p-3 flex items-center gap-3 shrink-0 snap-start min-w-[160px] md:min-w-0">
          <div className="w-10 h-10 rounded-lg bg-amber-50 dark:bg-amber-900/30 flex items-center justify-center shrink-0">
            <Cpu className="w-4 h-4 text-amber-500 dark:text-amber-400" />
          </div>
          <div>
            <p className="text-xs text-slate-400 dark:text-slate-500">Агенты</p>
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">3 параллельно</p>
          </div>
        </div>
      </div>

      {/* Pill-вкладки */}
      <div className="flex overflow-x-auto gap-1.5 mb-6 bg-slate-100/80 dark:bg-slate-900/80 p-1.5 rounded-xl w-full md:w-fit snap-x -mx-4 px-4 md:mx-0 md:px-0 hide-scrollbar no-print">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={'flex shrink-0 snap-start items-center justify-center gap-1.5 px-5 py-2.5 rounded-lg text-sm transition font-bold ' +
              (tab === t.id
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-white/50 dark:hover:bg-slate-800/50')}>
            {t.icon}
            {t.label}
            {t.count !== undefined && (
              <span className={'ml-1 text-xs px-1.5 py-0.5 rounded-md ' + (tab === t.id ? 'bg-indigo-500 text-white' : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400')}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      <motion.div key={tab} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="min-h-[300px] printable-section">
        {tab === 'summary' && <div className="card p-6"><SummaryView data={results.summarizer} /></div>}
        {tab === 'flashcards' && <FlashcardsView data={results.flashcards} />}
        {tab === 'quiz' && <QuizView data={results.quiz} />}
        {tab === 'missions' && (
          <div className="card p-10 flex flex-col items-center text-center justify-center min-h-[300px]">
            <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center mb-4">
              <Gamepad2 className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
            </div>
            <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-2">Сюжетные миссии готовы!</h3>
            <p className="text-slate-500 dark:text-slate-400 mb-6 max-w-sm">
              ИИ создал для вас персональный мини-квест на основе этого материала. Сыграем?
            </p>
            <Link to={materialId ? `/play?materialId=${materialId}` : '/play'} className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition shadow-sm inline-flex items-center gap-2">
              <Gamepad2 className="w-5 h-5" />
              Начать игру
            </Link>
          </div>
        )}
      </motion.div>
    </div>
  );
}
