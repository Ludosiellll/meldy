import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Globe, Trophy, Heart, Download, UserCircle2, Loader2, Search, X, CheckCircle2, Eye, FileText, Layers } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { getLeaderboard, getPublicMaterials, toggleLike, copyMaterialToLibrary, getPublicMaterialPreview, LeaderboardEntry, PublicMaterial } from '../api/social';
import { getMaterials } from '../api/materials';
import { searchUsers } from '../api/chat';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

export default function SocialHub() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'feed' | 'leaderboard' | 'search'>('feed');

  const [feed, setFeed] = useState<PublicMaterial[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [myMaterials, setMyMaterials] = useState<any[]>([]);

  // Поиск пользователей
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);

  // Уведомления о копировании
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Предпросмотр
  const [previewMaterial, setPreviewMaterial] = useState<PublicMaterial | null>(null);
  const [previewData, setPreviewData] = useState<any>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    getMaterials(user.id).then(setMyMaterials);
    if (activeTab === 'feed') {
      getPublicMaterials(user.id).then(data => { setFeed(data); setLoading(false); });
    } else if (activeTab === 'leaderboard') {
      getLeaderboard().then(data => { setLeaderboard(data); setLoading(false); });
    } else {
      setLoading(false);
    }
  }, [user?.id, activeTab]);

  // Поиск с дебаунсом
  useEffect(() => {
    if (!user || activeTab !== 'search') return;
    if (!searchQuery.trim()) { setSearchResults([]); return; }
    const timer = setTimeout(async () => {
      setSearching(true);
      const results = await searchUsers(searchQuery, user.id);
      setSearchResults(results);
      setSearching(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, user?.id, activeTab]);

  const handleLike = async (m: PublicMaterial) => {
    if (!user) return;
    const isLiked = m.is_liked_by_me;
    setFeed(prev => prev.map(item =>
      item.id === m.id ? { ...item, is_liked_by_me: !isLiked, likes_count: item.likes_count + (isLiked ? -1 : 1) } : item
    ));
    const saved = await toggleLike(m.id, !!isLiked);
    if (!saved) {
      setFeed(prev => prev.map(item => item.id === m.id ? {
        ...item,
        is_liked_by_me: !!isLiked,
        likes_count: Math.max(0, item.likes_count + (isLiked ? 1 : -1)),
      } : item));
    }
  };

  const handleCopy = async (m: PublicMaterial) => {
    if (!user) return;
    const ok = await copyMaterialToLibrary(m.id, user.id);
    if (ok) {
      setCopiedId(m.id);
      setTimeout(() => setCopiedId(null), 3000);
    }
  };

  const handlePreview = async (m: PublicMaterial) => {
    setPreviewMaterial(m);
    setPreviewData(null);
    setPreviewLoading(true);
    const data = await getPublicMaterialPreview(m.id);
    setPreviewData(data);
    setPreviewLoading(false);
  };

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto min-h-[85vh]">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-900 dark:text-slate-100 tracking-tight flex items-center gap-3">
            <Globe className="w-8 h-8 text-indigo-600" />
            Study Network
          </h1>
          <p className="text-slate-500 dark:text-slate-400 mt-1">Глобальное сообщество студентов</p>
        </div>

        {/* Табы */}
        <div className="flex bg-slate-200/60 dark:bg-slate-950 p-1 rounded-2xl border border-slate-300/20 dark:border-slate-800/60 overflow-x-auto custom-scrollbar w-full sm:w-auto shrink-0">
          {[
            { key: 'feed', label: 'Маркетплейс' },
            { key: 'leaderboard', label: 'Лидерборд' },
            { key: 'search', label: '🔍 Найти' },
          ].map(tab => {
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key as any)}
                className={`relative flex-1 sm:flex-none text-center px-5 py-2 rounded-xl font-bold text-sm transition-colors duration-200 whitespace-nowrap select-none ${
                  isActive
                    ? 'text-indigo-600 dark:text-indigo-400'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                }`}
              >
                {isActive && (
                  <motion.span
                    layoutId="activeSocialTab"
                    className="absolute inset-0 bg-white dark:bg-slate-850 rounded-xl shadow-md -z-10"
                    transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                  />
                )}
                <span className="relative z-10">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Поиск пользователей ── */}
      {activeTab === 'search' && (
        <div>
          <div className="relative mb-6">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Найдите студентов по имени или #ID..."
              className="w-full pl-12 pr-4 py-3.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500/50 text-slate-900 dark:text-slate-100 shadow-sm"
              autoFocus
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {searching && <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 text-indigo-500 animate-spin" /></div>}

          {!searching && searchResults.length === 0 && searchQuery && (
            <p className="text-center text-slate-400 dark:text-slate-505 py-10">Никого не найдено по запросу «{searchQuery}»</p>
          )}

          {!searching && searchResults.length === 0 && !searchQuery && (
            <p className="text-center text-slate-400 dark:text-slate-505 py-10">Введите имя студента, чтобы найти его</p>
          )}

          <div className="space-y-3">
            {searchResults.map(u => (
              <motion.div
                key={u.id}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm flex items-center gap-4 hover:shadow-md transition-shadow"
              >
                <button onClick={() => navigate(`/profile/${u.id}`)} className="flex items-center gap-4 flex-1 text-left">
                  {u.avatar_url ? (
                    <img src={u.avatar_url} className="w-12 h-12 rounded-full object-cover" alt="avatar" />
                  ) : (
                    <div className="w-12 h-12 bg-slate-100 dark:bg-slate-850 rounded-full flex items-center justify-center">
                      <UserCircle2 className="w-7 h-7 text-slate-400" />
                    </div>
                  )}
                  <div>
                    <div className="font-bold text-slate-900 dark:text-slate-100">{u.full_name}</div>
                    {u.public_id && <div className="text-xs font-mono text-indigo-500 font-bold mb-0.5">#{u.public_id}</div>}
                    {u.university && <div className="text-sm text-slate-500 dark:text-slate-400">{u.university}</div>}
                  </div>
                </button>
                <button
                  onClick={() => navigate(`/profile/${u.id}`)}
                  className="px-4 py-2 bg-indigo-50 dark:bg-indigo-950/30 text-indigo-600 dark:text-indigo-400 font-bold text-sm rounded-xl hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition"
                >
                  Профиль →
                </button>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {/* ── Лента / Лидерборд ── */}
      {activeTab !== 'search' && (
        loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
          </div>
        ) : activeTab === 'feed' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
            {feed.length === 0 ? (
              <div className="col-span-2 text-center py-20 text-slate-500 dark:text-slate-400">
                <Globe className="w-12 h-12 text-slate-200 dark:text-slate-700 mx-auto mb-4" />
                Пока никто не опубликовал материалы. Откройте свои в Библиотеке!
              </div>
            ) : (
              feed.map((m, i) => (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  key={m.id}
                  className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition-shadow"
                >
                  <div className="flex items-center mb-4">
                    <button onClick={() => navigate(`/profile/${m.user_id}`)} className="flex items-center gap-3 group flex-1">
                      {m.author_avatar ? (
                        <img src={m.author_avatar} alt="avatar" className="w-10 h-10 rounded-full object-cover" />
                      ) : (
                        <div className="w-10 h-10 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center">
                          <UserCircle2 className="w-6 h-6 text-slate-400" />
                        </div>
                      )}
                      <div className="text-left">
                        <div className="font-bold text-slate-900 dark:text-slate-100 group-hover:text-indigo-600 transition-colors text-sm">{m.author_name}</div>
                        <div className="text-xs text-slate-400 dark:text-slate-500">{new Date(m.created_at).toLocaleDateString('ru')}</div>
                      </div>
                    </button>
                  </div>

                  <div className="mb-5">
                    <div className="text-xs font-bold text-indigo-500 dark:text-indigo-400 uppercase tracking-widest mb-1">{m.subject || 'Без предмета'}</div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 line-clamp-2 break-words">{m.title}</h3>
                  </div>

                  <div className="flex items-center justify-between pt-4 border-t border-slate-100 dark:border-slate-800/60">
                    <button
                      onClick={() => handleLike(m)}
                      className={`flex items-center gap-2 font-medium transition-colors text-sm ${
                        m.is_liked_by_me ? 'text-pink-600' : 'text-slate-400 hover:text-pink-600'
                      }`}
                    >
                      <Heart className={`w-4 h-4 ${m.is_liked_by_me ? 'fill-pink-600' : ''}`} />
                      {m.likes_count}
                    </button>

                    {String(m.user_id) !== String(user?.id) && (
                      <div className="flex flex-col xl:flex-row gap-2 items-stretch xl:items-center w-full sm:w-auto">
                        <button
                          onClick={() => handlePreview(m)}
                          className="flex items-center justify-center gap-2 font-bold text-sm transition-colors px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
                        >
                          <Eye className="w-4 h-4" /> <span>Предпросмотр</span>
                        </button>
                        <button
                          onClick={() => handleCopy(m)}
                          disabled={copiedId === m.id || myMaterials.some(my => my.title === m.title + ' (копия)')}
                          className={`flex items-center justify-center gap-2 font-bold text-sm transition-colors px-3 py-1.5 rounded-lg ${
                            (copiedId === m.id || myMaterials.some(my => my.title === m.title + ' (копия)'))
                              ? 'bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400'
                              : 'bg-indigo-600 dark:bg-indigo-700 text-white hover:bg-indigo-700 dark:hover:bg-indigo-600'
                          }`}
                        >
                          {(copiedId === m.id || myMaterials.some(my => my.title === m.title + ' (копия)')) ? (
                            <><CheckCircle2 className="w-4 h-4" /> Сохранено!</>
                          ) : (
                            <><Download className="w-4 h-4" /> <span>Сохранить</span></>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                </motion.div>
              ))
            )}
          </div>
        ) : (
          /* Лидерборд */
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/30">
              <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Trophy className="w-6 h-6 text-amber-500" />
                Топ 50 студентов
              </h2>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {leaderboard.length === 0 ? (
                <div className="p-10 text-center text-slate-500 dark:text-slate-400">Нет данных для рейтинга.</div>
              ) : (
                leaderboard.map((u, i) => (
                  <div key={u.id} className="p-4 sm:px-6 flex items-center gap-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                    <div className={`w-8 font-black text-center shrink-0 ${
                      i === 0 ? 'text-amber-500 text-2xl' :
                      i === 1 ? 'text-slate-400 text-xl' :
                      i === 2 ? 'text-amber-700 text-xl' : 'text-slate-300 text-base'
                    }`}>
                      {i < 3 ? ['🥇','🥈','🥉'][i] : `#${i+1}`}
                    </div>
                    <button onClick={() => navigate(`/profile/${u.id}`)} className="flex items-center gap-3 flex-1 text-left">
                      {u.avatar_url ? (
                        <img src={u.avatar_url} alt="avatar" className="w-11 h-11 rounded-full object-cover shadow-sm" />
                      ) : (
                        <div className="w-11 h-11 bg-slate-200 dark:bg-slate-800 rounded-full flex items-center justify-center shadow-sm">
                          <UserCircle2 className="w-6 h-6 text-slate-500 dark:text-slate-400" />
                        </div>
                      )}
                      <div>
                        <div className="font-bold text-slate-900 dark:text-slate-100 hover:text-indigo-600 transition-colors">{u.full_name}</div>
                        <div className="text-sm font-medium text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/30 px-2 py-0.5 rounded-md inline-block mt-0.5">
                          {u.total_xp.toLocaleString()} XP
                        </div>
                      </div>
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )
      )}

      {/* Модалка предпросмотра */}
      <AnimatePresence>
        {previewMaterial && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setPreviewMaterial(null)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="relative w-[calc(100%-32px)] md:w-full max-w-3xl bg-white dark:bg-slate-900 rounded-3xl p-6 shadow-2xl border border-slate-100 dark:border-slate-800 max-h-[90vh] flex flex-col"
            >
              <div className="flex items-start justify-between mb-4 border-b border-slate-100 dark:border-slate-800 pb-4">
                <div>
                  <div className="text-xs font-bold text-indigo-500 dark:text-indigo-400 uppercase tracking-widest mb-1">
                    {previewMaterial.subject || 'Без предмета'}
                  </div>
                  <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100 break-words line-clamp-3">{previewMaterial.title}</h3>
                  <div className="text-sm text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-2">
                    <UserCircle2 className="w-4 h-4" /> Автор: {previewMaterial.author_name}
                  </div>
                </div>
                <button
                  onClick={() => setPreviewMaterial(null)}
                  className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition text-slate-400"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-6">
                {previewLoading ? (
                  <div className="flex flex-col items-center justify-center py-20 text-slate-500 dark:text-slate-400">
                    <Loader2 className="w-8 h-8 text-indigo-500 animate-spin mb-4" />
                    <p>Загрузка данных для предпросмотра...</p>
                  </div>
                ) : previewData ? (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 flex items-center gap-3">
                        <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-950/30 text-indigo-600 dark:text-indigo-400 rounded-xl flex items-center justify-center">
                          <Layers className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">Карточки</p>
                          <p className="text-lg font-bold text-slate-900 dark:text-slate-100">
                            {previewData.flashcards_json?.flashcards?.length || 0} шт.
                          </p>
                        </div>
                      </div>
                      <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 flex items-center gap-3">
                        <div className="w-10 h-10 bg-rose-100 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 rounded-xl flex items-center justify-center">
                          <FileText className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">Тесты</p>
                          <p className="text-lg font-bold text-slate-900 dark:text-slate-100">
                            {previewData.quiz_json?.quiz?.length || 0} шт.
                          </p>
                        </div>
                      </div>
                    </div>

                    {previewData.summary_json && (
                      <div className="bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800 rounded-2xl p-5">
                        <h4 className="font-bold text-slate-900 dark:text-slate-100 mb-4 flex items-center gap-2">
                          <Eye className="w-5 h-5 text-indigo-500" /> Отрывок конспекта
                        </h4>
                        <div className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed markdown-content max-h-64 overflow-y-hidden relative">
                          <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                            {typeof previewData.summary_json === 'string' 
                              ? previewData.summary_json.slice(0, 500) + '...'
                              : (previewData.summary_json.content?.slice(0, 500) || '') + '...'}
                          </ReactMarkdown>
                          <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-slate-50 dark:from-slate-950 to-transparent pointer-events-none" />
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-center py-10 text-slate-500 dark:text-slate-400">
                    Не удалось загрузить данные
                  </div>
                )}
              </div>

              <div className="mt-6 pt-4 border-t border-slate-100 dark:border-slate-800/80 flex gap-3">
                <button
                  onClick={() => setPreviewMaterial(null)}
                  className="flex-1 py-3 px-4 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl font-bold transition flex items-center justify-center gap-2"
                >
                  Закрыть
                </button>
                <button
                  onClick={() => {
                    if (!(copiedId === previewMaterial.id || myMaterials.some(my => my.title === previewMaterial.title + ' (копия)'))) {
                      handleCopy(previewMaterial);
                      setPreviewMaterial(null);
                    }
                  }}
                  disabled={copiedId === previewMaterial.id || myMaterials.some(my => my.title === previewMaterial.title + ' (копия)')}
                  className={`flex-1 py-3 px-4 rounded-xl font-bold transition flex items-center justify-center gap-2 ${
                    (copiedId === previewMaterial.id || myMaterials.some(my => my.title === previewMaterial.title + ' (копия)'))
                      ? 'bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400'
                      : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-100'
                  }`}
                >
                  {(copiedId === previewMaterial.id || myMaterials.some(my => my.title === previewMaterial.title + ' (копия)')) ? (
                    <><CheckCircle2 className="w-5 h-5" /> Сохранено!</>
                  ) : (
                    <><Download className="w-5 h-5" /> Сохранить себе</>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
