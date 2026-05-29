import { Material } from '../types';
import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, BookOpen, Trash2, Plus, Headphones, Globe, Lock, EyeOff } from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { useAuth } from '../hooks/useAuth';
import { useConfirm } from '../contexts/ConfirmContext';
import { getMaterials, deleteMaterial, updateMaterialVisibility } from '../api/materials';
import { getAssignedMaterials, joinGroup } from '../api/groups';
import { CustomSelect } from '../components/CustomSelect';

export default function Library() {
  const { user } = useAuth();
  const { confirm } = useConfirm();
  const navigate = useNavigate();
  const [materials, setMaterials] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('');
  const [loading, setLoading] = useState(true);

  const [showJoinModal, setShowJoinModal] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [classNickname, setClassNickname] = useState('');
  const [joinError, setJoinError] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();

  // Handle ?join=CODE parameter
  useEffect(() => {
    const joinCode = searchParams.get('join');
    if (joinCode) {
      setInviteCode(joinCode);
      setShowJoinModal(true);
      // Clean up URL to avoid re-triggering if page is refreshed
      setSearchParams({});
    }
  }, [searchParams, setSearchParams]);

  const loadData = async () => {
    if (!user) return;
    
    const cached = localStorage.getItem(`library_cache_${user.id}`);
    if (cached) {
      try {
        setMaterials(JSON.parse(cached));
        setLoading(false);
      } catch (e) {}
    } else {
      setLoading(true);
    }
    
    try {
      const [myMats, assignedMats] = await Promise.all([
        getMaterials(user.id),
        getAssignedMaterials(user.id)
      ]);
      // Remove duplicates by ID (if teacher assigned my own material)
      const all = [...myMats, ...assignedMats];
      const unique = Array.from(new Map(all.map(m => [m.id, m])).values());
      
      const hidden = JSON.parse(localStorage.getItem(`hidden_assignments_${user.id}`) || '[]');
      const visible = unique.filter(m => !hidden.includes(m.id));
      
      setMaterials(visible);
      localStorage.setItem(`library_cache_${user.id}`, JSON.stringify(visible));
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadData();
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

  const handleHideAssignment = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!user) return;
    const hidden = JSON.parse(localStorage.getItem(`hidden_assignments_${user.id}`) || '[]');
    hidden.push(id);
    localStorage.setItem(`hidden_assignments_${user.id}`, JSON.stringify(hidden));
    
    const newMaterials = materials.filter(m => m.id !== id);
    setMaterials(newMaterials);
    localStorage.setItem(`library_cache_${user.id}`, JSON.stringify(newMaterials));
    toast.success('Задание скрыто из библиотеки');
  };

  const handleTogglePublic = async (e: React.MouseEvent, material: any) => {
    e.stopPropagation();
    const newStatus = !material.is_public;
    await updateMaterialVisibility(material.id, newStatus);
    setMaterials(prev => prev.map(m => m.id === material.id ? { ...m, is_public: newStatus } : m));
  };

  const handleJoinGroup = async () => {
    if (!user || !inviteCode.trim() || !classNickname.trim()) return;
    setJoinError('');
    const ok = await joinGroup(user.id, inviteCode.trim(), classNickname.trim());
    if (ok) {
      setShowJoinModal(false);
      setInviteCode('');
      setClassNickname('');
      loadData(); // Reload materials to get assignments
      toast.success('Успешно присоединились к классу!');
      navigate('/teacher');
    } else {
      setJoinError('Неверный код или вы уже состоите в группе.');
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Библиотека знаний</h1>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowJoinModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg text-sm font-bold transition"
          >
            Ввести код класса
          </button>
          <button
            onClick={() => navigate('/analyze')}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition"
          >
            <Plus className="w-4 h-4" />
            Новый анализ →
          </button>
        </div>
      </div>

      {showJoinModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 w-full max-w-sm shadow-xl border border-slate-200 dark:border-slate-800">
            <h3 className="font-bold text-xl text-slate-900 dark:text-slate-100 mb-2">Присоединиться к группе</h3>
            <p className="text-slate-500 dark:text-slate-400 text-sm mb-4">Введите код класса и ваши настоящие имя и фамилию (для преподавателя).</p>
            <input 
              autoFocus
              value={inviteCode} 
              onChange={e => setInviteCode(e.target.value.toUpperCase())}
              placeholder="Код: A7B-9X2" 
              className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl mb-3 font-mono text-center text-xl uppercase tracking-widest focus:ring-2 focus:ring-indigo-500 outline-none text-slate-900 dark:text-slate-100" 
            />
            <input 
              value={classNickname} 
              onChange={e => setClassNickname(e.target.value)}
              placeholder="Ваши Имя и Фамилия" 
              className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl mb-2 text-center text-lg focus:ring-2 focus:ring-indigo-500 outline-none text-slate-900 dark:text-slate-100" 
            />
            {joinError && <p className="text-rose-500 text-sm mb-4 text-center">{joinError}</p>}
            <div className="flex gap-2 mt-4">
              <button onClick={() => setShowJoinModal(false)} className="flex-1 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700">Отмена</button>
              <button onClick={handleJoinGroup} disabled={!inviteCode.trim() || !classNickname.trim()} className="flex-1 py-2.5 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 disabled:opacity-50">Вступить</button>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6 relative z-20">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Поиск по названию..."
            className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500 transition text-slate-900 dark:text-slate-100"
          />
        </div>
        {subjects.length > 0 && (
          <CustomSelect
            value={subjectFilter}
            onChange={val => setSubjectFilter(val)}
            options={[
              { value: '', label: 'Все предметы' },
              ...subjects.map(s => ({ value: s, label: s }))
            ]}
            className="sm:w-64 px-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-sm text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 shadow-sm"
          />
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 animate-pulse">
              <div className="flex gap-2 mb-3">
                <div className="h-4 w-24 bg-slate-200 dark:bg-slate-800 rounded"></div>
                <div className="h-4 w-16 bg-slate-200 dark:bg-slate-800 rounded"></div>
              </div>
              <div className="h-6 w-3/4 bg-slate-200 dark:bg-slate-800 rounded mb-4"></div>
              <div className="flex gap-3 mb-6">
                <div className="h-4 w-10 bg-slate-200 dark:bg-slate-800 rounded"></div>
                <div className="h-4 w-10 bg-slate-200 dark:bg-slate-800 rounded"></div>
                <div className="h-4 w-16 bg-slate-200 dark:bg-slate-800 rounded ml-auto"></div>
              </div>
              <div className="pt-3 border-t border-slate-100 dark:border-slate-800/60 flex justify-between">
                <div className="h-3 w-20 bg-slate-200 dark:bg-slate-800 rounded"></div>
                <div className="h-3 w-16 bg-slate-200 dark:bg-slate-800 rounded"></div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty */}
      {!loading && materials.length === 0 && (
        <div className="text-center py-20">
          <BookOpen className="w-16 h-16 text-slate-300 dark:text-slate-700 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-slate-700 dark:text-slate-300 mb-2">Библиотека пуста</h2>
          <p className="text-slate-400 dark:text-slate-500 text-sm mb-6">Загрузите первую лекцию, чтобы начать</p>
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
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap gap-1.5 mb-1.5">
                      {(m as any).is_assigned && (
                        <span className="inline-block px-2 py-0.5 bg-amber-100 text-amber-800 text-[10px] font-bold rounded uppercase tracking-wider">
                          От преподавателя
                        </span>
                      )}
                      {m.subject && (
                        <span className="inline-block px-2 py-0.5 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 text-[10px] font-bold rounded uppercase tracking-wider truncate max-w-[150px]">
                          {m.subject}
                        </span>
                      )}
                      {!(m as any).is_assigned && (
                        <button
                          onClick={e => handleTogglePublic(e, m)}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded uppercase tracking-wider transition ${
                            m.is_public
                              ? 'bg-emerald-100 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/40'
                              : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 hover:text-indigo-700 dark:hover:text-indigo-400 border border-slate-200 dark:border-slate-700 hover:border-indigo-200 dark:hover:border-indigo-800/40'
                          }`}
                          title={m.is_public ? 'Опубликовано в Study Network. Нажмите, чтобы сделать приватным.' : 'Опубликовать в Study Network'}
                        >
                          {m.is_public ? (
                            <><Globe className="w-3 h-3 text-emerald-600 dark:text-emerald-400" /> В сети</>
                          ) : (
                            <><Lock className="w-3 h-3 text-slate-400 dark:text-slate-500" /> Поделиться</>
                          )}
                        </button>
                      )}
                    </div>
                    <h3 className="font-semibold text-slate-900 dark:text-slate-100 leading-snug line-clamp-2 break-words">{m.title}</h3>
                  </div>
                  {!(m as any).is_assigned && (
                    <button
                      onClick={e => handleDelete(e, m.id)}
                      className="shrink-0 p-1.5 text-slate-400 dark:text-slate-500 hover:text-rose-500 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg transition opacity-0 group-hover:opacity-100"
                      title="Удалить"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                  {(m as any).is_assigned && (
                    <button
                      onClick={e => handleHideAssignment(e, m.id)}
                      className="shrink-0 p-1.5 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition opacity-0 group-hover:opacity-100"
                      title="Скрыть задание"
                    >
                      <EyeOff className="w-4 h-4" />
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-3 text-sm text-slate-500 dark:text-slate-400 mb-3">
                  <span>📝</span>
                  <span>🃏 {fcCount}</span>
                  <span>❓ {qCount}</span>
                  {hasPodcast && (
                    <span className="ml-auto flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400 font-bold bg-indigo-50 dark:bg-indigo-950/40 px-2 py-0.5 rounded-full">
                      <Headphones className="w-3 h-3" /> Подкаст
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between mt-auto pt-2 border-t border-slate-50 dark:border-slate-800/60">
                  <div className="flex flex-col">
                    <p className="text-xs text-slate-400 dark:text-slate-500">
                      {format(new Date(m.created_at), 'dd.MM.yyyy', { locale: ru })}
                    </p>
                    {(m as any).assigned_deadline && (
                      <p className="text-[10px] font-bold text-rose-500 mt-0.5">
                        Дедлайн: {format(new Date((m as any).assigned_deadline), 'dd.MM, HH:mm', { locale: ru })}
                      </p>
                    )}
                  </div>
                  {hasPodcast && (
                    <button
                      onClick={e => { e.stopPropagation(); navigate(`/library/${m.id}?mode=express&tab=podcast`); }}
                      className="flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 font-bold transition opacity-0 group-hover:opacity-100"
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
        <p className="text-center text-slate-400 dark:text-slate-500 py-10">Ничего не найдено</p>
      )}
    </div>
  );
}