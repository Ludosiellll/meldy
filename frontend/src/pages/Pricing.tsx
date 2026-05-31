import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Star, Zap, Crown, Shield, CreditCard, Loader2, Copy, Wallet, Key } from 'lucide-react';
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
  const [paymentSent, setPaymentSent] = useState(false);

  // Впишите сюда свой актуальный email администратора
  const adminEmails = ['test@example.com', 'admin@studyforge.com'];
  const isAdmin = user && adminEmails.includes(user.email || '');

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
    setProcessing(true);
    
    // Имитация задержки
    setTimeout(() => {
      setProcessing(false);
      setPaymentSent(true);
    }, 1500);
  };

  const handleAdminBypass = async () => {
    if (!user) return;
    
    const action = isPro ? 'Забрать' : 'Выдать';
    const confirmBypass = window.confirm(`${action} PRO-статус (Admin)?`);
    if (!confirmBypass) return;

    setProcessing(true);
    const { error } = await supabase
      .from('profiles')
      .update({ is_pro: !isPro })
      .eq('id', user.id);
      
    setProcessing(false);
    
    if (error) {
      toast.error('Ошибка изменения статуса');
      return;
    }
    
    setIsPro(!isPro);
    setShowCheckout(false);
    toast.success(!isPro ? 'PRO статус успешно активирован! (Admin)' : 'PRO статус снят (Admin)');
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} скопирован!`);
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
        <h1 className="text-4xl md:text-5xl font-black text-slate-900 dark:text-white mb-6">
          Раскройте <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-orange-500">весь потенциал</span> ИИ
        </h1>
        <p className="text-xl text-slate-600 dark:text-slate-400 max-w-2xl mx-auto">
          Обычный план отлично подходит для старта. Но если вы готовитесь к сессии или пишете диплом — вам нужен безлимит.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
        
        {/* Базовый тариф */}
        <div className="bg-white dark:bg-slate-800/50 rounded-3xl p-8 border border-slate-200 dark:border-slate-700/50 backdrop-blur-xl relative flex flex-col shadow-sm dark:shadow-none">
          <div className="mb-8">
            <h3 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">Студент</h3>
            <p className="text-slate-500 dark:text-slate-400 mb-6">Бесплатно навсегда</p>
            <div className="text-4xl font-black text-slate-900 dark:text-white mb-1">0 ₽<span className="text-lg text-slate-500 font-normal"> / мес</span></div>
          </div>
          
          <ul className="space-y-4 mb-8 flex-1">
            <li className="flex items-center gap-3">
              <Check className="w-5 h-5 text-indigo-500 dark:text-indigo-400 shrink-0" />
              <span className="text-slate-700 dark:text-slate-300">Базовый анализ лекций</span>
            </li>
            <li className="flex items-center gap-3">
              <Check className="w-5 h-5 text-indigo-500 dark:text-indigo-400 shrink-0" />
              <span className="text-slate-700 dark:text-slate-300">Создание флеш-карточек</span>
            </li>
            <li className="flex items-center gap-3">
              <Zap className="w-5 h-5 text-amber-500 shrink-0" />
              <span className="font-medium text-slate-900 dark:text-white">Лимит: 10 запросов ИИ в день</span>
            </li>
          </ul>

          <button 
            disabled 
            className="w-full py-4 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-400 dark:text-slate-300 font-bold opacity-70 dark:opacity-50 cursor-not-allowed"
          >
            Текущий тариф
          </button>
        </div>

        {/* PRO Тариф */}
        <div className="bg-gradient-to-b from-indigo-700 to-slate-800 dark:from-indigo-900/80 dark:to-slate-800/80 rounded-3xl p-8 border-2 border-indigo-400 dark:border-indigo-500/50 backdrop-blur-xl relative flex flex-col transform md:-translate-y-4 shadow-2xl shadow-indigo-500/20 dark:shadow-indigo-900/20">
          
          {isPro && (
             <div className="absolute -top-4 -right-4 bg-gradient-to-r from-amber-400 to-orange-500 text-white text-xs font-bold px-4 py-1.5 rounded-full shadow-lg flex items-center gap-1 transform rotate-12 z-10">
               <Crown className="w-4 h-4" /> АКТИВИРОВАНО
             </div>
          )}

          {/* Админская кнопка (Toggle PRO) */}
          {isAdmin && (
            <button
              onClick={handleAdminBypass}
              className={`absolute -left-4 -top-4 p-2.5 rounded-full transition shadow-lg border z-20 ${isPro ? 'bg-rose-500 hover:bg-rose-600 text-white border-rose-400' : 'bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-amber-400 border-slate-700'}`}
              title={isPro ? "Admin: Забрать PRO" : "Admin: Выдать PRO"}
            >
              <Key className="w-5 h-5" />
            </button>
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
            <button className="w-full py-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-bold shadow-lg shadow-emerald-500/20 cursor-default flex items-center justify-center gap-2 relative">
               <Check className="w-5 h-5" /> У вас есть PRO
            </button>
          ) : (
            <div className="relative">
              <button 
                onClick={() => {
                  if (!user) {
                    toast.error('Войдите в аккаунт');
                    navigate('/login');
                    return;
                  }
                  setShowCheckout(true);
                }}
                className="w-full py-4 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-400 hover:to-purple-400 text-white font-bold shadow-lg shadow-indigo-500/30 transition transform hover:-translate-y-1"
              >
                Оформить PRO
              </button>
            </div>
          )}
        </div>

      </div>

      {/* Окно оплаты (Ручная) */}
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
              className="bg-slate-900 border border-slate-700 p-8 rounded-3xl w-full max-w-md relative z-10 shadow-2xl overflow-hidden"
            >
              {!paymentSent ? (
                <>
                  <h3 className="text-2xl font-bold text-white mb-2 flex items-center gap-2">
                    <CreditCard className="w-6 h-6 text-indigo-400" /> Оплата PRO
                  </h3>
                  <p className="text-slate-400 mb-6 text-sm">
                    Сделайте перевод на любую из указанных ниже карт/кошельков, чтобы активировать PRO Академик.
                  </p>

                  <div className="space-y-4 mb-6">
                    <div className="bg-slate-800 p-4 rounded-xl border border-slate-700/50 flex justify-between items-center">
                      <span className="text-slate-300 font-medium">К оплате:</span>
                      <span className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-orange-500">490 ₽</span>
                    </div>
                    
                    {/* Сбербанк */}
                    <div className="p-4 bg-gradient-to-tr from-slate-800 to-slate-700 rounded-xl border border-slate-600 relative">
                      <div className="flex justify-between items-start mb-3">
                        <div className="flex items-center gap-2 text-emerald-400 font-bold">
                          <Wallet className="w-5 h-5" /> Сбербанк (Беларусь)
                        </div>
                      </div>
                      <div className="flex justify-between items-center bg-slate-900/50 p-3 rounded-lg border border-slate-700">
                        <span className="text-white font-mono text-lg tracking-wider">1234 5678 9012 3456</span>
                        <button 
                          onClick={() => copyToClipboard('1234 5678 9012 3456', 'Номер карты')}
                          className="p-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-slate-300 transition"
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                      </div>
                      <p className="text-slate-400 text-xs mt-2 text-center">Получатель: Денис Л.</p>
                    </div>

                    {/* Оплати */}
                    <div className="p-4 bg-gradient-to-tr from-slate-800 to-slate-700 rounded-xl border border-slate-600 relative">
                      <div className="flex justify-between items-start mb-3">
                        <div className="flex items-center gap-2 text-indigo-400 font-bold">
                          <Wallet className="w-5 h-5" /> Сервис «Оплати»
                        </div>
                      </div>
                      <div className="flex justify-between items-center bg-slate-900/50 p-3 rounded-lg border border-slate-700">
                        <span className="text-white font-mono text-lg tracking-wider">+375 29 123-45-67</span>
                        <button 
                          onClick={() => copyToClipboard('+375 29 123-45-67', 'Номер телефона')}
                          className="p-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-slate-300 transition"
                        >
                          <Copy className="w-4 h-4" />
                        </button>
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
                        "Я оплатил"
                      )}
                    </button>
                  </div>
                </>
              ) : (
                <div className="text-center py-6">
                  <div className="w-20 h-20 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
                    <Check className="w-10 h-10 text-emerald-400" />
                  </div>
                  <h3 className="text-2xl font-bold text-white mb-3">Заявка принята!</h3>
                  <p className="text-slate-400 mb-8 leading-relaxed">
                    Мы проверяем поступление перевода. Как только деньги придут, ваш PRO статус будет активирован. <br/><br/>
                    Обычно это занимает от 5 до 15 минут.
                  </p>
                  <button 
                    onClick={() => {
                      setShowCheckout(false);
                      setPaymentSent(false); // Сброс
                    }}
                    className="w-full py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-bold transition"
                  >
                    Понятно
                  </button>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
