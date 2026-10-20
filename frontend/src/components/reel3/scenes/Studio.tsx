/**
 * The constructor, in three scenes on one studio: «Новый тест» named and created, «Заголовок» and «Один ответ»
 * dragged onto the page (build); the author's own picture dropped on the cover, a «Видео» block with a RuTube link,
 * the page's background picture (media); «Оформление» — colour and font, points, and «Результат» with the messages by
 * points (look). Words: components/studio/copyStudio.ts and components/test/copyTest.ts, as the studio shows them.
 */
import { useRef, type ReactNode } from 'react';
import { flag, put, useEls, useFrame } from '../../reel/engine';
import { BlockIcon, QuestionIcon } from '../../studio/icons';
import { EXAMPLE, SAY } from '../../home3/copy3';
import { PAPER_URL, GRAPH_URL } from '../../home3/art';
import { Arrow, Cursor, Say, appear, ease, mix, move, seg } from '../kit3';

const PALETTE = [
  { kind: 'block', type: 'cover', label: 'Обложка' },
  { kind: 'block', type: 'heading', label: 'Заголовок' },
  { kind: 'block', type: 'text', label: 'Текст' },
  { kind: 'block', type: 'image', label: 'Картинка' },
  { kind: 'block', type: 'video', label: 'Видео' },
  { kind: 'question', type: 'single', label: 'Один ответ' },
  { kind: 'question', type: 'short', label: 'Краткий ответ' },
] as const;

/** Palette rows' centres (UI px): the drags start here. */
const ROW_Y = { heading: 125, video: 209, single: 266 } as const;
const ROW_X = 70;

function Palette() {
  return (
    <div className="r3-pal">
      <p className="r3-pal-h">Блоки</p>
      <p className="r3-pal-g">Страница</p>
      {PALETTE.slice(0, 5).map((item) => (
        <span key={item.label} className="r3-pal-i">
          {item.kind === 'block' ? <BlockIcon type={item.type as 'cover'} /> : null}
          {item.label}
        </span>
      ))}
      <p className="r3-pal-g">Вопросы</p>
      {PALETTE.slice(5).map((item) => (
        <span key={item.label} className="r3-pal-i">
          <QuestionIcon type={item.type as 'single'} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

function Bar({ send }: { send?: ReactNode }) {
  return (
    <div className="r3-st-bar">
      <span className="r3-st-name">
        <b>{EXAMPLE.testTitle}</b>
        <small>Сохранено</small>
      </span>
      <span data-a="send" className="r3-btn r3-btn--s">
        Отправить по ссылке
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
    <div data-a="cover" className="r3-blk r3-blk-cover">
      <span className="r3-cover-pic">
        <BlockIcon type="image" />
        {image === 'none' ? null : <img data-a="img" src={GRAPH_URL} alt="" style={image === 'appears' ? { opacity: 0 } : undefined} />}
      </span>
      <p className="r3-cover-t">{EXAMPLE.testTitle}</p>
      <p className="r3-cover-s">{EXAMPLE.testSubtitle}</p>
    </div>
  );
}

function Drag({ name, label, icon }: { name: string; label: string; icon: ReactNode }) {
  return (
    <span data-a={name} className="r3-ghost" style={{ opacity: 0 }}>
      {icon}
      {label}
    </span>
  );
}

/** Moves a dragged chip from (x0, y0) to (x1, y1) between t0 and t1 (UI px; the chip's centre). */
function drag(el: HTMLElement | undefined, l: number, t0: number, t1: number, x0: number, y0: number, x1: number, y1: number) {
  if (!el) return;
  const shown = l >= t0 - 120 && l < t1 + 160;
  put(el, 'opacity', shown ? String(1 - seg(l, t1, 160)) : '0');
  put(el, 'visibility', shown ? 'visible' : 'hidden');
  if (!shown) return;
  const p = ease.inOut(seg(l, t0, t1 - t0));
  move(el, mix(x0, x1, p) - 50, mix(y0, y1, p) - 13, 1.04);
}

export function BuildScene() {
  const root = useRef<HTMLDivElement>(null);
  const { one } = useEls(root);
  useFrame((l) => {
    appear(one('exams'), l, 100, 420, 16, 1950);
    flag(one('newtest'), 'is-pressed', l >= 650 && l < 950);
    appear(one('named'), l, 950, 360, 10, 1950);
    const typed = 'Эластичность спроса'.slice(0, Math.round(19 * seg(l, 1100, 600)));
    const field = one('field');
    if (field && field.textContent !== typed) field.textContent = typed;
    flag(one('create'), 'is-pressed', l >= 1750 && l < 1950);
    appear(one('studio'), l, 2230, 450, 18);
    drag(one('g1'), l, 2750, 3350, ROW_X, ROW_Y.heading, 264, 132);
    appear(one('line1'), l, 3050, 120, 0, 3400);
    appear(one('heading'), l, 3400, 320, 6);
    drag(one('g2'), l, 4300, 5000, ROW_X, ROW_Y.single, 264, 196);
    appear(one('line2'), l, 4650, 120, 0, 5050);
    appear(one('question'), l, 5050, 380, 8);
  });
  return (
    <div ref={root} className="r3-scene r3-scene--studio">
      <Say text={SAY.build[0]} at={300} until={3700} />
      <Say text={SAY.build[1]} at={3950} />
      <div className="r3-ui">
        <div data-a="exams" className="r3-card r3-exams" style={{ opacity: 0 }}>
          <p className="r3-h">Экзамены</p>
          <p className="r3-meta">Осенняя сессия · 4 предмета · 960 вопросов</p>
          <div className="r3-exams-acts">
            <span className="r3-mini">Новый экзамен</span>
            <span data-a="newtest" className="r3-mini r3-mini--ink">
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
          <span data-a="create" className="r3-btn r3-btn--s">
            Создать
          </span>
        </div>
        <div data-a="studio" className="r3-studio" style={{ opacity: 0 }}>
          <Bar />
          <Palette />
          <div className="r3-page">
            <div className="r3-page-in">
              <Cover image="none" />
              <span data-a="line1" className="r3-dropline" style={{ top: 82, opacity: 0 }} />
              <div data-a="heading" className="r3-blk r3-blk-h" style={{ opacity: 0 }}>
                Часть 1. Выручка
              </div>
              <span data-a="line2" className="r3-dropline" style={{ top: 124, opacity: 0 }} />
              <div data-a="question" style={{ opacity: 0 }}>
                <QuestionBlock points={<em className="r3-points">1 балл</em>} />
              </div>
            </div>
          </div>
          <Drag name="g1" label="Заголовок" icon={<BlockIcon type="heading" />} />
          <Drag name="g2" label="Один ответ" icon={<QuestionIcon type="single" />} />
        </div>
        <Cursor
          keys={[
            { t: 450, x: 220, y: 200 },
            { t: 650, x: 300, y: 118, press: true },
            { t: 1300, x: 260, y: 240 },
            { t: 1750, x: 92, y: 250, press: true },
            { t: 2400, x: 200, y: 260 },
            { t: 2750, x: ROW_X, y: ROW_Y.heading, press: true },
            { t: 3350, x: 264, y: 132 },
            { t: 3900, x: 120, y: 240 },
            { t: 4300, x: ROW_X, y: ROW_Y.single, press: true },
            { t: 5000, x: 264, y: 196 },
            { t: 5700, x: 330, y: 300 },
          ]}
          until={6900}
        />
      </div>
    </div>
  );
}

const LINK = 'rutube.ru/video/7d2c…';

export function MediaScene() {
  const root = useRef<HTMLDivElement>(null);
  const { one } = useEls(root);
  useFrame((l) => {
    // The picture file comes from outside the page and is let go over the cover.
    const fly = ease.inOut(seg(l, 350, 650));
    const file = one('file');
    put(file, 'opacity', l >= 300 && l < 1400 ? String(1 - seg(l, 1250, 150)) : '0');
    move(file, mix(170, 0, fly), mix(150, 0, fly));
    flag(one('cover'), 'is-drop', l >= 900 && l < 1350);
    appear(one('dropword'), l, 900, 160, 0, 1300);
    appear(one('img'), l, 1300, 380, 0);
    const scroll = ease.inOut(seg(l, 1900, 650));
    move(one('in'), 0, -190 * scroll);
    drag(one('g3'), l, 2300, 2950, ROW_X, ROW_Y.video, 264, 246);
    appear(one('video'), l, 2950, 340, 8);
    const typed = LINK.slice(0, Math.round(LINK.length * seg(l, 3100, 550)));
    const field = one('vfield');
    if (field && field.textContent !== typed) field.textContent = typed;
    flag(one('vput'), 'is-pressed', l >= 3720 && l < 3900);
    appear(one('player'), l, 3900, 320, 0);
    // «Оформление» → «Фон» → «Картинка».
    appear(one('design'), l, 4150, 300, 0);
    flag(one('bgpic'), 'is-on', l >= 4600);
    appear(one('bg'), l, 4650, 450, 0);
  });
  return (
    <div ref={root} className="r3-scene r3-scene--studio is-flip">
      <Say text={SAY.media[0]} at={300} />
      <div className="r3-ui">
        <div className="r3-studio">
          <Bar />
          <Palette />
          <div data-a="design" className="r3-panel-side" style={{ opacity: 0 }}>
            <p className="r3-pal-h">Оформление</p>
            <p className="r3-pal-g">Фон</p>
            <span className="r3-choice">Ровный</span>
            <span className="r3-choice">Мягкий</span>
            <span data-a="bgpic" className="r3-choice">
              Картинка
            </span>
            <p className="r3-side-note">Загрузить свою картинку</p>
            <p className="r3-pal-g">Затемнение</p>
            <span className="r3-slider">
              <i />
            </span>
          </div>
          <div className="r3-page">
            <span data-a="bg" className="r3-page-bg" style={{ opacity: 0 }}>
              <img src={PAPER_URL} alt="" />
            </span>
            <div data-a="in" className="r3-page-in">
              <Cover image="appears" />
              <span data-a="dropword" className="r3-dropword" style={{ opacity: 0 }}>
                Отпустите — картинка загрузится
              </span>
              <div>
                <div className="r3-blk r3-blk-h">Часть 1. Выручка</div>
                <QuestionBlock points={<em className="r3-points">1 балл</em>} />
                <div data-a="video" className="r3-blk r3-blk-video" style={{ opacity: 0 }}>
                  <p className="r3-vput">
                    <span data-a="vfield" className="r3-vfield" />
                    <span data-a="vput" className="r3-mini r3-mini--ink">
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
              </div>
            </div>
          </div>
          <span data-a="file" className="r3-dropfile" style={{ opacity: 0 }}>
            <img src={GRAPH_URL} alt="" />
            график.png
          </span>
          <Drag name="g3" label="Видео" icon={<BlockIcon type="video" />} />
        </div>
        <Cursor
          keys={[
            { t: 350, x: 380, y: 230 },
            { t: 1000, x: 228, y: 100, press: true },
            { t: 1700, x: 200, y: 280 },
            { t: 2300, x: ROW_X, y: ROW_Y.video, press: true },
            { t: 2950, x: 264, y: 246 },
            { t: 3600, x: 330, y: 262 },
            { t: 3720, x: 330, y: 262, press: true },
            { t: 4300, x: 70, y: 150 },
            { t: 4500, x: 56, y: 147, press: true },
            { t: 5000, x: 200, y: 300 },
          ]}
          until={5300}
        />
      </div>
    </div>
  );
}

const SWATCHES = ['#2869dd', '#1f8a4c', '#d9661f', '#7a4fd6', '#d43f7a', '#3d4450'];

export function LookScene() {
  const root = useRef<HTMLDivElement>(null);
  const { one, all } = useEls(root);
  useFrame((l) => {
    flag(one('page'), 'is-green', l >= 900);
    all('sw').forEach((sw, index) => flag(sw, 'is-on', index === (l >= 900 ? 1 : 0)));
    flag(one('serif'), 'is-on', l >= 1550);
    flag(one('onest'), 'is-on', l < 1550);
    flag(one('page'), 'is-serif', l >= 1550);
    flag(one('pts'), 'is-two', l >= 2150);
    flag(one('pts2'), 'is-two', l >= 2150);
    flag(one('tabres'), 'is-on', l >= 2500);
    flag(one('tabdes'), 'is-on', l < 2500);
    appear(one('looks'), l, 0, 1, 0, 2500);
    appear(one('bands'), l, 2780, 300, 0);
    [0, 1, 2].forEach((index) => appear(one(`band${index}`), l, 2880 + index * 220, 320, 8));
  });
  return (
    <div ref={root} className="r3-scene r3-scene--studio">
      <Say text={SAY.look[0]} at={300} until={2300} />
      <Say text={SAY.look[1]} at={2550} />
      <div className="r3-ui">
        <div className="r3-studio">
          <Bar />
          <div className="r3-panel-side is-shown">
            <p className="r3-side-tabs">
              <span data-a="tabdes">Оформление</span>
              <span data-a="tabres">Результат</span>
            </p>
            <div data-a="looks">
              <p className="r3-pal-g">Цвет</p>
              <span className="r3-sws">
                {SWATCHES.map((color) => (
                  <i key={color} data-a="sw" style={{ background: color }} />
                ))}
              </span>
              <p className="r3-pal-g">Шрифт</p>
              <span data-a="onest" className="r3-choice">
                Onest
              </span>
              <span data-a="serif" className="r3-choice r3-choice--serif">
                С засечками
              </span>
              <p className="r3-pal-g">Баллы</p>
              <span className="r3-stepper">
                <i>−</i>
                <b data-a="pts" className="r3-two">
                  <span>1</span>
                  <span>2</span>
                </b>
                <i>+</i>
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
        <Cursor
          keys={[
            { t: 500, x: 200, y: 280 },
            { t: 850, x: 38, y: 118, press: true },
            { t: 1500, x: 60, y: 192, press: true },
            { t: 2100, x: 104, y: 243, press: true },
            { t: 2450, x: 92, y: 56, press: true },
            { t: 3200, x: 300, y: 300 },
          ]}
          until={4200}
        />
      </div>
    </div>
  );
}
