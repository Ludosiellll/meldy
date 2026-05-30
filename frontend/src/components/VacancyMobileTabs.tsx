import React, { useState } from 'react';
import { Briefcase, MessageSquare, Info, Zap, ExternalLink, Send, Loader2, ChevronRight } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { VacancyItem } from '../api/career';

interface VacancyMobileTabsProps {
  foundVacancies: VacancyItem[];
  selectedVacancy: VacancyItem | null;
  vacancyChatMessages: { role: string; content: string }[];
  vacancyChatInput: string;
  setVacancyChatInput: (v: string) => void;
  sendingVacancyChat: boolean;
  handleSendVacancyChatMessage: () => void;
  onSelectVacancy: (vac: VacancyItem) => void;
  onLaunchCourse: () => void;
  pendingLocation?: string;
  formatSalary: (salary: string, location?: string) => string;
}

type MobileTab = 'list' | 'details' | 'chat';

export default function VacancyMobileTabs({
  foundVacancies,
  selectedVacancy,
  vacancyChatMessages,
  vacancyChatInput,
  setVacancyChatInput,
  sendingVacancyChat,
  handleSendVacancyChatMessage,
  onSelectVacancy,
  onLaunchCourse,
  pendingLocation,
  formatSalary,
}: VacancyMobileTabsProps) {
  const [activeTab, setActiveTab] = useState<MobileTab>('list');

  const tabs: { key: MobileTab; label: string; icon: React.ReactNode }[] = [
    { key: 'list', label: 'Вакансии', icon: <Briefcase className="w-3.5 h-3.5" /> },
    { key: 'details', label: 'Детали', icon: <Info className="w-3.5 h-3.5" /> },
    { key: 'chat', label: 'ИИ-чат', icon: <MessageSquare className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="flex lg:hidden flex-col w-full h-full overflow-hidden">
      {/* Tab Bar */}
      <div className="flex shrink-0 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-bold transition-all border-b-2 ${
              activeTab === tab.key
                ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400 bg-indigo-50/50 dark:bg-indigo-950/20'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            {tab.icon}
            {tab.label}
            {tab.key === 'list' && foundVacancies.length > 0 && (
              <span className="px-1.5 py-0.5 bg-slate-200 dark:bg-slate-800 rounded-full text-[9px] font-black text-slate-600 dark:text-slate-300">
                {foundVacancies.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-hidden relative">

        {/* LIST TAB */}
        {activeTab === 'list' && (
          <div className="absolute inset-0 overflow-y-auto p-4 space-y-3 bg-slate-50/50 dark:bg-slate-950/40">
            <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Найдено вакансий: {foundVacancies.length}
            </h4>
            {foundVacancies.map((vac, idx) => {
              const isSelected =
                selectedVacancy?.title === vac.title && selectedVacancy?.company === vac.company;
              return (
                <div
                  key={idx}
                  onClick={() => {
                    onSelectVacancy(vac);
                    setActiveTab('details');
                  }}
                  className={`p-4 rounded-2xl border transition-all cursor-pointer select-none flex flex-col gap-2 ${
                    isSelected
                      ? 'bg-gradient-to-r from-indigo-50 to-indigo-100/50 dark:from-indigo-950/60 dark:to-indigo-900/40 border-indigo-500 shadow-sm'
                      : 'bg-white dark:bg-slate-900/50 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <div className="flex justify-between items-start gap-2">
                    <span className="font-extrabold text-sm text-slate-800 dark:text-slate-100">
                      {vac.title}
                    </span>
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 shrink-0 border border-slate-200 dark:border-slate-700">
                      {vac.source}
                    </span>
                  </div>
                  <span className="text-xs text-slate-500 dark:text-slate-400 font-semibold">
                    {vac.company}
                  </span>
                  <div className="flex items-center justify-between mt-1 pt-2 border-t border-slate-100 dark:border-slate-800/40">
                    <span className="text-xs font-bold text-emerald-500 dark:text-emerald-400">
                      {formatSalary(vac.salary, pendingLocation)}
                    </span>
                    <span className="text-[10px] text-indigo-400 flex items-center gap-1 font-bold">
                      Подробнее <ChevronRight className="w-3 h-3" />
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* DETAILS TAB */}
        {activeTab === 'details' && (
          <div className="absolute inset-0 overflow-y-auto p-4 space-y-5">
            {selectedVacancy ? (
              <>
                <div>
                  <p className="text-[10px] font-bold text-indigo-500 dark:text-indigo-400 uppercase tracking-wider mb-1">
                    Выбранная вакансия
                  </p>
                  <h2 className="text-lg font-black text-slate-900 dark:text-slate-100">
                    {selectedVacancy.title}
                  </h2>
                  <p className="text-sm font-semibold text-indigo-600 dark:text-indigo-300 mt-0.5">
                    {selectedVacancy.company}
                  </p>
                  <p className="text-base font-bold text-emerald-500 dark:text-emerald-400 mt-1">
                    {formatSalary(selectedVacancy.salary, pendingLocation)}
                  </p>
                </div>

                {selectedVacancy.requirements && (
                  <div>
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                      Требования:
                    </h4>
                    <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed bg-slate-100/40 dark:bg-slate-800/40 p-3 rounded-xl border border-slate-200 dark:border-slate-700 font-medium">
                      {selectedVacancy.requirements}
                    </p>
                  </div>
                )}

                {selectedVacancy.responsibility && (
                  <div>
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                      Обязанности:
                    </h4>
                    <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed bg-slate-100/40 dark:bg-slate-800/40 p-3 rounded-xl border border-slate-200 dark:border-slate-700 font-medium">
                      {selectedVacancy.responsibility}
                    </p>
                  </div>
                )}

                {selectedVacancy.url && (
                  <a
                    href={selectedVacancy.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100 transition font-bold"
                  >
                    Посмотреть оригинал вакансии <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}

                <button
                  onClick={onLaunchCourse}
                  className="w-full py-4 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white font-bold rounded-2xl flex items-center justify-center gap-2 shadow-lg transition"
                >
                  <Zap className="w-5 h-5 text-indigo-100 animate-pulse" />
                  🎯 Запустить курс под эту вакансию
                </button>

                <button
                  onClick={() => setActiveTab('chat')}
                  className="w-full py-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold rounded-2xl flex items-center justify-center gap-2 text-sm transition"
                >
                  <MessageSquare className="w-4 h-4" />
                  Спросить ИИ-консультанта
                </button>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-400 dark:text-slate-500 py-12">
                <Briefcase className="w-10 h-10" />
                <p className="text-sm font-semibold text-center">
                  Выберите вакансию из списка для детального анализа
                </p>
                <button
                  onClick={() => setActiveTab('list')}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold"
                >
                  Перейти к списку
                </button>
              </div>
            )}
          </div>
        )}

        {/* CHAT TAB */}
        {activeTab === 'chat' && (
          <div className="absolute inset-0 flex flex-col overflow-hidden">
            <div className="flex-grow overflow-y-auto p-4 space-y-3">
              {vacancyChatMessages.map((msg, mIdx) => (
                <div
                  key={mIdx}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[85%] p-3 rounded-2xl text-xs leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-indigo-600 text-white rounded-br-none'
                        : 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 rounded-bl-none border border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </div>
                </div>
              ))}
              {sendingVacancyChat && (
                <div className="flex justify-start">
                  <div className="bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 p-3 rounded-2xl rounded-tl-none flex items-center gap-2 text-xs border border-slate-200 dark:border-slate-700">
                    <Loader2 className="w-3.5 h-3.5 text-indigo-500 animate-spin" />
                    <span>ИИ анализирует вакансию...</span>
                  </div>
                </div>
              )}
              {vacancyChatMessages.length === 0 && (
                <div className="flex flex-col items-center justify-center py-8 text-center gap-2">
                  <MessageSquare className="w-8 h-8 text-slate-300 dark:text-slate-600" />
                  <p className="text-xs text-slate-400 dark:text-slate-500 font-semibold">
                    Выберите вакансию и задайте вопрос ИИ-консультанту
                  </p>
                </div>
              )}
            </div>

            <div className="p-3 bg-slate-50 dark:bg-slate-900/80 border-t border-slate-200 dark:border-slate-800 flex gap-2 items-center shrink-0">
              <input
                type="text"
                value={vacancyChatInput}
                onChange={(e) => setVacancyChatInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendVacancyChatMessage()}
                placeholder="Задай вопрос по вакансии..."
                className="flex-1 px-3 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
              <button
                onClick={handleSendVacancyChatMessage}
                disabled={sendingVacancyChat || !vacancyChatInput.trim()}
                className="p-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-xl transition"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
