/**
 * The four tiles of the first screen: a lecture, a ticket, the cards and the answer aloud, drawn as
 * halftone illustrations (prototype «Лендинг», 2026-10-04). Pictures only — hidden from readers.
 */
export default function HeroMosaic() {
  return (
    <div className="hm-mosaic hm-rise hm-d2" aria-hidden="true">
      <div className="hm-col hm-col--a">
        <div className="hm-tile hm-tile--1">
          <svg viewBox="0 0 360 440" preserveAspectRatio="xMidYMid slice">
            <defs>
              <linearGradient id="hm-a-bg" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#2D5FD6" />
                <stop offset="1" stopColor="#F3A9C4" />
              </linearGradient>
              <pattern id="hm-a-dw" width="8" height="8" patternUnits="userSpaceOnUse">
                <circle cx="4" cy="4" r="1.9" fill="#FFFFFF" />
              </pattern>
              <pattern id="hm-a-dn" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(30)">
                <circle cx="3.5" cy="3.5" r="1.7" fill="#10295A" />
              </pattern>
              <radialGradient id="hm-a-glow" cx="0.2" cy="0.15" r="0.75">
                <stop offset="0" stopColor="#FFFFFF" />
                <stop offset="1" stopColor="#000000" />
              </radialGradient>
              <mask id="hm-a-m1">
                <rect width="360" height="440" fill="url(#hm-a-glow)" />
              </mask>
              <linearGradient id="hm-a-sh" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0.5" stopColor="#000000" />
                <stop offset="1" stopColor="#FFFFFF" />
              </linearGradient>
              <mask id="hm-a-m2">
                <rect width="360" height="440" fill="url(#hm-a-sh)" />
              </mask>
            </defs>
            <rect width="360" height="440" fill="url(#hm-a-bg)" />
            <rect width="360" height="440" fill="url(#hm-a-dw)" mask="url(#hm-a-m1)" opacity="0.6" />
            <g transform="rotate(-9 170 220)">
              <rect x="58" y="78" width="200" height="270" rx="12" fill="#FCE3D2" />
              <rect x="82" y="108" width="96" height="9" rx="4.5" fill="#E98FB0" />
              <rect x="82" y="134" width="150" height="6" rx="3" fill="#F0B9A6" />
              <rect x="82" y="150" width="138" height="6" rx="3" fill="#F0B9A6" />
              <rect x="82" y="166" width="146" height="6" rx="3" fill="#F0B9A6" />
            </g>
            <g transform="rotate(5 200 250)">
              <rect x="96" y="104" width="214" height="290" rx="12" fill="#FFF8EE" />
              <rect x="122" y="136" width="118" height="11" rx="5.5" fill="#2D5FD6" />
              <rect x="122" y="168" width="160" height="7" rx="3.5" fill="#C9D6F3" />
              <rect x="122" y="185" width="148" height="7" rx="3.5" fill="#C9D6F3" />
              <rect x="116" y="198" width="168" height="18" rx="9" fill="#F4C45B" opacity="0.85" />
              <rect x="122" y="203" width="152" height="7" rx="3.5" fill="#8B6A1E" opacity="0.55" />
              <rect x="122" y="226" width="140" height="7" rx="3.5" fill="#C9D6F3" />
              <rect x="122" y="243" width="156" height="7" rx="3.5" fill="#C9D6F3" />
              <rect x="122" y="276" width="100" height="9" rx="4.5" fill="#2D5FD6" opacity="0.8" />
              <rect x="122" y="302" width="158" height="7" rx="3.5" fill="#C9D6F3" />
              <rect x="122" y="319" width="132" height="7" rx="3.5" fill="#C9D6F3" />
              <rect x="122" y="336" width="150" height="7" rx="3.5" fill="#C9D6F3" />
            </g>
            <rect width="360" height="440" fill="url(#hm-a-dn)" mask="url(#hm-a-m2)" opacity="0.32" />
          </svg>
          <span className="hm-cap">Лекция</span>
        </div>
        <div className="hm-tile hm-tile--3">
          <svg viewBox="0 0 360 270" preserveAspectRatio="xMidYMid slice">
            <defs>
              <linearGradient id="hm-c-bg" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#10295A" />
                <stop offset="1" stopColor="#3B74E6" />
              </linearGradient>
              <pattern id="hm-c-dw" width="8" height="8" patternUnits="userSpaceOnUse">
                <circle cx="4" cy="4" r="1.8" fill="#A9C8F7" />
              </pattern>
              <linearGradient id="hm-c-f" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="#FFFFFF" />
                <stop offset="0.7" stopColor="#000000" />
              </linearGradient>
              <mask id="hm-c-m">
                <rect width="360" height="270" fill="url(#hm-c-f)" />
              </mask>
            </defs>
            <rect width="360" height="270" fill="url(#hm-c-bg)" />
            <rect width="360" height="270" fill="url(#hm-c-dw)" mask="url(#hm-c-m)" opacity="0.55" />
            <g transform="rotate(-12 170 140)">
              <rect x="96" y="58" width="150" height="104" rx="14" fill="#EAF1FD" />
            </g>
            <g transform="rotate(8 200 140)">
              <rect x="130" y="70" width="150" height="104" rx="14" fill="#FDF3D8" />
            </g>
            <g transform="rotate(-2 180 140)">
              <rect x="104" y="80" width="160" height="112" rx="14" fill="#FFFFFF" />
              <text x="184" y="152" fill="#2869DD" style={{ fontFamily: 'Onest Variable, Onest, sans-serif', fontSize: 58, fontWeight: 600, textAnchor: 'middle' }}>
                ?
              </text>
            </g>
          </svg>
          <span className="hm-cap">Карточки</span>
        </div>
      </div>
      <div className="hm-col hm-col--b">
        <div className="hm-tile hm-tile--2">
          <svg viewBox="0 0 360 260" preserveAspectRatio="xMidYMid slice">
            <defs>
              <linearGradient id="hm-b-bg" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#F3A25B" />
                <stop offset="1" stopColor="#EF8FA8" />
              </linearGradient>
              <pattern id="hm-b-dw" width="8" height="8" patternUnits="userSpaceOnUse">
                <circle cx="4" cy="4" r="1.9" fill="#FFF3E0" />
              </pattern>
              <radialGradient id="hm-b-g" cx="0.85" cy="0.1" r="0.8">
                <stop offset="0" stopColor="#FFFFFF" />
                <stop offset="1" stopColor="#000000" />
              </radialGradient>
              <mask id="hm-b-m">
                <rect width="360" height="260" fill="url(#hm-b-g)" />
              </mask>
            </defs>
            <rect width="360" height="260" fill="url(#hm-b-bg)" />
            <rect width="360" height="260" fill="url(#hm-b-dw)" mask="url(#hm-b-m)" opacity="0.65" />
            <g transform="rotate(-6 170 130)">
              <rect x="58" y="56" width="214" height="146" rx="16" fill="#FFF8EE" />
              <text x="82" y="96" fill="#10295A" style={{ fontFamily: 'Onest Variable, Onest, sans-serif', fontSize: 22, fontWeight: 600 }}>
                Билет № 12
              </text>
              <circle cx="91" cy="126" r="10" fill="#10295A" />
              <rect x="110" y="122" width="132" height="7" rx="3.5" fill="#E7C9B0" />
              <circle cx="91" cy="160" r="10" fill="#10295A" />
              <rect x="110" y="156" width="118" height="7" rx="3.5" fill="#E7C9B0" />
            </g>
            <g transform="rotate(32 270 170)">
              <rect x="196" y="160" width="150" height="20" rx="3" fill="#F4C45B" />
              <rect x="186" y="160" width="14" height="20" rx="3" fill="#F3A9C4" />
              <path d="M346 160 L 372 170 L 346 180 Z" fill="#FFE7C2" />
              <path d="M364 167 L 372 170 L 364 173 Z" fill="#3B3F46" />
            </g>
          </svg>
          <span className="hm-cap">Билет</span>
        </div>
        <div className="hm-tile hm-tile--4">
          <svg viewBox="0 0 360 400" preserveAspectRatio="xMidYMid slice">
            <defs>
              <linearGradient id="hm-d-bg" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#F7C9D9" />
                <stop offset="1" stopColor="#F3A25B" />
              </linearGradient>
              <pattern id="hm-d-dn" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(20)">
                <circle cx="3.5" cy="3.5" r="1.6" fill="#2D5FD6" />
              </pattern>
              <linearGradient id="hm-d-sh" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0.35" stopColor="#000000" />
                <stop offset="1" stopColor="#FFFFFF" />
              </linearGradient>
              <mask id="hm-d-m">
                <rect width="360" height="400" fill="url(#hm-d-sh)" />
              </mask>
            </defs>
            <rect width="360" height="400" fill="url(#hm-d-bg)" />
            <path d="M70 150 Q 52 200 70 250" fill="none" stroke="#FFFFFF" strokeWidth="8" strokeLinecap="round" opacity="0.9" />
            <path d="M44 120 Q 16 200 44 280" fill="none" stroke="#FFFFFF" strokeWidth="8" strokeLinecap="round" opacity="0.6" />
            <path d="M290 150 Q 308 200 290 250" fill="none" stroke="#FFFFFF" strokeWidth="8" strokeLinecap="round" opacity="0.9" />
            <path d="M316 120 Q 344 200 316 280" fill="none" stroke="#FFFFFF" strokeWidth="8" strokeLinecap="round" opacity="0.6" />
            <rect x="128" y="88" width="104" height="180" rx="52" fill="#FFF8EE" />
            <rect x="146" y="118" width="68" height="6" rx="3" fill="#E9CDB9" />
            <rect x="146" y="136" width="68" height="6" rx="3" fill="#E9CDB9" />
            <rect x="146" y="154" width="68" height="6" rx="3" fill="#E9CDB9" />
            <path d="M104 214 Q 104 300 180 300 Q 256 300 256 214" fill="none" stroke="#FFF8EE" strokeWidth="12" strokeLinecap="round" />
            <rect x="172" y="300" width="16" height="44" fill="#FFF8EE" />
            <rect x="128" y="340" width="104" height="16" rx="8" fill="#FFF8EE" />
            <rect width="360" height="400" fill="url(#hm-d-dn)" mask="url(#hm-d-m)" opacity="0.28" />
          </svg>
          <span className="hm-cap">Ответ вслух</span>
        </div>
      </div>
    </div>
  );
}
