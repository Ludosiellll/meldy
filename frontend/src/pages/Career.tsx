import { Term } from '../types/index';
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Briefcase, Target, Layers, FileText, ArrowRight, Zap, CheckCircle2, Loader2, Code2, Cpu } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useConfirm } from '../contexts/ConfirmContext';
import { getCareerProfile, generateCareerProfile, CareerProfile } from '../api/career';
import { getMaterials } from '../api/materials';
import ReactMarkdown from 'react-markdown';

export default function Career() {
  const { user } = useAuth();
  const { alert } = useConfirm();
  const navigate = useNavigate();

  const [profile, setProfile] = useState<CareerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    if (!user) return;
    getCareerProfile(user.id)
      .then(p => {
        setProfile(p);
        setLoading(false);
      })
      .catch(async (e) => {
        console.error(e);
        await alert({ title: 'Ошибка', message: 'Не удалось оцифровать навыки.', type: 'danger' });
        setLoading(false);
      });
  }, [user]);

  const handleGenerate = async () => {
    if (!user) return;
    setIsGenerating(true);

    try {
      // 1. Собираем все материалы пользователя
      const materials = await getMaterials(user.id);
      
      if (!materials || materials.length === 0) {
        setIsGenerating(false);
        await alert({ title: 'Нет конспектов', message: 'У вас пока нет загруженных конспектов. Добавьте материалы, чтобы ИИ смог проанализировать ваши навыки!', type: 'warning' });
        return;
      }

      // 2. Формируем контекст для ИИ
      const contextLines = materials.map(m => {
        let termsStr = "";
        if (m.summary_json && m.summary_json.terms) {
          termsStr = "Термины: " + m.summary_json.terms.map((t: Term) => t.term).join(", ");
        }
        let summaryText = typeof m.summary_json === 'string' ? m.summary_json : (m.summary_json?.content || '');
        return `Тема: ${m.subject || m.title}\nКонспект: ${summaryText.slice(0, 500)}...\n${termsStr}`;
      });

      const contextStr = contextLines.join("\n\n---\n\n").slice(0, 15000);

      // 3. Вызываем API
      const newProfile = await generateCareerProfile(user.id, contextStr);
      if (newProfile) {
        setProfile(newProfile);
      } else {
        await alert({ title: 'Ошибка', message: 'Произошла ошибка при генерации профиля.', type: 'danger' });
      }
    } catch (error) {
      console.error(error);
      await alert({ title: 'Ошибка', message: 'Не удалось оцифровать навыки.', type: 'danger' });
    } finally {
      setIsGenerating(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[85vh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
      </div>
    );
  }

  // Если профиля еще нет (или он пустой) и мы не генерируем
  if (!profile && !isGenerating) {
    return (
      <div className="p-4 md:p-8 max-w-5xl mx-auto min-h-[85vh] flex flex-col items-center justify-center text-center">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-2xl">
          <div className="w-20 h-20 bg-slate-900 rounded-3xl flex items-center justify-center mx-auto mb-8 shadow-2xl shadow-slate-200">
            <Briefcase className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-4xl font-extrabold text-slate-900 mb-6 tracking-tight">Ваш Карьерный Трек</h1>
          <p className="text-lg text-slate-500 mb-10 leading-relaxed">
            Мы проанализируем все ваши загруженные конспекты, шпаргалки и термины, чтобы 
            автоматически оцифровать ваши знания в реальные <b>хард-скиллы</b>, подобрать подходящие <b>профессии</b> и составить <b>резюме</b>.
          </p>
          <button 
            onClick={handleGenerate}
            className="px-8 py-4 bg-indigo-600 text-white rounded-xl font-bold flex items-center gap-3 hover:bg-indigo-700 transition shadow-lg shadow-indigo-200 mx-auto"
          >
            <Cpu className="w-6 h-6" />
            Оцифровать мои навыки
          </button>
        </motion.div>
      </div>
    );
  }

  // Экран генерации (красивый лоадер)
  if (isGenerating) {
    return (
      <div className="p-4 md:p-8 max-w-5xl mx-auto min-h-[85vh] flex flex-col items-center justify-center text-center">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center">
          <div className="relative mb-8">
            <div className="w-24 h-24 border-4 border-indigo-100 rounded-full flex items-center justify-center">
              <Loader2 className="w-10 h-10 text-indigo-600 animate-spin" />
            </div>
            <div className="absolute inset-0 border-4 border-indigo-500 rounded-full animate-ping opacity-20" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Нейросеть анализирует вашу базу знаний...</h2>
          <p className="text-slate-500">Извлекаем хард-скиллы, строим карьерное древо и пишем резюме.</p>
        </motion.div>
      </div>
    );
  }

  // Профиль готов
  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-200">
            <Target className="w-7 h-7 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Карьерный профиль</h1>
            <p className="text-slate-500">Автоматически сгенерировано на основе вашего обучения</p>
          </div>
        </div>
        <button 
          onClick={handleGenerate}
          className="px-4 py-2 bg-white border border-slate-200 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50 flex items-center gap-2 transition"
        >
          <Zap className="w-4 h-4" />
          Пересчитать навыки
        </button>
      </div>

      <div className="grid lg:grid-cols-3 gap-4 md:gap-8">
        
        {/* Колонка 1: Скиллы и Профессии */}
        <div className="lg:col-span-1 space-y-8">
          
          <div className="bg-white p-4 md:p-6 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex items-center gap-2 mb-6">
              <Code2 className="w-5 h-5 text-indigo-600" />
              <h2 className="text-xl font-bold text-slate-900">Ваши Хард-Скиллы</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              {profile?.skills?.map((skill, i) => (
                <span key={i} className="px-3 py-1.5 bg-slate-100 text-slate-700 text-sm font-semibold rounded-lg border border-slate-200">
                  {skill}
                </span>
              ))}
            </div>
          </div>

          <div className="bg-white p-4 md:p-6 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex items-center gap-2 mb-6">
              <Briefcase className="w-5 h-5 text-indigo-600" />
              <h2 className="text-xl font-bold text-slate-900">Подходящие профессии</h2>
            </div>
            <div className="space-y-5">
              {profile?.professions?.map((prof, i) => (
                <div key={i}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-bold text-slate-700">{prof.title}</span>
                    <span className="font-bold text-indigo-600">{prof.match}% match</span>
                  </div>
                  <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: `${prof.match}%` }}
                      transition={{ duration: 1, delay: i * 0.2 }}
                      className="h-full bg-indigo-500 rounded-full"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>

        {/* Колонка 2: Резюме и Проекты */}
        <div className="lg:col-span-2 space-y-8">
          
          <div className="bg-white p-4 md:p-8 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-indigo-500" />
            <div className="flex items-center gap-2 mb-6">
              <FileText className="w-5 h-5 text-indigo-600" />
              <h2 className="text-xl font-bold text-slate-900">О себе (Для резюме)</h2>
            </div>
            <div className="prose prose-slate max-w-none prose-p:leading-relaxed text-slate-600">
              <ReactMarkdown>{profile?.resume_summary || ''}</ReactMarkdown>
            </div>
          </div>

          <div>
            <h2 className="text-xl font-bold text-slate-900 mb-4 flex items-center gap-2">
              <Layers className="w-5 h-5 text-indigo-600" />
              Идеи пет-проектов для портфолио
            </h2>
            <div className="grid sm:grid-cols-2 gap-4">
              {profile?.projects?.map((proj, i) => (
                <motion.div 
                  key={i}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.1 }}
                  className="bg-white p-4 md:p-5 rounded-2xl border border-slate-200 shadow-sm hover:border-indigo-300 transition-colors group cursor-pointer"
                >
                  <h3 className="font-bold text-slate-900 mb-2 group-hover:text-indigo-600 transition-colors">{proj.title}</h3>
                  <p className="text-sm text-slate-500 leading-relaxed">{proj.description}</p>
                </motion.div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
