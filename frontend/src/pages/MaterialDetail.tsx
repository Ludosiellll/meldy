import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Edit3, Check, X } from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import ResultsPanel from '../components/ResultsPanel';
import { getMaterialById, updateMaterialSubject } from '../api/materials';

export default function MaterialDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [material, setMaterial] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editingSubject, setEditingSubject] = useState(false);
  const [subjectInput, setSubjectInput] = useState('');

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
    setMaterial((prev: any) => ({ ...prev, subject: subjectInput }));
    setEditingSubject(false);
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

  return (
    <div className="p-6 max-w-4xl mx-auto">
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

      <div className="flex items-center gap-3 mb-2">
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
      </div>

      <p className="text-xs text-slate-400 mb-6">
        {format(new Date(material.created_at), 'dd.MM.yyyy', { locale: ru })}
      </p>

      {/* Results */}
      <ResultsPanel
        results={{
          summarizer: material.summary_json,
          flashcards: material.flashcards_json,
          quiz: material.quiz_json,
        }}
        onReset={() => navigate('/library')}
        textLength={0}
      />

      {/* Review CTA */}
      {hasFlashcards && (
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