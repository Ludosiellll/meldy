import { Material } from '../types';
import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Edit3, Check, X, Globe, Lock, Headphones, Zap, BookOpen } from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import ResultsPanel from '../components/ResultsPanel';
import ExpressPrepView from '../components/ExpressPrepView';
import { getMaterialById, updateMaterialSubject, updateMaterialVisibility } from '../api/materials';

export default function MaterialDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [material, setMaterial] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editingSubject, setEditingSubject] = useState(false);
  const [subjectInput, setSubjectInput] = useState('');
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

  const togglePublic = async () => {
    if (!id || !material) return;
    const newStatus = !material.is_public;
    await updateMaterialVisibility(id, newStatus);
    setMaterial((prev: Material) => ({ ...prev, is_public: newStatus }));
  };

  if (loading) return (
    <div className="p-6 flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (!material) return (
    <div className="p-6 text-center">
      <p className="text-slate-400">Материал не найден</p>
      <button onClick={() => navigate('/library')} className="mt-4 text-indigo-600 text-sm hover:underline">← Библиотека</button>
    </div>
  );

  const hasFlashcards = material.flashcards_json?.flashcards?.length > 0;
  const hasPodcast = material.summary_json?.podcast?.length > 0;

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      {/* Back */}
      <button
        onClick={() => navigate('/library')}
        className="flex items-center gap-1.5 text-slate-500 hover:text-slate-700 text-sm mb-4 transition"
      >
        <ArrowLeft className="w-4 h-4" />
        Библиотека
      </button>

      {/* Title & Subject */}
      <div className="mb-2">
        <h1 className="text-2xl font-bold text-slate-900">{material.title}</h1>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-2">
        {editingSubject ? (
          <div className="flex items-center gap-2">
            <input
              value={subjectInput}
              onChange={e => setSubjectInput(e.target.value)}
              className="px-3 py-1 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500"
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
              <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-md">{material.subject}</span>
            ) : (
              <span className="text-slate-400 flex items-center gap-1"><Edit3 className="w-3 h-3" />Добавить предмет</span>
            )}
          </button>
        )}

        <div className="w-px h-4 bg-slate-300 hidden sm:block" />

        <button 
          onClick={togglePublic}
          className={`flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-md transition ${
            material.is_public ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
          }`}
        >
          {material.is_public ? (
            <><Globe className="w-3.5 h-3.5" /> В Маркетплейсе</>
          ) : (
            <><Lock className="w-3.5 h-3.5" /> Только для меня</>
          )}
        </button>
      </div>

      <p className="text-xs text-slate-400 mb-6">
        {format(new Date(material.created_at), 'dd.MM.yyyy', { locale: ru })}
      </p>

      {/* Режимы обучения */}
      <div className="flex flex-col sm:flex-row gap-1.5 bg-slate-200/50 p-1.5 rounded-2xl w-full mb-6 border border-slate-200">
        <button
          onClick={() => setMode('full')}
          className={`flex-1 sm:flex-initial flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition ${
            mode === 'full'
              ? 'bg-slate-900 text-white shadow-md'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <BookOpen className="w-4 h-4" /> Полное обучение
        </button>
        <button
          onClick={() => setMode('express')}
          className={`flex-1 sm:flex-initial flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition ${
            mode === 'express'
              ? 'bg-rose-600 text-white shadow-md'
              : 'text-slate-600 hover:text-rose-600'
          }`}
        >
          <Zap className="w-4 h-4" /> За 5 минут
        </button>
        {hasPodcast && (
          <button
            onClick={() => setMode('podcast')}
            className={`flex-1 sm:flex-initial flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition ${
              mode === 'podcast'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-slate-600 hover:text-indigo-600'
            }`}
          >
            <Headphones className="w-4 h-4" /> AI-Подкаст
          </button>
        )}
      </div>

      {/* Контент в зависимости от выбранного режима */}
      {mode === 'full' ? (
        <ResultsPanel
          results={{
            summarizer: material.summary_json,
            flashcards: material.flashcards_json,
            quiz: material.quiz_json,
          }}
          onReset={() => navigate('/library')}
          textLength={0}
        />
      ) : mode === 'podcast' ? (
        <ExpressPrepView summaryJson={{ ...material.summary_json, _startTab: 'podcast' }} />
      ) : (
        <ExpressPrepView summaryJson={material.summary_json} />
      )}

      {/* Review CTA */}
      {hasFlashcards && mode === 'full' && (
        <div className="mt-6 text-center">
          <button
            onClick={() => navigate('/review')}
            className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition"
          >
            🧠 Начать повторение карточек
          </button>
        </div>
      )}
    </div>
  );
}