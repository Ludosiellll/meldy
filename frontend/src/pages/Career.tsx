import { motion } from 'framer-motion';
import { Briefcase, Target, Layers, FileText, ArrowRight, Zap } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function Career() {
  const navigate = useNavigate();

  const features = [
    {
      icon: Target,
      title: 'Карьерное древо',
      description: 'Карта Знаний масштабируется до Карьерного Древа. Смотрите, как изучаемые темы приближают вас к реальной профессии.',
    },
    {
      icon: Layers,
      title: 'Трекинг хард-скиллов',
      description: 'Автоматический анализ ваших конспектов для выявления и подтверждения освоенных навыков.',
    },
    {
      icon: FileText,
      title: 'AI-Резюме и Портфолио',
      description: 'Платформа сама соберет резюме на основе ваших знаний и предложит идеи для пет-проектов.',
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
          <Briefcase className="w-8 h-8 text-white" />
        </div>
        <h1 className="text-4xl md:text-5xl font-extrabold text-slate-900 tracking-tight">
          Карьерный Трек
        </h1>
        <p className="text-lg text-slate-500 max-w-2xl mx-auto leading-relaxed">
          Учеба ради учебы осталась в прошлом. Мы свяжем ваши загруженные лекции с реальными требованиями рынка труда.
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
          <Zap className="w-5 h-5" />
          Вернуться к дашборду
        </button>
        <button className="px-8 py-3 bg-white text-slate-700 border border-slate-200 rounded-xl font-medium flex items-center gap-2 hover:bg-slate-50 transition">
          Оформить предзаказ
          <ArrowRight className="w-4 h-4" />
        </button>
      </motion.div>
    </div>
  );
}
