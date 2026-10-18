import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { coverUrl } from '../../api/itemPictures';
import { themeTokens } from '../../lib/studio/contrast';
import { linkAddress } from '../../lib/studio/richText';
import { isPictureWord } from '../../types/container';
import { DOC_CAPTION_MAX, DOC_TEXT_MAX, DOC_TITLE_MAX, type DocBlock, type ResultBand, type TestDoc } from '../../types/testDoc';
import ItemPictures, { storedPictures } from '../containers/ItemPictures';
import { CodeBlock } from '../containers/QuestionCard';
import { stemParts } from '../containers/stemCode';
import { letter } from '../containers/copyImport';
import Editable from './Editable';
import Rich from './Rich';
import { DOC, STUDIO } from './copyStudio';
import { answered, missingRequired, questionNumbers, stepsOf, visibleBlocks, type Answer, type Answers, type DocItem, type DocResultView } from './docRun';
import './docview.css';

/**
 * The one renderer of a studio page (plan docs/superpowers/plans/2026-10-18-studio.md: «One renderer for the canvas
 * and the participant»): every block in the page's theme (lib/studio/contrast.ts themeTokens as CSS custom properties;
 * the quiz page's --qt-* names, so the colours are the participant's), the questions as the participant answers them
 * (a list, or tiles 2 × 2 — on a phone too), the layouts with «Дальше / Назад», and the result screen with the band
 * and the link further shown with its address.
 *
 * - `mode="answer"` is what the participant gets: the answers live here, «Отправить» hands them to `onSubmit`, and the
 *   result it gives is shown. Question blocks whose row is missing are skipped.
 * - `mode="edit"` is the studio's canvas: every block in page order (a «Новая страница» shows as a mark between
 *   pages), the texts editable in place (Editable), and the canvas's own frame around each block (`editor.frame`:
 *   selection, the handle, the actions) and between them (`editor.gap`: «+» and the drop line).
 *
 * The background picture sits in its own layer (`.dv-bg`, position: fixed): a frame that holds the page (the canvas,
 * the preview) makes itself its containing block, so the picture stays while the page scrolls over it.
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

export type DocViewProps = EditProps | AnswerProps;

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
  /** Answer mode: the answer and how to change it. Edit mode: undefined (the options are drawn, not pressed). */
  answer?: Answer;
  onAnswer?: (answer: Answer) => void;
  /** Edit mode: the key is marked for the author. */
  showKey?: boolean;
  missing?: boolean;
}

function Question({ block, item, number, answer, onAnswer, showKey = false, missing = false }: QuestionProps) {
  const multiple = item.kind === 'multiple';
  const live = Boolean(onAnswer);
  const chosen = answer?.chosen ?? [];
  const order = item.options.map((_, index) => index);
  const pick = (index: number) => {
    if (!onAnswer) return;
    if (multiple) onAnswer({ chosen: chosen.includes(index) ? chosen.filter((at) => at !== index) : [...chosen, index].sort((a, b) => a - b) });
    else onAnswer({ chosen: [index] });
  };
  const headId = `dv-q-${block.id}`;
  return (
    <section className="dv-q" aria-labelledby={headId} data-missing={missing ? '' : undefined}>
      <p className="dv-q-head" id={headId}>
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
}

function Block({ block, doc, items, numbers, pageNumbers, imageUrl, editor, answers, onAnswer, missing }: BlockProps) {
  const ctx: FieldCtx = { editor, block };
  switch (block.type) {
    case 'cover':
      return (
        <header className="dv-cover" data-align={block.align} data-image={block.image ? '' : undefined}>
          {block.image ? <Picture path={block.image} alt="" className="dv-cover-pic" imageUrl={imageUrl} /> : null}
          <div className="dv-cover-body">
            <Field ctx={ctx} field="title" value={block.title} label={STUDIO.coverTitle} as="h1" className="dv-cover-title" max={DOC_TITLE_MAX} />
            <Field ctx={ctx} field="subtitle" value={block.subtitle} label={STUDIO.coverSubtitle} placeholder={STUDIO.subtitleAdd} as="p" className="dv-cover-sub" max={DOC_CAPTION_MAX} hideEmpty />
          </div>
        </header>
      );
    case 'heading':
      return (
        <div className="dv-on-bg">
          <Field ctx={ctx} field="text" value={block.text} label={STUDIO.types.heading} as="h2" className={`dv-heading dv-heading-${block.size}`} max={DOC_TITLE_MAX} />
        </div>
      );
    case 'text':
      return (
        <div className="dv-on-bg" data-align={block.align}>
          <Field ctx={ctx} field="text" value={block.text} label={STUDIO.types.text} placeholder={STUDIO.emptyText} as="div" className="dv-text" rich multiline max={DOC_TEXT_MAX} slash />
        </div>
      );
    case 'note':
      return (
        <aside className="dv-note" data-tone={block.tone}>
          {block.tone !== 'info' ? <p className="dv-note-label">{STUDIO.tones[block.tone]}</p> : null}
          <Field ctx={ctx} field="text" value={block.text} label={STUDIO.types.note} as="div" className="dv-note-text" rich multiline max={DOC_TEXT_MAX} />
        </aside>
      );
    case 'image':
      return (
        <figure className="dv-figure" data-width={block.width}>
          {block.path ? (
            <Picture path={block.path} alt={block.caption} className="dv-pic" imageUrl={imageUrl} />
          ) : editor ? (
            <span className="dv-pic dv-pic-empty">
              <span>{editor.uploading === block.id ? STUDIO.imageUploading : STUDIO.imageEmpty}</span>
              {editor.uploading === block.id ? null : (
                <button type="button" className="dv-pic-pick" onClick={() => editor.pickImage(block.id)}>
                  {STUDIO.imagePick}
                </button>
              )}
            </span>
          ) : null}
          <Field ctx={ctx} field="caption" value={block.caption} label={STUDIO.caption} placeholder={STUDIO.captionAdd} as="figcaption" className="dv-caption" max={DOC_CAPTION_MAX} hideEmpty />
        </figure>
      );
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
  const topRef = useRef<HTMLDivElement>(null);
  const step = steps[Math.min(at, steps.length - 1)];
  const last = at >= steps.length - 1;
  const paged = steps.length > 1;

  useEffect(() => setResult(given ?? null), [given]);

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

  const questionsHere = step.blocks.filter((block) => block.type === 'question');
  const allAnswered = questionsHere.every((block) => block.type !== 'question' || answered(answers[block.item_id]));

  return (
    <div className="dv-col" data-mode="answer">
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
          onAnswer={(itemId, answer) => {
            setAnswers((current) => ({ ...current, [itemId]: answer }));
            if (missing.length > 0) setMissing([]);
          }}
        />
      ))}
      {missing.length > 0 ? (
        <p className="dv-missing" role="alert">
          {DOC.missing(missing)}
        </p>
      ) : null}
      <div className="dv-nav" data-ready={allAnswered ? '' : undefined}>
        {at > 0 ? (
          <button type="button" className="dv-quiet" onClick={() => go(at - 1)}>
            {DOC.back}
          </button>
        ) : (
          <span />
        )}
        <button type="button" className="dv-btn" onClick={() => void forward()} aria-busy={sending || undefined} disabled={sending}>
          <span>{last ? DOC.send : DOC.next}</span>
          <Arrow />
        </button>
      </div>
    </div>
  );
}
