import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, XCircle, AlertCircle, Play, BookOpen } from 'lucide-react';
import { getAssignmentById, getStudentAttempts, recordAssignmentAttempt, toggleAssignmentCompletion } from '../api/groups';
import { useAuth } from '../hooks/useAuth';
import QuizView from '../components/QuizView';
import SummaryView from '../components/SummaryView';
import toast from 'react-hot-toast';

export default function AssignmentView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  
  const [assignment, setAssignment] = useState<any>(null);
  const [attempts, setAttempts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [phase, setPhase] = useState<'study' | 'quiz'>('study');

  useEffect(() => {
    if (!id || !user) return;
    
    Promise.all([
      getAssignmentById(id),
      getStudentAttempts(id, user.id)
    ])
      .then(([assn, atts]) => {
        if (!assn) {
          toast.error('Задание не найдено');
          navigate('/dashboard');
          return;
        }
        setAssignment(assn);
        setAttempts(atts);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id, user, navigate]);

  const handleQuizComplete = async (scorePct: number) => {
    if (!user || !assignment) return;
    
    const passingScore = assignment.passing_score || 80;
    const passed = scorePct >= passingScore;
    
    // Записываем попытку
    const ok = await recordAssignmentAttempt(assignment.id, user.id, scorePct, passed);
    if (!ok) {
      toast.error('Не удалось сохранить результат. Возможно, задание было удалено преподавателем.');
      return;
    }
    
    // Обновляем локально
    const newAttempt = { score: scorePct, passed, created_at: new Date().toISOString() };
    setAttempts(prev => [newAttempt, ...prev]);
    
    // Если прошли, отмечаем как выполнено
    if (passed) {
      await toggleAssignmentCompletion(assignment.id, user.id, true);
      toast.success('Задание успешно выполнено!');
    } else {
      toast.error(`Тест не сдан. Ваш балл: ${scorePct}%, необходимо: ${passingScore}%`);
    }
  };

  if (loading) return (
    <div className="p-6 flex items-center justify-center min-h-[50vh]">
      <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (!assignment) return null;

  const passingScore = assignment.passing_score || 80;
  const maxAttempts = assignment.max_attempts;
  const attemptsCount = attempts.length;
  const hasPassed = attempts.some(a => a.passed);
  
  const isOverdue = assignment.deadline && new Date(assignment.deadline) < new Date();
  
  const canAttempt = !hasPassed && (!maxAttempts || attemptsCount < maxAttempts) && !isOverdue;

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto pb-24">
      {/* Back button */}
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 text-sm mb-4 transition"
      >
        <ArrowLeft className="w-4 h-4" />
        Назад в класс
      </button>

      {/* Header */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 mb-6 shadow-sm">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-2">
          {assignment.material?.title || 'Удаленный материал'}
        </h1>
        
        <div className="flex flex-wrap items-center gap-4 text-sm mt-4">
          <div className="flex items-center gap-2 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 px-3 py-1.5 rounded-lg font-medium">
            <CheckCircle2 className="w-4 h-4" />
            Проходной балл: {passingScore}%
          </div>
          <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-3 py-1.5 rounded-lg font-medium">
            <AlertCircle className="w-4 h-4" />
            Попытки: {attemptsCount} {maxAttempts ? `/ ${maxAttempts}` : '(не ограничено)'}
          </div>
        </div>

        {hasPassed && (
          <div className="mt-4 p-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl flex items-center gap-3 text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="w-6 h-6 shrink-0" />
            <div>
              <p className="font-bold text-emerald-800 dark:text-emerald-300">Задание выполнено!</p>
              <p className="text-sm">Вы уже набрали проходной балл. Отличная работа!</p>
            </div>
          </div>
        )}

        {!hasPassed && !canAttempt && attemptsCount > 0 && !isOverdue && (
          <div className="mt-4 p-3 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-xl flex items-center gap-3 text-rose-700 dark:text-rose-400">
            <XCircle className="w-6 h-6 shrink-0" />
            <div>
              <p className="font-bold text-rose-800 dark:text-rose-300">Попытки исчерпаны</p>
              <p className="text-sm">К сожалению, вы не набрали нужный балл и больше не можете пересдавать этот тест.</p>
            </div>
          </div>
        )}

        {isOverdue && !hasPassed && (
          <div className="mt-4 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl flex items-center gap-3 text-amber-700 dark:text-amber-400">
            <AlertCircle className="w-6 h-6 shrink-0" />
            <div>
              <p className="font-bold text-amber-800 dark:text-amber-300">Дедлайн прошёл</p>
              <p className="text-sm">Время на выполнение этого задания истекло. Тест больше недоступен для прохождения.</p>
            </div>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setPhase('study')}
          className={`flex-1 py-3 px-4 rounded-xl font-bold flex items-center justify-center gap-2 transition border ${
            phase === 'study' 
              ? 'bg-indigo-600 text-white border-indigo-600 shadow-md' 
              : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
          }`}
        >
          <BookOpen className="w-5 h-5" /> Изучить материал
        </button>
        <button
          onClick={() => setPhase('quiz')}
          className={`flex-1 py-3 px-4 rounded-xl font-bold flex items-center justify-center gap-2 transition border ${
            phase === 'quiz' 
              ? 'bg-indigo-600 text-white border-indigo-600 shadow-md' 
              : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
          }`}
        >
          <Play className="w-5 h-5" /> Пройти тест
        </button>
      </div>

      {/* Content */}
      {phase === 'study' ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 md:p-6 shadow-sm">
          <SummaryView data={assignment.material?.summary_json} />
          
          <div className="mt-8 flex justify-end pt-4 border-t border-slate-100 dark:border-slate-800">
            <button
              onClick={() => setPhase('quiz')}
              className="px-6 py-3 bg-indigo-600 text-white font-bold rounded-xl shadow-md hover:bg-indigo-700 transition flex items-center gap-2"
            >
              Перейти к тесту <ArrowLeft className="w-4 h-4 rotate-180" />
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 md:p-6 shadow-sm">
          {!canAttempt && !hasPassed ? (
            <div className="text-center py-10">
              <XCircle className="w-16 h-16 text-rose-500 mx-auto mb-4 opacity-50" />
              <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100">Тест недоступен</h3>
              <p className="text-slate-500 dark:text-slate-400 mt-2">
                {isOverdue ? 'Дедлайн прошел.' : 'Вы исчерпали все попытки.'}
              </p>
            </div>
          ) : (
            <>
              {attemptsCount > 0 && !hasPassed && (
                <div className="mb-6 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl">
                  <p className="text-amber-800 dark:text-amber-300 font-medium">Предыдущая попытка: {attempts[0].score}%</p>
                  <p className="text-amber-600 dark:text-amber-400 text-sm mt-1">Попробуйте еще раз! Нужно набрать {passingScore}%.</p>
                </div>
              )}
              <div className="mb-4 text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5 justify-center bg-slate-50 dark:bg-slate-800/50 p-2 rounded-lg">
                <AlertCircle className="w-4 h-4" /> Внимание: Не обновляйте страницу во время теста, иначе прогресс будет сброшен!
              </div>
              <QuizView 
                data={assignment.material?.quiz_json} 
                onComplete={handleQuizComplete} 
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
