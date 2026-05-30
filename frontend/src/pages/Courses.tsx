import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { CustomSelect } from '../components/CustomSelect';
import { 
  Layers, Sparkles, BookOpen, Trash2, ArrowLeft, ArrowRight, CheckCircle2, 
  Plus, ChevronDown, ChevronUp, HelpCircle, Search, Check, X, Eye, 
  ArrowUp, ArrowDown, ExternalLink, Award, FileText, Zap, Edit3, Trash, Play
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { useConfirm } from '../contexts/ConfirmContext';
import SummaryView from '../components/SummaryView';
import { incrementAIUsage } from '../api/limits';
import { useEnergyConfirm } from '../hooks/useEnergyConfirm';

interface CourseMaterialItem {
  id: string;
  title: string;
  completed: boolean;
}

interface CourseSection {
  id: string;
  title: string;
  description: string;
  materials: CourseMaterialItem[];
}

interface Course {
  id: string;
  user_id: string;
  title: string;
  description: string;
  structure: CourseSection[];
  created_at: string;
}

const LOADING_TIPS = [
  "🤖 ИИ-методист анализирует сложность материалов...",
  "📚 Группируем лекции по логическим разделам...",
  "✍️ Пишем емкие описания для каждой секции...",
  "⛓️ Выстраиваем оптимальный порядок прохождения тем...",
  "✨ Добавляем щепотку учебной магии..."
];

export default function Courses() {
  const { user } = useAuth();
  const { confirm, alert } = useConfirm();
  const navigate = useNavigate();

  // Основные состояния режимов
  const [view, setView] = useState<'list' | 'builder' | 'detail'>('list');
  const [courses, setCourses] = useState<Course[]>([]);
  const { verifyEnergy } = useEnergyConfirm();
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  
  // Состояния для конструктора курса
  const [materials, setMaterials] = useState<any[]>([]);
  const [selectedMaterialIds, setSelectedMaterialIds] = useState<string[]>([]);
  const [goals, setGoals] = useState('');
  const [courseTitle, setCourseTitle] = useState('');
  const [courseDescription, setCourseDescription] = useState('');
  const [courseStructure, setCourseStructure] = useState<CourseSection[]>([]);
  const [builderStep, setBuilderStep] = useState<'setup' | 'edit'>('setup');
  
  // Поиск и фильтры материалов в конструкторе
  const [searchQuery, setSearchQuery] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('');

  // Загрузки
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingTipIndex, setLoadingTipIndex] = useState(0);

  // Быстрый просмотр
  const [previewMaterial, setPreviewMaterial] = useState<any | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // 1. Загрузка данных
  const loadData = async () => {
    if (!user) return;
    setLoading(true);
    try {
      // Загрузка курсов
      const { data: coursesData, error: coursesError } = await supabase
        .from('courses')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
        
      if (coursesError) throw coursesError;
      setCourses(coursesData || []);

      // Загрузка материалов для конструктора
      const { data: materialsData, error: materialsError } = await supabase
        .from('materials')
        .select('id, title, subject, summary_json, created_at')
        .eq('user_id', user.id);
        
      if (materialsError) throw materialsError;
      setMaterials(materialsData || []);
    } catch (e) {
      console.error('Error loading courses/materials:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [user?.id]);

  // Интервал смены подсказок при загрузке ИИ
  useEffect(() => {
    let interval: any;
    if (generating) {
      interval = setInterval(() => {
        setLoadingTipIndex((prev) => (prev + 1) % LOADING_TIPS.length);
      }, 3000);
    } else {
      setLoadingTipIndex(0);
    }
    return () => clearInterval(interval);
  }, [generating]);

  // Расчет прогресса для курса
  const getCourseProgress = (course: Course) => {
    let total = 0;
    let completed = 0;
    
    course.structure.forEach(section => {
      section.materials.forEach(material => {
        total++;
        if (material.completed) {
          completed++;
        }
      });
    });

    return {
      total,
      completed,
      percent: total > 0 ? Math.round((completed / total) * 100) : 0
    };
  };

  // Удаление курса
  const handleDeleteCourse = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const isOk = await confirm({
      title: 'Удалить курс?',
      message: 'Это действие удалит курс и весь его прогресс. Сами материалы в библиотеке останутся целыми.',
      type: 'danger'
    });
    if (!isOk) return;

    try {
      const { error } = await supabase.from('courses').delete().eq('id', id);
      if (error) throw error;
      setCourses(prev => prev.filter(c => c.id !== id));
      if (selectedCourse?.id === id) {
        setSelectedCourse(null);
        setView('list');
      }
    } catch (err) {
      console.error(err);
      await alert({ title: 'Ошибка', message: 'Не удалось удалить курс', type: 'warning' });
    }
  };

  // Переключение статуса готовности материала
  const handleToggleMaterial = async (sectionId: string, materialId: string) => {
    if (!selectedCourse) return;

    const updatedStructure = selectedCourse.structure.map(s => {
      if (s.id === sectionId) {
        const updatedMaterials = s.materials.map(m => {
          if (m.id === materialId) {
            return { ...m, completed: !m.completed };
          }
          return m;
        });
        return { ...s, materials: updatedMaterials };
      }
      return s;
    });

    // Оптимистичное обновление локально
    const updatedCourse = { ...selectedCourse, structure: updatedStructure };
    setSelectedCourse(updatedCourse);
    setCourses(prev => prev.map(c => c.id === selectedCourse.id ? updatedCourse : c));

    try {
      const { error } = await supabase
        .from('courses')
        .update({ structure: updatedStructure })
        .eq('id', selectedCourse.id);
      if (error) throw error;
    } catch (err) {
      console.error('Failed to update course progress:', err);
    }
  };

  // Вызов ИИ-генератора
  const handleGenerateAI = async () => {
    if (selectedMaterialIds.length === 0) {
      await alert({
        title: 'Материалы не выбраны',
        message: 'Пожалуйста, выберите хотя бы один материал из библиотеки для создания курса.',
        type: 'warning'
      });
      return;
    }

    if (user?.id) {
      const ok = await verifyEnergy(user.id, 5, 'Генерация курса');
      if (!ok) return;
      await incrementAIUsage(user.id, 5);
    }

    setGenerating(true);
    try {
      const payload = {
        materials: materials
          .filter(m => selectedMaterialIds.includes(m.id))
          .map(m => ({
            id: m.id,
            title: m.title,
            subject: m.subject || '',
            summary: m.summary_json?.content || ''
          })),
        goals: goals
      };

      const res = await fetch('/api/courses/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) throw new Error('Ошибка генерации курса');

      const data = await res.json();
      
      setCourseTitle(data.title || 'Новый ИИ-курс');
      setCourseDescription(data.description || 'Создан на основе выбранных материалов.');
      
      // Заполняем структуру
      setCourseStructure(data.structure || []);
      setBuilderStep('edit');
    } catch (err) {
      console.error(err);
      await alert({
        title: 'Ошибка генерации',
        message: 'Не удалось связаться с ИИ-методистом. Вы можете собрать курс вручную.',
        type: 'warning'
      });
      // Инициализируем пустую структуру для ручной сборки
      setCourseTitle('Новый курс');
      setCourseDescription('Ручная сборка курса');
      
      const initialMaterials = materials
        .filter(m => selectedMaterialIds.includes(m.id))
        .map(m => ({ id: m.id, title: m.title, completed: false }));
        
      setCourseStructure([
        {
          id: 'section_1',
          title: 'Основной раздел',
          description: 'Изучение выбранных материалов',
          materials: initialMaterials
        }
      ]);
      setBuilderStep('edit');
    } finally {
      setGenerating(false);
    }
  };

  // Создание курса вручную с нуля
  const handleCreateManual = () => {
    setCourseTitle('Новый курс');
    setCourseDescription('Курс собран вручную');
    
    const initialMaterials = materials
      .filter(m => selectedMaterialIds.includes(m.id))
      .map(m => ({ id: m.id, title: m.title, completed: false }));

    setCourseStructure([
      {
        id: 'section_1',
        title: 'Раздел 1',
        description: 'Материалы для изучения',
        materials: initialMaterials
      }
    ]);
    setBuilderStep('edit');
  };

  // Сохранение нового курса в Supabase
  const handleSaveCourse = async () => {
    if (!courseTitle.trim()) {
      await alert({ title: 'Название курса', message: 'Название курса не может быть пустым', type: 'warning' });
      return;
    }

    setSaving(true);
    try {
      const { data, error } = await supabase
        .from('courses')
        .insert({
          user_id: user!.id,
          title: courseTitle,
          description: courseDescription,
          structure: courseStructure
        })
        .select()
        .single();

      if (error) throw error;

      const newCourse: Course = data;
      setCourses(prev => [newCourse, ...prev]);
      setSelectedCourse(newCourse);
      setView('detail');
      
      // Сброс конструктора
      setSelectedMaterialIds([]);
      setGoals('');
      setCourseTitle('');
      setCourseDescription('');
      setCourseStructure([]);
      setBuilderStep('setup');
    } catch (err) {
      console.error(err);
      await alert({ title: 'Ошибка сохранения', message: 'Не удалось сохранить курс в базу данных', type: 'warning' });
    } finally {
      setSaving(false);
    }
  };

  // Функции изменения структуры курса в конструкторе
  const handleAddSection = () => {
    const newId = `section_${Date.now()}`;
    setCourseStructure(prev => [
      ...prev,
      {
        id: newId,
        title: `Новый раздел ${prev.length + 1}`,
        description: 'Описание целей раздела',
        materials: []
      }
    ]);
  };

  const handleUpdateSectionTitle = (id: string, newTitle: string) => {
    setCourseStructure(prev => prev.map(s => s.id === id ? { ...s, title: newTitle } : s));
  };

  const handleUpdateSectionDesc = (id: string, newDesc: string) => {
    setCourseStructure(prev => prev.map(s => s.id === id ? { ...s, description: newDesc } : s));
  };

  const handleDeleteSection = (id: string) => {
    // Возвращаем все материалы из удаляемого раздела обратно в общий список или просто удаляем секцию
    setCourseStructure(prev => prev.filter(s => s.id !== id));
  };

  // Перемещение разделов
  const handleMoveSection = (index: number, direction: 'up' | 'down') => {
    const newStructure = [...courseStructure];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newStructure.length) return;
    
    const temp = newStructure[index];
    newStructure[index] = newStructure[targetIndex];
    newStructure[targetIndex] = temp;
    setCourseStructure(newStructure);
  };

  // Перемещение материала внутри раздела
  const handleMoveMaterial = (sectionId: string, matIndex: number, direction: 'up' | 'down') => {
    setCourseStructure(prev => prev.map(s => {
      if (s.id === sectionId) {
        const newMats = [...s.materials];
        const targetIndex = direction === 'up' ? matIndex - 1 : matIndex + 1;
        if (targetIndex < 0 || targetIndex >= newMats.length) return s;
        
        const temp = newMats[matIndex];
        newMats[matIndex] = newMats[targetIndex];
        newMats[targetIndex] = temp;
        return { ...s, materials: newMats };
      }
      return s;
    }));
  };

  // Перемещение материала в другой раздел
  const handleMoveMaterialToSection = (fromSectionId: string, matId: string, toSectionId: string) => {
    setCourseStructure(prev => {
      let movedItem: CourseMaterialItem | null = null;
      
      // Удаляем из старого раздела
      const step1 = prev.map(s => {
        if (s.id === fromSectionId) {
          const item = s.materials.find(m => m.id === matId);
          if (item) movedItem = item;
          return { ...s, materials: s.materials.filter(m => m.id !== matId) };
        }
        return s;
      });

      if (!movedItem) return prev;

      // Добавляем в новый раздел
      return step1.map(s => {
        if (s.id === toSectionId) {
          return { ...s, materials: [...s.materials, movedItem!] };
        }
        return s;
      });
    });
  };

  const handleRemoveMaterialFromSection = (sectionId: string, matId: string) => {
    setCourseStructure(prev => prev.map(s => {
      if (s.id === sectionId) {
        return { ...s, materials: s.materials.filter(m => m.id !== matId) };
      }
      return s;
    }));
  };

  const handleAddMaterialToSection = (sectionId: string, matId: string, title: string) => {
    // Проверим, нет ли его уже в каком-то разделе
    let exists = false;
    courseStructure.forEach(s => {
      if (s.materials.some(m => m.id === matId)) exists = true;
    });

    if (exists) {
      // Удалим из предыдущего места
      setCourseStructure(prev => prev.map(s => ({
        ...s,
        materials: s.materials.filter(m => m.id !== matId)
      })));
    }

    setCourseStructure(prev => prev.map(s => {
      if (s.id === sectionId) {
        return {
          ...s,
          materials: [...s.materials, { id: matId, title, completed: false }]
        };
      }
      return s;
    }));
  };

  // Быстрый просмотр конспекта материала
  const handleOpenPreview = async (materialId: string) => {
    setPreviewLoading(true);
    setPreviewMaterial(null);
    try {
      const { data, error } = await supabase
        .from('materials')
        .select('*')
        .eq('id', materialId)
        .single();
      if (error) throw error;
      setPreviewMaterial(data);
    } catch (err) {
      console.error(err);
    } finally {
      setPreviewLoading(false);
    }
  };

  // Переход на устный экзамен
  const startExam = (materialId: string) => {
    sessionStorage.setItem('studyforge_professor_exam_state', JSON.stringify({
      selectedMaterialId: materialId,
      phase: 'select',
    }));
    navigate('/exam');
  };

  // Фильтрация материалов в Step 1
  const subjects = [...new Set(materials.map(m => m.subject).filter(Boolean))];
  const filteredMaterials = materials.filter(m => {
    const matchSearch = m.title.toLowerCase().includes(searchQuery.toLowerCase());
    const matchSubject = !subjectFilter || m.subject === subjectFilter;
    return matchSearch && matchSubject;
  });

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto min-h-screen transition-all">
      {/* LOADING PAGE STATE */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-4" />
          <p className="text-slate-500 dark:text-slate-400 font-medium">Загрузка ваших курсов...</p>
        </div>
      )}

      {/* ─── A) COURSE LIST VIEW ─── */}
      {!loading && view === 'list' && (
        <div>
          {/* Header */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
            <div className="flex items-start gap-4">
              <div className="p-2.5 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 rounded-xl mt-1 shadow-inner border border-indigo-100/50 dark:border-indigo-900/30">
                <Layers className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-2xl md:text-3xl font-extrabold text-slate-900 dark:text-slate-100 tracking-tight mb-2">
                  Мои учебные траектории
                </h1>
                <p className="text-sm text-slate-500 dark:text-slate-400 max-w-2xl leading-relaxed">
                  ИИ-методист структурирует материалы вашей библиотеки в пошаговые курсы для системного и глубокого освоения тем.
                </p>
              </div>
            </div>
            
            <button
              onClick={() => {
                setView('builder');
                setBuilderStep('setup');
                setSelectedMaterialIds([]);
              }}
              className="flex items-center gap-2 px-5 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-bold rounded-xl shadow-lg shadow-indigo-100 dark:shadow-none hover:shadow-indigo-200 dark:hover:shadow-none hover:scale-[1.02] transition-all"
            >
              <Plus className="w-5 h-5" />
              Новый курс
            </button>
          </div>

          {/* Quick stats */}
          {courses.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
              <div className="bg-gradient-to-br from-indigo-50/60 to-indigo-100/40 dark:from-indigo-950/40 dark:to-indigo-950/20 border border-indigo-100/80 dark:border-indigo-900/40 rounded-2xl p-5 flex items-center gap-4">
                <div className="w-12 h-12 bg-indigo-600 rounded-xl flex items-center justify-center text-white font-black shadow-md">
                  {courses.length}
                </div>
                <div>
                  <h3 className="font-bold text-slate-800 dark:text-slate-200 text-sm">Создано курсов</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Персональные учебные планы</p>
                </div>
              </div>
              <div className="bg-gradient-to-br from-emerald-50/60 to-emerald-100/40 dark:from-emerald-950/30 dark:to-emerald-950/10 border border-emerald-100/80 dark:border-emerald-900/30 rounded-2xl p-5 flex items-center gap-4">
                <div className="w-12 h-12 bg-emerald-500 rounded-xl flex items-center justify-center text-white font-black shadow-md">
                  {courses.reduce((acc, c) => acc + getCourseProgress(c).completed, 0)}
                </div>
                <div>
                  <h3 className="font-bold text-slate-800 dark:text-slate-200 text-sm">Темы изучены</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Материалы отмечены как готовые</p>
                </div>
              </div>
            </div>
          )}

          {/* Empty State */}
          {courses.length === 0 && (
            <div className="flex flex-col items-center justify-center text-center p-8 py-20 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-3xl shadow-sm dark:shadow-none max-w-2xl mx-auto">
              <div className="relative mb-6">
                <div className="w-20 h-20 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 rounded-2xl flex items-center justify-center shadow-inner">
                  <Layers className="w-10 h-10" />
                </div>
                <div className="absolute -top-2 -right-2 bg-gradient-to-r from-amber-400 to-orange-500 p-1.5 rounded-lg text-white shadow-md">
                  <Sparkles className="w-4 h-4 animate-pulse" />
                </div>
              </div>
              <h2 className="text-xl font-bold text-slate-800 dark:text-slate-200 mb-2">
                У вас еще нет учебных курсов
              </h2>
              <p className="text-slate-500 dark:text-slate-400 text-sm max-w-md mb-8">
                Выберите несколько лекций из вашей библиотеки, и наш искусственный интеллект упорядочит их по сложности, разобьет на разделы и составит программу обучения!
              </p>
              <button
                onClick={() => {
                  setView('builder');
                  setBuilderStep('setup');
                }}
                className="px-6 py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-lg shadow-indigo-100 dark:shadow-none transition-all flex items-center gap-2"
              >
                <Sparkles className="w-4 h-4" /> Создать ИИ-курс
              </button>
            </div>
          )}

          {/* Course Grid */}
          {courses.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {courses.map((course) => {
                const prog = getCourseProgress(course);
                return (
                  <motion.div
                    key={course.id}
                    whileHover={{ y: -4 }}
                    onClick={() => {
                      setSelectedCourse(course);
                      setView('detail');
                    }}
                    className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl p-6 cursor-pointer shadow-sm dark:shadow-none hover:shadow-md transition-all flex flex-col justify-between group relative overflow-hidden"
                  >
                    {/* Background glows */}
                    <div className="absolute -right-12 -bottom-12 w-28 h-28 bg-indigo-50/50 dark:bg-indigo-950/20 rounded-full blur-xl group-hover:bg-indigo-100/50 dark:group-hover:bg-indigo-950/40 transition-all" />

                    <div>
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <span className="px-2.5 py-1 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-400 text-[10px] font-bold rounded-lg uppercase tracking-wider">
                          Курс
                        </span>
                        
                        <button
                          onClick={(e) => handleDeleteCourse(e, course.id)}
                          className="p-1.5 text-slate-300 dark:text-slate-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg transition-all"
                          title="Удалить курс"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>

                      <h3 className="font-extrabold text-slate-800 dark:text-slate-200 text-lg leading-snug mb-2 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors line-clamp-2">
                        {course.title}
                      </h3>
                      
                      <p className="text-slate-500 dark:text-slate-400 text-xs mb-6 line-clamp-3 leading-relaxed">
                        {course.description || 'Без описания.'}
                      </p>
                    </div>

                    <div className="space-y-3 mt-auto">
                      <div className="flex items-center justify-between text-xs font-bold text-slate-600 dark:text-slate-300">
                        <span>Прогресс</span>
                        <span>{prog.completed} из {prog.total} тем ({prog.percent}%)</span>
                      </div>
                      <div className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                        <motion.div
                          className="h-full bg-gradient-to-r from-indigo-500 to-purple-600 rounded-full"
                          initial={{ width: 0 }}
                          animate={{ width: `${prog.percent}%` }}
                          transition={{ duration: 0.8, ease: 'easeOut' }}
                        />
                      </div>
                      <div className="flex items-center justify-end text-xs font-extrabold text-indigo-600 dark:text-indigo-400 pt-2 group-hover:translate-x-1 transition-transform">
                        Продолжить обучение →
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ─── B) COURSE BUILDER VIEW ─── */}
      {!loading && view === 'builder' && (
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="flex items-center gap-3 mb-6">
            <button
              onClick={() => setView('list')}
              className="p-2 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-350 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-2xl font-extrabold text-slate-900 dark:text-slate-100">
                Конструктор учебного курса
              </h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {builderStep === 'setup' 
                  ? 'Шаг 1: Выберите лекции для объединения в курс' 
                  : 'Шаг 2: Настройте разделы и порядок тем'}
              </p>
            </div>
          </div>

          {/* GENERATING LOADING OVERLAY */}
          {generating && (
            <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 shadow-xl dark:shadow-none rounded-3xl p-8 py-16 text-center max-w-lg mx-auto my-10 flex flex-col items-center">
              <div className="relative w-24 h-24 mb-6">
                <div className="absolute inset-0 border-4 border-indigo-600/30 rounded-full" />
                <div className="absolute inset-0 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                <div className="absolute inset-4 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 rounded-full flex items-center justify-center shadow-inner">
                  <Sparkles className="w-8 h-8 animate-pulse text-indigo-600 dark:text-indigo-400" />
                </div>
              </div>
              <h3 className="font-extrabold text-slate-800 dark:text-slate-200 text-xl mb-2">
                ИИ-методист составляет курс
              </h3>
              
              <div className="h-8 overflow-hidden mb-6 flex items-center justify-center">
                <AnimatePresence mode="wait">
                  <motion.p
                    key={loadingTipIndex}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.3 }}
                    className="text-indigo-600 dark:text-indigo-400 font-bold text-sm"
                  >
                    {LOADING_TIPS[loadingTipIndex]}
                  </motion.p>
                </AnimatePresence>
              </div>

              <p className="text-xs text-slate-400 dark:text-slate-500 max-w-xs">
                Обычно это занимает около 5-10 секунд. Мы выстраиваем темы от простых к продвинутым.
              </p>
            </div>
          )}

          {/* STEP 1: SETUP (SELECT MATERIALS & GOALS) */}
          {!generating && builderStep === 'setup' && (
            <div className="space-y-6">
              {/* Materials list */}
              <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl p-5 md:p-6 shadow-sm dark:shadow-none relative z-20">
                <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 mb-6">
                  <div>
                    <h2 className="font-bold text-slate-800 dark:text-slate-200">1. Выберите лекции ({selectedMaterialIds.length} выбрано)</h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">Материалы, которые лягут в основу курса</p>
                  </div>
                  
                  {/* Search and filter */}
                  <div className="flex gap-2">
                    <div className="relative">
                      <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
                      <input
                        type="text"
                        placeholder="Поиск..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        className="pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-indigo-500 w-44"
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
                        className="w-40 px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-850 dark:text-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 shadow-sm"
                      />
                    )}
                  </div>
                </div>

                {materials.length === 0 ? (
                  <div className="text-center py-12 border-2 border-dashed border-slate-100 dark:border-slate-800 rounded-xl">
                    <BookOpen className="w-12 h-12 text-slate-300 dark:text-slate-500 mx-auto mb-3" />
                    <p className="text-slate-500 dark:text-slate-400 text-sm font-medium mb-1">Ваша библиотека пуста</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mb-4">Сначала загрузите материалы для анализа</p>
                    <button 
                      onClick={() => navigate('/analyze')}
                      className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700 transition"
                    >
                      Добавить лекцию →
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[350px] overflow-y-auto pr-2 custom-scrollbar">
                    {filteredMaterials.map(m => {
                      const isSelected = selectedMaterialIds.includes(m.id);
                      return (
                        <div
                          key={m.id}
                          onClick={() => {
                            setSelectedMaterialIds(prev =>
                              isSelected ? prev.filter(id => id !== m.id) : [...prev, m.id]
                            );
                          }}
                          className={`p-4 border rounded-xl cursor-pointer transition-all flex items-start gap-3 ${
                            isSelected 
                              ? 'border-indigo-600 dark:border-indigo-500 bg-indigo-50/40 dark:bg-indigo-950/20 ring-1 ring-indigo-500' 
                              : 'border-slate-100 dark:border-slate-800 hover:border-slate-200 dark:hover:border-slate-700 bg-slate-50/50 dark:bg-slate-900/50'
                          }`}
                        >
                          <div className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                            isSelected ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800'
                          }`}>
                            {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 truncate mb-1">{m.title}</h4>
                            {m.subject && (
                              <span className="inline-block px-2 py-0.5 bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-400 text-[9px] font-bold rounded uppercase tracking-wider">
                                {m.subject}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Goals / Wishes */}
              <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl p-5 md:p-6 shadow-sm dark:shadow-none">
                <h2 className="font-bold text-slate-800 dark:text-slate-200 mb-2">2. Опишите ваши цели или пожелания (необязательно)</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">Например: "Хочу сначала изучить простые понятия, сделать упор на практические задачи" или "Подготовить структуру под формат экзамена"</p>
                <textarea
                  value={goals}
                  onChange={e => setGoals(e.target.value)}
                  placeholder="Пример: Сделай упор на основы темы, сгруппируй материал по хронологическому принципу..."
                  className="w-full p-4 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 rounded-xl text-xs min-h-[100px] outline-none transition text-slate-800 dark:text-slate-200"
                />
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  onClick={handleCreateManual}
                  disabled={selectedMaterialIds.length === 0}
                  className="px-5 py-3 text-slate-700 dark:text-slate-300 font-bold border border-slate-200 dark:border-slate-750 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition disabled:opacity-50"
                >
                  Собрать вручную
                </button>
                <button
                  onClick={handleGenerateAI}
                  disabled={selectedMaterialIds.length === 0}
                  className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-bold rounded-xl shadow-lg shadow-indigo-100 dark:shadow-none hover:shadow-indigo-200 dark:hover:shadow-none hover:scale-[1.02] transition-all disabled:opacity-50"
                >
                  <Sparkles className="w-4 h-4" />
                  Сгенерировать с ИИ
                </button>
              </div>
            </div>
          )}

          {/* STEP 2: EDIT STRUCTURE */}
          {!generating && builderStep === 'edit' && (
            <div className="space-y-6">
              {/* Metadata Inputs */}
              <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl p-5 md:p-6 shadow-sm dark:shadow-none space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1.5 uppercase tracking-wider">Название курса</label>
                  <input
                    type="text"
                    value={courseTitle}
                    onChange={e => setCourseTitle(e.target.value)}
                    className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-bold text-slate-800 dark:text-slate-200 outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="Например: Введение в биологию клетки"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1.5 uppercase tracking-wider">Описание курса</label>
                  <textarea
                    value={courseDescription}
                    onChange={e => setCourseDescription(e.target.value)}
                    className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-600 dark:text-slate-350 outline-none focus:ring-2 focus:ring-indigo-500 min-h-[70px]"
                    placeholder="Чему посвящен этот курс..."
                  />
                </div>
              </div>

              {/* Sections Editor */}
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <h2 className="font-extrabold text-slate-800 dark:text-slate-200">Разделы и материалы курса</h2>
                  <button
                    onClick={handleAddSection}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-bold transition"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Добавить раздел
                  </button>
                </div>

                {courseStructure.length === 0 && (
                  <p className="text-center text-slate-400 dark:text-slate-500 text-xs py-8 bg-slate-50 dark:bg-slate-900 rounded-xl border border-dashed border-slate-200 dark:border-slate-800">
                    Нет созданных разделов. Добавьте первый раздел!
                  </p>
                )}

                {courseStructure.map((section, sIndex) => (
                  <div key={section.id} style={{ zIndex: 50 - sIndex }} className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl p-5 shadow-sm dark:shadow-none space-y-4 relative">
                    {/* Section controls */}
                    <div className="absolute top-4 right-4 flex items-center gap-1">
                      <button
                        onClick={() => handleMoveSection(sIndex, 'up')}
                        disabled={sIndex === 0}
                        className="p-1 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-350 hover:bg-slate-100 dark:hover:bg-slate-800 rounded disabled:opacity-30"
                        title="Поднять раздел"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleMoveSection(sIndex, 'down')}
                        disabled={sIndex === courseStructure.length - 1}
                        className="p-1 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-350 hover:bg-slate-100 dark:hover:bg-slate-800 rounded disabled:opacity-30"
                        title="Опустить раздел"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDeleteSection(section.id)}
                        className="p-1 text-slate-300 dark:text-slate-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded"
                        title="Удалить раздел"
                      >
                        <Trash className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Title & Description input */}
                    <div className="pr-20 space-y-2">
                      <input
                        type="text"
                        value={section.title}
                        onChange={e => handleUpdateSectionTitle(section.id, e.target.value)}
                        className="w-full bg-transparent text-sm font-extrabold text-slate-800 dark:text-slate-200 border-b border-dashed border-slate-200 dark:border-slate-800 focus:border-indigo-500 outline-none pb-0.5"
                        placeholder="Название раздела"
                      />
                      <input
                        type="text"
                        value={section.description}
                        onChange={e => handleUpdateSectionDesc(section.id, e.target.value)}
                        className="w-full bg-transparent text-xs text-slate-500 dark:text-slate-400 outline-none"
                        placeholder="Что изучаем в этом разделе..."
                      />
                    </div>

                    {/* Materials inside this section */}
                    <div className="space-y-2 pl-4 border-l-2 border-indigo-100 dark:border-indigo-900">
                      {section.materials.length === 0 && (
                        <p className="text-slate-400 dark:text-slate-500 text-[10px] italic py-1">Нет материалов в этом разделе</p>
                      )}
                      
                      {section.materials.map((m, mIndex) => (
                        <div key={m.id} className="flex items-center justify-between gap-3 bg-slate-50 dark:bg-slate-850 hover:bg-slate-100/80 dark:hover:bg-slate-800/80 p-2 rounded-lg text-xs transition-colors">
                          <span className="font-bold text-slate-700 dark:text-slate-300 truncate">{m.title}</span>
                          
                          <div className="flex items-center gap-1 shrink-0">
                            {/* Move material up */}
                            <button
                              onClick={() => handleMoveMaterial(section.id, mIndex, 'up')}
                              disabled={mIndex === 0}
                              className="p-1 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 disabled:opacity-30"
                            >
                              <ArrowUp className="w-3 h-3" />
                            </button>
                            {/* Move material down */}
                            <button
                              onClick={() => handleMoveMaterial(section.id, mIndex, 'down')}
                              disabled={mIndex === section.materials.length - 1}
                              className="p-1 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 disabled:opacity-30"
                            >
                              <ArrowDown className="w-3 h-3" />
                            </button>
                            {/* Move to another section */}
                            {courseStructure.length > 1 && (
                              <CustomSelect
                                onChange={val => handleMoveMaterialToSection(section.id, m.id, val)}
                                value={section.id}
                                options={courseStructure.map(s => ({
                                  value: s.id,
                                  label: `В ${s.title.slice(0, 15)}...`
                                }))}
                                className="w-32 px-1 py-0.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 rounded text-[10px]"
                              />
                            )}
                            {/* Remove */}
                            <button
                              onClick={() => handleRemoveMaterialFromSection(section.id, m.id)}
                              className="p-1 text-slate-300 dark:text-slate-600 hover:text-rose-600"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Add material dropdown for selected ones */}
                    <div className="pt-2">
                      <CustomSelect
                        onChange={(val) => {
                          if (val) {
                            const found = materials.find(m => m.id === val);
                            if (found) {
                              handleAddMaterialToSection(section.id, found.id, found.title);
                            }
                          }
                        }}
                        value=""
                        placeholder="+ Добавить материал в раздел..."
                        options={[
                          ...materials
                            .filter(m => selectedMaterialIds.includes(m.id))
                            .map(m => ({ value: m.id, label: m.title }))
                        ]}
                        className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 rounded-lg text-[10px] font-bold focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                  </div>
                ))}
              </div>

              {/* Action buttons */}
              <div className="flex justify-between items-center pt-4">
                <button
                  onClick={() => setBuilderStep('setup')}
                  className="px-5 py-3 text-slate-500 dark:text-slate-400 font-bold hover:bg-slate-50 dark:hover:bg-slate-850 rounded-xl transition"
                >
                  ← Вернуться к выбору лекций
                </button>
                <button
                  onClick={handleSaveCourse}
                  disabled={saving}
                  className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-lg shadow-indigo-100 dark:shadow-none transition-all"
                >
                  {saving ? 'Сохранение...' : 'Создать учебный курс'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── C) COURSE DETAIL VIEW ─── */}
      {!loading && view === 'detail' && selectedCourse && (
        <div>
          {/* Back & Title */}
          <div className="flex items-center gap-3 mb-6">
            <button
              onClick={() => setView('list')}
              className="p-2 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-350 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-400 text-[9px] font-extrabold rounded uppercase tracking-wider">
                  Курс
                </span>
                <span className="text-slate-400 dark:text-slate-500 text-xs">
                  Создан {new Date(selectedCourse.created_at).toLocaleDateString('ru-RU')}
                </span>
              </div>
              <h1 className="text-xl md:text-2xl font-extrabold text-slate-900 dark:text-slate-100 tracking-tight">
                {selectedCourse.title}
              </h1>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* LEFT COLUMN: COURSE TIMELINE */}
            <div className="lg:col-span-2 space-y-6">
              {/* Course Info Card & Progress */}
              <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl p-5 shadow-sm dark:shadow-none space-y-4">
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  {selectedCourse.description || 'Нет описания курса.'}
                </p>
                
                {/* Progress bar */}
                {(() => {
                  const prog = getCourseProgress(selectedCourse);
                  return (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs font-bold text-slate-600 dark:text-slate-300">
                        <span>Прогресс курса</span>
                        <span>{prog.completed} из {prog.total} тем ({prog.percent}%)</span>
                      </div>
                      <div className="w-full h-3 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                        <motion.div
                          className="h-full bg-gradient-to-r from-indigo-500 to-purple-600 rounded-full"
                          initial={{ width: 0 }}
                          animate={{ width: `${prog.percent}%` }}
                          transition={{ duration: 0.8, ease: 'easeOut' }}
                        />
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Vertical timeline of sections */}
              <div className="space-y-6">
                {selectedCourse.structure.map((section, sIndex) => {
                  const sectTotal = section.materials.length;
                  const sectCompleted = section.materials.filter(m => m.completed).length;
                  const isSectDone = sectTotal > 0 && sectTotal === sectCompleted;
                  
                  return (
                    <div key={section.id} className="relative pl-8">
                      {/* Timeline Line */}
                      {sIndex < selectedCourse.structure.length - 1 && (
                        <div className="absolute left-[15px] top-8 bottom-0 w-0.5 bg-slate-200 dark:bg-slate-800" />
                      )}
                      
                      {/* Timeline Bullet */}
                      <div className={`absolute left-0 top-1.5 w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shadow-md border ${
                        isSectDone 
                          ? 'bg-emerald-500 border-emerald-500 text-white' 
                          : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400'
                      }`}>
                        {isSectDone ? '✓' : sIndex + 1}
                      </div>

                      {/* Section Card */}
                      <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl p-5 shadow-sm dark:shadow-none space-y-4">
                        <div>
                          <div className="flex items-center justify-between gap-3 mb-1">
                            <h3 className="font-extrabold text-slate-800 dark:text-slate-200 text-base">
                              {section.title}
                            </h3>
                            <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500">
                              {sectCompleted}/{sectTotal} изучено
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {section.description}
                          </p>
                        </div>

                        {/* Material checklist inside section */}
                        <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                          {section.materials.length === 0 && (
                            <p className="text-[10px] text-slate-400 dark:text-slate-500 italic">Нет материалов в этом разделе</p>
                          )}
                          
                          {section.materials.map(m => (
                            <div
                              key={m.id}
                              className={`flex items-center justify-between p-3 rounded-xl border transition-all ${
                                m.completed 
                                  ? 'bg-emerald-50/30 dark:bg-emerald-950/20 border-emerald-100 dark:border-emerald-900' 
                                  : 'bg-slate-50/50 dark:bg-slate-900/50 border-slate-100 dark:border-slate-800 hover:border-slate-200 dark:hover:border-slate-700'
                              }`}
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                {/* Toggle Checkbox */}
                                <button
                                  onClick={() => handleToggleMaterial(section.id, m.id)}
                                  className={`w-5 h-5 rounded-full border flex items-center justify-center transition-all ${
                                    m.completed
                                      ? 'bg-emerald-500 border-emerald-500 text-white'
                                      : 'border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-655 bg-white dark:bg-slate-800'
                                  }`}
                                >
                                  {m.completed && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                                </button>

                                <span 
                                  onClick={() => handleOpenPreview(m.id)}
                                  className={`text-xs font-bold cursor-pointer hover:text-indigo-600 dark:hover:text-indigo-400 transition truncate ${
                                    m.completed ? 'text-slate-400 dark:text-slate-500 line-through font-normal' : 'text-slate-700 dark:text-slate-300'
                                  }`}
                                >
                                  {m.title}
                                </span>
                              </div>

                              {/* Quick study actions */}
                              <div className="flex items-center gap-2 shrink-0 ml-2">
                                <button
                                  onClick={() => handleOpenPreview(m.id)}
                                  className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 rounded-lg transition-colors"
                                  title="Быстрый просмотр конспекта"
                                >
                                  <Eye className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* RIGHT COLUMN: QUICK PREVIEW PANEL */}
            <div className="lg:col-span-1">
              <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl p-5 shadow-sm dark:shadow-none sticky top-6 min-h-[400px] flex flex-col">
                {previewLoading && (
                  <div className="flex-1 flex flex-col items-center justify-center py-10">
                    <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mb-3" />
                    <p className="text-xs text-slate-400 dark:text-slate-500">Загрузка краткого содержания...</p>
                  </div>
                )}

                {!previewLoading && !previewMaterial && (
                  <div className="flex-1 flex flex-col items-center justify-center text-center py-10 px-4">
                    <BookOpen className="w-12 h-12 text-slate-200 dark:text-slate-700 mb-4" />
                    <h3 className="font-bold text-slate-800 dark:text-slate-200 text-sm mb-1">
                      Материал не выбран
                    </h3>
                    <p className="text-xs text-slate-400 dark:text-slate-500 max-w-[200px]">
                      Нажмите на название любого материала или иконку глаза слева для быстрого изучения.
                    </p>
                  </div>
                )}

                {!previewLoading && previewMaterial && (
                  <div className="flex-1 flex flex-col justify-between">
                    <div>
                      {/* Preview Header */}
                      <div className="flex items-start justify-between gap-2 mb-4">
                        <div className="min-w-0">
                          {previewMaterial.subject && (
                            <span className="inline-block px-2 py-0.5 bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-400 text-[9px] font-bold rounded uppercase tracking-wider mb-1.5">
                              {previewMaterial.subject}
                            </span>
                          )}
                          <h3 className="font-extrabold text-slate-800 dark:text-slate-200 text-sm leading-snug truncate">
                            {previewMaterial.title}
                          </h3>
                        </div>
                        <button
                          onClick={() => setPreviewMaterial(null)}
                          className="p-1 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>

                      {/* Summary content formatted by SummaryView */}
                      <div className="max-h-[300px] overflow-y-auto pr-2 custom-scrollbar text-xs border-t border-slate-100 dark:border-slate-800 pt-3">
                        {previewMaterial.summary_json ? (
                          <SummaryView data={previewMaterial.summary_json} />
                        ) : (
                          <p className="italic text-slate-400 dark:text-slate-500">Конспект не найден.</p>
                        )}
                      </div>
                    </div>

                    {/* Action links */}
                    <div className="border-t border-slate-100 dark:border-slate-800 pt-4 mt-6 space-y-2">
                      <button
                        onClick={() => navigate(`/library/${previewMaterial.id}`)}
                        className="w-full flex items-center justify-center gap-2 py-2 px-3 bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 dark:hover:bg-slate-700 text-white rounded-xl text-xs font-bold transition"
                      >
                        <BookOpen className="w-3.5 h-3.5" />
                        Полный материал →
                      </button>
                      
                      <button
                        onClick={() => navigate(`/library/${previewMaterial.id}?mode=express`)}
                        className="w-full flex items-center justify-center gap-2 py-2 px-3 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold transition"
                      >
                        <Zap className="w-3.5 h-3.5" />
                        Повторить за 5 минут
                      </button>

                      <button
                        onClick={() => startExam(previewMaterial.id)}
                        className="w-full flex items-center justify-center gap-2 py-2 px-3 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl text-xs font-bold transition"
                      >
                        <Award className="w-3.5 h-3.5" />
                        Устный экзамен ИИ
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
