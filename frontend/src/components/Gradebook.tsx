import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { Camera, Plus, BookOpen, AlertTriangle, Crosshair, Check, Sparkles, Upload } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { CustomSelect } from './CustomSelect';

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
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [grades, setGrades] = useState<Grade[]>([]);
  const [loading, setLoading] = useState(true);

  const [showAddSubject, setShowAddSubject] = useState(false);
  const [newSubName, setNewSubName] = useState('');
  const [newSubTarget, setNewSubTarget] = useState(5.0);

  const [showAddGrade, setShowAddGrade] = useState(false);
  const [gradeSubId, setGradeSubId] = useState('');
  const [gradeValue, setGradeValue] = useState<number>(5);

  const [showScan, setShowScan] = useState(false);
  const [scanText, setScanText] = useState('');
  const [scanImage, setScanImage] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    fetchData();
  }, [user?.id]);

  const fetchData = async () => {
    if (!user?.id) return;
    setLoading(true);
    const [{ data: subData }, { data: grData }] = await Promise.all([
      supabase.from('academic_subjects').select('*').eq('user_id', user.id),
      supabase.from('academic_grades').select('*').eq('user_id', user.id).order('date', { ascending: false })
    ]);
    if (subData) setSubjects(subData);
    if (grData) setGrades(grData);
    setLoading(false);
  };

  const handleAddSubject = async () => {
    if (!user || !newSubName.trim()) return;
    const { data } = await supabase.from('academic_subjects').insert({
      user_id: user.id,
      name: newSubName.trim(),
      target_grade: newSubTarget,
      color: '#6366f1' // Default color
    }).select().single();
    
    if (data) {
      setSubjects([...subjects, data]);
      setShowAddSubject(false);
      setNewSubName('');
    }
  };

  const handleAddGrade = async () => {
    if (!user || !gradeSubId) return;
    const { data } = await supabase.from('academic_grades').insert({
      user_id: user.id,
      subject_id: gradeSubId,
      value: gradeValue,
      date: new Date().toISOString().split('T')[0]
    }).select().single();
    
    if (data) {
      setGrades([data, ...grades]);
      setShowAddGrade(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result as string;
        setScanImage(base64String.split(',')[1]); // remove data:image/...;base64,
      };
      reader.readAsDataURL(file);
    }
  };

  const handleScan = async () => {
    if (!scanText && !scanImage) return;
    setScanning(true);
    try {
      const res = await fetch('/api/academic/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_base64: scanImage,
          text: scanText,
          mime_type: 'image/jpeg'
        })
      });
      const data = await res.json();
      
      // Auto-create subjects if they don't exist
      for (const g of data.grades || []) {
        let sub = subjects.find(s => s.name.toLowerCase() === g.subject.toLowerCase());
        if (!sub) {
          const { data: newSub } = await supabase.from('academic_subjects').insert({
            user_id: user!.id,
            name: g.subject,
            target_grade: 5.0
          }).select().single();
          if (newSub) {
            sub = newSub;
            setSubjects(prev => [...prev, newSub]);
          }
        }
        
        if (sub) {
          const { data: newGr } = await supabase.from('academic_grades').insert({
            user_id: user!.id,
            subject_id: sub.id,
            value: g.value,
            date: g.date || new Date().toISOString().split('T')[0]
          }).select().single();
          if (newGr) {
            setGrades(prev => [newGr, ...prev]);
          }
        }
      }
      setShowScan(false);
      setScanImage(null);
      setScanText('');
    } catch (err) {
      console.error(err);
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

  return (
    <div className="space-y-6">
      {/* Header Widget */}
      <div className="bg-gradient-to-r from-indigo-600 via-purple-600 to-rose-500 rounded-2xl p-6 text-white flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 shadow-lg">
        <div>
          <p className="text-white/80 font-bold uppercase tracking-wider text-xs mb-1">Моя успеваемость (GPA)</p>
          <div className="flex items-end gap-3">
            <span className="text-4xl font-black">{overallAvg ? overallAvg.toFixed(2) : '-'}</span>
            <span className="text-white/60 text-sm mb-1 pb-0.5">/ 5.0</span>
          </div>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <button onClick={() => setShowScan(true)} className="flex-1 sm:flex-none bg-white/20 hover:bg-white/30 backdrop-blur-sm p-3 rounded-xl transition flex flex-col items-center gap-1">
            <Camera className="w-5 h-5" />
            <span className="text-[10px] font-bold">Скан по фото</span>
          </button>
          <button onClick={() => setShowAddGrade(true)} className="flex-1 sm:flex-none bg-white text-indigo-600 hover:bg-indigo-50 p-3 rounded-xl transition flex flex-col items-center gap-1 shadow-sm">
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
        <button onClick={() => setShowAddSubject(true)} className="text-sm font-bold text-indigo-600 dark:text-indigo-400 hover:opacity-80 transition">
          + Добавить предмет
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {subjectStats.map(sub => (
          <div key={sub.id} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm hover:shadow-md transition">
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
                  className={`h-full rounded-full ${sub.avg >= sub.target_grade ? 'bg-emerald-500' : sub.avg < sub.target_grade - 0.5 ? 'bg-rose-500' : 'bg-amber-500'}`} 
                  style={{ width: `${Math.min(100, (sub.avg / 5) * 100)}%` }}
                />
              </div>
            </div>

            {sub.avg > 0 && sub.avg < sub.target_grade - 0.5 && (
              <div className="bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-400 p-2.5 rounded-lg text-xs font-medium flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>Оценки падают! Рекомендуем сгенерировать ИИ-подкаст по последней теме.</span>
              </div>
            )}
          </div>
        ))}
      </div>

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
              <div className="flex gap-2 mb-6">
                {[2, 3, 4, 5].map(v => (
                  <button 
                    key={v} 
                    onClick={() => setGradeValue(v)} 
                    className={`flex-1 py-3 rounded-xl font-black text-lg transition ${gradeValue === v ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'}`}
                  >
                    {v}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <button onClick={() => setShowAddGrade(false)} className="flex-1 py-3 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl font-bold">Отмена</button>
                <button onClick={handleAddGrade} disabled={!gradeSubId} className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-bold disabled:opacity-50">Сохранить</button>
              </div>
            </motion.div>
          </div>
        )}

        {showScan && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white dark:bg-slate-900 rounded-2xl p-6 w-full max-w-md">
              <h3 className="font-bold text-lg mb-2 text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-indigo-500" />
                Smart Scan
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">Вставьте текст с оценками или загрузите скриншот Дневника/Зачётки.</p>
              
              <textarea
                placeholder="Скопируйте текст с оценками сюда..."
                value={scanText}
                onChange={e => setScanText(e.target.value)}
                className="w-full h-32 p-3 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700 rounded-xl text-sm mb-4"
              />

              <div className="relative border-2 border-dashed border-indigo-200 dark:border-indigo-800/50 rounded-xl p-6 text-center hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition mb-6 cursor-pointer">
                <input type="file" accept="image/*" onChange={handleFileChange} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                <Upload className="w-8 h-8 mx-auto text-indigo-400 mb-2" />
                <span className="text-sm font-bold text-indigo-600 dark:text-indigo-400">
                  {scanImage ? "Картинка загружена" : "Загрузить скриншот"}
                </span>
              </div>

              <div className="flex gap-2">
                <button onClick={() => setShowScan(false)} className="flex-1 py-3 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl font-bold">Отмена</button>
                <button onClick={handleScan} disabled={scanning || (!scanText && !scanImage)} className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-bold disabled:opacity-50 flex items-center justify-center gap-2">
                  {scanning ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : "Распознать"}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
