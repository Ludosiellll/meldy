import { useState } from 'react';
import { motion } from 'framer-motion';
import { Copy, Download, RotateCcw, FileText, Layers, HelpCircle, Hash, Clock, Cpu, Gamepad2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { AnalysisResults, QuizQuestion, Flashcard } from '../types';
import SummaryView from './SummaryView';
import FlashcardsView from './FlashcardsView';
import QuizView from './QuizView';

type Tab = 'summary' | 'flashcards' | 'quiz' | 'missions';

function buildHtmlExport(results: AnalysisResults, sourceFileName?: string): string {
  const date = new Date().toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const time = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const summaryContent = results.summarizer?.content || (results.summarizer as any)?.raw || '<p>Нет данных</p>';
  const flashcards = results.flashcards?.flashcards || [];
  const quiz = results.quiz?.quiz || [];

  const flashcardsHtml = flashcards.map((c: Flashcard, i: number) =>
    `<div style="margin-bottom:16px;padding:16px;border:1px solid #e2e8f0;border-radius:8px">
      <p style="font-weight:600;margin:0 0 8px 0">Вопрос ${i+1}: ${c.question}</p>
      <p style="margin:0;color:#475569;border-top:1px solid #f1f5f9;padding-top:8px">${c.answer}</p>
    </div>`
  ).join('\n');

  const quizHtml = quiz.map((q: QuizQuestion, i: number) => {
    const options = (q.options || []).map((o: string) => {
      const isCorrect = o.startsWith(q.correct);
      return `<li style="padding:6px 12px;margin:4px 0;border-radius:6px;${isCorrect ? 'background:#d1fae5;font-weight:600' : 'background:#f8fafc'}">${o}${isCorrect ? ' ✓' : ''}</li>`;
    }).join('\n');
    return `<div style="margin-bottom:16px;padding:16px;border:1px solid #e2e8f0;border-radius:8px">
      <p style="font-weight:600;margin:0 0 8px 0">${i+1}. ${q.question}</p>
      <ul style="list-style:none;padding:0;margin:0">${options}</ul>
      ${q.explanation ? `<p style="margin:8px 0 0;color:#64748b;font-style:italic;border-top:1px solid #f1f5f9;padding-top:8px">💡 ${q.explanation}</p>` : ''}
    </div>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<title>StudyForge — Анализ материала</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; color: #1e293b; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 40px 24px; background: #fff; }
  h1 { font-size: 24px; font-weight: 700; margin-bottom: 4px; color: #0f172a; }
  .meta { color: #94a3b8; font-size: 13px; margin-bottom: 32px; }
  h2 { font-size: 18px; font-weight: 700; margin: 32px 0 16px; padding-bottom: 8px; border-bottom: 2px solid #4F46E5; color: #1e293b; }
  .section { margin-bottom: 24px; }
  @media print {
    body { padding: 0; }
    h2 { page-break-after: avoid; }
    .section { page-break-inside: avoid; }
  }
</style>
</head>
<body>
<h1>StudyForge — Анализ материала</h1>
<p class="meta">${sourceFileName || 'Демо'} · ${date} ${time}</p>

<div class="section">
<h2>📝 Конспект</h2>
<div style="white-space:pre-wrap;font-size:15px;color:#334155;line-height:1.7">${summaryContent}</div>
</div>

<div class="section">
<h2>🃏 Карточки (${flashcards.length})</h2>
${flashcardsHtml || '<p style="color:#94a3b8">Нет данных</p>'}
</div>

<div class="section">
<h2>❓ Тест (${quiz.length})</h2>
${quizHtml || '<p style="color:#94a3b8">Нет данных</p>'}
</div>

</body>
</html>`;
}

export default function ResultsPanel({ results, onReset, textLength, analysisDuration, sourceFileName }: {
  results: AnalysisResults; onReset: () => void; textLength?: number; analysisDuration?: number; sourceFileName?: string;
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
      alert('Ошибка при экспорте Anki');
    }
  };

  const handlePrintPdf = () => {
    window.print();
  };

  return (
    <div className="py-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">Результаты</h2>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={handleCopy}
            className="flex-1 md:flex-none items-center justify-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-2 rounded-lg text-xs sm:text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition border border-slate-200 dark:border-slate-700 flex whitespace-nowrap">
            <Copy className="w-3.5 h-3.5 sm:w-4 sm:h-4" />{copied ? 'Скопировано' : 'Копировать'}
          </button>
          {tab === 'summary' && (
            <button onClick={handlePrintPdf}
              className="flex-1 md:flex-none items-center justify-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-2 rounded-lg text-xs sm:text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition border border-slate-200 dark:border-slate-700 flex whitespace-nowrap">
              <Download className="w-3.5 h-3.5 sm:w-4 sm:h-4" />В PDF / Печать
            </button>
          )}
          {tab === 'flashcards' && (
            <button onClick={handleExportAnki}
              className="flex-1 md:flex-none items-center justify-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-2 rounded-lg text-xs sm:text-sm font-bold text-white bg-blue-500 hover:bg-blue-600 transition shadow-sm flex whitespace-nowrap">
              <Download className="w-3.5 h-3.5 sm:w-4 sm:h-4" />В Anki (.txt)
            </button>
          )}
          {(tab === 'quiz' || tab === 'missions') && (
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
      <div className="flex overflow-x-auto pb-4 gap-3 mb-2 snap-x -mx-4 px-4 md:mx-0 md:px-0 md:grid md:grid-cols-3 md:pb-0 hide-scrollbar">
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
      <div className="flex overflow-x-auto gap-1.5 mb-6 bg-slate-100/80 dark:bg-slate-900/80 p-1.5 rounded-xl w-full md:w-fit snap-x -mx-4 px-4 md:mx-0 md:px-0 hide-scrollbar">
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

      <motion.div key={tab} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="min-h-[300px]">
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
            <Link to="/missions" className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition shadow-sm inline-flex items-center gap-2">
              <Gamepad2 className="w-5 h-5" />
              Начать игру
            </Link>
          </div>
        )}
      </motion.div>
    </div>
  );
}
