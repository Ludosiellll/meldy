import { memo, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import katex from 'katex';
import { repairFormula } from '../../lib/mathEscapes';
import 'katex/contrib/mhchem';
import 'katex/dist/katex.min.css';
import { ArrowRight, X } from 'lucide-react';
import type {
  CompareVisual,
  ConversationSource,
  FactVisual,
  FormulaVisual,
  OutlineItem,
  Provenance,
  QuestionVisual,
  SceneVisual,
  StepsVisual,
  TimelineVisual,
  Visual,
  VisualOrigin,
} from './types';
import { fragmentWords, sourceNote, visualLabel } from './visuals';
import { fragmentText, quoteHeading } from './grounding';
import { splitFragmentHeading } from '../../utils/fragmentText';
import ChartView, { chartNotes, isPercentUnit } from './ChartView';
import DiagramView from './DiagramView';
import { useElementHeight } from './useElementWidth';
import { observeSize } from '../../lib/observeSize';
import './conversation.css';

/**
 * Пределы для разметки из материала: \rule{1pt}{199em} или \kern растянули бы
 * сцену на тысячи пикселей (её высота — по самому большому изображению).
 */
const KATEX_OPTIONS = { throwOnError: false, strict: 'ignore', trust: false, maxSize: 4, maxExpand: 50 } as const;

function renderLatex(latex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(latex, { ...KATEX_OPTIONS, displayMode });
  } catch {
    return '';
  }
}

/** Примечание под графиком занимает строку: столько же места у графика меньше. */
const FOOT_PX = 32;

/** «Кодирование: превращаем впечатление в след» → заголовок пункта и пояснение. */
export function splitStep(item: string): { head: string; tail: string } | null {
  const match = /^(.{2,32}?)(?::\s+|\s+[—–]\s+)(.+)$/u.exec(item);
  if (!match) return null;
  return { head: match[1].trim(), tail: match[2].trim() };
}

/** «Из источника S03» — служебное название подобранной цитаты, его не показываем. */
function ownTitle(title: string): string | null {
  return /^из источника(\s+S\d+)?$/i.test(title.trim()) ? null : title;
}

/** Заголовок изображения на листе (Literata 600 24/30). */
export function visualTitle(visual: Visual): string | null {
  switch (visual.type) {
    case 'term':
      return visual.term;
    case 'question':
      return visual.question;
    case 'chart':
      return visual.unit && !isPercentUnit(visual.unit) ? `${visual.title}, ${visual.unit}` : visual.title;
    case 'fact':
      return ownTitle(visual.title);
    default:
      return visual.title;
  }
}

function StepsBody({ visual }: { visual: StepsVisual }) {
  return (
    <ol className="cv-steps" data-columns={visual.items.length >= 4 ? '' : undefined}>
      {visual.items.map((item, index) => {
        const parts = splitStep(item);
        return (
          <li key={index}>
            {parts ? (
              <>
                <span className="cv-steps-head">{parts.head}</span>
                <span className="cv-muted"> — {parts.tail}</span>
              </>
            ) : (
              item
            )}
          </li>
        );
      })}
    </ol>
  );
}

function CompareBody({ visual }: { visual: CompareVisual }) {
  return (
    <div className="cv-sides">
      {[visual.left, visual.right].map((side, index) => (
        <div key={index} className="cv-side" data-first={index === 0 ? '' : undefined}>
          <p className="cv-side-label">{side.label}</p>
          <ul className="cv-side-points">
            {side.points.map((point, pointIndex) => (
              <li key={pointIndex}>{point}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** Обозначение из легенды: KaTeX только для настоящей разметки (\alpha, x_1, t^2, \ce{…}), иначе обычный текст. */
function LegendSymbol({ symbol }: { symbol: string }) {
  const html = useMemo(() => (/[\\_^]/.test(symbol) ? renderLatex(symbol, false) : ''), [symbol]);
  if (html) {
    // Обрезаем: \llap и \rlap не должны вылезать на соседние строки.
    return <span className="inline-block max-w-[14rem] overflow-hidden align-middle" dangerouslySetInnerHTML={{ __html: html }} />;
  }
  return <span>{symbol}</span>;
}

const FORMULA_MIN_SCALE = 0.62;

/**
 * Формула во всю ширину: если не помещается, шрифт уменьшается (не меньше 62%),
 * а если не помещается и так — прокрутка с затуханием у края, за которым есть продолжение.
 */
function useFitFormula(wrapperRef: { current: HTMLDivElement | null }, innerRef: { current: HTMLDivElement | null }, html: string) {
  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    const inner = innerRef.current;
    if (!wrapper || !inner || !html) return;

    const updateFade = () => {
      const overflow = wrapper.scrollWidth - wrapper.clientWidth;
      // Пара пикселей — это свес глифов KaTeX, а не скрытое продолжение формулы.
      if (overflow <= 4) {
        wrapper.style.maskImage = '';
        wrapper.style.webkitMaskImage = '';
        return;
      }
      const left = wrapper.scrollLeft > 1;
      const right = wrapper.scrollLeft < overflow - 4;
      const mask = `linear-gradient(to right, ${left ? 'transparent, #000 2.5rem' : '#000'}, ${right ? '#000 calc(100% - 2.5rem), transparent' : '#000'})`;
      wrapper.style.maskImage = mask;
      wrapper.style.webkitMaskImage = mask;
    };

    const fit = () => {
      if (inner.style.fontSize) inner.style.fontSize = '';
      const available = wrapper.clientWidth;
      if (!available) return;
      const base = parseFloat(getComputedStyle(inner).fontSize) || 28;
      // Небольшой запас: глифы KaTeX чуть свешиваются за свою рамку.
      const target = available - 4;
      let scale = 1;
      // Ширина текста меняется не строго пропорционально шрифту, поэтому меряем повторно.
      for (let pass = 0; pass < 3; pass += 1) {
        const natural = inner.scrollWidth;
        if (natural <= available + 0.5) break;
        scale = Math.max(FORMULA_MIN_SCALE, (scale * target) / natural);
        inner.style.fontSize = `${(base * scale).toFixed(2)}px`;
        if (scale === FORMULA_MIN_SCALE) break;
      }
      updateFade();
    };

    wrapper.addEventListener('scroll', updateFade, { passive: true });
    // Подгонка — когда наблюдатель размеров сообщает ширину (lib/observeSize: после раскладки браузера, до отрисовки,
    // читать там ничего не стоит; пока формула помещается, подгонка ничего не пишет). Подгонка меняет высоту блока;
    // заново подгоняем только при новой ширине. Раньше она мерила в layout-эффекте и раскладывала страницу заранее.
    let lastWidth: number | null = null;
    const stop = observeSize(wrapper, () => {
      const width = wrapper.clientWidth;
      if (width === lastWidth) return;
      lastWidth = width;
      fit();
    });
    // Шрифты KaTeX приходят позже первой отрисовки: после загрузки формула шире.
    let cancelled = false;
    const fonts = typeof document !== 'undefined' ? (document as Document & { fonts?: FontFaceSet }).fonts : undefined;
    if (fonts?.status !== 'loaded') {
      fonts?.ready?.then(() => {
        if (!cancelled) fit();
      });
    }
    return () => {
      cancelled = true;
      wrapper.removeEventListener('scroll', updateFade);
      stop();
    };
  }, [wrapperRef, innerRef, html]);
}

function FormulaBody({ visual }: { visual: FormulaVisual }) {
  // A backspace the server's JSON reading made of «\beta» (before 2026-10-08) is a command again (lib/mathEscapes).
  const html = useMemo(() => renderLatex(repairFormula(visual.latex), true), [visual.latex]);
  const legend = visual.legend ?? [];
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);
  useFitFormula(wrapperRef, innerRef, html);
  return (
    <div>
      <div ref={wrapperRef} data-formula="" className="cv-formula">
        {html ? (
          <div ref={innerRef} className="w-max min-w-full" dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <code className="block text-center text-base">{visual.latex}</code>
        )}
      </div>
      {legend.length > 0 && (
        <dl className="cv-legend">
          {legend.map((item, index) => (
            <div key={index} className="contents">
              <dt>
                <LegendSymbol symbol={item.symbol} />
              </dt>
              <dd>{item.meaning}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function TimelineBody({ visual }: { visual: TimelineVisual }) {
  return (
    <ol className="cv-timeline" data-dense={visual.events.length > 4 ? '' : undefined}>
      {visual.events.map((event, index) => (
        <li key={index}>
          <span className="cv-date">{event.date}</span>
          <span className="cv-event block">{event.label}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Факт: сверенная цитата — в «ёлочках», заголовок лекции своей строкой (записка жюри, п. 12);
 * пересказ — без кавычек: в лекции его слово в слово нет, и над ним остаётся слово «Пересказ».
 */
function FactBody({ visual, quote, fragment }: { visual: FactVisual; quote: boolean; fragment: string | null }) {
  const split = quote ? quoteHeading(visual.text, fragment) : null;
  if (!quote) return <p className="cv-text">{visual.text}</p>;
  return (
    <blockquote className="cv-quote">
      {split ? (
        <>
          <span className="cv-quote-head" data-quote-heading="">
            <span aria-hidden="true" className="cv-quote-mark">
              «
            </span>
            {split.heading}
          </span>
          <span className="cv-quote-rest">
            {split.rest}
            <span aria-hidden="true">»</span>
          </span>
        </>
      ) : (
        <>
          <span aria-hidden="true" className="cv-quote-mark">
            «
          </span>
          {visual.text}
          <span aria-hidden="true">»</span>
        </>
      )}
    </blockquote>
  );
}

function QuestionBody({ visual, forceRevealed, interactive }: { visual: QuestionVisual; forceRevealed: boolean; interactive: boolean }) {
  const [revealed, setRevealed] = useState(false);
  const shown = revealed || forceRevealed;
  const answerId = useId();
  return (
    <div>
      {/* Кнопка остаётся на месте и не пропадает: фокус клавиатуры не теряется. */}
      <button
        type="button"
        onClick={() => setRevealed(value => !value)}
        aria-expanded={shown}
        aria-controls={answerId}
        tabIndex={interactive ? undefined : -1}
        className="sf-link"
      >
        {shown ? 'Скрыть ответ' : 'Показать ответ'}
      </button>
      <div id={answerId} aria-live="polite">
        {shown && <p className="cv-answer">{visual.answer}</p>}
      </div>
    </div>
  );
}

/** Тире не начинает строку (типографское правило): пробел перед ним неразрывный. */
function keepDash(text: string): string {
  return text.replace(/ ([\u2014\u2013])/g, '\u00a0$1');
}

/**
 * План на первой реплике: темы, которые появятся на листе дальше, — как оглавление
 * (стрелка, название, «реплика N»), а не как варианты ответа. Строка переводит к реплике.
 */
function Chapters({ items, onSeek, interactive }: { items: OutlineItem[]; onSeek?: (position: number) => void; interactive: boolean }) {
  return (
    <ol className="cv-chapters" aria-label="Дальше в подкасте">
      {items.map(item => (
        <li key={item.position}>
          {/* The name is set whole: engines join the inline parts of a button differently («Тема,реплика 2»). */}
          <button
            type="button"
            tabIndex={interactive ? undefined : -1}
            onClick={() => onSeek?.(item.position)}
            aria-label={`${item.caption}, реплика ${item.position + 1}`}
          >
            <ArrowRight aria-hidden="true" strokeWidth={2} className="cv-chapter-arrow" />
            <span className="cv-chapter-title">{item.caption}</span>
            <span className="cv-chapter-at">реплика {item.position + 1}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

/**
 * Заставка темы: название и подпись под ним. На первой реплике над названием метка
 * «О чём разговор», а справа (уже 1024 px — ниже) — план из двух–четырёх тем.
 * Иконка темы остаётся в данных, но не рисуется: стоковая пиктограмма ничего не объясняет.
 */
function SceneCard({
  visual,
  opening,
  chapters,
  onSeek,
  interactive,
}: {
  visual: SceneVisual;
  opening: boolean;
  chapters: OutlineItem[];
  onSeek?: (position: number) => void;
  interactive: boolean;
}) {
  return (
    <div className="cv-scene" data-chapters={chapters.length ? '' : undefined}>
      <div className="cv-scene-head">
        {opening && <p className="cv-kicker">О чём подкаст</p>}
        <h3 className="cv-scene-title">{keepDash(visual.title)}</h3>
        {visual.caption && <p className="cv-scene-lede">{keepDash(visual.caption)}</p>}
      </div>
      {chapters.length > 0 && <Chapters items={chapters} onSeek={onSeek} interactive={interactive} />}
    </div>
  );
}

/**
 * Заметка-источник в правом углу листа (.sf-pnote): «Числа — из лекции, фрагмент 4».
 * «фрагмент 4» раскрывает сам фрагмент лекции вырезкой поверх листа, чтобы его можно было
 * сверить; заголовок лекции во вырезке — своей строкой.
 */
function SourceNote({
  provenance,
  sources,
  interactive,
  slipTop = 0,
}: {
  provenance: Provenance;
  sources?: ConversationSource[] | null;
  interactive: boolean;
  /** Вырезка ложится под заголовком листа и не закрывает саму заметку. */
  slipTop?: number;
}) {
  const [open, setOpen] = useState(false);
  const slipId = useId();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const note = sourceNote(provenance);
  if (!note) return null;
  const ids = 'ids' in provenance ? provenance.ids : [];
  const texts = ids.map(id => fragmentText(sources, id));
  const expandable = interactive && ids.length > 0 && texts.every(Boolean);
  const words = ids.length ? fragmentWords(ids) : '';
  const lead = words && note.endsWith(words) ? note.slice(0, note.length - words.length) : note;

  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };
  const onSlipKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };

  return (
    <>
      <p className="sf-pnote cv-src" data-source-note="">
        {expandable ? (
          <>
            {lead}
            <button
              ref={buttonRef}
              type="button"
              className="cv-src-button"
              onClick={() => setOpen(value => !value)}
              aria-expanded={open}
              aria-controls={open ? slipId : undefined}
            >
              {words}
            </button>
          </>
        ) : (
          note
        )}
      </p>
      {expandable && open && (
        <div
          id={slipId}
          className="sf-slip cv-slip"
          role="region"
          aria-label={`Лекция, ${words}`}
          onKeyDown={onSlipKey}
          style={slipTop ? { top: slipTop, maxHeight: `calc(100% - ${slipTop}px)` } : undefined}
        >
          <div className="cv-slip-head">
            <p>{`Лекция, ${words}`}</p>
            <button type="button" className="cv-ico" onClick={close} aria-label="Закрыть фрагмент">
              <X aria-hidden="true" strokeWidth={1.75} />
            </button>
          </div>
          {texts.map((text, index) => {
            const parts = splitFragmentHeading(text as string);
            return (
              <p key={ids[index]} className={index > 0 ? 'mt-3' : undefined}>
                {ids.length > 1 && <span className="cv-slip-n">{`Фрагмент ${ids[index].replace(/^S0*/i, '')}`}</span>}
                {parts.heading ? (
                  <>
                    <span className="cv-slip-heading">{parts.heading}</span>
                    {parts.body}
                  </>
                ) : (
                  text
                )}
              </p>
            );
          })}
        </div>
      )}
    </>
  );
}

export interface ConversationVisualProps {
  visual: Visual;
  origin: VisualOrigin;
  /** Что сказать об источнике изображения. */
  provenance: Provenance;
  /** Фрагменты исходника (для раскрытия «фрагмент 3» и заголовка цитаты). */
  sources?: ConversationSource[] | null;
  /** Для заставки начала: темы, которые появятся дальше (conversationOutline; пусто — без плана). */
  outline?: OutlineItem[];
  /** Первая реплика разговора: заставка на ней — «О чём разговор» с планом. */
  opening?: boolean;
  onSeek?: (position: number) => void;
  /**
   * Невидимая копия для расчёта высоты сцены: без data-visual-type, ответ на
   * вопрос раскрыт (так выше), кнопки не получают фокус.
   */
  measure?: boolean;
  /** Сколько места на листе по высоте, px: схема и график подстраиваются под него. */
  budget?: number;
  /** Проявить схему по слоям (первая реплика с этим изображением). */
  reveal?: boolean;
}

/**
 * Изображение к реплике на листе бумаги: заголовок, заметка-источник в углу и само изображение. Рисуется заново, только
 * когда меняется что-то из его свойств: невидимые копии для высоты листа не перерисовываются с каждым состоянием плеера.
 */
export default memo(ConversationVisual);

function ConversationVisual({
  visual,
  origin,
  provenance,
  sources,
  outline = [],
  opening = false,
  onSeek,
  measure = false,
  budget,
  reveal = false,
}: ConversationVisualProps) {
  const interactive = !measure;
  const [leadRef, leadHeight] = useElementHeight<HTMLDivElement>(48);
  const quote = provenance.kind === 'quote';
  // Над изображением остаётся только слово «Пересказ»: остальные типы видны и так.
  const kind = visual.type === 'fact' && !quote ? visualLabel(visual, provenance) : null;
  const title = visualTitle(visual);
  const notes = visual.type === 'chart' ? chartNotes(visual) : [];
  const room = budget && budget > 0 ? Math.max(120, budget - leadHeight - (notes.length ? FOOT_PX : 0)) : undefined;
  // Класс по типу есть и у невидимой копии: высоту листа считают по тому же набору.
  const className = `min-w-0 cv-visual-${visual.type}`;

  if (visual.type === 'scene') {
    // Заставка (и обложка старого разговора — название материала) не ссылается на источник.
    const first = opening || origin === 'cover';
    return (
      <div className={className} data-visual-type={measure ? undefined : visual.type}>
        <SceneCard visual={visual} opening={first} chapters={first ? outline : []} onSeek={onSeek} interactive={interactive} />
      </div>
    );
  }

  let body: ReactNode = null;
  switch (visual.type) {
    case 'term':
      body = <p className="cv-def">{keepDash(visual.definition)}</p>;
      break;
    case 'steps':
      body = <StepsBody visual={visual} />;
      break;
    case 'compare':
      body = <CompareBody visual={visual} />;
      break;
    case 'formula':
      body = <FormulaBody visual={visual} />;
      break;
    case 'chart':
      body = <ChartView visual={visual} maxHeight={room} />;
      break;
    case 'timeline':
      body = <TimelineBody visual={visual} />;
      break;
    case 'diagram':
      body = <DiagramView visual={visual} maxHeight={room} reveal={reveal && interactive} />;
      break;
    case 'fact': {
      // Цитата начинается во фрагменте, который указан первым (quoteSourceIds идёт по порядку фрагментов).
      const fragment = quote && provenance.ids.length ? fragmentText(sources, provenance.ids[0]) : null;
      body = <FactBody visual={visual} quote={quote} fragment={fragment} />;
      break;
    }
    case 'question':
      body = <QuestionBody visual={visual} forceRevealed={measure} interactive={interactive} />;
      break;
  }

  const hasNote = sourceNote(provenance) !== null;
  return (
    <div className={className} data-visual-type={measure ? undefined : visual.type}>
      {(kind || title || hasNote) && (
        <div ref={leadRef} className="cv-lead">
          {kind && <p className="cv-kind">{kind}</p>}
          <div className="cv-head">
            {title && <h3 className="cv-title">{title}</h3>}
            <SourceNote provenance={provenance} sources={sources} interactive={interactive} slipTop={leadHeight} />
          </div>
        </div>
      )}
      <div className="cv-body">{body}</div>
      {notes.map(note => (
        <p key={note} className="cv-foot">
          {note}
        </p>
      ))}
    </div>
  );
}
