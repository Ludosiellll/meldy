import { useMemo, useState, type ReactNode } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import {
  Atom,
  BarChart3,
  BookA,
  BookOpen,
  Brain,
  Calculator,
  CalendarClock,
  CircleHelp,
  Clock,
  Columns2,
  Cpu,
  Dna,
  FlaskConical,
  Globe,
  Heart,
  Image as ImageIcon,
  Landmark,
  Leaf,
  Lightbulb,
  ListOrdered,
  Map as MapIcon,
  Music,
  Quote,
  Scale,
  Sigma,
  Users,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import type {
  CompareVisual,
  FactVisual,
  FormulaVisual,
  QuestionVisual,
  SceneIcon,
  SceneVisual,
  StepsVisual,
  TermVisual,
  TimelineVisual,
  Visual,
  VisualOrigin,
} from './types';
import { VISUAL_TYPE_LABELS } from './visuals';
import ChartView from './ChartView';
import DiagramView from './DiagramView';

type IconComponent = LucideIcon;

const TYPE_ICONS: Record<Visual['type'], IconComponent> = {
  term: BookA,
  steps: ListOrdered,
  compare: Columns2,
  formula: Sigma,
  chart: BarChart3,
  timeline: CalendarClock,
  diagram: Workflow,
  fact: Quote,
  question: CircleHelp,
  scene: ImageIcon,
};

export const SCENE_ICON_COMPONENTS: Record<SceneIcon, IconComponent> = {
  brain: Brain,
  book: BookOpen,
  atom: Atom,
  dna: Dna,
  globe: Globe,
  calculator: Calculator,
  chart: BarChart3,
  clock: Clock,
  lightbulb: Lightbulb,
  users: Users,
  scale: Scale,
  cpu: Cpu,
  leaf: Leaf,
  flask: FlaskConical,
  landmark: Landmark,
  music: Music,
  heart: Heart,
  map: MapIcon,
};

export function visualTypeIcon(type: Visual['type']): IconComponent {
  return TYPE_ICONS[type];
}

function renderLatex(latex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(latex, { throwOnError: false, displayMode, strict: 'ignore', trust: false });
  } catch {
    return '';
  }
}

function Heading({ children }: { children: ReactNode }) {
  return <h3 className="text-lg font-semibold leading-snug text-[var(--sf-ink)] sm:text-xl">{children}</h3>;
}

function TermView({ visual }: { visual: TermVisual }) {
  return (
    <div className="space-y-3">
      <p className="text-2xl font-semibold leading-tight tracking-[-0.01em] text-[var(--sf-ink)] sm:text-[28px]">{visual.term}</p>
      <p className="max-w-prose text-base leading-relaxed text-[var(--sf-ink)]">{visual.definition}</p>
    </div>
  );
}

function StepsView({ visual }: { visual: StepsVisual }) {
  return (
    <div className="space-y-4">
      <Heading>{visual.title}</Heading>
      <ol className="divide-y divide-[var(--sf-line)] border-y border-[var(--sf-line)]">
        {visual.items.map((item, index) => (
          <li key={index} className="flex items-start gap-3 py-2.5">
            <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border border-[var(--sf-line)] text-xs font-semibold tabular-nums text-[var(--sf-accent-fg)]">
              {index + 1}
            </span>
            <span className="text-sm leading-relaxed text-[var(--sf-ink)] sm:text-base">{item}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function CompareView({ visual }: { visual: CompareVisual }) {
  return (
    <div className="space-y-4">
      <Heading>{visual.title}</Heading>
      <div className="grid divide-y divide-[var(--sf-line)] rounded-lg border border-[var(--sf-line)] sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        {[visual.left, visual.right].map((side, index) => (
          <div key={index} className="space-y-2 p-4">
            <p className="text-sm font-semibold text-[var(--sf-ink)]">{side.label}</p>
            <ul className="space-y-1.5">
              {side.points.map((point, pointIndex) => (
                <li key={pointIndex} className="flex gap-2 text-sm leading-relaxed text-[var(--sf-ink)]">
                  <span aria-hidden="true" className="mt-[0.6em] h-1 w-1 shrink-0 rounded-full bg-[var(--sf-muted)]" />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Обозначение из легенды: KaTeX только для настоящей разметки (\alpha, x_1, t^2), иначе обычный текст. */
function LegendSymbol({ symbol }: { symbol: string }) {
  const html = useMemo(() => (/[\\_^]/.test(symbol) ? renderLatex(symbol, false) : ''), [symbol]);
  if (html) return <span dangerouslySetInnerHTML={{ __html: html }} />;
  const letters = /^[A-Za-zΑ-Ωα-ω]{1,3}$/.test(symbol);
  return <span className={letters ? 'font-serif italic' : undefined}>{symbol}</span>;
}

function FormulaView({ visual }: { visual: FormulaVisual }) {
  const html = useMemo(() => renderLatex(visual.latex, true), [visual.latex]);
  const legend = visual.legend ?? [];
  return (
    <div className="space-y-4">
      <Heading>{visual.title}</Heading>
      <div className="overflow-x-auto rounded-lg border border-[var(--sf-line)] px-4 py-5 text-[var(--sf-ink)]">
        {html ? (
          <div className="text-lg sm:text-xl" dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <code className="block text-center text-sm">{visual.latex}</code>
        )}
      </div>
      {legend.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-2 text-sm">
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
    <div className="space-y-5">
      <Heading>{visual.title}</Heading>
      <ol
        className="relative grid gap-4 before:absolute before:bottom-2 before:left-[4px] before:top-2 before:w-px before:bg-[var(--sf-line)] sm:auto-cols-fr sm:grid-flow-col sm:gap-3 sm:before:bottom-auto sm:before:left-0 sm:before:right-0 sm:before:top-[4px] sm:before:h-px sm:before:w-auto"
      >
        {visual.events.map((event, index) => (
          <li key={index} className="relative pl-6 sm:pl-0 sm:pt-6">
            <span
              aria-hidden="true"
              className="absolute left-0 top-1.5 h-[9px] w-[9px] rounded-full bg-[var(--sf-accent-fg)] ring-4 ring-[var(--sf-surface)] sm:top-0"
            />
            <p className="text-xs font-semibold tabular-nums text-[var(--sf-accent-fg)]">{event.date}</p>
            <p className="mt-0.5 text-sm leading-snug text-[var(--sf-ink)]">{event.label}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

function FactView({ visual }: { visual: FactVisual }) {
  // «Из источника S03» уже сказано меткой типа и пометкой источника — заголовок показываем, только если он свой.
  const customTitle = /^из источника(\s+S\d+)?$/i.test(visual.title.trim()) ? null : visual.title;
  return (
    <figure className="space-y-3">
      {customTitle && <Heading>{customTitle}</Heading>}
      <blockquote className="border-l-2 border-[var(--sf-accent-fg)] pl-4 text-base leading-relaxed text-[var(--sf-ink)] sm:text-lg">
        «{visual.text}»
      </blockquote>
    </figure>
  );
}

function QuestionView({ visual, forceRevealed }: { visual: QuestionVisual; forceRevealed: boolean }) {
  const [revealed, setRevealed] = useState(false);
  const shown = revealed || forceRevealed;
  return (
    <div className="space-y-4">
      <Heading>{visual.question}</Heading>
      {shown ? (
        <p className="border-l-2 border-[var(--sf-line)] pl-4 text-base leading-relaxed text-[var(--sf-ink)]">{visual.answer}</p>
      ) : (
        <button
          type="button"
          onClick={() => setRevealed(true)}
          aria-expanded={false}
          className="inline-flex h-9 items-center rounded-lg border border-[var(--sf-line)] px-3 text-sm font-medium text-[var(--sf-ink)] transition-colors [@media(hover:hover)]:hover:bg-[var(--sf-surface-soft)]"
        >
          Показать ответ
        </button>
      )}
    </div>
  );
}

function SceneView({ visual }: { visual: SceneVisual }) {
  const Icon = SCENE_ICON_COMPONENTS[visual.icon] ?? BookOpen;
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-4 text-center">
      <Icon aria-hidden={true} strokeWidth={1.25} className="h-16 w-16 text-[var(--sf-accent-fg)] sm:h-20 sm:w-20" />
      <div className="space-y-1.5">
        <Heading>{visual.title}</Heading>
        {visual.caption && <p className="mx-auto max-w-md text-sm leading-relaxed text-[var(--sf-muted)]">{visual.caption}</p>}
      </div>
    </div>
  );
}

export interface OutlineItem {
  /** Позиция реплики в разговоре (для перехода). */
  position: number;
  type: Visual['type'];
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
      {caption && <p className="mt-1 text-sm leading-relaxed text-[var(--sf-muted)]">{caption}</p>}
      <ol className="mt-4 border-t border-[var(--sf-line)]">
        {items.map(item => {
          const Icon = TYPE_ICONS[item.type];
          return (
            <li key={item.position} className="border-b border-[var(--sf-line)]">
              <button
                type="button"
                tabIndex={interactive ? undefined : -1}
                onClick={() => onSeek?.(item.position)}
                className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-md px-2 py-2 text-left text-sm text-[var(--sf-ink)] transition-colors [@media(hover:hover)]:hover:bg-[var(--sf-surface-soft)]"
              >
                <Icon aria-hidden={true} strokeWidth={1.75} className="h-4 w-4 shrink-0 text-[var(--sf-muted)]" />
                <span className="min-w-0 flex-1 truncate">{item.caption}</span>
                <span className="shrink-0 text-xs tabular-nums text-[var(--sf-muted)]">реплика {item.position + 1}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function VisualBody({ visual, forceRevealed }: { visual: Visual; forceRevealed: boolean }) {
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
        <div className="space-y-3">
          <Heading>{visual.unit ? `${visual.title}, ${visual.unit}` : visual.title}</Heading>
          <ChartView visual={visual} />
        </div>
      );
    case 'timeline':
      return <TimelineView visual={visual} />;
    case 'diagram':
      return (
        <div className="space-y-3">
          <Heading>{visual.title}</Heading>
          <DiagramView visual={visual} />
        </div>
      );
    case 'fact':
      return <FactView visual={visual} />;
    case 'question':
      return <QuestionView visual={visual} forceRevealed={forceRevealed} />;
    case 'scene':
      return <SceneView visual={visual} />;
    default:
      return null;
  }
}

function SourceBadges({ ids }: { ids: string[] }) {
  return (
    <>
      {ids.slice(0, 3).map(id => (
        <span key={id} className="rounded border border-[var(--sf-line)] px-1.5 font-mono text-[11px]">
          {id}
        </span>
      ))}
    </>
  );
}

/** Единственное место, где сказано, откуда изображение. */
function Provenance({ visual, origin, sourceIds }: { visual: Visual; origin: VisualOrigin; sourceIds: string[] }) {
  if (origin === 'cover' || visual.type === 'scene') return null;
  let text: string | null = null;
  let badges: string[] = [];
  if (visual.type === 'fact' && sourceIds.length) {
    text = 'Из материала';
    badges = sourceIds;
  } else if (origin === 'auto') {
    text = 'Подобрано по словам реплики';
  } else if (sourceIds.length) {
    text = visual.type === 'chart' ? 'Числа из материала' : 'Из материала';
    badges = sourceIds;
  }
  if (!text) return null;
  return (
    <span className="ml-auto inline-flex flex-wrap items-center gap-1.5">
      {text}
      <SourceBadges ids={badges} />
    </span>
  );
}

export interface ConversationVisualProps {
  visual: Visual;
  origin: VisualOrigin;
  /** Фрагменты исходника, из которых взято само изображение. */
  sourceIds?: string[];
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

/** Изображение к реплике: метка типа и источника, затем само изображение. */
export default function ConversationVisual({
  visual,
  origin,
  sourceIds = [],
  outline = [],
  opening = false,
  onSeek,
  measure = false,
}: ConversationVisualProps) {
  const Icon = TYPE_ICONS[visual.type];
  const asOutline = visual.type === 'scene' && (origin === 'cover' || opening) && outline.length >= 2;
  const titleOnly = visual.type === 'scene' && origin === 'cover' && !asOutline;

  let body: ReactNode;
  if (asOutline && visual.type === 'scene') {
    body = (
      <OutlineView
        caption={origin === 'cover' ? '' : visual.caption}
        items={outline}
        onSeek={onSeek}
        interactive={!measure}
      />
    );
  } else if (titleOnly) {
    body = <p className="text-xl font-semibold leading-snug text-[var(--sf-ink)]">{visual.type === 'scene' ? visual.title : ''}</p>;
  } else {
    body = <VisualBody visual={visual} forceRevealed={measure} />;
  }

  return (
    <div className="flex h-full min-w-0 flex-col" data-visual-type={measure ? undefined : visual.type}>
      {!asOutline && !titleOnly && (
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--sf-muted)]">
          <span className="inline-flex items-center gap-1.5 font-medium">
            <Icon aria-hidden={true} className="h-3.5 w-3.5" strokeWidth={1.75} />
            {VISUAL_TYPE_LABELS[visual.type]}
          </span>
          <Provenance visual={visual} origin={origin} sourceIds={sourceIds} />
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col justify-center">{body}</div>
    </div>
  );
}
