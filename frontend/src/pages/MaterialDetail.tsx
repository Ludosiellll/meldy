import { Material } from '../types';
import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Edit3, Check, X, Globe, Lock, Headphones, Zap, BookOpen } from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { motion } from 'framer-motion';
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

  const hasPodcast = material.summary_json?.podcast?.length > 0;
  const hasCheatsheet = material.summary_json?.cheatsheet && material.summary_json.cheatsheet.trim() !== '';

  let colCount = 1; // "Полное обучение"
  if (hasCheatsheet) colCount++;
  if (hasPodcast) colCount++;

  const gridColsClass = colCount === 4 
    ? 'md:grid-cols-4 sm:grid-cols-2' 
    : colCount === 3 
      ? 'md:grid-cols-3 sm:grid-cols-2' 
      : colCount === 2 
        ? 'sm:grid-cols-2' 
        : 'grid-cols-1';

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 md:py-10">
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
              <span className="px-2 py-0.5 bg-cyan-50 dark:bg-cyan-950/30 text-cyan-800 dark:text-cyan-300 rounded-md">{material.subject}</span>
            ) : (
              <span className="text-slate-400 dark:text-slate-500 flex items-center gap-1"><Edit3 className="w-3 h-3" />Добавить предмет</span>
            )}
          </button>
        )}

        <div className="w-px h-4 bg-slate-300 dark:bg-slate-700 hidden sm:block" />

        <button 
          onClick={togglePublic}
          className={`flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-md transition ${
            material.is_public 
              ? 'bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-200 dark:hover:bg-emerald-950/50' 
              : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
          }`}
        >
          {material.is_public ? (
            <><Globe className="w-3.5 h-3.5" /> В открытых материалах</>
          ) : (
            <><Lock className="w-3.5 h-3.5" /> Только для меня</>
          )}
        </button>
      </div>

      <p className="text-xs text-slate-400 dark:text-slate-500 mb-6">
        {format(new Date(material.created_at), 'dd.MM.yyyy, HH:mm', { locale: ru })}
      </p>

      {/* Режимы обучения */}
      {colCount > 1 && (
        <div className={`grid grid-cols-1 gap-1 border-y border-slate-200 dark:border-slate-800 py-1 w-full mb-7 ${gridColsClass}`}>
          <button
            onClick={() => setMode('full')}
            className={`relative flex items-center justify-center gap-2 px-4 py-3 sm:py-2.5 rounded-lg text-sm font-semibold transition-colors duration-200 select-none ${
              mode === 'full'
                ? 'text-white'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            {mode === 'full' && (
              <motion.span
                layoutId="activeDetailMode"
                className="absolute inset-0 bg-slate-900 dark:bg-slate-800 rounded-lg -z-10"
                transition={{ type: 'spring', stiffness: 380, damping: 30 }}
              />
            )}
            <span className="relative z-10 flex items-center gap-2">
              <BookOpen className="w-5 h-5 sm:w-4 sm:h-4" />
              <span>Материал</span>
            </span>
          </button>
          {hasCheatsheet && (
            <button
              onClick={() => setMode('express')}
              className={`relative flex items-center justify-center gap-2 px-4 py-3 sm:py-2.5 rounded-lg text-sm font-semibold transition-colors duration-200 select-none ${
                mode === 'express'
                  ? 'text-white'
                  : 'text-slate-600 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400'
              }`}
            >
              {mode === 'express' && (
                <motion.span
                  layoutId="activeDetailMode"
                  className="absolute inset-0 bg-slate-900 dark:bg-slate-800 rounded-lg -z-10"
                  transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                />
              )}
              <span className="relative z-10 flex items-center gap-2">
                <Zap className="w-5 h-5 sm:w-4 sm:h-4" />
                <span>Кратко</span>
              </span>
            </button>
          )}
          {hasPodcast && (
            <button
              onClick={() => setMode('podcast')}
              className={`relative flex items-center justify-center gap-2 px-4 py-3 sm:py-2.5 rounded-lg text-sm font-semibold transition-colors duration-200 select-none ${
                mode === 'podcast'
                  ? 'text-slate-950'
                  : 'text-slate-600 dark:text-slate-400 hover:text-cyan-700 dark:hover:text-cyan-300'
              }`}
            >
              {mode === 'podcast' && (
                <motion.span
                  layoutId="activeDetailMode"
                  className="absolute inset-0 bg-cyan-300 rounded-lg -z-10"
                  transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                />
              )}
              <span className="relative z-10 flex items-center gap-2">
                <Headphones className="w-5 h-5 sm:w-4 sm:h-4" />
                <span>Аудио</span>
              </span>
            </button>
          )}
        </div>
      )}

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
      ) : mode === 'podcast' ? (
        <ExpressPrepView 
          key="podcast" 
          materialId={material.id}
          originalText={material.original_text || ''}
          summaryJson={{ ...material.summary_json, _startTab: 'podcast' }} 
          onUpdate={(updatedFields) => {
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
          }}
        />
      ) : (
        <ExpressPrepView 
          key="express" 
          materialId={material.id}
          originalText={material.original_text || ''}
          summaryJson={material.summary_json} 
          onUpdate={(updatedFields) => {
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
          }}
        />
      )}

    </main>
  );
}
