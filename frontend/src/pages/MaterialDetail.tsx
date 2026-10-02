import { Material } from '../types';
import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Edit3, Check, X, Globe, Lock, MessagesSquare, Zap, BookOpen, Share2, type LucideIcon } from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import toast from 'react-hot-toast';
import ResultsPanel from '../components/ResultsPanel';
import ExpressPrepView from '../components/ExpressPrepView';
import { getMaterialById, updateMaterialSubject, updateMaterialVisibility, updateMaterialTitle } from '../api/materials';

export default function MaterialDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [material, setMaterial] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editingSubject, setEditingSubject] = useState(false);
  const [subjectInput, setSubjectInput] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState('');
  const [mode, setMode] = useState<'full' | 'express' | 'podcast'>(  
    searchParams.get('mode') === 'express' 
      ? (searchParams.get('tab') === 'podcast' ? 'podcast' : 'express')
      : 'full'
  );
  // Ссылки «Повторить за 5 минут» ведут сюда и без шпаргалки: тогда вкладка «Кратко»
  // остаётся видна, чтобы шпаргалку можно было создать.
  const [expressRequested] = useState(() => searchParams.get('mode') === 'express' && searchParams.get('tab') !== 'podcast');
  // Ссылка прямо на разговор: один раз показываем плеер целиком, дальше прокрутку не трогаем.
  const [revealPlayer, setRevealPlayer] = useState(() => searchParams.get('mode') === 'express' && searchParams.get('tab') === 'podcast');

  useEffect(() => {
    if (!id) return;
    getMaterialById(id)
      .then(data => {
        setMaterial(data);
        setSubjectInput(data.subject || '');
        setTitleInput(data.title || '');
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  const saveSubject = async () => {
    if (!id) return;
    await updateMaterialSubject(id, subjectInput);
    setMaterial((prev: Material) => ({ ...prev, subject: subjectInput }));
    setEditingSubject(false);
  };

  const saveTitle = async () => {
    if (!id || !titleInput.trim()) return;
    await updateMaterialTitle(id, titleInput.trim());
    setMaterial((prev: Material) => ({ ...prev, title: titleInput.trim() }));
    setEditingTitle(false);
  };

  const shareMaterial = async () => {
    if (!id) return;
    try {
      await updateMaterialVisibility(id, true);
      setMaterial((prev: Material) => ({ ...prev, is_public: true }));
      await navigator.clipboard.writeText(`${window.location.origin}/shared/${id}`);
      toast.success('Ссылка скопирована');
    } catch (err) {
      console.error(err);
      toast.error('Не удалось создать ссылку');
    }
  };

  const togglePublic = async () => {
    if (!id || !material) return;
    const newStatus = !material.is_public;
    await updateMaterialVisibility(id, newStatus);
    setMaterial((prev: Material) => ({ ...prev, is_public: newStatus }));
  };

  if (loading) return (
    <div className="p-6 flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-cyan-300 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (!material) return (
    <div className="p-6 text-center">
      <p className="text-slate-400">Материал не найден</p>
      <button onClick={() => navigate('/library')} className="mt-4 text-cyan-700 dark:text-cyan-300 text-sm hover:underline">← Библиотека</button>
    </div>
  );

  const hasCheatsheet = typeof material.summary_json?.cheatsheet === 'string' && material.summary_json.cheatsheet.trim() !== '';
  // «Разговор» доступен всегда: если его ещё нет, там можно его создать.
  const showExpress = hasCheatsheet || expressRequested;
  const modes: { id: 'full' | 'express' | 'podcast'; label: string; icon: LucideIcon }[] = [
    { id: 'full', label: 'Материал', icon: BookOpen },
    ...(showExpress ? [{ id: 'express' as const, label: 'Кратко', icon: Zap }] : []),
    { id: 'podcast', label: 'Разговор', icon: MessagesSquare },
  ];

  const updateMaterialFields = (updatedFields: any) => {
    setMaterial((prev: any) => {
      if (!prev) return prev;
      return {
        ...prev,
        ...updatedFields,
        summary_json: {
          ...prev.summary_json,
          ...(updatedFields.summary_json || {})
        }
      };
    });
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 md:py-10">
      {/* Back */}
      <button
        onClick={() => navigate('/library')}
        className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 text-sm mb-4 transition"
      >
        <ArrowLeft className="w-4 h-4" />
        Библиотека
      </button>

      {/* Title & Subject */}
      <div className="mb-2 group relative flex items-start justify-between">
        {editingTitle ? (
          <div className="flex items-center gap-2 w-full pr-8">
            <input
              value={titleInput}
              onChange={e => setTitleInput(e.target.value)}
              className="flex-1 px-3 py-1.5 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 rounded-lg text-xl font-semibold outline-none focus:ring-2 focus:ring-cyan-400"
              placeholder="Название материала"
              autoFocus
            />
            <button onClick={saveTitle} className="text-emerald-600 hover:text-emerald-700 shrink-0"><Check className="w-5 h-5" /></button>
            <button onClick={() => { setEditingTitle(false); setTitleInput(material.title || ''); }} className="text-slate-400 hover:text-slate-600 shrink-0"><X className="w-5 h-5" /></button>
          </div>
        ) : (
          <div className="flex items-start gap-2 pr-8">
            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-slate-900 dark:text-slate-100 break-words">{material.title}</h1>
            <button 
              onClick={() => setEditingTitle(true)}
              className="opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity mt-1.5 text-slate-400 hover:text-cyan-600"
              title="Переименовать материал"
            >
              <Edit3 className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-2">
        {editingSubject ? (
          <div className="flex items-center gap-2">
            <input
              value={subjectInput}
              onChange={e => setSubjectInput(e.target.value)}
              className="px-3 py-1 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 rounded-lg text-sm outline-none focus:ring-2 focus:ring-cyan-400"
              placeholder="Предмет"
              autoFocus
            />
            <button onClick={saveSubject} className="text-emerald-600 hover:text-emerald-700"><Check className="w-4 h-4" /></button>
            <button onClick={() => { setEditingSubject(false); setSubjectInput(material.subject || ''); }} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
          </div>
        ) : (
          <button
            onClick={() => setEditingSubject(true)}
            className="flex items-center gap-1.5 text-sm"
          >
            {material.subject ? (
              <span className="rounded-md bg-[var(--sf-accent-soft)] px-2 py-0.5 text-[var(--sf-accent)]">{material.subject}</span>
            ) : (
              <span className="text-slate-400 dark:text-slate-500 flex items-center gap-1"><Edit3 className="w-3 h-3" />Добавить предмет</span>
            )}
          </button>
        )}

        <div className="w-px h-4 bg-slate-300 dark:bg-slate-700 hidden sm:block" />

        <button 
          onClick={togglePublic}
          className="flex items-center gap-1.5 rounded-md bg-[var(--sf-surface-soft)] px-2.5 py-1 text-xs font-medium text-[var(--sf-muted)] transition-colors hover:text-[var(--sf-ink)]"
        >
          {material.is_public ? (
            <><Globe className="w-3.5 h-3.5" /> В открытых материалах</>
          ) : (
            <><Lock className="w-3.5 h-3.5" /> Только для меня</>
          )}
        </button>
      </div>

      <p className="text-xs text-slate-400 dark:text-slate-500 mb-4">
        {format(new Date(material.created_at), 'dd.MM.yyyy, HH:mm', { locale: ru })}
      </p>

      {/* Режимы обучения и «Поделиться» — одна строка */}
      <div className="mb-5 flex items-center gap-2">
        <div
          role="tablist"
          aria-label="Режим"
          className={`grid flex-1 rounded-lg border border-[var(--sf-line)] bg-[var(--sf-surface)] p-0.5 sm:inline-flex sm:flex-none ${
            modes.length === 3 ? 'grid-cols-3' : 'grid-cols-2'
          }`}
        >
          {modes.map(item => {
            const selected = mode === item.id;
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => {
                  setRevealPlayer(false);
                  setMode(item.id);
                }}
                className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors ${
                  selected
                    ? 'bg-[var(--sf-surface-soft)] text-[var(--sf-ink)]'
                    : 'text-[var(--sf-muted)] hover:text-[var(--sf-ink)]'
                }`}
              >
                <Icon aria-hidden="true" className="hidden h-4 w-4 sm:block" />
                {item.label}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={shareMaterial}
          aria-label="Поделиться"
          className="ml-auto inline-flex h-8 w-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-[var(--sf-line)] text-sm font-medium text-[var(--sf-ink)] transition-colors hover:bg-[var(--sf-surface-soft)] sm:w-auto sm:px-3"
        >
          <Share2 aria-hidden="true" className="h-4 w-4" />
          <span className="hidden sm:inline">Поделиться</span>
        </button>
      </div>

      {/* Контент в зависимости от выбранного режима */}
      {mode === 'full' ? (
        <ResultsPanel
          results={{
            summarizer: material.summary_json,
            flashcards: material.flashcards_json,
            quiz: material.quiz_json,
            grounding: (material.summary_json as any)?.grounding,
          }}
          onReset={() => navigate('/analyze')}
          textLength={material.original_text?.length || material.summary_json?.content?.length || 0}
          sourceFileName={material.title}
          materialId={material.id}
          embedded
        />
      ) : (
        <ExpressPrepView
          materialId={material.id}
          materialTitle={material.title}
          originalText={material.original_text || ''}
          summaryJson={material.summary_json}
          flashcards={Array.isArray(material.flashcards_json) ? material.flashcards_json : material.flashcards_json?.flashcards}
          tab={mode === 'podcast' ? 'podcast' : 'cheatsheet'}
          onTabChange={(next) => setMode(next === 'podcast' ? 'podcast' : 'express')}
          showTabs={false}
          revealPlayer={revealPlayer}
          onUpdate={updateMaterialFields}
        />
      )}

    </div>
  );
}
