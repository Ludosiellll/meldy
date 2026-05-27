import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Star, Zap, Crown, Shield, CreditCard, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import toast from 'react-hot-toast';

export default function Pricing() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [isPro, setIsPro] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showCheckout, setShowCheckout] = useState(false);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    const checkStatus = async () => {
      const { data } = await supabase
        .from('profiles')
        .select('is_pro')
        .eq('id', user.id)
        .single();
      if (data?.is_pro) setIsPro(true);
      setLoading(false);
    };
    checkStatus();
  }, [user]);

  const handleCheckout = async () => {
    if (!user) {
      toast.error('Войдите в аккаунт');
      navigate('/login');
      return;
    }
    
    setProcessing(true);
    
    // Имитация задержки "банка"
    setTimeout(async () => {
      const { error } = await supabase
        .from('profiles')
        .update({ is_pro: true })
        .eq('id', user.id);
        
      setProcessing(false);
      
      if (error) {
        toast.error('Ошибка оплаты');
        return;
      }
      
      setIsPro(true);
      setShowCheckout(false);
      toast.success('PRO статус успешно активирован! 🎉');
      
      // Бросаем confetti или просто закрываем (toast уже есть)
    }, 2000);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-12">
      <div className="text-center mb-16">
        <h1 className="text-4xl md:text-5xl font-black text-white mb-6">
          Раскройте <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-orange-500">весь потенциал</span> ИИ
        </h1>
        <p className="text-xl text-slate-400 max-w-2xl mx-auto">
          Обычный план отлично подходит для старта. Но если вы готовитесь к сессии или пишете диплом — вам нужен безлимит.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
        
        {/* Базовый тариф */}
        <div className="bg-slate-800/50 rounded-3xl p-8 border border-slate-700/50 backdrop-blur-xl relative flex flex-col">
          <div className="mb-8">
            <h3 className="text-2xl font-bold text-white mb-2">Студент</h3>
            <p className="text-slate-400 mb-6">Бесплатно навсегда</p>
            <div className="text-4xl font-black text-white mb-1">0 ₽<span className="text-lg text-slate-500 font-normal"> / мес</span></div>
          </div>
          
          <ul className="space-y-4 mb-8 flex-1">
            <li className="flex items-center gap-3 text-slate-300">
              <Check className="w-5 h-5 text-indigo-400 shrink-0" />
              <span>Базовый анализ лекций</span>
            </li>
            <li className="flex items-center gap-3 text-slate-300">
              <Check className="w-5 h-5 text-indigo-400 shrink-0" />
              <span>Создание флеш-карточек</span>
            </li>
            <li className="flex items-center gap-3 text-slate-300">
              <Zap className="w-5 h-5 text-amber-500 shrink-0" />
              <span className="font-medium text-white">Лимит: 10 запросов ИИ в день</span>
            </li>
          </ul>

          <button 
            disabled 
            className="w-full py-4 rounded-xl bg-slate-700 text-slate-300 font-bold opacity-50 cursor-not-allowed"
          >
            Текущий тариф
          </button>
        </div>

        {/* PRO Тариф */}
        <div className="bg-gradient-to-b from-indigo-900/80 to-slate-800/80 rounded-3xl p-8 border-2 border-indigo-500/50 backdrop-blur-xl relative flex flex-col transform md:-translate-y-4 shadow-2xl shadow-indigo-900/20">
          
          {isPro && (
             <div className="absolute -top-4 -right-4 bg-gradient-to-r from-amber-400 to-orange-500 text-white text-xs font-bold px-4 py-1.5 rounded-full shadow-lg flex items-center gap-1 transform rotate-12">
               <Crown className="w-4 h-4" /> АКТИВИРОВАНО
             </div>
          )}

          <div className="mb-8">
             <div className="flex items-center gap-3 mb-2">
               <h3 className="text-2xl font-bold text-white">PRO Академик</h3>
               <span className="bg-indigo-500/20 text-indigo-300 text-xs font-bold px-2 py-1 rounded-lg">ПОПУЛЯРНО</span>
             </div>
            <p className="text-indigo-200 mb-6">Для максимальной продуктивности</p>
            <div className="text-4xl font-black text-white mb-1">490 ₽<span className="text-lg text-indigo-200 font-normal"> / мес</span></div>
          </div>
          
          <ul className="space-y-4 mb-8 flex-1">
            <li className="flex items-center gap-3 text-white font-medium">
              <Zap className="w-5 h-5 text-amber-400 shrink-0" />
              <span>Безлимитные запросы к ИИ</span>
            </li>
            <li className="flex items-center gap-3 text-slate-200">
              <Star className="w-5 h-5 text-indigo-400 shrink-0" />
              <span>Приоритетная генерация подкастов</span>
            </li>
            <li className="flex items-center gap-3 text-slate-200">
              <Check className="w-5 h-5 text-indigo-400 shrink-0" />
              <span>Детальный анализ огромных методичек</span>
            </li>
            <li className="flex items-center gap-3 text-slate-200">
              <Shield className="w-5 h-5 text-indigo-400 shrink-0" />
              <span>Сократовский режим профессора</span>
            </li>
          </ul>

          {isPro ? (
            <button className="w-full py-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-bold shadow-lg shadow-emerald-500/20 cursor-default flex items-center justify-center gap-2">
               <Check className="w-5 h-5" /> У вас есть PRO
            </button>
          ) : (
            <button 
              onClick={() => setShowCheckout(true)}
              className="w-full py-4 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-400 hover:to-purple-400 text-white font-bold shadow-lg shadow-indigo-500/30 transition transform hover:-translate-y-1"
            >
              Оформить PRO
            </button>
          )}
        </div>

      </div>

      {/* Окно оплаты (Демо) */}
      <AnimatePresence>
        {showCheckout && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
              onClick={() => !processing && setShowCheckout(false)}
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-slate-900 border border-slate-700 p-8 rounded-3xl w-full max-w-md relative z-10 shadow-2xl"
            >
              <h3 className="text-2xl font-bold text-white mb-2 flex items-center gap-2">
                <CreditCard className="w-6 h-6 text-indigo-400" /> Оплата PRO
              </h3>
              <p className="text-slate-400 mb-6 text-sm">
                Это демо-режим оплаты для защиты проекта. Нажмите оплатить, чтобы бесплатно получить PRO-статус.
              </p>

              <div className="space-y-4 mb-6">
                <div className="bg-slate-800 p-4 rounded-xl border border-slate-700/50">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-slate-300 font-medium">Тариф PRO Академик</span>
                    <span className="text-white font-bold">490 ₽</span>
                  </div>
                  <div className="text-slate-500 text-xs">Ежемесячная подписка</div>
                </div>
                
                {/* Фейковая карта */}
                <div className="h-40 bg-gradient-to-tr from-slate-800 to-slate-700 rounded-xl border border-slate-600 relative overflow-hidden p-6 flex flex-col justify-between">
                  <div className="flex justify-between items-start">
                    <div className="w-12 h-8 bg-slate-600/50 rounded-md"></div>
                    <div className="flex gap-1">
                      <div className="w-8 h-8 rounded-full bg-rose-500/80"></div>
                      <div className="w-8 h-8 rounded-full bg-amber-500/80 -ml-4"></div>
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-300 font-mono text-lg tracking-widest mb-1">•••• •••• •••• 0000</div>
                    <div className="flex justify-between text-slate-400 text-xs font-mono">
                      <span>STUDENT NAME</span>
                      <span>12/26</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex gap-3">
                <button 
                  onClick={() => setShowCheckout(false)}
                  disabled={processing}
                  className="px-4 py-3 bg-slate-800 text-white rounded-xl font-medium hover:bg-slate-700 transition"
                >
                  Отмена
                </button>
                <button 
                  onClick={handleCheckout}
                  disabled={processing}
                  className="flex-1 py-3 bg-indigo-500 text-white rounded-xl font-bold hover:bg-indigo-400 transition shadow-lg shadow-indigo-500/20 flex items-center justify-center gap-2"
                >
                  {processing ? (
                    <><Loader2 className="w-5 h-5 animate-spin" /> Обработка...</>
                  ) : (
                    "Оплатить 490 ₽"
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
