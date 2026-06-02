import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Briefcase, Plus, Link, Trash2, ArrowRight, ArrowLeft, 
  Sparkles, CheckCircle2, AlertCircle, Loader2, Play,
  Send, ExternalLink, RefreshCw, Check, X, ShieldCheck
} from 'lucide-react';
import { parseVacancy, VacancyRecord, CareerProfile, getHHAuthUrl, getHHResumes } from '../api/career';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';

interface JobTrackerProps {
  profile: CareerProfile;
  onUpdateProfile: (updated: CareerProfile) => void;
  onStartInterview: (vacancy: { title: string; company: string; requirements: string }) => void;
}

const COLUMNS = [
  { key: 'selected', label: '🎯 Отбор', color: 'border-indigo-500/20' },
  { key: 'applied', label: '📨 Отклики', color: 'border-amber-500/20' },
  { key: 'test_task', label: '📝 Тестовое', color: 'border-violet-500/20' },
  { key: 'interview', label: '🤝 Собеседование', color: 'border-emerald-500/20' },
  { key: 'offer', label: '🎉 Оффер', color: 'border-pink-500/20' },
  { key: 'rejected', label: '🛑 Отказ', color: 'border-rose-500/20' }
] as const;

export default function JobTracker({ profile, onUpdateProfile, onStartInterview }: JobTrackerProps) {
  const [urlInput, setUrlInput] = useState('');
  const [manualTitle, setManualTitle] = useState('');
  const [manualCompany, setManualCompany] = useState('');
  const [loading, setLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [activeTab, setActiveTab] = useState<typeof COLUMNS[number]['key']>('selected');

  // HeadHunter States
  const [resumes, setResumes] = useState<any[]>([]);
  const [selectedResumeId, setSelectedResumeId] = useState<string>('');
  const [loadingResumes, setLoadingResumes] = useState(false);
  const [hhConnecting, setHhConnecting] = useState(false);



  const vacancies = profile.vacancies ?? [];

  // Load HH Resumes on mount/update if connected
  useEffect(() => {
    if (profile.hh_access_token) {
      loadResumes();
    }
  }, [profile.hh_access_token]);

  const loadResumes = async () => {
    setLoadingResumes(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;

      const res = await getHHResumes(token);
      const items = res.items || [];
      setResumes(items);
      
      if (items.length > 0) {
        const savedResumeId = localStorage.getItem('sf_hh_resume_id');
        if (savedResumeId && items.some((r: any) => r.id === savedResumeId)) {
          setSelectedResumeId(savedResumeId);
        } else {
          setSelectedResumeId(items[0].id);
          localStorage.setItem('sf_hh_resume_id', items[0].id);
        }
      }
    } catch (err) {
      console.error('Failed to load HH resumes:', err);
    } finally {
      setLoadingResumes(false);
    }
  };

  const handleConnectHH = async () => {
    setHhConnecting(true);
    try {
      const res = await getHHAuthUrl();
      if (res.url) {
        window.location.href = res.url;
      }
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Не удалось получить ссылку для авторизации HeadHunter.');
    } finally {
      setHhConnecting(false);
    }
  };

  const handleDisconnectHH = () => {
    onUpdateProfile({
      ...profile,
      hh_access_token: undefined,
      hh_refresh_token: undefined
    });
    setResumes([]);
    setSelectedResumeId('');
    toast.success('Аккаунт HeadHunter успешно отключен.');
  };

  const handleImportSkills = () => {
    if (!selectedResumeId) {
      toast.error('Выберите резюме для импорта.');
      return;
    }
    const resume = resumes.find(r => r.id === selectedResumeId);
    if (!resume) return;

    const rawSkills = resume.key_skills || [];
    const skillsList = rawSkills.map((s: any) => s.name || s).filter(Boolean);

    if (skillsList.length === 0) {
      toast.error('В выбранном резюме не найдены ключевые навыки.');
      return;
    }

    const currentSkills = profile.skills || [];
    const mergedSkills = Array.from(new Set([...currentSkills, ...skillsList]));

    onUpdateProfile({
      ...profile,
      skills: mergedSkills
    });

    toast.success(`Импортировано навыков: ${skillsList.length}. Всего навыков в профиле: ${mergedSkills.length}`);
  };

  const handleParseVacancy = async () => {
    if (!urlInput.trim()) return;
    setLoading(true);
    try {
      const data = await parseVacancy(urlInput);
      
      const userSkillsLower = (profile.skills ?? []).map(s => s.toLowerCase());
      const vacancySkillsLower = data.skills.map(s => s.toLowerCase());
      const matched = vacancySkillsLower.filter(s => userSkillsLower.includes(s));
      const matchScore = data.skills.length > 0 
        ? Math.round((matched.length / data.skills.length) * 100)
        : 75;

      const newVacancy: VacancyRecord = {
        id: Math.random().toString(36).substr(2, 9),
        url: urlInput,
        title: data.title,
        company: data.company,
        salary: data.salary,
        requirements: data.requirements,
        skills: data.skills,
        status: 'selected',
        match_score: matchScore
      };

      const updatedProfile = {
        ...profile,
        vacancies: [...vacancies, newVacancy]
      };

      onUpdateProfile(updatedProfile);
      toast.success('Вакансия успешно добавлена!');
      setUrlInput('');
      setShowAddForm(false);
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || 'Не удалось спарсить вакансию. Пожалуйста, убедитесь, что ссылка ведет на hh.ru.');
    } finally {
      setLoading(false);
    }
  };

  const handleAddManual = () => {
    if (!manualTitle.trim() || !manualCompany.trim()) {
      toast.error('Заполните должность и компанию');
      return;
    }

    const newVacancy: VacancyRecord = {
      id: Math.random().toString(36).substr(2, 9),
      title: manualTitle,
      company: manualCompany,
      salary: 'по результатам собеседования',
      requirements: 'Добавлено вручную.',
      skills: profile.skills.slice(0, 3),
      status: 'selected',
      match_score: 80
    };

    const updatedProfile = {
      ...profile,
      vacancies: [...vacancies, newVacancy]
    };

    onUpdateProfile(updatedProfile);
    toast.success('Вакансия добавлена!');
    setManualTitle('');
    setManualCompany('');
    setShowAddForm(false);
  };

  const handleDelete = (id: string) => {
    const updatedProfile = {
      ...profile,
      vacancies: vacancies.filter(v => v.id !== id)
    };
    onUpdateProfile(updatedProfile);
    toast.success('Карточка удалена.');
  };

  const moveStatus = (id: string, dir: 'prev' | 'next') => {
    const list = [...COLUMNS.map(c => c.key)];
    const v = vacancies.find(x => x.id === id);
    if (!v) return;

    const curIdx = list.indexOf(v.status);
    let nextIdx = curIdx + (dir === 'next' ? 1 : -1);
    if (nextIdx < 0 || nextIdx >= list.length) return;

    const nextStatus = list[nextIdx] as typeof COLUMNS[number]['key'];
    
    const updatedProfile = {
      ...profile,
      vacancies: vacancies.map(x => x.id === id ? { ...x, status: nextStatus } : x)
    };
    onUpdateProfile(updatedProfile);
  };

  const getMissingSkills = (v: VacancyRecord) => {
    const userSkillsLower = (profile.skills ?? []).map(s => s.toLowerCase());
    return v.skills.filter(s => !userSkillsLower.includes(s.toLowerCase()));
  };



  return (
    <div className="space-y-6">
      {/* HeadHunter API Connection Dashboard */}
      <div className="bg-gradient-to-r from-red-50/50 to-white dark:from-red-950/10 dark:to-slate-900/60 border border-red-150/40 dark:border-red-900/30 p-5 rounded-2xl shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6 relative overflow-hidden text-left">
        <div className="absolute right-0 top-0 w-24 h-24 bg-red-500/5 rounded-full blur-2xl pointer-events-none" />
        
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-red-600 flex items-center justify-center font-black text-white text-lg tracking-tighter shrink-0 select-none shadow-md">
            hh
          </div>
          <div className="space-y-1">
            <h3 className="font-extrabold text-sm text-slate-800 dark:text-slate-100 flex items-center gap-2">
              Интеграция с HeadHunter API
              {profile.hh_access_token ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-black border border-emerald-500/20">
                  <ShieldCheck className="w-3 h-3" /> подключено
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-450 text-[10px] font-bold">
                  отключено
                </span>
              )}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {profile.hh_access_token 
                ? 'Импортируйте навыки из вашего резюме на HeadHunter или откликайтесь прямо с Kanban доски.'
                : 'Свяжите аккаунт, чтобы импортировать профессиональные навыки и отправлять отклики.'}
            </p>
          </div>
        </div>

        {profile.hh_access_token ? (
          <div className="flex flex-wrap items-center gap-3 w-full md:w-auto md:justify-end shrink-0">
            {loadingResumes ? (
              <div className="flex items-center gap-2 text-xs text-slate-400 py-2">
                <Loader2 className="w-4 h-4 animate-spin text-red-500" /> Загружаем резюме...
              </div>
            ) : resumes.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2.5">
                <select
                  value={selectedResumeId}
                  onChange={(e) => {
                    setSelectedResumeId(e.target.value);
                    localStorage.setItem('sf_hh_resume_id', e.target.value);
                  }}
                  className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-2 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 focus:outline-none"
                >
                  {resumes.map(r => (
                    <option key={r.id} value={r.id}>{r.title}</option>
                  ))}
                </select>
                <button
                  onClick={handleImportSkills}
                  className="px-4 py-2 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/40 dark:hover:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 border border-indigo-200/50 dark:border-indigo-900/50 text-xs font-bold rounded-xl transition"
                  title="Синхронизировать ключевые навыки из резюме в ваш профиль"
                >
                  Импортировать навыки
                </button>
              </div>
            ) : (
              <div className="text-xs text-slate-400 py-2">У вас нет активных резюме на HH</div>
            )}
            
            <button
              onClick={handleDisconnectHH}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-500 dark:text-slate-400 text-xs font-bold rounded-xl transition border border-slate-200 dark:border-slate-700/60"
            >
              Отключить
            </button>
          </div>
        ) : (
          <button
            onClick={handleConnectHH}
            disabled={hhConnecting}
            className="px-5 py-2.5 bg-red-650 hover:bg-red-600 text-white rounded-xl text-xs font-black shadow-md flex items-center justify-center gap-2 transition disabled:opacity-50 shrink-0 self-start md:self-center"
          >
            {hhConnecting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Вход через HeadHunter'}
          </button>
        )}
      </div>

      {/* Kanban Dashboard Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 rounded-2xl shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-50 dark:bg-indigo-950/40 rounded-xl flex items-center justify-center">
            <Briefcase className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div>
            <h3 className="font-extrabold text-slate-800 dark:text-slate-100 text-sm">Умный Трекер Вакансий</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Добавляйте ссылки на вакансии HeadHunter для подготовки и отслеживания</p>
          </div>
        </div>
        
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 shadow-sm shrink-0"
        >
          <Plus className="w-4 h-4" />
          Добавить вакансию
        </button>
      </div>

      {/* Add Form Accordion */}
      <AnimatePresence>
        {showAddForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 rounded-2xl space-y-4"
          >
            <h4 className="text-xs font-black text-slate-700 dark:text-slate-200 uppercase tracking-wider">Форма добавления вакансии</h4>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Parse via HH link */}
              <div className="space-y-3 p-4 bg-slate-50 dark:bg-slate-950/20 border border-slate-200 dark:border-slate-800/80 rounded-xl text-left">
                <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-600 dark:text-indigo-400">
                  <Link className="w-4 h-4" /> Ссылка на HeadHunter (hh.ru)
                </div>
                <p className="text-[10px] text-slate-500 dark:text-slate-400">Вставьте ссылку на вакансию, чтобы автоматически выгрузить детали.</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    disabled={loading}
                    value={urlInput}
                    onChange={e => setUrlInput(e.target.value)}
                    placeholder="Пример: https://hh.ru/vacancy/123456"
                    className="flex-1 bg-white dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800/80 rounded-lg px-3 py-2 text-xs text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:border-indigo-500/40"
                  />
                  <button
                    onClick={handleParseVacancy}
                    disabled={loading || !urlInput.trim()}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-lg transition disabled:opacity-40 flex items-center gap-1.5 shrink-0"
                  >
                    {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Парсить'}
                  </button>
                </div>
              </div>

              {/* Manual mode */}
              <div className="space-y-3 p-4 bg-slate-50 dark:bg-slate-950/20 border border-slate-200 dark:border-slate-800/80 rounded-xl text-left">
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-600 dark:text-slate-300">
                  <Briefcase className="w-4 h-4" /> Вручную
                </div>
                <p className="text-[10px] text-slate-500 dark:text-slate-400">Добавить вакансию вручную, если ссылка отсутствует.</p>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={manualTitle}
                    onChange={e => setManualTitle(e.target.value)}
                    placeholder="Должность..."
                    className="bg-white dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800/80 rounded-lg px-3 py-2 text-xs text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:outline-none"
                  />
                  <input
                    type="text"
                    value={manualCompany}
                    onChange={e => setManualCompany(e.target.value)}
                    placeholder="Компания..."
                    className="bg-white dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800/80 rounded-lg px-3 py-2 text-xs text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:outline-none"
                  />
                </div>
                <button
                  onClick={handleAddManual}
                  className="w-full py-2 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold rounded-lg transition"
                >
                  Добавить
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* MOBILE COLUMN SELECTOR TAB BAR */}
      <div className="flex lg:hidden bg-slate-100 dark:bg-slate-950 p-1 rounded-xl overflow-x-auto gap-1">
        {COLUMNS.map(col => {
          const count = vacancies.filter(v => v.status === col.key).length;
          return (
            <button
              key={col.key}
              onClick={() => setActiveTab(col.key)}
              className={`px-3 py-2 rounded-lg text-xs font-black transition-all flex items-center gap-1.5 whitespace-nowrap ${
                activeTab === col.key
                  ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-white shadow-sm'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800'
              }`}
            >
              <span>{col.label}</span>
              <span className="px-1.5 py-0.5 bg-slate-200 dark:bg-slate-900 rounded-full text-[9px] font-black">{count}</span>
            </button>
          );
        })}
      </div>

      {/* MAIN KANBAN BOARD */}
      <div className="grid grid-cols-1 lg:grid-cols-6 gap-4 items-start min-h-[60vh]">
        {COLUMNS.map(col => {
          const list = vacancies.filter(v => v.status === col.key);
          const isMobileHidden = activeTab !== col.key;
          
          return (
            <div 
              key={col.key} 
              className={`flex flex-col bg-slate-50 dark:bg-slate-950/20 border border-slate-200 dark:border-slate-800/80 rounded-2xl p-3 space-y-3 min-h-[150px] lg:min-h-[500px] transition-all ${
                isMobileHidden ? 'hidden lg:flex' : 'flex'
              }`}
            >
              {/* Header column title */}
              <div className="flex justify-between items-center px-1">
                <span className="text-xs font-black text-slate-800 dark:text-slate-200">{col.label}</span>
                <span className="px-2 py-0.5 bg-slate-200 dark:bg-slate-900 border border-slate-300 dark:border-slate-800 text-slate-600 dark:text-slate-400 text-[10px] font-black rounded-lg">
                  {list.length}
                </span>
              </div>

              {/* Cards wrapper */}
              <div className="space-y-3 overflow-y-auto lg:max-h-[70vh]">
                {list.length === 0 ? (
                  <p className="text-center text-[10px] text-slate-400 dark:text-slate-500 italic py-8">Пусто</p>
                ) : (
                  list.map(v => {
                    const missing = getMissingSkills(v);
                    
                    return (
                      <motion.div
                        key={v.id}
                        layoutId={v.id}
                        className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm hover:border-slate-300 dark:hover:border-slate-700 transition space-y-3 group text-left"
                      >
                        {/* Title & Company */}
                        <div>
                          <div className="flex justify-between items-start gap-1">
                            <h5 className="text-xs font-extrabold text-slate-900 dark:text-slate-100 leading-tight group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                              {v.title}
                            </h5>
                            <button
                              onClick={() => handleDelete(v.id)}
                              className="p-1 text-slate-400 hover:text-rose-500 rounded transition opacity-50 sm:opacity-0 group-hover:opacity-100"
                              title="Удалить карточку"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400">{v.company}</p>
                          {v.salary && (
                            <p className="text-[9px] text-indigo-600 dark:text-indigo-400 font-extrabold mt-0.5">{v.salary}</p>
                          )}
                        </div>

                        {/* Match score bar */}
                        {v.match_score !== undefined && (
                          <div className="space-y-1.5 p-2 bg-slate-50 dark:bg-slate-950/40 border border-slate-100 dark:border-slate-800 rounded-lg">
                            <div className="flex justify-between items-center text-[9px] font-bold">
                              <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1">
                                <Sparkles className="w-3 h-3 text-amber-500 animate-pulse" />
                                Стек-совпадение
                              </span>
                              <span className={v.match_score >= 80 ? 'text-emerald-600 dark:text-emerald-400 font-black' : 'text-indigo-600 dark:text-indigo-400 font-black'}>
                                {v.match_score}%
                              </span>
                            </div>
                            
                            <div className="h-1 w-full bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 rounded-full"
                                style={{ width: `${v.match_score}%` }}
                              />
                            </div>

                            {/* Missing skills notifications */}
                            {missing.length > 0 && (
                              <div className="text-[8px] text-slate-500 dark:text-slate-400 leading-normal font-semibold">
                                <span className="font-extrabold block text-slate-500 dark:text-slate-400">Чего не хватает:</span>
                                <span className="text-indigo-600/90 dark:text-indigo-400">{missing.slice(0, 3).join(', ')}</span>
                                {missing.length > 3 && ` +${missing.length - 3}`}
                              </div>
                            )}
                          </div>
                        )}

                        <div className="flex flex-col gap-1.5">

                          {/* Tailored Mock Interview Action */}
                          <button
                            onClick={() => onStartInterview({ 
                              title: v.title, 
                              company: v.company, 
                              requirements: v.requirements ?? 'Обучение по треку курса' 
                            })}
                            className="w-full py-1.5 bg-indigo-55 hover:bg-indigo-600 text-indigo-600 hover:text-white dark:bg-indigo-950/20 dark:hover:bg-indigo-900/60 dark:text-indigo-300 border border-indigo-200/50 dark:border-indigo-950 rounded-lg text-[9px] font-extrabold flex items-center justify-center gap-1 transition"
                          >
                            <Play className="w-2.5 h-2.5 fill-current" />
                            Собеседование
                          </button>
                        </div>

                        {/* Navigation Arrows for status transitions */}
                        <div className="flex justify-between items-center pt-2 border-t border-slate-100 dark:border-slate-800/80">
                          <button
                            onClick={() => moveStatus(v.id, 'prev')}
                            className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded text-slate-400 transition"
                            title="Сдвинуть назад"
                          >
                            <ArrowLeft className="w-3.5 h-3.5" />
                          </button>
                          <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">Статус</span>
                          <button
                            onClick={() => moveStatus(v.id, 'next')}
                            className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded text-slate-400 transition"
                            title="Сдвинуть вперед"
                          >
                            <ArrowRight className="w-3.5 h-3.5" />
                          </button>
                        </div>

                      </motion.div>
                    );
                  })
                )}
              </div>

            </div>
          );
        })}
      </div>
    </div>
  );
}
