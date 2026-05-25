import { Material } from '../types';
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, BookOpen, Trash2, Plus, Headphones } from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { useAuth } from '../hooks/useAuth';
import { useConfirm } from '../contexts/ConfirmContext';
import { getMaterials, deleteMaterial } from '../api/materials';

export default function Library() {
  const { user } = useAuth();
  const { confirm } = useConfirm();
  const navigate = useNavigate();
  const [materials, setMaterials] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    getMaterials(user.id)
      .then(data => setMaterials(data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [user?.id]);

  const subjects = [...new Set(materials.map(m => m.subject).filter(Boolean))];

  const filtered = materials.filter(m => {
    const matchSearch = m.title.toLowerCase().includes(search.toLowerCase());
    const matchSubject = !subjectFilter || m.subject === subjectFilter;
    return matchSearch && matchSubject;
  });

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!(await confirm({ title: 'Удаление', message: 'Удалить этот материал навсегда?', type: 'danger' }))) return;
    await deleteMaterial(id);
    setMaterials(prev => prev.filter(m => m.id !== id));
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Библиотека знаний</h1>
        <button
          onClick={() => navigate('/analyze')}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition"
        >
          <Plus className="w-4 h-4" />
          Новый анализ →
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Поиск по названию..."
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500 transition"
          />
        </div>
        {subjects.length > 0 && (
          <select
            value={subjectFilter}
            onChange={e => setSubjectFilter(e.target.value)}
            className="w-full sm:w-auto px-4 py-2.5 bg-white border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500 transition"
          >
            <option value="">Все предметы</option>
            {subjects.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="animate-pulse bg-slate-200 h-24 rounded-xl" />
          ))}
        </div>
      )}

      {/* Empty */}
      {!loading && materials.length === 0 && (
        <div className="text-center py-20">
          <BookOpen className="w-16 h-16 text-slate-300 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-slate-700 mb-2">Библиотека пуста</h2>
          <p className="text-slate-400 text-sm mb-6">Загрузите первую лекцию, чтобы начать</p>
          <button
            onClick={() => navigate('/analyze')}
            className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition"
          >
            Загрузить первый материал
          </button>
        </div>
      )}

      {/* Grid */}
      {!loading && filtered.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(m => {
            const fcCount = m.flashcards_json?.flashcards?.length || 0;
            const qCount = m.quiz_json?.quiz?.length || 0;
            const hasPodcast = m.summary_json?.podcast?.length > 0;
            return (
              <div
                key={m.id}
                onClick={() => navigate('/library/' + m.id)}
                className="card p-5 cursor-pointer hover:shadow-md transition group"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <h3 className="font-semibold text-slate-900 truncate">{m.title}</h3>
                  <button
                    onClick={e => handleDelete(e, m.id)}
                    className="shrink-0 text-slate-300 hover:text-rose-500 transition opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                {m.subject && (
                  <span className="inline-block px-2 py-0.5 bg-indigo-100 text-indigo-700 text-xs rounded-md mb-2">{m.subject}</span>
                )}
                <div className="flex items-center gap-3 text-sm text-slate-500 mb-3">
                  <span>📝</span>
                  <span>🃏 {fcCount}</span>
                  <span>❓ {qCount}</span>
                  {hasPodcast && (
                    <span className="ml-auto flex items-center gap-1 text-xs text-indigo-600 font-bold bg-indigo-50 px-2 py-0.5 rounded-full">
                      <Headphones className="w-3 h-3" /> Подкаст
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-slate-400">
                    {format(new Date(m.created_at), 'dd.MM.yyyy', { locale: ru })}
                  </p>
                  {hasPodcast && (
                    <button
                      onClick={e => { e.stopPropagation(); navigate(`/library/${m.id}?mode=express&tab=podcast`); }}
                      className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-bold transition opacity-0 group-hover:opacity-100"
                    >
                      <Headphones className="w-3.5 h-3.5" /> Слушать →
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* No results for filter */}
      {!loading && materials.length > 0 && filtered.length === 0 && (
        <p className="text-center text-slate-400 py-10">Ничего не найдено</p>
      )}
    </div>
  );
}