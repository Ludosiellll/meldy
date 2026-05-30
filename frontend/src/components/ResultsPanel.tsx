import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Copy, Download, RotateCcw, FileText, Layers, HelpCircle, Hash, Clock, Cpu, Gamepad2, Mic, Smartphone, Headphones, Play, Edit3, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { AnalysisResults, QuizQuestion, Flashcard } from '../types';
import SummaryView from './SummaryView';
import FlashcardsView from './FlashcardsView';
import QuizView from './QuizView';
import toast from 'react-hot-toast';
import { updateMaterialTitle } from '../api/materials';

type Tab = 'summary' | 'flashcards' | 'quiz' | 'missions' | 'podcast' | 'shorts';

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
  const [showExport, setShowExport] = useState(false);

  // States for Title management and suggestion
  const [currentTitle, setCurrentTitle] = useState(sourceFileName ? sourceFileName.replace(/\.[^/.]+$/, '') : 'Учебный материал');
  const [isEditing, setIsEditing] = useState(false);
  const [editVal, setEditVal] = useState(currentTitle);
  const [suggestionDismissed, setSuggestionDismissed] = useState(false);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (!(e.target as Element).closest('.export-menu-container')) {
        setShowExport(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Heuristic function to extract clean, nice AI suggested topic name from summary markdown
  const getAiSuggestedTitle = () => {
    const content = results.summarizer?.content || (results.summarizer as any)?.raw || '';
    if (!content) return null;
    const lines = content.split('\n').map((l: string) => l.trim()).filter(Boolean);
    for (const line of lines) {
      const clean = line.replace(/^[#*\s-]+/, '').replace(/[#*\s-]+$/, '').trim();
      if (clean && clean.length > 3 && clean.length < 80) {
        return clean;
      }
    }
    return null;
  };

  const isGenericTitle = (title: string) => {
    const lower = title.toLowerCase();
    return (
      /^(img_|screenshot_|whatsapp_|photo_|video_|audio_|file_|doc_|unnamed|scan_|temp_)/.test(lower) ||
      /^\d+_\d+$/.test(title) ||
      /^\d+$/.test(title) ||
      lower.includes('whatsapp image') ||
      lower.includes('whatsapp video') ||
      lower.includes('снимок экрана') ||
      lower.includes('без названия') ||
      lower.includes('unknown')
    );
  };

  const aiSuggestedTitle = getAiSuggestedTitle();
  const showSuggestion = aiSuggestedTitle && isGenericTitle(currentTitle) && materialId;

  const applySuggestedTitle = async () => {
    if (!materialId || !aiSuggestedTitle) return;
    try {
      await updateMaterialTitle(materialId, aiSuggestedTitle);
      setCurrentTitle(aiSuggestedTitle);
      setEditVal(aiSuggestedTitle);
      toast.success('Название успешно обновлено на рекомендуемое! ✨');
    } catch (e) {
      toast.error('Не удалось переименовать');
    }
  };

  const saveManualTitle = async () => {
    if (!materialId || !editVal.trim()) return;
    try {
      await updateMaterialTitle(materialId, editVal.trim());
      setCurrentTitle(editVal.trim());
      setIsEditing(false);
      toast.success('Название успешно обновлено! ✍️');
    } catch (e) {
      toast.error('Не удалось сохранить название');
    }
  };

  const flashcardCount = results.flashcards?.flashcards?.length || 0;
  const quizCount = results.quiz?.quiz?.length || 0;

  const tabs: { id: Tab; label: string; icon: JSX.Element; count?: number }[] = [
    { id: 'summary', label: 'Конспект', icon: <FileText className="w-4 h-4" /> },
    { id: 'flashcards', label: 'Карточки', icon: <Layers className="w-4 h-4" />, count: flashcardCount },
    { id: 'quiz', label: 'Тест', icon: <HelpCircle className="w-4 h-4" />, count: quizCount },
    { id: 'missions', label: 'Миссии', icon: <Gamepad2 className="w-4 h-4" /> },
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
      {/* AI Suggestion Rename Card */}
      <AnimatePresence>
        {showSuggestion && !suggestionDismissed && (
          <motion.div
            initial={{ opacity: 0, y: -15, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -15, scale: 0.98 }}
            className="mb-6 p-4 md:p-5 bg-indigo-50/90 dark:bg-indigo-950/40 backdrop-blur-md border border-indigo-200 dark:border-indigo-900/60 rounded-2xl shadow-md flex flex-col md:flex-row items-start md:items-center justify-between gap-4 relative overflow-hidden group select-none no-print"
          >
            {/* Ambient background blur glow */}
            <div className="absolute -right-16 -bottom-16 w-36 h-36 bg-indigo-500/10 rounded-full blur-2xl group-hover:scale-110 transition-transform duration-500" />
            
            <div className="flex items-start gap-3.5 flex-1 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-indigo-600/10 dark:bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center shrink-0 text-indigo-600 dark:text-indigo-400">
                <Sparkles className="w-5.5 h-5.5 animate-pulse" />
              </div>
              <div className="min-w-0">
                <h4 className="text-xs font-black uppercase tracking-wider text-indigo-700 dark:text-indigo-400 mb-0.5">
                  ИИ-Наставник Forgey заметил шаблонное название
                </h4>
                <p className="text-sm font-bold text-slate-850 dark:text-slate-200 leading-snug">
                  Заменить нечитаемое <code className="text-xs px-1 py-0.5 bg-slate-200 dark:bg-slate-800 rounded font-mono text-slate-700 dark:text-slate-350">{currentTitle}</code> на красивое название:
                </p>
                <p className="text-sm font-black text-indigo-600 dark:text-indigo-400 mt-1 flex items-center gap-1.5 italic">
                  «{aiSuggestedTitle}»
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0 w-full md:w-auto justify-end">
              <button
                onClick={() => setSuggestionDismissed(true)}
                className="px-4 py-2 border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl text-xs font-bold text-slate-500 dark:text-slate-400 transition active:scale-[0.98]"
              >
                Пропустить
              </button>
              <button
                onClick={applySuggestedTitle}
                className="px-4.5 py-2.5 bg-indigo-600 hover:bg-indigo-550 text-white rounded-xl text-xs font-black transition shadow-md shadow-indigo-500/10 active:scale-[0.96] flex items-center gap-1.5"
              >
                Переименовать ✨
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 no-print">
        <div className="flex-1 min-w-0">
          {isEditing ? (
            <div className="flex items-center gap-2 max-w-lg">
              <input
                type="text"
                value={editVal}
                onChange={e => setEditVal(e.target.value)}
                className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-850 dark:text-slate-200 rounded-xl px-3 py-1.5 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500 flex-1"
                placeholder="Введите название..."
              />
              <button onClick={saveManualTitle} className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-bold transition hover:bg-emerald-700 active:scale-[0.98]">
                Сохранить
              </button>
              <button onClick={() => setIsEditing(false)} className="px-3 py-1.5 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-bold transition hover:bg-slate-300 active:scale-[0.98]">
                Отмена
              </button>
            </div>
          ) : (
            <h2 className="text-xl font-black text-slate-900 dark:text-slate-100 tracking-tight flex items-center gap-2 group flex-wrap">
              {currentTitle}
              {materialId && (
                <button
                  onClick={() => { setEditVal(currentTitle); setIsEditing(true); }}
                  className="p-1 text-slate-400 hover:text-indigo-500 transition opacity-0 group-hover:opacity-100 focus:opacity-100"
                  title="Изменить название"
                >
                  <Edit3 className="w-4 h-4" />
                </button>
              )}
            </h2>
          )}
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Анализ лекции успешно завершен</p>
        </div>

        <div className="flex items-center gap-2">
          
          {/* Export Dropdown */}
          <div className="relative export-menu-container">
            <button 
              onClick={() => setShowExport(!showExport)}
              className="flex items-center justify-center gap-1.5 px-3 py-2 sm:py-2 rounded-lg text-sm font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 transition shadow-sm"
            >
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">Экспорт</span>
            </button>

            <AnimatePresence>
              {showExport && (
                <motion.div
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.95 }}
                  transition={{ duration: 0.15 }}
                  className="absolute right-0 top-full mt-2 w-56 bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 p-1.5 z-50 flex flex-col gap-1"
                >
                  <button onClick={() => { handleCopy(); setShowExport(false); }}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition w-full text-left">
                    <Copy className="w-4 h-4" />{copied ? 'Скопировано' : 'Копировать'}
                  </button>
                  
                  {(tab === 'summary' || tab === 'flashcards' || tab === 'quiz') && (
                    <button onClick={() => { handlePrintPdf(); setShowExport(false); }}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition w-full text-left">
                      <Download className="w-4 h-4" />В PDF / Печать
                    </button>
                  )}
                  
                  {tab === 'flashcards' && (
                    <button onClick={() => { handleExportAnki(); setShowExport(false); }}
                      title="Anki — это популярная бесплатная программа..."
                      className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-bold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition w-full text-left">
                      <Download className="w-4 h-4" />В Anki (.txt)
                    </button>
                  )}
                  
                  {(tab === 'summary' || tab === 'flashcards' || tab === 'quiz') && (
                    <button onClick={() => { handleDownloadHtml(); setShowExport(false); }}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition w-full text-left">
                      <Download className="w-4 h-4" />Скачать HTML
                    </button>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <button onClick={onReset}
            className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition shadow-sm whitespace-nowrap">
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
            <Layers className="w-4 h-4 text-amber-500 dark:text-amber-400" />
          </div>
          <div>
            <p className="text-xs text-slate-400 dark:text-slate-500">Практика</p>
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
              {flashcardCount + quizCount} упражнений
            </p>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
              {quizCount} тестов / {flashcardCount} карточек
            </p>
          </div>
        </div>
      </div>

      {/* Pill-вкладки */}
      <div className="flex overflow-x-auto gap-1.5 mb-6 bg-slate-100/80 dark:bg-slate-900/80 p-1.5 rounded-2xl w-full md:w-fit snap-x -mx-4 px-4 md:mx-0 md:px-0 hide-scrollbar no-print border border-slate-250/20 dark:border-slate-800/60">
        {tabs.map(t => {
          const isActive = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`relative flex shrink-0 snap-start items-center justify-center gap-1.5 px-5 py-2.5 rounded-xl text-sm font-bold transition-colors duration-200 select-none ${
                isActive
                  ? 'text-white'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {isActive && (
                <motion.span
                  layoutId="activeResultsTab"
                  className="absolute inset-0 bg-indigo-600 dark:bg-indigo-500 rounded-xl shadow-md -z-10"
                  transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                />
              )}
              <span className="relative z-10 flex items-center gap-1.5">
                {t.icon}
                <span>{t.label}</span>
                {t.count !== undefined && (
                  <span className={`ml-1 text-[10px] px-1.5 py-0.5 rounded-md transition-colors ${
                    isActive ? 'bg-indigo-500 text-white' : 'bg-slate-200 dark:bg-slate-800 text-slate-650 dark:text-slate-400'
                  }`}>
                    {t.count}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      <motion.div key={tab} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="min-h-[300px] printable-section">
        {tab === 'summary' && <div className="card p-6"><SummaryView data={results.summarizer} /></div>}
        {tab === 'flashcards' && (
          <div className="flex flex-col gap-4">
            <FlashcardsView data={results.flashcards} />
            <div className="mt-2 text-center no-print">
              <Link to="/review" className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white inline-flex items-center gap-2 rounded-lg text-sm font-medium transition shadow-sm">
                🧠 Начать повторение карточек
              </Link>
            </div>
          </div>
        )}
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
