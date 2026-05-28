import { createContext, useContext, useState, useRef, ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, Check, X } from 'lucide-react';

interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  type?: 'danger' | 'warning' | 'info';
  type?: 'danger' | 'warning' | 'info';
  icon?: React.ElementType;
  checkboxLabel?: string;
  onCheckboxChange?: (checked: boolean) => void;
}

interface ConfirmContextType {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  alert: (options: Omit<ConfirmOptions, 'cancelText'>) => Promise<void>;
}

const ConfirmContext = createContext<ConfirmContextType | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isAlert, setIsAlert] = useState(false);
  const [isChecked, setIsChecked] = useState(false);
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolvePromiseRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = (opts: ConfirmOptions) => {
    setOptions(opts);
    setIsAlert(false);
    setIsChecked(false);
    setIsOpen(true);
    return new Promise<boolean>((resolve) => {
      resolvePromiseRef.current = resolve;
    });
  };

  const alert = (opts: Omit<ConfirmOptions, 'cancelText'>) => {
    setOptions(opts);
    setIsAlert(true);
    setIsOpen(true);
    return new Promise<void>((resolve) => {
      resolvePromiseRef.current = resolve as any;
    });
  };

  const handleConfirm = () => {
    setIsOpen(false);
    if (options?.onCheckboxChange) {
      options.onCheckboxChange(isChecked);
    }
    if (resolvePromiseRef.current) {
      resolvePromiseRef.current(true);
      resolvePromiseRef.current = null;
    }
  };

  const handleCancel = () => {
    setIsOpen(false);
    if (resolvePromiseRef.current) {
      resolvePromiseRef.current(false);
      resolvePromiseRef.current = null;
    }
  };

  return (
    <ConfirmContext.Provider value={{ confirm, alert }}>
      {children}
      
      <AnimatePresence>
        {isOpen && options && (
          <div key="confirm-modal-container" className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={handleCancel}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="relative w-[calc(100%-32px)] md:w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl p-6 shadow-2xl border border-slate-100 dark:border-slate-800"
            >
              <div className="flex flex-col items-center text-center">
                <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-4 ${
                  options.type === 'danger' ? 'bg-rose-100 dark:bg-rose-950/40 text-rose-600 dark:text-rose-450' :
                  options.type === 'info' ? 'bg-indigo-100 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400' :
                  'bg-amber-100 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400'
                }`}>
                  {options.icon ? <options.icon className="w-8 h-8" /> : <AlertTriangle className="w-8 h-8" />}
                </div>
                <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-2">{options.title}</h3>
                <p className="text-slate-500 dark:text-slate-400 text-sm mb-6 leading-relaxed">
                  {options.message}
                </p>
                {options.checkboxLabel && !isAlert && (
                  <label className="flex items-center gap-3 w-full text-left bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl cursor-pointer mb-6 border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 transition">
                    <input 
                      type="checkbox" 
                      className="w-5 h-5 rounded text-indigo-600 bg-white border-slate-300 focus:ring-indigo-500 dark:bg-slate-900 dark:border-slate-700" 
                      checked={isChecked}
                      onChange={(e) => setIsChecked(e.target.checked)}
                    />
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300 select-none">
                      {options.checkboxLabel}
                    </span>
                  </label>
                )}
                <div className="flex w-full gap-3">
                  {!isAlert && (
                    <button
                      onClick={handleCancel}
                      className="flex-1 py-3 px-4 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl font-bold transition flex items-center justify-center gap-2"
                    >
                      <X className="w-4 h-4" />
                      {options.cancelText || 'Отмена'}
                    </button>
                  )}
                  <button
                    onClick={handleConfirm}
                    className={`flex-1 py-3 px-4 rounded-xl font-bold transition flex items-center justify-center gap-2 text-white shadow-lg ${
                      options.type === 'danger' ? 'bg-rose-600 hover:bg-rose-700 shadow-rose-200 dark:shadow-none' :
                      options.type === 'info' ? 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-200 dark:shadow-none' :
                      'bg-amber-600 hover:bg-amber-700 shadow-amber-200 dark:shadow-none'
                    }`}
                  >
                    <Check className="w-4 h-4" />
                    {options.confirmText || 'ОК'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const context = useContext(ConfirmContext);
  if (!context) throw new Error('useConfirm must be used within ConfirmProvider');
  return context;
}
