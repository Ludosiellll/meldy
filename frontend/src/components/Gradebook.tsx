import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { Camera, Plus, BookOpen, AlertTriangle, Crosshair, Check, Sparkles, Upload, ArrowLeft, Trash2, LayoutGrid, Table, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { CustomSelect } from './CustomSelect';
import { checkAILimit, incrementAIUsage } from '../api/limits';
import { updateQuestProgress } from '../api/quests';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { useEnergyConfirm } from '../hooks/useEnergyConfirm';

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
  const { verifyEnergy } = useEnergyConfirm();

  const { data: subjects = [], isLoading: isLoadingSubjects, isError: subjectsError, refetch: refetchSubjects } = useQuery({
    queryKey: ['academic_subjects', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await supabase.from('academic_subjects').select('*').eq('user_id', user.id);
      if (error) throw error;
      return data as Subject[];
    },
    enabled: !!user?.id
  });

  const { data: grades = [], isLoading: isLoadingGrades, isError: gradesError, refetch: refetchGrades } = useQuery({
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
  const hasLoadError = subjectsError || gradesError;
  const isFivePoint = subjects.length > 0 && subjects.every(s => s.target_grade <= 5) && grades.every(g => g.value <= 5);
  const maxScore = isFivePoint ? 5 : 10;
  const gradeValues = Array.from({ length: maxScore - 1 }, (_, index) => index + 2);

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
  const [subjectToDelete, setSubjectToDelete] = useState<Subject | null>(null);

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
        color: '#0868b2'
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['academic_subjects'] });
      setShowAddSubject(false);
      setNewSubName('');
      toast.success('Предмет успешно добавлен!');
    },
    onError: () => toast.error('Не удалось добавить предмет. Попробуйте ещё раз.'),
  });

  const handleAddSubject = () => {
    if (!newSubName.trim()) {
      toast.error('Введите название предмета.');
      return;
    }
    if (!Number.isFinite(newSubTarget) || newSubTarget <= 0 || newSubTarget > maxScore) {
      toast.error(`Целевой балл должен быть от 1 до ${maxScore}.`);
      return;
    }
    addSubjectMutation.mutate();
  };

  const addGradeMutation = useMutation({
    mutationFn: async (params?: { subId: string, val: number }) => {
      if (!user) throw new Error('No user');
      const targetSubId = params?.subId || gradeSubId;
      const targetVal = params?.val !== undefined ? params.val : gradeValue;
      if (!targetSubId) throw new Error('No subject');
      if (!Number.isFinite(targetVal) || targetVal < 2 || targetVal > maxScore) throw new Error('Grade outside active scale');
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
    },
    onError: () => toast.error('Не удалось сохранить оценку. Проверьте данные и попробуйте ещё раз.'),
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
    },
    onError: () => toast.error('Не удалось удалить оценку.'),
  });

  const deleteSubjectMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('academic_subjects').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['academic_subjects'] });
      queryClient.invalidateQueries({ queryKey: ['academic_grades'] });
      if (selectedSubject && subjectToDelete && selectedSubject.id === subjectToDelete.id) {
        setSelectedSubject(null);
      }
      setSubjectToDelete(null);
      toast.success('Предмет удален');
    },
    onError: () => toast.error('Не удалось удалить предмет. Оценки не изменены.'),
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
    
    // Проверка лимитов для AI (1 токен за распознавание по фото)
    if (user?.id) {
      const ok = await verifyEnergy(user.id, 1, 'Распознавание оценок по фото');
      if (!ok) return;
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
    
    let failurePhase: 'recognition' | 'saving' = 'recognition';
    try {
      const res = await fetch('/api/academic/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          images_base64: requestImages,
          text: requestText,
          mime_type: 'image/jpeg',
          chat_history: scanMessages.map(m => ({ role: m.role, content: m.content, images_base64: m.images || [] }))
        })
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(res.status === 401 ? 'Войдите в аккаунт и повторите попытку.' : 'Сервис распознавания временно недоступен.');
      }
      failurePhase = 'saving';
      if (user?.id) await incrementAIUsage(user.id, 1);
      
      if (data.message) {
        setScanMessages(prev => [...prev, { role: 'assistant', content: data.message }]);
      }
      
      const scannedGrades = Array.isArray(data.grades) ? data.grades : [];
      const knownSubjects = new Map(subjects.map(subject => [subject.name.trim().toLocaleLowerCase(), subject]));
      const missingNames = [...new Set(scannedGrades
        .map((grade: any) => typeof grade.subject === 'string' ? grade.subject.trim() : '')
        .filter((name: string) => name && !knownSubjects.has(name.toLocaleLowerCase())))];
      const isFivePoint = subjects.length > 0 && subjects.every(subject => subject.target_grade <= 5) && grades.every(grade => grade.value <= 5);

      if (missingNames.length > 0) {
        const { data: createdSubjects, error: createSubjectsError } = await supabase
          .from('academic_subjects')
          .insert(missingNames.map(name => ({
            user_id: user!.id,
            name,
            target_grade: isFivePoint ? 5 : 9,
            color: '#0868b2'
          })))
          .select();
        if (createSubjectsError) throw createSubjectsError;
        if ((createdSubjects || []).length !== missingNames.length) {
          throw new Error('Не удалось создать все распознанные предметы.');
        }
        for (const subject of (createdSubjects || []) as Subject[]) {
          knownSubjects.set(subject.name.trim().toLocaleLowerCase(), subject);
        }
      }

      const rowsToSave: Array<{ user_id: string; subject_id: string; value: number; date: string }> = scannedGrades.flatMap((grade: any) => {
        const subjectName = typeof grade.subject === 'string' ? grade.subject.trim() : '';
        const subject = knownSubjects.get(subjectName.toLocaleLowerCase());
        const value = Number(grade.value);
        if (!subject || !Number.isFinite(value) || value < 2 || value > (isFivePoint ? 5 : 10)) return [];
        return [{
          user_id: user!.id,
          subject_id: subject.id,
          value,
          date: typeof grade.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(grade.date)
            ? grade.date
            : new Date().toISOString().split('T')[0]
        }];
      });

      if (rowsToSave.length > 0) {
        const subjectsToReplace = [...new Set(rowsToSave.map(row => row.subject_id))];
        let previousGradeIds: string[] = [];
        if (data.replace_existing) {
          const { data: previousGrades, error: previousGradesError } = await supabase
            .from('academic_grades')
            .select('id')
            .eq('user_id', user!.id)
            .in('subject_id', subjectsToReplace);
          if (previousGradesError) throw previousGradesError;
          previousGradeIds = (previousGrades || []).map((grade: { id: string }) => grade.id);
        }

        const { data: insertedGrades, error: insertError } = await supabase
          .from('academic_grades')
          .insert(rowsToSave)
          .select('id');
        if (insertError) throw insertError;
        if ((insertedGrades || []).length !== rowsToSave.length) {
          throw new Error('Не все оценки были сохранены.');
        }

        if (data.replace_existing && previousGradeIds.length > 0) {
          const { error: deleteError } = await supabase
            .from('academic_grades')
            .delete()
            .eq('user_id', user!.id)
            .in('id', previousGradeIds);
          if (deleteError) {
            const insertedIds = (insertedGrades || []).map((grade: { id: string }) => grade.id);
            if (insertedIds.length > 0) {
              const { error: rollbackError } = await supabase.from('academic_grades').delete().eq('user_id', user!.id).in('id', insertedIds);
              if (rollbackError) {
                throw new Error('Не удалось завершить замену. Старые оценки сохранены, но проверьте список на повторы.');
              }
            }
            throw deleteError;
          }
        }

        queryClient.invalidateQueries({ queryKey: ['academic_grades'] });
        queryClient.invalidateQueries({ queryKey: ['academic_subjects'] });
        updateQuestProgress(user!.id, 'grade', rowsToSave.length);
        toast.success(`Добавлено оценок: ${rowsToSave.length}.`);
      }
    } catch (err) {
      console.error(err);
      setScanImages(requestImages);
      setScanText(requestText);
      const knownMessage = err instanceof Error && (
        err.message === 'Войдите в аккаунт и повторите попытку.' ||
        err.message === 'Сервис распознавания временно недоступен.' ||
        err.message === 'Не удалось завершить замену. Старые оценки сохранены, но проверьте список на повторы.'
      )
        ? err.message
        : failurePhase === 'recognition'
          ? 'Не удалось распознать данные. Файлы и текст остались в форме — попробуйте ещё раз.'
          : 'Не удалось сохранить оценки. Файлы и текст остались в форме — проверьте подключение и повторите попытку.';
      setScanMessages(prev => [...prev, { role: 'assistant', content: knownMessage }]);
    }
    setScanning(false);
  };

  if (loading) return <div className="p-8 text-center text-slate-500">Загрузка оценок…</div>;
  if (hasLoadError) return (
    <div className="mx-auto max-w-lg border-y border-[var(--sf-line)] py-10 text-center">
      <h2 className="text-lg font-semibold text-[var(--sf-ink)]">Не удалось загрузить оценки</h2>
      <p className="mt-2 text-sm text-[var(--sf-muted)]">Проверьте подключение и попробуйте ещё раз. Данные не удалены.</p>
      <button
        type="button"
        onClick={() => { void Promise.all([refetchSubjects(), refetchGrades()]); }}
        className="mt-5 inline-flex min-h-11 items-center justify-center rounded-full bg-[var(--sf-accent)] px-5 text-sm font-semibold text-white transition hover:bg-[var(--sf-accent-hover)]"
      >
        Повторить
      </button>
    </div>
  );

  const subjectStats = subjects.map(sub => {
    const subGrades = grades.filter(g => g.subject_id === sub.id);
    const avg = subGrades.length ? subGrades.reduce((sum, g) => sum + g.value, 0) / subGrades.length : 0;
    return { ...sub, avg, count: subGrades.length };
  });

  const overallAvg = subjectStats.length 
    ? subjectStats.reduce((sum, s) => sum + s.avg, 0) / subjectStats.filter(s => s.avg > 0).length 
    : 0;

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
          <div className="flex items-center gap-2">
            <div className="bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-400 px-3 py-1.5 rounded-lg font-bold">
              Средний балл: {subStat?.avg ? subStat.avg.toFixed(2) : '-'}
            </div>
            <button onClick={() => setSubjectToDelete(selectedSubject)} className="p-2 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded-lg transition" title="Удалить предмет">
              <Trash2 className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 shadow-sm border border-slate-200 dark:border-slate-800">
          <h3 className="font-bold text-sm text-slate-500 mb-3 uppercase tracking-wider">Быстрое добавление (сегодня)</h3>
          <div className="flex flex-wrap gap-2 mb-2">
            {gradeValues.map(v => (
              <button 
                key={v}
                onClick={() => handleAddGrade({ subId: selectedSubject.id, val: v })}
                disabled={addGradeMutation.isPending}
                className="w-10 h-10 rounded-xl font-black text-base bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-[var(--sf-accent-soft)] hover:text-[var(--sf-accent)] transition"
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
        <div className="h-24 sm:h-4"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header Widget */}
      <div className="flex flex-col items-start justify-between gap-4 rounded-xl border border-[var(--sf-line)] bg-[var(--sf-surface)] p-5 text-[var(--sf-ink)] sm:flex-row sm:items-center">
        <div>
          <p className="mb-1 text-xs font-medium text-[var(--sf-muted)]">Средний балл</p>
          <div className="flex items-end gap-3">
            <span className="text-4xl font-semibold tabular-nums">{overallAvg ? overallAvg.toFixed(2) : '—'}</span>
            <span className="mb-1 pb-0.5 text-sm text-[var(--sf-muted)]">из {maxScore.toFixed(0)}</span>
          </div>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <button onClick={() => setShowScan(true)} className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-full border border-[var(--sf-line)] px-4 text-sm font-medium text-[var(--sf-ink)] transition hover:bg-[var(--sf-surface-soft)] sm:flex-none">
            <Camera className="h-4 w-4" />
            <span>Распознать по фото</span>
          </button>
          <button onClick={() => { setShowAddGrade(true); setGradeValue(maxScore === 10 ? 8 : 5); }} className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-full bg-[var(--sf-accent)] px-5 text-sm font-semibold text-white shadow-[0_3px_0_color-mix(in_srgb,var(--sf-accent)_72%,#111)] transition hover:-translate-y-px hover:bg-[var(--sf-accent-hover)] active:translate-y-px active:shadow-none sm:flex-none">
            <Plus className="h-4 w-4" />
            <span>Добавить оценку</span>
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <h2 className="font-bold text-lg text-slate-800 dark:text-slate-200 flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-[var(--sf-accent)]" />
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
          <button onClick={() => { setShowAddSubject(true); setNewSubTarget(maxScore === 10 ? 9.0 : 5.0); }} className="text-sm font-bold text-[var(--sf-accent)] hover:opacity-80 transition">
            + Предмет
          </button>
        </div>
      </div>

      {viewMode === 'cards' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {subjectStats.map(sub => (
            <div key={sub.id} onClick={() => setSelectedSubject(sub)} className="cursor-pointer bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm hover:shadow-md hover:border-indigo-500/30 transition">
              <div className="flex justify-between items-start mb-3">
                <h3 className="font-bold text-slate-800 dark:text-slate-100 pr-2">{sub.name}</h3>
                <div className="flex items-center gap-2">
                  <div className={`px-2 py-1 rounded-md text-xs font-bold ${
                    sub.avg >= sub.target_grade ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400' : 
                    sub.avg < sub.target_grade - 0.5 ? 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400' : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                  }`}>
                    {sub.avg > 0 ? sub.avg.toFixed(2) : '-'}
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); setSubjectToDelete(sub); }} className="text-slate-300 hover:text-rose-500 dark:text-slate-600 dark:hover:text-rose-400 transition" title="Удалить предмет">
                    <X className="w-4 h-4" />
                  </button>
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
                  <span>Средний балл ниже цели. Повторите последнюю тему: карточки, тест или аудиоразговор по материалу.</span>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-x-auto custom-scrollbar">
          <table className="w-full text-left border-collapse min-w-[300px]">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 text-xs uppercase tracking-wider">
                <th className="p-4 font-bold whitespace-nowrap">Предмет</th>
                <th className="p-4 font-bold hidden sm:table-cell w-full">Оценки</th>
                <th className="p-4 font-bold text-right whitespace-nowrap">Ср. балл</th>
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
                      <div className="flex items-center justify-end gap-3">
                        <div className={`inline-block px-2 py-1 rounded-md text-xs font-bold ${
                          sub.avg >= sub.target_grade ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400' : 
                          sub.avg < sub.target_grade - 0.5 ? 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400' : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                        }`}>
                          {sub.avg > 0 ? sub.avg.toFixed(2) : '-'}
                        </div>
                        <button onClick={(e) => { e.stopPropagation(); setSubjectToDelete(sub); }} className="text-slate-300 hover:text-rose-500 dark:text-slate-600 dark:hover:text-rose-400 transition" title="Удалить предмет">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-slate-50 dark:bg-slate-800/30">
              <tr>
                <td className="p-4 font-bold text-slate-800 dark:text-slate-200">Итого</td>
                <td className="p-4 hidden sm:table-cell text-slate-500 text-sm">Общий средний балл по всем предметам</td>
                <td className="p-4 text-right">
                  <div className="inline-block px-2 py-1 bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-400 rounded-md text-sm font-bold">
                    {overallAvg > 0 ? overallAvg.toFixed(2) : '-'}
                  </div>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Modals */}
      <AnimatePresence>
        {subjectToDelete && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white dark:bg-slate-900 rounded-2xl p-6 w-full max-w-sm border border-slate-200 dark:border-slate-800 shadow-2xl">
              <h3 className="font-bold text-lg mb-2 text-slate-900 dark:text-slate-100">Удалить предмет?</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">Вы уверены, что хотите удалить предмет <span className="font-bold text-slate-800 dark:text-slate-200">«{subjectToDelete.name}»</span> и все его оценки? Это действие нельзя отменить.</p>
              <div className="flex gap-2">
                <button onClick={() => setSubjectToDelete(null)} className="flex-1 py-3 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl font-bold transition hover:bg-slate-200 dark:hover:bg-slate-700">Отмена</button>
                <button onClick={() => deleteSubjectMutation.mutate(subjectToDelete.id)} disabled={deleteSubjectMutation.isPending} className="flex-1 py-3 bg-rose-600 text-white rounded-xl font-bold transition hover:bg-rose-700 disabled:opacity-50">Удалить</button>
              </div>
            </motion.div>
          </div>
        )}

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
                min="1"
                max={maxScore}
                value={newSubTarget} 
                onChange={e => setNewSubTarget(parseFloat(e.target.value))} 
                className="w-full mb-6 p-3 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-xl border-none focus:ring-2 focus:ring-indigo-500" 
              />
              <div className="flex gap-2">
                <button onClick={() => setShowAddSubject(false)} className="flex-1 py-3 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl font-bold">Отмена</button>
                <button onClick={handleAddSubject} disabled={addSubjectMutation.isPending || !newSubName.trim() || !Number.isFinite(newSubTarget) || newSubTarget <= 0 || newSubTarget > maxScore} className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-bold disabled:opacity-50">Создать</button>
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
              <div className="grid gap-2 mb-6" style={{ gridTemplateColumns: `repeat(${gradeValues.length}, minmax(0, 1fr))` }}>
                {gradeValues.map(v => (
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
                <button onClick={() => handleAddGrade()} disabled={!gradeSubId || addGradeMutation.isPending} className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-bold disabled:opacity-50">Сохранить</button>
              </div>
            </motion.div>
          </div>
        )}

        {showScan && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex flex-col justify-end sm:justify-center sm:items-center p-0 sm:p-4">
            <motion.div initial={{ opacity: 0, y: 100 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 100 }} className="bg-white dark:bg-slate-900 w-full max-w-lg sm:rounded-2xl shadow-2xl flex flex-col h-[100dvh] sm:h-[80vh] overflow-hidden">
              <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900 shrink-0">
                <h3 className="font-bold text-lg text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-indigo-500" />
                  Распознавание оценок
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

              <div className="p-3 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 shrink-0 pb-8 sm:pb-3">
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
      <div className="h-24 sm:h-4"></div>
    </div>
  );
}
