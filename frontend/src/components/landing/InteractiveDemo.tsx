import { useRef, useState, type KeyboardEvent } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowUpRight, Check } from 'lucide-react';
import '../LandingHero.css';

/** The three tabs match the numbered list next to the demo («Попробуйте сами»). */
const TABS = ['Конспект', 'Карточка', 'Тест'] as const;

const CAPTIONS = [
  'Выберите тезис — в тексте подсветится фрагмент, из которого он взят.',
  'Попробуйте вспомнить ответ, прежде чем перевернуть карточку.',
  'Выберите вариант и прочитайте разбор.',
];

const SENTENCES = [
  'Знакомый текст легко принять за усвоенный.',
  'Активное вспоминание — попытка восстановить информацию по памяти, прежде чем посмотреть ответ.',
  'Поэтому сначала объясните тему своими словами, а потом сверьтесь с текстом.',
];

const SUMMARY = [
  'Знакомый текст — ещё не выученный',
  'Активное вспоминание: ответ до подсказки',
  'Сначала объяснить, потом сверить',
];

const ANSWERS = ['Перечитать параграф ещё раз', 'Закрыть конспект и объяснить тему', 'Выделить определения маркером'];

/**
 * Hands-on example under the hero: summary with source links, a flip card and a quiz.
 * Nothing plays by itself; every change comes from the visitor.
 */
export default function InteractiveDemo() {
  const reduceMotion = useReducedMotion();
  const [tab, setTab] = useState(0);
  const [source, setSource] = useState(1);
  const [flipped, setFlipped] = useState(false);
  const [answer, setAnswer] = useState<number | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const selectTab = (index: number, focus = false) => {
    setTab(index);
    setFlipped(false);
    setAnswer(null);
    if (focus) tabRefs.current[index]?.focus();
  };

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const last = TABS.length - 1;
    const next = event.key === 'ArrowRight' ? (tab === last ? 0 : tab + 1)
      : event.key === 'ArrowLeft' ? (tab === 0 ? last : tab - 1)
        : event.key === 'Home' ? 0
          : event.key === 'End' ? last
            : null;
    if (next === null) return;
    event.preventDefault();
    selectTab(next, true);
  };

  return (
    <div className="sf-demo-wrap" id="learning-demo">
      <div className="sf-demo">
        <div className="sf-demo-tabs" role="tablist" aria-label="Шаги примера">
          {TABS.map((label, index) => (
            <button
              key={label}
              ref={el => { tabRefs.current[index] = el; }}
              type="button"
              role="tab"
              id={`sf-demo-tab-${index}`}
              aria-selected={tab === index}
              aria-controls="sf-demo-panel"
              tabIndex={tab === index ? 0 : -1}
              className={`sf-demo-tab${tab === index ? ' is-active' : ''}`}
              onClick={() => selectTab(index)}
              onKeyDown={onTabKey}
            >
              <span aria-hidden="true">{index + 1}</span>{label}
            </button>
          ))}
        </div>
        <div className="sf-stage" role="tabpanel" id="sf-demo-panel" aria-labelledby={`sf-demo-tab-${tab}`}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              className="sf-scene"
              key={tab}
              initial={{ opacity: 0, y: reduceMotion ? 0 : 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: reduceMotion ? 0 : -8 }}
              transition={{ duration: reduceMotion ? 0 : 0.24 }}
            >
              {tab === 0 && (
                <div className="sf-source">
                  <div className="sf-paper">
                    <div className="sf-paper-meta"><span>КАК РАБОТАЕТ ПАМЯТЬ</span><span>АБЗ. 2</span></div>
                    <h3>Почему мы забываем прочитанное?</h3>
                    <p>
                      {SENTENCES.map((sentence, index) => (
                        <span key={index} className={source === index ? 'sf-highlight' : undefined}>{sentence}{index < SENTENCES.length - 1 ? ' ' : ''}</span>
                      ))}
                    </p>
                  </div>
                  <div className="sf-summary-box">
                    <p className="sf-scene-label">В конспекте</p>
                    <ul className="sf-summary-list">
                      {SUMMARY.map((text, index) => (
                        <li key={text}>
                          <button type="button" className={`sf-summary-row${source === index ? ' is-active' : ''}`} aria-pressed={source === index} onClick={() => setSource(index)}>
                            <span className="sf-summary-text">{text}</span>
                            <span className="sf-summary-ref">фрагмент {index + 1}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
              {tab === 1 && (
                <div className="sf-cards">
                  <button
                    type="button"
                    className={`sf-flashcard ${flipped ? 'is-flipped' : ''}`}
                    onClick={() => setFlipped(v => !v)}
                    aria-label={flipped ? 'Скрыть ответ на карточке' : 'Открыть ответ на карточке'}
                    aria-pressed={flipped}
                  >
                    <span className="sf-card-rotator">
                      <span className="sf-card-face sf-card-front" aria-hidden={flipped}><span className="sf-card-top">ВОПРОС</span><strong>Что такое<br />активное вспоминание?</strong><span className="sf-card-bottom">Подумайте. Затем переверните. <ArrowUpRight size={18} /></span></span>
                      <span className="sf-card-face sf-card-back" aria-hidden={!flipped}><span className="sf-card-top"><Check size={20} /><span>ОТВЕТ</span></span><strong>Восстановить информацию по памяти до просмотра подсказки.</strong><span className="sf-card-bottom">Например, объяснить тему с закрытым конспектом.</span></span>
                    </span>
                  </button>
                  <p className="sf-card-hint">Нажмите на карточку, чтобы перевернуть её.</p>
                </div>
              )}
              {tab === 2 && (
                <div className="sf-quiz">
                  <h3>Как проверить,<br />что вы запомнили тему?</h3>
                  <div className="sf-answers">
                    {ANSWERS.map((text, index) => (
                      <button
                        key={text}
                        type="button"
                        className={`sf-answer ${answer === index ? (index === 1 ? 'is-correct' : 'is-wrong') : ''}`}
                        onClick={() => setAnswer(index)}
                        aria-pressed={answer === index}
                      >
                        <span>{String.fromCharCode(65 + index)}</span>{text}{answer === index && index === 1 && <Check size={16} />}
                      </button>
                    ))}
                  </div>
                  <div className={`sf-feedback ${answer !== null ? 'is-visible' : ''}`} aria-live="polite">
                    {answer === 1
                      ? 'Верно. Самостоятельный ответ показывает, что удалось вспомнить.'
                      : answer !== null
                        ? 'Перечитывание и выделение не проверяют вспоминание. Попробуйте ответить без текста.'
                        : 'Выберите ответ — разбор появится здесь.'}
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
        <div className="sf-demo-caption"><p>{CAPTIONS[tab]}</p><span>Без регистрации</span></div>
      </div>
    </div>
  );
}
