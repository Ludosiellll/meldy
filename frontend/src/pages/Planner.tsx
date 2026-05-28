import { useState, useEffect } from 'react';
import { Calendar, Trash2, Sparkles, CheckSquare, Square, Info, X, Clock, BookOpen } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { format, differenceInDays } from 'date-fns';
import { ru } from 'date-fns/locale';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { useConfirm } from '../contexts/ConfirmContext';
import { checkAILimit, incrementAIUsage } from '../api/limits';
import { useNavigate } from 'react-router-dom';

export default function Planner() {
  const { user } = useAuth();
  const { alert } = useConfirm();
  const navigate = useNavigate();
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
  const [dateError, setDateError] = useState('');

  const todayStr = new Date().toISOString().split('T')[0];

  const loadData = async () => {
    if (!user) return;
    const { data: sub } = await supabase.from('subjects').select('*').eq('user_id', user.id).order('exam_date');
    const { data: mat } = await supabase.from('materials').select('id, title, summary_json').eq('user_id', user.id);
    const { data: plans } = await supabase.from('study_plans').select('*').eq('user_id', user.id).order('created_at', { ascending: false });
    
    const subList = sub || [];
    const plansList = plans || [];
    setSubjects(subList);
    setMaterials(mat || []);
    setHistoryPlans(plansList);
    
    if (subList.length === 0) {
      setPlan([]);
      setHistoryPlans([]);
      setSelectedSubjectIds([]);
      setSelectedSubject('');
      return;
    }

    // НЕ выбираем автоматически — пользователь должен сам отметить нужные
    // Только если ровно 1 предмет и ничего не выбрано — выбираем его
    if (subList.length === 1 && selectedSubjectIds.length === 0) {
      setSelectedSubjectIds([subList[0].id]);
    }

    if (plansList.length > 0 && plan.length === 0) {
      setPlan(plansList[0].plan_json);
      setGoals(plansList[0].notes || '');
    } else if (plansList.length === 0) {
      setPlan([]);
    }
  };

  useEffect(() => { loadData(); }, [user?.id]);

  const addSubject = async () => {
    if (!newName || !newDate) return;
    if (newDate < todayStr) {
      setDateError('Дата экзамена не может быть в прошлом');
      return;
    }
    setDateError('');
    const { data, error } = await supabase.from('subjects').insert({ user_id: user!.id, name: newName, exam_date: newDate, color: newColor }).select().single();
    if (!error && data) {
      setSelectedSubjectIds(prev => [...prev, data.id]);
    }
    setNewName('');
    setNewDate('');
    loadData();
  };

  const deleteSubject = async (id: string) => {
    const subToDelete = subjects.find(s => s.id === id);
    await supabase.from('subjects').delete().eq('id', id);
    
    if (subToDelete?.name === selectedSubject) {
      setSelectedSubject('');
    }
    
    setSelectedSubjectIds(prev => prev.filter(sid => sid !== id));
    loadData();
  };

  const handleGeneratePlan = async () => {
    if (selectedSubjectIds.length === 0) {
      await alert({ title: 'Выберите предмет', message: 'Выберите хотя бы один предмет для планирования', type: 'warning' });
      return;
    }
    setLoading(true);

    if (user?.id) {
      const limitCheck = await checkAILimit(user.id, 5);
      if (!limitCheck.allowed) {
        await alert({ title: 'Энергия ИИ исчерпана', message: 'Не хватает энергии ИИ (нужно 5). Перейдите на PRO-тариф!', type: 'danger' });
        navigate('/pricing');
        setLoading(false);
        return;
      }
      await incrementAIUsage(user.id, 5);
    }

    try {
      const selectedContent = materials
        .filter(m => selectedMaterials.includes(m.id))
        .map(m => `Документ "${m.title}": ${m.summary_json?.content || ''}`)
        .join('\n\n');

      const selectedSubs = subjects.filter(s => selectedSubjectIds.includes(s.id));

      // Получаем актуальное настроение пользователя
      const { data: moodData } = await supabase
        .from('mood_log')
        .select('mood, energy_level, notes')
        .eq('user_id', user!.id)
        .order('logged_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      let moodInfo = "";
      if (moodData) {
          moodInfo = `\nСОСТОЯНИЕ СТУДЕНТА: настроение ${moodData.mood}, энергия ${moodData.energy_level}/5. `;
          if (moodData.energy_level <= 2) moodInfo += "Студент очень устал, планируй максимально легкие и короткие задачи.";
          else if (moodData.energy_level >= 4) moodInfo += "Студент полон сил, можно планировать интенсивную работу.";
      }

      const res = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subjects: selectedSubs.map(s => ({ name: s.name, exam_date: s.exam_date, color: s.color })),
          available_hours_per_day: hours,
          context_materials: selectedContent,
          user_goals: goals + moodInfo
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
    const s = subjects.find((s: { name: string; color: string }) => s.name === name);
    return s?.color || '#4F46E5';
  };

  // Filter plan by selected subject and ensure subject still exists
  const filteredPlan = plan.map(day => ({
    ...day,
    tasks: day.tasks?.filter((t: { subject: string }) => {
      const exists = subjects.some(s => s.name === t.subject);
      if (!exists) return false;
      return selectedSubject ? t.subject === selectedSubject : true;
    }) || []
  })).filter(day => day.tasks.length > 0);

  const subjectTaskCounts: Record<string, number> = {};
  plan.forEach(day => {
    day.tasks?.forEach((t: { subject: string; hours?: number }) => {
      subjectTaskCounts[t.subject] = (subjectTaskCounts[t.subject] || 0) + 1;
    });
  });

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-2 mb-6">
        <Calendar className="w-5 h-5 text-indigo-600" />
        <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Персональный планировщик</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-6">
        <div className="lg:col-span-3 space-y-6">
          <div className="card p-4 md:p-5">
            <h2 className="font-semibold text-slate-900 dark:text-slate-100 mb-4 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-slate-400" /> Экзамены
            </h2>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 mb-3">Отметьте галочкой предметы для плана</p>
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
                          ? 'bg-indigo-50 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-900/50 text-indigo-700 dark:text-indigo-300 font-bold'
                          : 'bg-slate-50 dark:bg-slate-800/50 border-transparent hover:border-slate-200 dark:hover:border-slate-700 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-2 overflow-hidden">
                        <div 
                          onClick={(e) => { e.stopPropagation(); toggleSubjectSelect(s.id); }}
                          className={`w-4 h-4 rounded border flex items-center justify-center transition ${
                            isPlanned ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600'
                          }`}
                        >
                          {isPlanned && <CheckSquare className="w-3 h-3" />}
                        </div>
                        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                        <span className="font-medium truncate">{s.name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {taskCount > 0 && (
                          <span className="px-1.5 py-0.5 bg-indigo-100 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 rounded text-[10px]">{taskCount}</span>
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
              <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Название предмета" className="w-full px-3 py-1.5 border border-slate-200 dark:border-slate-700 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 dark:placeholder-slate-500" />
              <div>
                <input 
                  type="date" 
                  value={newDate} 
                  min={todayStr}
                  onChange={e => { setNewDate(e.target.value); setDateError(''); }} 
                  className={`w-full px-3 py-1.5 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 ${dateError ? 'border-rose-300 dark:border-rose-700' : 'border-slate-200 dark:border-slate-700'}`} 
                />
                {dateError && <p className="text-rose-500 text-[10px] mt-1">{dateError}</p>}
              </div>
              <button onClick={addSubject} className="w-full py-2 bg-slate-800 dark:bg-slate-700 text-white rounded-lg text-sm font-medium hover:bg-slate-900 dark:hover:bg-slate-600 transition">Добавить предмет</button>
            </div>
          </div>

          <div className="card p-4 md:p-5">
            <h2 className="font-semibold text-slate-900 dark:text-slate-100 mb-3 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-slate-400" /> Часы в день
            </h2>
            <input type="number" min={1} max={12} value={hours} onChange={e => setHours(Number(e.target.value))} className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100" />
          </div>

          {historyPlans.length > 0 && (
            <div className="card p-4 md:p-5">
              <h2 className="font-semibold text-slate-900 dark:text-slate-100 mb-4 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-slate-400" /> История планов
              </h2>
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1 custom-scrollbar">
                {historyPlans.map(p => (
                  <div key={p.id} className="group relative">
                    <button
                      onClick={() => { setPlan(p.plan_json); setGoals(p.notes || ''); }}
                      className={`w-full text-left px-3 py-2 rounded-lg text-xs transition border ${
                        plan === p.plan_json 
                        ? 'bg-indigo-50 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-900/50 text-indigo-700 dark:text-indigo-300 font-bold' 
                        : 'bg-slate-50 dark:bg-slate-800/50 border-transparent text-slate-600 dark:text-slate-400 hover:border-slate-200 dark:hover:border-slate-700'
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
          <div className="card p-4 md:p-6">
            <h2 className="font-semibold text-slate-900 dark:text-slate-100 mb-4 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-indigo-500" /> На чем основывать план?
            </h2>
            
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">Выберите материалы из библиотеки, которые нужно изучить:</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
              {materials.map(m => (
                <div 
                  key={m.id} 
                  onClick={() => toggleMaterial(m.id)}
                  className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition ${
                    selectedMaterials.includes(m.id) 
                    ? 'bg-indigo-50 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-900/50 text-indigo-700 dark:text-indigo-300' 
                    : 'bg-white dark:bg-slate-800/50 border-slate-100 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600'
                  }`}
                >
                  {selectedMaterials.includes(m.id) ? <CheckSquare className="w-4 h-4 shrink-0" /> : <Square className="w-4 h-4 shrink-0" />}
                  <span className="text-sm font-medium truncate">{m.title}</span>
                </div>
              ))}
              {materials.length === 0 && <p className="text-xs text-slate-400 dark:text-slate-500 col-span-2 italic">В библиотеке пока пусто</p>}
            </div>

            <h2 className="font-semibold text-slate-900 dark:text-slate-100 mb-2 flex items-center gap-2">
              <Info className="w-4 h-4 text-slate-400" /> Ваши цели и пожелания
            </h2>
            <textarea 
              value={goals}
              onChange={e => setGoals(e.target.value)}
              placeholder="Например: 'Я плохо знаю тему массивов, удели ей больше времени' или 'Мне нужно выучить только теорию для зачета'"
              className="w-full h-24 px-4 py-3 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500 transition resize-none mb-6 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 dark:placeholder-slate-500"
            />

            <button
              onClick={handleGeneratePlan}
              disabled={loading || selectedSubjectIds.length === 0}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold transition disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Sparkles className="w-5 h-5" />}
              {loading ? 'Создаем персональный план...' : selectedSubjectIds.length === 0 ? 'Выберите предметы для плана' : `Сформировать план (${selectedSubjectIds.length} предм.) (5 ⚡ ИИ)`}
            </button>
          </div>

          {plan.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-bold text-slate-900 dark:text-slate-100 text-lg">Ваш план подготовки</h2>
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
                {filteredPlan.map((day: { date: string; tasks: any[] }, i: number) => {
                  const totalHours = day.tasks?.reduce((sum: number, t: { hours?: number }) => sum + (t.hours || 0), 0) || 0;
                  return (
                    <motion.div 
                      key={i} 
                      layoutId={`day-${day.date}`}
                      onClick={() => setSelectedDay(day)}
                      className="card p-4 md:p-5 bg-white dark:bg-slate-900 border-l-4 border-l-indigo-500 flex flex-col cursor-pointer hover:shadow-md transition-shadow group"
                    >
                      <div className="flex items-center justify-between mb-3 shrink-0">
                        <h3 className="font-bold text-slate-800 dark:text-slate-200 capitalize text-sm group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                          {format(new Date(day.date + 'T12:00:00'), 'EEEE, d MMMM', { locale: ru })}
                        </h3>
                        <div className="flex items-center gap-1 px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded-full">
                          <Clock className="w-3 h-3 text-slate-400" />
                          <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 whitespace-nowrap">{totalHours}ч</span>
                        </div>
                      </div>
                      <div className="space-y-3 flex-1">
                        {day.tasks?.map((task: { subject: string; task: string; hours?: number }, j: number) => (
                          <div key={j} className="flex items-start gap-2.5 text-xs">
                            <div className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: getColorForSubject(task.subject) }} />
                            <div className="flex-1 min-w-0">
                              <span className="font-bold text-slate-700 dark:text-slate-300 truncate block">{task.subject}</span>
                              <p className="text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed line-clamp-3">{task.task}</p>
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
              className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-[calc(100%-32px)] md:w-full max-w-2xl max-h-[90vh] overflow-hidden relative z-10 flex flex-col"
            >
              <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-white dark:bg-slate-900 sticky top-0">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-indigo-50 dark:bg-indigo-950/40 rounded-xl flex items-center justify-center">
                    <Calendar className="w-6 h-6 text-indigo-600" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 capitalize">
                      {format(new Date(selectedDay.date + 'T12:00:00'), 'EEEE, d MMMM', { locale: ru })}
                    </h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Подробный план на день</p>
                  </div>
                </div>
                <button 
                  onClick={() => setSelectedDay(null)}
                  className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition text-slate-400"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {selectedDay.tasks?.map((task: { subject: string; task: string; hours?: number }, idx: number) => (
                  <div key={idx} className="bg-slate-50 dark:bg-slate-800/60 rounded-2xl p-4 md:p-5 border border-slate-100 dark:border-slate-700">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: getColorForSubject(task.subject) }} />
                        <h3 className="font-bold text-slate-900 dark:text-slate-100 text-lg break-words line-clamp-2">{task.subject}</h3>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                          <Clock className="w-4 h-4" />
                          <span className="text-sm font-bold">{task.hours}ч</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2 text-slate-400 dark:text-slate-500">
                          <BookOpen className="w-4 h-4" />
                          <span className="text-xs font-semibold uppercase tracking-wider">Задача на день</span>
                        </div>
                        <p className="text-slate-700 dark:text-slate-300 leading-relaxed bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-100 dark:border-slate-700 shadow-sm">
                          {task.task}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="p-4 bg-slate-50 dark:bg-slate-800/60 border-t border-slate-100 dark:border-slate-700 text-center">
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
