/**
 * «Свой тест» (release 47.2, «Студия теста»): «Новый тест» on «Экзамены», the test named and «Создать»; in the studio
 * «Заголовок» dragged from «Блоки» onto the page (the blue line shows where it goes), «Один ответ» added and its right
 * option marked «верный», a colour picked in «Оформление» (the page's «Отправить» takes it), and «Посмотреть как
 * участник» — the page in a phone as the participant gets it. Every word is the screens' own (copyTest.ts,
 * copyStudio.ts); the example is a chemistry test.
 */
import { useRef } from 'react';
import { opacity, put, useEls, useFrame } from '../../reel/engine';
import { clamp, ease, mix, seg } from '../../reel/timeline';
import { keyed, slideIn, Wordmark } from '../../film/kit';
import { NEW_TEST } from '../../test/copyTest';
import { DOC, STUDIO } from '../../studio/copyStudio';
import { EDITOR } from '../../containers/copyImport';
import { BlockIcon, QuestionIcon, UiIcon } from '../../studio/icons';
import { ACCENTS } from '../../../lib/studio/contrast';
import type { ClipStep } from '../types';
import { Arrow, BackArrow, Loop, Plus, arrive, between, focusRow, leave, press, typeInto } from './kit';

export const STUDIO_TOTAL = 14000;

export const STUDIO_EXAMPLE = {
  title: 'Кислоты и основания',
  subtitle: 'Химия · 9 класс',
  heading: 'Часть 1. Сильные кислоты',
  stem: 'Какая из кислот относится к сильным?',
  options: ['Угольная', 'Серная', 'Сероводородная'],
  right: 1,
  /** The colour picked in «Оформление»: green (lib/studio/contrast ACCENTS). */
  accent: 'green',
} as const;

const OPTION_LETTERS = ['А', 'Б', 'В', 'Г'];
const BLUE = ACCENTS.blue.light.fill;
const GREEN = ACCENTS.green.light.fill;
const SWATCHES = ['blue', 'green', 'orange', 'violet', 'pink', 'graphite'] as const;

/** Scene times (ms). */
export const ST = {
  /** «Новый тест» is pressed on «Экзамены». */
  door: 900,
  /** The page «Новый тест». */
  named: 1150,
  type: 1500,
  create: 2600,
  /** The studio opens. */
  studio: 2900,
  /** «Заголовок» is taken from «Блоки»… */
  grab: 3500,
  /** …and put on the page under the cover. */
  drop: 4550,
  /** «Один ответ» is pressed: the question comes after the heading. */
  question: 5900,
  /** Its right option is ticked in the block's settings… */
  key: 6900,
  /** …and «Сохранить» pressed: the page shows «верный». */
  save: 7450,
  /** «Оформление». */
  design: 8450,
  /** Green is picked. */
  colour: 9300,
  /** «Посмотреть как участник». */
  preview: 10950,
} as const;

export const STUDIO_STEPS: readonly ClipStep[] = [
  { at: 0, caption: `Нажмите «${NEW_TEST.entry}» и назовите тест.`, still: 2450 },
  { at: 3000, caption: `Перетащите «${STUDIO.types.heading}» на страницу.`, still: 4420 },
  { at: 5600, caption: 'Добавьте вопрос и отметьте верный ответ.', still: 7950 },
  { at: 8200, caption: `Во вкладке «${STUDIO.design}» выберите цвет.`, still: 10100 },
  { at: 10600, caption: `«${STUDIO.preview}» — тест глазами ученика.`, still: 12500 },
];

/** Where the dragged «Заголовок» starts (its row in «Блоки») and lands (the line under the cover): stage px. */
const DRAG_FROM = { x: 150, y: 330 };
const DRAG_TO = { x: 740, y: 528 };

/**
 * The studio with the example test made (the cover, the heading, the question with its key, the page green), still:
 * the picture «Тест по ссылке» starts on. `send` names «Отправить по ссылке» for the clip's frames.
 */
export function StudioStill({ title, send }: { title: string; send: string }) {
  return (
    <div className="sx-screen st-x-studio">
      <div className="st-x-bar">
        <span className="st-x-backbtn">
          <UiIcon name="back" className="st-x-ico" />
        </span>
        <span className="st-x-name">
          <b>{title}</b>
          <small>
            <UiIcon name="check" className="st-x-ico st-x-ico--s" />
            {STUDIO.saved}
          </small>
        </span>
        <span className="st-x-tool">
          <UiIcon name="eye" className="st-x-ico" />
          {STUDIO.preview}
        </span>
        <span data-a={send} className="fm-btn fm-btn--blue sx-pill st-x-send">
          <span className="sx-pill-t">{STUDIO.send}</span>
          <i>
            <Arrow />
          </i>
        </span>
      </div>
      <div className="st-x-palette">
        <p className="st-x-pal-h">{STUDIO.palette}</p>
        <p className="st-x-pal-g">{STUDIO.blocksGroup}</p>
        {(['cover', 'heading', 'text', 'image', 'note'] as const).map((type) => (
          <span key={type} className="st-x-pal-i">
            <BlockIcon type={type} />
            {STUDIO.types[type]}
          </span>
        ))}
        <p className="st-x-pal-g">{STUDIO.questionsGroup}</p>
        {(['single', 'short'] as const).map((type) => (
          <span key={type} className="st-x-pal-i">
            <QuestionIcon type={type} />
            {STUDIO.qtypes[type]}
          </span>
        ))}
      </div>
      <div className="st-x-canvas">
        <div className="st-x-page">
          <div className="st-x-scroll" style={{ transform: 'translate3d(0,-236px,0)' }}>
            <div className="st-x-cover" />
            <p className="st-x-title">{STUDIO_EXAMPLE.title}</p>
            <p className="st-x-sub">{STUDIO_EXAMPLE.subtitle}</p>
            <div className="st-x-slot">
              <p className="st-x-heading">{STUDIO_EXAMPLE.heading}</p>
              <div className="st-x-below" style={{ transform: 'translate3d(0,96px,0)' }}>
                <div className="st-x-q">
                  <p className="st-x-qno">
                    {STUDIO.questionNo(1)} · {STUDIO.required}
                  </p>
                  <p className="st-x-stem">{STUDIO_EXAMPLE.stem}</p>
                  {STUDIO_EXAMPLE.options.map((option, index) => (
                    <span key={option} className={`st-x-opt${index === STUDIO_EXAMPLE.right ? ' is-key' : ''}`}>
                      <b>{OPTION_LETTERS[index]}</b>
                      {option}
                      {index === STUDIO_EXAMPLE.right ? <em className="st-x-key">{STUDIO.keyMark}</em> : null}
                    </span>
                  ))}
                </div>
                <div className="st-x-below" style={{ transform: 'translate3d(0,400px,0)' }}>
                  <span className="st-x-pagesend" style={{ background: GREEN }}>
                    {DOC.send}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="st-x-side">
        <div className="st-x-tabs">
          <span className="st-x-tab is-on">{STUDIO.panels.block}</span>
          <span className="st-x-tab">{STUDIO.panels.design}</span>
          <span className="st-x-tab">{STUDIO.panels.result}</span>
        </div>
        <div className="st-x-panel">
          <p className="fm-muted st-x-hint">{STUDIO.nothingSelected}</p>
          <p className="st-x-side-h">{STUDIO.pageSettings}</p>
          <p className="st-x-side-l">{STUDIO.pageTitle}</p>
          <p className="st-x-side-f">{STUDIO_EXAMPLE.title}</p>
        </div>
      </div>
    </div>
  );
}

/** The page as the participant gets it, in the preview's phone. */
function PhonePage() {
  return (
    <div className="st-x-phone-page">
      <div className="st-x-cover st-x-cover--small" />
      <p className="st-x-phone-title">{STUDIO_EXAMPLE.title}</p>
      <p className="st-x-phone-sub">{STUDIO_EXAMPLE.subtitle}</p>
      <p className="st-x-phone-h">{STUDIO_EXAMPLE.heading}</p>
      <div className="st-x-phone-q">
        <p className="st-x-qno">{DOC.questionNo(1)}</p>
        <p className="st-x-phone-stem">{STUDIO_EXAMPLE.stem}</p>
        {STUDIO_EXAMPLE.options.map((option) => (
          <span key={option} className="st-x-phone-opt">
            <i className="st-x-phone-radio" />
            {option}
          </span>
        ))}
      </div>
      <span className="st-x-phone-send" style={{ background: GREEN }}>
        {DOC.send}
      </span>
    </div>
  );
}

export function StudioScene() {
  const root = useRef<HTMLDivElement>(null);
  const { one, all } = useEls(root);
  useFrame((l) => {
    // 1 · «Экзамены»: «Новый тест»; the page «Новый тест»: the name typed, «Создать».
    press(one('door'), l, ST.door, 0.06);
    leave(one('exams'), l, ST.named);
    arrive(one('newtest'), l, ST.named);
    typeInto(one('name'), one('caret'), STUDIO_EXAMPLE.title, l, ST.type, 20, ST.create);
    press(one('create'), l, ST.create, 0.06);
    opacity(one('createa'), 1 - seg(l, ST.create + 40, 120));
    opacity(one('createb'), seg(l, ST.create + 40, 120));
    leave(one('newtestout'), l, ST.studio);
    opacity(one('strip'), 1 - seg(l, ST.studio, 260));

    // 2 · the studio: «Заголовок» from «Блоки» onto the page, the blue line where it goes.
    arrive(one('studio'), l, ST.studio, 160);
    press(one('pal-heading'), l, ST.grab, 0.05);
    opacity(one('pal-heading'), l > ST.grab + 80 && l < ST.drop + 120 ? 0.4 : 1);
    const travel = seg(l, ST.grab + 100, ST.drop - ST.grab - 100);
    const ghost = one('ghost');
    if (travel <= 0 || l > ST.drop + 160) {
      opacity(ghost, 0);
    } else {
      const x = keyed(travel, [[0, DRAG_FROM.x], [0.15, DRAG_FROM.x + 40], [1, DRAG_TO.x]]);
      const y = keyed(travel, [[0, DRAG_FROM.y], [0.15, DRAG_FROM.y - 24], [1, DRAG_TO.y]]);
      const drop = seg(l, ST.drop, 160);
      const lift = ease.out(seg(l, ST.grab + 100, 200));
      put(ghost, 'transform', `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) translate(-50%,-50%) scale(${(mix(0.94, 1.04, lift) * (1 - 0.3 * drop)).toFixed(3)}) rotate(${(-2.5 * lift * (1 - travel)).toFixed(2)}deg)`);
      opacity(ghost, clamp(lift * 2) * (1 - drop));
    }
    const line = seg(l, ST.grab + 600, 220) * (1 - seg(l, ST.drop + 60, 160));
    opacity(one('insert'), line);
    put(one('insert'), 'transform', `scaleX(${mix(0.6, 1, ease.out(line)).toFixed(3)})`);
    // The heading takes its place; what is under it moves down.
    const open = ease.inOut(seg(l, ST.drop, 420));
    put(one('below-heading'), 'transform', `translate3d(0,${(96 * open).toFixed(1)}px,0)`);
    focusRow(one('heading'), l, ST.drop + 120, 420);

    // 3 · «Один ответ»: the question comes after the heading; «верный» on its right option.
    press(one('pal-single'), l, ST.question, 0.05);
    const grow = ease.inOut(seg(l, ST.question + 60, 520));
    put(one('below-question'), 'transform', `translate3d(0,${(400 * grow).toFixed(1)}px,0)`);
    slideIn(one('question'), l, ST.question + 160, { dy: 30, dur: 620, smear: 8 });
    // The page scrolls to keep the new question in view.
    const scroll = ease.inOut(seg(l, ST.question + 400, 700));
    put(one('scroll'), 'transform', `translate3d(0,${(-236 * scroll).toFixed(1)}px,0)`);
    // The question is selected: its settings («Блок») in place of the page's; the key ticked there and saved.
    opacity(one('qsel'), between(l, ST.question + 400, ST.design - 200));
    focusRow(one('panel-question'), l, ST.question + 380, 360);
    if (l >= ST.design) opacity(one('panel-question'), 1 - seg(l, ST.design + 60, 160));
    press(one('tick-right'), l, ST.key, 0.12);
    const ticked = l >= ST.key + 40;
    put(one('tick-right'), 'background', ticked ? 'var(--blue)' : '#fff');
    put(one('tick-right'), 'box-shadow', ticked ? 'none' : 'inset 0 0 0 2.5px #8d929a');
    opacity(one('tick-mark'), ticked ? 1 : 0);
    opacity(one('tick-word'), seg(l, ST.key + 40, 160));
    press(one('save'), l, ST.save, 0.06);
    const keyOn = l >= ST.save + 80;
    put(one('opt-right'), 'box-shadow', keyOn ? 'inset 0 0 0 3px #8acb97' : 'inset 0 0 0 2px #e4e4de');
    put(one('opt-right'), 'background', keyOn ? '#f2f9f3' : '#fff');
    opacity(one('keytag'), seg(l, ST.save + 80, 180));

    // 4 · «Оформление»: green; the page's «Отправить» takes it.
    press(one('tab-design'), l, ST.design, 0.06);
    const onDesign = l >= ST.design + 60;
    put(one('tab-block'), 'background', onDesign ? 'transparent' : 'var(--ink)');
    put(one('tab-block'), 'color', onDesign ? 'var(--ink)' : '#fff');
    put(one('tab-design'), 'background', onDesign ? 'var(--ink)' : 'transparent');
    put(one('tab-design'), 'color', onDesign ? '#fff' : 'var(--ink)');
    opacity(one('panel-block'), 1 - seg(l, ST.question + 300, 160));
    all('design-row').forEach((row, index) => focusRow(row, l, ST.design + 140 + index * 90, 360));
    press(one('sw-green'), l, ST.colour, 0.1);
    const picked = l >= ST.colour + 60;
    put(one('ring-blue'), 'opacity', picked ? '0' : '1');
    put(one('ring-green'), 'opacity', picked ? '1' : '0');
    const tint = seg(l, ST.colour + 60, 260);
    put(one('send'), 'background', tint >= 1 ? GREEN : tint <= 0 ? BLUE : mixColour(BLUE, GREEN, tint));

    // 5 · «Посмотреть как участник»: the page in a phone.
    press(one('preview-btn'), l, ST.preview, 0.05);
    opacity(one('preview'), seg(l, ST.preview + 160, 280));
    slideIn(one('phone'), l, ST.preview + 240, { dy: 140, dur: 760, smear: 10 });
  });

  return (
    <div ref={root} className="mr-scene">
      <Loop total={STUDIO_TOTAL}>
        <div data-a="strip">
          <div className="sx-strip">
            <Wordmark className="sx-strip-mark" />
            {['Сегодня', 'Экзамены', 'Лекции', 'Повторение', 'Прогресс'].map((item) => (
              <span key={item} className={item === 'Экзамены' ? 'is-on' : undefined}>
                {item}
              </span>
            ))}
          </div>
        </div>

        {/* 1 · «Экзамены» with its two doors. */}
        <div data-a="exams" className="sx-screen">
          <p className="fm-h1 st-x-h1">Экзамены</p>
          <div className="st-x-doors">
            <div className="st-x-door-col">
              <span className="st-x-door">
                Новый экзамен
                <i>
                  <Plus />
                </i>
              </span>
              <p className="st-x-door-note fm-muted">{NEW_TEST.examNote}</p>
            </div>
            <div className="st-x-door-col">
              <span data-a="door" className="st-x-door">
                {NEW_TEST.entry}
                <i>
                  <Plus />
                </i>
              </span>
              <p className="st-x-door-note fm-muted">{NEW_TEST.entryNote}</p>
            </div>
          </div>
          <div className="fm-card st-x-exam" style={{ left: 80 }}>
            <p className="st-x-exam-t">Микроэкономика</p>
            <p className="fm-muted st-x-exam-m">1 ноября, через 14 дней · 400 вопросов</p>
            <span className="st-x-exam-bar" />
          </div>
          <div className="fm-card st-x-exam" style={{ left: 740 }}>
            <p className="st-x-exam-t">Базы данных</p>
            <p className="fm-muted st-x-exam-m">21 октября, через 3 дня · 20 вопросов</p>
            <span className="st-x-exam-bar" />
          </div>
        </div>

        {/* 1 · «Новый тест»: the name and «Создать». */}
        <div data-a="newtestout" className="sx-screen">
          <div data-a="newtest" className="sx-screen" style={{ opacity: 0 }}>
            <span className="sx-back st-x-back">
              <BackArrow />
              Экзамены
            </span>
            <p className="fm-h1 st-x-h1 st-x-h1--low">{NEW_TEST.title}</p>
            <p className="fm-muted st-x-lede">{NEW_TEST.lede}</p>
            <div className="fm-card st-x-name">
              <p className="st-x-label">{NEW_TEST.name}</p>
              <p className="st-x-field">
                <span data-a="name" />
                <i data-a="caret" className="fm-caret" style={{ opacity: 0 }} />
              </p>
              <span data-a="create" className="fm-btn fm-btn--blue sx-pill st-x-create">
                <span className="sx-pill-t sx-swap">
                  <span data-a="createa">{NEW_TEST.create}</span>
                  <span data-a="createb" style={{ opacity: 0 }}>
                    {NEW_TEST.creating}
                  </span>
                </span>
                <i>
                  <Arrow />
                </i>
              </span>
            </div>
          </div>
        </div>

        {/* 2–5 · the studio. */}
        <div data-a="studio" className="sx-screen st-x-studio" style={{ opacity: 0 }}>
          <div className="st-x-bar">
            <span className="st-x-backbtn">
              <UiIcon name="back" className="st-x-ico" />
            </span>
            <span className="st-x-name">
              <b>{STUDIO_EXAMPLE.title}</b>
              <small>
                <UiIcon name="check" className="st-x-ico st-x-ico--s" />
                {STUDIO.saved}
              </small>
            </span>
            <span data-a="preview-btn" className="st-x-tool">
              <UiIcon name="eye" className="st-x-ico" />
              {STUDIO.preview}
            </span>
            <span className="fm-btn fm-btn--blue sx-pill st-x-send">
              <span className="sx-pill-t">{STUDIO.send}</span>
              <i>
                <Arrow />
              </i>
            </span>
          </div>

          <div className="st-x-palette">
            <p className="st-x-pal-h">{STUDIO.palette}</p>
            <p className="st-x-pal-g">{STUDIO.blocksGroup}</p>
            {(['cover', 'heading', 'text', 'image', 'note'] as const).map((type) => (
              <span key={type} data-a={type === 'heading' ? 'pal-heading' : undefined} className="st-x-pal-i">
                <BlockIcon type={type} />
                {STUDIO.types[type]}
              </span>
            ))}
            <p className="st-x-pal-g">{STUDIO.questionsGroup}</p>
            {(['single', 'short'] as const).map((type) => (
              <span key={type} data-a={type === 'single' ? 'pal-single' : undefined} className="st-x-pal-i">
                <QuestionIcon type={type} />
                {STUDIO.qtypes[type]}
              </span>
            ))}
          </div>

          <div className="st-x-canvas">
            <div className="st-x-page">
              <div data-a="scroll" className="st-x-scroll">
                <div className="st-x-cover" />
                <p className="st-x-title">{STUDIO_EXAMPLE.title}</p>
                <p className="st-x-sub">{STUDIO_EXAMPLE.subtitle}</p>
                <div className="st-x-slot">
                  <i data-a="insert" className="st-x-insert" style={{ opacity: 0 }} />
                  <p data-a="heading" className="st-x-heading" style={{ opacity: 0 }}>
                    {STUDIO_EXAMPLE.heading}
                  </p>
                  <div data-a="below-heading" className="st-x-below">
                    <div data-a="question" className="st-x-q" style={{ opacity: 0 }}>
                      <i data-a="qsel" className="st-x-qsel" style={{ opacity: 0 }} />
                      <p className="st-x-qno">
                        {STUDIO.questionNo(1)} · {STUDIO.required}
                      </p>
                      <p className="st-x-stem">{STUDIO_EXAMPLE.stem}</p>
                      {STUDIO_EXAMPLE.options.map((option, index) => (
                        <span key={option} data-a={index === STUDIO_EXAMPLE.right ? 'opt-right' : undefined} className="st-x-opt">
                          <b>{OPTION_LETTERS[index]}</b>
                          {option}
                          {index === STUDIO_EXAMPLE.right ? (
                            <em data-a="keytag" className="st-x-key" style={{ opacity: 0 }}>
                              {STUDIO.keyMark}
                            </em>
                          ) : null}
                        </span>
                      ))}
                    </div>
                    <div data-a="below-question" className="st-x-below">
                      <span data-a="send" className="st-x-pagesend" style={{ background: BLUE }}>
                        {DOC.send}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="st-x-side">
            <div className="st-x-tabs">
              <span data-a="tab-block" className="st-x-tab">
                {STUDIO.panels.block}
              </span>
              <span data-a="tab-design" className="st-x-tab">
                {STUDIO.panels.design}
              </span>
              <span className="st-x-tab">{STUDIO.panels.result}</span>
            </div>
            <div data-a="panel-block" className="st-x-panel">
              <p className="fm-muted st-x-hint">{STUDIO.nothingSelected}</p>
              <p className="st-x-side-h">{STUDIO.pageSettings}</p>
              <p className="st-x-side-l">{STUDIO.pageTitle}</p>
              <p className="st-x-side-f">{STUDIO_EXAMPLE.title}</p>
            </div>
            <div data-a="panel-question" className="st-x-panel" style={{ opacity: 0 }}>
              <p className="st-x-side-h st-x-side-h--top">{STUDIO.questionNo(1)}</p>
              <p className="fm-muted st-x-side-sub">Блок 3 из 3</p>
              <p className="st-x-side-l">{EDITOR.options}</p>
              {STUDIO_EXAMPLE.options.map((option, index) => (
                <span key={option} className="st-x-tick-row">
                  <i data-a={index === STUDIO_EXAMPLE.right ? 'tick-right' : undefined} className="st-x-tick">
                    {index === STUDIO_EXAMPLE.right ? (
                      <svg data-a="tick-mark" viewBox="0 0 20 20" aria-hidden="true" style={{ opacity: 0 }}>
                        <path d="M5 10.5l3.2 3.2L15 7" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : null}
                  </i>
                  <span className="st-x-tick-t">{option}</span>
                  {index === STUDIO_EXAMPLE.right ? (
                    <em data-a="tick-word" className="st-x-key" style={{ opacity: 0 }}>
                      {EDITOR.rightWord}
                    </em>
                  ) : null}
                </span>
              ))}
              <span data-a="save" className="st-x-save">
                {EDITOR.save}
              </span>
            </div>
            <div className="st-x-panel">
              <div data-a="design-row" style={{ opacity: 0 }}>
                <p className="st-x-side-l">{STUDIO.accent}</p>
                <div className="st-x-swatches">
                  {SWATCHES.map((name) => (
                    <span key={name} data-a={name === 'green' ? 'sw-green' : undefined} className="st-x-sw" style={{ background: ACCENTS[name].light.fill }}>
                      {name === 'blue' || name === 'green' ? <i data-a={`ring-${name}`} className="st-x-ring" style={{ opacity: name === 'blue' ? 1 : 0 }} /> : null}
                    </span>
                  ))}
                </div>
                <span className="st-x-chip st-x-own">
                  <i />
                  {STUDIO.customColor}
                </span>
              </div>
              <div data-a="design-row" style={{ opacity: 0 }}>
                <p className="st-x-side-l">{STUDIO.background}</p>
                <div className="st-x-chips">
                  <span className="st-x-chip is-on">{STUDIO.backgrounds.plain}</span>
                  <span className="st-x-chip">{STUDIO.backgrounds.soft}</span>
                  <span className="st-x-chip">{STUDIO.backgrounds.image}</span>
                </div>
              </div>
              <div data-a="design-row" style={{ opacity: 0 }}>
                <p className="st-x-side-l">{STUDIO.font}</p>
                <div className="st-x-chips">
                  <span className="st-x-chip is-on">{STUDIO.fonts.onest}</span>
                  <span className="st-x-chip">{STUDIO.fonts.serif}</span>
                </div>
              </div>
            </div>
          </div>

          {/* The dragged «Заголовок». */}
          <span data-a="ghost" className="st-x-ghost" style={{ opacity: 0 }}>
            <BlockIcon type="heading" />
            {STUDIO.types.heading}
          </span>

          {/* «Посмотреть как участник». */}
          <div data-a="preview" className="st-x-preview" style={{ opacity: 0 }}>
            <div className="st-x-pv-bar">
              <span className="st-x-pv-t">
                <b>{STUDIO.previewTitle}</b>
                <small>{STUDIO.previewNote}</small>
              </span>
              <span className="st-x-pv-seg">
                <span className="is-on">
                  <UiIcon name="phone" className="st-x-ico" />
                  {STUDIO.device.phone}
                </span>
                <span>
                  <UiIcon name="desktop" className="st-x-ico" />
                  {STUDIO.device.desktop}
                </span>
              </span>
              <span className="st-x-pv-close">
                <UiIcon name="close" className="st-x-ico" />
                {STUDIO.previewClose}
              </span>
            </div>
            <div data-a="phone" className="st-x-phone" style={{ opacity: 0 }}>
              <PhonePage />
            </div>
          </div>
        </div>
      </Loop>
    </div>
  );
}

/** Two #rrggbb colours mixed (the page's accent changing). */
function mixColour(a: string, b: string, p: number): string {
  const parse = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  const [x, y] = [parse(a), parse(b)];
  return `rgb(${x.map((v, i) => Math.round(mix(v, y[i], p))).join(',')})`;
}
