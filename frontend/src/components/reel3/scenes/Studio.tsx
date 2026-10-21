/**
 * The constructor, in three scenes on one studio: «Новый тест» named and created, «Заголовок» and «Один ответ»
 * dragged onto the page (build); the author's own picture dropped on the cover, a «Видео» block with a RuTube link,
 * the page's background picture (media); «Оформление» — colour and font, points, and «Результат» with the messages by
 * points (look). Words: components/studio/copyStudio.ts and components/test/copyTest.ts, as the studio shows them.
 */
import { useRef, type ReactNode } from 'react';
import { flag, opacity, useEls, useFrame } from '../../reel/engine';
import { BlockIcon, QuestionIcon } from '../../studio/icons';
import { EXAMPLE, SAY } from '../../home3/copy3';
import { PAPER_URL, GRAPH_URL } from '../../home3/art';
import { Arrow, Say, appear, ease, move, seg } from '../kit3';
import { Cursor, carry, pressAt, usePointer, type CursorKey, type Pointer } from '../pointer3';

const PALETTE = [
  { kind: 'block', type: 'cover', label: 'Обложка' },
  { kind: 'block', type: 'heading', label: 'Заголовок' },
  { kind: 'block', type: 'text', label: 'Текст' },
  { kind: 'block', type: 'image', label: 'Картинка' },
  { kind: 'block', type: 'video', label: 'Видео' },
  { kind: 'question', type: 'single', label: 'Один ответ' },
  { kind: 'question', type: 'short', label: 'Краткий ответ' },
] as const;

/** The palette; a row is a drag's handle (data-aim «pal-heading», «pal-video», «pal-single»…). */
function Palette() {
  return (
    <div data-aim="pal" className="r3-pal">
      <p className="r3-pal-h">Блоки</p>
      <p className="r3-pal-g">Страница</p>
      {PALETTE.slice(0, 5).map((item) => (
        <span key={item.label} data-aim={`pal-${item.type}`} className="r3-pal-i">
          {item.kind === 'block' ? <BlockIcon type={item.type as 'cover'} /> : null}
          {item.label}
        </span>
      ))}
      <p className="r3-pal-g">Вопросы</p>
      {PALETTE.slice(5).map((item) => (
        <span key={item.label} data-aim={`pal-${item.type}`} className="r3-pal-i">
          <QuestionIcon type={item.type as 'single'} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

function Bar({ send }: { send?: ReactNode }) {
  return (
    <div data-aim="bar" className="r3-st-bar">
      <span className="r3-st-name">
        <b>{EXAMPLE.testTitle}</b>
        <small>Сохранено</small>
      </span>
      <span data-a="send" className="r3-btn r3-btn--s">
        Отправить ссылку
        <i>
          <Arrow />
        </i>
      </span>
      {send}
    </div>
  );
}

/** The question block of the page: «Один ответ», its right option marked «верный», and its points. */
function QuestionBlock({ points }: { points: ReactNode }) {
  return (
    <div className="r3-blk r3-blk-q">
      <p className="r3-blk-no">
        <span>Вопрос 1</span>
        {points}
      </p>
      <p className="r3-blk-stem">{EXAMPLE.testStem}</p>
      {EXAMPLE.testOptions.map((option, index) => (
        <span key={option} className={`r3-blk-opt${index === EXAMPLE.testRight ? ' is-key' : ''}`}>
          <i />
          {option}
          {index === EXAMPLE.testRight ? <em>верный</em> : null}
        </span>
      ))}
    </div>
  );
}

function Cover({ image }: { image: 'none' | 'appears' | 'set' }) {
  return (
    <div data-a="cover" data-aim="cover" className="r3-blk r3-blk-cover">
      <span data-aim="pic" className="r3-cover-pic">
        <BlockIcon type="image" />
        {image === 'none' ? null : <img data-a="img" src={GRAPH_URL} alt="" style={image === 'appears' ? { opacity: 0 } : undefined} />}
      </span>
      <p className="r3-cover-t">{EXAMPLE.testTitle}</p>
      <p className="r3-cover-s">{EXAMPLE.testSubtitle}</p>
    </div>
  );
}

/** The palette row in hand: the same size as the row, lifted off it where it was grabbed (reel3.css .r3-ghost). */
function Drag({ name, label, icon }: { name: string; label: string; icon: ReactNode }) {
  return (
    <span data-a={name} className="r3-ghost r3-carried" style={{ opacity: 0 }}>
      {icon}
      {label}
    </span>
  );
}

/** A slot of the page: where a dragged block lands, with the line that shows it while the block is over the page. */
function Slot({ aim, line, children }: { aim: string; line: string; children: ReactNode }) {
  return (
    <div data-aim={aim} className="r3-slot">
      <span data-a={line} className="r3-dropline" style={{ opacity: 0 }} />
      {children}
    </div>
  );
}

/**
 * The `index`-th drag of a scene: the row grabbed at `handle` goes with the pointer and, let go over the page, settles
 * at the corner of its `slot` (moved by `dy`, the page's scroll) as the block comes up there; the slot's line shows
 * while the held pointer is over the page.
 */
function dragRow(ghost: HTMLElement | undefined, line: HTMLElement | undefined, pointer: Pointer, l: number, index: number, handle: string, slot: string, dy = 0) {
  const from = pointer.box(handle);
  const to = pointer.box(slot);
  const drag = pointer.plan.drags[index];
  opacity(line, pointer.dragAt(l) === index && pointer.over('page', l) ? 1 : 0);
  if (!from || !to || !drag) {
    opacity(ghost, 0);
    return;
  }
  carry(ghost, pointer, l, index, { grab: { x: drag.down.x - from.x, y: drag.down.y - from.y }, settle: { x: to.x, y: to.y + dy } });
}

/**
 * «Новый тест», «Создать», then «Заголовок» and «Один ответ» dragged from the palette into their places on the page:
 * each let go at the right of its slot, clear of the block's words; after, the pointer waits at the palette's empty foot
 * and is gone before the reel's still (POSTER3, 6300 ms into this scene).
 */
export const BUILD_KEYS: readonly CursorKey[] = [
  { t: 250, aim: 'exams', fx: 0.5, fy: 1, dy: 36 },
  { t: 750, aim: 'newtest', press: true },
  { t: 1800, aim: 'create', press: true },
  { t: 2750, aim: 'pal-heading', fx: 0.75, down: true },
  { t: 3450, aim: 'slot-h', fx: 0.66, up: true, over: 'page' },
  { t: 4350, aim: 'pal-single', fx: 0.75, down: true },
  { t: 5050, aim: 'slot-q', fx: 0.6, fy: 0.04, up: true, over: 'page' },
  { t: 5750, aim: 'pal', fx: 0.62, fy: 0.95 },
  { t: 6200, hide: true },
];
const NEW_TEST = pressAt(BUILD_KEYS, 'newtest');
const CREATED = pressAt(BUILD_KEYS, 'create');
const HEADING = pressAt(BUILD_KEYS, 'slot-h');
const QUESTION = pressAt(BUILD_KEYS, 'slot-q');

export function BuildScene() {
  const root = useRef<HTMLDivElement>(null);
  const { one } = useEls(root);
  const pointer = usePointer(BUILD_KEYS);
  useFrame((l) => {
    appear(one('exams'), l, 100, 420, 16, CREATED + 150);
    appear(one('named'), l, NEW_TEST + 200, 360, 10, CREATED + 150);
    const typed = 'Эластичность спроса'.slice(0, Math.round(19 * seg(l, NEW_TEST + 350, 600)));
    const field = one('field');
    if (field && field.textContent !== typed) field.textContent = typed;
    appear(one('studio'), l, CREATED + 430, 450, 18);
    dragRow(one('g1'), one('line1'), pointer, l, 0, 'pal-heading', 'slot-h');
    appear(one('heading'), l, HEADING + 40, 300, 4);
    dragRow(one('g2'), one('line2'), pointer, l, 1, 'pal-single', 'slot-q');
    appear(one('question'), l, QUESTION + 40, 340, 4);
  });
  return (
    <div ref={root} className="r3-scene r3-scene--studio">
      <Say text={SAY.build[0]} at={300} until={3700} />
      <Say text={SAY.build[1]} at={3950} />
      <div className="r3-ui">
        <div data-a="exams" data-aim="exams" className="r3-card r3-exams" style={{ opacity: 0 }}>
          <p className="r3-h">Экзамены</p>
          <p className="r3-meta">Осенняя сессия. 4 предмета и 960 вопросов</p>
          <div className="r3-exams-acts">
            <span className="r3-mini">Новый экзамен</span>
            <span data-a="newtest" data-aim="newtest" className="r3-mini r3-mini--ink">
              Новый тест
            </span>
          </div>
        </div>
        <div data-a="named" className="r3-card r3-named" style={{ opacity: 0 }}>
          <p className="r3-h r3-h--s">Новый тест</p>
          <p className="r3-meta">Название</p>
          <p className="r3-input">
            <span data-a="field" />
            <i className="r3-caret" />
          </p>
          <span data-a="create" data-aim="create" className="r3-btn r3-btn--s">
            Создать
          </span>
        </div>
        <div data-a="studio" className="r3-studio" style={{ opacity: 0 }}>
          <Bar />
          <Palette />
          <div data-aim="page" className="r3-page">
            <div className="r3-page-in">
              <Cover image="none" />
              <Slot aim="slot-h" line="line1">
                <div data-a="heading" className="r3-blk r3-blk-h" style={{ opacity: 0 }}>
                  Часть 1. Выручка
                </div>
              </Slot>
              <Slot aim="slot-q" line="line2">
                <div data-a="question" style={{ opacity: 0 }}>
                  <QuestionBlock points={<em className="r3-points">1 балл</em>} />
                </div>
              </Slot>
            </div>
          </div>
          <Drag name="g1" label="Заголовок" icon={<BlockIcon type="heading" />} />
          <Drag name="g2" label="Один ответ" icon={<QuestionIcon type="single" />} />
        </div>
        <Cursor pointer={pointer} />
      </div>
    </div>
  );
}

const LINK = 'rutube.ru/video/7d2c…';
/** How far the page scrolls to bring the place under the question into view (UI px). */
const SCROLL = 190;

/**
 * The picture file comes in held from below the frame, by the top of its picture, and is let go on the cover's
 * picture, under «Отпустите, и картинка загрузится» (coming from below, the file never covers those words); the page
 * scrolls, «Видео» is dragged under the question, its link typed and «Показать» pressed; then «Картинка» for the
 * page's background.
 */
export const MEDIA_KEYS: readonly CursorKey[] = [
  { t: 250, aim: 'pic', fx: 0.45, fy: 1, dy: 290, down: true, outside: true },
  { t: 1100, aim: 'pic', fx: 0.333, fy: 0.54, up: true, over: 'cover' },
  { t: 2350, aim: 'pal-video', fx: 0.75, down: true },
  { t: 3000, aim: 'slot-v', fx: 0.6, fy: 0.07, dy: -SCROLL, up: true, over: 'page' },
  { t: 3750, aim: 'vput', press: true, dy: -SCROLL },
  { t: 4500, aim: 'bgpic', press: true, fx: 0.4 },
  { t: 5150, aim: 'design', fx: 0.6, fy: 0.95, hide: true },
];
const DROPPED = pressAt(MEDIA_KEYS, 'pic', 1);
const VIDEO = pressAt(MEDIA_KEYS, 'slot-v');
const SHOWN = pressAt(MEDIA_KEYS, 'vput');
const BACKGROUND = pressAt(MEDIA_KEYS, 'bgpic');

export function MediaScene() {
  const root = useRef<HTMLDivElement>(null);
  const { one } = useEls(root);
  const pointer = usePointer(MEDIA_KEYS, ['file']);
  useFrame((l) => {
    const file = pointer.box('file');
    const pic = pointer.box('pic');
    // Let go, the file goes into the cover's picture (half its size, at the picture's centre) as the picture comes up.
    if (file && pic) {
      const settle = { x: pic.x + pic.w / 2 - file.w / 4, y: pic.y + pic.h / 2 - file.h / 4 };
      carry(one('file'), pointer, l, 0, { rest: file, grab: { x: file.w / 2, y: 20 }, settle, settleScale: 0.5 });
    } else opacity(one('file'), 0);
    opacity(one('dropword'), pointer.over('cover', l) ? 1 : 0);
    appear(one('img'), l, DROPPED + 80, 380, 0);
    move(one('in'), 0, -SCROLL * ease.inOut(seg(l, 1900, 650)));
    dragRow(one('g3'), one('line3'), pointer, l, 1, 'pal-video', 'slot-v', -SCROLL);
    appear(one('video'), l, VIDEO + 40, 300, 4);
    const typed = LINK.slice(0, Math.round(LINK.length * seg(l, VIDEO + 100, 550)));
    const field = one('vfield');
    if (field && field.textContent !== typed) field.textContent = typed;
    appear(one('player'), l, SHOWN + 150, 320, 0);
    // «Оформление» → «Фон» → «Картинка».
    appear(one('design'), l, 4150, 300, 0);
    flag(one('bgpic'), 'is-on', l >= BACKGROUND);
    appear(one('bg'), l, BACKGROUND + 50, 450, 0);
  });
  return (
    <div ref={root} className="r3-scene r3-scene--studio is-flip">
      <Say text={SAY.media[0]} at={300} />
      <div className="r3-ui">
        <div className="r3-studio">
          <Bar />
          <Palette />
          <div data-a="design" data-aim="design" className="r3-panel-side" style={{ opacity: 0 }}>
            <p className="r3-pal-h">Оформление</p>
            <p className="r3-pal-g">Фон</p>
            <span className="r3-choice">Ровный</span>
            <span className="r3-choice">Мягкий</span>
            <span data-a="bgpic" data-aim="bgpic" data-aim-on="is-on" className="r3-choice">
              Картинка
            </span>
            <p className="r3-side-note">Загрузить свою картинку</p>
            <p className="r3-pal-g">Затемнение</p>
            <span className="r3-slider">
              <i />
            </span>
          </div>
          <div data-aim="page" className="r3-page">
            <span data-a="bg" className="r3-page-bg" style={{ opacity: 0 }}>
              <img src={PAPER_URL} alt="" />
            </span>
            <div data-a="in" className="r3-page-in">
              <Cover image="appears" />
              <span data-a="dropword" className="r3-dropword" style={{ opacity: 0 }}>
                Отпустите, и картинка загрузится
              </span>
              <div>
                <div className="r3-blk r3-blk-h">Часть 1. Выручка</div>
                <QuestionBlock points={<em className="r3-points">1 балл</em>} />
                <Slot aim="slot-v" line="line3">
                <div data-a="video" className="r3-blk r3-blk-video" style={{ opacity: 0 }}>
                  <p className="r3-vput">
                    <span data-a="vfield" className="r3-vfield" />
                    <span data-a="vput" data-aim="vput" className="r3-mini r3-mini--ink">
                      Показать
                    </span>
                  </p>
                  <span className="r3-vstage">
                    Вставьте ссылку на видео YouTube, RuTube или VK Видео
                    <span data-a="player" className="r3-player" style={{ opacity: 0 }}>
                      <i className="r3-play-big">
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
                        </svg>
                      </i>
                      <small>Видео RuTube</small>
                    </span>
                  </span>
                  <p className="r3-blk-cap">Разбор на графике, 4 минуты</p>
                </div>
                </Slot>
              </div>
            </div>
          </div>
          <span data-a="file" data-aim="file" className="r3-dropfile r3-carried" style={{ opacity: 0 }}>
            <img src={GRAPH_URL} alt="" />
            график.png
          </span>
          <Drag name="g3" label="Видео" icon={<BlockIcon type="video" />} />
        </div>
        <Cursor pointer={pointer} />
      </div>
    </div>
  );
}

const SWATCHES = ['#2869dd', '#1f8a4c', '#d9661f', '#7a4fd6', '#d43f7a', '#3d4450'];

/** The green swatch, «С засечками», «+» of the points, then the «Результат» tab; the pointer ends in the bar's gap. */
export const LOOK_KEYS: readonly CursorKey[] = [
  { t: 300, aim: 'side', fx: 0.62, fy: 0.75 },
  { t: 850, aim: 'sw1', press: true },
  { t: 1450, aim: 'serif', press: true, fx: 0.42 },
  { t: 2000, aim: 'plus', press: true },
  { t: 2600, aim: 'tabres', press: true },
  { t: 3300, aim: 'bar', fx: 0.5, fy: 0.5 },
];
const GREEN = pressAt(LOOK_KEYS, 'sw1');
const SERIF = pressAt(LOOK_KEYS, 'serif');
const TWO = pressAt(LOOK_KEYS, 'plus');
const RESULT = pressAt(LOOK_KEYS, 'tabres');

export function LookScene() {
  const root = useRef<HTMLDivElement>(null);
  const { one, all } = useEls(root);
  const pointer = usePointer(LOOK_KEYS);
  useFrame((l) => {
    flag(one('page'), 'is-green', l >= GREEN);
    all('sw').forEach((sw, index) => flag(sw, 'is-on', index === (l >= GREEN ? 1 : 0)));
    flag(one('serif'), 'is-on', l >= SERIF);
    flag(one('onest'), 'is-on', l < SERIF);
    flag(one('page'), 'is-serif', l >= SERIF);
    flag(one('pts'), 'is-two', l >= TWO);
    flag(one('pts2'), 'is-two', l >= TWO);
    flag(one('tabres'), 'is-on', l >= RESULT);
    flag(one('tabdes'), 'is-on', l < RESULT);
    appear(one('looks'), l, 0, 1, 0, RESULT);
    appear(one('bands'), l, RESULT + 180, 300, 0);
    [0, 1, 2].forEach((index) => appear(one(`band${index}`), l, RESULT + 280 + index * 220, 320, 8));
  });
  return (
    <div ref={root} className="r3-scene r3-scene--studio">
      <Say text={SAY.look[0]} at={300} until={RESULT - 300} />
      <Say text={SAY.look[1]} at={RESULT + 50} />
      <div className="r3-ui">
        <div className="r3-studio">
          <Bar />
          <div data-aim="side" className="r3-panel-side is-shown">
            <p className="r3-side-tabs">
              <span data-a="tabdes">Оформление</span>
              <span data-a="tabres" data-aim="tabres" data-aim-on="is-on">
                Результат
              </span>
            </p>
            <div data-a="looks">
              <p className="r3-pal-g">Цвет</p>
              <span className="r3-sws">
                {SWATCHES.map((color, index) => (
                  <i
                    key={color}
                    data-a="sw"
                    data-aim={index === 1 ? 'sw1' : undefined}
                    data-aim-on={index === 1 ? 'is-on' : undefined}
                    style={{ background: color }}
                  />
                ))}
              </span>
              <p className="r3-pal-g">Шрифт</p>
              <span data-a="onest" className="r3-choice">
                Onest
              </span>
              <span data-a="serif" data-aim="serif" data-aim-on="is-on" className="r3-choice r3-choice--serif">
                С засечками
              </span>
              <p className="r3-pal-g">Баллы</p>
              <span className="r3-stepper">
                <i>−</i>
                <b data-a="pts" className="r3-two">
                  <span>1</span>
                  <span>2</span>
                </b>
                <i data-aim="plus">+</i>
              </span>
            </div>
            <div data-a="bands" className="r3-bands" style={{ opacity: 0 }}>
              <p className="r3-pal-g">Сообщения по баллам</p>
              {[
                ['0–49 %', 'Тему стоит повторить'],
                ['50–79 %', 'Хороший результат'],
                ['80–100 %', 'Отлично'],
              ].map(([range, title], index) => (
                <p key={range} data-a={`band${index}`} className="r3-band" style={{ opacity: 0 }}>
                  <b>{range}</b>
                  {title}
                </p>
              ))}
            </div>
          </div>
          <div data-a="page" className="r3-page">
            <span className="r3-page-bg">
              <img src={PAPER_URL} alt="" />
            </span>
            <div className="r3-page-in">
              <Cover image="set" />
              <div className="r3-blk r3-blk-h">Часть 1. Выручка</div>
              <QuestionBlock
                points={
                  <em className="r3-points">
                    <span className="r3-two" data-a="pts2">
                      <span>1 балл</span>
                      <span>2 балла</span>
                    </span>
                  </em>
                }
              />
              <span className="r3-finish">Завершить</span>
            </div>
          </div>
        </div>
        <Cursor pointer={pointer} />
      </div>
    </div>
  );
}
