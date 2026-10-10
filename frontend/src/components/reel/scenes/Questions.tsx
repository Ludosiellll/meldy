import { useRef } from 'react';
import { IMPORT_WORDS, SUBJECTS, subjectMeta } from '../content';
import { blur, opacity, place, put, useEls, useFrame } from '../engine';
import { Cursor, Kinetic, Pill, Roller, TypeLabel, pathAt } from '../parts';
import { ease, mix, pulse, seg } from '../timeline';
import { NAV_LOGO } from './Brand';

const LINKS = ['Сегодня', 'Экзамены', 'Лекции', 'Повторение', 'Прогресс'];
/** «Экзамены» is lit: the import page is one of its pages. */
const LIT = 1;

/** The app's page: the wordmark has landed in its top bar (Brand's flight), then the files are dropped. */
const READY = 250;
/** The stack of four files is dragged in and dropped on the card. */
const DRAG_FROM = 700;
const DROP = 1450;
/** The camera dives into the card; the chapter's own frame takes over. */
const DIVE = 1560;
const B = 1850;
/** Each file is read and becomes its subject's row; the count runs up by its questions. */
export const ROW_AT = SUBJECTS.map((_, index) => B + 700 + index * 380);
const READ_MS = 330;
const COUNT_MS = 560;
/** «Сохранить» is pressed and the chapter leaves for the plan. */
export const SAVE_AT = 5900;
const LEAVE = 6250;

export const QUESTIONS_CURSOR = [
  { at: DRAG_FROM, x: 2100, y: 470 },
  { at: DROP - 40, x: 1150, y: 640 },
  { at: DROP + 320, x: 1200, y: 700 },
  { at: B + 3500, x: 1990, y: 1150 },
  { at: SAVE_AT - 380, x: 1625, y: 892 },
  { at: SAVE_AT + 300, x: 1642, y: 906 },
];

/** The files hang under the cursor while they are dragged: it holds the first one near its corner. */
const STACK_OFFSET = { x: -34, y: -28 };
/** The files one under another while they are carried (stage px). */
const CHIP_STEP = 88;

/** The count of questions found at scene time `l`: each subject adds its own as its row is read. */
export function foundAt(l: number): number {
  return SUBJECTS.reduce((sum, subject, index) => {
    const p = ease.inOut(seg(l, ROW_AT[index] + READ_MS, COUNT_MS));
    return sum + (subject.test + subject.oral) * p;
  }, 0);
}

function FileIcon({ ext }: { ext: string }) {
  return (
    <i className={`mr-q-ext mr-q-ext--${ext.toLowerCase()}`}>
      <span>{ext}</span>
    </i>
  );
}

const extOf = (file: string) => file.slice(file.lastIndexOf('.') + 1).toUpperCase();

/**
 * 5 · Chapter 01, «Вопросы». The wordmark lands in the app's top bar on the import page; four files, one per subject,
 * are dropped on «Загрузите вопросы»; the camera dives in and the files are read into the session's four subjects
 * while the count runs to 960 — the key taken from the file (no AI), the oral subject as oral questions.
 */
export default function Questions() {
  const root = useRef<HTMLDivElement>(null);
  const { one, all } = useEls(root);

  useFrame((l) => {
    const ready = l >= READY ? 1 : 0;
    opacity(one('bg'), ready);
    opacity(one('logo'), ready);

    // ── the app's page
    const page = one('page');
    all('link').forEach((link, index) => {
      const p = ease.brand(seg(l, 120 + index * 50, 600));
      put(link, 'transform', `translate3d(0,${mix(18, 0, p).toFixed(2)}px,0)`);
      opacity(link, p);
    });
    opacity(one('me'), ease.brand(seg(l, 400, 500)));
    all('b').forEach((block, order) => {
      const p = ease.brand(seg(l, READY + order * 70, 620));
      put(block, 'transform', `translate3d(0,${mix(40, 0, p).toFixed(1)}px,0)`);
      opacity(block, p);
      blur(block, (1 - p) * 10);
    });

    // The stack of files is dragged in with the cursor and dropped on the card, which lights up under it.
    const stack = one('stack');
    const over = seg(l, DROP - 420, 160) * (1 - seg(l, DROP + 60, 200));
    opacity(one('drop'), over);
    const dragged = l < DROP;
    const cursor = pathAt(QUESTIONS_CURSOR.slice(0, 3), l);
    const fall = ease.in(seg(l, DROP, 260));
    place(stack, cursor.x + STACK_OFFSET.x, cursor.y + STACK_OFFSET.y + 30 * fall, mix(1, 0.6, fall), mix(-3, 0, fall));
    opacity(stack, l >= DRAG_FROM ? (dragged ? 1 : 1 - fall) : 0);
    all('chip').forEach((chip, index) => {
      // One under another while carried, a little fanned; gathered into one as they drop.
      const fan = 1 - fall;
      place(chip, index * 12 * fan, index * CHIP_STEP * fan, 1, (index - 1.5) * 1.4 * fan);
    });

    // The dive into the card.
    const dive = ease.in(seg(l, DIVE, 380));
    put(page, 'transform', `scale(${mix(1, 2.6, dive).toFixed(3)})`);
    blur(page, dive * 16);
    opacity(page, 1 - seg(l, DIVE + 250, 150));

    // ── the chapter's frame
    const frame = one('frame');
    opacity(frame, l >= B ? 1 : 0);
    const cam = one('cam');
    const enter = ease.brand(seg(l, B, 420));
    const push = mix(1, 1.03, ease.sine(seg(l, B + 400, 4400)));
    const leave = ease.in(seg(l, LEAVE, 420));
    put(cam, 'transform', `scale(${(mix(1.12, 1, enter) * push * mix(1, 1.08, leave)).toFixed(4)})`);
    blur(cam, (1 - enter) * 12 + leave * 14);
    opacity(cam, seg(l, B, 260) * (1 - seg(l, LEAVE + 150, 270)));

    // The card swings in from the right in perspective and keeps a slight angle.
    const card = one('card');
    const swing = (at: number) => ease.brand(seg(at, B + 120, 1000));
    const p = swing(l);
    const speed = Math.abs(p - swing(l - 16)) * 520;
    const sway = Math.sin(l / 1300) * 0.8;
    put(
      card,
      'transform',
      `translate3d(${mix(560, 0, p).toFixed(1)}px,${mix(50, 0, p).toFixed(1)}px,0) rotateY(${(mix(-44, -8, p) + sway).toFixed(2)}deg) rotateX(${mix(9, 2.5, p).toFixed(2)}deg)`,
    );
    opacity(card, seg(l, B + 120, 220));
    blur(card, Math.min(12, speed * 0.5));

    // The count comes as the first file is read and starts to run.
    const big = one('big');
    const countIn = ease.brand(seg(l, ROW_AT[0] + READ_MS - 260, 420));
    put(big, 'transform', `translate3d(0,${mix(30, 0, countIn).toFixed(1)}px,0)`);
    opacity(big, countIn);
    blur(big, (1 - countIn) * 12);

    // «Читаем 4 файла» until every file is read, then «Нашли 4 предмета и 960 вопросов».
    const allRead = ROW_AT[ROW_AT.length - 1] + READ_MS;
    const found = seg(l, allRead, 300);
    opacity(one('reading'), 1 - found);
    opacity(one('found'), found);
    put(one('found'), 'transform', `translate3d(0,${mix(12, 0, ease.brand(found)).toFixed(1)}px,0)`);

    all('subj').forEach((row, index) => {
      const at = ROW_AT[index];
      const p = ease.brand(seg(l, at - 380, 520));
      put(row, 'transform', `translate3d(${mix(46, 0, p).toFixed(1)}px,0,0)`);
      opacity(row, p);
    });
    all('wait').forEach((wait, index) => opacity(wait, l < ROW_AT[index] + READ_MS ? 1 : 1 - seg(l, ROW_AT[index] + READ_MS, 160)));
    all('meta').forEach((meta, index) => {
      const p = seg(l, ROW_AT[index] + READ_MS, 260);
      opacity(meta, p);
      put(meta, 'transform', `translate3d(0,${mix(8, 0, ease.brand(p)).toFixed(1)}px,0)`);
    });

    // «Сохранить» is pressed; the card leaves towards the plan.
    const pill = one('pill');
    const shown = ease.brand(seg(l, allRead + 300, 500));
    const press = pulse(l, SAVE_AT - 60, 260);
    put(pill, 'transform', `translate3d(0,${mix(20, 0, shown).toFixed(1)}px,0) scale(${(1 - 0.05 * press).toFixed(3)})`);
    opacity(pill, shown);
    put(one('pill-dot'), 'transform', `translate3d(${(6 * ease.brand(seg(l, SAVE_AT - 320, 300))).toFixed(2)}px,0,0)`);
  });

  return (
    <div ref={root} className="mr-scene">
      <div data-a="bg" className="mr-layer mr-bg-light" style={{ opacity: 0 }} />

      {/* The app's page: the top bar, «Новый экзамен», the card to pick files. */}
      <div data-a="page" className="mr-layer" style={{ transformOrigin: '960px 690px' }}>
        <div className="mr-tour-nav">
          <span data-a="logo" className="mr-wordmark mr-tour-logo" style={{ fontSize: NAV_LOGO.size, opacity: 0 }}>
            Meldy
            <span className="mr-wordmark-dot" />
          </span>
          <div className="mr-tour-links">
            {LINKS.map((link, index) => (
              <span key={link} data-a="link" className={`mr-tour-link${index === LIT ? ' is-on' : ''}`}>
                {index === LIT ? <i className="mr-q-hl" /> : null}
                {link}
              </span>
            ))}
          </div>
          <span data-a="me" className="mr-tour-me">
            А
          </span>
        </div>
        <div className="mr-tour-page">
          <div data-a="b" className="mr-tour-title">
            {IMPORT_WORDS.title}
          </div>
          <div data-a="b" className="mr-tour-sub">
            {IMPORT_WORDS.lede}
          </div>
          <div data-a="b" className="mr-q-pick">
            <div className="mr-q-pick-main">
              <b className="mr-q-pick-h">{IMPORT_WORDS.dropTitle}</b>
              <p className="mr-q-pick-sub">{IMPORT_WORDS.dropLede}</p>
              <div className="mr-q-pick-acts">
                <Pill tone="blue">{IMPORT_WORDS.pick}</Pill>
              </div>
              <p className="mr-q-pick-fmt">{IMPORT_WORDS.formats}</p>
            </div>
            <div className="mr-q-pick-side">
              <b>{IMPORT_WORDS.sideTitle}</b>
              {IMPORT_WORDS.side.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
            <div data-a="drop" className="mr-q-drop" style={{ opacity: 0 }}>
              {IMPORT_WORDS.dropping}
            </div>
          </div>
        </div>
      </div>

      <div data-a="stack" className="mr-q-stack" style={{ opacity: 0 }}>
        {SUBJECTS.map((subject) => (
          <div key={subject.file} data-a="chip" className="mr-q-chip">
            <FileIcon ext={extOf(subject.file)} />
            <span>{subject.file}</span>
          </div>
        ))}
      </div>

      {/* The chapter's own frame: the count on the left, the file read into subjects on the right. */}
      <div data-a="frame" className="mr-layer" style={{ opacity: 0 }}>
        <div data-a="cam" className="mr-layer">
          <div className="mr-abs" style={{ left: 154, top: 236 }}>
            <TypeLabel text="Вопросы" at={B + 100} />
          </div>
          <div data-a="big" className="mr-big" style={{ opacity: 0 }}>
            <Roller value={foundAt} digits={3} />
          </div>
          <div className="mr-big-of">
            <Kinetic text="вопросов" at={ROW_AT[0] + READ_MS + 200} unit="letter" variant="drop" stagger={30} dur={620} />
          </div>
          <div className="mr-big-in">
            <Kinetic text={IMPORT_WORDS.noAi} at={ROW_AT[3] + READ_MS + 500} stagger={95} accentFrom={2} />
          </div>

          <div className="mr-persp">
            <div data-a="card" className="mr-card mr-q-card" style={{ opacity: 0 }}>
              <div className="mr-q-card-h">
                <span data-a="reading">{IMPORT_WORDS.reading}</span>
                <span data-a="found" style={{ opacity: 0 }}>
                  {IMPORT_WORDS.found}
                </span>
              </div>
              <div className="mr-q-rows">
                {SUBJECTS.map((subject) => (
                  <div key={subject.title} data-a="subj" className="mr-q-row" style={{ opacity: 0 }}>
                    <FileIcon ext={extOf(subject.file)} />
                    <div className="mr-q-row-t">
                      <b>{subject.title}</b>
                      <span className="mr-q-row-m">
                        <span data-a="wait">{IMPORT_WORDS.readingWait}</span>
                        <span data-a="meta" style={{ opacity: 0 }}>
                          {subjectMeta(subject)}
                        </span>
                      </span>
                    </div>
                    <svg className="mr-q-row-go" viewBox="0 0 20 20" aria-hidden="true">
                      <path d="M8 5l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                ))}
              </div>
              <div className="mr-q-card-foot">
                <Pill name="pill">{IMPORT_WORDS.save}</Pill>
              </div>
            </div>
          </div>
          <Cursor keys={QUESTIONS_CURSOR.slice(3)} clicks={[SAVE_AT]} from={B + 3500} to={SAVE_AT + 450} />
        </div>
      </div>
      <Cursor keys={QUESTIONS_CURSOR.slice(0, 3)} from={DRAG_FROM} to={DIVE + 120} />
    </div>
  );
}
