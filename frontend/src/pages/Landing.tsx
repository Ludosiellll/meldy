import { useEffect, useMemo, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import '@fontsource-variable/onest/wght.css';
import { useAuth } from '../hooks/useAuth';
import HeroSheet, { SHEET_REPLAY_EVENT } from '../components/home/HeroSheet';
import HomeExam from '../components/home/HomeExam';
import { jumpToReel, type ReelChapter } from '../components/home/reelJump';
import { usePrefersReducedMotion } from '../components/landing/usePrefersReducedMotion';
import { ty } from '../components/landing/typo';
import { freePlanLine } from '../components/landing/freePlan';
import { lazyPart, useLazyPart } from '../lib/lazyPart';
import { IMPORT_WORDS, INVITE_WORDS, PLAN_LABEL, SUBJECTS, exampleWords, importRow, localToday } from '../data/containerExample';
import { Q4, SHEET_BEFORE } from '../data/sheetExample';
import { RULE_LINE } from '../lib/containers/words';
import { TOTAL, plural } from '../components/reel/timeline';
import '../components/home/home.css';
import { TELEMETRY_NOTE } from '../lib/telemetry';

/**
 * The reel is a file of its own, fetched once the page is up. Until it arrives its place holds the
 * same empty frame; the page does not wait for it (a Suspense boundary here held the whole first
 * screen back while the reel was still on its way).
 */
const meldyReelPart = lazyPart(() => import('../components/reel/MeldyReel').then((module) => module.default));

/**
 * One face on every entry (notes: 10_Project/CodingFest_11_Improvement_Plan_2026-10-07): the same
 * promise as the page title, the link preview, the manifest and the README — «Meldy — тренажёр
 * экзамена по вопросам кафедры. ИИ не отвечает за студента — он его спрашивает».
 */
export const EYEBROW = 'Тренажёр экзамена по вопросам кафедры';
export const HEADLINE = 'ИИ не отвечает за вас — он вас спрашивает';
/**
 * The exam as it is now (decision 2026-10-09, the universal exam): one file or one per subject, a plan by days to the
 * exam, the oral questions asked aloud against the student's own lectures.
 */
export const LEAD =
  'Загрузите вопросы к экзамену — один файл или по файлу на предмет. Meldy разложит их по дням до экзамена, а устные спросит вслух и сверит с вашими лекциями.';
/** The first action of the page: the example exam (/try), no account needed. */
export const TRY_LABEL = 'Попробовать на примере';
/** Sign-up, to start with one's own list of questions; the final call repeats it. */
export const START_LABEL = 'Начать со своего списка';
/** Sign-up where space is short: the top bar (decision 5 of 2026-10-08: one action, two names at most). */
export const SIGN_UP_SHORT = 'Создать аккаунт';
/** The honest result (Ф1): Meldy gives no mark, in the words of the answer's protocol. */
export const RESULT_TITLE = 'Отметку ставит преподаватель';
export const RESULT_NOTE = 'Meldy проверяет только, назвали ли вы пункты из своих лекций.';
/**
 * The sample answer's result, in the words of the protocol (decision 2 of 2026-10-08): three main points named
 * unasked, one more after the examiner's question. On the sheet the three named lines changed (one erased, two
 * rubbed); the one named only after the question did not.
 */
export const RESULT_SAMPLE = 'Сами назвали 3 из 4 главных пунктов, ещё 1 — после вопроса экзаменатора';

/** «Как это работает», in the order of the work: the file, the plan by days, the answer aloud, the sheet. */
export const STEPS: ReadonlyArray<{ flag: string; title: string; text: string; panel: 'blue' | 'warm' | 'sky' | 'rose'; color: 'sky' | 'yellow' | 'green' | 'pink' }> = [
  {
    flag: 'Вопросы',
    title: 'Вопросы — из файла кафедры',
    text: 'Один общий файл или по файлу на предмет: Word, Excel или TXT, а PDF и сканы — для списков без вариантов. Ключ к вопросам с вариантами Meldy возьмёт из оформления файла.',
    panel: 'blue',
    color: 'sky',
  },
  {
    flag: 'План по дням',
    title: 'Каждый день — занятие по плану',
    text: 'Новые вопросы и знакомые — на столько минут в день, сколько вы выбрали. Ошибка вернётся на следующий день занятий, а в последние дни перед экзаменом новых нет — только знакомые.',
    panel: 'warm',
    color: 'yellow',
  },
  {
    flag: 'Ответ вслух',
    title: 'Устные — вслух, по вашим лекциям',
    text: 'Тяните билет и отвечайте голосом или текстом — готовый текст не вставить. Meldy сверит ответ с пунктами из ваших лекций, а экзаменатор переспросит о том, что вы пропустили.',
    panel: 'sky',
    color: 'green',
  },
  {
    flag: 'Шпаргалка',
    title: 'Строки стирают только ответы в разные дни',
    text: 'Под каждым устным вопросом — пункты ответа из ваших лекций. Кнопки «знаю» нет: назвали пункт — строка стёрлась наполовину, назвали снова в другой день — совсем, не назвали потом — вернулась.',
    panel: 'rose',
    color: 'pink',
  },
];

/** Questions from sample courses; the tone gives each number a colour. */
const QUESTIONS: Array<{ n: number; text: string; tone?: 'y' | 'g' | 'p' }> = [
  { n: 1, text: 'Что такое нейронная сеть и из каких слоёв она состоит?' },
  { n: 12, text: 'Как обучается нейронная сеть?', tone: 'y' },
  { n: 21, text: 'Денежный рынок и его инструменты', tone: 'g' },
  { n: 25, text: 'Денежный мультипликатор', tone: 'p' },
  { n: 31, text: 'Ключевая ставка ЦБ и её влияние на инфляцию' },
  { n: 34, text: 'Инфляция: виды и причины', tone: 'y' },
  { n: 36, text: 'Кривая Филлипса', tone: 'g' },
  { n: 9, text: 'Переобучение и способы борьбы с ним', tone: 'p' },
];

/** The method in three cards: the counting rule of the exam's «Как считается» (copy.ts howCounted). */
export const METHOD = [
  {
    k: 'Сначала вопрос',
    big: 'Каждая попытка вспомнить закрепляет ответ',
    p: 'Даже неудачная — если потом свериться с ответом. Психологи называют это эффектом тестирования.',
  },
  {
    k: 'Потом — реже',
    big: 'Вопрос в счёте возвращается всё реже',
    p: 'Вопросы в счёте возвращаются через 5, 12, 25 и 50 дней, а в последние дни перед экзаменом — все.',
  },
  {
    k: 'Разные дни',
    big: 'Одного удачного ответа мало',
    p: 'Поэтому в счёт идёт вопрос, на который вы ответили верно в два разных дня — между ответами не меньше 20 часов.',
  },
];

/** The heading of the exam's section, and the words under it: the plan's own lines for the example. */
export const EXAM_TITLE_H = 'Сотни вопросов — один план';

function Arrow() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function Pill({ tone, small, onClick, children }: { tone: 'blue' | 'white' | 'ghost'; small?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className={`hm-pill hm-pill--${tone}${small ? ' hm-pill--sm' : ''}`} onClick={onClick}>
      {children}
      {small ? null : (
        <span className="hm-dot">
          <Arrow />
        </span>
      )}
    </button>
  );
}

/** The yellow hand-drawn line under a phrase. */
function Mark({ children, path = 'M4 15 C 80 7, 170 5, 250 9 S 360 16, 396 8' }: { children: ReactNode; path?: string }) {
  return (
    <span className="hm-mark">
      {children}
      <svg viewBox="0 0 400 24" preserveAspectRatio="none" aria-hidden="true">
        <path pathLength={1} d={path} />
      </svg>
    </span>
  );
}

export default function Landing() {
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    if (user) navigate('/dashboard');
  }, [user, navigate]);

  return (
    <div className="hm">
      <Navbar />
      <main>
        <Hero />
        <HowSection />
        <ExamSection />
        <ResultAndGroup />
        <Ticker />
        <MethodSection />
        <FinalCall />
      </main>
      <Footer />
    </div>
  );
}

function Navbar() {
  const navigate = useNavigate();
  return (
    <header className="hm-nav">
      <nav className="hm-wrap hm-nav-in" aria-label="Главное меню">
        <button type="button" className="hm-logo" onClick={() => navigate('/')}>
          Meldy
        </button>
        <div className="hm-links">
          <a href="#how">Как это работает</a>
          <a href="#reel">Ролик</a>
          <a href="#method">Подход</a>
        </div>
        <div className="hm-end">
          <Pill tone="white" small onClick={() => navigate('/login')}>
            Войти
          </Pill>
          <Pill tone="blue" small onClick={() => navigate('/register')}>
            {SIGN_UP_SHORT}
          </Pill>
        </div>
      </nav>
    </header>
  );
}

function Hero() {
  const navigate = useNavigate();
  // The hand-drawn line goes under «спрашивает»; ty() keeps a short word off a line's end («за | вас»).
  const [before, after] = HEADLINE.split('спрашивает');
  return (
    <section className="hm-wrap hm-hero" aria-labelledby="hm-hero-h">
      <div className="hm-hero-text">
        <p className="hm-eyebrow hm-rise">{ty(EYEBROW)}</p>
        <h1 id="hm-hero-h" className="hm-h1 hm-rise hm-d1">
          {ty(before)}
          <Mark path="M4 14 C 90 6, 190 6, 280 10 S 370 15, 396 9">спрашивает</Mark>
          {after}
        </h1>
        <p className="hm-lead hm-rise hm-d2">{ty(LEAD)}</p>
        <div className="hm-acts hm-rise hm-d3">
          {/* A ready example exam, no account needed (/try): the jury's QR code leads there too. */}
          <Pill tone="blue" onClick={() => navigate('/try')}>
            {TRY_LABEL}
          </Pill>
          <Pill tone="white" onClick={() => navigate('/register')}>
            {START_LABEL}
          </Pill>
        </div>
        <p className="hm-also hm-rise hm-d3">
          {'Пример открывается без регистрации. '}
          <span className="hm-free">{freePlanLine()}</span>
        </p>
      </div>
      {/* The video is the first thing after the text, on every screen (the owner, 2026-10-08). */}
      <div className="hm-hero-reel hm-rise hm-d2">
        <ReelSection />
      </div>
      {/* On a phone the line about the free account comes after the video, which stays whole on the first screen. */}
      <p className="hm-free-m">{freePlanLine()}</p>
    </section>
  );
}

function More({ chapter, children }: { chapter: ReelChapter; children?: ReactNode }) {
  const reduce = usePrefersReducedMotion();
  return (
    <button type="button" className="hm-more" onClick={() => jumpToReel(chapter, !reduce)}>
      {children ?? 'Смотреть в ролике'}
      <Arrow />
    </button>
  );
}

const LOOKS = { fresh: 'left', returned: 'left', missed: 'left', rubbed: 'once', erased: 'gone' } as const;

/** The pictures of the four steps: things of the app, always light (they are pictures of it). */
function StepArt({ index }: { index: number }) {
  const days = useMemo(() => exampleWords(localToday()).days, []);
  switch (index) {
    case 0:
      return (
        <div className="hm-doc">
          <p className="hm-doc-h">{IMPORT_WORDS.found}</p>
          {SUBJECTS.map((subject) => (
            <p key={subject.title} className="hm-doc-r">
              <b>{subject.title}</b>
              <span>{importRow(subject)}</span>
            </p>
          ))}
        </div>
      );
    case 1:
      return (
        <div className="hm-days">
          <p className="hm-days-h">{PLAN_LABEL}</p>
          {days.map((row) => (
            <p key={row} className="hm-days-r">
              {row}
            </p>
          ))}
        </div>
      );
    case 2:
      return (
        <>
          <div className="hm-ticket">
            <b>Билет</b>
            <p>7. Эластичность спроса и выручка продавца.</p>
          </div>
          <div className="hm-ask">
            <b>Экзаменатор</b>А если спрос неэластичный, как продавцу увеличить выручку?
          </div>
          <div className="hm-mic">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
            </svg>
          </div>
        </>
      );
    default: {
      // Question 4 of the example as the sheet has it: one line erased, one named once, one still there; under it
      // the map of the whole sheet.
      const states = SHEET_BEFORE.find((question) => question.number === 4)!.states;
      return (
        <div className="hm-mini">
          {[1, 2, 3].map((at) => (
            <p key={at} className="hm-mini-l" data-look={LOOKS[states[at]]}>
              <i />
              <span>{Q4.lines[at].text}</span>
            </p>
          ))}
          <span className="hm-mini-map">
            {SHEET_BEFORE.flatMap((question) => question.states).map((state, at) => (
              <i key={at} data-look={LOOKS[state]} />
            ))}
          </span>
        </div>
      );
    }
  }
}

/** To the exam's section, and the answer plays on its sheet again. */
function ShowOnSheet() {
  const reduce = usePrefersReducedMotion();
  const show = () => {
    document.querySelector('.hs')?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
    window.dispatchEvent(new CustomEvent(SHEET_REPLAY_EVENT));
  };
  return (
    <button type="button" className="hm-more" onClick={show}>
      Показать на шпаргалке
      <Arrow />
    </button>
  );
}

function HowSection() {
  return (
    <section id="how" className="hm-wrap hm-sec" aria-labelledby="how-h">
      <h2 id="how-h" className="hm-h2 hm-reveal">
        Как это работает
      </h2>
      <p className="hm-sub hm-reveal">{ty('Тестовые и устные вопросы — в одном экзамене, с одним планом на каждый день.')}</p>
      <ol className="hm-steps">
        {STEPS.map((step, index) => (
          <li key={step.flag} className="hm-step hm-reveal">
            <div className={`hm-panel hm-panel--${step.panel}`} aria-hidden="true">
              <div className="hm-dots" />
              <StepArt index={index} />
            </div>
            <div className="hm-card-body">
              <span className={`hm-flag hm-flag--${step.color}`}>
                <b>{index + 1}</b>
                {step.flag}
              </span>
              <h3 className="hm-h3">{ty(step.title)}</h3>
              <p className="hm-p">{ty(step.text)}</p>
              {/* Each step opens its chapter of the reel «Meldy за 48 секунд»; the answer aloud is chapter 04 with the sheet. */}
              {index === 0 && <More chapter="questions" />}
              {index === 1 && <More chapter="plan" />}
              {index === 2 && <More chapter="sheet" />}
              {index === 3 && <ShowOnSheet />}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * The exam as it is now, after «Как это работает» (decision 2026-10-09): one exam for the whole preparation — the
 * example's page with today's step, the figure and its subjects — and, as one part of it, the oral subject's cheat
 * sheet in Meldy's own look (decision 2026-10-10), where one answer plays. It replaces the section of the paper sheet.
 */
function ExamSection() {
  const navigate = useNavigate();
  const need = useMemo(() => exampleWords(localToday()).need, []);
  return (
    <section id="exam" className="hm-wrap hm-sec" aria-labelledby="exam-h">
      <h2 id="exam-h" className="hm-h2 hm-reveal">
        {ty(EXAM_TITLE_H)}
      </h2>
      <p className="hm-sub hm-reveal">{ty(`${need} ${RULE_LINE}`)}</p>
      <div className="hm-exam">
        <div className="hm-exam-page hm-reveal">
          <HomeExam />
        </div>
        <div className="hm-exam-sheet">
          <HeroSheet />
        </div>
      </div>
      <div className="hm-exam-acts hm-reveal">
        <Pill tone="white" onClick={() => navigate('/try')}>
          {TRY_LABEL}
        </Pill>
      </div>
    </section>
  );
}

/** The honest result and the group link: two things a newcomer asks about next. */
function ResultAndGroup() {
  return (
    <section className="hm-wrap hm-duo" aria-label="Итог и группа">
      <article className="hm-card hm-reveal" aria-labelledby="result-h">
        <div className="hm-panel hm-panel--green" aria-hidden="true">
          <div className="hm-dots" />
          <div className="hm-proto">
            <span className="hm-proto-tag">Пример</span>
            <p className="hm-proto-l">{RESULT_SAMPLE}</p>
            <p className="hm-proto-s">На шпаргалке: 1 строка стёрлась, 2 — наполовину</p>
          </div>
        </div>
        <div className="hm-card-body">
          <span className="hm-flag hm-flag--green">Итог ответа</span>
          <h2 id="result-h" className="hm-h3">
            {RESULT_TITLE}
          </h2>
          <p className="hm-p">{ty(`${RESULT_NOTE} Итог ответа — сколько главных пунктов вы назвали сами и сколько после вопроса экзаменатора.`)}</p>
        </div>
      </article>
      <article className="hm-card hm-reveal" aria-labelledby="group-h">
        <div className="hm-panel hm-panel--blue" aria-hidden="true">
          <div className="hm-dots" />
          <div className="hm-chat">
            <p>{INVITE_WORDS.lead}</p>
            <span className="hm-chat-link">…/g/…</span>
          </div>
        </div>
        <div className="hm-card-body">
          <span className="hm-flag hm-flag--sky">Группа</span>
          <h2 id="group-h" className="hm-h3">
            Одна ссылка на всю группу
          </h2>
          <p className="hm-p">
            {ty(
              'Соберите экзамен один раз и отправьте ссылку в беседу группы: каждый получит весь экзамен. Ответы и прогресс у каждого свои — их не видит никто. А план на день может приходить в Telegram.',
            )}
          </p>
        </div>
      </article>
    </section>
  );
}

/** The reel's heading: its own length in whole seconds, «Meldy за 48 секунд». */
export const REEL_HEADING = `Meldy за ${Math.round(TOTAL / 1000)} ${plural(Math.round(TOTAL / 1000), ['секунду', 'секунды', 'секунд'])}`;

/**
 * «Meldy за 48 секунд»: the motion reel (loaded after the first screen); the number is the reel's own length. Its
 * heading row is read by screen readers and named by the «Ролик» link, but not drawn (home.css), so the video starts
 * right under the buttons. Its end card opens the example, as the hero's first button does.
 */
function ReelSection() {
  const navigate = useNavigate();
  const MeldyReel = useLazyPart(meldyReelPart, true, {
    onError: (error) => console.error('Ролик не загрузился:', error),
  });
  return (
    <section id="reel" className="hm-wrap hm-sec" aria-labelledby="reel-heading">
      <div className="hm-reel-head">
        <h2 id="reel-heading" className="hm-h2">
          {REEL_HEADING}
        </h2>
        <p className="hm-sub">{ty('От списка вопросов до пустой шпаргалки. Ролик без звука — главы можно листать.')}</p>
      </div>
      {MeldyReel ? <MeldyReel onCta={() => navigate('/try')} /> : <div className="hm-reel-wait" aria-hidden="true" />}
    </section>
  );
}

function Ticker() {
  const reduce = usePrefersReducedMotion();
  // The track holds the list twice so the loop is seamless; the copy is hidden from readers.
  const items = reduce ? QUESTIONS : [...QUESTIONS, ...QUESTIONS];
  return (
    <section className="hm-ticker" aria-label="Примеры вопросов">
      <p className="hm-ticker-cap">Вопросы, с которых начинается сессия</p>
      <div className="hm-marquee">
        <ul className="hm-track">
          {items.map((question, index) => (
            <li key={index} className={`hm-q${question.tone ? ` hm-q--${question.tone}` : ''}`} aria-hidden={index >= QUESTIONS.length ? true : undefined}>
              <i>{question.n}</i>
              {question.text}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function MethodSection() {
  return (
    <section id="method" className="hm-wrap hm-sec" aria-labelledby="method-heading">
      <h2 id="method-heading" className="hm-h2 hm-reveal">
        <Mark path="M4 14 C 90 6, 190 6, 280 10 S 370 15, 396 9">Вспоминать</Mark> полезнее,{' '}
        <br />
        чем перечитывать
      </h2>
      <div className="hm-grid3">
        {METHOD.map((item) => (
          <div key={item.k} className="hm-tint hm-reveal">
            <span className="hm-tint-k">{item.k}</span>
            <p className="hm-tint-big">{ty(item.big)}</p>
            <p className="hm-p">{ty(item.p)}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/** The final call's words: what to start with, and the example first for those who want to look. */
export const FINAL_LEAD = 'Один общий файл или по файлу на предмет — Word, Excel или TXT. Лекции нужны для устных вопросов. Хотите сначала посмотреть — откройте готовый пример, без регистрации.';

function FinalCall() {
  const navigate = useNavigate();
  return (
    <section id="start" className="hm-wrap" aria-labelledby="final-heading">
      <div className="hm-final hm-reveal">
        <svg className="hm-final-art" viewBox="0 0 520 520" aria-hidden="true">
          <defs>
            <pattern id="hm-f-dw" width="9" height="9" patternUnits="userSpaceOnUse">
              <circle cx="4.5" cy="4.5" r="2" fill="#A9C8F7" />
            </pattern>
            <radialGradient id="hm-f-g" cx="0.5" cy="0.5" r="0.5">
              <stop offset="0" stopColor="#FFFFFF" />
              <stop offset="1" stopColor="#000000" />
            </radialGradient>
            <mask id="hm-f-m">
              <rect width="520" height="520" fill="url(#hm-f-g)" />
            </mask>
          </defs>
          <circle cx="260" cy="260" r="250" fill="url(#hm-f-dw)" mask="url(#hm-f-m)" opacity="0.7" />
          <g className="hm-final-dots">
            <circle cx="330" cy="200" r="70" fill="#F4C45B" />
            <circle cx="210" cy="330" r="46" fill="#F3A9C4" />
            <circle cx="380" cy="350" r="26" fill="#FFFFFF" opacity="0.9" />
          </g>
        </svg>
        <h2 id="final-heading" className="hm-h2">
          {ty('Начните со списка вопросов')}
        </h2>
        <p className="hm-lead">{ty(FINAL_LEAD)}</p>
        <div className="hm-acts">
          <Pill tone="white" onClick={() => navigate('/register')}>
            {START_LABEL}
          </Pill>
          <Pill tone="ghost" onClick={() => navigate('/try')}>
            {TRY_LABEL}
          </Pill>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="hm-wrap hm-foot">
      <a className="hm-logo" href="#" aria-label="Meldy, наверх">
        Meldy
      </a>
      <span>Тренажёр экзамена по вопросам кафедры · © {new Date().getFullYear()}</span>
      <a href="#">Наверх</a>
      <p className="hm-foot-note">{ty(TELEMETRY_NOTE)}</p>
    </footer>
  );
}
