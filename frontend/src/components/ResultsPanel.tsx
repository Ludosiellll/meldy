import { useState } from 'react';
import { motion } from 'framer-motion';
import { Copy, Download, RotateCcw, FileText, Layers, HelpCircle, Hash, Clock, Cpu, Gamepad2 } from 'lucide-react';
import { AnalysisResults } from '../types';
import SummaryView from './SummaryView';
import FlashcardsView from './FlashcardsView';
import QuizView from './QuizView';

type Tab = 'summary' | 'flashcards' | 'quiz' | 'missions';

function buildHtmlExport(results: AnalysisResults, sourceFileName?: string): string {
  const date = new Date().toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const time = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const summaryContent = results.summarizer?.content || results.summarizer?.raw || '<p>Нет данных</p>';
  const flashcards = results.flashcards?.flashcards || [];
  const quiz = results.quiz?.quiz || [];

  const flashcardsHtml = flashcards.map((c: any, i: number) =>
    `<div style="margin-bottom:16px;padding:16px;border:1px solid #e2e8f0;border-radius:8px">
      <p style="font-weight:600;margin:0 0 8px 0">Вопрос ${i+1}: ${c.question}</p>
      <p style="margin:0;color:#475569;border-top:1px solid #f1f5f9;padding-top:8px">${c.answer}</p>
    </div>`
  ).join('\n');

  const quizHtml = quiz.map((q: any, i: number) => {
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
    if (tab === 'summary') return results.summarizer?.content || results.summarizer?.raw || '';
    if (tab === 'flashcards') return JSON.stringify(results.flashcards?.flashcards || results.flashcards, null, 2);
    if (tab === 'missions') return JSON.stringify(results.missions?.missions || results.missions, null, 2);
    return JSON.stringify(results.quiz?.quiz || results.quiz, null, 2);
  };

  const handleCopy = () => { navigator.clipboard.writeText(getContent()); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  const handleDownload = () => {
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

  return (
    <div className="py-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-slate-900">Результаты</h2>
        <div className="flex items-center gap-2">
          <button onClick={handleCopy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-slate-500 hover:bg-slate-100 transition border border-slate-200">
            <Copy className="w-3.5 h-3.5" />{copied ? 'Скопировано' : 'Копировать'}
          </button>
          <button onClick={handleDownload}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-slate-500 hover:bg-slate-100 transition border border-slate-200">
            <Download className="w-3.5 h-3.5" />Скачать HTML
          </button>
          <button onClick={onReset}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-brand-600 bg-brand-50 hover:bg-brand-100 transition">
            <RotateCcw className="w-3.5 h-3.5" />Новый анализ
          </button>
        </div>
      </div>

      {/* Статистика */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="card p-3 flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center shrink-0">
            <Hash className="w-4 h-4 text-brand-500" />
          </div>
          <div>
            <p className="text-xs text-slate-400">Символов</p>
            <p className="text-sm font-semibold text-slate-800">{textLength?.toLocaleString() || '—'}</p>
            <p className="text-xs text-slate-400">{textLength ? `~${Math.round(textLength / 5)} слов` : '—'}</p>
          </div>
        </div>
        <div className="card p-3 flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
            <Clock className="w-4 h-4 text-emerald-500" />
          </div>
          <div>
            <p className="text-xs text-slate-400">Время</p>
            <p className="text-sm font-semibold text-slate-800">{analysisDuration ? `${analysisDuration} сек` : '—'}</p>
          </div>
        </div>
        <div className="card p-3 flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center shrink-0">
            <Cpu className="w-4 h-4 text-amber-500" />
          </div>
          <div>
            <p className="text-xs text-slate-400">Агенты</p>
            <p className="text-sm font-semibold text-slate-800">3 параллельно</p>
          </div>
        </div>
      </div>

      {/* Pill-вкладки */}
      <div className="flex gap-1 mb-6 bg-slate-100 p-1 rounded-xl w-fit">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={'flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm transition font-medium ' +
              (tab === t.id
                ? 'bg-brand-600 text-white shadow-sm'
                : 'text-slate-500 hover:text-slate-700 hover:bg-white')}>
            {t.icon}
            {t.label}
            {t.count !== undefined && (
              <span className={'ml-0.5 text-xs ' + (tab === t.id ? 'text-brand-200' : 'text-slate-400')}>
                ({t.count})
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
            <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mb-4">
              <Gamepad2 className="w-8 h-8 text-emerald-600" />
            </div>
            <h3 className="text-xl font-bold text-slate-900 mb-2">Сюжетные миссии готовы!</h3>
            <p className="text-slate-500 mb-6 max-w-sm">
              ИИ создал для вас персональный мини-квест на основе этого материала. Сыграем?
            </p>
            <a href="/missions" className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition shadow-sm inline-flex items-center gap-2">
              <Gamepad2 className="w-5 h-5" />
              Начать игру
            </a>
          </div>
        )}
      </motion.div>
    </div>
  );
}
