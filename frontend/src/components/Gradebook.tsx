import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { Camera, Plus, BookOpen, AlertTriangle, Crosshair, Check, Sparkles, Upload, ArrowLeft, Trash2, LayoutGrid, Table } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { CustomSelect } from './CustomSelect';
import { checkAILimit, incrementAIUsage } from '../api/limits';
import { updateQuestProgress } from '../api/quests';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  images?: string[];
}

interface Subject {
  id: string;
  name: string;
  color: string;
  target_grade: number;
}

interface Grade {
  id: string;
  subject_id: string;
  value: number;
  weight: number;
  date: string;
}

export default function Gradebook() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: subjects = [], isLoading: isLoadingSubjects } = useQuery({
    queryKey: ['academic_subjects', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await supabase.from('academic_subjects').select('*').eq('user_id', user.id);
      if (error) throw error;
      return data as Subject[];
    },
    enabled: !!user?.id
  });

  const { data: grades = [], isLoading: isLoadingGrades } = useQuery({
    queryKey: ['academic_grades', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await supabase.from('academic_grades').select('*').eq('user_id', user.id).order('date', { ascending: false });
      if (error) throw error;
      return data as Grade[];
    },
    enabled: !!user?.id
  });

  const loading = isLoadingSubjects || isLoadingGrades;

  const [showAddSubject, setShowAddSubject] = useState(false);
  const [newSubName, setNewSubName] = useState('');
  const [newSubTarget, setNewSubTarget] = useState(9.0);

  const [showAddGrade, setShowAddGrade] = useState(false);
  const [gradeSubId, setGradeSubId] = useState('');
  const [gradeValue, setGradeValue] = useState<number>(5);

  const [showScan, setShowScan] = useState(false);
  const [scanText, setScanText] = useState('');
  const [scanImages, setScanImages] = useState<string[]>([]);
  const [scanMessages, setScanMessages] = useState<ChatMessage[]>([{
    role: 'assistant',
    content: 'Привет! Загрузите фото дневника или зачётки (можно несколько), и я помогу автоматически перенести оценки. Можете добавить текст (например, "Я Иванов Иван, предмет физика").'
  }]);
  const [scanning, setScanning] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  
  const [selectedSubject, setSelectedSubject] = useState<Subject | null>(null);
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [scanMessages, scanning]);

  const addSubjectMutation = useMutation({
    mutationFn: async () => {
      if (!user || !newSubName.trim()) throw new Error('No user or name');
      const { data, error } = await supabase.from('academic_subjects').insert({
        user_id: user.id,
        name: newSubName.trim(),
        target_grade: newSubTarget,
        color: '#6366f1'
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['academic_subjects'] });
      setShowAddSubject(false);
      setNewSubName('');
      toast.success('Предмет успешно добавлен!');
    }
  });

  const handleAddSubject = () => addSubjectMutation.mutate();

  const addGradeMutation = useMutation({
    mutationFn: async (params?: { subId: string, val: number }) => {
      if (!user) throw new Error('No user');
      const targetSubId = params?.subId || gradeSubId;
      const targetVal = params?.val !== undefined ? params.val : gradeValue;
      if (!targetSubId) throw new Error('No subject');
      const { data, error } = await supabase.from('academic_grades').insert({
        user_id: user.id,
        subject_id: targetSubId,
        value: targetVal,
        date: new Date().toISOString().split('T')[0]
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['academic_grades'] });
      setShowAddGrade(false);
      if (user) updateQuestProgress(user.id, 'grade', 1);
      toast.success('Оценка сохранена!');
    }
  });

  const handleAddGrade = (params?: { subId: string, val: number }) => addGradeMutation.mutate(params);

  const deleteGradeMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('academic_grades').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['academic_grades'] });
      toast.success('Оценка удалена');
    }
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      Array.from(files).forEach(file => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64String = reader.result as string;
          setScanImages(prev => [...prev, base64String.split(',')[1]]);
        };
        reader.readAsDataURL(file);
      });
    }
    // reset input
    if (e.target) e.target.value = '';
  };

  const handleScan = async () => {
    if (!scanText && scanImages.length === 0) return;
    
    // Проверка лимитов для AI
    if (user?.id) {
      const limitCheck = await checkAILimit(user.id);
      if (!limitCheck.allowed) {
        toast.error('Лимит запросов исчерпан. Перейдите на PRO!');
        navigate('/pricing');
        return;
      }
    }

    const newUserMsg: ChatMessage = {
      role: 'user',
      content: scanText,
      images: scanImages.length > 0 ? [...scanImages] : undefined
    };
    
    const requestImages = [...scanImages];
    const requestText = scanText;
    
    setScanMessages(prev => [...prev, newUserMsg]);
    setScanImages([]);
    setScanText('');
    setScanning(true);
    
    try {
      if (user?.id) await incrementAIUsage(user.id);
      
      const res = await fetch('/api/academic/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          images_base64: requestImages,
          text: requestText,
          mime_type: 'image/jpeg',
          chat_history: scanMessages.map(m => ({ role: m.role, content: m.content }))
        })
      });
      const data = await res.json();
      
      if (data.message) {
        setScanMessages(prev => [...prev, { role: 'assistant', content: data.message }]);
      }
      
      // Auto-create subjects if they don't exist
      let localSubjects = [...subjects];
      for (const g of data.grades || []) {
        let sub = localSubjects.find(s => s.name.toLowerCase() === g.subject.toLowerCase());
        if (!sub) {
          const isFive = subjects.length > 0 && subjects.every(s => s.target_grade <= 5) && grades.every(gr => gr.value <= 5);
          const { data: newSub } = await supabase.from('academic_subjects').insert({
            user_id: user!.id,
            name: g.subject,
            target_grade: (isFive && g.value <= 5) ? 5.0 : 9.0,
            color: '#6366f1'
          }).select().single();
          if (newSub) {
            sub = newSub;
            localSubjects.push(newSub as Subject);
          }
        }
        
        if (sub) {
          await supabase.from('academic_grades').insert({
            user_id: user!.id,
            subject_id: sub.id,
            value: g.value,
            date: g.date || new Date().toISOString().split('T')[0]
          });
        }
      }
      
      if (data.grades && data.grades.length > 0) {
        queryClient.invalidateQueries({ queryKey: ['academic_grades'] });
        queryClient.invalidateQueries({ queryKey: ['academic_subjects'] });
        updateQuestProgress(user!.id, 'grade', data.grades.length);
        toast.success(`Распознано и добавлено ${data.grades.length} оценок!`);
      }
    } catch (err) {
      console.error(err);
      setScanMessages(prev => [...prev, { role: 'assistant', content: 'Ой, произошла ошибка! Попробуйте еще раз.' }]);
    }
    setScanning(false);
  };

  if (loading) return <div className="p-8 text-center text-slate-500">Загрузка дневника...</div>;

  const subjectStats = subjects.map(sub => {
    const subGrades = grades.filter(g => g.subject_id === sub.id);
    const avg = subGrades.length ? subGrades.reduce((sum, g) => sum + g.value, 0) / subGrades.length : 0;
    return { ...sub, avg, count: subGrades.length };
  });

  const overallAvg = subjectStats.length 
    ? subjectStats.reduce((sum, s) => sum + s.avg, 0) / subjectStats.filter(s => s.avg > 0).length 
    : 0;

  // Default to 10.0 unless there are grades/subjects that explicitly suggest a 5-point system
  const isFivePoint = subjects.length > 0 && subjects.every(s => s.target_grade <= 5) && grades.every(g => g.value <= 5);
  const maxScore = isFivePoint ? 5.0 : 10.0;

  if (selectedSubject) {
    const subGrades = grades.filter(g => g.subject_id === selectedSubject.id).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const subStat = subjectStats.find(s => s.id === selectedSubject.id);
    
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => setSelectedSubject(null)} className="p-2 bg-slate-100 dark:bg-slate-800 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition">
              <ArrowLeft className="w-5 h-5 text-slate-700 dark:text-slate-300" />
            </button>
            <h2 className="font-bold text-xl text-slate-900 dark:text-slate-100">{selectedSubject.name}</h2>
          </div>
          <div className="bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-400 px-3 py-1.5 rounded-lg font-bold">
            Средний балл: {subStat?.avg ? subStat.avg.toFixed(2) : '-'}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 shadow-sm border border-slate-200 dark:border-slate-800">
          <h3 className="font-bold text-sm text-slate-500 mb-3 uppercase tracking-wider">Быстрое добавление (сегодня)</h3>
          <div className="flex flex-wrap gap-2 mb-2">
            {[2, 3, 4, 5, 6, 7, 8, 9, 10].map(v => (
              <button 
                key={v}
                onClick={() => handleAddGrade({ subId: selectedSubject.id, val: v })}
                disabled={addGradeMutation.isPending}
                className="w-10 h-10 rounded-xl font-black text-base bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 hover:text-indigo-600 dark:hover:text-indigo-400 transition"
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 text-xs uppercase tracking-wider">
                <th className="p-4 font-bold">Оценка</th>
                <th className="p-4 font-bold">Дата</th>
                <th className="p-4 font-bold text-right">Действие</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {subGrades.length === 0 ? (
                <tr><td colSpan={3} className="p-8 text-center text-slate-500">Пока нет оценок</td></tr>
              ) : subGrades.map(g => (
                <tr key={g.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition">
                  <td className="p-4 font-black text-lg text-slate-800 dark:text-slate-200">{g.value}</td>
                  <td className="p-4 text-slate-500">{new Date(g.date).toLocaleDateString()}</td>
                  <td className="p-4 text-right">
                    <button onClick={() => deleteGradeMutation.mutate(g.id)} className="p-2 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded-lg transition">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header Widget */}
      <div className="bg-gradient-to-r from-indigo-600 via-purple-600 to-rose-500 rounded-2xl p-6 text-white flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 shadow-lg">
        <div>
          <p className="text-white/80 font-bold uppercase tracking-wider text-xs mb-1">Моя успеваемость (GPA)</p>
          <div className="flex items-end gap-3">
            <span className="text-4xl font-black">{overallAvg ? overallAvg.toFixed(2) : '-'}</span>
            <span className="text-white/60 text-sm mb-1 pb-0.5">/ {maxScore.toFixed(1)}</span>
          </div>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <button onClick={() => setShowScan(true)} className="flex-1 sm:flex-none bg-white/20 hover:bg-white/30 backdrop-blur-sm p-3 rounded-xl transition flex flex-col items-center gap-1">
            <Camera className="w-5 h-5" />
            <span className="text-[10px] font-bold">Скан по фото</span>
          </button>
          <button onClick={() => { setShowAddGrade(true); setGradeValue(maxScore === 10 ? 8 : 5); }} className="flex-1 sm:flex-none bg-white text-indigo-600 hover:bg-indigo-50 p-3 rounded-xl transition flex flex-col items-center gap-1 shadow-sm">
            <Plus className="w-5 h-5" />
            <span className="text-[10px] font-bold">Оценка</span>
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <h2 className="font-bold text-lg text-slate-800 dark:text-slate-200 flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-indigo-500" />
          Мои предметы
        </h2>
        <div className="flex items-center gap-3">
          <div className="flex bg-slate-100 dark:bg-slate-800 rounded-lg p-1">
            <button onClick={() => setViewMode('cards')} className={`p-1.5 rounded-md transition ${viewMode === 'cards' ? 'bg-white dark:bg-slate-700 shadow-sm text-indigo-600 dark:text-indigo-400' : 'text-slate-400'}`}>
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button onClick={() => setViewMode('table')} className={`p-1.5 rounded-md transition ${viewMode === 'table' ? 'bg-white dark:bg-slate-700 shadow-sm text-indigo-600 dark:text-indigo-400' : 'text-slate-400'}`}>
              <Table className="w-4 h-4" />
            </button>
          </div>
          <button onClick={() => { setShowAddSubject(true); setNewSubTarget(maxScore === 10 ? 9.0 : 5.0); }} className="text-sm font-bold text-indigo-600 dark:text-indigo-400 hover:opacity-80 transition">
            + Предмет
          </button>
        </div>
      </div>

      {viewMode === 'cards' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {subjectStats.map(sub => (
            <div key={sub.id} onClick={() => setSelectedSubject(sub)} className="cursor-pointer bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm hover:shadow-md hover:border-indigo-500/30 transition">
              <div className="flex justify-between items-start mb-3">
                <h3 className="font-bold text-slate-800 dark:text-slate-100">{sub.name}</h3>
                <div className={`px-2 py-1 rounded-md text-xs font-bold ${
                  sub.avg >= sub.target_grade ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400' : 
                  sub.avg < sub.target_grade - 0.5 ? 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400' : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                }`}>
                  {sub.avg > 0 ? sub.avg.toFixed(2) : '-'}
                </div>
              </div>
              
              <div className="space-y-2 mb-4">
                <div className="flex justify-between text-xs text-slate-500">
                  <span>Цель: {sub.target_grade.toFixed(1)}</span>
                  <span>{sub.count} оценок</span>
                </div>
                <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div 
                    className={`h-full rounded-full ${sub.avg >= sub.target_grade ? 'bg-emerald-500' : sub.avg < sub.target_grade - (sub.target_grade > 5 ? 1.0 : 0.5) ? 'bg-rose-500' : 'bg-amber-500'}`} 
                    style={{ width: `${Math.min(100, (sub.avg / (sub.target_grade > 5 ? 10 : 5)) * 100)}%` }}
                  />
                </div>
              </div>

              {sub.avg > 0 && sub.avg < sub.target_grade - (sub.target_grade > 5 ? 1.0 : 0.5) && (
                <div className="bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-400 p-2.5 rounded-lg text-xs font-medium flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>Оценки падают! Рекомендуем сгенерировать ИИ-подкаст по последней теме.</span>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 text-xs uppercase tracking-wider">
                <th className="p-4 font-bold">Предмет</th>
                <th className="p-4 font-bold hidden sm:table-cell">Оценки</th>
                <th className="p-4 font-bold text-right">Ср. балл</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {subjectStats.map(sub => {
                const subGrades = grades.filter(g => g.subject_id === sub.id).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
                return (
                  <tr key={sub.id} onClick={() => setSelectedSubject(sub)} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition cursor-pointer">
                    <td className="p-4 font-bold text-slate-800 dark:text-slate-200">
                      {sub.name}
                      <div className="sm:hidden flex gap-1 flex-wrap mt-2">
                        {subGrades.slice(0, 5).map((g, i) => <span key={i} className="text-[10px] font-bold bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-slate-600 dark:text-slate-300">{g.value}</span>)}
                        {subGrades.length > 5 && <span className="text-[10px] font-bold text-slate-400">+{subGrades.length - 5}</span>}
                      </div>
                    </td>
                    <td className="p-4 hidden sm:table-cell">
                      <div className="flex gap-1.5 flex-wrap">
                        {subGrades.slice(0, 8).map((g, i) => (
                          <span key={i} className="w-6 h-6 flex items-center justify-center text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-md">
                            {g.value}
                          </span>
                        ))}
                        {subGrades.length > 8 && <span className="text-xs font-bold text-slate-400 ml-1 flex items-center">+{subGrades.length - 8}</span>}
                      </div>
                    </td>
                    <td className="p-4 text-right">
                      <div className={`inline-block px-2 py-1 rounded-md text-xs font-bold ${
                        sub.avg >= sub.target_grade ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400' : 
                        sub.avg < sub.target_grade - 0.5 ? 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400' : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                      }`}>
                        {sub.avg > 0 ? sub.avg.toFixed(2) : '-'}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modals */}
      <AnimatePresence>
        {showAddSubject && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white dark:bg-slate-900 rounded-2xl p-6 w-full max-w-sm">
              <h3 className="font-bold text-lg mb-4 text-slate-900 dark:text-slate-100">Новый предмет</h3>
              <input 
                type="text" 
                placeholder="Название (например, Физика)" 
                value={newSubName} 
                onChange={e => setNewSubName(e.target.value)} 
                className="w-full mb-3 p-3 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-xl border-none focus:ring-2 focus:ring-indigo-500" 
              />
              <label className="text-xs text-slate-500 mb-1 block">Целевой балл</label>
              <input 
                type="number" 
                step="0.1" 
                value={newSubTarget} 
                onChange={e => setNewSubTarget(parseFloat(e.target.value))} 
                className="w-full mb-6 p-3 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-xl border-none focus:ring-2 focus:ring-indigo-500" 
              />
              <div className="flex gap-2">
                <button onClick={() => setShowAddSubject(false)} className="flex-1 py-3 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl font-bold">Отмена</button>
                <button onClick={handleAddSubject} className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-bold">Создать</button>
              </div>
            </motion.div>
          </div>
        )}

        {showAddGrade && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white dark:bg-slate-900 rounded-2xl p-6 w-full max-w-sm">
              <h3 className="font-bold text-lg mb-4 text-slate-900 dark:text-slate-100">Добавить оценку</h3>
              <CustomSelect
                value={gradeSubId}
                onChange={val => setGradeSubId(val)}
                placeholder="Выберите предмет"
                options={subjects.map(s => ({ value: s.id, label: s.name }))}
                className="w-full mb-3"
              />
              <div className="grid grid-cols-5 gap-2 mb-6">
                {[2, 3, 4, 5, 6, 7, 8, 9, 10].map(v => (
                  <button 
                    key={v} 
                    onClick={() => setGradeValue(v)} 
                    className={`py-2 rounded-xl font-black text-base transition ${gradeValue === v ? 'bg-indigo-600 text-white shadow-md' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'}`}
                  >
                    {v}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <button onClick={() => setShowAddGrade(false)} className="flex-1 py-3 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl font-bold">Отмена</button>
                <button onClick={() => handleAddGrade()} disabled={!gradeSubId} className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-bold disabled:opacity-50">Сохранить</button>
              </div>
            </motion.div>
          </div>
        )}

        {showScan && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
            <motion.div initial={{ opacity: 0, y: 100 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 100 }} className="bg-white dark:bg-slate-900 w-full max-w-lg sm:rounded-2xl shadow-2xl flex flex-col h-[90vh] sm:h-[80vh] overflow-hidden">
              <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900 shrink-0">
                <h3 className="font-bold text-lg text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-indigo-500" />
                  Smart Scan
                </h3>
                <button onClick={() => setShowScan(false)} className="text-slate-400 hover:text-slate-600 transition">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              
              <div ref={chatScrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50 dark:bg-slate-950/50 custom-scrollbar">
                {scanMessages.map((msg, i) => (
                  <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[90%] rounded-2xl p-3 ${msg.role === 'user' ? 'bg-indigo-600 text-white rounded-tr-sm' : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 rounded-tl-sm shadow-sm'}`}>
                      {msg.images && msg.images.length > 0 && (
                        <div className={`grid gap-2 mb-2 ${msg.images.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                          {msg.images.map((img, idx) => (
                            <img key={idx} src={`data:image/jpeg;base64,${img}`} alt="Scan target" className="w-full max-w-[240px] rounded-xl object-contain bg-black/10 border border-white/20" />
                          ))}
                        </div>
                      )}
                      {msg.content && <p className="text-sm whitespace-pre-wrap">{msg.content}</p>}
                    </div>
                  </motion.div>
                ))}
                {scanning && (
                  <div className="flex justify-start">
                    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 rounded-2xl rounded-tl-sm p-3 shadow-sm flex items-center gap-2">
                      <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                      <span className="text-xs font-bold text-slate-500">Изучаю оценки...</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="p-3 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 shrink-0 pb-safe">
                {scanImages.length > 0 && (
                  <div className="mb-3 flex gap-2 overflow-x-auto py-1 custom-scrollbar">
                    {scanImages.map((img, idx) => (
                      <div key={idx} className="relative inline-block shrink-0">
                        <img src={`data:image/jpeg;base64,${img}`} alt="Preview" className="w-16 h-16 object-cover rounded-xl border-2 border-indigo-500" />
                        <button onClick={() => setScanImages(prev => prev.filter((_, i) => i !== idx))} className="absolute -top-2 -right-2 bg-rose-500 text-white rounded-full p-1 shadow-md hover:scale-110 transition">
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex gap-2 items-end">
                  <label className="shrink-0 w-12 h-12 bg-slate-100 dark:bg-slate-800 rounded-xl flex items-center justify-center cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-700 transition">
                    <input type="file" accept="image/*" multiple onChange={handleFileChange} className="hidden" />
                    <Camera className="w-5 h-5 text-slate-600 dark:text-slate-400" />
                  </label>
                  <textarea
                    placeholder="Напишите комментарий..."
                    value={scanText}
                    onChange={e => setScanText(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleScan();
                      }
                    }}
                    className="flex-1 bg-slate-100 dark:bg-slate-800 border-none rounded-xl p-3 max-h-32 text-sm text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 resize-none custom-scrollbar"
                    rows={scanText.split('\n').length > 1 ? 2 : 1}
                  />
                  <button 
                    onClick={handleScan} 
                    disabled={scanning || (!scanText.trim() && scanImages.length === 0)} 
                    className="shrink-0 w-12 h-12 bg-indigo-600 text-white rounded-xl flex items-center justify-center hover:bg-indigo-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <svg className="w-5 h-5 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
