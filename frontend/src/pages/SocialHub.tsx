import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Globe, Trophy, Heart, Download, UserCircle2, Loader2, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { getLeaderboard, getPublicMaterials, toggleLike, LeaderboardEntry, PublicMaterial } from '../api/social';

export default function SocialHub() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'feed' | 'leaderboard'>('feed');
  
  const [feed, setFeed] = useState<PublicMaterial[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    if (activeTab === 'feed') {
      getPublicMaterials(user.id).then(data => {
        setFeed(data);
        setLoading(false);
      });
    } else {
      getLeaderboard().then(data => {
        setLeaderboard(data);
        setLoading(false);
      });
    }
  }, [user, activeTab]);

  const handleLike = async (m: PublicMaterial) => {
    if (!user) return;
    
    // Оптимистичный UI
    const isLiked = m.is_liked_by_me;
    setFeed(prev => prev.map(item => {
      if (item.id === m.id) {
        return { ...item, is_liked_by_me: !isLiked, likes_count: item.likes_count + (isLiked ? -1 : 1) };
      }
      return item;
    }));

    await toggleLike(user.id, m.id, !!isLiked);
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
          <button
            onClick={() => setActiveTab('feed')}
            className={`px-6 py-2 rounded-lg font-bold text-sm transition-colors ${
              activeTab === 'feed' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Маркетплейс
          </button>
          <button
            onClick={() => setActiveTab('leaderboard')}
            className={`px-6 py-2 rounded-lg font-bold text-sm transition-colors ${
              activeTab === 'leaderboard' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Лидерборд
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
        </div>
      ) : activeTab === 'feed' ? (
        /* Лента (Маркетплейс) */
        <div className="grid md:grid-cols-2 gap-6">
          {feed.length === 0 ? (
            <div className="col-span-2 text-center py-20 text-slate-500">
              Пока никто не опубликовал свои материалы. Будьте первыми!
            </div>
          ) : (
            feed.map((m, i) => (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                key={m.id}
                className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="flex items-center justify-between mb-4">
                  <button onClick={() => navigate(`/profile/${m.user_id}`)} className="flex items-center gap-3 group">
                    {m.author_avatar ? (
                      <img src={m.author_avatar} alt="avatar" className="w-10 h-10 rounded-full object-cover" />
                    ) : (
                      <div className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center">
                        <UserCircle2 className="w-6 h-6 text-slate-400" />
                      </div>
                    )}
                    <div className="text-left">
                      <div className="font-bold text-slate-900 group-hover:text-indigo-600 transition-colors">
                        {m.author_name}
                      </div>
                      <div className="text-xs text-slate-500">
                        {new Date(m.created_at).toLocaleDateString()}
                      </div>
                    </div>
                  </button>
                </div>

                <div className="mb-6">
                  <div className="text-xs font-bold text-indigo-500 uppercase tracking-widest mb-1">{m.subject}</div>
                  <h3 className="text-lg font-bold text-slate-900 line-clamp-2">{m.title}</h3>
                </div>

                <div className="flex items-center justify-between pt-4 border-t border-slate-100">
                  <button 
                    onClick={() => handleLike(m)}
                    className={`flex items-center gap-2 font-medium transition-colors ${
                      m.is_liked_by_me ? 'text-pink-600' : 'text-slate-400 hover:text-pink-600'
                    }`}
                  >
                    <Heart className={`w-5 h-5 ${m.is_liked_by_me ? 'fill-pink-600' : ''}`} />
                    {m.likes_count}
                  </button>
                  <button className="flex items-center gap-2 text-indigo-600 font-bold hover:text-indigo-700 transition-colors">
                    <Download className="w-4 h-4" />
                    Сохранить себе
                  </button>
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
                  <div className={`w-8 font-black text-center ${
                    i === 0 ? 'text-amber-500 text-2xl' : 
                    i === 1 ? 'text-slate-400 text-xl' : 
                    i === 2 ? 'text-amber-700 text-xl' : 'text-slate-400'
                  }`}>
                    #{i + 1}
                  </div>
                  
                  <button onClick={() => navigate(`/profile/${u.id}`)} className="flex items-center gap-3 flex-1 text-left">
                    {u.avatar_url ? (
                      <img src={u.avatar_url} alt="avatar" className="w-12 h-12 rounded-full object-cover shadow-sm" />
                    ) : (
                      <div className="w-12 h-12 bg-slate-200 rounded-full flex items-center justify-center shadow-sm">
                        <UserCircle2 className="w-6 h-6 text-slate-500" />
                      </div>
                    )}
                    <div>
                      <div className="font-bold text-slate-900 text-lg hover:text-indigo-600 transition-colors">{u.full_name}</div>
                      <div className="text-sm font-medium text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md inline-block">
                        {u.total_xp.toLocaleString()} XP
                      </div>
                    </div>
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
