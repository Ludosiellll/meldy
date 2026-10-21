import { useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { FlashcardsInfo, Flashcard } from '../types/index';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { ArrowRight, Check, Copy, Eye, EyeOff, GraduationCap, RotateCcw } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import SourceReferences from './SourceReferences';
import { stemsOf, stripSourceMarkers } from './summary/fragmentModel';
import { repairMathEscapes } from '../lib/mathEscapes';
import { cardsLine } from '../lib/followupCards';
import { useListPlace, useSessionDraft } from '../lib/urlState';
import 'katex/dist/katex.min.css';
import './FlashcardsView.css';

/** What the fragment panel says over a card's fragments: they are found by shared words, not checked. */
export const CARD_SOURCE_NOTE = 'Здесь в лекции больше всего общих слов с карточкой.';

/** Inside the question's button only inline text: no links, pictures, headings or lists from the model's Markdown. */
const NOT_IN_A_QUESTION = ['a', 'img', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'table', 'hr', 'ul', 'ol', 'li'];

/** A question with a formula keeps the formula; any other question stays plain text (no Markdown surprises). */
function QuestionText({ text }: { text: string }) {
  if (!text.includes('$')) return <>{text}</>;
  return (
    <ReactMarkdown
      remarkPlugins={[remarkMath]}
      rehypePlugins={[rehypeKatex]}
      disallowedElements={NOT_IN_A_QUESTION}
      unwrapDisallowed
      components={{ p: ({ children }: { children?: ReactNode }) => <>{children}</> }}
    >
      {text}
    </ReactMarkdown>
  );
}

interface FlashcardsViewProps {
  data: FlashcardsInfo;
  sources?: { id: string; text: string }[];
  /**
   * The lecture's review (/review?material=…): spaced repetition with «Не помню / С трудом / Помню», saved and
   * counted in «Прогресс». Without it (a result not in the library) the cards can only be leafed through here.
   */
  reviewHref?: string;
  /** Cards this lecture got from ticket answers: reviewed together with its own (lib/followupCards). */
  followups?: number;
  /**
   * The lecture page (its material's id): a reload keeps the card on screen (?card=, lib/urlState.ts useListPlace) and
   * the answers opened in this tab (owner, 21.10: a reload lost the place).
   */
  placeKey?: string;
}

const NONE_OPEN: Record<number, boolean> = {};

function isOpenCards(value: unknown): value is Record<number, boolean> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.values(value as object).every((open) => typeof open === 'boolean');
}

/**
 * The cards of a material (Meldy 2026-10-04): big rounded cards, numbered «1.», the question on top and the answer
 * in a soft panel under it. The way to learn them is «Повторить карточки», the lecture's review (finding LIB-10:
 * «Начать обучение» here was a deck that saved nothing beside the real review). A result that is not in the
 * library yet has only that deck, named for what it is: «Пролистать без записи».
 */
export default function FlashcardsView({ data, sources = [], reviewHref, followups = 0, placeKey }: FlashcardsViewProps) {
  // Без меток фрагментов «[S02]», которые модель иногда копирует из входа; формулы — с обратной чертой (LIB-2).
  const cards = data?.flashcards?.map((card) => ({
    ...card,
    question: typeof card.question === 'string' ? repairMathEscapes(stripSourceMarkers(card.question)) : card.question,
    answer: typeof card.answer === 'string' ? repairMathEscapes(stripSourceMarkers(card.answer)) : card.answer,
  }));

  const [revealed, setRevealed] = useSessionDraft(placeKey ? `cards-open:${placeKey}` : null, NONE_OPEN, isOpenCards);
  const list = useListPlace<HTMLOListElement>(placeKey ? 'card' : null, cards?.length ?? 0);
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
            {knownCount === cards.length ? 'Вы знаете все карточки.' :
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
            <p className="fc-big-q">
              <QuestionText text={String(cards[studyIdx].question ?? '')} />
            </p>

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
        {reviewHref ? (
          <div className="fc-go">
            <Link to={reviewHref} className="fc-pill">
              Повторить карточки
              <span className="fc-dot" aria-hidden="true">
                <ArrowRight strokeWidth={2} />
              </span>
            </Link>
          </div>
        ) : (
          <div className="fc-go">
            <button type="button" onClick={startStudy} className="fc-pill">
              Пролистать без записи
              <span className="fc-dot" aria-hidden="true">
                <ArrowRight strokeWidth={2} />
              </span>
            </button>
          </div>
        )}
      </div>
      {reviewHref && followups > 0 ? (
        <p className="fc-note">В повторении: {cardsLine(cards.length, followups)}.</p>
      ) : !reviewHref ? (
        <p className="fc-note">Ответы здесь не сохраняются и не двигают повторение.</p>
      ) : null}

      <ol className="fc-list" ref={list}>
        {cards.map((c: Flashcard, i: number) => (
          <li
            key={i}
            className="fc-card"
            data-in={still ? undefined : ''}
            style={still ? undefined : ({ '--fc-in-delay': `${Math.min(i, 8) * 40}ms` } as CSSProperties)}
            data-open={revealed[i] ? '' : undefined}
            onClick={(event) => onCardClick(event, i)}
          >
            <div className="fc-card-top">
              <button type="button" className="fc-q" aria-expanded={Boolean(revealed[i])} onClick={() => toggle(i)}>
                <span className="fc-n">{i + 1}.</span> <QuestionText text={String(c.question ?? '')} />
              </button>
              <button
                type="button"
                aria-label={copiedIdx === i ? 'Скопировано' : 'Скопировать карточку'}
                onClick={() => {
                  navigator.clipboard.writeText(`Вопрос: ${c.question}\nОтвет: ${c.answer}`);
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
            <SourceReferences
              ids={c.source_ids}
              sources={sources}
              note={CARD_SOURCE_NOTE}
              panelKey={`card-${i + 1}`}
              stems={[...stemsOf(`${c.question ?? ''} ${c.answer ?? ''}`)]}
              compact
            />
            {!revealed[i] && (
              <p className="fc-hint">
                <Eye aria-hidden="true" strokeWidth={1.75} />
                Нажмите, чтобы увидеть ответ
              </p>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
