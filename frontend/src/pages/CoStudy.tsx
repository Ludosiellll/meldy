import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, BookOpen, Send, Users, Play, Square, MessageSquare, Clock, Heart, Volume2, ShieldAlert, Share2, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { getProfile } from '../api/social';
import SummaryView from '../components/SummaryView';
import { format } from 'date-fns';
import { CustomSelect } from '../components/CustomSelect';
import { getFriends, Friendship, sendMessage } from '../api/chat';

interface Message {
  id: string;
  sender_name: string;
  sender_avatar?: string;
  sender_id: string;
  content: string;
  created_at: string;
}

interface PresenceUser {
  user_id: string;
  name: string;
  avatar?: string;
  status: string;
}

export default function CoStudy() {
  const { id: materialId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  
  const [material, setMaterial] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageInput, setMessageInput] = useState('');
  
  // Presence (кто в комнате)
  const [onlineUsers, setOnlineUsers] = useState<PresenceUser[]>([]);
  const [myStatus, setMyStatus] = useState('Изучает конспект');
  const [roomProfiles, setRoomProfiles] = useState<Record<string, any>>({});
  const [hoveredUser, setHoveredUser] = useState<string | null>(null);
  const [hoverPosition, setHoverPosition] = useState({ x: 0, y: 0 });

  // Pomodoro таймер
  const [timerSeconds, setTimerSeconds] = useState(25 * 60);
  const [timerActive, setTimerActive] = useState(false);
  const [timerDuration, setTimerDuration] = useState(25 * 60);
  
  // Загрузки
  const [loading, setLoading] = useState(true);
  
  // Приглашения
  const [friends, setFriends] = useState<Friendship[]>([]);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteLoading, setInviteLoading] = useState<string | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const coChannelRef = useRef<any>(null);
  const timerEndTimeRef = useRef<number | null>(null);

  // 1. Загрузка материала и профиля
  useEffect(() => {
    if (!materialId || !user) return;
    
    setLoading(true);
    Promise.all([
      supabase.from('materials').select('*').eq('id', materialId).single(),
      getProfile(user.id),
      // Загрузка сообщений чата из базы
      supabase
        .from('co_study_messages')
        .select('*')
        .eq('material_id', materialId)
        .order('created_at', { ascending: true })
        .limit(50),
      getFriends(user.id)
    ]).then(([matRes, profRes, msgRes, friendsRes]) => {
      if (matRes.data) setMaterial(matRes.data);
      if (profRes) setProfile(profRes);
      if (msgRes.data) setMessages(msgRes.data);
      if (friendsRes) setFriends(friendsRes.filter(f => f.status === 'accepted'));
      setLoading(false);
    }).catch(err => {
      console.error(err);
      setLoading(false);
    });
  }, [materialId, user?.id]);

  // Скролл чата
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Звуковой сигнал по окончании таймера
  const playAlarmSound = () => {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = audioContextRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime); // нота Ля
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 1.2);
    } catch (e) {
      console.warn('Audio Context failed:', e);
    }
  };

  // 2. Локальное восстановление таймера из localStorage
  useEffect(() => {
    if (!materialId) return;
    const savedEnd = localStorage.getItem(`co_timer_end_${materialId}`);
    const savedDur = localStorage.getItem(`co_timer_dur_${materialId}`);
    if (savedEnd && savedDur) {
      const endTime = parseInt(savedEnd, 10);
      const duration = parseInt(savedDur, 10);
      if (endTime > Date.now()) {
        timerEndTimeRef.current = endTime;
        setTimerDuration(duration);
        setTimerSeconds(Math.max(0, Math.floor((endTime - Date.now()) / 1000)));
        setTimerActive(true);
      }
    }
  }, [materialId]);

  // Загрузка профилей для мини-карточек
  useEffect(() => {
    const missing = onlineUsers.filter(u => !roomProfiles[u.user_id]);
    if (missing.length > 0) {
      missing.forEach(async u => {
        const p = await getProfile(u.user_id);
        if (p) {
          setRoomProfiles(prev => ({ ...prev, [u.user_id]: p }));
        }
      });
    }
  }, [onlineUsers, roomProfiles]);

  // 3. Реализация Supabase Realtime (Presence + Broadcast + DB Changes)
  useEffect(() => {
    if (!materialId || !user || !profile) return;

    // A) Канал для Presence и Broadcast (Таймер Pomodoro и т.д.)
    const coChannel = supabase.channel(`co_room_${materialId}`, {
      config: { presence: { key: user.id } }
    });

    coChannelRef.current = coChannel;

    coChannel
      .on('presence', { event: 'sync' }, () => {
        const state = coChannel.presenceState();
        const users: PresenceUser[] = [];
        Object.keys(state).forEach(key => {
          const presenceList = state[key] as any;
          if (presenceList && presenceList.length > 0) {
            users.push({
              user_id: key,
              name: presenceList[0].name || 'Студент',
              avatar: presenceList[0].avatar,
              status: presenceList[0].status || 'Учится'
            });
          }
        });
        setOnlineUsers(users);
      })
      // Прослушивание синхронизации таймера
      .on('broadcast', { event: 'timer' }, ({ payload }) => {
        if (payload.action === 'start') {
          const remaining = payload.remaining || payload.duration;
          const endTime = Date.now() + remaining * 1000;
          timerEndTimeRef.current = endTime;
          setTimerDuration(payload.duration);
          setTimerActive(true);
          // Сохраняем локально на случай перезагрузки
          localStorage.setItem(`co_timer_end_${materialId}`, endTime.toString());
          localStorage.setItem(`co_timer_dur_${materialId}`, payload.duration.toString());
        } else if (payload.action === 'stop') {
          setTimerActive(false);
          timerEndTimeRef.current = null;
          localStorage.removeItem(`co_timer_end_${materialId}`);
        } else if (payload.action === 'reset') {
          setTimerActive(false);
          timerEndTimeRef.current = null;
          localStorage.removeItem(`co_timer_end_${materialId}`);
          setTimerSeconds(payload.duration);
        } else if (payload.action === 'sync_request') {
          // Если у нас запущен таймер, отправляем его данные новому участнику
          if (timerEndTimeRef.current && timerEndTimeRef.current > Date.now()) {
            const remaining = Math.floor((timerEndTimeRef.current - Date.now()) / 1000);
            coChannel.send({
              type: 'broadcast',
              event: 'timer',
              payload: {
                action: 'sync_response',
                duration: timerDuration,
                remaining
              }
            });
          }
        } else if (payload.action === 'sync_response') {
          const remaining = payload.remaining;
          if (remaining && remaining > 0) {
            const endTime = Date.now() + remaining * 1000;
            timerEndTimeRef.current = endTime;
            setTimerDuration(payload.duration);
            setTimerActive(true);
            localStorage.setItem(`co_timer_end_${materialId}`, endTime.toString());
            localStorage.setItem(`co_timer_dur_${materialId}`, payload.duration.toString());
          }
        }
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          // Запрашиваем состояние таймера у присутствующих
          coChannel.send({
            type: 'broadcast',
            event: 'timer',
            payload: { action: 'sync_request' }
          });

          await coChannel.track({
            user_id: user.id,
            name: profile.full_name || 'Студент',
            avatar: profile.avatar_url,
            status: myStatus
          });
        }
      });

    // B) Канал для прослушивания новых сообщений чата (Insert в таблицу)
    const msgChannel = supabase
      .channel(`db_messages_${materialId}`)
      .on('postgres_changes', { 
        event: 'INSERT', 
        schema: 'public', 
        table: 'co_study_messages', 
        filter: `material_id=eq.${materialId}` 
      }, (payload) => {
        const newMsg = payload.new as Message;
        setMessages(prev => {
          if (prev.some(m => m.id === newMsg.id)) return prev;
          return [...prev, newMsg];
        });
      })
      .subscribe();

    // Слушатель для alt+tab и восстановления фокуса (для обновления присутствия)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && coChannelRef.current) {
        coChannelRef.current.track({
          user_id: user.id,
          name: profile.full_name || 'Студент',
          avatar: profile.avatar_url,
          status: myStatusRef.current
        });
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      coChannel.untrack();
      supabase.removeChannel(coChannel);
      supabase.removeChannel(msgChannel);
    };
  }, [materialId, user?.id, profile]);

  const myStatusRef = useRef(myStatus);
  useEffect(() => {
    myStatusRef.current = myStatus;
  }, [myStatus]);

  // Обновление статуса Presence локально и на сервере
  const handleUpdateStatus = async (status: string) => {
    setMyStatus(status);
    setOnlineUsers(prev => prev.map(u => u.user_id === user?.id ? { ...u, status } : u));
    
    if (coChannelRef.current && user && profile) {
      await coChannelRef.current.track({
        user_id: user.id,
        name: profile.full_name || 'Студент',
        avatar: profile.avatar_url,
        status: status
      });
    }
  };

  // 4. Работа с Pomodoro-таймером локально (вычисление по endTime для борьбы с дрейфом в фоне)
  useEffect(() => {
    let interval: any = null;
    if (timerActive && timerEndTimeRef.current) {
      interval = setInterval(() => {
        const remaining = Math.max(0, Math.floor((timerEndTimeRef.current! - Date.now()) / 1000));
        setTimerSeconds(remaining);
        if (remaining <= 0) {
          setTimerActive(false);
          timerEndTimeRef.current = null;
          localStorage.removeItem(`co_timer_end_${materialId}`);
          playAlarmSound();
          clearInterval(interval);
        }
      }, 500);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [timerActive, materialId]);

  const handleStartTimer = (durationMins: number) => {
    const duration = durationMins * 60;
    const endTime = Date.now() + duration * 1000;
    
    if (coChannelRef.current) {
      coChannelRef.current.send({
        type: 'broadcast',
        event: 'timer',
        payload: { action: 'start', duration, remaining: duration }
      });
    }

    timerEndTimeRef.current = endTime;
    setTimerDuration(duration);
    setTimerSeconds(duration);
    setTimerActive(true);
    localStorage.setItem(`co_timer_end_${materialId}`, endTime.toString());
    localStorage.setItem(`co_timer_dur_${materialId}`, duration.toString());
  };

  const handleStopTimer = () => {
    if (coChannelRef.current) {
      coChannelRef.current.send({
        type: 'broadcast',
        event: 'timer',
        payload: { action: 'stop' }
      });
    }
    setTimerActive(false);
    timerEndTimeRef.current = null;
    localStorage.removeItem(`co_timer_end_${materialId}`);
  };

  const handleResetTimer = () => {
    const duration = 25 * 60;
    if (coChannelRef.current) {
      coChannelRef.current.send({
        type: 'broadcast',
        event: 'timer',
        payload: { action: 'reset', duration }
      });
    }
    setTimerActive(false);
    timerEndTimeRef.current = null;
    localStorage.removeItem(`co_timer_end_${materialId}`);
    setTimerSeconds(duration);
  };


  // 4. Отправка сообщений чата в базу данных
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageInput.trim() || !user || !profile || !materialId) return;

    const text = messageInput.trim();
    setMessageInput('');

    try {
      const { data, error } = await supabase
        .from('co_study_messages')
        .insert({
          material_id: materialId,
          sender_id: user.id,
          sender_name: profile.full_name || 'Студент',
          sender_avatar: profile.avatar_url,
          content: text
        })
        .select()
        .single();
        
      if (error) throw error;
      
      // Добавляем к себе локально (на случай если триггер realtime сработает медленнее)
      const newMsg = data as Message;
      setMessages(prev => {
        if (prev.some(m => m.id === newMsg.id)) return prev;
        return [...prev, newMsg];
      });
    } catch (err) {
      console.error('Failed to send message:', err);
    }
  };

  // Форматирование времени таймера
  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // Отправка приглашения в личку
  const handleSendInvite = async (friendId: string) => {
    if (!user || !materialId || !material) return;
    setInviteLoading(friendId);
    
    const inviteLink = `${window.location.origin}/co-study/${materialId}`;
    const text = `👋 Привет! Присоединяйся ко мне в совместную комнату для изучения материала «${material.title}»: ${inviteLink}`;
    
    const msg = await sendMessage(user.id, friendId, text);
    if (msg) {
      toast.success('Приглашение отправлено!');
    } else {
      toast.error('Ошибка при отправке приглашения');
    }
    setInviteLoading(null);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[80vh]">
        <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-slate-500 dark:text-slate-400 font-medium">Подключение к учебной комнате...</p>
      </div>
    );
  }

  if (!material) {
    return (
      <div className="p-8 text-center">
        <ShieldAlert className="w-12 h-12 text-rose-500 mx-auto mb-3" />
        <p className="text-slate-700 dark:text-slate-300 font-bold mb-4">Материал не найден</p>
        <button onClick={() => navigate('/library')} className="px-4 py-2 bg-indigo-600 text-white rounded-xl">← В библиотеку</button>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto min-h-screen relative">
      {/* МИНИ ПРОФИЛЬ ПРИ НАВЕДЕНИИ */}
      {hoveredUser && roomProfiles[hoveredUser] && (
        <div 
          className="fixed z-50 w-64 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl p-4 pointer-events-none transform -translate-y-1/2"
          style={{ left: hoverPosition.x, top: hoverPosition.y }}
        >
          <div className="flex items-center gap-3 mb-3">
            {roomProfiles[hoveredUser].avatar_url ? (
              <img src={roomProfiles[hoveredUser].avatar_url} alt="avatar" className="w-12 h-12 rounded-full object-cover shadow-sm" />
            ) : (
              <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center font-bold text-slate-500">
                {roomProfiles[hoveredUser].full_name?.[0]}
              </div>
            )}
            <div>
              <div className="font-bold text-slate-900 dark:text-slate-100 line-clamp-1">{roomProfiles[hoveredUser].full_name}</div>
              {roomProfiles[hoveredUser].public_id && (
                <div className="text-xs font-mono text-indigo-500 font-bold">#{roomProfiles[hoveredUser].public_id}</div>
              )}
            </div>
          </div>
          {roomProfiles[hoveredUser].university && (
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-2 bg-slate-50 dark:bg-slate-900/50 p-2 rounded-lg">
              🎓 {roomProfiles[hoveredUser].university}
            </div>
          )}
        </div>
      )}

      {/* HEADER */}
      <div className="flex items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(`/library/${materialId}`)}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 text-[10px] font-bold rounded-lg uppercase tracking-wider">
                Совместная комната
              </span>
              <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
            </div>
            <h1 className="text-xl md:text-2xl font-extrabold text-slate-900 dark:text-slate-100 tracking-tight mt-1">
              {material.title}
            </h1>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowInviteModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 font-bold rounded-xl hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition shrink-0"
          >
            <Share2 className="w-4 h-4" />
            <span className="hidden sm:inline">Пригласить друга</span>
          </button>
        </div>
      </div>

      {showInviteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 w-full max-w-md border border-slate-200 dark:border-slate-800 shadow-2xl">
            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-4">Пригласить друга</h3>
            
            <div className="max-h-64 overflow-y-auto custom-scrollbar space-y-2 mb-6">
              {friends.length === 0 ? (
                <p className="text-slate-500 dark:text-slate-400 text-center py-4">У вас пока нет друзей. Добавьте их в Social Hub!</p>
              ) : (
                friends.map(f => (
                  <div key={f.id} className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50">
                    <div className="flex items-center gap-3">
                      {f.friend_avatar ? (
                        <img src={f.friend_avatar} alt="avatar" className="w-10 h-10 rounded-full object-cover" />
                      ) : (
                        <div className="w-10 h-10 bg-slate-200 dark:bg-slate-700 rounded-full flex items-center justify-center">
                          <span className="text-slate-500 dark:text-slate-400 font-bold">{f.friend_name?.[0]}</span>
                        </div>
                      )}
                      <span className="font-bold text-slate-700 dark:text-slate-200">{f.friend_name}</span>
                    </div>
                    <button
                      onClick={() => handleSendInvite(f.friend_id!)}
                      disabled={inviteLoading === f.friend_id}
                      className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-bold disabled:opacity-50 transition"
                    >
                      {inviteLoading === f.friend_id ? 'Отправка...' : 'Отправить'}
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex justify-between items-center gap-2">
              <button 
                onClick={() => {
                  navigator.clipboard.writeText(window.location.href);
                  toast.success('Ссылка скопирована!');
                }}
                className="text-sm font-bold text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 px-4 py-2"
              >
                Копировать ссылку
              </button>
              <button 
                onClick={() => setShowInviteModal(false)}
                className="px-5 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold rounded-xl transition"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* LEFT COLUMN: MATERIAL STUDY + POMODORO */}
        <div className="lg:col-span-2 space-y-6">
          {/* Pomodoro Timer widget */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-3xl p-6 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-6 relative overflow-hidden">
            <div className="absolute top-0 left-0 bottom-0 w-2 bg-indigo-500" />
            
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 rounded-2xl flex items-center justify-center shadow-inner">
                <Clock className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-extrabold text-slate-800 dark:text-slate-100 text-base">Совместный Pomodoro</h3>
                <p className="text-xs text-slate-400 dark:text-slate-500 max-w-xs mt-0.5">
                  Синхронный таймер фокусировки для совместного заучивания карточек или конспекта.
                </p>
              </div>
            </div>

            <div className="flex flex-col items-center sm:items-end gap-3 shrink-0">
              <div className="flex items-center gap-3">
                <span className="text-3xl font-black text-slate-800 dark:text-slate-100 font-mono tracking-wider">
                  {formatTime(timerSeconds)}
                </span>
                
                {timerActive ? (
                  <button
                    onClick={handleStopTimer}
                    className="p-2 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-950/60 text-rose-600 dark:text-rose-400 rounded-xl transition"
                    title="Приостановить таймер"
                  >
                    <Square className="w-4 h-4 fill-rose-600 dark:fill-rose-400" />
                  </button>
                ) : (
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => handleStartTimer(25)}
                      className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition shadow-sm shadow-indigo-100"
                    >
                      <Play className="w-3.5 h-3.5 fill-white" />
                      25 мин
                    </button>
                    <button
                      onClick={() => handleStartTimer(15)}
                      className="px-2.5 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl text-xs font-bold transition"
                    >
                      15 мин
                    </button>
                  </div>
                )}
                
                <button
                  onClick={handleResetTimer}
                  className="px-2.5 py-1.5 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-xl text-xs font-bold transition"
                >
                  Сбросить
                </button>
              </div>
              
              {timerActive && (
                <div className="w-full sm:w-44 h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-indigo-500 transition-all duration-1000"
                    style={{ width: `${(timerSeconds / timerDuration) * 100}%` }}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Material summary document */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-3xl p-6 shadow-sm space-y-4">
            <div className="flex items-center gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
              <BookOpen className="w-5 h-5 text-indigo-500" />
              <h2 className="font-extrabold text-slate-800 dark:text-slate-100 text-lg">Совместное изучение конспекта</h2>
            </div>
            
            <div className="overflow-y-auto max-h-[60vh] pr-2 custom-scrollbar">
              {material.summary_json ? (
                <SummaryView data={material.summary_json} />
              ) : (
                <p className="text-slate-400 italic">Конспект пуст или не найден.</p>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: PRESENCE & CHAT MESSAGE PANEL */}
        <div className="space-y-6">
          
          {/* Online Users Presence */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-3xl p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-emerald-500" />
                <h3 className="font-extrabold text-slate-800 dark:text-slate-100 text-sm">В комнате ({onlineUsers.length})</h3>
              </div>
            </div>

            <div className="space-y-3 max-h-[180px] overflow-y-auto custom-scrollbar">
              {onlineUsers.map(u => (
                <div key={u.user_id} className="flex items-center justify-between gap-3 text-xs">
                  <div 
                    className="flex items-center gap-2.5 min-w-0 cursor-pointer group"
                    onMouseEnter={(e) => { 
                      setHoveredUser(u.user_id);
                      const rect = e.currentTarget.getBoundingClientRect();
                      setHoverPosition({ x: rect.left - 270, y: rect.top + rect.height / 2 });
                    }} 
                    onMouseLeave={() => setHoveredUser(null)}
                    onClick={() => navigate(`/profile/${u.user_id}`)}
                  >
                    <div className="relative">
                      {u.avatar ? (
                        <img src={u.avatar} alt="avatar" className="w-8 h-8 rounded-full object-cover border border-slate-100 dark:border-slate-700 group-hover:ring-2 ring-indigo-500 transition-all" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center font-bold text-slate-500 dark:text-slate-400 group-hover:ring-2 ring-indigo-500 transition-all">
                          {u.name?.[0] || '?'}
                        </div>
                      )}
                      <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-500 border-2 border-white dark:border-slate-900 rounded-full" />
                    </div>
                    <span className="font-bold text-slate-700 dark:text-slate-200 truncate group-hover:text-indigo-500 transition-colors">{u.name}</span>
                  </div>
                  <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 bg-slate-50 dark:bg-slate-800 px-2 py-0.5 rounded-md">
                    {u.status}
                  </span>
                </div>
              ))}
            </div>

            <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
              {myStatus !== 'Изучил конспект ✅' ? (
                <button 
                  onClick={() => handleUpdateStatus('Изучил конспект ✅')} 
                  className="w-full py-2 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 font-bold text-xs rounded-xl hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition flex items-center justify-center gap-1.5"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  Отметить как прочитанное
                </button>
              ) : (
                <button 
                  onClick={() => handleUpdateStatus('Изучает конспект')} 
                  className="w-full py-2 bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-bold text-xs rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 transition"
                >
                  Вернуться к изучению
                </button>
              )}
            </div>
          </div>

          {/* Realtime Chat */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-3xl p-5 shadow-sm h-[400px] flex flex-col">
            <div className="flex items-center gap-2 pb-3 border-b border-slate-100 dark:border-slate-800 mb-3 shrink-0">
              <MessageSquare className="w-4 h-4 text-indigo-500" />
              <h3 className="font-extrabold text-slate-800 dark:text-slate-100 text-sm">Обсуждение</h3>
            </div>

            {/* Message feed */}
            <div className="flex-1 overflow-y-auto space-y-4 pr-1 mb-4 custom-scrollbar text-xs">
              {messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 italic">
                  Нет сообщений. Напишите что-нибудь первым!
                </div>
              ) : (
                messages.map(m => {
                  const isMe = m.sender_id === user?.id;
                  return (
                    <div key={m.id} className={`flex items-start gap-2 max-w-[85%] ${isMe ? 'ml-auto flex-row-reverse' : ''}`}>
                      {!isMe && (
                        m.sender_avatar ? (
                          <img src={m.sender_avatar} alt="avatar" className="w-7 h-7 rounded-full object-cover shrink-0" />
                        ) : (
                          <div className="w-7 h-7 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-[10px] font-bold text-slate-500 dark:text-slate-400 shrink-0">
                            {m.sender_name?.[0]}
                          </div>
                        )
                      )}
                      
                      <div>
                        {!isMe && (
                          <span className="block text-[10px] font-bold text-slate-400 dark:text-slate-500 mb-0.5 pl-1">
                            {m.sender_name}
                          </span>
                        )}
                        <div className={`p-2.5 rounded-2xl ${
                          isMe 
                            ? 'bg-indigo-600 text-white rounded-tr-none' 
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-tl-none'
                        }`}>
                          <p className="leading-relaxed break-words">{m.content}</p>
                        </div>
                        <span className="block text-[9px] text-slate-400 dark:text-slate-500 mt-0.5 text-right pl-1">
                          {format(new Date(m.created_at), 'HH:mm')}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Message Input */}
            <form onSubmit={handleSendMessage} className="flex gap-2 shrink-0 border-t border-slate-100 dark:border-slate-800 pt-3">
              <input
                type="text"
                value={messageInput}
                onChange={e => setMessageInput(e.target.value)}
                placeholder="Задать вопрос или написать сообщение..."
                className="flex-1 px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:ring-1 focus:ring-indigo-500 outline-none rounded-xl text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400"
              />
              <button
                type="submit"
                disabled={!messageInput.trim()}
                className="p-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl transition disabled:opacity-50"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>

          </div>

        </div>
      </div>
    </div>
  );
}
