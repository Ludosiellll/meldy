import { useState, useEffect } from 'react';
import { GraduationCap, RotateCcw } from 'lucide-react';

export default function Header({ onReset }: { onReset: () => void }) {
  const [status, setStatus] = useState<'ok' | 'error' | 'checking'>('checking');

  useEffect(() => {
    const check = () => {
      fetch('/api/health')
        .then(r => r.json())
        .then(d => setStatus(d.status === 'ok' ? 'ok' : 'error'))
        .catch(() => setStatus('error'));
    };
    check();
    const id = setInterval(check, 30000);
    return () => clearInterval(id);
  }, []);

  const dotClass = status === 'ok'
    ? 'w-2 h-2 rounded-full bg-emerald-400'
    : status === 'error'
    ? 'w-2 h-2 rounded-full bg-rose-400 animate-pulse'
    : 'w-2 h-2 rounded-full bg-slate-300 animate-pulse';
  const dotTitle = status === 'ok' ? 'Бэкенд работает' : status === 'error' ? 'Бэкенд недоступен' : 'Проверка...';

  return (
    <header className="border-b border-slate-200 bg-white/90 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center">
            <GraduationCap className="w-4 h-4 text-white" />
          </div>
          <span className="font-semibold text-slate-900 text-[15px]">StudyForge</span>
          <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 text-slate-500 text-xs font-medium">
            Мультиагентный AI · Llama 3.3 70B
            <span className={dotClass} title={dotTitle} />
          </span>
        </div>
        <button onClick={onReset}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-slate-500 hover:bg-slate-100 transition text-sm">
          <RotateCcw className="w-3.5 h-3.5" />Заново
        </button>
      </div>
    </header>
  );
}
