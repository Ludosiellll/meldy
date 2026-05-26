import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, BookOpen, Send, Users, Play, Square, MessageSquare, Clock, Heart, Volume2, ShieldAlert } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { getProfile } from '../api/social';
import SummaryView from '../components/SummaryView';
import { format } from 'date-fns';

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

  // Pomodoro таймер
  const [timerSeconds, setTimerSeconds] = useState(25 * 60);
  const [timerActive, setTimerActive] = useState(false);
  const [timerDuration, setTimerDuration] = useState(25 * 60);
  
  // Загрузки
  const [loading, setLoading] = useState(true);
  
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
        .limit(50)
    ]).then(([matRes, profRes, msgRes]) => {
      if (matRes.data) setMaterial(matRes.data);
      if (profRes) setProfile(profRes);
      if (msgRes.data) setMessages(msgRes.data);
      setLoading(false);
    }).catch(err => {
      console.error(err);
      setLoading(false);
    });
  }, [materialId, user]);

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
          const endTime = payload.endTime;
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
            coChannel.send({
              type: 'broadcast',
              event: 'timer',
              payload: {
                action: 'sync_response',
                endTime: timerEndTimeRef.current,
                duration: timerDuration
              }
            });
          }
        } else if (payload.action === 'sync_response') {
          if (payload.endTime > Date.now()) {
            timerEndTimeRef.current = payload.endTime;
            setTimerDuration(payload.duration);
            setTimerActive(true);
            localStorage.setItem(`co_timer_end_${materialId}`, payload.endTime.toString());
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
      coChannel.unsubscribe();
      msgChannel.unsubscribe();
    };
  }, [materialId, user, profile]);

  const myStatusRef = useRef(myStatus);
  useEffect(() => {
    myStatusRef.current = myStatus;
  }, [myStatus]);

  // Обновление присутствия при смене статуса
  useEffect(() => {
    if (coChannelRef.current && user && profile) {
      coChannelRef.current.track({
        user_id: user.id,
        name: profile.full_name || 'Студент',
        avatar: profile.avatar_url,
        status: myStatus
      });
    }
  }, [myStatus, user, profile]);

  // Обновление статуса Presence локально
  const handleUpdateStatus = (status: string) => {
    setMyStatus(status);
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
        payload: { action: 'start', endTime, duration }
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

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[80vh]">
        <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-slate-500 font-medium">Подключение к учебной комнате...</p>
      </div>
    );
  }

  if (!material) {
    return (
      <div className="p-8 text-center">
        <ShieldAlert className="w-12 h-12 text-rose-500 mx-auto mb-3" />
        <p className="text-slate-700 font-bold mb-4">Материал не найден</p>
        <button onClick={() => navigate('/library')} className="px-4 py-2 bg-indigo-600 text-white rounded-xl">← В библиотеку</button>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto min-h-screen">
      {/* HEADER */}
      <div className="flex items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(`/library/${materialId}`)}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-[10px] font-bold rounded-lg uppercase tracking-wider">
                Совместная комната
              </span>
              <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
            </div>
            <h1 className="text-xl md:text-2xl font-extrabold text-slate-900 tracking-tight mt-1">
              {material.title}
            </h1>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* LEFT COLUMN: MATERIAL STUDY + POMODORO */}
        <div className="lg:col-span-2 space-y-6">
          {/* Pomodoro Timer widget */}
          <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-6 relative overflow-hidden">
            <div className="absolute top-0 left-0 bottom-0 w-2 bg-indigo-500" />
            
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center shadow-inner">
                <Clock className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-extrabold text-slate-800 text-base">Совместный Pomodoro</h3>
                <p className="text-xs text-slate-400 max-w-xs mt-0.5">
                  Синхронный таймер фокусировки для совместного заучивания карточек или конспекта.
                </p>
              </div>
            </div>

            <div className="flex flex-col items-center sm:items-end gap-3 shrink-0">
              <div className="flex items-center gap-3">
                <span className="text-3xl font-black text-slate-800 font-mono tracking-wider">
                  {formatTime(timerSeconds)}
                </span>
                
                {timerActive ? (
                  <button
                    onClick={handleStopTimer}
                    className="p-2 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-xl transition"
                    title="Приостановить таймер"
                  >
                    <Square className="w-4 h-4 fill-rose-600" />
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
                      className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs font-bold transition"
                    >
                      15 мин
                    </button>
                  </div>
                )}
                
                <button
                  onClick={handleResetTimer}
                  className="px-2.5 py-1.5 border border-slate-200 hover:bg-slate-50 text-slate-500 rounded-xl text-xs font-bold transition"
                >
                  Сбросить
                </button>
              </div>
              
              {timerActive && (
                <div className="w-full sm:w-44 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-indigo-500 transition-all duration-1000"
                    style={{ width: `${(timerSeconds / timerDuration) * 100}%` }}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Material summary document */}
          <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-4">
            <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
              <BookOpen className="w-5 h-5 text-indigo-500" />
              <h2 className="font-extrabold text-slate-800 text-lg">Совместное изучение конспекта</h2>
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
          <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-emerald-500" />
                <h3 className="font-extrabold text-slate-800 text-sm">В комнате ({onlineUsers.length})</h3>
              </div>
            </div>

            <div className="space-y-3 max-h-[180px] overflow-y-auto custom-scrollbar">
              {onlineUsers.map(u => (
                <div key={u.user_id} className="flex items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="relative">
                      {u.avatar ? (
                        <img src={u.avatar} alt="avatar" className="w-8 h-8 rounded-full object-cover border border-slate-100" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center font-bold text-slate-500">
                          {u.name?.[0] || '?'}
                        </div>
                      )}
                      <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-500 border-2 border-white rounded-full" />
                    </div>
                    <span className="font-bold text-slate-700 truncate">{u.name}</span>
                  </div>
                  <span className="text-[10px] font-bold text-slate-400 bg-slate-50 px-2 py-0.5 rounded-md">
                    {u.user_id === user?.id ? (
                      <select 
                        value={myStatus} 
                        onChange={e => handleUpdateStatus(e.target.value)}
                        className="bg-transparent font-bold outline-none cursor-pointer text-indigo-600"
                      >
                        <option value="Изучает конспект">Изучаю конспект</option>
                        <option value="Решает тест">Решаю тест</option>
                        <option value="Общается в чате">Общаюсь</option>
                        <option value="Отошел">Отошел</option>
                      </select>
                    ) : u.status}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Realtime Chat */}
          <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm h-[400px] flex flex-col">
            <div className="flex items-center gap-2 pb-3 border-b border-slate-100 mb-3 shrink-0">
              <MessageSquare className="w-4 h-4 text-indigo-500" />
              <h3 className="font-extrabold text-slate-800 text-sm">Обсуждение</h3>
            </div>

            {/* Message feed */}
            <div className="flex-1 overflow-y-auto space-y-4 pr-1 mb-4 custom-scrollbar text-xs">
              {messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-400 italic">
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
                          <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-[10px] font-bold text-slate-500 shrink-0">
                            {m.sender_name?.[0]}
                          </div>
                        )
                      )}
                      
                      <div>
                        {!isMe && (
                          <span className="block text-[10px] font-bold text-slate-400 mb-0.5 pl-1">
                            {m.sender_name}
                          </span>
                        )}
                        <div className={`p-2.5 rounded-2xl ${
                          isMe 
                            ? 'bg-indigo-600 text-white rounded-tr-none' 
                            : 'bg-slate-100 text-slate-700 rounded-tl-none'
                        }`}>
                          <p className="leading-relaxed break-words">{m.content}</p>
                        </div>
                        <span className="block text-[9px] text-slate-400 mt-0.5 text-right pl-1">
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
            <form onSubmit={handleSendMessage} className="flex gap-2 shrink-0 border-t border-slate-100 pt-3">
              <input
                type="text"
                value={messageInput}
                onChange={e => setMessageInput(e.target.value)}
                placeholder="Задать вопрос или написать сообщение..."
                className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-indigo-500 outline-none rounded-xl text-xs"
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
