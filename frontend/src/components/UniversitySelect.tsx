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
  /** id of the input, for a <label htmlFor>. */
  id?: string;
}

/** A university field with suggestions (Meldy 2026-10-04: the account field look, .ac-* in styles/legacy.css). */
export default function UniversitySelect({ value, onChange, id }: UniversitySelectProps) {
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
    <div className="ac-combo" ref={wrapperRef}>
      <div className="ac-combo-field">
        <Building2 className="ac-combo-icon" aria-hidden="true" />
        <input
          id={id}
          type="text"
          value={search}
          onClick={() => setIsOpen(true)}
          onChange={(e) => {
            setSearch(e.target.value);
            onChange(e.target.value);
            setIsOpen(true);
          }}
          placeholder="ВУЗ или Школа (например, БГУ)"
          className="ac-input ac-combo-input"
        />
      </div>

      {isOpen && (
        <div className="ac-pop ac-combo-list">
          {filtered.length > 0 ? (
            filtered.map((uni, idx) => (
              <div
                key={idx}
                onClick={() => {
                  setSearch(uni);
                  onChange(uni);
                  setIsOpen(false);
                }}
                className="ac-pop-row"
              >
                <MapPin className="ac-pop-pin" aria-hidden="true" />
                <span className="ac-pop-text">{uni}</span>
              </div>
            ))
          ) : (
            <div className="ac-pop-empty">
              Нажмите Enter или кликните вне поля, чтобы сохранить "{search}"
            </div>
          )}
        </div>
      )}
    </div>
  );
}
