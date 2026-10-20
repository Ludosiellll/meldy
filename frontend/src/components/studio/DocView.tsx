import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from 'react';
import { coverUrl } from '../../api/itemPictures';
import { themeTokens } from '../../lib/studio/contrast';
import { BLOCK_WORDS } from '../../lib/studio/doc';
import { linkAddress } from '../../lib/studio/richText';
import { cleanVideoUrl, videoEmbed } from '../../lib/studio/video';
import { isPictureWord } from '../../types/container';
import { DOC_CAPTION_MAX, DOC_TEXT_MAX, DOC_TITLE_MAX, type DocBlock, type ResultBand, type TestDoc } from '../../types/testDoc';
import ItemPictures, { storedPictures } from '../containers/ItemPictures';
import { CodeBlock } from '../containers/QuestionCard';
import { stemParts } from '../containers/stemCode';
import { letter } from '../containers/copyImport';
import Editable from './Editable';
import Rich from './Rich';
import { DOC, STUDIO } from './copyStudio';
import { BlockIcon, UiIcon } from './icons';
import { draggingFiles, pasteKeys, pictureFiles, type UploadStage } from './pictures';
import { answered, missingRequired, questionNumbers, stepsOf, visibleBlocks, type Answer, type Answers, type DocItem, type DocResultView, type Step } from './docRun';
import './docview.css';

/**
 * The one renderer of a studio page (plan docs/superpowers/plans/2026-10-18-studio.md: «One renderer for the canvas
 * and the participant»): every block in the page's theme (lib/studio/contrast.ts themeTokens as CSS custom properties;
 * the quiz page's --qt-* names, so the colours are the participant's), the questions as the participant answers them
 * (a list, or tiles 2 × 2 — on a phone too), the layouts with «Дальше / Назад», and the result screen with the band
 * and the link further shown with its address.
 *
 * - `mode="answer"` is the author's preview of what the participant gets: the answers live here, «Завершить» (the last
 *   step's word, as in the participant's run) hands them to `onSubmit`, and the result it gives is shown. Question
 *   blocks whose row is missing are skipped.
 * - `mode="edit"` is the studio's canvas: every block in page order (a «Новая страница» shows as a mark between
 *   pages), the texts editable in place (Editable), and the canvas's own frame around each block (`editor.frame`:
 *   selection, the handle, the actions) and between them (`editor.gap`: «+» and the drop line).
 * - `mode="take"` is a quiz «как в студии» (release 47.2, components/quiz/QuizDocRun.tsx): the same steps and blocks,
 *   but the caller keeps everything — the answers (saved to the server as they change), the step, the required
 *   questions it has to name, «Назад / Дальше / Завершить» — and the options stand in the attempt's order. No result
 *   screen: the quiz has its own.
 *
 * The background picture sits in its own layer (`.dv-bg`, position: fixed): a frame that holds the page (the canvas,
 * the preview) makes itself its containing block, so the picture stays while the page scrolls over it.
 *
 * A video block (owner, 2026-10-19) is the provider's player in a sandboxed frame (lib/studio/video.ts videoEmbed: the
 * player's address made from the link's checked parts; YouTube from youtube-nocookie.com), lazy, 16:9. On the canvas a
 * clear layer over it keeps a press for the block (selecting, dragging); the preview and the participant play it.
 */

export interface DocEditApi {
  frame: (block: DocBlock, index: number, node: ReactNode) => ReactNode;
  gap: (index: number) => ReactNode;
  /** The field being typed in, `${blockId}:${field}`. */
  editing: string | null;
  setEditing: (key: string | null, how?: 'blur' | 'enter' | 'escape') => void;
  change: (blockId: string, patch: Record<string, unknown>, field: string) => void;
  slash: (blockId: string, anchor: HTMLElement) => void;
  pickImage: (blockId: string) => void;
  /** The block whose picture is being uploaded. */
  uploading?: string | null;
  /** What a picture block's upload is doing (Workspace: «Уменьшаю фото…», «Загружаю картинку…»). */
  pictureStage?: (blockId: string) => UploadStage | null;
  /** Why a picture block's last upload failed. */
  pictureNote?: (blockId: string) => string | null;
  /** A file dropped onto a picture block without a picture. */
  dropPicture?: (blockId: string, file: Blob) => void;
  /** A touch screen (no dragging of files). */
  touch?: boolean;
  /** Shown in place of the blocks when there are none. */
  empty?: ReactNode;
  /** Ids of the selected block (its placeholders show). */
  selected: string | null;
}

interface CommonProps {
  doc: TestDoc;
  items: ReadonlyMap<string, DocItem>;
  dark: boolean;
  /** The public address of a page picture (quiz-covers). */
  imageUrl?: (path: string) => string;
  /** Narrow frame: a phone (the canvas's phone frame, the preview); else the page's own width decides. */
  className?: string;
}

export interface EditProps extends CommonProps {
  mode: 'edit';
  editor: DocEditApi;
}

export interface AnswerProps extends CommonProps {
  mode: 'answer';
  onSubmit: (answers: Answers) => DocResultView | Promise<DocResultView>;
  /** «Пройти ещё раз» on the result screen (the author's preview). */
  onRestart?: () => void;
  /** Open on the result screen with this result (the author looks at a band). */
  result?: DocResultView | null;
}

/** A quiz «как в студии» (release 47.2): the caller keeps the answers and the step (QuizDocRun). */
export interface TakeProps extends CommonProps {
  mode: 'take';
  answers: Answers;
  onAnswer: (itemId: string, answer: Answer) => void;
  /** The order each question's options stand in (file indices by place: the attempt's shuffle); missing — the file's. */
  orders?: ReadonlyMap<string, readonly number[]>;
  /** The step shown, of stepsOf(doc, visibleBlocks(doc, items)). */
  at: number;
  /** Required questions without an answer the participant was just told about (their numbers): marked, and said. */
  missing?: readonly number[];
  /** «Назад» is offered on the steps after the first. */
  canBack: boolean;
  onBack: () => void;
  onNext: () => void;
  /** The last step's button, «Завершить». */
  onFinish: () => void;
  /** Lines of the caller over the blocks (time is running out, the attempt goes on) and under them («Сохранено»). */
  top?: ReactNode;
  under?: ReactNode;
  /** Read on arriving at a step (the focus goes to it): «Вопрос 2 из 6». */
  stepLabel?: string;
  /** A question to bring into view instead of the step's top (from «Все вопросы»); `key` repeats a jump. */
  jump?: { blockId: string; key: number } | null;
}

export type DocViewProps = EditProps | AnswerProps | TakeProps;

// ─────────────────────────────────────────────── blocks

function Arrow() {
  return (
    <svg className="dv-arrow" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4 10h11M11 5.5 15.5 10 11 14.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

interface FieldCtx {
  editor: DocEditApi | null;
  block: DocBlock;
}

/** A text of a block: editable on the canvas, plain (or rich) for the participant. */
function Field({
  ctx,
  field,
  value,
  label,
  as,
  className,
  rich = false,
  multiline = false,
  max,
  placeholder,
  starter,
  hideEmpty = false,
  slash = false,
}: {
  ctx: FieldCtx;
  field: string;
  value: string;
  label: string;
  as: 'h1' | 'h2' | 'h3' | 'p' | 'div' | 'figcaption';
  className: string;
  rich?: boolean;
  multiline?: boolean;
  max: number;
  placeholder?: string;
  /** The words a new block of this type starts with (BLOCK_WORDS): still them, they open selected. */
  starter?: string;
  /** An empty optional text (a subtitle, a caption) shows only while its block is selected. */
  hideEmpty?: boolean;
  slash?: boolean;
}) {
  const { editor, block } = ctx;
  if (!editor) {
    if (!value.trim()) return null;
    const Tag = as;
    return <Tag className={className}>{rich ? <Rich text={value} /> : value}</Tag>;
  }
  const key = `${block.id}:${field}`;
  const active = editor.editing === key;
  if (hideEmpty && !value.trim() && !active && editor.selected !== block.id) return null;
  return (
    <Editable
      as={as}
      className={className}
      value={value}
      label={label}
      rich={rich}
      multiline={multiline}
      max={max}
      placeholder={placeholder}
      starter={starter}
      active={active}
      onActivate={() => editor.setEditing(key)}
      onDone={(how) => editor.setEditing(null, how)}
      onChange={(next) => editor.change(block.id, { [field]: next }, field)}
      onSlash={slash ? (anchor) => editor.slash(block.id, anchor) : undefined}
    />
  );
}

function Picture({ path, alt, className, imageUrl }: { path: string; alt: string; className: string; imageUrl: (path: string) => string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [path]);
  return <span className={className}>{failed ? null : <img src={imageUrl(path)} alt={alt} decoding="async" loading="lazy" onError={() => setFailed(true)} />}</span>;
}

/** A picture block without its picture on the canvas: the upload first, a file can be dropped onto it. */
function EmptyPicture({ blockId, editor }: { blockId: string; editor: DocEditApi }) {
  const stage = editor.pictureStage?.(blockId) ?? (editor.uploading === blockId ? 'upload' : null);
  const note = editor.pictureNote?.(blockId) ?? null;
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const drop = editor.dropPicture;
  const files = (event: DragEvent<HTMLElement>) => Boolean(drop) && !stage && draggingFiles(event.dataTransfer);
  return (
    <span
      className="dv-pic dv-pic-empty"
      data-drop={over ? '' : undefined}
      onDragEnter={(event) => {
        if (!files(event)) return;
        event.preventDefault();
        depth.current += 1;
        setOver(true);
      }}
      onDragOver={(event) => {
        if (!files(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={(event) => {
        if (!files(event)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      }}
      onDrop={(event) => {
        if (!files(event)) return;
        event.preventDefault();
        depth.current = 0;
        setOver(false);
        const file = pictureFiles(event.dataTransfer.files)[0] ?? event.dataTransfer.files[0];
        if (file) drop?.(blockId, file);
      }}
    >
      <span className="dv-pic-line" role="status">
        {stage === 'read' ? STUDIO.imagePreparing : stage === 'shrink' ? STUDIO.imageShrinking : stage === 'upload' ? STUDIO.imageUploading : over ? STUDIO.pictureDropNow : STUDIO.imageEmpty}
      </span>
      {stage ? null : (
        <button type="button" className="dv-pic-pick" onClick={() => editor.pickImage(blockId)}>
          <UiIcon name="upload" />
          <span>{STUDIO.imagePick}</span>
        </button>
      )}
      {stage || editor.touch ? null : <span className="dv-pic-hint">{STUDIO.pictureDropHint(pasteKeys())}</span>}
      {note ? (
        <span className="dv-pic-note" role="alert">
          {note}
        </span>
      ) : null}
    </span>
  );
}

/** A video block without a link the page takes, on the canvas: a field for the link (a pasted one shows at once). */
function VideoLink({ blockId, value, editor }: { blockId: string; value: string; editor: DocEditApi }) {
  const id = useId();
  const [text, setText] = useState(value);
  const [bad, setBad] = useState(false);
  const badRef = useRef<HTMLSpanElement>(null);
  // The words of a link not taken come into sight (live check of 47.4: on a phone they stood under the bottom bar).
  useEffect(() => {
    if (bad) badRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [bad]);
  const put = (raw: string) => {
    const url = cleanVideoUrl(raw);
    setBad(!url);
    if (url) editor.change(blockId, { url }, 'url');
  };
  return (
    <span className="dv-pic dv-pic-empty dv-video-empty">
      <span className="dv-video-ico" aria-hidden="true">
        <BlockIcon type="video" />
      </span>
      <label className="dv-pic-line" htmlFor={id}>
        {STUDIO.videoEmpty}
      </label>
      <span className="dv-video-put">
        <input
          id={id}
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder={STUDIO.videoPlaceholder}
          value={text}
          aria-invalid={bad || undefined}
          aria-describedby={bad ? `${id}-bad` : undefined}
          onChange={(event) => {
            setText(event.target.value);
            if (bad) setBad(false);
          }}
          onPaste={(event) => {
            const pasted = event.clipboardData.getData('text');
            if (!cleanVideoUrl(pasted)) return;
            event.preventDefault();
            setText(pasted);
            put(pasted);
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
            event.preventDefault();
            put(text);
          }}
        />
        <button type="button" className="dv-pic-pick" onClick={() => put(text)}>
          {STUDIO.videoPut}
        </button>
      </span>
      {bad ? (
        <span ref={badRef} className="dv-pic-note" id={`${id}-bad`} role="alert">
          {STUDIO.videoBad}
        </span>
      ) : null}
    </span>
  );
}

/** The player of a video block: a sandboxed frame of the provider; on the canvas a layer over it keeps the press. */
export function VideoPlayer({ url, caption, edit }: { url: string; caption: string; edit: boolean }) {
  const embed = videoEmbed(url);
  if (!embed) return null;
  return (
    <span className="dv-video-frame">
      <iframe
        src={embed.src}
        title={caption.trim() || STUDIO.videoTitles[embed.provider]}
        sandbox="allow-scripts allow-same-origin allow-presentation"
        // `allow` alone: with allowFullScreen as well the browser warned about both (live check of 47.4).
        allow="fullscreen; picture-in-picture"
        referrerPolicy="strict-origin-when-cross-origin"
        loading="lazy"
        tabIndex={edit ? -1 : undefined}
      />
      {edit ? <span className="dv-video-shield" aria-hidden="true" /> : null}
    </span>
  );
}

/** The question's words, code and pictures, as QuestionCard shows them. */
function Stem({ item, heading }: { item: DocItem; heading: 'h2' | 'h3' }) {
  const parts = stemParts(item.stem, item.code);
  const pictures = storedPictures(item.images?.stem);
  const pictureOnly = pictures.length > 0 && isPictureWord(item.stem);
  const Tag = heading;
  return (
    <>
      {parts.before && !pictureOnly ? <Tag className="dv-stem">{parts.before}</Tag> : <Tag className="sr-only">{item.stem.split('\n')[0]}</Tag>}
      {pictures.length > 0 ? <ItemPictures sources={pictures} kind="stem" /> : null}
      {parts.code ? <CodeBlock code={parts.code} /> : null}
      {parts.after ? <p className="dv-stem-after">{parts.after}</p> : null}
    </>
  );
}

function OptionWords({ item, index }: { item: DocItem; index: number }) {
  const text = item.options[index] ?? '';
  const sources = storedPictures(item.images?.options?.[index]);
  if (sources.length === 0) return <>{text}</>;
  return (
    <>
      <ItemPictures sources={sources} kind="option" />
      {isPictureWord(text) ? <span className="sr-only">{text}</span> : <span className="dv-opt-words">{text}</span>}
    </>
  );
}

interface QuestionProps {
  block: DocBlock & { type: 'question' };
  item: DocItem;
  number: number;
  /** File indices by place (the attempt's shuffle); missing — the file's order. */
  order?: readonly number[];
  /** Answer mode: the answer and how to change it. Edit mode: undefined (the options are drawn, not pressed). */
  answer?: Answer;
  onAnswer?: (answer: Answer) => void;
  /** Edit mode: the key is marked for the author. */
  showKey?: boolean;
  missing?: boolean;
}

/** A short answer is at most this long (quiz_answer keeps 200). */
const SHORT_MAX = 200;

/** The order given when it is a whole order of the options, else the file's. */
function orderOf(item: DocItem, given: readonly number[] | undefined): readonly number[] {
  const files = item.options.map((_, index) => index);
  if (!given || given.length !== files.length) return files;
  const whole = new Set(given).size === files.length && given.every((index) => Number.isInteger(index) && index >= 0 && index < files.length);
  return whole ? given : files;
}

function Question({ block, item, number, order: given, answer, onAnswer, showKey = false, missing = false }: QuestionProps) {
  const multiple = item.kind === 'multiple';
  const live = Boolean(onAnswer);
  const chosen = answer?.chosen ?? [];
  const order = orderOf(item, given);
  const pick = (index: number) => {
    if (!onAnswer) return;
    if (multiple) onAnswer({ chosen: chosen.includes(index) ? chosen.filter((at) => at !== index) : [...chosen, index].sort((a, b) => a - b) });
    else onAnswer({ chosen: [index] });
  };
  const headId = `dv-q-${block.id}`;
  return (
    <section className="dv-q" aria-labelledby={headId} data-missing={missing ? '' : undefined}>
      <p className="dv-q-head" id={headId} tabIndex={live ? -1 : undefined}>
        <span>{DOC.questionNo(number)}</span>
        {block.points !== 1 ? <span className="dv-q-meta">{DOC.points(block.points)}</span> : null}
        {block.required ? <span className="dv-q-meta">{DOC.required}</span> : null}
      </p>
      <Stem item={item} heading="h3" />
      {item.kind === 'short' ? (
        <label className="dv-short">
          <span className="dv-short-label">{DOC.shortLabel}</span>
          <input
            type="text"
            value={live ? answer?.text ?? '' : showKey ? item.answers?.[0] ?? '' : ''}
            readOnly={!live}
            tabIndex={live ? undefined : -1}
            maxLength={live ? SHORT_MAX : undefined}
            autoComplete="off"
            spellCheck={false}
            data-key={!live && showKey && (item.answers?.length ?? 0) > 0 ? '' : undefined}
            onChange={(event) => onAnswer?.({ text: event.target.value })}
          />
        </label>
      ) : (
        <>
          {multiple ? <p className="dv-hint">{DOC.multipleHint}</p> : null}
          <div className="dv-opts" role={live ? (multiple ? 'group' : 'radiogroup') : 'list'} aria-label={DOC.options}>
            {order.map((index, place) => {
              const on = chosen.includes(index);
              const key = showKey && (item.correct ?? []).includes(index);
              const inner = (
                <>
                  <span className="dv-opt-l" aria-hidden="true">
                    {multiple ? (
                      <svg viewBox="0 0 16 16">
                        <path d="M3.5 8.5l3 3 6-7" />
                      </svg>
                    ) : (
                      letter(place)
                    )}
                  </span>
                  <span className="dv-opt-t">
                    <OptionWords item={item} index={index} />
                    {key ? <span className="dv-opt-key">{STUDIO.keyMark}</span> : null}
                  </span>
                </>
              );
              return live ? (
                <button
                  key={index}
                  type="button"
                  className="dv-opt"
                  role={multiple ? 'checkbox' : 'radio'}
                  aria-checked={on}
                  data-on={on ? '' : undefined}
                  data-multi={multiple ? '' : undefined}
                  onClick={() => pick(index)}
                >
                  {inner}
                </button>
              ) : (
                <div key={index} className="dv-opt" role="listitem" data-multi={multiple ? '' : undefined} data-key={key ? '' : undefined}>
                  {inner}
                </div>
              );
            })}
          </div>
        </>
      )}
      {missing ? <p className="dv-q-need">{DOC.needAnswer}</p> : null}
    </section>
  );
}

interface BlockProps {
  block: DocBlock;
  doc: TestDoc;
  items: ReadonlyMap<string, DocItem>;
  numbers: ReadonlyMap<string, number>;
  pageNumbers: ReadonlyMap<string, number>;
  imageUrl: (path: string) => string;
  editor: DocEditApi | null;
  answers?: Answers;
  onAnswer?: (itemId: string, answer: Answer) => void;
  missing?: ReadonlySet<string>;
  orders?: ReadonlyMap<string, readonly number[]>;
}

function Block({ block, doc, items, numbers, pageNumbers, imageUrl, editor, answers, onAnswer, missing, orders }: BlockProps) {
  const ctx: FieldCtx = { editor, block };
  switch (block.type) {
    case 'cover':
      return (
        <header className="dv-cover" data-align={block.align} data-image={block.image ? '' : undefined}>
          {block.image ? <Picture path={block.image} alt="" className="dv-cover-pic" imageUrl={imageUrl} /> : null}
          <div className="dv-cover-body">
            <Field ctx={ctx} field="title" value={block.title} label={STUDIO.coverTitle} as="h1" className="dv-cover-title" max={DOC_TITLE_MAX} starter={BLOCK_WORDS.cover} />
            <Field ctx={ctx} field="subtitle" value={block.subtitle} label={STUDIO.coverSubtitle} placeholder={STUDIO.subtitleAdd} as="p" className="dv-cover-sub" max={DOC_CAPTION_MAX} hideEmpty />
          </div>
        </header>
      );
    case 'heading':
      return (
        <div className="dv-on-bg">
          <Field ctx={ctx} field="text" value={block.text} label={STUDIO.types.heading} as="h2" className={`dv-heading dv-heading-${block.size}`} max={DOC_TITLE_MAX} starter={BLOCK_WORDS.heading} />
        </div>
      );
    case 'text':
      return (
        <div className="dv-on-bg" data-align={block.align}>
          <Field ctx={ctx} field="text" value={block.text} label={STUDIO.types.text} placeholder={STUDIO.emptyText} as="div" className="dv-text" rich multiline max={DOC_TEXT_MAX} starter={BLOCK_WORDS.text} slash />
        </div>
      );
    case 'note':
      return (
        <aside className="dv-note" data-tone={block.tone}>
          {block.tone !== 'info' ? <p className="dv-note-label">{STUDIO.tones[block.tone]}</p> : null}
          <Field ctx={ctx} field="text" value={block.text} label={STUDIO.types.note} as="div" className="dv-note-text" rich multiline max={DOC_TEXT_MAX} starter={BLOCK_WORDS.note} />
        </aside>
      );
    case 'image':
      return (
        <figure className="dv-figure" data-width={block.width}>
          {block.path ? (
            <Picture path={block.path} alt={block.caption} className="dv-pic" imageUrl={imageUrl} />
          ) : editor ? (
            <EmptyPicture blockId={block.id} editor={editor} />
          ) : null}
          <Field ctx={ctx} field="caption" value={block.caption} label={STUDIO.caption} placeholder={STUDIO.captionAdd} as="figcaption" className="dv-caption" max={DOC_CAPTION_MAX} hideEmpty />
        </figure>
      );
    case 'video': {
      const playable = videoEmbed(block.url) !== null;
      if (!playable && !editor) return null;
      return (
        <figure className="dv-figure dv-video" data-width="wide">
          {playable ? <VideoPlayer url={block.url} caption={block.caption} edit={Boolean(editor)} /> : editor ? <VideoLink key={block.url} blockId={block.id} value={block.url} editor={editor} /> : null}
          <Field ctx={ctx} field="caption" value={block.caption} label={STUDIO.caption} placeholder={STUDIO.captionAdd} as="figcaption" className="dv-caption" max={DOC_CAPTION_MAX} hideEmpty />
        </figure>
      );
    }
    case 'divider':
      return <hr className="dv-divider" />;
    case 'page':
      if (!editor) return block.title.trim() ? <h2 className="dv-page-title dv-on-bg">{block.title}</h2> : null;
      return (
        <div className="dv-pagemark" data-off={doc.layout === 'pages' ? undefined : ''}>
          <span className="dv-pagemark-n">{STUDIO.pageMark(pageNumbers.get(block.id) ?? 2)}</span>
          <Field ctx={ctx} field="title" value={block.title} label={STUDIO.pageBlockTitle} placeholder={STUDIO.pageUntitled} as="p" className="dv-pagemark-title" max={DOC_TITLE_MAX} />
        </div>
      );
    case 'question': {
      const item = items.get(block.item_id);
      if (!item) return editor ? <div className="dv-q dv-q-gone">{STUDIO.gone}</div> : null;
      return (
        <Question
          block={block}
          item={item}
          number={numbers.get(block.id) ?? 0}
          order={orders?.get(item.id)}
          showKey={Boolean(editor)}
          answer={answers?.[item.id]}
          onAnswer={onAnswer ? (answer) => onAnswer(item.id, answer) : undefined}
          missing={missing?.has(block.id)}
        />
      );
    }
  }
}

// ─────────────────────────────────────────────── the result screen

function ResultScreen({ doc, result, imageUrl, onRestart }: { doc: TestDoc; result: DocResultView; imageUrl: (path: string) => string; onRestart?: () => void }) {
  const band: ResultBand | null = result.band;
  const cta = doc.results.cta;
  const headRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headRef.current?.focus({ preventScroll: false }), []);
  return (
    <section className="dv-result" aria-labelledby="dv-result-head">
      <p className="dv-result-kicker">{DOC.result}</p>
      <h1 className="dv-result-score" id="dv-result-head" ref={headRef} tabIndex={-1}>
        {DOC.percent(result.percent)}
      </h1>
      <p className="dv-result-points">{DOC.score(result.score, result.max)}</p>
      <div className="dv-meter" aria-hidden="true">
        <span style={{ width: `${Math.max(0, Math.min(100, result.percent))}%` }} />
      </div>
      {band ? (
        <div className="dv-band" data-pic={band.image ? '' : undefined}>
          <div className="dv-band-words">
            <h2 className="dv-band-title">{band.title}</h2>
            {band.text.trim() ? (
              <div className="dv-band-text">
                <Rich text={band.text} />
              </div>
            ) : null}
          </div>
          {band.image ? <Picture path={band.image} alt="" className="dv-band-pic" imageUrl={imageUrl} /> : null}
        </div>
      ) : null}
      {cta ? (
        <p className="dv-cta">
          <a className="dv-btn" href={cta.url} target="_blank" rel="noopener noreferrer nofollow ugc">
            <span>{cta.label}</span>
            <Arrow />
          </a>
          <span className="dv-cta-addr">{linkAddress(cta.url)}</span>
        </p>
      ) : null}
      {onRestart ? (
        <p className="dv-restart">
          <button type="button" className="dv-quiet" onClick={onRestart}>
            {STUDIO.previewAgain}
          </button>
        </p>
      ) : null}
    </section>
  );
}

// ─────────────────────────────────────────────── the page

function useStyle(doc: TestDoc, dark: boolean): CSSProperties {
  return useMemo(() => themeTokens(doc.theme, dark) as CSSProperties, [doc.theme, dark]);
}

export default function DocView(props: DocViewProps) {
  const { doc, items, dark, imageUrl = coverUrl, className } = props;
  const style = useStyle(doc, dark);
  const background = doc.theme.background;
  const shown = useMemo(() => (props.mode === 'edit' ? doc.blocks : visibleBlocks(doc, items)), [props.mode, doc, items]);
  const numbers = useMemo(() => questionNumbers(props.mode === 'edit' ? doc.blocks.filter((block) => block.type !== 'question' || items.has(block.item_id)) : shown), [props.mode, doc.blocks, items, shown]);
  const pageNumbers = useMemo(() => {
    const out = new Map<string, number>();
    doc.blocks.forEach((block) => {
      if (block.type === 'page') out.set(block.id, out.size + 2);
    });
    return out;
  }, [doc.blocks]);

  const root = (body: ReactNode, extra?: Record<string, string | undefined>) => (
    <div
      className={`dv${className ? ` ${className}` : ''}`}
      style={style}
      data-font={doc.theme.font}
      data-bg={background.kind}
      data-answers={doc.theme.answers}
      data-density={doc.theme.density}
      data-buttons={doc.theme.buttons}
      data-dark={dark ? '' : undefined}
      {...extra}
    >
      {background.kind === 'image' ? (
        <div className="dv-bg" aria-hidden="true">
          <img src={imageUrl(background.path)} alt="" decoding="async" />
          <span className="dv-bg-dim" />
        </div>
      ) : null}
      <div className="dv-body">{body}</div>
    </div>
  );

  if (props.mode === 'edit') {
    const { editor } = props;
    return root(
      <div className="dv-col" data-mode="edit">
        {doc.blocks.length === 0 ? editor.empty ?? null : null}
        {doc.blocks.map((block, index) => (
          <EditSlot key={block.id} gap={editor.gap(index)}>
            {editor.frame(
              block,
              index,
              <Block block={block} doc={doc} items={items} numbers={numbers} pageNumbers={pageNumbers} imageUrl={imageUrl} editor={editor} />,
            )}
          </EditSlot>
        ))}
        {editor.gap(doc.blocks.length)}
      </div>,
      { 'data-mode': 'edit' },
    );
  }

  if (props.mode === 'take') return root(<TakeFlow {...props} shown={shown} numbers={numbers} pageNumbers={pageNumbers} imageUrl={imageUrl} />, { 'data-mode': 'answer' });
  return root(<AnswerFlow {...props} shown={shown} numbers={numbers} pageNumbers={pageNumbers} imageUrl={imageUrl} />, { 'data-mode': 'answer' });
}

function EditSlot({ gap, children }: { gap: ReactNode; children: ReactNode }) {
  return (
    <>
      {gap}
      {children}
    </>
  );
}

function AnswerFlow({
  doc,
  items,
  onSubmit,
  onRestart,
  result: given,
  shown,
  numbers,
  pageNumbers,
  imageUrl,
}: AnswerProps & { shown: DocBlock[]; numbers: Map<string, number>; pageNumbers: Map<string, number>; imageUrl: (path: string) => string }) {
  const steps = useMemo(() => stepsOf(doc, shown), [doc, shown]);
  const [at, setAt] = useState(0);
  const [answers, setAnswers] = useState<Record<string, Answer | undefined>>({});
  const [missing, setMissing] = useState<number[]>([]);
  const [result, setResult] = useState<DocResultView | null>(given ?? null);
  const [sending, setSending] = useState(false);
  // Each press that finds required questions without an answer: the first of them is brought into view.
  const [asked, setAsked] = useState(0);
  const topRef = useRef<HTMLDivElement>(null);
  const colRef = useRef<HTMLDivElement>(null);
  const step = steps[Math.min(at, steps.length - 1)];
  const last = at >= steps.length - 1;
  const paged = steps.length > 1;

  useEffect(() => setResult(given ?? null), [given]);

  // As the participant's run does (QuizDocRun «Завершить»): the first required question left without an answer comes
  // into view — inside the preview's frame, which scrolls by itself — and its head takes the focus, read from its number.
  useEffect(() => {
    if (asked === 0) return;
    const card = colRef.current?.querySelector<HTMLElement>('.dv-q[data-missing]');
    if (!card) return;
    card.scrollIntoView?.({ block: 'start' });
    card.querySelector<HTMLElement>('.dv-q-head')?.focus({ preventScroll: true });
  }, [asked]);

  const missingIds = useMemo(() => {
    const set = new Set<string>();
    if (missing.length === 0) return set;
    for (const block of step.blocks) if (block.type === 'question' && missing.includes(numbers.get(block.id) ?? -1)) set.add(block.id);
    return set;
  }, [missing, step, numbers]);

  const go = (next: number) => {
    setMissing([]);
    setAt(next);
    topRef.current?.scrollIntoView?.({ block: 'start' });
    window.requestAnimationFrame?.(() => topRef.current?.focus({ preventScroll: true }));
  };

  const forward = async () => {
    // «По одному» asks for nothing: the participant may move on (the server grades what came).
    const gaps = doc.layout === 'one_by_one' ? [] : missingRequired(step.blocks, answers, numbers);
    if (gaps.length > 0) {
      setMissing(gaps);
      setAsked((n) => n + 1);
      return;
    }
    if (!last) {
      go(at + 1);
      return;
    }
    setSending(true);
    try {
      setResult(await onSubmit(answers));
    } finally {
      setSending(false);
    }
  };

  if (result) {
    return (
      <div className="dv-col" data-mode="answer">
        <ResultScreen
          doc={doc}
          result={result}
          imageUrl={imageUrl}
          onRestart={
            onRestart
              ? () => {
                  setAnswers({});
                  setResult(null);
                  setAt(0);
                  onRestart();
                }
              : undefined
          }
        />
      </div>
    );
  }

  return (
    <div ref={colRef} className="dv-col" data-mode="answer">
      <div ref={topRef} tabIndex={-1} className="dv-top" aria-live="polite">
        {paged ? (
          <div className="dv-progress">
            <span className="dv-progress-n">{DOC.step(at + 1, steps.length)}</span>
            <span className="dv-progress-bar" aria-hidden="true">
              <span style={{ width: `${((at + 1) / steps.length) * 100}%` }} />
            </span>
          </div>
        ) : null}
      </div>
      <StepBody
        step={step}
        doc={doc}
        items={items}
        numbers={numbers}
        pageNumbers={pageNumbers}
        imageUrl={imageUrl}
        answers={answers}
        missing={missing}
        missingIds={missingIds}
        onAnswer={(itemId, answer) => {
          setAnswers((current) => ({ ...current, [itemId]: answer }));
          if (missing.length > 0) setMissing([]);
        }}
        back={at > 0 ? () => go(at - 1) : null}
        primary={last ? DOC.finish : DOC.next}
        onPrimary={() => void forward()}
        busy={sending}
      />
    </div>
  );
}

/** A step's blocks, the line naming the required questions left, and the buttons (the preview's and the quiz's). */
function StepBody({
  step,
  doc,
  items,
  numbers,
  pageNumbers,
  imageUrl,
  answers,
  missing,
  missingIds,
  onAnswer,
  orders,
  back,
  primary,
  onPrimary,
  busy = false,
  under,
  pinned = false,
}: {
  step: Step;
  doc: TestDoc;
  items: ReadonlyMap<string, DocItem>;
  numbers: ReadonlyMap<string, number>;
  pageNumbers: ReadonlyMap<string, number>;
  imageUrl: (path: string) => string;
  answers: Answers;
  missing: readonly number[];
  missingIds: ReadonlySet<string>;
  onAnswer: (itemId: string, answer: Answer) => void;
  orders?: ReadonlyMap<string, readonly number[]>;
  /** «Назад», when there is a step to go back to. */
  back: (() => void) | null;
  primary: string;
  onPrimary: () => void;
  busy?: boolean;
  under?: ReactNode;
  /** The buttons stay at the window's bottom while the step scrolls (the quiz's screens of «По одному», «По страницам»). */
  pinned?: boolean;
}) {
  const questionsHere = step.blocks.filter((block) => block.type === 'question');
  const allAnswered = questionsHere.every((block) => block.type !== 'question' || answered(answers[block.item_id]));
  return (
    <>
      {step.page && step.page.title.trim() ? <h2 className="dv-page-title dv-on-bg">{step.page.title}</h2> : null}
      {step.blocks.length === 0 ? <p className="dv-empty dv-on-bg">{DOC.empty}</p> : null}
      {step.blocks.map((block) => (
        <Block
          key={block.id}
          block={block}
          doc={doc}
          items={items}
          numbers={numbers}
          pageNumbers={pageNumbers}
          imageUrl={imageUrl}
          editor={null}
          answers={answers}
          missing={missingIds}
          orders={orders}
          onAnswer={onAnswer}
        />
      ))}
      {missing.length > 0 ? (
        <p className="dv-missing" role="alert">
          {DOC.missing([...missing])}
        </p>
      ) : null}
      {under}
      <div className="dv-nav" data-ready={allAnswered ? '' : undefined} data-pinned={pinned ? '' : undefined}>
        {back ? (
          <button type="button" className="dv-quiet" onClick={back}>
            {DOC.back}
          </button>
        ) : (
          <span />
        )}
        <button type="button" className="dv-btn" onClick={onPrimary} aria-busy={busy || undefined} disabled={busy}>
          <span>{primary}</span>
          <Arrow />
        </button>
      </div>
    </>
  );
}

/**
 * The quiz's way through the page (mode «take»): the step the caller names, its blocks with the caller's answers, the
 * required questions it names marked (with a line in the question), «Назад / Дальше / Завершить» calling back — pinned
 * to the window's bottom on «По одному» and «По страницам», as the quiz's own pinned bar. Arriving at a step — the
 * first one too — takes the window to its top and the focus to a line that names the step (read by a screen reader),
 * or to the question asked for from «Все вопросы».
 */
function TakeFlow({
  doc,
  items,
  answers,
  onAnswer,
  orders,
  at,
  missing = [],
  canBack,
  onBack,
  onNext,
  onFinish,
  top,
  under,
  stepLabel,
  jump,
  shown,
  numbers,
  pageNumbers,
  imageUrl,
}: TakeProps & { shown: DocBlock[]; numbers: Map<string, number>; pageNumbers: Map<string, number>; imageUrl: (path: string) => string }) {
  const steps = useMemo(() => stepsOf(doc, shown), [doc, shown]);
  const place = Math.max(0, Math.min(at, steps.length - 1));
  const step = steps[place];
  const last = place >= steps.length - 1;
  const topRef = useRef<HTMLParagraphElement>(null);
  const missingIds = useMemo(() => {
    const set = new Set<string>();
    for (const block of step.blocks) if (block.type === 'question' && missing.includes(numbers.get(block.id) ?? -1)) set.add(block.id);
    return set;
  }, [missing, step, numbers]);

  useEffect(() => {
    // The question's head (its number) takes the focus: the question is read from there, Tab goes to its options.
    try {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
    } catch {
      // jsdom and old browsers: no scrolling to do.
    }
    const head = jump ? document.getElementById(`dv-q-${jump.blockId}`) : null;
    if (head) {
      // From the step's top when the question starts in the window's upper half (the page's title stays in view), else
      // the question at the top.
      const card = head.closest<HTMLElement>('.dv-q') ?? head;
      if (card.getBoundingClientRect().top > window.innerHeight / 2) card.scrollIntoView?.({ block: 'start' });
      head.focus({ preventScroll: true });
      return;
    }
    topRef.current?.focus({ preventScroll: true });
  }, [place, jump]);

  return (
    <div className="dv-col" data-mode="answer">
      <p ref={topRef} tabIndex={-1} className="dv-top sr-only">
        {stepLabel ?? ''}
      </p>
      {top}
      <StepBody
        step={step}
        doc={doc}
        items={items}
        numbers={numbers}
        pageNumbers={pageNumbers}
        imageUrl={imageUrl}
        answers={answers}
        missing={missing}
        missingIds={missingIds}
        onAnswer={onAnswer}
        orders={orders}
        back={canBack && place > 0 ? onBack : null}
        primary={last ? DOC.finish : DOC.next}
        onPrimary={last ? onFinish : onNext}
        under={under}
        pinned={doc.layout !== 'one_page'}
      />
    </div>
  );
}
