import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, RotateCcw, HelpCircle, Activity, Info, TrendingUp, Sparkles } from 'lucide-react';

interface Props {
  formulaKey: string; // ohm | compound_interest | pythagoras | kinetic_energy | quadratic | gravity
  onClose?: () => void;
}

export default function FormulaWidget({ formulaKey, onClose }: Props) {
  // Ohm's Law state
  const [ohmU, setOhmU] = useState(12); // Volts
  const [ohmR, setOhmR] = useState(10); // Ohms
  const ohmI = Number((ohmU / ohmR).toFixed(2));

  // Compound Interest state
  const [ciP, setCiP] = useState(10000); // Principal
  const [ciR, setCiR] = useState(10); // Rate %
  const [ciT, setCiT] = useState(10); // Years
  const [ciN, setCiN] = useState(1); // Frequency (1=annual, 12=monthly)
  const computeCI = (year: number) => {
    const rateDecimal = ciR / 100;
    return ciP * Math.pow(1 + rateDecimal / ciN, ciN * year);
  };
  const ciA = computeCI(ciT);
  const ciInterest = ciA - ciP;

  // Pythagoras state
  const [pythA, setPythA] = useState(6);
  const [pythB, setPythB] = useState(8);
  const pythC = Math.sqrt(pythA * pythA + pythB * pythB);

  // Kinetic Energy state
  const [keM, setKeM] = useState(10); // Mass kg
  const [keV, setKeV] = useState(5); // Velocity m/s
  const keEnergy = 0.5 * keM * keV * keV;
  const [keTrigger, setKeTrigger] = useState(false);
  const [isExploding, setIsExploding] = useState(false);

  // Quadratic Equation state
  const [quadA, setQuadA] = useState(1);
  const [quadB, setQuadB] = useState(-2);
  const [quadC, setQuadC] = useState(-3);
  const quadD = quadB * quadB - 4 * quadA * quadC;
  const getRoots = () => {
    if (quadD < 0) return { type: 'complex', text: 'Комплексные корни' };
    if (quadD === 0) {
      const x = -quadB / (2 * quadA);
      return { type: 'one', x1: Number(x.toFixed(2)), text: `x = ${x.toFixed(2)}` };
    }
    const x1 = (-quadB + Math.sqrt(quadD)) / (2 * quadA);
    const x2 = (-quadB - Math.sqrt(quadD)) / (2 * quadA);
    return { 
      type: 'two', 
      x1: Number(x1.toFixed(2)), 
      x2: Number(x2.toFixed(2)), 
      text: `x₁ = ${x1.toFixed(2)}, x₂ = ${x2.toFixed(2)}` 
    };
  };
  const quadRoots = getRoots();

  // Newton's Gravity state
  const [gravM1, setGravM1] = useState(50);
  const [gravM2, setGravM2] = useState(30);
  const [gravR, setGravR] = useState(150); // Distance
  // G scaled for nice visuals
  const G = 10;
  const gravF = (G * gravM1 * gravM2) / ((gravR / 50) * (gravR / 50));

  // Trigger kinetic impact animation
  const runKineticImpact = () => {
    if (keTrigger) return;
    setKeTrigger(true);
    setTimeout(() => {
      setIsExploding(true);
      setTimeout(() => setIsExploding(false), 500);
    }, 800); // Impact delay matching transition duration
  };

  const resetKinetic = () => {
    setKeTrigger(false);
    setIsExploding(false);
  };

  return (
    <div className="card p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-lg relative overflow-hidden transition-all duration-300">
      <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/5 rounded-full blur-3xl pointer-events-none" />
      
      {/* Title */}
      <div className="flex items-center justify-between mb-4 border-b border-slate-100 dark:border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-indigo-500 dark:text-indigo-400" />
          <h4 className="font-extrabold text-sm text-slate-800 dark:text-slate-200">
            {formulaKey === 'ohm' && '🔌 Визуальный симулятор: Закон Ома'}
            {formulaKey === 'compound_interest' && '📈 Калькулятор роста: Сложные проценты'}
            {formulaKey === 'pythagoras' && '📐 Геометрия в действии: Теорема Пифагора'}
            {formulaKey === 'kinetic_energy' && '💥 Эксперимент: Кинетическая энергия'}
            {formulaKey === 'quadratic' && '📊 Исследование функции: Квадратное уравнение'}
            {formulaKey === 'gravity' && '🌌 Космические силы: Закон всемирного тяготения'}
          </h4>
        </div>
        {onClose && (
          <button 
            onClick={onClose} 
            className="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition"
          >
            Скрыть
          </button>
        )}
      </div>

      {/* Grid Container for Layout */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
        
        {/* LEFT COLUMN: SLIDERS & CONTROLS */}
        <div className="space-y-4">
          
          {/* 1. OHM'S LAW SLIDERS */}
          {formulaKey === 'ohm' && (
            <>
              <div className="space-y-1">
                <div className="flex justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
                  <span>Напряжение (U):</span>
                  <span className="text-indigo-600 dark:text-indigo-400 font-bold">{ohmU} В</span>
                </div>
                <input 
                  type="range" min="1" max="24" step="0.5" value={ohmU} 
                  onChange={e => setOhmU(Number(e.target.value))} 
                  className="w-full accent-indigo-600 cursor-pointer h-1.5 bg-slate-100 dark:bg-slate-800 rounded-lg appearance-none" 
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
                  <span>Сопротивление (R):</span>
                  <span className="text-amber-600 dark:text-amber-400 font-bold">{ohmR} Ом</span>
                </div>
                <input 
                  type="range" min="1" max="50" step="0.5" value={ohmR} 
                  onChange={e => setOhmR(Number(e.target.value))} 
                  className="w-full accent-amber-500 cursor-pointer h-1.5 bg-slate-100 dark:bg-slate-800 rounded-lg appearance-none" 
                />
              </div>

              <div className="p-3 bg-indigo-50 dark:bg-indigo-950/20 border border-indigo-100 dark:border-indigo-900/30 rounded-2xl flex items-center justify-between">
                <span className="text-xs font-extrabold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Сила тока (I):</span>
                <span className="text-xl font-black text-indigo-600 dark:text-indigo-400">{ohmI} А</span>
              </div>
            </>
          )}

          {/* 2. COMPOUND INTEREST SLIDERS */}
          {formulaKey === 'compound_interest' && (
            <>
              <div className="space-y-1">
                <div className="flex justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
                  <span>Начальный капитал (P):</span>
                  <span className="text-indigo-600 dark:text-indigo-400 font-bold">{ciP.toLocaleString()} руб.</span>
                </div>
                <input 
                  type="range" min="1000" max="100000" step="1000" value={ciP} 
                  onChange={e => setCiP(Number(e.target.value))} 
                  className="w-full accent-indigo-600 cursor-pointer h-1.5 bg-slate-100 dark:bg-slate-800 rounded-lg appearance-none" 
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
                  <span>Годовая ставка (r):</span>
                  <span className="text-emerald-600 dark:text-emerald-400 font-bold">{ciR}%</span>
                </div>
                <input 
                  type="range" min="1" max="30" step="0.5" value={ciR} 
                  onChange={e => setCiR(Number(e.target.value))} 
                  className="w-full accent-emerald-500 cursor-pointer h-1.5 bg-slate-100 dark:bg-slate-800 rounded-lg appearance-none" 
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
                  <span>Срок инвестиций (t):</span>
                  <span className="text-amber-600 dark:text-amber-400 font-bold">{ciT} лет</span>
                </div>
                <input 
                  type="range" min="1" max="30" step="1" value={ciT} 
                  onChange={e => setCiT(Number(e.target.value))} 
                  className="w-full accent-amber-500 cursor-pointer h-1.5 bg-slate-100 dark:bg-slate-800 rounded-lg appearance-none" 
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="p-3 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/30 rounded-2xl">
                  <span className="text-[9px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider block">Накоплено:</span>
                  <span className="text-sm font-extrabold text-emerald-600 dark:text-emerald-400">{Math.round(ciA).toLocaleString()} руб.</span>
                </div>
                <div className="p-3 bg-indigo-50 dark:bg-indigo-950/20 border border-indigo-100 dark:border-indigo-900/30 rounded-2xl">
                  <span className="text-[9px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider block">Чистая прибыль:</span>
                  <span className="text-sm font-extrabold text-indigo-600 dark:text-indigo-400">{Math.round(ciInterest).toLocaleString()} руб.</span>
                </div>
              </div>
            </>
          )}

          {/* 3. PYTHAGORAS SLIDERS */}
          {formulaKey === 'pythagoras' && (
            <>
              <div className="space-y-1">
                <div className="flex justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
                  <span>Катет A:</span>
                  <span className="text-amber-600 dark:text-amber-400 font-bold">{pythA} см</span>
                </div>
                <input 
                  type="range" min="3" max="12" step="1" value={pythA} 
                  onChange={e => setPythA(Number(e.target.value))} 
                  className="w-full accent-amber-500 cursor-pointer h-1.5 bg-slate-100 dark:bg-slate-800 rounded-lg appearance-none" 
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
                  <span>Катет B:</span>
                  <span className="text-emerald-600 dark:text-emerald-400 font-bold">{pythB} см</span>
                </div>
                <input 
                  type="range" min="3" max="12" step="1" value={pythB} 
                  onChange={e => setPythB(Number(e.target.value))} 
                  className="w-full accent-emerald-500 cursor-pointer h-1.5 bg-slate-100 dark:bg-slate-800 rounded-lg appearance-none" 
                />
              </div>

              <div className="p-3 bg-indigo-50 dark:bg-indigo-950/20 border border-indigo-100 dark:border-indigo-900/30 rounded-2xl">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-extrabold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Гипотенуза C:</span>
                  <span className="text-base font-black text-indigo-600 dark:text-indigo-400">{pythC.toFixed(2)} см</span>
                </div>
                <div className="text-[10px] text-slate-400 dark:text-slate-500 mt-1 font-mono">
                  {pythA}² + {pythB}² = {pythA*pythA} + {pythB*pythB} = {pythA*pythA + pythB*pythB} (√{pythA*pythA + pythB*pythB} ≈ {pythC.toFixed(2)})
                </div>
              </div>
            </>
          )}

          {/* 4. KINETIC ENERGY SLIDERS */}
          {formulaKey === 'kinetic_energy' && (
            <>
              <div className="space-y-1">
                <div className="flex justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
                  <span>Масса (m):</span>
                  <span className="text-indigo-600 dark:text-indigo-400 font-bold">{keM} кг</span>
                </div>
                <input 
                  type="range" min="1" max="50" step="1" value={keM} 
                  onChange={e => setKeM(Number(e.target.value))} 
                  className="w-full accent-indigo-600 cursor-pointer h-1.5 bg-slate-100 dark:bg-slate-800 rounded-lg appearance-none" 
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
                  <span>Скорость (v):</span>
                  <span className="text-amber-600 dark:text-amber-400 font-bold">{keV} м/с</span>
                </div>
                <input 
                  type="range" min="1" max="30" step="1" value={keV} 
                  onChange={e => setKeV(Number(e.target.value))} 
                  className="w-full accent-amber-500 cursor-pointer h-1.5 bg-slate-100 dark:bg-slate-800 rounded-lg appearance-none" 
                />
              </div>

              <div className="flex gap-2">
                <button 
                  onClick={runKineticImpact}
                  disabled={keTrigger}
                  className="flex-1 px-4 py-2.5 bg-rose-600 hover:bg-rose-700 disabled:bg-rose-800/30 text-white rounded-xl text-xs font-extrabold flex items-center justify-center gap-1.5 transition shadow-md shadow-rose-600/10"
                >
                  <Play className="w-3.5 h-3.5 fill-current" /> Запустить удар
                </button>
                {keTrigger && (
                  <button 
                    onClick={resetKinetic}
                    className="p-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl transition"
                    title="Сбросить"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                )}
              </div>

              <div className="p-3 bg-rose-50 dark:bg-rose-950/10 border border-rose-100 dark:border-rose-900/20 rounded-2xl flex items-center justify-between">
                <span className="text-xs font-extrabold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Энергия (Ek):</span>
                <span className="text-base font-black text-rose-600 dark:text-rose-400">{keEnergy.toLocaleString()} Дж</span>
              </div>
            </>
          )}

          {/* 5. QUADRATIC EQUATION SLIDERS */}
          {formulaKey === 'quadratic' && (
            <>
              <div className="space-y-1">
                <div className="flex justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
                  <span>Коэффициент a:</span>
                  <span className="text-indigo-600 dark:text-indigo-400 font-bold">{quadA}</span>
                </div>
                <input 
                  type="range" min="-5" max="5" step="0.5" value={quadA} 
                  onChange={e => {
                    const val = Number(e.target.value);
                    setQuadA(val === 0 ? 0.5 : val); // prevent division by zero
                  }} 
                  className="w-full accent-indigo-600 cursor-pointer h-1.5 bg-slate-100 dark:bg-slate-800 rounded-lg appearance-none" 
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
                  <span>Коэффициент b:</span>
                  <span className="text-amber-600 dark:text-amber-400 font-bold">{quadB}</span>
                </div>
                <input 
                  type="range" min="-10" max="10" step="0.5" value={quadB} 
                  onChange={e => setQuadB(Number(e.target.value))} 
                  className="w-full accent-amber-500 cursor-pointer h-1.5 bg-slate-100 dark:bg-slate-800 rounded-lg appearance-none" 
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
                  <span>Коэффициент c:</span>
                  <span className="text-emerald-600 dark:text-emerald-400 font-bold">{quadC}</span>
                </div>
                <input 
                  type="range" min="-10" max="10" step="0.5" value={quadC} 
                  onChange={e => setQuadC(Number(e.target.value))} 
                  className="w-full accent-emerald-500 cursor-pointer h-1.5 bg-slate-100 dark:bg-slate-800 rounded-lg appearance-none" 
                />
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="p-2.5 bg-slate-50 dark:bg-slate-800/40 border border-slate-150 dark:border-slate-800 rounded-2xl">
                  <span className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-wider block">Дискриминант (D):</span>
                  <span className={`font-black text-xs ${quadD >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{quadD}</span>
                </div>
                <div className="p-2.5 bg-indigo-50 dark:bg-indigo-950/20 border border-indigo-100 dark:border-indigo-900/30 rounded-2xl">
                  <span className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-wider block">Корни уравнения:</span>
                  <span className="font-extrabold text-[11px] text-indigo-600 dark:text-indigo-400 truncate block">{quadRoots.text}</span>
                </div>
              </div>
            </>
          )}

          {/* 6. NEWTON'S GRAVITY SLIDERS */}
          {formulaKey === 'gravity' && (
            <>
              <div className="space-y-1">
                <div className="flex justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
                  <span>Масса Планеты 1 (m₁):</span>
                  <span className="text-indigo-600 dark:text-indigo-400 font-bold">{gravM1} т</span>
                </div>
                <input 
                  type="range" min="10" max="100" step="2" value={gravM1} 
                  onChange={e => setGravM1(Number(e.target.value))} 
                  className="w-full accent-indigo-600 cursor-pointer h-1.5 bg-slate-100 dark:bg-slate-800 rounded-lg appearance-none" 
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
                  <span>Масса Планеты 2 (m₂):</span>
                  <span className="text-emerald-600 dark:text-emerald-400 font-bold">{gravM2} т</span>
                </div>
                <input 
                  type="range" min="10" max="100" step="2" value={gravM2} 
                  onChange={e => setGravM2(Number(e.target.value))} 
                  className="w-full accent-emerald-500 cursor-pointer h-1.5 bg-slate-100 dark:bg-slate-800 rounded-lg appearance-none" 
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
                  <span>Расстояние (r):</span>
                  <span className="text-amber-600 dark:text-amber-400 font-bold">{gravR} млн км</span>
                </div>
                <input 
                  type="range" min="60" max="240" step="5" value={gravR} 
                  onChange={e => setGravR(Number(e.target.value))} 
                  className="w-full accent-amber-500 cursor-pointer h-1.5 bg-slate-100 dark:bg-slate-800 rounded-lg appearance-none" 
                />
              </div>

              <div className="p-3 bg-violet-50 dark:bg-violet-950/20 border border-violet-100 dark:border-violet-900/30 rounded-2xl flex items-center justify-between">
                <span className="text-xs font-extrabold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Сила притяжения (F):</span>
                <span className="text-base font-black text-violet-600 dark:text-violet-400">{Math.round(gravF).toLocaleString()} H</span>
              </div>
            </>
          )}

        </div>

        {/* RIGHT COLUMN: HIGH-FIDELITY INTERACTIVE VISUALS (DARK-MODE READY SVG/CSS) */}
        <div className="bg-slate-50 dark:bg-slate-950/40 border border-slate-100 dark:border-slate-850 rounded-2xl p-4 flex items-center justify-center min-h-[220px] relative overflow-hidden">
          
          {/* OHM'S LAW VISUAL */}
          {formulaKey === 'ohm' && (
            <div className="w-full space-y-4">
              <svg className="w-full h-28" viewBox="0 0 300 110">
                {/* Circuit wire outline */}
                <rect 
                  x="20" y="35" width="260" height={Math.max(6, 26 - ohmR/2.5)} rx={Math.max(3, 13 - ohmR/5)} 
                  fill="none" 
                  stroke="currentColor" 
                  className="text-slate-200 dark:text-slate-800 transition-all duration-300"
                  strokeWidth="2.5"
                />
                
                {/* Constriction zone (resistor icon concept) */}
                <rect 
                  x="130" y={35 + Math.max(0, 10 - ohmR/5)} width="40" height={Math.max(4, 6 - ohmR/6)}
                  fill="currentColor"
                  className="text-amber-500/20 dark:text-amber-500/10 transition-all duration-300"
                />
                
                {/* Electrons animating through wire */}
                {Array.from({ length: 8 }).map((_, idx) => {
                  const delay = (idx * 0.4) / (ohmI || 0.1);
                  return (
                    <motion.circle
                      key={idx}
                      cx="0"
                      cy="35"
                      r={Math.max(2, 4.5 - ohmR/16)}
                      fill="#4f46e5"
                      className="text-indigo-500 dark:text-indigo-400 shadow-lg"
                      style={{
                        y: Math.max(3, 13 - ohmR/5) / 2
                      }}
                      animate={{
                        cx: [25, 275]
                      }}
                      transition={{
                        duration: Math.max(0.2, 3.5 / (ohmI || 0.1)),
                        repeat: Infinity,
                        ease: "linear",
                        delay: delay
                      }}
                    />
                  );
                })}

                {/* Circuit meter */}
                <path d="M 20 85 Q 150 110 280 85" fill="none" stroke="#e2e8f0" className="dark:stroke-slate-800" strokeWidth="2" strokeDasharray="4 4" />
                <circle cx="150" cy="98" r="8" fill="#e2e8f0" className="dark:fill-slate-800" />
                
                {/* Voltmeter Arrow indicator */}
                <motion.line 
                  x1="150" y1="98" x2="150" y2="78" 
                  stroke="#4f46e5" strokeWidth="2.5" strokeLinecap="round"
                  animate={{
                    transformOrigin: "150px 98px",
                    rotate: [-30 + ohmU * 2.5, -30 + ohmU * 2.5]
                  }}
                  transition={{ type: "spring", stiffness: 60 }}
                />
              </svg>
              <div className="text-center text-[10px] text-slate-400 dark:text-slate-500 flex justify-center items-center gap-4">
                <span>⚡ Быстрые электроны = Высокий ток I</span>
                <span>🔒 Узкий провод = Высокое R</span>
              </div>
            </div>
          )}

          {/* COMPOUND INTEREST VISUAL (GROWTH CHART) */}
          {formulaKey === 'compound_interest' && (
            <div className="w-full">
              <svg className="w-full h-36" viewBox="0 0 300 130">
                {/* Helper Grid lines */}
                <line x1="30" y1="10" x2="30" y2="110" stroke="#f1f5f9" className="dark:stroke-slate-900" strokeWidth="1" />
                <line x1="30" y1="110" x2="280" y2="110" stroke="#f1f5f9" className="dark:stroke-slate-900" strokeWidth="1" />
                
                {/* Generate graph path points */}
                {(() => {
                  const points = [];
                  const count = Math.max(ciT, 1);
                  for (let i = 0; i <= count; i++) {
                    const yearFraction = i / count;
                    const x = 30 + yearFraction * 240;
                    
                    const val = computeCI(i);
                    const maxVal = computeCI(ciT) || 1;
                    const y = 110 - (val / maxVal) * 90;
                    points.push(`${x},${y}`);
                  }
                  
                  const pathD = `M ${points.join(' L ')}`;
                  const areaD = `${pathD} L 270,110 L 30,110 Z`;

                  return (
                    <>
                      {/* Gradient Fill under path */}
                      <defs>
                        <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#10b981" stopOpacity="0.15" />
                          <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
                        </linearGradient>
                      </defs>
                      <path d={areaD} fill="url(#chartGrad)" />

                      {/* Line Path */}
                      <motion.path 
                        d={pathD} 
                        fill="none" 
                        stroke="#10b981" 
                        strokeWidth="3" 
                        strokeLinecap="round"
                        initial={{ pathLength: 0 }}
                        animate={{ pathLength: 1 }}
                        transition={{ duration: 0.6 }}
                      />

                      {/* Interactive Dot at last coordinate */}
                      {points.length > 0 && (() => {
                        const lastPt = points[points.length - 1].split(',');
                        return (
                          <g>
                            <circle cx={lastPt[0]} cy={lastPt[1]} r="7" fill="#10b981" />
                            <circle cx={lastPt[0]} cy={lastPt[1]} r="12" fill="none" stroke="#10b981" strokeWidth="1.5" className="animate-ping opacity-70" />
                          </g>
                        );
                      })()}
                    </>
                  );
                })()}

                {/* X and Y labels */}
                <text x="32" y="122" className="text-[8px] font-bold fill-slate-400 dark:fill-slate-500">0 лет</text>
                <text x="255" y="122" className="text-[8px] font-bold fill-slate-400 dark:fill-slate-500">{ciT} лет</text>
                <text x="32" y="102" className="text-[8px] fill-slate-400 dark:fill-slate-500">P = {ciP.toLocaleString()}</text>
              </svg>
            </div>
          )}

          {/* PYTHAGOREAN THEOREM VISUAL */}
          {formulaKey === 'pythagoras' && (
            <div className="w-full flex items-center justify-center">
              <svg className="w-48 h-48" viewBox="0 0 160 160">
                {/* Scale parameters dynamically */}
                {(() => {
                  const scale = 5;
                  const x0 = 50;
                  const y0 = 100;
                  const dx = pythB * scale;
                  const dy = pythA * scale;

                  // Triangle points:
                  // Origin (Right angle): x0, y0
                  // Top (A): x0, y0 - dy
                  // Right (B): x0 + dx, y0

                  return (
                    <g>
                      {/* Grid background */}
                      <path d="M 0,0 L 160,0 M 0,20 L 160,20 M 0,40 L 160,40 M 0,60 L 160,60 M 0,80 L 160,80 M 0,100 L 160,100 M 0,120 L 160,120 M 0,140 L 160,140" stroke="#f1f5f9" className="dark:stroke-slate-900" strokeWidth="0.5" />
                      <path d="M 0,0 L 0,160 M 20,0 L 20,160 M 40,0 L 40,160 M 60,0 L 60,160 M 80,0 L 80,160 M 100,0 L 100,160 M 120,0 L 120,160 M 140,0 L 140,160" stroke="#f1f5f9" className="dark:stroke-slate-900" strokeWidth="0.5" />

                      {/* Square A (Left) */}
                      <rect 
                        x={x0 - dy} y={y0 - dy} width={dy} height={dy} 
                        fill="#f59e0b" fillOpacity="0.1" stroke="#f59e0b" strokeWidth="1" strokeDasharray="3 3" 
                      />
                      <text x={x0 - dy/2} y={y0 - dy/2 + 3} textAnchor="middle" className="text-[7px] font-bold fill-amber-600 dark:fill-amber-400">a²={pythA*pythA}</text>

                      {/* Square B (Bottom) */}
                      <rect 
                        x={x0} y={y0} width={dx} height={dx} 
                        fill="#10b981" fillOpacity="0.1" stroke="#10b981" strokeWidth="1" strokeDasharray="3 3" 
                      />
                      <text x={x0 + dx/2} y={y0 + dx/2 + 3} textAnchor="middle" className="text-[7px] font-bold fill-emerald-600 dark:fill-emerald-400">b²={pythB*pythB}</text>

                      {/* Square C (Hypotenuse - drawn along rotation) */}
                      {(() => {
                        const angle = Math.atan2(dy, dx) * (180 / Math.PI);
                        const cLength = Math.sqrt(dx*dx + dy*dy);
                        return (
                          <g transform={`translate(${x0}, ${y0 - dy}) rotate(${angle})`}>
                            <rect 
                              x="0" y={-cLength} width={cLength} height={cLength} 
                              fill="#4f46e5" fillOpacity="0.1" stroke="#4f46e5" strokeWidth="1" strokeDasharray="2 2"
                            />
                            <text x={cLength/2} y={-cLength/2 + 3} textAnchor="middle" className="text-[7px] font-bold fill-indigo-600 dark:fill-indigo-400">c²={pythA*pythA + pythB*pythB}</text>
                          </g>
                        );
                      })()}

                      {/* Right Angle square mark */}
                      <rect x={x0} y={y0 - 6} width="6" height="6" fill="none" stroke="#64748b" className="dark:stroke-slate-500" strokeWidth="1" />

                      {/* The Right Triangle */}
                      <polygon 
                        points={`${x0},${y0} ${x0},${y0 - dy} ${x0 + dx},${y0}`} 
                        fill="#e2e8f0"
                        stroke="#0f172a"
                        className="dark:fill-slate-800 dark:stroke-slate-100"
                        strokeWidth="1.5"
                      />
                    </g>
                  );
                })()}
              </svg>
            </div>
          )}

          {/* KINETIC ENERGY IMPACT VISUAL */}
          {formulaKey === 'kinetic_energy' && (
            <div className="w-full flex flex-col items-center">
              <div className="w-full h-32 relative border-b-2 border-slate-350 dark:border-slate-855 overflow-hidden">
                
                {/* Iron ball */}
                <motion.div
                  className="absolute bottom-0 bg-indigo-600 dark:bg-indigo-400 rounded-full shadow-lg border border-white/20"
                  style={{
                    width: Math.min(60, 20 + keM * 0.8),
                    height: Math.min(60, 20 + keM * 0.8),
                    left: 20
                  }}
                  animate={keTrigger ? {
                    left: 190 - Math.min(60, 20 + keM * 0.8)
                  } : {
                    left: 20
                  }}
                  transition={{
                    duration: 0.8,
                    ease: "easeIn"
                  }}
                />

                {/* Wall Barrier */}
                <div 
                  className="absolute right-14 bottom-0 w-8 h-20 bg-slate-300 dark:bg-slate-800 border-l border-y border-slate-400 dark:border-slate-700 shadow-inner rounded-r-md flex items-center justify-center text-[9px] font-black text-slate-500"
                >
                  СТЕНА
                </div>

                {/* Impact Wave Rings */}
                <AnimatePresence>
                  {isExploding && (
                    <motion.div
                      className="absolute right-[88px] bottom-0 border-4 border-rose-500/80 rounded-full"
                      style={{
                        width: 10,
                        height: 10,
                        y: 10
                      }}
                      initial={{ opacity: 1, scale: 0.5, borderWidth: 8 }}
                      animate={{
                        opacity: 0,
                        scale: Math.max(1.5, keEnergy / 250),
                        borderWidth: 1
                      }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.5, ease: "easeOut" }}
                    />
                  )}
                </AnimatePresence>
              </div>
              <div className="text-center text-[10px] text-slate-400 dark:text-slate-500 mt-3 italic flex items-center gap-1.5 justify-center">
                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                <span>Масса и скорость повышают энергию взрыва!</span>
              </div>
            </div>
          )}

          {/* QUADRATIC PARABOLA PLOT */}
          {formulaKey === 'quadratic' && (
            <div className="w-full">
              <svg className="w-full h-36" viewBox="0 0 300 130">
                {/* Plot Grid lines */}
                <line x1="150" y1="10" x2="150" y2="120" stroke="#cbd5e1" className="dark:stroke-slate-800" strokeWidth="1" />
                <line x1="10" y1="65" x2="290" y2="65" stroke="#cbd5e1" className="dark:stroke-slate-800" strokeWidth="1" />
                
                {/* Parabola plotting */}
                {(() => {
                  const points = [];
                  const w = 300;
                  const h = 130;
                  const centerX = 150;
                  const centerY = 65;
                  const scaleX = 14;
                  const scaleY = 4; // scaled down to fit higher values of y

                  for (let px = 10; px <= 290; px += 2) {
                    const x = (px - centerX) / scaleX;
                    const y = quadA * x * x + quadB * x + quadC;
                    const py = centerY - y * scaleY;
                    if (py >= 5 && py <= 125) {
                      points.push(`${px},${py}`);
                    }
                  }
                  
                  const pathD = points.length > 0 ? `M ${points.join(' L ')}` : '';

                  return (
                    <g>
                      {/* Parabola curve */}
                      {pathD && (
                        <motion.path 
                          d={pathD} 
                          fill="none" 
                          stroke="#6366f1" 
                          strokeWidth="2.5"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ duration: 0.2 }}
                        />
                      )}

                      {/* Display root marks if they are real */}
                      {quadRoots.type === 'two' && typeof quadRoots.x1 === 'number' && typeof quadRoots.x2 === 'number' && (
                        <>
                          <circle cx={centerX + quadRoots.x1 * scaleX} cy={centerY} r="5" fill="#10b981" stroke="white" strokeWidth="1" />
                          <circle cx={centerX + quadRoots.x2 * scaleX} cy={centerY} r="5" fill="#10b981" stroke="white" strokeWidth="1" />
                        </>
                      )}

                      {quadRoots.type === 'one' && typeof quadRoots.x1 === 'number' && (
                        <circle cx={centerX + quadRoots.x1 * scaleX} cy={centerY} r="5" fill="#10b981" stroke="white" strokeWidth="1" />
                      )}

                      {/* Parabola Vertex indicator */}
                      {(() => {
                        const vx = -quadB / (2 * quadA);
                        const vy = quadA * vx * vx + quadB * vx + quadC;
                        const vpx = centerX + vx * scaleX;
                        const vpy = centerY - vy * scaleY;
                        if (vpy >= 0 && vpy <= 130) {
                          return <circle cx={vpx} cy={vpy} r="3" fill="#f59e0b" />;
                        }
                        return null;
                      })()}
                    </g>
                  );
                })()}
              </svg>
            </div>
          )}

          {/* NEWTON'S GRAVITATIONAL SYSTEM */}
          {formulaKey === 'gravity' && (
            <div className="w-full h-full flex items-center justify-center">
              <svg className="w-full h-36" viewBox="0 0 300 130">
                {/* Distance dotted line */}
                <line 
                  x1={150 - gravR/2} y1="65" x2={150 + gravR/2} y2="65" 
                  stroke="#cbd5e1" className="dark:stroke-slate-800" 
                  strokeWidth="1.5" strokeDasharray="3 3" 
                />
                
                {/* Gravitational pull field force arrows */}
                {(() => {
                  const arrowWidth = Math.min(10, 1 + gravF / 15);
                  const arrowColor = gravF > 30 ? "#8b5cf6" : "#c084fc";
                  
                  return (
                    <g>
                      {/* Arrow Left to Right */}
                      <path 
                        d={`M ${150 - gravR/2 + 25} 65 L ${150 + gravR/2 - 25} 65`} 
                        stroke={arrowColor} 
                        strokeWidth={arrowWidth} 
                        markerEnd="url(#arrow)" 
                      />
                      
                      {/* Force indicators glow rings around planets */}
                      <circle 
                        cx={150 - gravR/2} cy="65" 
                        r={Math.max(12, 10 + gravM1 / 5) + Math.min(10, gravF / 10)} 
                        fill="none" stroke="#6366f1" strokeWidth="1" strokeDasharray="4 4"
                        className="animate-spin"
                        style={{ animationDuration: '8s' }}
                      />
                      <circle 
                        cx={150 + gravR/2} cy="65" 
                        r={Math.max(8, 8 + gravM2 / 5) + Math.min(10, gravF / 10)} 
                        fill="none" stroke="#10b981" strokeWidth="1" strokeDasharray="4 4"
                        className="animate-spin"
                        style={{ animationDuration: '10s' }}
                      />
                    </g>
                  );
                })()}

                {/* Planet 1 (Mass 1) */}
                <circle 
                  cx={150 - gravR/2} cy="65" 
                  r={Math.max(12, 10 + gravM1 / 5)} 
                  fill="#4f46e5" className="dark:fill-indigo-500 shadow-md"
                />
                <text 
                  x={150 - gravR/2} y="68" 
                  textAnchor="middle" 
                  className="text-[8px] font-black fill-white"
                >
                  m₁
                </text>

                {/* Planet 2 (Mass 2) */}
                <circle 
                  cx={150 + gravR/2} cy="65" 
                  r={Math.max(8, 8 + gravM2 / 5)} 
                  fill="#10b981" className="dark:fill-emerald-500 shadow-md"
                />
                <text 
                  x={150 + gravR/2} y="68" 
                  textAnchor="middle" 
                  className="text-[8px] font-black fill-white"
                >
                  m₂
                </text>
              </svg>
            </div>
          )}

        </div>
      </div>

      {/* FOOTER TEXTUAL EXPLANATION */}
      <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400 flex gap-1.5 items-start">
        <Info className="w-4 h-4 text-indigo-500 shrink-0 mt-0.5" />
        <p className="leading-relaxed">
          {formulaKey === 'ohm' && 'Закон Ома связывает силу тока (I), напряжение (U) и сопротивление (R). Увеличивая напряжение, вы выталкиваете больше электронов через цепь, а увеличение сопротивления сужает проводник и мешает их свободному движению.'}
          {formulaKey === 'compound_interest' && 'Сложные проценты начисляются не только на исходную сумму, но и на проценты, заработанные в прошлые периоды. Это создает экспоненциальный взрыв накоплений («эффект снежного кома»).'}
          {formulaKey === 'pythagoras' && 'Теорема Пифагора утверждает, что в прямоугольном треугольнике площадь квадрата, построенного на гипотенузе (c²), в точности равна сумме площадей квадратов, построенных на двух катетах (a² + b²).'}
          {formulaKey === 'kinetic_energy' && 'Кинетическая энергия зависит от массы объекта и КВАДРАТА его скорости. Это значит, что если автомобиль увеличит скорость в 3 раза, его разрушительная сила при ударе возрастет в целых 9 раз!'}
          {formulaKey === 'quadratic' && 'Решения квадратного уравнения представляют собой точки пересечения параболы с осью абсцисс (X). Дискриминант (D) показывает, сколько таких пересечений существует (2, 1 или ни одного).'}
          {formulaKey === 'gravity' && 'Все тела во Вселенной притягиваются друг к другу. Сила гравитации растет с увеличением массы тел, но стремительно падает с увеличением расстояния между ними (обратно пропорционально квадрату расстояния r²).'}
        </p>
      </div>

    </div>
  );
}
