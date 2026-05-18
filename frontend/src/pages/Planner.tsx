import { useState, useEffect } from 'react';
import { Calendar, Trash2, Sparkles, CheckSquare, Square, Info, X, Clock, BookOpen } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { format, differenceInDays } from 'date-fns';
import { ru } from 'date-fns/locale';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';

export default function Planner() {
  const { user } = useAuth();
  const [subjects, setSubjects] = useState<any[]>([]);
  const [materials, setMaterials] = useState<any[]>([]);
  const [selectedMaterials, setSelectedMaterials] = useState<string[]>([]);
  const [selectedSubjectIds, setSelectedSubjectIds] = useState<string[]>([]);
  const [goals, setGoals] = useState('');
  const [plan, setPlan] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [hours, setHours] = useState(2);
  const [newName, setNewName] = useState('');
  const [newDate, setNewDate] = useState('');
  const [newColor, setNewColor] = useState('#4F46E5');
  const [historyPlans, setHistoryPlans] = useState<any[]>([]);
  const [selectedSubject, setSelectedSubject] = useState<string>('');
  const [selectedDay, setSelectedDay] = useState<any>(null);

  const loadData = async () => {
    if (!user) return;
    const { data: sub } = await supabase.from('subjects').select('*').eq('user_id', user.id).order('exam_date');
    const { data: mat } = await supabase.from('materials').select('id, title, summary_json').eq('user_id', user.id);
    const { data: plans } = await supabase.from('study_plans').select('*').eq('user_id', user.id).order('created_at', { ascending: false });
    
    const subList = sub || [];
    setSubjects(subList);
    setMaterials(mat || []);
    setHistoryPlans(plans || []);
    
    // По умолчанию выбираем все предметы для планирования, если еще не выбраны
    if (selectedSubjectIds.length === 0 && subList.length > 0) {
      setSelectedSubjectIds(subList.map(s => s.id));
    }

    if (plans && plans.length > 0 && plan.length === 0) {
      setPlan(plans[0].plan_json);
      setGoals(plans[0].notes || '');
    }
  };

  useEffect(() => { loadData(); }, [user]);

  const addSubject = async () => {
    if (!newName || !newDate) return;
    const { data, error } = await supabase.from('subjects').insert({ user_id: user!.id, name: newName, exam_date: newDate, color: newColor }).select().single();
    if (!error && data) {
      setSelectedSubjectIds(prev => [...prev, data.id]);
    }
    setNewName('');
    setNewDate('');
    loadData();
  };

  const deleteSubject = async (id: string) => {
    await supabase.from('subjects').delete().eq('id', id);
    setSelectedSubjectIds(prev => prev.filter(sid => sid !== id));
    loadData();
  };

  const generatePlan = async () => {
    if (selectedSubjectIds.length === 0) return alert('Выберите хотя бы один предмет для планирования');
    setLoading(true);
    try {
      const selectedContent = materials
        .filter(m => selectedMaterials.includes(m.id))
        .map(m => `Документ "${m.title}": ${m.summary_json?.content || ''}`)
        .join('\n\n');

      const selectedSubs = subjects.filter(s => selectedSubjectIds.includes(s.id));

      const res = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subjects: selectedSubs.map(s => ({ name: s.name, exam_date: s.exam_date, color: s.color })),
          available_hours_per_day: hours,
          context_materials: selectedContent,
          user_goals: goals
        }),
      });
      const data = await res.json();
      const generatedPlan = data.plan || [];
      setPlan(generatedPlan);

      if (user && generatedPlan.length > 0) {
        const subNames = selectedSubs.map(s => s.name).join(', ');
        await supabase.from('study_plans').insert({
          user_id: user.id,
          title: `${subNames.length > 20 ? subNames.slice(0, 20) + '...' : subNames} (${format(new Date(), 'dd.MM')})`,
          plan_json: generatedPlan,
          notes: goals
        });
        loadData(); // Reload history
      }
    } catch (err) {
      console.error('Error generating/saving plan:', err);
      setPlan([]);
    }
    setLoading(false);
  };

  const toggleMaterial = (id: string) => {
    setSelectedMaterials(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const toggleSubjectSelect = (id: string) => {
    setSelectedSubjectIds(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const getColorForSubject = (name: string) => {
    const s = subjects.find((s: any) => s.name === name);
    return s?.color || '#4F46E5';
  };

  const filteredPlan = selectedSubject
    ? plan.map(day => ({
        ...day,
        tasks: day.tasks?.filter((t: any) => t.subject === selectedSubject) || []
      })).filter(day => day.tasks.length > 0)
    : plan;

  const subjectTaskCounts: Record<string, number> = {};
  plan.forEach(day => {
    day.tasks?.forEach((t: any) => {
      subjectTaskCounts[t.subject] = (subjectTaskCounts[t.subject] || 0) + 1;
    });
  });

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-2 mb-6">
        <Calendar className="w-5 h-5 text-indigo-600" />
        <h1 className="text-xl font-bold text-slate-900">Персональный планировщик</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-3 space-y-6">
          <div className="card p-5">
            <h2 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-slate-400" /> Экзамены
            </h2>
            <div className="space-y-3 mb-4">
              {subjects.map(s => {
                const taskCount = subjectTaskCounts[s.name] || 0;
                const isSelected = selectedSubject === s.name;
                const isPlanned = selectedSubjectIds.includes(s.id);
                return (
                  <div key={s.id} className="group relative">
                    <button
                      onClick={() => setSelectedSubject(isSelected ? '' : s.name)}
                      className={`w-full flex items-center justify-between text-sm p-2 rounded-lg transition border ${
                        isSelected
                          ? 'bg-indigo-50 border-indigo-200 text-indigo-700 font-bold'
                          : 'bg-slate-50 border-transparent hover:border-slate-200 text-slate-600'
                      }`}
                    >
                      <div className="flex items-center gap-2 overflow-hidden">
                        <div 
                          onClick={(e) => { e.stopPropagation(); toggleSubjectSelect(s.id); }}
                          className={`w-4 h-4 rounded border flex items-center justify-center transition ${
                            isPlanned ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-300'
                          }`}
                        >
                          {isPlanned && <CheckSquare className="w-3 h-3" />}
                        </div>
                        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                        <span className="font-medium truncate">{s.name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {taskCount > 0 && (
                          <span className="px-1.5 py-0.5 bg-indigo-100 text-indigo-600 rounded text-[10px]">{taskCount}</span>
                        )}
                        <button 
                          onClick={(e) => { e.stopPropagation(); deleteSubject(s.id); }} 
                          className="text-slate-300 hover:text-rose-500 transition opacity-0 group-hover:opacity-100"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="space-y-2">
              <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Название" className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500" />
              <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500" />
              <button onClick={addSubject} className="w-full py-2 bg-slate-800 text-white rounded-lg text-sm font-medium hover:bg-slate-900 transition">Добавить предмет</button>
            </div>
          </div>

          <div className="card p-5">
            <h2 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-slate-400" /> Часы в день
            </h2>
            <input type="number" min={1} max={12} value={hours} onChange={e => setHours(Number(e.target.value))} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>

          {historyPlans.length > 0 && (
            <div className="card p-5">
              <h2 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-slate-400" /> История планов
              </h2>
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1 custom-scrollbar">
                {historyPlans.map(p => (
                  <div key={p.id} className="group relative">
                    <button
                      onClick={() => { setPlan(p.plan_json); setGoals(p.notes || ''); }}
                      className={`w-full text-left px-3 py-2 rounded-lg text-xs transition border ${
                        plan === p.plan_json 
                        ? 'bg-indigo-50 border-indigo-200 text-indigo-700 font-bold' 
                        : 'bg-slate-50 border-transparent text-slate-600 hover:border-slate-200'
                      }`}
                    >
                      {p.title}
                    </button>
                    <button 
                      onClick={async () => {
                        await supabase.from('study_plans').delete().eq('id', p.id);
                        loadData();
                      }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="lg:col-span-9 space-y-6">
          <div className="card p-6">
            <h2 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-indigo-500" /> На чем основывать план?
            </h2>
            
            <p className="text-sm text-slate-500 mb-4">Выберите материалы из библиотеки, которые нужно изучить:</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
              {materials.map(m => (
                <div 
                  key={m.id} 
                  onClick={() => toggleMaterial(m.id)}
                  className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition ${
                    selectedMaterials.includes(m.id) 
                    ? 'bg-indigo-50 border-indigo-200 text-indigo-700' 
                    : 'bg-white border-slate-100 text-slate-600 hover:border-slate-300'
                  }`}
                >
                  {selectedMaterials.includes(m.id) ? <CheckSquare className="w-4 h-4 shrink-0" /> : <Square className="w-4 h-4 shrink-0" />}
                  <span className="text-sm font-medium truncate">{m.title}</span>
                </div>
              ))}
              {materials.length === 0 && <p className="text-xs text-slate-400 col-span-2 italic">В библиотеке пока пусто</p>}
            </div>

            <h2 className="font-semibold text-slate-900 mb-2 flex items-center gap-2">
              <Info className="w-4 h-4 text-slate-400" /> Ваши цели и пожелания
            </h2>
            <textarea 
              value={goals}
              onChange={e => setGoals(e.target.value)}
              placeholder="Например: 'Я плохо знаю тему массивов, удели ей больше времени' или 'Мне нужно выучить только теорию для зачета'"
              className="w-full h-24 px-4 py-3 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500 transition resize-none mb-6"
            />

            <button
              onClick={generatePlan}
              disabled={subjects.length === 0 || loading}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold transition disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Sparkles className="w-5 h-5" />}
              {loading ? 'Создаем персональный план...' : 'Сформировать план обучения'}
            </button>
          </div>

          {plan.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-bold text-slate-900 text-lg">Ваш план подготовки</h2>
                {selectedSubject && (
                  <button 
                    onClick={() => setSelectedSubject('')}
                    className="text-xs text-indigo-600 hover:underline"
                  >
                    Показать все предметы
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {filteredPlan.map((day: any, i: number) => {
                  const totalHours = day.tasks?.reduce((sum: number, t: any) => sum + (t.hours || 0), 0) || 0;
                  return (
                    <motion.div 
                      key={i} 
                      layoutId={`day-${day.date}`}
                      onClick={() => setSelectedDay(day)}
                      className="card p-5 bg-white border-l-4 border-l-indigo-500 flex flex-col cursor-pointer hover:shadow-md transition-shadow group"
                    >
                      <div className="flex items-center justify-between mb-3 shrink-0">
                        <h3 className="font-bold text-slate-800 capitalize text-sm group-hover:text-indigo-600 transition-colors">
                          {format(new Date(day.date + 'T12:00:00'), 'EEEE, d MMMM', { locale: ru })}
                        </h3>
                        <div className="flex items-center gap-1 px-2 py-0.5 bg-slate-100 rounded-full">
                          <Clock className="w-3 h-3 text-slate-400" />
                          <span className="text-[10px] font-bold text-slate-500 whitespace-nowrap">{totalHours}ч</span>
                        </div>
                      </div>
                      <div className="space-y-3 flex-1">
                        {day.tasks?.map((task: any, j: number) => (
                          <div key={j} className="flex items-start gap-2.5 text-xs">
                            <div className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: getColorForSubject(task.subject) }} />
                            <div className="flex-1 min-w-0">
                              <span className="font-bold text-slate-700 truncate block">{task.subject}</span>
                              <p className="text-slate-500 mt-0.5 leading-relaxed line-clamp-3">{task.task}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modal for Day Details */}
      <AnimatePresence>
        {selectedDay && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedDay(null)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden relative z-10 flex flex-col"
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-white sticky top-0">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-indigo-50 rounded-xl flex items-center justify-center">
                    <Calendar className="w-6 h-6 text-indigo-600" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-slate-900 capitalize">
                      {format(new Date(selectedDay.date + 'T12:00:00'), 'EEEE, d MMMM', { locale: ru })}
                    </h2>
                    <p className="text-sm text-slate-500">Подробный план на день</p>
                  </div>
                </div>
                <button 
                  onClick={() => setSelectedDay(null)}
                  className="p-2 hover:bg-slate-100 rounded-full transition text-slate-400"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {selectedDay.tasks?.map((task: any, idx: number) => (
                  <div key={idx} className="bg-slate-50 rounded-2xl p-5 border border-slate-100">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: getColorForSubject(task.subject) }} />
                        <h3 className="font-bold text-slate-900 text-lg">{task.subject}</h3>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-1.5 text-slate-500">
                          <Clock className="w-4 h-4" />
                          <span className="text-sm font-bold">{task.hours}ч</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2 text-slate-400">
                          <BookOpen className="w-4 h-4" />
                          <span className="text-xs font-semibold uppercase tracking-wider">Задача на день</span>
                        </div>
                        <p className="text-slate-700 leading-relaxed bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
                          {task.task}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="p-4 bg-slate-50 border-t border-slate-100 text-center">
                <button 
                  onClick={() => setSelectedDay(null)}
                  className="px-6 py-2 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 transition shadow-lg shadow-indigo-100"
                >
                  Понятно
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
