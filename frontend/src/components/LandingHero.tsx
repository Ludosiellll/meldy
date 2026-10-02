import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useInView, useReducedMotion } from 'framer-motion';
import { ArrowRight, ArrowUpRight, Check, FileText, Pause, Play, RotateCcw } from 'lucide-react';
import './LandingHero.css';

const chapters = ['Материал', 'Конспект', 'Карточки', 'Проверка'];
const durations = [5000, 6000, 7000, 8000];
const captions = [
  'Начните с того, что уже есть: вашей лекции.',
  'Выделите главное, чтобы разобраться в теме.',
  'Попробуйте вспомнить ответ до подсказки.',
  'Проверьте себя и разберите ошибку.',
];
const answers = ['Перечитать параграф ещё раз', 'Закрыть конспект и объяснить тему', 'Выделить определения маркером'];

export default function LandingHero() {
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const stageRef = useRef<HTMLDivElement>(null);
  const visible = useInView(stageRef, { amount: 0.25 });
  const [chapter, setChapter] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [pageVisible, setPageVisible] = useState(!document.hidden);
  const [flipped, setFlipped] = useState(false);
  const [answer, setAnswer] = useState<number | null>(null);
  const [run, setRun] = useState(0);
  const autoplay = playing && visible && pageVisible && !reduceMotion;

  useEffect(() => {
    const change = () => setPageVisible(!document.hidden);
    document.addEventListener('visibilitychange', change);
    return () => document.removeEventListener('visibilitychange', change);
  }, []);

  useEffect(() => {
    if (!autoplay) return;
    const next = window.setTimeout(() => {
      setChapter(current => (current + 1) % chapters.length);
      setFlipped(false);
      setAnswer(null);
    }, durations[chapter]);
    const action = window.setTimeout(() => {
      if (chapter === 2) setFlipped(true);
      if (chapter === 3) setAnswer(1);
    }, 3300);
    return () => { window.clearTimeout(next); window.clearTimeout(action); };
  }, [autoplay, chapter, run]);

  const selectChapter = (index: number) => {
    setPlaying(false);
    setChapter(index);
    setFlipped(false);
    setAnswer(null);
  };
  const replay = () => {
    setChapter(0); setFlipped(false); setAnswer(null); setPlaying(true); setRun(n => n + 1);
    stageRef.current?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
  };

  return (
    <section className="sf-hero" aria-labelledby="sf-headline">
      <div className="sf-hero-inner">
        <div className="sf-intro">
          <div className="sf-eyebrow"><span /> ВАШ МАТЕРИАЛ. ВАШ ТЕМП.</div>
          <h1 id="sf-headline">Разобраться.<br />Запомнить.<br />Ответить.</h1>
          <p className="sf-description">Загрузите лекцию — Meldy выделит главное, соберёт карточки и составит тест. Разберитесь в теме, проверьте себя и вернитесь к тому, что пока не запомнили.</p>
          <div className="sf-actions">
            <button className="sf-primary" onClick={() => navigate('/register')}>Начать с моей лекции <ArrowUpRight size={19} /></button>
            <button className="sf-watch" onClick={replay}><Play size={14} fill="currentColor" /> Смотреть демо</button>
          </div>
          <p className="sf-formats">PDF, DOCX, TXT · аудио и видео</p>
          <div className="sf-intro-foot"><p>От первого прочтения<br />до самостоятельного ответа.</p></div>
        </div>

        <div className="sf-demo-wrap" ref={stageRef} id="learning-demo">
          <div className="sf-demo-heading"><span><i /> MELDY / В ДЕЙСТВИИ</span><span>ИНТЕРАКТИВНОЕ ДЕМО</span></div>
          <div className="sf-demo">
            <div className="sf-demo-toolbar"><div><FileText size={15} /><span>Как работает память.pdf</span></div><span>Пример материала</span></div>
            <div className="sf-stage">
              <div className="sf-stage-heading"><span>УЧИМСЯ НА ОДНОМ ПРИМЕРЕ</span></div>
              <AnimatePresence mode="wait" initial={false}>
                <motion.div className="sf-scene" key={`${chapter}-${run}`} initial={{ opacity: 0, y: reduceMotion ? 0 : 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduceMotion ? 0 : -12 }} transition={{ duration: reduceMotion ? 0 : 0.32 }}>
                  {chapter === 0 && <div className="sf-paper">
                    <div className="sf-paper-meta"><span>ПСИХОЛОГИЯ ОБУЧЕНИЯ</span></div>
                    <h2>Почему мы забываем<br />прочитанное?</h2>
                    <p>Знакомый текст легко принять за усвоенный. При повторном чтении кажется, что вы всё знаете, но без конспекта ответить бывает сложнее.</p>
                    <p><span className={autoplay ? 'sf-highlight sf-highlight-animate' : 'sf-highlight'}>Активное вспоминание — попытка восстановить информацию по памяти, прежде чем посмотреть ответ.</span></p>
                    <div className="sf-source-note">Именно эту мысль разберём дальше <ArrowRight size={15} /></div>
                  </div>}
                  {chapter === 1 && <div className="sf-summary">
                    <div className="sf-scene-label">КОНСПЕКТ / ГЛАВНОЕ</div>
                    <h2>Знакомо ≠ запомнил.</h2>
                    <p className="sf-summary-lead">Проверяйте, что можете вспомнить<br />без открытого конспекта.</p>
                    {['Прочитайте небольшой фрагмент.', 'Закройте текст и объясните своими словами.', 'Сверьтесь с материалом и заполните пробелы.'].map((text, i) => <motion.div className="sf-summary-row" key={text} initial={{ opacity: reduceMotion ? 1 : 0, x: reduceMotion ? 0 : 12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: reduceMotion ? 0 : i * 0.22 }}><p>{text}</p></motion.div>)}
                    <div className="sf-source-tag"><FileText size={13} /> По материалу «Как работает память»</div>
                  </div>}
                  {chapter === 2 && <div className="sf-cards">
                    <div className="sf-scene-label">КАРТОЧКА / ПОПРОБУЙТЕ ВСПОМНИТЬ</div>
                    <button className={`sf-flashcard ${flipped ? 'is-flipped' : ''}`} onClick={() => { setPlaying(false); setFlipped(v => !v); }} aria-label={flipped ? 'Скрыть ответ на карточке' : 'Открыть ответ на карточке'} aria-pressed={flipped}>
                      <span className="sf-card-rotator">
                        <span className="sf-card-face sf-card-front" aria-hidden={flipped}><span className="sf-card-top">ВОПРОС</span><strong>Что такое<br />активное вспоминание?</strong><span className="sf-card-bottom">Подумайте. Затем переверните. <ArrowUpRight size={18} /></span></span>
                        <span className="sf-card-face sf-card-back" aria-hidden={!flipped}><span className="sf-card-top"><Check size={20} /><span>ОТВЕТ</span></span><strong>Восстановить информацию по памяти до просмотра подсказки.</strong><span className="sf-card-bottom">Например, объяснить тему с закрытым конспектом.</span></span>
                      </span>
                    </button>
                    <p className="sf-card-hint">Нажмите на карточку, чтобы перевернуть её.</p>
                  </div>}
                  {chapter === 3 && <div className="sf-quiz">
                    <div className="sf-scene-label">ПРОВЕРКА ЗНАНИЙ</div>
                    <h2>Как проверить,<br />что вы запомнили тему?</h2>
                    <div className="sf-answers">{answers.map((text, i) => <button key={text} className={`sf-answer ${answer === i ? (i === 1 ? 'is-correct' : 'is-wrong') : ''}`} onClick={() => { setPlaying(false); setAnswer(i); }} aria-pressed={answer === i}><span>{String.fromCharCode(65 + i)}</span>{text}{answer === i && i === 1 && <Check size={16} />}</button>)}</div>
                    <div className={`sf-feedback ${answer !== null ? 'is-visible' : ''}`} aria-live="polite">{answer === 1 ? 'Верно. Самостоятельный ответ показывает, что удалось вспомнить.' : answer !== null ? 'Перечитывание и выделение не проверяют вспоминание. Попробуйте ответить без текста.' : 'Выберите ответ — это демо можно попробовать.'}</div>
                  </div>}
                </motion.div>
              </AnimatePresence>
            </div>
            <div className="sf-demo-controls">
              <div className="sf-chapters" aria-label="Этапы демонстрации">{chapters.map((label, i) => <button key={label} aria-pressed={chapter === i} onClick={() => selectChapter(i)} className={chapter === i ? 'is-active' : ''}><span className="sf-track">{chapter === i && <span key={`${chapter}-${autoplay}-${run}`} className={autoplay ? 'sf-track-fill is-playing' : 'sf-track-fill'} style={{ animationDuration: `${durations[i]}ms` }} />}</span><span>{label}</span></button>)}</div>
              <button className="sf-playback" aria-label={playing && !reduceMotion ? 'Приостановить демо' : 'Продолжить демо'} onClick={() => setPlaying(v => !v)} disabled={!!reduceMotion}>{playing && !reduceMotion ? <Pause size={16} /> : <Play size={16} />}</button>
              <button className="sf-playback sf-replay" aria-label="Начать демо заново" onClick={replay}><RotateCcw size={16} /></button>
            </div>
          </div>
          <div className="sf-demo-caption"><p>{captions[chapter]}</p><span>Без регистрации</span></div>
        </div>
      </div>
    </section>
  );
}
