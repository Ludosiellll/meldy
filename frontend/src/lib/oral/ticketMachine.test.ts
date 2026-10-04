import { describe, expect, it } from 'vitest';
import {
  ALL_COVERED_LINE,
  THANKS_LINE,
  answerTime,
  closingLine,
  hasUnsavedAnswer,
  initialTicketState,
  protocolState,
  ticketReducer,
  type TicketAction,
  type TicketState,
} from './ticketMachine';
import { demoRubricResponse } from './testing/fixtures';
import { elapsedLabel } from './format';
import type { TicketQuestion } from './ticketData';

const question: TicketQuestion = {
  id: 'q1',
  exam_id: 'e1',
  position: 7,
  label: '7',
  text: 'Как обучается нейронная сеть?',
  question_hash: 'c'.repeat(32),
  coverage: 'full',
  evidence: [],
  nearest: [],
};

function run(actions: TicketAction[], from: TicketState = initialTicketState()): TicketState {
  return actions.reduce(ticketReducer, from);
}

const loaded = (): TicketState =>
  run([{ type: 'loaded', exam: { id: 'e1', title: 'Нейросети', kind: 'exam', layout: { mode: 'random', tickets: [] } }, questions: [question, { ...question, id: 'q2' }] }]);

function answering(): TicketState {
  const state = loaded();
  return run(
    [
      { type: 'rubric', run: state.run, rubric: { status: 'ready', response: demoRubricResponse() } },
      { type: 'start', mode: 'text', now: 1_000 },
      { type: 'typed', text: 'подбор весов' },
    ],
    state,
  );
}

describe('the answer clock', () => {
  it('saves the same whole seconds the timer shows, and both stop at «Готово»', () => {
    // 1.9 s of answering: the top line shows 0:01, so the sheet and the saved attempt say 1 s too.
    let state = answering();
    state = run([{ type: 'finalize', attemptId: 'a', snapshot: 'подбор весов', live: [], input: 'text', now: 2_900, startedAt: 't' }], state);
    expect(answerTime(state, 2_900)).toBe(1_900);
    expect(state.attempt?.durationSeconds).toBe(Math.floor(answerTime(state, 2_900) / 1000));
    expect(state.attempt?.durationSeconds).toBe(1);
    expect(elapsedLabel(answerTime(state, 9_000))).toBe('0:01');
    expect(elapsedLabel((state.attempt?.durationSeconds ?? 0) * 1000)).toBe('0:01');
  });
});

describe('ticket state machine', () => {
  it('goes loading → ready → answering → finalizing → examiner → followup → evaluating → protocol', () => {
    let state = answering();
    expect(state.phase).toBe('answering');
    state = run([{ type: 'finalize', attemptId: 'attempt-1', snapshot: 'подбор весов', live: ['p1'], input: 'text', now: 19_000, startedAt: 't' }], state);
    expect(state.phase).toBe('finalizing');
    expect(state.attempt).toMatchObject({ attemptId: 'attempt-1', durationSeconds: 18, live: ['p1'] });
    expect(state.evaluation.status).toBe('running');
    state = run([{ type: 'examiner' }, { type: 'followup', pointId: 'p4', question: 'А что?', expected: 'Это.', chosenBy: 'check', mode: 'voice' }], state);
    expect(state.phase).toBe('followup');
    expect(state.followup).toMatchObject({ stage: 'asking', mode: 'voice' });
    state = run([{ type: 'followup_listen' }, { type: 'followup_result', status: 'missing', answer: 'не знаю' }], state);
    expect(state.phase).toBe('evaluating');
    state = run([{ type: 'protocol' }], state);
    expect(state.phase).toBe('evaluating');
    state = run([{ type: 'evaluation_done', run: state.run, result: { points: [], errors: [], verdict: '' } }, { type: 'protocol' }], state);
    expect(state.phase).toBe('protocol');
    expect(protocolState(state)).toBe('saving');
    state = run([{ type: 'save_failed' }], state);
    expect(protocolState(state)).toBe('save_error');
    state = run([{ type: 'save_retry' }], state);
    expect(state.save.status).toBe('idle');
  });

  it('opens a typed follow-up field at once', () => {
    const state = run(
      [
        { type: 'finalize', attemptId: 'a', snapshot: 's', live: [], input: 'text', now: 2_000, startedAt: 't' },
        { type: 'examiner' },
        { type: 'followup', pointId: 'p4', question: 'А что?', expected: '', chosenBy: 'client', mode: 'text' },
      ],
      answering(),
    );
    expect(state.followup).toMatchObject({ stage: 'answering', mode: 'text', judgedBy: null });
  });

  it('remembers whether the follow-up was judged by the check or by key words', () => {
    const asked = run(
      [
        { type: 'finalize', attemptId: 'a', snapshot: 's', live: [], input: 'text', now: 2_000, startedAt: 't' },
        { type: 'examiner' },
        { type: 'followup', pointId: 'p4', question: 'А что?', expected: '', chosenBy: 'check', mode: 'text' },
      ],
      answering(),
    );
    expect(run([{ type: 'followup_result', status: 'partial', answer: 'колебания', judgedBy: 'keywords' }], asked).followup).toMatchObject({
      status: 'partial',
      judgedBy: 'keywords',
    });
    expect(run([{ type: 'followup_result', status: 'covered', answer: 'колебания', judgedBy: 'check' }], asked).followup?.judgedBy).toBe('check');
    // «Не знаю» needs no judgement.
    expect(run([{ type: 'followup_result', status: 'missing', answer: 'не знаю' }], asked).followup?.judgedBy).toBeNull();
  });

  it('ignores results of an older question', () => {
    const state = loaded();
    const next = run([{ type: 'question', index: 1 }], state);
    expect(next.run).toBe(state.run + 1);
    const stale = run([{ type: 'rubric', run: state.run, rubric: { status: 'failed', message: 'x' } }], next);
    expect(stale.rubric.status).toBe('loading');
    const staleEval = run([{ type: 'evaluation_failed', run: state.run, message: 'x' }], next);
    expect(staleEval.evaluation.status).toBe('idle');
  });

  it('counts the answer time without pauses', () => {
    let state = answering();
    state = run([{ type: 'pause', now: 5_000 }], state);
    expect(answerTime(state, 60_000)).toBe(4_000);
    state = run([{ type: 'resume', now: 10_000 }], state);
    expect(answerTime(state, 12_000)).toBe(6_000);
  });

  it('restores a draft as a typed answer and keeps an evaluation failure for «Проверить снова»', () => {
    const state = loaded();
    const restored = run([{ type: 'draft_restored', text: 'черновик', savedAt: 't', input: 'speech', now: 0 }], state);
    expect(restored).toMatchObject({ phase: 'answering', mode: 'text', typed: 'черновик', draftAt: 't', usedSpeech: true });
    const stashed = run(
      [
        {
          type: 'stash_restored',
          message: 'Не удалось проверить ответ',
          followup: null,
          attempt: { attemptId: 'a', snapshot: 's', transcript: 's', live: ['p1'], input: 'text', durationSeconds: 3, startedAt: 't', restored: true },
        },
      ],
      state,
    );
    expect(protocolState(stashed)).toBe('eval_error');
    const retried = run([{ type: 'evaluation_retry', run: stashed.run }], stashed);
    expect(retried).toMatchObject({ phase: 'evaluating', evaluation: { status: 'running' } });
  });

  it('knows when leaving would lose an answer', () => {
    expect(hasUnsavedAnswer(loaded(), '')).toBe(false);
    const state = answering();
    expect(hasUnsavedAnswer(state, '')).toBe(false);
    expect(hasUnsavedAnswer(state, 'подбор весов')).toBe(true);
    const saved = run(
      [
        { type: 'finalize', attemptId: 'a', snapshot: 's', live: [], input: 'text', now: 2_000, startedAt: 't' },
        { type: 'no_followup', closing: THANKS_LINE },
        { type: 'evaluation_done', run: state.run, result: { points: [], errors: [], verdict: '' } },
        { type: 'protocol' },
      ],
      state,
    );
    expect(hasUnsavedAnswer(saved, '')).toBe(true);
    expect(hasUnsavedAnswer(run([{ type: 'save_done', at: 't', result: { sessionId: 's', duplicate: false, events: 1, mistakesAdded: 0, mistakesExisting: 0, cardAdded: false } }], saved), '')).toBe(false);
  });

  it('says «Хорошо, по существу всё» only when every row was named by key words, otherwise «Хорошо, спасибо» (Jury_Check item 12)', () => {
    const points = demoRubricResponse().rubric.points;
    expect(closingLine(points, ['p1', 'p2', 'p3', 'p4', 'p5'])).toBe(ALL_COVERED_LINE);
    expect(ALL_COVERED_LINE).toBe('Хорошо, по существу всё');
    // A row stayed closed: the check found nothing to ask, but the examiner does not say «по существу всё».
    expect(closingLine(points, new Set(['p1', 'p2', 'p3', 'p5']))).toBe(THANKS_LINE);
    expect(THANKS_LINE).toBe('Хорошо, спасибо');
    expect(closingLine(points, [])).toBe(THANKS_LINE);
    expect(closingLine([], [])).toBe(THANKS_LINE);
    const said = run(
      [
        { type: 'finalize', attemptId: 'a', snapshot: 's', live: ['p1'], input: 'text', now: 2_000, startedAt: 't' },
        { type: 'examiner' },
        { type: 'no_followup', closing: closingLine(points, ['p1']) },
      ],
      answering(),
    );
    expect(said).toMatchObject({ phase: 'evaluating', closing: THANKS_LINE, followup: null });
    // A new question starts without a closing line.
    expect(run([{ type: 'question', index: 1 }], said).closing).toBeNull();
  });

  it('starts over without reloading the rubric', () => {
    const state = run([{ type: 'restart' }], answering());
    expect(state).toMatchObject({ phase: 'ready', typed: '', named: [] });
    expect(state.rubric.status).toBe('ready');
  });
});
