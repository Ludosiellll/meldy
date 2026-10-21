/**
 * The landing v3's sections after the first screen, in the reel's order: the lecture, the exam (the department's
 * file, the plan, the session with what is left to learn, the ticket aloud), the group and Telegram, the game in
 * class. Each picture is a tinted stage with Meldy's own light screens laid over it (they are pictures of the app, light
 * in both themes); the game's is the real recorded game on the projector.
 *
 * Nothing on the page moves when a picture is pressed (owner, 2026-10-21: «при нажатии на блоки … другие блоки чуть
 * вниз сьезжают»): every text a press can show is in the markup from the start, stacked in one grid cell with the
 * others (Swap, the tab panels), and a press only changes which one is seen. Landing3.test.tsx holds it.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { glue } from '../../lib/containers/words';
import { CTA, EXAMPLE, EXAM_SECTION, GAME, GAME_SECTION, GROUP_SECTION, LECTURE_SECTION, PICTURES, bind } from './copy3';
import { useLazyPart } from '../../lib/lazyPart';
import { reelPart } from './reelPart';
import { ArrowIcon } from './HeroTop';
import Swap from './Swap';
import TicketAloud from './TicketAloud';
import { prefersStill, useInView } from './useInView';

export function SectionHead({ id, title, text, children }: { id: string; title: string; text: string; children?: ReactNode }) {
  return (
    <div className="p3-head">
      <h2 id={id} className="p3-h2">
        {bind(title)}
      </h2>
      <p className="p3-text">{bind(text)}</p>
      {children}
    </div>
  );
}

/** A delay for an entrance, ms (the stage's layers come in one after another). */
const delay = (ms: number) => ({ '--d': ms }) as CSSProperties;

/** A card of a section: its title, one line and the picture; the picture's layers come in when the card is seen. */
function Card({ name, title, text, children }: { name: string; title: string; text: string; children: (seen: boolean) => ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const seen = useInView(ref);
  return (
    <article ref={ref} className={`p3-card p3-card--${name}`} data-reveal={seen ? 'in' : 'wait'}>
      <div className="p3-card-text">
        <h3 className="p3-h3">{bind(title)}</h3>
        <p className="p3-p">{bind(text)}</p>
      </div>
      {children(seen)}
    </article>
  );
}

const PANELS: ReactNode[] = [
  <>
    <p className="p3-sum-h">1. Что такое эластичность</p>
    <p className="p3-sum">На сколько процентов изменится спрос, если цена изменится на 1 %.</p>
    <p className="p3-sum-h">2. Эластичность и выручка</p>
    <p className="p3-quote">
      <span>{EXAMPLE.quoteAt}</span>
      {EXAMPLE.quote}
    </p>
  </>,
  <p className="p3-sum">Эластичность показывает, как спрос отвечает на цену. От неё зависит, поднимать цену или снижать, чтобы выручка росла.</p>,
  <>
    <p className="p3-meta">Вопрос 1 из 5</p>
    <p className="p3-stem">{EXAMPLE.testStem}</p>
    {EXAMPLE.testOptions.map((option, index) => (
      <span key={option} className="p3-opt">
        <b>{'АБВ'[index]}</b>
        {option}
      </span>
    ))}
  </>,
  <div className="p3-flash">
    <p className="p3-meta">Карточка 3 из 6</p>
    <p className="p3-stem">Как связаны эластичность и выручка?</p>
    <span className="p3-flash-acts">
      <span className="p3-mini">Не помню</span>
      <span className="p3-mini">Знаю</span>
    </span>
  </div>,
  <>
    <p className="p3-bubble">Как меняется выручка, если спрос эластичный и цену снизили?</p>
    <p className="p3-bubble p3-bubble--me">Выручка растёт: количество растёт сильнее, чем падает цена.</p>
    <span className="p3-voice">
      <span className="p3-mic" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
        </svg>
      </span>
      Разговор голосом по этой лекции
    </span>
  </>,
];

export function LectureSection() {
  const [tab, setTab] = useState(0);
  const stage = useRef<HTMLDivElement>(null);
  const seen = useInView(stage);
  return (
    <section id="lecture" className="h3-wrap p3-sec p3-split" aria-labelledby="lecture-h">
      <SectionHead id="lecture-h" title={LECTURE_SECTION.title} text={LECTURE_SECTION.text} />
      <div ref={stage} className="p3-stage p3-stage--blue p3-lec" data-reveal={seen ? 'in' : 'wait'}>
        <div className="p3-win p3-lec-win p3-l">
          <p className="p3-meta">{PICTURES.lectureMeta}</p>
          <p className="p3-pic-h">{EXAMPLE.lecture}</p>
          <div className="p3-tabs" role="tablist" aria-label="Материалы лекции">
            {LECTURE_SECTION.tabs.map((label, index) => (
              <button
                key={label}
                id={`lec-tab-${index}`}
                type="button"
                role="tab"
                aria-selected={tab === index}
                aria-controls={`lec-panel-${index}`}
                className={`p3-tab${tab === index ? ' is-on' : ''}`}
                onClick={() => setTab(index)}
              >
                {label}
                {index === 2 ? <em>5</em> : index === 3 ? <em>6</em> : null}
              </button>
            ))}
          </div>
          {/* Every panel is laid out in one cell, so the window is as tall as the tallest and a tab moves nothing. */}
          <div className="p3-panels">
            {PANELS.map((panel, index) => (
              <div
                key={index}
                id={`lec-panel-${index}`}
                role="tabpanel"
                aria-labelledby={`lec-tab-${index}`}
                aria-hidden={tab === index ? undefined : true}
                className={`p3-panel${tab === index ? ' is-on' : ''}`}
              >
                {panel}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ——— the exam ——— */

const SUBJECTS = [
  { title: 'Экономика', meta: '240 вопросов' },
  { title: 'Право', meta: '240 вопросов' },
  { title: 'Базы данных', meta: '240 вопросов' },
  { title: 'Микроэкономика', meta: '240 устных вопросов' },
];

function FileStage() {
  return (
    <div className="p3-stage p3-stage--warm p3-file">
      <div className="p3-file-in">
        <div className="p3-win p3-doc p3-l" aria-hidden="true">
          <p className="p3-doc-top">
            <i />
            Вопросы к экзамену.docx
          </p>
          <div className="p3-doc-page">
            <p className="p3-doc-h">Экономика</p>
            <p className="p3-doc-q">12. {EXAMPLE.testStem}</p>
            {EXAMPLE.testOptions.map((option, index) =>
              index === EXAMPLE.testRight ? (
                <p key={option} className="p3-doc-key">
                  <b>
                    <span className="p3-doc-mark" style={delay(620)} />
                    {'абв'[index]}) {option}
                  </b>
                </p>
              ) : (
                <p key={option}>
                  {'абв'[index]}) {option}
                </p>
              ),
            )}
            <p className="p3-doc-q">13. Что показывает коэффициент эластичности спроса?</p>
            <p>а) На сколько процентов изменится спрос при изменении цены на 1 %</p>
          </div>
        </div>
        <div className="p3-win p3-found p3-l" style={delay(160)}>
          <p className="p3-found-h">{EXAM_SECTION.file.found}</p>
          {SUBJECTS.map((subject, index) => (
            <p key={subject.title} className="p3-line p3-l" style={delay(320 + index * 70)}>
              <b>{subject.title}</b>
              <span>{subject.meta}</span>
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}

const DAYS = [
  { d: 'Пн', n: 19, a: '90', b: '60' },
  { d: 'Вт', n: 20, a: '95', b: '65' },
  { d: 'Ср', n: 21, a: '90', b: '60' },
  { d: 'Чт', n: 22, a: '95', b: '65' },
  { d: 'Пт', n: 23, a: '90', b: '60' },
  { d: 'Сб', n: 24, a: '60', b: '45' },
  { d: 'Вс', n: 25, a: '—', b: '—' },
];

function PlanStage() {
  const [moved, setMoved] = useState(false);
  const at = moved ? 1 : 0;
  return (
    <div className="p3-stage p3-stage--blue p3-plan">
      <div className="p3-win p3-cal p3-l">
        <div className="p3-cal-top">
          <p className="p3-cal-h">{PICTURES.exam}</p>
          <p className="p3-meta">
            <Swap items={PICTURES.examIn} at={at} />
          </p>
        </div>
        <span className="p3-flag p3-cal-flag p3-l" style={delay(260)}>
          <Swap items={PICTURES.examDate} at={at} />
        </span>
        <div className="p3-days">
          {DAYS.map((day, index) => (
            <span key={day.d} className={`p3-day p3-l${index === 0 ? ' is-today' : ''}${index === 6 ? ' is-off' : ''}`} style={delay(200 + index * 45)}>
              <small>
                {day.d} {day.n}
              </small>
              <b>
                <Swap items={[day.a, day.b]} at={at} />
              </b>
            </span>
          ))}
        </div>
        <p className="p3-today">
          <b>
            <Swap items={PICTURES.today} at={at} />
          </b>
          , <Swap items={PICTURES.todayTime} at={at} />
        </p>
        <button type="button" className="p3-action" onClick={() => setMoved((value) => !value)}>
          <Swap items={[EXAM_SECTION.plan.move, EXAM_SECTION.plan.back]} at={at} />
        </button>
        <span className="p3-sr" aria-live="polite">
          {moved ? PICTURES.moved : ''}
        </span>
      </div>
    </div>
  );
}

const WRONG = EXAM_SECTION.session.wrong;
const TOPICS = EXAM_SECTION.left.topics;
/** Topics of the subject not learned yet, before this visit: 18 of 24. */
const LEFT_BEFORE = 18;

function SessionStage({ seen }: { seen: boolean }) {
  const [picked, setPicked] = useState<number | null>(null);
  // The first topic closes on its own a moment after the card is seen; the second closes on the right answer.
  const [firstClosed, setFirstClosed] = useState(false);
  useEffect(() => {
    if (!seen) return undefined;
    if (prefersStill()) {
      setFirstClosed(true);
      return undefined;
    }
    const timer = window.setTimeout(() => setFirstClosed(true), 1500);
    return () => window.clearTimeout(timer);
  }, [seen]);
  const right = picked === EXAMPLE.testRight;
  const closed = [firstClosed, right, false];
  const closedCount = closed.filter(Boolean).length;
  const reply = picked === null ? 0 : right ? 1 : 2;
  const replies = [EXAM_SECTION.session.idle, EXAM_SECTION.session.right, WRONG];
  return (
    <div className="p3-stage p3-stage--green p3-sess">
      <div className="p3-sess-in">
        <div className="p3-win p3-q p3-l">
          <p className="p3-meta p3-row">
            <span>{PICTURES.question}</span>
            <span className="p3-score">
              {EXAM_SECTION.session.learned}{' '}
              <b>
                <Swap items={['146', '147']} at={right ? 1 : 0} />
              </b>{' '}
              из 960
            </span>
          </p>
          <p className="p3-stem">{EXAMPLE.testStem}</p>
          <div className="p3-opts">
            {EXAMPLE.testOptions.map((option, index) => {
              const state = picked === null ? '' : index === EXAMPLE.testRight ? ' is-right' : index === picked ? ' is-wrong' : ' is-out';
              return (
                <button key={option} type="button" className={`p3-opt p3-opt--btn${state}`} onClick={() => picked === null && setPicked(index)} aria-disabled={picked !== null}>
                  <b>{'АБВ'[index]}</b>
                  {option}
                </button>
              );
            })}
          </div>
          <div className="p3-reply">
            <Swap items={replies} at={reply} className="p3-reply-t" />
            <button
              type="button"
              className={`p3-textbtn${picked === null ? '' : ' is-on'}`}
              onClick={() => setPicked(null)}
              tabIndex={picked === null ? -1 : undefined}
              aria-hidden={picked === null ? true : undefined}
            >
              {EXAM_SECTION.session.again}
            </button>
          </div>
          <span className="p3-sr" aria-live="polite">
            {picked === null ? '' : replies[reply]}
          </span>
        </div>
        <div className="p3-win p3-left p3-l" style={delay(160)}>
          <p className="p3-left-top">
            <b>{EXAM_SECTION.left.title}</b>
            <span className="p3-meta">
              <Swap items={[0, 1, 2].map((n) => `${LEFT_BEFORE - n} тем из ${EXAM_SECTION.left.of}`)} at={closedCount} />
            </span>
          </p>
          {TOPICS.map((topic, index) => (
            <div
              key={topic.title}
              className={`p3-topic${closed[index] ? ' is-done' : ''}`}
              style={{ ...delay(320 + index * 90), '--p': topic.done / topic.of } as CSSProperties}
            >
              <p>
                <span>{topic.title}</span>
                <Swap
                  className="p3-topic-n"
                  at={closed[index] ? 1 : 0}
                  items={[
                    `ещё ${glue(topic.of - topic.done, 'вопрос', 'вопроса', 'вопросов')}`,
                    <i key="tick" className="p3-tick">
                      <svg viewBox="0 0 16 16" aria-hidden="true">
                        <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <span className="p3-sr">выучено</span>
                    </i>,
                  ]}
                />
              </p>
              <span className="p3-bar" aria-hidden="true">
                <i />
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ExamSection() {
  return (
    <section id="exam" className="h3-wrap p3-sec" aria-labelledby="exam-h">
      <SectionHead id="exam-h" title={EXAM_SECTION.title} text={EXAM_SECTION.text} />
      <div className="p3-bento">
        <Card name="file" title={EXAM_SECTION.file.title} text={EXAM_SECTION.file.text}>
          {() => <FileStage />}
        </Card>
        <Card name="plan" title={EXAM_SECTION.plan.title} text={EXAM_SECTION.plan.text}>
          {() => <PlanStage />}
        </Card>
        <Card name="sess" title={EXAM_SECTION.session.title} text={EXAM_SECTION.session.text}>
          {(seen) => <SessionStage seen={seen} />}
        </Card>
        <Card name="ticket" title={EXAM_SECTION.ticket.title} text={EXAM_SECTION.ticket.text}>
          {() => <TicketAloud />}
        </Card>
      </div>
    </section>
  );
}

export function GroupSection() {
  const stage = useRef<HTMLDivElement>(null);
  const seen = useInView(stage);
  return (
    <section className="h3-wrap p3-sec p3-split" aria-labelledby="group-h">
      <SectionHead id="group-h" title={GROUP_SECTION.title} text={GROUP_SECTION.text} />
      <div ref={stage} className="p3-stage p3-stage--pink p3-group" data-reveal={seen ? 'in' : 'wait'}>
        <div className="p3-win p3-invite p3-l">
          <p className="p3-pic-h p3-pic-h--s">{PICTURES.inviteTitle}</p>
          <p className="p3-meta">{PICTURES.inviteText}</p>
          <p className="p3-field">
            <span>…/g/k4Rm7Qx2</span>
            <b>{PICTURES.copy}</b>
          </p>
          <p className="p3-meta">{PICTURES.members}</p>
        </div>
        <div className="p3-phone p3-l" style={delay(180)} aria-hidden="true">
          <div className="p3-phone-in">
            <p className="p3-tg-top">
              <b>Meldy</b>
              <small>{PICTURES.bot}</small>
            </p>
            <span className="p3-tg-time">20:00</span>
            <p className="p3-tg-b">
              <b>{PICTURES.botToday}</b>
              <br />
              {PICTURES.botExam}
            </p>
            <span className="p3-tg-btn p3-tg-btn--blue">{PICTURES.botStart}</span>
            <span className="p3-tg-btn">{PICTURES.botOpen}</span>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ——— the game in class ——— */

/** «Провести игру»: sign up, then «Тесты», where every test has «Провести игру» (Register honours ?next=). */
export const GAME_URL = `/register?next=${encodeURIComponent('/exams?view=tests')}`;

/**
 * The game's player, its two footages and what keeps them in step, once the section is near (they come with the reel's
 * file; the projector's own dark and the phone's until then).
 */
function useGamePart(near: boolean) {
  useEffect(() => {
    if (near) void reelPart.load().catch(() => undefined);
  }, [near]);
  return useLazyPart(reelPart, near);
}

/** What the projector's picture shows, for those who do not see it. */
export const GAME_ALT = 'Игра «Встань на ответ» на проекторе. Класс бежит к ответам, потом пол под неверными ответами проваливается. Устояли 18 из 30.';

/**
 * «Игра в классе» (owner, 21.10: the real game running, not a drawing; then «в телефоне тупо картинка, нет движения
 * синхронного с экраном главным»): the recorded game on the projector, the class running to the answers and the floor
 * dropping (lib/footage STAND_RUN, a silent loop while on screen), the bot's post in the class chat with «Играть», and
 * one student's phone in the same game: the real phone page drawn from the same recording (STAND_RUN_PHONE), his run to
 * «А Меркурий», «Вы на ответе», the stomp and «Верно +980». The projector's video leads and the phone's follows its time
 * (lib/footageSync: it starts, stops and loops with it, and a gap of a frame is closed as it opens); with reduced motion
 * both posters, of one moment. Nothing moves on a press, and its one link is the only thing to press. The player comes
 * with the reel's file (fetched after the page has loaded, or as the section comes near), then the posters and the parts
 * as the section comes near: the page's first load carries none of it.
 */
export function GameSection() {
  const stage = useRef<HTMLDivElement>(null);
  const seen = useInView(stage);
  const near = useInView(stage, { margin: '900px 0px' });
  const part = useGamePart(near);
  const [lead, setLead] = useState<HTMLVideoElement | null>(null);
  const [phone, setPhone] = useState<HTMLVideoElement | null>(null);
  useEffect(() => (part && lead && phone ? part.follow(lead, phone, part.footage.duration) : undefined), [part, lead, phone]);
  return (
    <section id="game" className="h3-wrap p3-sec p3-split" aria-labelledby="game-h">
      <SectionHead id="game-h" title={GAME_SECTION.title} text={GAME_SECTION.text}>
        <div className="p3-ctas p3-game-acts">
          <a className="h3-pill h3-pill--blue" href={GAME_URL}>
            {CTA.game}
            <i>
              <ArrowIcon />
            </i>
          </a>
        </div>
      </SectionHead>
      <div ref={stage} className="p3-stage p3-stage--violet p3-game-stage" data-reveal={seen ? 'in' : 'wait'}>
        <div className="p3-proj p3-l" role="img" aria-label={GAME_ALT}>
          {part ? <part.Footage ref={setLead} footage={part.footage} fit="cover" /> : null}
        </div>
        <div className="p3-gpost p3-l" style={delay(160)} aria-hidden="true">
          <p className="p3-tg-top">
            <b>{GAME.chat}</b>
            <small>{GAME.chatMeta}</small>
          </p>
          <div className="p3-gpost-in">
            <p className="p3-tg-b">
              <span className="p3-gpost-from">{GAME.bot}</span>
              <b>{GAME.mode}</b>
              {GAME.post.map((line) => (
                <span key={line}>{line}</span>
              ))}
            </p>
            <span className="p3-tg-btn p3-tg-btn--blue">{GAME.play}</span>
          </div>
        </div>
        <div className="p3-gphone p3-l" style={delay(300)} aria-hidden="true">
          <div className="p3-gphone-in">{part ? <part.Footage ref={setPhone} footage={part.phone} play={false} fit="cover" /> : null}</div>
        </div>
      </div>
    </section>
  );
}
