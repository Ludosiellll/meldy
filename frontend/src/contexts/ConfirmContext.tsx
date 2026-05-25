import { createContext, useContext, useState, ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, Check, X } from 'lucide-react';

interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  type?: 'danger' | 'warning' | 'info';
}

interface ConfirmContextType {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  alert: (options: Omit<ConfirmOptions, 'cancelText'>) => Promise<void>;
}

const ConfirmContext = createContext<ConfirmContextType | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isAlert, setIsAlert] = useState(false);
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const [resolvePromise, setResolvePromise] = useState<((value: boolean) => void) | null>(null);

  const confirm = (opts: ConfirmOptions) => {
    setOptions(opts);
    setIsAlert(false);
    setIsOpen(true);
    return new Promise<boolean>((resolve) => {
      setResolvePromise(() => resolve);
    });
  };

  const alert = (opts: Omit<ConfirmOptions, 'cancelText'>) => {
    setOptions(opts);
    setIsAlert(true);
    setIsOpen(true);
    return new Promise<void>((resolve) => {
      setResolvePromise(() => resolve as any);
    });
  };

  const handleConfirm = () => {
    setIsOpen(false);
    if (resolvePromise) resolvePromise(true);
  };

  const handleCancel = () => {
    setIsOpen(false);
    if (resolvePromise) resolvePromise(false);
  };

  return (
    <ConfirmContext.Provider value={{ confirm, alert }}>
      {children}
      
      <AnimatePresence>
        {isOpen && options && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
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
              className="relative w-full max-w-md bg-white rounded-3xl p-6 shadow-2xl border border-slate-100"
            >
              <div className="flex flex-col items-center text-center">
                <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-4 ${
                  options.type === 'danger' ? 'bg-rose-100 text-rose-600' :
                  options.type === 'info' ? 'bg-indigo-100 text-indigo-600' :
                  'bg-amber-100 text-amber-600'
                }`}>
                  <AlertTriangle className="w-8 h-8" />
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-2">{options.title}</h3>
                <p className="text-slate-500 text-sm mb-6 leading-relaxed">
                  {options.message}
                </p>
                <div className="flex w-full gap-3">
                  {!isAlert && (
                    <button
                      onClick={handleCancel}
                      className="flex-1 py-3 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold transition flex items-center justify-center gap-2"
                    >
                      <X className="w-4 h-4" />
                      {options.cancelText || 'Отмена'}
                    </button>
                  )}
                  <button
                    onClick={handleConfirm}
                    className={`flex-1 py-3 px-4 rounded-xl font-bold transition flex items-center justify-center gap-2 text-white shadow-lg ${
                      options.type === 'danger' ? 'bg-rose-600 hover:bg-rose-700 shadow-rose-200' :
                      options.type === 'info' ? 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-200' :
                      'bg-amber-600 hover:bg-amber-700 shadow-amber-200'
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
