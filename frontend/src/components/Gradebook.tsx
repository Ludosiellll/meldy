import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { Camera, Plus, AlertTriangle, Sparkles, ArrowLeft, Trash2, LayoutGrid, Table, X } from 'lucide-react';
import { motion, AnimatePresence, MotionConfig } from 'framer-motion';
import { CustomSelect } from './CustomSelect';
import { AI_LIMIT_MESSAGE, notifyAIUsageChanged } from '../api/limits';
import { AI_COSTS } from '../lib/plans';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { useEnergyConfirm } from '../hooks/useEnergyConfirm';
import { pluralRu } from './conversation/visuals';
import './Gradebook.css';

/** The price of one recognition, from lib/plans (the server charges the same): said before the photo is sent. */
export const scanCostLine = `Распознавание по фото расходует ${AI_COSTS.gradebookScan} ${pluralRu(AI_COSTS.gradebookScan, ['единицу', 'единицы', 'единиц'])} дневного лимита ИИ.`;

/** «7 окт.» as the other pages date things; the stored day as it is when it cannot be read. */
function gradeDay(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  const date = match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return format(date, date.getFullYear() === new Date().getFullYear() ? 'd MMM' : 'd MMM yyyy', { locale: ru });
}

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
    content: 'Загрузите фото зачётки или дневника (можно несколько) — Meldy перенесёт оценки по предметам. Можно добавить текст, например: «Иванов Иван, предмет физика».'
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
      toast.success('Предмет добавлен');
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
      toast.success('Оценка сохранена');
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
      const ok = await verifyEnergy(user.id, AI_COSTS.gradebookScan, 'Распознавание оценок по фото');
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
        throw new Error(
          res.status === 401
            ? 'Войдите в аккаунт и повторите попытку.'
            : data?.code === 'ai_limit'
              ? AI_LIMIT_MESSAGE
              : 'Сервис распознавания временно недоступен.',
        );
      }
      failurePhase = 'saving';
      notifyAIUsageChanged(); // единицу списал сервер до модели
      
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
        toast.success(`Добавлено оценок: ${rowsToSave.length}.`);
      }
    } catch (err) {
      console.error(err);
      setScanImages(requestImages);
      setScanText(requestText);
      const knownMessage = err instanceof Error && (
        err.message === 'Войдите в аккаунт и повторите попытку.' ||
        err.message === 'Сервис распознавания временно недоступен.' ||
        err.message === AI_LIMIT_MESSAGE ||
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

  if (loading) return <p className="gb-quiet gb-loading" role="status">Загрузка оценок…</p>;
  if (hasLoadError) return (
    <div className="gb-card gb-state">
      <h2 className="gb-h2">Не удалось загрузить оценки</h2>
      <p className="gb-quiet">Проверьте подключение и попробуйте ещё раз. Данные не удалены.</p>
      <button type="button" onClick={() => { void Promise.all([refetchSubjects(), refetchGrades()]); }} className="sf-primary gb-state-act">
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

  /** The average against the target: «есть», «почти», «ниже цели» (green, yellow, pink). */
  const toneOf = (avg: number, target: number) => (avg >= target ? 'ok' : avg < target - 0.5 ? 'low' : 'mid');
  const barToneOf = (avg: number, target: number) => (avg >= target ? 'ok' : avg < target - (target > 5 ? 1.0 : 0.5) ? 'low' : 'mid');

  // One delete dialog for both views: it used to render only in the list, so «Удалить предмет» in a
  // subject's own view set the state and opened nothing.
  const deleteDialog = (
    <MotionConfig reducedMotion="user">
      <AnimatePresence>
        {subjectToDelete && (
          <div className="gb-scrim">
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className="gb-dialog" role="dialog" aria-modal="true" aria-label="Удалить предмет?">
              <h3 className="gb-dialog-h">Удалить предмет?</h3>
              <p className="gb-quiet">Вы уверены, что хотите удалить предмет <span className="gb-strong">«{subjectToDelete.name}»</span> и все его оценки? Это действие нельзя отменить.</p>
              <div className="gb-dialog-acts">
                <button type="button" onClick={() => setSubjectToDelete(null)} className="sf-secondary">Отмена</button>
                <button type="button" onClick={() => deleteSubjectMutation.mutate(subjectToDelete.id)} disabled={deleteSubjectMutation.isPending} className="gb-delete">Удалить</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </MotionConfig>
  );

  if (selectedSubject) {
    const subGrades = grades.filter(g => g.subject_id === selectedSubject.id).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const subStat = subjectStats.find(s => s.id === selectedSubject.id);
    
    return (
      <div className="gb">
        <div className="gb-subhead">
          <div className="gb-subhead-l">
            <button type="button" onClick={() => setSelectedSubject(null)} className="gb-round" aria-label="Назад к предметам" title="Назад к предметам">
              <ArrowLeft aria-hidden="true" />
            </button>
            <h2 className="gb-h2">{selectedSubject.name}</h2>
          </div>
          <div className="gb-subhead-r">
            <span className="gb-pill" data-tone="blue">
              Средний балл: {subStat?.avg ? subStat.avg.toFixed(2) : '-'}
            </span>
            <button type="button" onClick={() => setSubjectToDelete(selectedSubject)} className="gb-round gb-danger" title="Удалить предмет" aria-label="Удалить предмет">
              <Trash2 aria-hidden="true" />
            </button>
          </div>
        </div>

        <section className="gb-card gb-quick">
          <h3 className="gb-label">Быстрое добавление (сегодня)</h3>
          <div className="gb-values">
            {gradeValues.map(v => (
              <button 
                key={v}
                type="button"
                onClick={() => handleAddGrade({ subId: selectedSubject.id, val: v })}
                disabled={addGradeMutation.isPending}
                className="gb-value"
              >
                {v}
              </button>
            ))}
          </div>
        </section>

        <div className="gb-card gb-table-card">
          <table className="gb-table">
            <thead>
              <tr>
                <th>Оценка</th>
                <th>Дата</th>
                <th className="gb-right">Действие</th>
              </tr>
            </thead>
            <tbody>
              {subGrades.length === 0 ? (
                <tr><td colSpan={3} className="gb-empty-cell">Пока нет оценок</td></tr>
              ) : subGrades.map(g => (
                <tr key={g.id}>
                  <td className="gb-grade">{g.value}</td>
                  <td className="gb-muted">{gradeDay(g.date)}</td>
                  <td className="gb-right">
                    <button type="button" onClick={() => deleteGradeMutation.mutate(g.id)} className="gb-icon-btn gb-danger" aria-label="Удалить оценку" title="Удалить оценку">
                      <Trash2 aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="gb-pad"></div>
        {deleteDialog}
      </div>
    );
  }

  return (
    <div className="gb">
      {/* Header Widget */}
      <section className="gb-card gb-hero">
        <div>
          <p className="gb-label">Средний балл</p>
          <p className="gb-avg">
            <span className="gb-avg-n">{overallAvg ? overallAvg.toFixed(2) : '—'}</span>
            <span className="gb-avg-of">из {maxScore.toFixed(0)}</span>
          </p>
        </div>
        <div className="gb-hero-side">
          <div className="gb-hero-acts">
            <button type="button" onClick={() => setShowScan(true)} className="sf-secondary gb-with-icon">
              <Camera aria-hidden="true" />
              <span>Распознать по фото</span>
            </button>
            <button type="button" onClick={() => { setShowAddGrade(true); setGradeValue(maxScore === 10 ? 8 : 5); }} className="sf-primary">
              <span>Добавить оценку</span>
            </button>
          </div>
          {/* The price is said before the photo is sent, as next to «Начать работу над ошибками» (LIB-18). */}
          <p className="gb-cost">{scanCostLine}</p>
        </div>
      </section>

      <div className="gb-bar">
        <h2 className="gb-h2">Мои предметы</h2>
        <div className="gb-bar-r">
          <div className="gb-seg" role="group" aria-label="Вид">
            <button type="button" onClick={() => setViewMode('cards')} aria-pressed={viewMode === 'cards'} aria-label="Карточками" title="Карточками">
              <LayoutGrid aria-hidden="true" />
            </button>
            <button type="button" onClick={() => setViewMode('table')} aria-pressed={viewMode === 'table'} aria-label="Таблицей" title="Таблицей">
              <Table aria-hidden="true" />
            </button>
          </div>
          <button type="button" onClick={() => { setShowAddSubject(true); setNewSubTarget(maxScore === 10 ? 9.0 : 5.0); }} className="sf-secondary gb-with-icon">
            <Plus aria-hidden="true" />
            Предмет
          </button>
        </div>
      </div>

      {subjectStats.length === 0 ? (
        // No subjects yet (LIB-34): what the list will hold and how it fills, instead of an empty space.
        <div className="gb-card gb-empty">
          <p className="gb-empty-t">Предметов пока нет</p>
          <p className="gb-quiet">Добавьте предмет и его оценки или распознайте фото зачётки: предметы из неё появятся здесь сами.</p>
          <button type="button" onClick={() => { setShowAddSubject(true); setNewSubTarget(maxScore === 10 ? 9.0 : 5.0); }} className="sf-secondary gb-with-icon gb-empty-act">
            <Plus aria-hidden="true" />
            Добавить предмет
          </button>
        </div>
      ) : viewMode === 'cards' ? (
        <div className="gb-grid">
          {subjectStats.map(sub => (
            <div key={sub.id} onClick={() => setSelectedSubject(sub)} className="gb-subject">
              <div className="gb-subject-top">
                <h3 className="gb-subject-h">
                  {/* The card opens on click; this button is the way in from the keyboard. */}
                  <button type="button" className="gb-open" onClick={(e) => { e.stopPropagation(); setSelectedSubject(sub); }}>
                    {sub.name}
                  </button>
                </h3>
                <button type="button" onClick={(e) => { e.stopPropagation(); setSubjectToDelete(sub); }} className="gb-icon-btn" title="Удалить предмет" aria-label="Удалить предмет">
                  <X aria-hidden="true" />
                </button>
              </div>

              <div className="gb-subject-mid">
                <span className="gb-pill" data-tone={toneOf(sub.avg, sub.target_grade)}>
                  {sub.avg > 0 ? sub.avg.toFixed(2) : '-'}
                </span>
                <span className="gb-subject-meta">
                  <span>Цель: {sub.target_grade.toFixed(1)}</span>
                  <span>{sub.count} {pluralRu(sub.count, ['оценка', 'оценки', 'оценок'])}</span>
                </span>
              </div>
              <div className="gb-track" aria-hidden="true">
                <i data-tone={barToneOf(sub.avg, sub.target_grade)} style={{ width: `${Math.min(100, (sub.avg / (sub.target_grade > 5 ? 10 : 5)) * 100)}%` }} />
              </div>

              {sub.avg > 0 && sub.avg < sub.target_grade - (sub.target_grade > 5 ? 1.0 : 0.5) && (
                <div className="gb-warn">
                  <AlertTriangle aria-hidden="true" />
                  <span>Средний балл ниже цели. Повторите последнюю тему: карточки, тест или разговор по материалу.</span>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="gb-card gb-table-card gb-scroll">
          <table className="gb-table gb-table-subjects">
            <thead>
              <tr>
                <th>Предмет</th>
                <th className="gb-wide-only">Оценки</th>
                <th className="gb-right">Ср. балл</th>
              </tr>
            </thead>
            <tbody>
              {subjectStats.map(sub => {
                const subGrades = grades.filter(g => g.subject_id === sub.id).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
                return (
                  <tr key={sub.id} onClick={() => setSelectedSubject(sub)} className="gb-row-link">
                    <td className="gb-strong">
                      <button type="button" className="gb-open" onClick={(e) => { e.stopPropagation(); setSelectedSubject(sub); }}>
                        {sub.name}
                      </button>
                      <div className="gb-narrow-only gb-chips">
                        {subGrades.slice(0, 5).map((g, i) => <span key={i} className="gb-chip">{g.value}</span>)}
                        {subGrades.length > 5 && <span className="gb-more">+{subGrades.length - 5}</span>}
                      </div>
                    </td>
                    <td className="gb-wide-only">
                      <div className="gb-chips">
                        {subGrades.slice(0, 8).map((g, i) => (
                          <span key={i} className="gb-chip">
                            {g.value}
                          </span>
                        ))}
                        {subGrades.length > 8 && <span className="gb-more">+{subGrades.length - 8}</span>}
                      </div>
                    </td>
                    <td className="gb-right">
                      <div className="gb-cell-r">
                        <span className="gb-pill" data-tone={toneOf(sub.avg, sub.target_grade)}>
                          {sub.avg > 0 ? sub.avg.toFixed(2) : '-'}
                        </span>
                        <button type="button" onClick={(e) => { e.stopPropagation(); setSubjectToDelete(sub); }} className="gb-icon-btn" title="Удалить предмет" aria-label="Удалить предмет">
                          <X aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td className="gb-strong">Итого</td>
                <td className="gb-wide-only gb-muted">Общий средний балл по всем предметам</td>
                <td className="gb-right">
                  <span className="gb-pill" data-tone="blue">
                    {overallAvg > 0 ? overallAvg.toFixed(2) : '-'}
                  </span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Modals */}
      {deleteDialog}
      <MotionConfig reducedMotion="user">
      <AnimatePresence>
        {showAddSubject && (
          <div className="gb-scrim">
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className="gb-dialog" role="dialog" aria-modal="true" aria-label="Новый предмет">
              <h3 className="gb-dialog-h">Новый предмет</h3>
              <input 
                type="text" 
                placeholder="Название (например, Физика)" 
                aria-label="Название предмета"
                value={newSubName} 
                onChange={e => setNewSubName(e.target.value)} 
                className="sf-input gb-field" 
              />
              <label className="gb-field-l" htmlFor="gb-target">Целевой балл</label>
              <input 
                id="gb-target"
                type="number" 
                step="0.1" 
                min="1"
                max={maxScore}
                value={newSubTarget} 
                onChange={e => setNewSubTarget(parseFloat(e.target.value))} 
                className="sf-input gb-field" 
              />
              <div className="gb-dialog-acts">
                <button type="button" onClick={() => setShowAddSubject(false)} className="sf-secondary">Отмена</button>
                <button type="button" onClick={handleAddSubject} disabled={addSubjectMutation.isPending || !newSubName.trim() || !Number.isFinite(newSubTarget) || newSubTarget <= 0 || newSubTarget > maxScore} className="sf-primary">Создать</button>
              </div>
            </motion.div>
          </div>
        )}

        {showAddGrade && (
          <div className="gb-scrim">
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className="gb-dialog" role="dialog" aria-modal="true" aria-label="Добавить оценку">
              <h3 className="gb-dialog-h">Добавить оценку</h3>
              <CustomSelect
                value={gradeSubId}
                onChange={val => setGradeSubId(val)}
                placeholder="Выберите предмет"
                options={subjects.map(s => ({ value: s.id, label: s.name }))}
                className="w-full mb-3"
              />
              <div className="gb-values gb-values-pick" style={{ gridTemplateColumns: `repeat(${gradeValues.length}, minmax(0, 1fr))` }}>
                {gradeValues.map(v => (
                  <button 
                    key={v} 
                    type="button"
                    onClick={() => setGradeValue(v)} 
                    aria-pressed={gradeValue === v}
                    className="gb-value"
                  >
                    {v}
                  </button>
                ))}
              </div>
              <div className="gb-dialog-acts">
                <button type="button" onClick={() => setShowAddGrade(false)} className="sf-secondary">Отмена</button>
                <button type="button" onClick={() => handleAddGrade()} disabled={!gradeSubId || addGradeMutation.isPending} className="sf-primary">Сохранить</button>
              </div>
            </motion.div>
          </div>
        )}

        {showScan && (
          <div className="gb-scrim gb-scrim-sheet">
            <motion.div initial={{ opacity: 0, y: 60 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 60 }} className="gb-scan" role="dialog" aria-modal="true" aria-label="Распознавание оценок">
              <div className="gb-scan-head">
                <h3 className="gb-dialog-h gb-scan-h">
                  <Sparkles aria-hidden="true" />
                  Распознавание оценок
                </h3>
                <button type="button" onClick={() => setShowScan(false)} className="gb-round" aria-label="Закрыть" title="Закрыть">
                  <X aria-hidden="true" />
                </button>
              </div>
              
              <div ref={chatScrollRef} className="gb-scan-msgs">
                {scanMessages.map((msg, i) => (
                  <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="gb-msg" data-role={msg.role}>
                    <div className="gb-bubble">
                      {msg.images && msg.images.length > 0 && (
                        <div className="gb-shots" data-one={msg.images.length === 1 ? '' : undefined}>
                          {msg.images.map((img, idx) => (
                            <img key={idx} src={`data:image/jpeg;base64,${img}`} alt="Фото с оценками" className="gb-shot" />
                          ))}
                        </div>
                      )}
                      {msg.content && <p className="gb-bubble-t">{msg.content}</p>}
                    </div>
                  </motion.div>
                ))}
                {scanning && (
                  <div className="gb-msg" data-role="assistant">
                    <div className="gb-bubble gb-busy" role="status">
                      Распознаём оценки…
                    </div>
                  </div>
                )}
              </div>

              <div className="gb-scan-foot">
                {scanImages.length > 0 && (
                  <div className="gb-previews">
                    {scanImages.map((img, idx) => (
                      <div key={idx} className="gb-preview">
                        <img src={`data:image/jpeg;base64,${img}`} alt="Выбранное фото" />
                        <button type="button" onClick={() => setScanImages(prev => prev.filter((_, i) => i !== idx))} className="gb-preview-x" aria-label="Убрать фото">
                          <X aria-hidden="true" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="gb-compose">
                  <label className="gb-round gb-attach" title="Добавить фото">
                    <input type="file" accept="image/*" multiple onChange={handleFileChange} className="hidden" />
                    <Camera aria-hidden="true" />
                    <span className="sr-only">Добавить фото</span>
                  </label>
                  <textarea
                    placeholder="Комментарий к фото"
                    aria-label="Комментарий"
                    value={scanText}
                    onChange={e => setScanText(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleScan();
                      }
                    }}
                    className="sf-input gb-textarea"
                    rows={scanText.split('\n').length > 1 ? 2 : 1}
                  />
                  <button 
                    type="button"
                    onClick={handleScan} 
                    disabled={scanning || (!scanText.trim() && scanImages.length === 0)} 
                    className="gb-send"
                    aria-label="Отправить"
                  >
                    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                  </button>
                </div>
                <p className="gb-cost gb-cost-foot">{scanCostLine}</p>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      </MotionConfig>
      <div className="gb-pad"></div>
    </div>
  );
}
