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

type Tone = 'accent' | 'rose' | 'emerald' | 'amber';

/** The colour of the open state follows the caller's focus ring (rose, emerald, amber); the default is the blue. */
function toneOf(className: string): Tone {
  if (className.includes('ring-rose-500')) return 'rose';
  if (className.includes('ring-emerald-500')) return 'emerald';
  if (className.includes('ring-amber-500')) return 'amber';
  return 'accent';
}

/**
 * A select with its own menu (Meldy 2026-10-04): the trigger keeps the caller's classes, the menu is a
 * rounded white card with soft rows; the chosen row is tinted. Styles .ac-sel / .ac-pop in styles/legacy.css.
 */
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
  const tone = toneOf(className);

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
    <div className="ac-sel" ref={dropdownRef} data-tone={tone}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        className={`ac-sel-trigger flex items-center justify-between w-full outline-none transition-all ${className}`}
        data-open={isOpen ? '' : undefined}
      >
        <div className="flex items-center gap-2 truncate">
          {icon && <span className="ac-sel-icon shrink-0">{icon}</span>}
          <span className="truncate">
            {selectedOption ? selectedOption.label : <span className="ac-sel-placeholder">{placeholder}</span>}
          </span>
        </div>
        <ChevronDown className="ac-sel-chevron" aria-hidden="true" />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12, ease: 'easeOut' }}
            className="ac-pop ac-sel-menu"
          >
            <div className="ac-pop-scroll">
              {options.length === 0 ? (
                <div className="ac-pop-empty">Нет вариантов</div>
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
                      className="ac-pop-opt"
                      data-selected={isSelected ? '' : undefined}
                    >
                      <span className="flex items-center gap-2 truncate">
                        {option.icon && <span className="shrink-0 opacity-70">{option.icon}</span>}
                        <span className="truncate">{option.label}</span>
                      </span>
                      {isSelected && <Check className="ac-pop-check" aria-hidden="true" />}
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
