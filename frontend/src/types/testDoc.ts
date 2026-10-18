/**
 * «Студия теста» (spec meldy-notes 10_Project/Test_Builder_Spec_2026-10-18.md §47.6; plan
 * docs/superpowers/plans/2026-10-18-studio.md): a test is a page the author builds from blocks, like a site builder.
 * The document keeps the page (blocks, theme, layout, the result screen); the questions themselves stay rows of
 * test_items (sessions, the bot and the stats keep working) and a question block only points at one by id.
 * Stored per exam in public.test_docs (≤ 200 KB, a revision for two tabs); the server checks the same shape
 * (meldy_private.test_doc_ok) — keep both in step.
 */
import type { Uuid } from './container';
import type { QuizAccent } from './quiz';

export const TEST_DOC_VERSION = 1 as const;
export const DOC_MAX_BLOCKS = 400;
export const DOC_MAX_BYTES = 200 * 1024;
export const DOC_TEXT_MAX = 4000;
export const DOC_TITLE_MAX = 200;
export const DOC_CAPTION_MAX = 300;
export const DOC_URL_MAX = 300;
export const DOC_MAX_BANDS = 6;
/** Block ids: short, made on the client, unique in a document. */
export const BLOCK_ID_RE = /^[a-z0-9]{8,24}$/;
/** Pictures of the page live in the public bucket quiz-covers, in the exam's folder (like the cover). */
export const DOC_IMAGE_RE = /^[0-9a-f-]{36}\/[0-9a-f]{64}\.(png|jpg|gif|webp)$/;
export const HEX_RE = /^#[0-9a-f]{6}$/;

/**
 * Text of a text block or a note: plain text with three marks only — **bold**, *italic* and [words](https://…).
 * Never HTML; links only https, shown with their address.
 */
export type RichText = string;

export interface CoverBlock {
  type: 'cover';
  id: string;
  title: string; // 1..200
  subtitle: string; // 0..300
  image: string | null; // DOC_IMAGE_RE
  align: 'left' | 'center';
}
export interface HeadingBlock {
  type: 'heading';
  id: string;
  text: string; // 1..200
  size: 'l' | 'm';
}
export interface TextBlock {
  type: 'text';
  id: string;
  text: RichText; // 1..4000
  align: 'left' | 'center';
}
export interface ImageBlock {
  type: 'image';
  id: string;
  path: string; // DOC_IMAGE_RE
  caption: string; // 0..300
  width: 'narrow' | 'wide' | 'full';
}
export interface NoteBlock {
  type: 'note';
  id: string;
  tone: 'info' | 'tip' | 'warn';
  text: RichText; // 1..4000
}
export interface DividerBlock {
  type: 'divider';
  id: string;
}
/** A new page of the «по страницам» layout (ignored by the other layouts). */
export interface PageBlock {
  type: 'page';
  id: string;
  title: string; // 0..200
}
export interface QuestionBlock {
  type: 'question';
  id: string;
  item_id: Uuid; // a test_items row of this exam; each at most once in a document
  points: number; // 1..100, default 1
  required: boolean; // «одна страница» / «по страницам»: cannot send without it
}
export type DocBlock = CoverBlock | HeadingBlock | TextBlock | ImageBlock | NoteBlock | DividerBlock | PageBlock | QuestionBlock;
export type DocBlockType = DocBlock['type'];
export const DOC_BLOCK_TYPES: readonly DocBlockType[] = ['cover', 'heading', 'text', 'image', 'note', 'divider', 'page', 'question'];

export type DocFont = 'onest' | 'serif' | 'mono';
export type DocRadius = 'soft' | 'round' | 'square';
export type DocDensity = 'airy' | 'compact';
export type DocAnswers = 'list' | 'grid';
export type DocButtons = 'pill' | 'rounded' | 'square';
export type DocBackground =
  | { kind: 'plain' }
  | { kind: 'soft'; tone: QuizAccent } // a soft gradient of the accent
  | { kind: 'image'; path: string; dim: number }; // dim 0..80 (%), the text stays readable

export interface DocTheme {
  /** One of Meldy's six, or the author's own colour (checked and nudged for contrast before saving). */
  accent: QuizAccent | { custom: string };
  background: DocBackground;
  font: DocFont;
  radius: DocRadius;
  density: DocDensity;
  answers: DocAnswers;
  buttons: DocButtons;
}

/** How the participant goes through the page. */
export type DocLayout = 'one_by_one' | 'one_page' | 'pages';

export interface ResultBand {
  from: number; // 0..100, inclusive
  to: number; // from..100, inclusive; bands do not overlap
  title: string; // 1..200
  text: RichText; // 0..4000
  image: string | null;
}
export interface DocResults {
  bands: ResultBand[]; // 0..DOC_MAX_BANDS
  /** «Ссылка дальше» on the result screen: https only, shown with its address. */
  cta: { label: string; url: string } | null;
}

export interface TestDoc {
  v: typeof TEST_DOC_VERSION;
  title: string; // 1..200 — the page's own title (the exam keeps its own)
  theme: DocTheme;
  layout: DocLayout;
  blocks: DocBlock[];
  results: DocResults;
}

/** public.test_doc_get / test_doc_save. rev starts at 1; a save with an older rev → MC020 «stale». */
export interface TestDocRow {
  container_id: Uuid;
  doc: TestDoc;
  rev: number;
  updated_at: string;
}
