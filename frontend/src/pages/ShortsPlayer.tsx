import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Heart, Bookmark, Volume2, Share2, Play, Pause, X } from 'lucide-react';
import { getMaterialById } from '../api/materials';
import { playTTS, stopTTS, pauseTTS, resumeTTS, getTTSPlaybackRate, setTTSPlaybackRate } from '../utils/tts';
import toast from 'react-hot-toast';

const GRADIENTS = [
  'from-pink-500 to-rose-500',
  'from-violet-500 to-purple-500',
  'from-blue-500 to-cyan-500',
  'from-emerald-400 to-cyan-400',
  'from-amber-400 to-orange-500',
];

const EMOJIS = ['💡', '🧠', '⚡', '🔥', '🚀', '🎯', '✨', '📚'];

export default function ShortsPlayer() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [material, setMaterial] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [slides, setSlides] = useState<any[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isWaitingTTS, setIsWaitingTTS] = useState(false);
  
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!id) return;
    getMaterialById(id)
      .then(data => {
        setMaterial(data);
        
        // Convert flashcards to shorts
        const cards = data.flashcards_json?.flashcards || [];
        if (cards.length > 0) {
          const generatedSlides = cards.map((c: any, i: number) => ({
            id: i,
            title: c.question,
            content: c.answer,
            gradient: GRADIENTS[i % GRADIENTS.length],
            emoji: EMOJIS[i % EMOJIS.length],
          }));
          setSlides(generatedSlides);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
      
    return () => {
      stopTTS();
    };
  }, [id]);

  useEffect(() => {
    const handleScroll = () => {
      if (!containerRef.current) return;
      const index = Math.round(containerRef.current.scrollTop / window.innerHeight);
      if (index !== activeIndex) {
        setActiveIndex(index);
        stopTTS();
        setIsPlaying(false);
        setIsWaitingTTS(false);
      }
    };
    
    const container = containerRef.current;
    if (container) {
      container.addEventListener('scroll', handleScroll, { passive: true });
    }
    return () => {
      if (container) container.removeEventListener('scroll', handleScroll);
    };
  }, [activeIndex]);

  useEffect(() => {
    if (slides.length > 0 && activeIndex >= 0 && activeIndex < slides.length) {
      const slide = slides[activeIndex];
      handlePlayTTS(`${slide.title}. ${slide.content}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, slides]);

  const handlePlayTTS = (text: string) => {
    if (isPlaying) {
      stopTTS();
      setIsPlaying(false);
      setIsWaitingTTS(false);
      return;
    }
    
    setIsPlaying(true);
    setIsWaitingTTS(true);
    // Исключительно премиум голос (professor / male / female - мы используем female для шортсов как более мягкий)
    playTTS(
      text, 
      'female', 
      () => { setIsPlaying(false); setIsWaitingTTS(false); }, 
      () => { setIsPlaying(false); setIsWaitingTTS(false); }
    ).then(() => {
      setIsWaitingTTS(false);
    }).catch(() => {
      setIsPlaying(false);
      setIsWaitingTTS(false);
    });
  };

  if (loading) {
    return (
      <div className="h-[100dvh] w-full bg-slate-950 flex flex-col items-center justify-center text-white">
        <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="font-medium animate-pulse">Готовим ленту...</p>
      </div>
    );
  }

  if (slides.length === 0) {
    return (
      <div className="h-[100dvh] w-full bg-slate-950 flex flex-col items-center justify-center text-white p-6 text-center">
        <div className="w-20 h-20 bg-slate-800 rounded-full flex items-center justify-center mb-6">
          <X className="w-10 h-10 text-slate-400" />
        </div>
        <h2 className="text-2xl font-bold mb-3">Нет карточек</h2>
        <p className="text-slate-400 mb-8 max-w-sm">
          Чтобы листать карточки лентой, сначала создайте карточки для этого материала.
        </p>
        <button 
          onClick={() => navigate(`/library/${id}`)}
          className="px-6 py-3 bg-indigo-600 rounded-xl font-bold"
        >
          Вернуться к материалу
        </button>
      </div>
    );
  }

  return (
    <div className="h-[100dvh] w-full bg-black relative overflow-hidden">
      {/* Top Bar (Overlay) */}
      <div className="absolute top-0 left-0 right-0 z-50 p-4 md:p-6 flex items-center justify-between bg-gradient-to-b from-black/60 to-transparent pointer-events-none">
        <button 
          onClick={() => navigate(`/library/${id}`)}
          className="w-10 h-10 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center text-white pointer-events-auto transition hover:bg-black/60"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="text-white/80 font-bold text-sm bg-black/30 px-3 py-1.5 rounded-full pointer-events-auto backdrop-blur-md border border-white/10">
          Карточки лентой
        </div>
      </div>

      {/* Snap Scroll Container */}
      <div 
        ref={containerRef}
        className="h-[100dvh] w-full overflow-y-scroll snap-y snap-mandatory no-scrollbar"
      >
        {slides.map((slide, index) => {
          const isActive = index === activeIndex;
          
          return (
            <div 
              key={slide.id} 
              className={`h-[100dvh] w-full snap-start relative flex flex-col justify-center bg-gradient-to-br ${slide.gradient}`}
            >
              {/* Noise overlay */}
              <div className="absolute inset-0 opacity-10 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] mix-blend-overlay"></div>
              
              <div className="absolute inset-0 bg-black/20" /> {/* Darken slightly for text readability */}

              {/* Main Content */}
              <div className="relative z-10 p-8 md:p-12 pr-20 md:pr-24 max-w-4xl mx-auto w-full flex flex-col items-start">
                <motion.div
                  initial={{ opacity: 0, y: 30, scale: 0.9 }}
                  whileInView={{ opacity: 1, y: 0, scale: 1 }}
                  viewport={{ amount: 0.4 }}
                  transition={{ duration: 0.5, type: "spring", bounce: 0.4 }}
                  className="w-full"
                >
                  <div className="text-6xl md:text-8xl mb-6 filter drop-shadow-lg">{slide.emoji}</div>
                  <h2 className="text-3xl md:text-5xl font-black text-white mb-6 leading-tight drop-shadow-md">
                    {slide.title}
                  </h2>
                  <div className="w-16 h-1.5 bg-white/50 rounded-full mb-6"></div>
                  <p className="text-xl md:text-2xl text-white/95 font-medium leading-relaxed drop-shadow-sm max-w-2xl">
                    {slide.content}
                  </p>
                </motion.div>
              </div>

              {/* TikTok Style Side Actions */}
              <div className="absolute right-4 bottom-24 md:bottom-32 flex flex-col gap-6 z-20 items-center">
                <div className="flex flex-col items-center gap-1 group cursor-pointer" onClick={() => toast('Сохранено в избранное!', { icon: '❤️' })}>
                  <div className="w-12 h-12 rounded-full bg-black/20 backdrop-blur-md flex items-center justify-center transition-transform group-hover:scale-110 group-active:scale-90 border border-white/10 shadow-xl">
                    <Heart className="w-6 h-6 text-white" />
                  </div>
                  <span className="text-white text-xs font-bold drop-shadow-md">{(index * 123 + 456) % 999}</span>
                </div>

                <div className="flex flex-col items-center gap-1 group cursor-pointer" onClick={() => toast('Добавлено в закладки', { icon: '🔖' })}>
                  <div className="w-12 h-12 rounded-full bg-black/20 backdrop-blur-md flex items-center justify-center transition-transform group-hover:scale-110 group-active:scale-90 border border-white/10 shadow-xl">
                    <Bookmark className="w-6 h-6 text-white" />
                  </div>
                  <span className="text-white text-xs font-bold drop-shadow-md">Запомнить</span>
                </div>

                <div className="flex flex-col items-center gap-1 group cursor-pointer" onClick={() => handlePlayTTS(`${slide.title}. ${slide.content}`)}>
                  <div className={`w-12 h-12 rounded-full backdrop-blur-md flex items-center justify-center transition-transform group-hover:scale-110 group-active:scale-90 shadow-xl border ${isPlaying && isActive ? 'bg-indigo-600/80 border-indigo-400' : 'bg-black/20 border-white/10'}`}>
                    {isWaitingTTS && isActive ? (
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : isPlaying && isActive ? (
                      <Pause className="w-6 h-6 text-white" />
                    ) : (
                      <Volume2 className="w-6 h-6 text-white" />
                    )}
                  </div>
                  <span className="text-white text-xs font-bold drop-shadow-md">
                    {isWaitingTTS && isActive ? 'Загрузка...' : isPlaying && isActive ? 'Пауза' : 'Слушать'}
                  </span>
                </div>

                <div className="flex flex-col items-center gap-1 group cursor-pointer" onClick={() => {
                  const current = getTTSPlaybackRate();
                  const next = current === 1.0 ? 1.25 : current === 1.25 ? 1.5 : current === 1.5 ? 2.0 : 1.0;
                  setTTSPlaybackRate(next);
                  // Force render to update UI
                  setIsPlaying(isPlaying); 
                }}>
                  <div className="w-12 h-12 rounded-full bg-black/20 backdrop-blur-md flex items-center justify-center transition-transform group-hover:scale-110 group-active:scale-90 border border-white/10 shadow-xl font-black text-white text-sm">
                    {getTTSPlaybackRate()}x
                  </div>
                  <span className="text-white text-xs font-bold drop-shadow-md">Скорость</span>
                </div>

                <div className="flex flex-col items-center gap-1 group cursor-pointer" onClick={() => toast('Ссылка скопирована', { icon: '🔗' })}>
                  <div className="w-12 h-12 rounded-full bg-black/20 backdrop-blur-md flex items-center justify-center transition-transform group-hover:scale-110 group-active:scale-90 border border-white/10 shadow-xl">
                    <Share2 className="w-6 h-6 text-white" />
                  </div>
                  <span className="text-white text-xs font-bold drop-shadow-md">Поделиться</span>
                </div>
              </div>

              {/* Progress Bar (Bottom) */}
              {isActive && (
                <div className="absolute bottom-0 left-0 h-1 bg-white/20 w-full z-20">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: "100%" }}
                    transition={{ duration: 15, ease: "linear" }}
                    className="h-full bg-white"
                    onAnimationComplete={() => {
                      // Optional: auto-scroll to next
                    }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
      
      {/* Scroll indicator for the first slide */}
      {activeIndex === 0 && slides.length > 1 && (
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 2, repeat: Infinity, repeatType: 'reverse', duration: 1.5 }}
          className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center pointer-events-none z-10"
        >
          <span className="text-white/80 text-xs font-bold uppercase tracking-widest mb-2 drop-shadow-md">Свайп</span>
          <div className="w-6 h-10 border-2 border-white/50 rounded-full flex justify-center p-1">
            <motion.div 
              animate={{ y: [0, 15, 0] }}
              transition={{ repeat: Infinity, duration: 1.5 }}
              className="w-1.5 h-1.5 bg-white rounded-full"
            />
          </div>
        </motion.div>
      )}
    </div>
  );
}
