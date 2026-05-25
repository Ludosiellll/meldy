import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Globe, Trophy, Heart, Download, UserCircle2, Loader2, Search, X, CheckCircle2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { getLeaderboard, getPublicMaterials, toggleLike, copyMaterialToLibrary, LeaderboardEntry, PublicMaterial } from '../api/social';
import { searchUsers } from '../api/chat';

export default function SocialHub() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'feed' | 'leaderboard' | 'search'>('feed');

  const [feed, setFeed] = useState<PublicMaterial[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Поиск пользователей
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);

  // Уведомления о копировании
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    if (activeTab === 'feed') {
      getPublicMaterials(user.id).then(data => { setFeed(data); setLoading(false); });
    } else if (activeTab === 'leaderboard') {
      getLeaderboard().then(data => { setLeaderboard(data); setLoading(false); });
    } else {
      setLoading(false);
    }
  }, [user, activeTab]);

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
  }, [searchQuery, user, activeTab]);

  const handleLike = async (m: PublicMaterial) => {
    if (!user) return;
    const isLiked = m.is_liked_by_me;
    setFeed(prev => prev.map(item =>
      item.id === m.id ? { ...item, is_liked_by_me: !isLiked, likes_count: item.likes_count + (isLiked ? -1 : 1) } : item
    ));
    await toggleLike(user.id, m.id, !!isLiked);
  };

  const handleCopy = async (m: PublicMaterial) => {
    if (!user) return;
    const ok = await copyMaterialToLibrary(m.id, user.id);
    if (ok) {
      setCopiedId(m.id);
      setTimeout(() => setCopiedId(null), 3000);
    }
  };

  return (
    <div className="p-8 max-w-5xl mx-auto min-h-[85vh]">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight flex items-center gap-3">
            <Globe className="w-8 h-8 text-indigo-600" />
            Study Network
          </h1>
          <p className="text-slate-500 mt-1">Глобальное сообщество студентов</p>
        </div>

        {/* Табы */}
        <div className="flex bg-slate-200 p-1 rounded-xl">
          {[
            { key: 'feed', label: 'Маркетплейс' },
            { key: 'leaderboard', label: 'Лидерборд' },
            { key: 'search', label: '🔍 Найти' },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as any)}
              className={`px-4 py-2 rounded-lg font-bold text-sm transition-colors ${
                activeTab === tab.key ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
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
              placeholder="Найдите студентов по имени..."
              className="w-full pl-12 pr-4 py-3.5 bg-white border border-slate-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500/50 text-slate-900 shadow-sm"
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
            <p className="text-center text-slate-400 py-10">Никого не найдено по запросу «{searchQuery}»</p>
          )}

          {!searching && searchResults.length === 0 && !searchQuery && (
            <p className="text-center text-slate-400 py-10">Введите имя студента, чтобы найти его</p>
          )}

          <div className="space-y-3">
            {searchResults.map(u => (
              <motion.div
                key={u.id}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm flex items-center gap-4 hover:shadow-md transition-shadow"
              >
                <button onClick={() => navigate(`/profile/${u.id}`)} className="flex items-center gap-4 flex-1 text-left">
                  {u.avatar_url ? (
                    <img src={u.avatar_url} className="w-12 h-12 rounded-full object-cover" alt="avatar" />
                  ) : (
                    <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center">
                      <UserCircle2 className="w-7 h-7 text-slate-400" />
                    </div>
                  )}
                  <div>
                    <div className="font-bold text-slate-900">{u.full_name}</div>
                    {u.university && <div className="text-sm text-slate-500">{u.university}</div>}
                  </div>
                </button>
                <button
                  onClick={() => navigate(`/profile/${u.id}`)}
                  className="px-4 py-2 bg-indigo-50 text-indigo-600 font-bold text-sm rounded-xl hover:bg-indigo-100 transition"
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
          <div className="grid md:grid-cols-2 gap-6">
            {feed.length === 0 ? (
              <div className="col-span-2 text-center py-20 text-slate-500">
                <Globe className="w-12 h-12 text-slate-200 mx-auto mb-4" />
                Пока никто не опубликовал материалы. Откройте свои в Библиотеке!
              </div>
            ) : (
              feed.map((m, i) => (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  key={m.id}
                  className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm hover:shadow-md transition-shadow"
                >
                  <div className="flex items-center mb-4">
                    <button onClick={() => navigate(`/profile/${m.user_id}`)} className="flex items-center gap-3 group flex-1">
                      {m.author_avatar ? (
                        <img src={m.author_avatar} alt="avatar" className="w-10 h-10 rounded-full object-cover" />
                      ) : (
                        <div className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center">
                          <UserCircle2 className="w-6 h-6 text-slate-400" />
                        </div>
                      )}
                      <div className="text-left">
                        <div className="font-bold text-slate-900 group-hover:text-indigo-600 transition-colors text-sm">{m.author_name}</div>
                        <div className="text-xs text-slate-400">{new Date(m.created_at).toLocaleDateString('ru')}</div>
                      </div>
                    </button>
                  </div>

                  <div className="mb-5">
                    <div className="text-xs font-bold text-indigo-500 uppercase tracking-widest mb-1">{m.subject || 'Без предмета'}</div>
                    <h3 className="text-base font-bold text-slate-900 line-clamp-2">{m.title}</h3>
                  </div>

                  <div className="flex items-center justify-between pt-4 border-t border-slate-100">
                    <button
                      onClick={() => handleLike(m)}
                      className={`flex items-center gap-2 font-medium transition-colors text-sm ${
                        m.is_liked_by_me ? 'text-pink-600' : 'text-slate-400 hover:text-pink-600'
                      }`}
                    >
                      <Heart className={`w-4 h-4 ${m.is_liked_by_me ? 'fill-pink-600' : ''}`} />
                      {m.likes_count}
                    </button>

                    {m.user_id !== user?.id && (
                      <button
                        onClick={() => handleCopy(m)}
                        className={`flex items-center gap-2 font-bold text-sm transition-colors px-3 py-1.5 rounded-lg ${
                          copiedId === m.id
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100'
                        }`}
                      >
                        {copiedId === m.id ? (
                          <><CheckCircle2 className="w-4 h-4" /> Сохранено!</>
                        ) : (
                          <><Download className="w-4 h-4" /> Сохранить себе</>
                        )}
                      </button>
                    )}
                  </div>
                </motion.div>
              ))
            )}
          </div>
        ) : (
          /* Лидерборд */
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-slate-200 bg-slate-50">
              <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                <Trophy className="w-6 h-6 text-amber-500" />
                Топ 50 студентов
              </h2>
            </div>
            <div className="divide-y divide-slate-100">
              {leaderboard.length === 0 ? (
                <div className="p-10 text-center text-slate-500">Нет данных для рейтинга.</div>
              ) : (
                leaderboard.map((u, i) => (
                  <div key={u.id} className="p-4 sm:px-6 flex items-center gap-4 hover:bg-slate-50 transition-colors">
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
                        <div className="w-11 h-11 bg-slate-200 rounded-full flex items-center justify-center shadow-sm">
                          <UserCircle2 className="w-6 h-6 text-slate-500" />
                        </div>
                      )}
                      <div>
                        <div className="font-bold text-slate-900 hover:text-indigo-600 transition-colors">{u.full_name}</div>
                        <div className="text-sm font-medium text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md inline-block mt-0.5">
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
    </div>
  );
}
