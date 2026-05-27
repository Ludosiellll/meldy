import React, { useState, useRef, useEffect } from 'react';
import { Search, MapPin, Building2 } from 'lucide-react';

const BELARUS_UNIVERSITIES = [
  "БГУ (Белорусский государственный университет)",
  "БНТУ (Белорусский национальный технический университет)",
  "БГУИР (Белорусский государственный университет информатики и радиоэлектроники)",
  "БГЭУ (Белорусский государственный экономический университет)",
  "БГМУ (Белорусский государственный медицинский университет)",
  "МГЛУ (Минский государственный лингвистический университет)",
  "БГПУ им. М. Танка (Белорусский государственный педагогический университет)",
  "БГТУ (Белорусский государственный технологический университет)",
  "БГАА (Белорусская государственная академия авиации)",
  "БГАТУ (Белорусский государственный аграрный технический университет)",
  "ВГУ им. П.М. Машерова (Витебский государственный университет)",
  "ВГМУ (Витебский государственный ордена Дружбы народов медицинский университет)",
  "ГрГУ им. Янки Купалы (Гродненский государственный университет)",
  "ГрГМУ (Гродненский государственный медицинский университет)",
  "ГГУ им. Ф. Скорины (Гомельский государственный университет)",
  "ГГТУ им. П.О. Сухого (Гомельский государственный технический университет)",
  "ГомГМУ (Гомельский государственный медицинский университет)",
  "БРУ (Белорусско-Российский университет)",
  "МГУ им. А.А. Кулешова (Могилевский государственный университет)",
  "БарГУ (Барановичский государственный университет)",
  "ПолесГУ (Полесский государственный университет)",
  "ПГУ им. Евфросинии Полоцкой (Полоцкий государственный университет)"
];

interface UniversitySelectProps {
  value: string;
  onChange: (val: string) => void;
}

export default function UniversitySelect({ value, onChange }: UniversitySelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState(value);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSearch(value);
  }, [value]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        // On blur, update the parent value to whatever was typed
        onChange(search);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [search, onChange]);

  const filtered = BELARUS_UNIVERSITIES.filter(u => u.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="relative w-full" ref={wrapperRef}>
      <div className="relative flex items-center">
        <Building2 className="absolute left-3 w-4 h-4 text-slate-400" />
        <input
          type="text"
          value={search}
          onClick={() => setIsOpen(true)}
          onChange={(e) => {
            setSearch(e.target.value);
            onChange(e.target.value);
            setIsOpen(true);
          }}
          placeholder="ВУЗ или Школа (например, БГУ)"
          className="w-full pl-9 pr-4 py-2 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition shadow-sm placeholder:text-slate-400"
        />
      </div>

      {isOpen && (
        <div className="absolute z-[60] w-full mt-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl max-h-60 overflow-y-auto custom-scrollbar">
          {filtered.length > 0 ? (
            filtered.map((uni, idx) => (
              <div
                key={idx}
                onClick={() => {
                  setSearch(uni);
                  onChange(uni);
                  setIsOpen(false);
                }}
                className="px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer text-sm text-slate-700 dark:text-slate-300 transition border-b border-slate-100 dark:border-slate-800 last:border-0 flex items-center gap-2"
              >
                <MapPin className="w-3.5 h-3.5 shrink-0 text-indigo-400" />
                <span className="truncate">{uni}</span>
              </div>
            ))
          ) : (
            <div className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400">
              Нажмите Enter или кликните вне поля, чтобы сохранить "{search}"
            </div>
          )}
        </div>
      )}
    </div>
  );
}
