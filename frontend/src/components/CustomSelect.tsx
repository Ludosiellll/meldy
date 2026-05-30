import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export interface SelectOption {
  value: string;
  label: string;
  icon?: React.ReactNode;
}

interface CustomSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  icon?: React.ReactNode;
}

export function CustomSelect({
  value,
  onChange,
  options,
  placeholder = 'Выберите...',
  className = '',
  icon
}: CustomSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((opt) => opt.value === value);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  return (
    <div className="relative w-full" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={`flex items-center justify-between w-full outline-none transition-all ${className} ${
          isOpen ? (
            className.includes('ring-rose-500') || className.includes('focus:ring-rose-500') ? 'ring-2 ring-rose-500 border-rose-500' :
            className.includes('ring-emerald-500') || className.includes('focus:ring-emerald-500') ? 'ring-2 ring-emerald-500 border-emerald-500' :
            className.includes('ring-amber-500') || className.includes('focus:ring-amber-500') ? 'ring-2 ring-amber-500 border-amber-500' :
            'ring-2 ring-indigo-500 border-indigo-500'
          ) : ''
        }`}
      >
        <div className="flex items-center gap-2 truncate">
          {icon && <span className="shrink-0 text-slate-400">{icon}</span>}
          <span className="truncate">
            {selectedOption ? selectedOption.label : <span className="text-slate-400">{placeholder}</span>}
          </span>
        </div>
        <ChevronDown
          className={`w-4 h-4 text-slate-400 shrink-0 transition-transform duration-200 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.1, ease: 'easeOut' }}
            className="absolute z-50 w-full mt-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl dark:shadow-slate-950/50 overflow-hidden"
          >
            <div className="max-h-60 overflow-y-auto custom-scrollbar py-1">
              {options.length === 0 ? (
                <div className="px-4 py-3 text-sm text-slate-500 text-center">Нет вариантов</div>
              ) : (
                options.map((option) => {
                  const isSelected = option.value === value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        onChange(option.value);
                        setIsOpen(false);
                      }}
                      className={`w-full flex items-center justify-between px-4 py-2.5 text-sm transition-colors ${
                        isSelected
                          ? className.includes('ring-rose-500') || className.includes('focus:ring-rose-500')
                            ? 'bg-rose-50/50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300 font-semibold'
                            : className.includes('ring-emerald-500') || className.includes('focus:ring-emerald-500')
                            ? 'bg-emerald-50/50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 font-semibold'
                            : className.includes('ring-amber-500') || className.includes('focus:ring-amber-500')
                            ? 'bg-amber-50/50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 font-semibold'
                            : 'bg-indigo-50/50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 font-semibold'
                          : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/80'
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        {option.icon && <span className="shrink-0 opacity-70">{option.icon}</span>}
                        <span className="truncate">{option.label}</span>
                      </div>
                      {isSelected && (
                        <Check className={`w-4 h-4 shrink-0 ${
                          className.includes('ring-rose-500') || className.includes('focus:ring-rose-500')
                            ? 'text-rose-600 dark:text-rose-400'
                            : className.includes('ring-emerald-500') || className.includes('focus:ring-emerald-500')
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : className.includes('ring-amber-500') || className.includes('focus:ring-amber-500')
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-indigo-600 dark:text-indigo-400'
                        }`} />
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
