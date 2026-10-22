/**
 * A small studio on the landing (owner, 2026-10-19: «особенно про конструктор не забудь»): the visitor adds blocks
 * (by a press or by dragging them onto the page), moves and removes them, picks a colour, a font and a background,
 * and sees the page as a participant on a phone beside it — answers included, with the result message by points.
 * Everything runs here, on the device: nothing is saved or sent. Words of the studio: components/studio/copyStudio.ts.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from 'react';
import { BlockIcon, QuestionIcon } from '../studio/icons';
import { qrCode } from '../../lib/quizzes/qr';
import { PAPER_URL, GRAPH_URL } from './art';
import { Glyph } from './glyphs';
import { BUILDER_SECTION, EXAMPLE, SAMPLE_TEST_URL, SITE } from './copy3';
import './miniStudio.css';

type Kind = 'heading' | 'text' | 'image' | 'video' | 'question';

interface Question {
  stem: string;
  options: string[];
  right: number;
}

interface Block {
  id: number;
  kind: Kind;
  text?: string;
  question?: Question;
  points?: number;
}

const QUESTIONS: Question[] = [
  { stem: EXAMPLE.testStem, options: [...EXAMPLE.testOptions], right: EXAMPLE.testRight },
  {
    stem: 'Что показывает коэффициент эластичности спроса?',
    options: ['На сколько процентов изменится спрос при изменении цены на 1 %', 'Сколько товара продано за день', 'Как цена меняется со временем'],
    right: 0,
  },
  { stem: 'Какой спрос эластичнее?', options: ['На соль', 'На путёвки в отпуск'], right: 1 },
  { stem: 'Что относится к постоянным издержкам фирмы?', options: ['Оплата сырья', 'Аренда помещения', 'Сдельная оплата труда'], right: 1 },
];
const HEADINGS = ['Часть 1. Выручка', 'Часть 2. Издержки', 'Часть 3. Рынок'];
const TEXTS = ['После каждого ответа будет пояснение.', 'Отвечайте без конспекта: так видно, что осталось в памяти.'];

const PALETTE: Array<{ kind: Kind; label: string }> = [
  { kind: 'heading', label: 'Заголовок' },
  { kind: 'text', label: 'Текст' },
  { kind: 'image', label: 'Картинка' },
  { kind: 'video', label: 'Видео' },
  { kind: 'question', label: 'Один ответ' },
];

const ACCENTS = [
  { id: 'blue', label: 'Синий', color: '#2869dd' },
  { id: 'green', label: 'Зелёный', color: '#1f8a4c' },
  { id: 'orange', label: 'Оранжевый', color: '#c45a16' },
  { id: 'violet', label: 'Фиолетовый', color: '#6f45cf' },
] as const;
const FONTS = [
  { id: 'onest', label: 'Onest' },
  { id: 'serif', label: 'С засечками' },
] as const;
const BACKGROUNDS = [
  { id: 'plain', label: 'Ровный' },
  { id: 'soft', label: 'Мягкий' },
  { id: 'image', label: 'Картинка' },
] as const;
const BANDS = [
  { from: 0, title: 'Тему стоит повторить' },
  { from: 50, title: 'Хороший результат' },
  { from: 80, title: 'Отлично' },
];
const NBSP = String.fromCharCode(160);
const BANDS_LINE = `После теста участник увидит сообщение по своим баллам. Например, от ${BANDS[2].from}${NBSP}% «${BANDS[2].title}».`;
const MAX_BLOCKS = 9;
const VIEWS = [
  { id: 'page', label: 'Страница' },
  { id: 'take', label: BUILDER_SECTION.takeTab }, // the phone's lead above the studio names it (Builder)
] as const;
/** The studio's phone layout (miniStudio.css has the same width). */
const PHONE = '(max-width: 699px)';

/** Whether the studio is laid out for a phone: there the selected block's tools stand under the page. */
function usePhone(): boolean {
  const [phone, setPhone] = useState(() => (typeof window === 'undefined' ? false : window.matchMedia?.(PHONE)?.matches ?? false));
  useEffect(() => {
    const list = typeof window === 'undefined' ? undefined : window.matchMedia?.(PHONE);
    if (!list?.addEventListener) return undefined;
    const on = () => setPhone(list.matches);
    list.addEventListener('change', on);
    return () => list.removeEventListener('change', on);
  }, []);
  return phone;
}

function questionsWord(n: number): string {
  const last = n % 10;
  const teen = n % 100 > 10 && n % 100 < 20;
  return `${n} ${!teen && last === 1 ? 'вопрос' : !teen && last >= 2 && last <= 4 ? 'вопроса' : 'вопросов'}`;
}

let nextId = 3;

function makeBlock(kind: Kind, blocks: Block[]): Block {
  const count = blocks.filter((block) => block.kind === kind).length;
  const id = (nextId += 1);
  if (kind === 'heading') return { id, kind, text: HEADINGS[count % HEADINGS.length] };
  if (kind === 'text') return { id, kind, text: TEXTS[count % TEXTS.length] };
  if (kind === 'question') return { id, kind, question: QUESTIONS[count % QUESTIONS.length], points: 1 };
  return { id, kind };
}

const START: Block[] = [
  { id: 1, kind: 'heading', text: HEADINGS[0] },
  { id: 2, kind: 'question', question: QUESTIONS[0], points: 2 },
];

/** The QR code of the public example test's link (made here, on the device). */
export function TestQr() {
  const code = useMemo(() => qrCode(`${SITE}${SAMPLE_TEST_URL}`), []);
  return (
    <svg className="p3-qr" viewBox={`-2 -2 ${code.size + 4} ${code.size + 4}`} role="img" aria-label="QR-код ссылки на тест">
      <rect x="-2" y="-2" width={code.size + 4} height={code.size + 4} fill="#fff" />
      <path d={code.path} fill="#0b121c" />
    </svg>
  );
}

function Icon({ kind }: { kind: Kind }) {
  return kind === 'question' ? <QuestionIcon type="single" /> : <BlockIcon type={kind} />;
}

function Video() {
  return (
    <span className="ms-video">
      <i>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
        </svg>
      </i>
      <small>Видео RuTube</small>
    </span>
  );
}

/** One block as the participant sees it (the phone on the right). */
function TakeBlock({ block, picked, onPick }: { block: Block; picked: number | undefined; onPick: (index: number) => void }) {
  switch (block.kind) {
    case 'heading':
      return <p className="ms-t-h">{block.text}</p>;
    case 'text':
      return <p className="ms-t-p">{block.text}</p>;
    case 'image':
      return (
        <figure className="ms-t-img">
          <img src={GRAPH_URL} alt="График спроса и предложения" />
          <figcaption>Спрос и предложение</figcaption>
        </figure>
      );
    case 'video':
      return (
        <div className="ms-t-img">
          <Video />
          <p className="ms-t-cap">Разбор на графике, 4 минуты</p>
        </div>
      );
    default: {
      const question = block.question!;
      return (
        <fieldset className="ms-t-q">
          <legend>{question.stem}</legend>
          {question.options.map((option, index) => (
            <label key={option} className={`ms-t-opt${picked === index ? ' is-on' : ''}`}>
              <input type="radio" name={`q${block.id}`} checked={picked === index} onChange={() => onPick(index)} />
              <i aria-hidden="true" />
              {option}
            </label>
          ))}
        </fieldset>
      );
    }
  }
}

/** One block on the studio's page. */
function CanvasBlock({ block }: { block: Block }) {
  switch (block.kind) {
    case 'heading':
      return <p className="ms-b-h">{block.text}</p>;
    case 'text':
      return <p className="ms-b-p">{block.text}</p>;
    case 'image':
      return <img className="ms-b-img" src={GRAPH_URL} alt="" />;
    case 'video':
      return <Video />;
    default: {
      const question = block.question!;
      return (
        <div className="ms-b-q">
          <p className="ms-b-no">
            Вопрос на{' '}
            <em>
              {block.points}{'\u00a0'}{block.points === 1 ? 'балл' : block.points! < 5 ? 'балла' : 'баллов'}
            </em>
          </p>
          <p className="ms-b-stem">{question.stem}</p>
          {question.options.map((option, index) => (
            <span key={option} className={`ms-b-opt${index === question.right ? ' is-key' : ''}`}>
              <i />
              {option}
              {index === question.right ? <em>верный</em> : null}
            </span>
          ))}
        </div>
      );
    }
  }
}

/**
 * The canvas scrolls inside itself (miniStudio.css): a block added below its visible part is brought into it there,
 * never by scrolling the landing — smoothly, or at once when the visitor asks for less motion.
 */
function showInCanvas(canvas: HTMLElement, block: HTMLElement): void {
  const AIR = 12;
  const TOOLS = 28; // the selected block's tools stand 20 px above it
  const box = canvas.getBoundingClientRect();
  const rect = block.getBoundingClientRect();
  if (box.height === 0 || typeof canvas.scrollTo !== 'function') return; // not laid out (hidden), or no scrollTo
  let by = 0;
  if (rect.bottom > box.bottom - AIR) by = rect.bottom - box.bottom + AIR;
  if (rect.top - by < box.top + TOOLS) by = rect.top - box.top - TOOLS; // a block taller than the canvas: its top
  if (by === 0) return;
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  canvas.scrollTo({ top: canvas.scrollTop + by, behavior: still ? 'auto' : 'smooth' });
}

/**
 * The selected block's tools: points for a question, up, down, remove. On a wider screen they stand over the block's
 * corner; on a phone they would cover the block, so they stand in a bar under the page (inactive with no block chosen).
 */
function Tools({ block, onPoints, onMove, onRemove }: { block: Block | null; onPoints: (by: number) => void; onMove: (by: number) => void; onRemove: () => void }) {
  return (
    // a press here is the tools', not the block's: the block under them is chosen already (and «×» leaves none)
    <span className="ms-tools" onClick={(event) => event.stopPropagation()}>
      {block?.kind === 'question' ? (
        <>
          <button type="button" onClick={() => onPoints(-1)} aria-label="Убрать балл">
            −
          </button>
          <button type="button" onClick={() => onPoints(1)} aria-label="Добавить балл">
            +
          </button>
        </>
      ) : null}
      <button type="button" onClick={() => onMove(-1)} aria-label="Поднять блок" disabled={!block}>
        <Glyph char="↑" />
      </button>
      <button type="button" onClick={() => onMove(1)} aria-label="Опустить блок" disabled={!block}>
        <Glyph char="↓" />
      </button>
      <button type="button" onClick={onRemove} aria-label="Удалить блок" disabled={!block}>
        ×
      </button>
    </span>
  );
}

/** Whether a row that scrolls sideways has more to show on each side (its edges fade there on a phone). */
function useEdges<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [edges, setEdges] = useState({ start: true, end: true });
  const measure = () => {
    const el = ref.current;
    if (!el) return;
    const EDGE = 10; // the row's own padding (8 px on a phone) is no more to see
    const start = el.scrollLeft <= EDGE;
    const end = el.scrollLeft + el.clientWidth >= el.scrollWidth - EDGE;
    setEdges((was) => (was.start === start && was.end === end ? was : { start, end }));
  };
  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  return { ref, onScroll: measure, className: `${edges.start ? '' : ' is-back'}${edges.end ? '' : ' is-more'}` };
}

function Choice<T extends string>({ items, value, onChange, label, render }: { items: ReadonlyArray<{ id: T; label: string }>; value: T; onChange: (id: T) => void; label: string; render?: (item: { id: T; label: string }) => ReactNode }) {
  return (
    <div className="ms-choice" role="radiogroup" aria-label={label}>
      <span className="ms-choice-l">{label}</span>
      {items.map((item) => (
        <button key={item.id} type="button" role="radio" aria-checked={value === item.id} className={value === item.id ? 'is-on' : ''} onClick={() => onChange(item.id)}>
          {render ? render(item) : item.label}
        </button>
      ))}
    </div>
  );
}

export default function MiniStudio() {
  const [blocks, setBlocks] = useState<Block[]>(START);
  const [selected, setSelected] = useState<number | null>(2);
  const [accent, setAccent] = useState<(typeof ACCENTS)[number]['id']>('blue');
  const [font, setFont] = useState<(typeof FONTS)[number]['id']>('onest');
  const [background, setBackground] = useState<(typeof BACKGROUNDS)[number]['id']>('soft');
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [finished, setFinished] = useState(false);
  const [said, setSaid] = useState('');
  const [dropAt, setDropAt] = useState<number | null>(null);
  // On a phone the page and the participant's view take turns in one place (miniStudio.css); elsewhere both show.
  const [view, setView] = useState<'page' | 'take'>('page');
  const dragged = useRef<{ kind?: Kind; id?: number } | null>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const follow = useRef<number | null>(null);
  const phone = usePhone();
  const look = useEdges<HTMLDivElement>();

  // A block just added or moved by its tools: in view on the canvas once it is drawn (on a phone the tools stay under
  // the page, so a block moved past the visible part would be out of sight).
  useEffect(() => {
    const id = follow.current;
    follow.current = null;
    const block = id === null ? null : canvas.current?.querySelector<HTMLElement>(`[data-block="${id}"]`);
    if (canvas.current && block) showInCanvas(canvas.current, block);
  }, [blocks]);

  const color = ACCENTS.find((item) => item.id === accent)!.color;
  const full = blocks.length >= MAX_BLOCKS;

  const insert = (kind: Kind, at?: number) => {
    if (full) {
      setSaid('На этой странице помещается 9 блоков. В студии их до 400.');
      return;
    }
    const block = makeBlock(kind, blocks);
    const index = at ?? (selected === null ? blocks.length : blocks.findIndex((item) => item.id === selected) + 1);
    setBlocks([...blocks.slice(0, index), block, ...blocks.slice(index)]);
    follow.current = block.id;
    setSelected(block.id);
    setSaid(`Добавлен блок «${PALETTE.find((item) => item.kind === kind)!.label}».`);
    setFinished(false);
  };

  const move = (id: number, by: number) => {
    const index = blocks.findIndex((item) => item.id === id);
    const to = index + by;
    if (index < 0 || to < 0 || to >= blocks.length) return;
    const next = [...blocks];
    const [block] = next.splice(index, 1);
    next.splice(to, 0, block);
    setBlocks(next);
    follow.current = id;
    setSaid(`Блок теперь ${to + 1}-й из ${blocks.length}.`);
  };

  const remove = (id: number) => {
    setBlocks((list) => list.filter((item) => item.id !== id));
    setSelected(null);
    setSaid('Блок удалён.');
    setFinished(false);
  };

  const setPoints = (id: number, by: number) => {
    setBlocks((list) => list.map((item) => (item.id === id && item.kind === 'question' ? { ...item, points: Math.min(10, Math.max(1, (item.points ?? 1) + by)) } : item)));
  };

  // Drag a palette item or a block onto the page (mouse); a press does the same on a phone.
  const overBlock = (event: DragEvent<HTMLElement>, index: number) => {
    event.preventDefault();
    const box = event.currentTarget.getBoundingClientRect();
    setDropAt(event.clientY < box.top + box.height / 2 ? index : index + 1);
  };
  const drop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    const what = dragged.current;
    const at = dropAt ?? blocks.length;
    dragged.current = null;
    setDropAt(null);
    if (!what) return;
    if (what.kind) {
      insert(what.kind, at);
      return;
    }
    setBlocks((list) => {
      const from = list.findIndex((item) => item.id === what.id);
      if (from < 0) return list;
      const next = [...list];
      const [block] = next.splice(from, 1);
      next.splice(at > from ? at - 1 : at, 0, block);
      return next;
    });
  };

  const questions = blocks.filter((block) => block.kind === 'question');
  const result = useMemo(() => {
    const max = questions.reduce((sum, block) => sum + (block.points ?? 1), 0);
    const got = questions.reduce((sum, block) => sum + (answers[block.id] === block.question!.right ? block.points ?? 1 : 0), 0);
    const percent = max ? Math.round((got / max) * 100) : 0;
    const band = [...BANDS].reverse().find((item) => percent >= item.from)!;
    const right = questions.filter((block) => answers[block.id] === block.question!.right).length;
    return { max, got, percent, band, right };
  }, [questions, answers]);

  const chosen = blocks.find((block) => block.id === selected) ?? null;

  return (
    <div className="ms" data-font={font} data-bg={background} data-view={view} style={{ '--ms-acc': color } as CSSProperties}>
      <div className="ms-views">
        {VIEWS.map((item) => (
          <button key={item.id} type="button" className={view === item.id ? 'is-on' : undefined} aria-pressed={view === item.id} onClick={() => setView(item.id)}>
            {item.label}
          </button>
        ))}
      </div>
      <div className="ms-pal" aria-label="Блоки">
        <p className="ms-pal-h">Блоки</p>
        {PALETTE.map((item) => (
          <button
            key={item.kind}
            type="button"
            className="ms-pal-i"
            draggable
            onDragStart={(event) => {
              dragged.current = { kind: item.kind };
              event.dataTransfer.effectAllowed = 'copy';
              event.dataTransfer.setData('text/plain', item.label);
            }}
            onDragEnd={() => setDropAt(null)}
            onClick={() => insert(item.kind)}
            aria-label={`Добавить блок «${item.label}»`}
          >
            <Icon kind={item.kind} />
            {item.label}
          </button>
        ))}
        <p className="ms-pal-hint">Нажмите на блок или перетащите его на страницу.</p>
      </div>

      <div className="ms-work">
        <div ref={look.ref} className={`ms-look${look.className}`} onScroll={look.onScroll}>
          <Choice label="Цвет" items={ACCENTS} value={accent} onChange={setAccent} render={(item) => <i className="ms-sw" style={{ background: ACCENTS.find((a) => a.id === item.id)!.color }} aria-label={item.label} />} />
          <Choice label="Шрифт" items={FONTS} value={font} onChange={setFont} />
          <Choice label="Фон" items={BACKGROUNDS} value={background} onChange={setBackground} />
        </div>
        <div ref={canvas} className="ms-canvas" style={background === 'image' ?{ backgroundImage: `linear-gradient(rgba(11,18,28,.06), rgba(11,18,28,.06)), url("${PAPER_URL}")` } : undefined} onDragOver={(event) => event.preventDefault()} onDrop={drop}>
          <div className="ms-page">
            <div className="ms-cover">
              <img src={GRAPH_URL} alt="" />
              <p className="ms-cover-t">{EXAMPLE.testTitle}</p>
              <p className="ms-cover-s">
                {EXAMPLE.author}, {questionsWord(questions.length)}
              </p>
            </div>
            {blocks.map((block, index) => (
              <div
                key={block.id}
                data-block={block.id}
                className={`ms-blk${selected === block.id ? ' is-sel' : ''}${dropAt === index ? ' is-drop-before' : ''}${dropAt === index + 1 && index === blocks.length - 1 ? ' is-drop-after' : ''}`}
                draggable
                onDragStart={(event) => {
                  dragged.current = { id: block.id };
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', String(block.id));
                }}
                onDragOver={(event) => overBlock(event, index)}
                onClick={() => setSelected(block.id)}
              >
                <CanvasBlock block={block} />
                {selected === block.id && !phone ? (
                  <Tools block={block} onPoints={(by) => setPoints(block.id, by)} onMove={(by) => move(block.id, by)} onRemove={() => remove(block.id)} />
                ) : null}
              </div>
            ))}
            <span className="ms-finish">Завершить</span>
          </div>
        </div>
        {phone ? (
          <div className="ms-bar">
            <span className="ms-bar-l">
              {chosen ? (
                <>
                  <Icon kind={chosen.kind} />
                  {PALETTE.find((item) => item.kind === chosen.kind)!.label}
                </>
              ) : null}
            </span>
            <Tools
              block={chosen}
              onPoints={(by) => chosen && setPoints(chosen.id, by)}
              onMove={(by) => chosen && move(chosen.id, by)}
              onRemove={() => chosen && remove(chosen.id)}
            />
          </div>
        ) : null}
        <p className="ms-said" aria-live="polite">
          {said || (chosen?.kind === 'question' ? 'Баллы за вопрос меняются кнопками −\u00a0и\u00a0+.' : 'Выберите блок, чтобы подвинуть или удалить его.')}
        </p>
        <p className="ms-bands">{BANDS_LINE}</p>
      </div>

      <div className="ms-take">
        <p className="ms-take-h">Так увидит участник</p>
        <div className="ms-phone">
          <div className="ms-phone-in">
            {background === 'image' ? (
              <span className="ms-bg">
                <img src={PAPER_URL} alt="" />
              </span>
            ) : null}
            <div className="ms-t-page">
              {finished ? (
                <div className="ms-t-card ms-t-result">
                  <p className="ms-t-meta">{EXAMPLE.testTitle}</p>
                  <p className="ms-t-score">
                    {result.right} из {questions.length}
                  </p>
                  <p className="ms-t-meta">
                    {result.got} из {result.max} баллов, это {result.percent}{NBSP}%
                  </p>
                  <p className="ms-t-band">{result.band.title}</p>
                  <button type="button" className="ms-t-again" onClick={() => { setAnswers({}); setFinished(false); }}>
                    Пройти ещё раз
                  </button>
                </div>
              ) : (
                <>
                  <div className="ms-t-card ms-t-cover">
                    <img src={GRAPH_URL} alt="" />
                    <p>{EXAMPLE.testTitle}</p>
                  </div>
                  {blocks.map((block) => (
                    <div key={block.id} className="ms-t-card">
                      <TakeBlock block={block} picked={answers[block.id]} onPick={(index) => setAnswers((all) => ({ ...all, [block.id]: index }))} />
                    </div>
                  ))}
                  <button type="button" className="ms-t-finish" onClick={() => setFinished(true)} disabled={questions.length === 0}>
                    Завершить
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
