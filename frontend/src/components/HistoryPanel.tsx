import { motion } from 'framer-motion';
import { FileText, X, Trash2 } from 'lucide-react';
import { HistoryItem } from '../types';

interface Props {
  items: HistoryItem[];
  onRestore: (item: HistoryItem) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
}

export default function HistoryPanel({ items, onRestore, onRemove, onClear }: Props) {
  if (items.length === 0) return null;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}>
      <div className="flex items-center justify-between mb-3">
        <span className="font-medium text-slate-800">История анализов</span>
        <button onClick={onClear}
          className="flex items-center gap-1 text-xs text-slate-400 hover:text-rose-500 transition">
          <Trash2 className="w-3 h-3" />Очистить
        </button>
      </div>

      <div className="space-y-2">
        {items.map(item => (
          <div key={item.id} className="card p-4 flex items-center gap-3">
            <FileText className="w-5 h-5 text-brand-500 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-900 truncate">{item.fileName}</p>
              <p className="text-xs text-slate-400">{item.date} · {item.textLength.toLocaleString()} символов · {item.duration} сек</p>
            </div>
            <button onClick={() => onRestore(item)}
              className="px-3 py-1 rounded-lg text-xs font-medium text-brand-600 border border-brand-200 hover:bg-brand-50 transition">
              Открыть
            </button>
            <button onClick={() => onRemove(item.id)}
              className="p-1 text-slate-300 hover:text-rose-500 transition">
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </motion.div>
  );
}
