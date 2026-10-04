import { useState, type MouseEvent } from 'react';
import { FlashcardsInfo, Flashcard } from '../types/index';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { ArrowRight, Check, Copy, Eye, EyeOff, GraduationCap, RotateCcw } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import SourceReferences from './SourceReferences';
import { stripSourceMarkers } from './summary/fragmentModel';
import 'katex/dist/katex.min.css';
import './FlashcardsView.css';

/**
 * The cards of a material (Meldy 2026-10-04): big rounded cards, the question on top and the answer in a soft
 * panel under it; «Начать обучение» turns them into a deck, one card at a time, with «Знаю» and «Ещё раз».
 */
export default function FlashcardsView({ data, sources = [] }: { data: FlashcardsInfo; sources?: { id: string; text: string }[] }) {
  // Без меток фрагментов «[S02]», которые модель иногда копирует из входа.
  const cards = data?.flashcards?.map((card) => ({
    ...card,
    question: typeof card.question === 'string' ? stripSourceMarkers(card.question) : card.question,
    answer: typeof card.answer === 'string' ? stripSourceMarkers(card.answer) : card.answer,
  }));

  const [revealed, setRevealed] = useState<Record<number, boolean>>({});
  const [studyMode, setStudyMode] = useState(false);
  const [studyIdx, setStudyIdx] = useState(0);
  const [studyRevealed, setStudyRevealed] = useState(false);
  const [studyResults, setStudyResults] = useState<Record<number, boolean>>({});
  const [studyDone, setStudyDone] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState(-1);
  // With reduced motion the cards and the deck simply appear.
  const still = Boolean(useReducedMotion());

  const toggle = (i: number) => setRevealed({ ...revealed, [i]: !revealed[i] });

  const revealAll = () => {
    if (!cards || !Array.isArray(cards)) return;
    const r: Record<number, boolean> = {};
    cards.forEach((_: Flashcard, i: number) => { r[i] = true; });
    setRevealed(r);
  };

  const hideAll = () => setRevealed({});

  const startStudy = () => {
    setStudyMode(true);
    setStudyIdx(0);
    setStudyRevealed(false);
    setStudyResults({});
    setStudyDone(false);
  };

  const exitStudy = () => setStudyMode(false);

  const markCard = (known: boolean) => {
    if (!cards) return;
    const next = { ...studyResults, [studyIdx]: known };
    if (studyIdx + 1 < cards.length) {
      setStudyResults(next);
      setStudyIdx(studyIdx + 1);
      setStudyRevealed(false);
    } else {
      setStudyResults(next);
      setStudyDone(true);
    }
  };

  if (!cards || !Array.isArray(cards)) return <p className="fc-none">Нет данных</p>;

  // Study mode
  if (studyMode) {
    const knownCount = Object.values(studyResults).filter(Boolean).length;

    if (studyDone) {
      return (
        <motion.div initial={still ? false : { opacity: 0 }} animate={{ opacity: 1 }} className="fc-result">
          <div className="fc-result-icon" aria-hidden="true">
            <GraduationCap strokeWidth={1.75} />
          </div>
          <h3 className="fc-result-h">
            Результат: {knownCount} из {cards.length}
          </h3>
          <p className="fc-result-p">
            {knownCount === cards.length ? 'Отлично! Вы знаете все карточки!' :
             knownCount >= cards.length / 2 ? 'Неплохо, но есть что подтянуть.' :
             'Стоит повторить материал ещё раз.'}
          </p>
          <div className="fc-result-acts">
            <button type="button" onClick={startStudy} className="fc-pill">
              Пройти снова
              <span className="fc-dot" aria-hidden="true">
                <RotateCcw strokeWidth={2} />
              </span>
            </button>
            <button type="button" onClick={exitStudy} className="fc-chip">
              К списку
            </button>
          </div>
        </motion.div>
      );
    }

    return (
      <motion.div initial={still ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="fc-study">
        <div className="fc-study-top">
          <span className="fc-count">Карточка {studyIdx + 1} из {cards.length}</span>
          <button type="button" onClick={exitStudy} className="fc-quiet">
            Выйти
          </button>
        </div>

        {/* A deck: two cards under the one being learnt. */}
        <div className="fc-deck">
          <span className="fc-under" data-n="1" aria-hidden="true" />
          <span className="fc-under" data-n="2" aria-hidden="true" />
          <motion.div key={studyIdx} initial={still ? false : { opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="fc-big">
            <p className="fc-big-q">{cards[studyIdx].question}</p>

            <AnimatePresence mode="wait">
              {!studyRevealed ? (
                <motion.button
                  key="reveal"
                  type="button"
                  initial={still ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setStudyRevealed(true)}
                  className="fc-pill"
                >
                  Показать ответ
                  <span className="fc-dot" aria-hidden="true">
                    <Eye strokeWidth={2} />
                  </span>
                </motion.button>
              ) : (
                <motion.div
                  key="answer"
                  initial={still ? false : { opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="fc-big-a markdown-content"
                >
                  <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                    {cards[studyIdx].answer}
                  </ReactMarkdown>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </div>

        {studyRevealed && (
          <motion.div initial={still ? false : { opacity: 0 }} animate={{ opacity: 1 }} className="fc-marks">
            <button type="button" onClick={() => markCard(true)} className="fc-mark" data-tone="know">
              <Check aria-hidden="true" strokeWidth={2} />
              Знаю
            </button>
            <button type="button" onClick={() => markCard(false)} className="fc-mark" data-tone="again">
              <RotateCcw aria-hidden="true" strokeWidth={2} />
              Ещё раз
            </button>
          </motion.div>
        )}
      </motion.div>
    );
  }

  // A click anywhere on a card turns it over; the buttons and links inside it do only their own thing.
  const onCardClick = (event: MouseEvent<HTMLLIElement>, index: number) => {
    if ((event.target as HTMLElement).closest('button, a')) return;
    toggle(index);
  };

  // Normal mode
  return (
    <div className="fc">
      <div className="fc-bar">
        <div className="fc-bar-quiet">
          <button type="button" onClick={revealAll} className="fc-chip">
            <Eye aria-hidden="true" strokeWidth={1.75} />
            Показать все
          </button>
          <button type="button" onClick={hideAll} className="fc-chip">
            <EyeOff aria-hidden="true" strokeWidth={1.75} />
            Скрыть все
          </button>
        </div>
        <button type="button" onClick={startStudy} className="fc-pill">
          Начать обучение
          <span className="fc-dot" aria-hidden="true">
            <ArrowRight strokeWidth={2} />
          </span>
        </button>
      </div>

      <ol className="fc-list">
        {cards.map((c: Flashcard, i: number) => (
          <motion.li
            key={i}
            initial={still ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(i, 8) * 0.04 }}
            className="fc-card"
            data-open={revealed[i] ? '' : undefined}
            onClick={(event) => onCardClick(event, i)}
          >
            <div className="fc-card-top">
              <button type="button" className="fc-q" aria-expanded={Boolean(revealed[i])} onClick={() => toggle(i)}>
                Q{i+1}: {c.question}
              </button>
              <button
                type="button"
                aria-label={copiedIdx === i ? 'Скопировано' : 'Скопировать карточку'}
                onClick={() => {
                  navigator.clipboard.writeText(`Q: ${c.question}\nA: ${c.answer}`);
                  setCopiedIdx(i);
                  setTimeout(() => setCopiedIdx(-1), 1500);
                }}
                className="fc-copy"
                data-done={copiedIdx === i ? '' : undefined}
              >
                {copiedIdx === i ? <Check aria-hidden="true" strokeWidth={2} /> : <Copy aria-hidden="true" strokeWidth={1.75} />}
              </button>
            </div>
            <AnimatePresence initial={false}>
              {revealed[i] && (
                <motion.div
                  initial={still ? false : { height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={still ? { opacity: 0, transition: { duration: 0 } } : { height: 0, opacity: 0 }}
                  className="fc-answer-wrap"
                >
                  <div className="fc-answer markdown-content">
                    <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                      {c.answer}
                    </ReactMarkdown>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            <SourceReferences ids={c.source_ids} sources={sources} compact />
            {!revealed[i] && (
              <p className="fc-hint">
                <Eye aria-hidden="true" strokeWidth={1.75} />
                Нажмите, чтобы увидеть ответ
              </p>
            )}
          </motion.li>
        ))}
      </ol>
    </div>
  );
}
