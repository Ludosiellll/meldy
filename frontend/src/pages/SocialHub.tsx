import { motion } from 'framer-motion';
import { Globe, Users, Trophy, BookOpen, Rocket, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function SocialHub() {
  const navigate = useNavigate();

  const features = [
    {
      icon: Users,
      title: 'Учебные комнаты',
      description: 'Объединяйтесь с однокурсниками, создавайте совместные конспекты и готовьтесь к экзаменам вместе.',
    },
    {
      icon: Trophy,
      title: 'Лиги и Рейтинги',
      description: 'Соревнуйтесь с другими студентами вашего университета и факультета. Зарабатывайте глобальные XP.',
    },
    {
      icon: BookOpen,
      title: 'Маркетплейс знаний',
      description: 'Делитесь своими сгенерированными базами знаний и находите лучшие шпаргалки от топ-студентов.',
    },
  ];

  return (
    <div className="p-8 max-w-5xl mx-auto min-h-[85vh] flex flex-col items-center justify-center">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full text-center space-y-6 mb-16"
      >
        <div className="w-16 h-16 bg-slate-900 rounded-2xl flex items-center justify-center mx-auto shadow-xl shadow-slate-200">
          <Globe className="w-8 h-8 text-white" />
        </div>
        <h1 className="text-4xl md:text-5xl font-extrabold text-slate-900 tracking-tight">
          Study Network
        </h1>
        <p className="text-lg text-slate-500 max-w-2xl mx-auto leading-relaxed">
          В следующем крупном обновлении StudyForge станет социальной платформой. 
          Ваше личное пространство обучения объединится с глобальным студенческим сообществом.
        </p>
      </motion.div>

      <div className="grid md:grid-cols-3 gap-6 w-full max-w-4xl mb-12">
        {features.map((f, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow"
          >
            <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center mb-4">
              <f.icon className="w-6 h-6 text-slate-700" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 mb-2">{f.title}</h3>
            <p className="text-sm text-slate-500 leading-relaxed">{f.description}</p>
          </motion.div>
        ))}
      </div>

      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="flex flex-col sm:flex-row items-center gap-4"
      >
        <button 
          onClick={() => navigate('/dashboard')}
          className="px-8 py-3 bg-slate-900 text-white rounded-xl font-medium flex items-center gap-2 hover:bg-slate-800 transition shadow-lg shadow-slate-200"
        >
          <Rocket className="w-5 h-5" />
          Вернуться к обучению
        </button>
        <button className="px-8 py-3 bg-white text-slate-700 border border-slate-200 rounded-xl font-medium flex items-center gap-2 hover:bg-slate-50 transition">
          Узнать больше
          <ArrowRight className="w-4 h-4" />
        </button>
      </motion.div>
    </div>
  );
}
