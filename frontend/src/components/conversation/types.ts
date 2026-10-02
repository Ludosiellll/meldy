/**
 * Контракт данных «Разговора» (summary_json.podcast).
 *
 * summary_json.podcast остаётся массивом реплик { speaker, text, source_ids? }.
 * Новое необязательное поле visual описывает, что показать на экране во время
 * реплики. Старые реплики без visual продолжают работать: для них плеер
 * подбирает изображение по тексту (см. visuals.ts).
 */

export const SCENE_ICONS = [
  'brain',
  'book',
  'atom',
  'dna',
  'globe',
  'calculator',
  'chart',
  'clock',
  'lightbulb',
  'users',
  'scale',
  'cpu',
  'leaf',
  'flask',
  'landmark',
  'music',
  'heart',
  'map',
] as const;

export type SceneIcon = (typeof SCENE_ICONS)[number];

export interface TermVisual {
  type: 'term';
  term: string;
  definition: string;
}

export interface StepsVisual {
  type: 'steps';
  title: string;
  items: string[];
}

export interface CompareSide {
  label: string;
  points: string[];
}

export interface CompareVisual {
  type: 'compare';
  title: string;
  left: CompareSide;
  right: CompareSide;
}

export interface FormulaLegendItem {
  symbol: string;
  meaning: string;
}

export interface FormulaVisual {
  type: 'formula';
  title: string;
  latex: string;
  legend?: FormulaLegendItem[];
}

export interface ChartPoint {
  label: string;
  value: number;
}

export interface ChartVisual {
  type: 'chart';
  title: string;
  kind: 'bar' | 'line';
  unit?: string;
  data: ChartPoint[];
}

export interface TimelineEvent {
  date: string;
  label: string;
}

export interface TimelineVisual {
  type: 'timeline';
  title: string;
  events: TimelineEvent[];
}

export interface DiagramNode {
  id: string;
  label: string;
}

export interface DiagramEdge {
  from: string;
  to: string;
  label?: string;
}

export interface DiagramVisual {
  type: 'diagram';
  title: string;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

export interface FactVisual {
  type: 'fact';
  title: string;
  text: string;
}

export interface QuestionVisual {
  type: 'question';
  question: string;
  answer: string;
}

export interface SceneVisual {
  type: 'scene';
  title: string;
  icon: SceneIcon;
  caption: string;
}

export type Visual =
  | TermVisual
  | StepsVisual
  | CompareVisual
  | FormulaVisual
  | ChartVisual
  | TimelineVisual
  | DiagramVisual
  | FactVisual
  | QuestionVisual
  | SceneVisual;

export type VisualType = Visual['type'];

/** Реплика в том виде, в каком она хранится в summary_json.podcast. */
export interface PodcastLine {
  speaker: string;
  text: string;
  source_ids?: string[];
  visual?: Visual;
}

/**
 * Откуда взялось изображение: от модели, подобрано плеером по тексту реплики
 * или это заставка первой реплики (название материала), которую никто не выбирал.
 */
export type VisualOrigin = 'model' | 'auto' | 'cover';

/**
 * Что можно честно сказать об источнике изображения. Подпись «из материала»
 * получает только то, что проверено: числа графика и даты хронологии (их сервер
 * сверяет с исходником), цитата, найденная в исходнике слово в слово, и то, что
 * плеер сам взял из конспекта или карточек. Термины, шаги, схемы и формулы
 * модели ничего не утверждают об источнике.
 */
export type Provenance =
  | { kind: 'none' }
  | { kind: 'numbers' | 'dates' | 'quote'; ids: string[] }
  | { kind: 'summary' }
  | { kind: 'cards' };

/** Реплика, готовая к показу: у каждой есть изображение для «сцены». */
export interface ConversationLine {
  /** Индекс реплики в исходном массиве summary_json.podcast. */
  index: number;
  speaker: string;
  text: string;
  sourceIds: string[];
  visual: Visual;
  origin: VisualOrigin;
  /** true, если изображение перешло от предыдущей реплики. */
  carried: boolean;
  /** Индекс исходной реплики, на которой изображение появилось впервые. */
  visualFrom: number;
  /**
   * Фрагменты исходника, к которым относится само изображение: source_ids реплики,
   * где оно появилось, или фрагмент, из которого взята цитата.
   */
  visualSourceIds: string[];
  /** Что показать под изображением об источнике (см. Provenance). */
  provenance: Provenance;
}

export interface ConversationTerm {
  term: string;
  definition: string;
}

export interface ConversationFlashcard {
  question: string;
  answer: string;
}

export interface ConversationSource {
  id: string;
  text: string;
}

export interface ConversationContext {
  title?: string;
  terms?: ConversationTerm[] | null;
  flashcards?: ConversationFlashcard[] | null;
  sources?: ConversationSource[] | null;
}
