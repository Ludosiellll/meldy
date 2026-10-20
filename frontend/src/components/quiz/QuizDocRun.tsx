import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import type { QuizAttempt } from '../../types/quiz';
import type { TestDoc } from '../../types/testDoc';
import { themeTokens } from '../../lib/studio/contrast';
import { quizOrder } from '../../lib/quizzes/quizModel';
import { asDocItem, attemptAnswer, attemptDoc, docAnswer } from '../../lib/quizzes/design';
import { AttemptPictures } from '../containers/ItemPictures';
import { Sheet } from '../containers/ui';
import DocView from '../studio/DocView';
import { answered, missingRequired, runPlan, type Answer, type Answers } from '../studio/docRun';
import { RUN } from './copyTake';
import { FinishSheet, RunBar, RunEnding, TimeStrip, where, whereShort } from './RunParts';
import { resumeIndex, type AttemptRun } from './useAttempt';
import type { GuardView } from './useGuard';
import '../containers/room.css';
import './quizTake.css';

/**
 * An attempt of a quiz «как в студии» (release 47.2; plan docs/superpowers/plans/2026-10-18-studio.md «Participant»):
 * the studio's page (DocView, mode «take») in its own theme, with the attempt's questions and QuizRun's machinery
 * (useAttempt: saving, the clock, the network, guests by token, pictures through AttemptPictures).
 *
 * - The page is the attempt's (lib/quizzes/design.ts attemptDoc): the start screen's cover is not repeated, a question
 *   block whose row the attempt does not hold is left out, a question of the attempt the page no longer has comes at
 *   the end. The options stand in the attempt's order (quizOrder), as in the review.
 * - «По одному»: a screen a question, with the blocks before it; the top line «2 из 6». «Одна страница»: every block,
 *   «Завершить» at the end; the top line «Отвечено 2 из 6». «По страницам»: «Дальше / Назад» between the pages; the top
 *   line «Страница 1 из 3».
 * - A required question: «Завершить» (at the end or in the top line) names those without an answer, marks them, takes
 *   the window to the first, and asks nothing more until they have one; then «Завершить контрольную?» as always. «Дальше»
 *   asks for the page's required ones too on «По страницам», and on any layout when going back is not allowed (they
 *   could not be answered later). The clock at 0:00 sends what there is.
 * - «Все вопросы» (when going back is allowed, or on one page): a cell a question, marked when it has an answer; a press
 *   goes to its page and brings it into view.
 * - The page's theme (lib/studio/contrast.ts themeTokens: the accent already nudged for contrast, the font, the
 *   corners, the density, answers as a list or tiles, the buttons) on the page and on the sheets, which open outside it.
 */

export interface QuizDocRunProps {
  run: AttemptRun;
  attempt: QuizAttempt;
  token: string | null;
  doc: TestDoc;
  dark: boolean;
  /** «Защита от списывания» (QuizRun): told the first question on screen; its line goes over the page. */
  guard?: GuardView;
  guardLine?: ReactNode;
}

export default function QuizDocRun({ run, attempt, token, doc, dark, guard, guardLine = null }: QuizDocRunProps) {
  const id = attempt.attempt_id;
  const items = useMemo(() => new Map(attempt.items.map((item) => [item.id, asDocItem(item)])), [attempt.items]);
  const kinds = useMemo(() => new Map(attempt.items.map((item) => [item.id, item.kind])), [attempt.items]);
  const orders = useMemo(() => new Map(attempt.items.map((item) => [item.id, quizOrder(item, id, attempt.shuffle_options)])), [attempt.items, id, attempt.shuffle_options]);
  const page = useMemo(() => attemptDoc(doc, attempt.items), [doc, attempt.items]);
  const plan = useMemo(() => runPlan(page, items), [page, items]);
  const tokens = useMemo(() => themeTokens(page.theme, dark) as CSSProperties, [page.theme, dark]);
  const layout = page.layout;
  const steps = plan.steps;
  const questions = plan.questions;
  const total = questions.length;
  const back = attempt.allow_back;

  const [at, setAt] = useState(() => {
    if (layout === 'one_page' || questions.length === 0) return 0;
    const ids = questions.map((question) => question.itemId);
    // Only forward on pages: the page of the last answer (its other questions may still wait for one).
    if (layout === 'pages' && !back) {
      let last = -1;
      ids.forEach((itemId, index) => {
        if (answered(docAnswer(run.startAnswers[itemId]))) last = index;
      });
      return last >= 0 ? questions[last].step : 0;
    }
    return questions[resumeIndex(ids, run.startAnswers, back)]?.step ?? 0;
  });
  const [missing, setMissing] = useState<number[]>([]);
  const [jump, setJump] = useState<{ blockId: string; key: number } | null>(null);
  const [finishOpen, setFinishOpen] = useState(false);
  const [allOpen, setAllOpen] = useState(false);
  // «Попытка продолжается» is about where the attempt went on from: gone with the first answer or the first move.
  const [moved, setMoved] = useState(false);

  // The end began (sent, or the clock): the sheets close; «Вернуться к вопросам» does not bring them back.
  useEffect(() => {
    if (!run.ending) return;
    setFinishOpen(false);
    setAllOpen(false);
  }, [run.ending]);

  const answers: Answers = useMemo(() => {
    const out: Record<string, Answer | undefined> = {};
    for (const [itemId, value] of Object.entries(run.answers)) out[itemId] = docAnswer(value);
    return out;
  }, [run.answers]);
  const answeredCount = questions.filter((question) => answered(answers[question.itemId])).length;
  const place = Math.min(at, steps.length - 1);
  // The first question of the screen goes with each event of the guard (none on «Одна страница»).
  const firstHere = layout === 'one_page' ? null : questions.find((question) => question.step === place)?.number ?? null;
  const guardQ = guard?.qRef;
  useEffect(() => {
    if (guardQ) guardQ.current = firstHere;
  }, [guardQ, firstHere]);

  const placeWords = layout === 'one_page' ? RUN.answeredOf(answeredCount, total) : layout === 'pages' ? RUN.pageOf(place + 1, steps.length) : RUN.place(place + 1, steps.length);
  const stepLabel = layout === 'one_page' ? page.title : layout === 'pages' ? RUN.pageOf(place + 1, steps.length) : RUN.questionOf(place + 1, steps.length);

  if (run.ending) return <RunEnding run={run} place={placeWords} />;

  const goTo = (step: number, blockId: string | null = null) => {
    setMissing([]);
    setMoved(true);
    setAt(Math.max(0, Math.min(step, steps.length - 1)));
    setJump(blockId ? { blockId, key: Date.now() } : null);
  };

  const onAnswer = (itemId: string, answer: Answer) => {
    run.update(itemId, attemptAnswer(answer, kinds.get(itemId) ?? 'single'));
    if (missing.length > 0 && answered(answer)) {
      const number = questions.find((question) => question.itemId === itemId)?.number;
      if (number !== undefined && missing.includes(number)) setMissing(missing.filter((n) => n !== number));
    }
  };

  const next = () => {
    // A page's required questions before the next one: on «По страницам», and wherever there is no coming back.
    if (layout === 'pages' || !back) {
      const gaps = missingRequired(steps[place].blocks, answers, plan.numbers);
      if (gaps.length > 0) {
        setMissing(gaps);
        const first = questions.find((question) => question.number === gaps[0]);
        setJump(first ? { blockId: first.blockId, key: Date.now() } : null);
        return;
      }
    }
    goTo(place + 1);
  };

  /** «Завершить»: the required questions without an answer first (named, marked, the first in view), then the sheet. */
  const askFinish = () => {
    const gaps = questions.filter((question) => question.required && !answered(answers[question.itemId]));
    if (gaps.length === 0) {
      setMissing([]);
      setFinishOpen(true);
      return;
    }
    // Only forward: never back to a page already left (there is none with a gap: «Дальше» asked for them).
    const first = gaps.find((question) => back || question.step >= place) ?? null;
    if (first) {
      setAt(first.step);
      setJump({ blockId: first.blockId, key: Date.now() });
    }
    setMissing(gaps.map((question) => question.number));
  };

  const unanswered = questions.filter((question) => !answered(answers[question.itemId])).map((question) => question.number);
  // The colour by name too, for the rules that go by it (graphite's dark arrow on its light pill in the dark theme).
  const sheetClass = `qt-accent qt-design${typeof page.theme.accent === 'string' ? ` qt-accent-${page.theme.accent}` : ''}`;
  const canList = back || layout === 'one_page';
  const currentIds = new Set(steps[place]?.blocks.map((block) => block.id) ?? []);

  const top = (
    <>
      <p className="qt-low" role="status">
        {run.lowNote}
      </p>
      {guardLine}
      {run.resumed && !moved ? <p className="qt-dv-line">{RUN.resumedAt(placeWords, run.timeText)}</p> : null}
    </>
  );
  const under = (
    <div className="qt-dv-under">
      {canList ? (
        <button type="button" className="dv-quiet qt-dv-all" aria-haspopup="dialog" onClick={() => setAllOpen(true)}>
          {RUN.all}
        </button>
      ) : (
        <p className="qt-dv-note">{RUN.forwardOnly}</p>
      )}
      <p className="qt-saved" role="status" data-tone={run.status}>
        {run.statusText}
      </p>
    </div>
  );

  return (
    <AttemptPictures attemptId={id} token={token}>
      <RunBar
        where={where(placeWords, run.timeText, run.stage)}
        short={layout === 'one_by_one' ? undefined : whereShort(placeWords, run.timeText, run.stage)}
        onExit={askFinish}
      >
        <TimeStrip run={run} />
      </RunBar>
      <main className="qt-docmain">
        <DocView
          mode="take"
          className="qt-docrun"
          doc={page}
          items={items}
          dark={dark}
          answers={answers}
          onAnswer={onAnswer}
          orders={orders}
          at={place}
          missing={missing}
          canBack={back}
          onBack={() => goTo(place - 1)}
          onNext={next}
          onFinish={askFinish}
          top={top}
          under={under}
          stepLabel={stepLabel}
          jump={jump}
        />
      </main>
      {allOpen && canList ? (
        <Sheet title={RUN.all} onClose={() => setAllOpen(false)} className={sheetClass} style={tokens}>
          <ul className="ct-cells">
            {questions.map((question) => {
              const has = answered(answers[question.itemId]);
              return (
                <li key={question.blockId}>
                  <button
                    type="button"
                    data-answered={has ? '' : undefined}
                    aria-current={currentIds.has(question.blockId) ? 'true' : undefined}
                    aria-label={RUN.cell(question.number, has)}
                    onClick={() => {
                      setAllOpen(false);
                      // A screen a question: its screen from the top (the blocks before it lead to it).
                      goTo(question.step, layout === 'one_by_one' ? null : question.blockId);
                    }}
                  >
                    {question.number}
                  </button>
                </li>
              );
            })}
          </ul>
        </Sheet>
      ) : null}
      {finishOpen ? (
        <FinishSheet
          line={RUN.finishLine(answeredCount, total, unanswered)}
          className={sheetClass}
          style={tokens}
          onFinish={() => run.end('sent')}
          onClose={() => setFinishOpen(false)}
        />
      ) : null}
    </AttemptPictures>
  );
}
