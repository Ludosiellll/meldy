import { useState, useEffect } from 'react';
import { Calendar, Trash2, Sparkles, CheckSquare, Square, Info } from 'lucide-react';
import { format, differenceInDays } from 'date-fns';
import { ru } from 'date-fns/locale';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';

export default function Planner() {
  const { user } = useAuth();
  const [subjects, setSubjects] = useState<any[]>([]);
  const [materials, setMaterials] = useState<any[]>([]);
  const [selectedMaterials, setSelectedMaterials] = useState<string[]>([]);
  const [goals, setGoals] = useState('');
  const [plan, setPlan] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [hours, setHours] = useState(2);
  const [newName, setNewName] = useState('');
  const [newDate, setNewDate] = useState('');
  const [newColor, setNewColor] = useState('#4F46E5');

  const loadData = async () => {
    if (!user) return;
    const { data: sub } = await supabase.from('subjects').select('*').eq('user_id', user.id).order('exam_date');
    const { data: mat } = await supabase.from('materials').select('id, title, summary_json').eq('user_id', user.id);
    setSubjects(sub || []);
    setMaterials(mat || []);
  };

  useEffect(() => { loadData(); }, [user]);

  const addSubject = async () => {
    if (!newName || !newDate) return;
    await supabase.from('subjects').insert({ user_id: user!.id, name: newName, exam_date: newDate, color: newColor });
    setNewName('');
    setNewDate('');
    loadData();
  };

  const deleteSubject = async (id: string) => {
    await supabase.from('subjects').delete().eq('id', id);
    loadData();
  };

  const generatePlan = async () => {
    setLoading(true);
    try {
      const selectedContent = materials
        .filter(m => selectedMaterials.includes(m.id))
        .map(m => `Документ "${m.title}": ${m.summary_json?.content || ''}`)
        .join('\n\n');

      const res = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subjects: subjects.map(s => ({ name: s.name, exam_date: s.exam_date, color: s.color })),
          available_hours_per_day: hours,
          context_materials: selectedContent,
          user_goals: goals
        }),
      });
      const data = await res.json();
      setPlan(data.plan || []);
    } catch {
      setPlan([]);
    }
    setLoading(false);
  };

  const toggleMaterial = (id: string) => {
    setSelectedMaterials(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const getColorForSubject = (name: string) => {
    const s = subjects.find((s: any) => s.name === name);
    return s?.color || '#4F46E5';
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-2 mb-6">
        <Calendar className="w-5 h-5 text-indigo-600" />
        <h1 className="text-xl font-bold text-slate-900">Персональный планировщик</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-4 space-y-6">
          <div className="card p-5">
            <h2 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-slate-400" /> Экзамены
            </h2>
            <div className="space-y-3 mb-4">
              {subjects.map(s => (
                <div key={s.id} className="flex items-center justify-between text-sm p-2 bg-slate-50 rounded-lg">
                  <div className="flex items-center gap-2 overflow-hidden">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                    <span className="font-medium truncate">{s.name}</span>
                  </div>
                  <button onClick={() => deleteSubject(s.id)} className="text-slate-300 hover:text-rose-500 ml-2">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
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
        </div>

        <div className="lg:col-span-8 space-y-6">
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
              <h2 className="font-bold text-slate-900 text-lg">Ваш план подготовки</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {plan.map((day: any, i: number) => {
                  const totalHours = day.tasks?.reduce((sum: number, t: any) => sum + (t.hours || 0), 0) || 0;
                  return (
                    <div key={i} className="card p-5 bg-white border-l-4 border-l-indigo-500 flex flex-col">
                      <div className="flex items-center justify-between mb-3 shrink-0">
                        <h3 className="font-bold text-slate-800 capitalize text-sm">
                          {format(new Date(day.date + 'T12:00:00'), 'EEEE, d MMMM', { locale: ru })}
                        </h3>
                        <span className="px-2 py-0.5 bg-slate-100 rounded-full text-[10px] font-bold text-slate-500 whitespace-nowrap">{totalHours}ч</span>
                      </div>
                      <div className="space-y-3 flex-1">
                        {day.tasks?.map((task: any, j: number) => (
                          <div key={j} className="flex items-start gap-2.5 text-xs">
                            <div className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: getColorForSubject(task.subject) }} />
                            <div className="flex-1 min-w-0">
                              <span className="font-bold text-slate-700 truncate block">{task.subject}</span>
                              <p className="text-slate-500 mt-0.5 leading-relaxed line-clamp-3">{task.task}</p>
                            </div>
                            <span className="text-[10px] font-bold text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded shrink-0">{task.hours}ч</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
