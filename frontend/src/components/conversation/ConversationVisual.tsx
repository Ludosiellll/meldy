import { useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import katex from 'katex';
import 'katex/contrib/mhchem';
import 'katex/dist/katex.min.css';
import type {
  CompareVisual,
  ConversationSource,
  FactVisual,
  FormulaVisual,
  Provenance,
  QuestionVisual,
  SceneVisual,
  StepsVisual,
  TermVisual,
  TimelineVisual,
  Visual,
  VisualOrigin,
} from './types';
import { fragmentWords, provenanceLead, visualLabel } from './visuals';
import ChartView, { chartNotes, isPercentUnit } from './ChartView';
import DiagramView from './DiagramView';

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

function Heading({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-[21px] font-semibold leading-[1.25] tracking-[-0.01em] text-[var(--sf-ink)] sm:text-2xl">{children}</h3>
  );
}

function TermView({ visual }: { visual: TermVisual }) {
  return (
    <div>
      <h3 className="text-[30px] font-semibold leading-[1.1] tracking-[-0.02em] text-[var(--sf-ink)] sm:text-[36px]">{visual.term}</h3>
      <p className="mt-3 max-w-[36ch] text-lg leading-[1.5] text-[var(--sf-ink)] sm:text-[19px]">{visual.definition}</p>
    </div>
  );
}

/** «Кодирование: превращаем впечатление в след» → заголовок пункта и пояснение. */
export function splitStep(item: string): { head: string; tail: string } | null {
  const match = /^(.{2,32}?)(?::\s+|\s+[—–]\s+)(.+)$/u.exec(item);
  if (!match) return null;
  return { head: match[1].trim(), tail: match[2].trim() };
}

function StepsView({ visual }: { visual: StepsVisual }) {
  return (
    <div>
      <Heading>{visual.title}</Heading>
      <ol className="mt-4 divide-y divide-[var(--sf-line)] border-y border-[var(--sf-line)]">
        {visual.items.map((item, index) => {
          const parts = splitStep(item);
          return (
            <li key={index} className="flex items-baseline gap-2 py-3">
              <span className="w-7 shrink-0 text-[15px] font-semibold tabular-nums text-[var(--sf-accent-fg)]">{index + 1}</span>
              <span className="min-w-0 text-[15px] leading-[1.5] text-[var(--sf-ink)] sm:text-base">
                {parts ? (
                  <>
                    <span className="font-semibold">{parts.head}</span>
                    <span className="text-[var(--sf-muted)]"> — {parts.tail}</span>
                  </>
                ) : (
                  item
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function CompareView({ visual }: { visual: CompareVisual }) {
  return (
    <div>
      <Heading>{visual.title}</Heading>
      <div className="mt-4 grid gap-5 sm:grid-cols-2 sm:gap-0 sm:divide-x sm:divide-[var(--sf-line)]">
        {[visual.left, visual.right].map((side, index) => (
          <div key={index} className="min-w-0 py-1 sm:px-6 sm:first:pl-0 sm:last:pr-0">
            <p
              className={`border-t-2 pt-3 text-base font-semibold text-[var(--sf-ink)] ${
                index === 0 ? 'border-[var(--sf-ink)]' : 'border-[var(--sf-accent-fg)]'
              }`}
            >
              {side.label}
            </p>
            <ul className="mt-2.5 space-y-1.5">
              {side.points.map((point, pointIndex) => (
                <li key={pointIndex} className="flex gap-2 text-[15px] leading-[1.5] text-[var(--sf-ink)]">
                  <span aria-hidden="true" className="w-3 shrink-0 text-[var(--sf-muted)]">
                    –
                  </span>
                  <span className="min-w-0">{point}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
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
  const letters = /^[A-Za-zΑ-Ωα-ω]{1,3}$/.test(symbol);
  return <span className={letters ? 'font-serif italic' : undefined}>{symbol}</span>;
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
      inner.style.fontSize = '';
      const available = wrapper.clientWidth;
      if (!available) return;
      const base = parseFloat(getComputedStyle(inner).fontSize) || 22;
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

    fit();
    wrapper.addEventListener('scroll', updateFade, { passive: true });
    let observer: ResizeObserver | null = null;
    let lastWidth = wrapper.clientWidth;
    if (typeof ResizeObserver !== 'undefined') {
      // Подгонка меняет высоту блока; заново подгоняем только при новой ширине.
      observer = new ResizeObserver(() => {
        if (wrapper.clientWidth === lastWidth) return;
        lastWidth = wrapper.clientWidth;
        fit();
      });
      observer.observe(wrapper);
    }
    // Шрифты KaTeX приходят позже первой отрисовки: после загрузки формула шире.
    let cancelled = false;
    const fonts = typeof document !== 'undefined' ? (document as Document & { fonts?: FontFaceSet }).fonts : undefined;
    fonts?.ready?.then(() => {
      if (!cancelled) fit();
    });
    return () => {
      cancelled = true;
      wrapper.removeEventListener('scroll', updateFade);
      observer?.disconnect();
    };
  }, [wrapperRef, innerRef, html]);
}

function FormulaView({ visual }: { visual: FormulaVisual }) {
  const html = useMemo(() => renderLatex(visual.latex, true), [visual.latex]);
  const legend = visual.legend ?? [];
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);
  useFitFormula(wrapperRef, innerRef, html);
  return (
    <div>
      <Heading>{visual.title}</Heading>
      <div ref={wrapperRef} data-formula="" className="mt-2 max-h-48 overflow-x-auto overflow-y-hidden py-3 text-[var(--sf-ink)]">
        {html ? (
          <div
            ref={innerRef}
            className="w-max min-w-full text-[22px] sm:text-[28px] [&_.katex-display]:m-0"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <code className="block text-center text-sm">{visual.latex}</code>
        )}
      </div>
      {legend.length > 0 && (
        <dl className="mt-1 grid grid-cols-[auto_1fr] items-baseline gap-x-5 gap-y-2.5 text-[15px]">
          {legend.map((item, index) => (
            <div key={index} className="contents">
              <dt className="text-[var(--sf-ink)]">
                <LegendSymbol symbol={item.symbol} />
              </dt>
              <dd className="leading-relaxed text-[var(--sf-muted)]">{item.meaning}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function TimelineView({ visual }: { visual: TimelineVisual }) {
  return (
    <div>
      <Heading>{visual.title}</Heading>
      <ol className="relative mt-5 grid gap-4 before:absolute before:bottom-2 before:left-[4px] before:top-2 before:w-px before:bg-[color-mix(in_srgb,var(--sf-ink)_22%,var(--sf-surface))] sm:auto-cols-fr sm:grid-flow-col sm:gap-4 sm:before:bottom-auto sm:before:left-0 sm:before:right-0 sm:before:top-[4px] sm:before:h-px sm:before:w-auto">
        {visual.events.map((event, index) => (
          <li key={index} className="relative pl-6 sm:pl-0 sm:pt-6">
            <span
              aria-hidden="true"
              className="absolute left-0 top-2 h-[9px] w-[9px] rounded-full bg-[var(--sf-accent-fg)] ring-4 ring-[var(--sf-surface)] sm:top-0"
            />
            <p className="text-xl font-semibold tabular-nums tracking-[-0.01em] text-[var(--sf-ink)] sm:text-[22px]">{event.date}</p>
            <p className="mt-1 text-sm leading-[1.45] text-[color-mix(in_srgb,var(--sf-ink)_78%,var(--sf-surface))]">{event.label}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

function FactView({ visual, quote }: { visual: FactVisual; quote: boolean }) {
  // «Из источника S03» уже сказано подписью — заголовок показываем, только если он свой.
  const customTitle = /^из источника(\s+S\d+)?$/i.test(visual.title.trim()) ? null : visual.title;
  return (
    <figure>
      {customTitle && <Heading>{customTitle}</Heading>}
      {quote ? (
        <blockquote className={`${customTitle ? 'mt-3' : ''} -indent-[0.42em] text-[19px] leading-[1.45] text-[var(--sf-ink)] sm:text-[22px]`}>
          <span aria-hidden="true" className="text-[var(--sf-accent-fg)]">
            «
          </span>
          {visual.text}
          <span aria-hidden="true">»</span>
        </blockquote>
      ) : (
        // Пересказ не оформляется как цитата: в исходнике его слово в слово нет.
        <p className={`${customTitle ? 'mt-3' : ''} text-[19px] leading-[1.45] text-[var(--sf-ink)] sm:text-[22px]`}>{visual.text}</p>
      )}
    </figure>
  );
}

function QuestionView({ visual, forceRevealed, interactive }: { visual: QuestionVisual; forceRevealed: boolean; interactive: boolean }) {
  const [revealed, setRevealed] = useState(false);
  const shown = revealed || forceRevealed;
  const answerId = useId();
  return (
    <div>
      <Heading>{visual.question}</Heading>
      {/* Кнопка остаётся на месте и не пропадает: фокус клавиатуры не теряется. */}
      <button
        type="button"
        onClick={() => setRevealed(value => !value)}
        aria-expanded={shown}
        aria-controls={answerId}
        tabIndex={interactive ? undefined : -1}
        className="mt-4 inline-flex h-9 items-center rounded-lg border border-[var(--sf-line)] px-3 text-sm font-medium text-[var(--sf-ink)] transition-colors [@media(hover:hover)]:hover:bg-[var(--sf-surface-soft)]"
      >
        {shown ? 'Скрыть ответ' : 'Показать ответ'}
      </button>
      <div id={answerId} aria-live="polite">
        {shown && (
          <p className="mt-3 border-l-2 border-[var(--sf-accent-fg)] pl-4 text-[17px] leading-[1.5] text-[var(--sf-ink)]">{visual.answer}</p>
        )}
      </div>
    </div>
  );
}

function SceneView({ visual }: { visual: SceneVisual }) {
  // Иконка темы остаётся в данных, но не рисуется: стоковая пиктограмма ничего не объясняет.
  return (
    <div>
      <Heading>{visual.title}</Heading>
      {visual.caption && <p className="mt-2 max-w-[44ch] text-base leading-relaxed text-[var(--sf-muted)]">{visual.caption}</p>}
    </div>
  );
}

export interface OutlineItem {
  /** Позиция реплики в разговоре (для перехода). */
  position: number;
  caption: string;
}

/** Заставка начала: что будет на экране дальше, с переходом к нужной реплике. */
function OutlineView({
  caption,
  items,
  onSeek,
  interactive,
}: {
  caption: string;
  items: OutlineItem[];
  onSeek?: (position: number) => void;
  interactive: boolean;
}) {
  return (
    <div>
      <Heading>О чём разговор</Heading>
      {caption && <p className="mt-1.5 max-w-[52ch] text-[15px] leading-relaxed text-[var(--sf-muted)]">{caption}</p>}
      <ol className="mt-4 border-t border-[var(--sf-line)]">
        {items.map((item, number) => (
          <li key={item.position} className="border-b border-[var(--sf-line)]">
            <button
              type="button"
              tabIndex={interactive ? undefined : -1}
              onClick={() => onSeek?.(item.position)}
              title={`Перейти к реплике ${item.position + 1}`}
              className="-mx-2 flex w-[calc(100%+1rem)] items-baseline gap-3 rounded-md px-2 py-2.5 text-left text-[var(--sf-ink)] transition-colors [@media(hover:hover)]:hover:bg-[var(--sf-surface-soft)]"
            >
              <span aria-hidden="true" className="w-5 shrink-0 text-[13px] tabular-nums text-[var(--sf-muted)]">
                {number + 1}
              </span>
              <span className="line-clamp-2 min-w-0 flex-1 text-[15px] leading-snug">{item.caption}</span>
              <span className="sr-only">, реплика {item.position + 1}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

function VisualBody({
  visual,
  provenance,
  forceRevealed,
  interactive,
}: {
  visual: Visual;
  provenance: Provenance;
  forceRevealed: boolean;
  interactive: boolean;
}) {
  switch (visual.type) {
    case 'term':
      return <TermView visual={visual} />;
    case 'steps':
      return <StepsView visual={visual} />;
    case 'compare':
      return <CompareView visual={visual} />;
    case 'formula':
      return <FormulaView visual={visual} />;
    case 'chart':
      return (
        <div>
          <Heading>{visual.unit && !isPercentUnit(visual.unit) ? `${visual.title}, ${visual.unit}` : visual.title}</Heading>
          <div className="mt-3">
            <ChartView visual={visual} />
          </div>
        </div>
      );
    case 'timeline':
      return <TimelineView visual={visual} />;
    case 'diagram':
      return (
        <div>
          <Heading>{visual.title}</Heading>
          <div className="mt-4">
            <DiagramView visual={visual} />
          </div>
        </div>
      );
    case 'fact':
      return <FactView visual={visual} quote={provenance.kind === 'quote'} />;
    case 'question':
      return <QuestionView visual={visual} forceRevealed={forceRevealed} interactive={interactive} />;
    case 'scene':
      return <SceneView visual={visual} />;
    default:
      return null;
  }
}

function sourceText(sources: ConversationSource[] | null | undefined, id: string): string | null {
  const match = (sources ?? []).find(
    source => source && typeof source.id === 'string' && source.id.trim().toUpperCase() === id.toUpperCase(),
  );
  return match && typeof match.text === 'string' && match.text.trim() ? match.text.trim() : null;
}

/**
 * Подпись под изображением, как у рисунка в учебнике: примечания и откуда оно
 * взято. «фрагмент 3» раскрывает сам фрагмент исходника, чтобы его можно было проверить.
 */
function FigureCaption({
  notes,
  provenance,
  sources,
  interactive,
}: {
  notes: string[];
  provenance: Provenance;
  sources?: ConversationSource[] | null;
  interactive: boolean;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const lead = provenanceLead(provenance);
  const ids = 'ids' in provenance ? provenance.ids : [];
  const texts = ids.map(id => sourceText(sources, id)).filter((text): text is string => Boolean(text));
  const expandable = interactive && ids.length > 0 && texts.length === ids.length;
  if (!lead && notes.length === 0) return null;
  return (
    <div className="mt-4" data-figure-caption="">
      <p className="text-[13px] leading-snug text-[var(--sf-muted)]">
        {notes.map(note => (
          <span key={note}>
            {note}
            {lead ? '. ' : ''}
          </span>
        ))}
        {lead}
        {lead && ids.length > 0 && (
          <>
            {', '}
            {expandable ? (
              <button
                type="button"
                onClick={() => setOpen(value => !value)}
                aria-expanded={open}
                aria-controls={panelId}
                className="border-b border-dotted border-[color-mix(in_srgb,var(--sf-muted)_65%,transparent)] leading-[1.15] transition-colors [@media(hover:hover)]:hover:text-[var(--sf-ink)]"
              >
                {fragmentWords(ids)}
              </button>
            ) : (
              fragmentWords(ids)
            )}
          </>
        )}
      </p>
      {expandable && open && (
        <div
          id={panelId}
          className="mt-2 max-h-40 space-y-2 overflow-y-auto border-l-2 border-[var(--sf-line)] pl-3 text-[13px] leading-relaxed text-[var(--sf-muted)]"
        >
          {texts.map((text, index) => (
            <p key={ids[index]}>{text}</p>
          ))}
        </div>
      )}
    </div>
  );
}

export interface ConversationVisualProps {
  visual: Visual;
  origin: VisualOrigin;
  /** Что сказать об источнике изображения. */
  provenance: Provenance;
  /** Фрагменты исходника (для раскрытия «фрагмент 3»). */
  sources?: ConversationSource[] | null;
  /** Для заставки начала: изображения, которые появятся дальше. */
  outline?: OutlineItem[];
  /** Первая реплика разговора: сцена на ней становится планом разговора. */
  opening?: boolean;
  onSeek?: (position: number) => void;
  /**
   * Невидимая копия для расчёта высоты сцены: без data-visual-type, ответ на
   * вопрос раскрыт (так выше), кнопки не получают фокус.
   */
  measure?: boolean;
}

/** Изображение к реплике, как рисунок в учебнике: тип, заголовок, само изображение и подпись. */
export default function ConversationVisual({
  visual,
  origin,
  provenance,
  sources,
  outline = [],
  opening = false,
  onSeek,
  measure = false,
}: ConversationVisualProps) {
  const asOutline = visual.type === 'scene' && (origin === 'cover' || opening) && outline.length >= 2;
  const interactive = !measure;

  let body: ReactNode;
  if (asOutline && visual.type === 'scene') {
    body = (
      <OutlineView caption={origin === 'cover' ? '' : visual.caption} items={outline} onSeek={onSeek} interactive={interactive} />
    );
  } else {
    body = <VisualBody visual={visual} provenance={provenance} forceRevealed={measure} interactive={interactive} />;
  }

  return (
    <div className="min-w-0" data-visual-type={measure ? undefined : visual.type}>
      {!asOutline && <p className="mb-1.5 text-[13px] leading-5 text-[var(--sf-muted)]">{visualLabel(visual, provenance)}</p>}
      {body}
      <FigureCaption
        notes={visual.type === 'chart' ? chartNotes(visual) : []}
        provenance={provenance}
        sources={sources}
        interactive={interactive}
      />
    </div>
  );
}
