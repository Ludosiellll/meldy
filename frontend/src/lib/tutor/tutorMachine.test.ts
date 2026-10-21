import { describe, expect, it } from 'vitest';
import type { TutorTarget, TutorTurnResponse } from '../../api/tutor';
import {
  BACK_LINE,
  DONT_KNOW_ANSWER,
  HISTORY_LINES,
  LAST_LINE,
  MAX_CARDS,
  NEXT_LINE,
  NOTICE_TEXT,
  NOT_HEARD_LINE,
  fragmentNumber,
  fragmentsWord,
  historyOf,
  initialTutorState,
  lineSize,
  lineText,
  questionsWord,
  rereadFragments,
  sentences,
  slipCaption,
  slipPanelNote,
  summaryOf,
  talkTime,
  tally,
  tutorReducer,
  type TutorAction,
  type TutorState,
} from './tutorMachine';

const target = (n: number, sources: string[] = [`S0${n}`]): TutorTarget => ({
  id: `c${n}`,
  question: `Вопрос номер ${n}?`,
  fragments: sources.map((source_id) => ({ source_id, text: `Текст фрагмента ${source_id}.` })),
});

const TARGETS = [target(1), target(2, ['S04', 'S07']), target(3), target(4), target(5), target(6)];

function run(actions: TutorAction[], from: TutorState = initialTutorState()): TutorState {
  return actions.reduce(tutorReducer, from);
}

function reply(partial: Partial<TutorTurnResponse>): TutorTurnResponse {
  return {
    move: 'confirm',
    say: 'Верно.',
    quote: null,
    nearest: null,
    status: 'covered',
    intent: 'answer',
    done: true,
    rung: 0,
    assisted: false,
    ...partial,
  };
}

/** The first card asked, its voice heard, the student's turn. */
function asked(options: { voiceOn?: boolean; mode?: 'voice' | 'text'; targets?: TutorTarget[] } = {}): TutorState {
  let state = run([{ type: 'loaded', title: 'Макроэкономика', targets: options.targets ?? TARGETS }], initialTutorState({ voiceOn: options.voiceOn ?? true }));
  state = tutorReducer(state, { type: 'begin', mode: options.mode ?? 'voice', now: 1_000 });
  if (state.speech) state = tutorReducer(state, { type: 'spoken', speech: state.speech.id, played: true });
  return state;
}

/** The student says `text` aloud and presses «Готово». */
function say(state: TutorState, text: string): TutorState {
  return run([{ type: 'listen' }, { type: 'recognise' }, { type: 'heard', text }], state);
}

function answer(state: TutorState, text: string, response: Partial<TutorTurnResponse>, now = 5_000): TutorState {
  const sent = say(state, text);
  let next = tutorReducer(sent, { type: 'reply', turn: sent.turn, response: reply(response), now });
  if (next.speech && next.phase === 'speaking') next = tutorReducer(next, { type: 'spoken', speech: next.speech.id, played: true });
  return next;
}

describe('starting', () => {
  it('takes at most four cards, in the order the server gives', () => {
    const state = run([{ type: 'loaded', title: 'Макроэкономика', targets: TARGETS }]);
    expect(state.phase).toBe('start');
    expect(state.title).toBe('Макроэкономика');
    expect(state.cards.map((card) => card.target.id)).toEqual(['c1', 'c2', 'c3', 'c4']);
    expect(state.cards).toHaveLength(MAX_CARDS);
    expect(state.cards.every((card) => card.rung === 0 && card.outcome === null)).toBe(true);
  });

  it('a lecture without cards cannot start', () => {
    const state = run([{ type: 'loaded', title: 'Пусто', targets: [] }]);
    expect(state.phase).toBe('load_error');
    expect(state.loadError).toMatch(/разберите лекцию/);
  });

  it('a failed load can be tried again', () => {
    let state = run([{ type: 'load_failed', message: 'Не удалось начать разговор.', retry: true }]);
    expect(state).toMatchObject({ phase: 'load_error', loadError: 'Не удалось начать разговор.', loadRetry: true });
    state = tutorReducer(state, { type: 'reload' });
    expect(state).toMatchObject({ phase: 'loading', loadError: null, loads: 1 });
  });

  it('no text or no cards: the server’s words, nothing to repeat', () => {
    const state = run([{ type: 'load_failed', message: 'Сначала разберите лекцию: репетитор спрашивает по её карточкам.', retry: false }]);
    expect(state).toMatchObject({ phase: 'load_error', loadRetry: false });
  });

  it('«Начать» asks the first card without the server: the line, the protocol and the voice', () => {
    let state = run([{ type: 'loaded', title: 'Макроэкономика', targets: TARGETS }]);
    state = tutorReducer(state, { type: 'begin', mode: 'voice', now: 1_000 });
    expect(state.phase).toBe('speaking');
    expect(state.startedAt).toBe(1_000);
    expect(state.turn).toBe(0);
    expect(state.pending).toBeNull();
    expect(state.line?.segments).toEqual([{ text: 'Вопрос номер 1?', main: true }]);
    expect(state.protocol).toEqual([expect.objectContaining({ role: 'tutor', text: 'Вопрос номер 1?' })]);
    expect(state.speech?.parts).toEqual(['Вопрос номер 1?']);
  });

  it('without the voice the turn comes at once: «Отвечать», or the field in writing', () => {
    expect(asked({ voiceOn: false }).phase).toBe('idle');
    const typing = run(
      [
        { type: 'loaded', title: 'Т', targets: TARGETS },
        { type: 'begin', mode: 'text', now: 0 },
      ],
      initialTutorState({ voiceOn: false }),
    );
    expect(typing).toMatchObject({ phase: 'typing', mode: 'text', speech: null });
  });

  it('begins only from the start card', () => {
    const state = asked();
    expect(tutorReducer(state, { type: 'begin', mode: 'voice', now: 9 })).toBe(state);
  });
});

describe('the voice', () => {
  it('a finished line gives the turn; an older line’s end changes nothing', () => {
    let state = run([
      { type: 'loaded', title: 'Т', targets: TARGETS },
      { type: 'begin', mode: 'voice', now: 0 },
    ]);
    const speech = state.speech!;
    expect(tutorReducer(state, { type: 'spoken', speech: speech.id + 99, played: true })).toBe(state);
    state = tutorReducer(state, { type: 'spoken', speech: speech.id, played: true });
    expect(state).toMatchObject({ phase: 'idle', speech: null });
  });

  it('in writing the field stays during the voice and gets the turn after it', () => {
    let state = run([
      { type: 'loaded', title: 'Т', targets: TARGETS },
      { type: 'begin', mode: 'text', now: 0 },
    ]);
    expect(state).toMatchObject({ phase: 'speaking', mode: 'text' });
    state = tutorReducer(state, { type: 'typed', text: 'черновик' });
    state = tutorReducer(state, { type: 'spoken', speech: state.speech!.id, played: true });
    expect(state).toMatchObject({ phase: 'typing', typed: 'черновик' });
  });

  it('a failed line says so once; two in a row and the voice rests, the lines stay on screen', () => {
    let state = run([
      { type: 'loaded', title: 'Т', targets: TARGETS },
      { type: 'begin', mode: 'voice', now: 0 },
    ]);
    state = tutorReducer(state, { type: 'speech_failed', speech: state.speech!.id });
    expect(state).toMatchObject({ phase: 'idle', voiceFailures: 1, voiceBroken: false, notice: { kind: 'voice_failed', text: 'Голос не включился — реплика на экране.' } });
    // «Повторить звук»
    state = tutorReducer(state, { type: 'repeat' });
    expect(state.phase).toBe('speaking');
    expect(state.notice).toBeNull();
    state = tutorReducer(state, { type: 'speech_failed', speech: state.speech!.id });
    expect(state).toMatchObject({ phase: 'idle', voiceFailures: 2, voiceBroken: true, notice: null });
    // The next line comes without a voice: straight to the student's turn.
    state = say(state, 'фрикционная');
    state = tutorReducer(state, { type: 'reply', turn: state.turn, response: reply({}), now: 2 });
    expect(state).toMatchObject({ phase: 'idle', speech: null });
    expect(tutorReducer(state, { type: 'repeat' })).toBe(state);
  });

  it('a line that sounded resets the count of failures', () => {
    let state = run([
      { type: 'loaded', title: 'Т', targets: TARGETS },
      { type: 'begin', mode: 'voice', now: 0 },
    ]);
    state = tutorReducer(state, { type: 'speech_failed', speech: state.speech!.id });
    state = tutorReducer(state, { type: 'repeat' });
    state = tutorReducer(state, { type: 'spoken', speech: state.speech!.id, played: true });
    expect(state.voiceFailures).toBe(0);
  });

  it('«Без звука» stops the voice and gives the turn; «Включить голос» tries again after it gave up', () => {
    let state = run([
      { type: 'loaded', title: 'Т', targets: TARGETS },
      { type: 'begin', mode: 'voice', now: 0 },
    ]);
    state = tutorReducer(state, { type: 'voice', on: false });
    expect(state).toMatchObject({ phase: 'idle', speech: null, voiceOn: false });
    expect(tutorReducer(state, { type: 'repeat' })).toBe(state);
    state = { ...state, voiceBroken: true, voiceFailures: 2 };
    state = tutorReducer(state, { type: 'voice', on: true });
    expect(state).toMatchObject({ voiceOn: true, voiceBroken: false, voiceFailures: 0 });
    state = tutorReducer(state, { type: 'repeat' });
    expect(state.phase).toBe('speaking');
    expect(state.speech?.parts).toEqual(['Вопрос номер 1?']);
  });

  it('«Повторить» while listening says the line again; the turn comes back after it', () => {
    let state = tutorReducer(asked(), { type: 'listen' });
    state = tutorReducer(state, { type: 'repeat' });
    expect(state.phase).toBe('speaking');
    const first = state.speech!.id;
    state = tutorReducer(state, { type: 'repeat' });
    expect(state.speech!.id).toBeGreaterThan(first);
    state = tutorReducer(state, { type: 'spoken', speech: state.speech!.id, played: true });
    expect(state.phase).toBe('idle');
  });
});

describe('answering aloud', () => {
  it('«Отвечать» while the tutor speaks stops the voice and opens the turn', () => {
    let state = run([
      { type: 'loaded', title: 'Т', targets: TARGETS },
      { type: 'begin', mode: 'voice', now: 0 },
    ]);
    state = tutorReducer(state, { type: 'listen' });
    expect(state).toMatchObject({ phase: 'listening', speech: null, mode: 'voice' });
  });

  it('«Готово» sends what was heard with the card, its rung and the lines before it', () => {
    const before = asked();
    let state = run([{ type: 'listen' }, { type: 'recognise' }], before);
    expect(state.phase).toBe('recognising');
    state = tutorReducer(state, { type: 'heard', text: '  фрикционная   и структурная ' });
    expect(state.phase).toBe('thinking');
    expect(state.turn).toBe(before.turn + 1);
    expect(state.pending).toEqual({
      kind: 'answer',
      utterance: 'фрикционная и структурная',
      targetId: 'c1',
      rung: 0,
      history: [{ role: 'tutor', text: 'Вопрос номер 1?' }],
    });
    expect(state.protocol.slice(-1)[0]).toMatchObject({ role: 'student', text: 'фрикционная и структурная', question: false });
  });

  it('nothing heard: «Не расслышала» aloud once, then the advice on screen', () => {
    let state = say(asked(), '   ');
    expect(state).toMatchObject({ phase: 'speaking', emptyInRow: 1, notice: { kind: 'not_heard', text: NOT_HEARD_LINE } });
    expect(state.speech?.parts).toEqual([NOT_HEARD_LINE]);
    // The question stays on the card.
    expect(lineText(state.line!)).toBe('Вопрос номер 1?');
    state = tutorReducer(state, { type: 'spoken', speech: state.speech!.id, played: true });
    expect(state.phase).toBe('idle');
    state = say(state, '…');
    expect(state).toMatchObject({ phase: 'idle', emptyInRow: 2, speech: null, notice: { kind: 'not_heard_again', text: NOTICE_TEXT.not_heard_again } });
    expect(NOTICE_TEXT.not_heard_again).toBe('Ничего не слышно. Проверьте, какой микрофон выбран (значок слева от адреса), или ответьте текстом.');
    // Something heard: the count starts over.
    state = say(state, 'ответ');
    expect(state.emptyInRow).toBe(0);
  });

  it('nothing heard without the voice: the line on screen, no voice', () => {
    const state = say(asked({ voiceOn: false }), '');
    expect(state).toMatchObject({ phase: 'idle', speech: null, notice: { kind: 'not_heard' } });
  });

  it('a denied microphone moves the turn into writing with the words so far', () => {
    let state = tutorReducer(asked(), { type: 'listen' });
    state = tutorReducer(state, { type: 'mic_failed', kind: 'denied', text: 'начало ответа' });
    expect(state).toMatchObject({ phase: 'typing', mode: 'text', typed: 'начало ответа' });
    expect(state.notice?.text).toBe(
      'Микрофон запрещён для этого сайта. Нажмите значок слева от адреса, разрешите микрофон и обновите страницу. Пока можно отвечать текстом.',
    );
  });

  it('failed recognition keeps the turn in voice: repeat or finish in writing', () => {
    let state = tutorReducer(asked(), { type: 'listen' });
    state = tutorReducer(state, { type: 'mic_failed', kind: 'failed' });
    expect(state).toMatchObject({ phase: 'idle', mode: 'voice' });
    expect(state.notice?.text).toBe('Не удалось распознать речь. Сказанное раньше сохранено — повторите или допишите текстом.');
  });

  it('«Текстом» carries the words into the field; «Голосом» goes back', () => {
    let state = tutorReducer(asked(), { type: 'listen' });
    state = tutorReducer(state, { type: 'mode', mode: 'text', text: 'сказанное' });
    expect(state).toMatchObject({ phase: 'typing', mode: 'text', typed: 'сказанное' });
    state = tutorReducer(state, { type: 'mode', mode: 'voice' });
    expect(state).toMatchObject({ phase: 'idle', mode: 'voice' });
    state = tutorReducer(state, { type: 'mode', mode: 'text' });
    state = tutorReducer(state, { type: 'listen' });
    expect(state).toMatchObject({ phase: 'listening', mode: 'voice' });
  });
});

describe('answering in writing', () => {
  it('an empty field asks for words; words are sent', () => {
    let state = asked({ mode: 'text' });
    expect(state.phase).toBe('typing');
    state = tutorReducer(state, { type: 'submit' });
    expect(state.notice).toEqual({ kind: 'empty', text: 'Напишите ответ или нажмите «Не знаю».' });
    state = tutorReducer(state, { type: 'typed', text: 'структурная' });
    expect(state.notice).toBeNull();
    state = tutorReducer(state, { type: 'submit' });
    expect(state.phase).toBe('thinking');
    expect(state.pending?.utterance).toBe('структурная');
    expect(state.typed).toBe('');
  });

  it('«Готово» while the tutor still speaks sends the answer (the voice stops)', () => {
    let state = run([
      { type: 'loaded', title: 'Т', targets: TARGETS },
      { type: 'begin', mode: 'text', now: 0 },
      { type: 'typed', text: 'быстрый ответ' },
      { type: 'submit' },
    ]);
    expect(state).toMatchObject({ phase: 'thinking', speech: null });
  });
});

describe('«Не знаю» and «Спросить»', () => {
  it('«Не знаю» is an answer «не знаю» to the card, whatever was said or asked', () => {
    let state = tutorReducer(asked(), { type: 'listen' });
    state = tutorReducer(state, { type: 'ask', on: true });
    state = tutorReducer(state, { type: 'dont_know' });
    expect(state.pending).toMatchObject({ kind: 'answer', utterance: DONT_KNOW_ANSWER, targetId: 'c1', rung: 0 });
    expect(state.asking).toBe(false);
  });

  it('«Спросить» sends the next reply as a question; the card keeps its rung', () => {
    // The card is at rung 1 after a hint.
    let state = answer(asked(), 'не помню', { move: 'nudge', say: 'Подумайте: что происходит с кредитами?', done: false, rung: 1, assisted: true, status: 'missing' });
    expect(state.cards[0].rung).toBe(1);
    state = tutorReducer(state, { type: 'ask', on: true });
    state = say(state, 'а что такое ключевая ставка');
    expect(state.pending).toMatchObject({ kind: 'question', utterance: 'а что такое ключевая ставка' });
    expect(state.protocol.slice(-1)[0]).toMatchObject({ role: 'student', question: true });
    state = tutorReducer(state, {
      type: 'reply',
      turn: state.turn,
      response: reply({ move: 'answer', say: 'Это ставка ЦБ.', quote: { source_id: 'S03', text: 'кредиты дорожают' }, done: false, rung: 0, status: null, intent: 'question' }),
      now: 9,
    });
    expect(state.cards[0].rung).toBe(1);
    expect(state.index).toBe(0);
    expect(state.line?.segments).toEqual([
      { text: 'Это ставка ЦБ.', main: false },
      { text: BACK_LINE, main: false },
      { text: 'Вопрос номер 1?', main: true },
    ]);
    expect(state.line?.slip).toEqual({ sourceId: 'S03', text: 'кредиты дорожают', kind: 'quote' });
    expect(state.asking).toBe(false);
    // The next answer to the card goes at its rung.
    state = say({ ...state, phase: 'idle', speech: null }, 'ставка растёт');
    expect(state.pending).toMatchObject({ kind: 'answer', rung: 1 });
  });

  it('a question the lecture does not cover shows the nearest fragment', () => {
    let state = tutorReducer(asked(), { type: 'ask', on: true });
    state = say(state, 'что такое бозон хиггса');
    state = tutorReducer(state, {
      type: 'reply',
      turn: state.turn,
      response: reply({ move: 'not_in_lecture', say: 'В лекции об этом не сказано.', nearest: { source_id: 'S04', text: 'Безработица бывает…' }, done: false, rung: 0, status: null }),
      now: 9,
    });
    expect(state.line?.slip).toEqual({ sourceId: 'S04', text: 'Безработица бывает…', kind: 'nearest' });
    expect(slipCaption(state.line!.slip!)).toBe('Больше всего слов из вопроса во фрагменте 4');
    expect(slipPanelNote(state.line!.slip!)).toBe('Здесь в лекции больше всего слов из вопроса.');
    expect(lineText(state.line!)).toBe('В лекции об этом не сказано. Вернёмся к вопросу. Вопрос номер 1?');
  });

  it('«Спросить» can be taken back before the reply goes', () => {
    let state = tutorReducer(asked(), { type: 'ask', on: true });
    state = tutorReducer(state, { type: 'ask', on: false });
    state = say(state, 'ответ');
    expect(state.pending?.kind).toBe('answer');
  });
});

describe('the ladder and the cards', () => {
  it('a covered answer at rung 0 closes the card as «сами» and moves on with «Дальше.»', () => {
    const state = answer(asked(), 'фрикционная, структурная и циклическая', { move: 'confirm', say: 'Верно: все три вида.', done: true, rung: 0, assisted: false });
    expect(state.cards[0]).toMatchObject({ outcome: 'self' });
    expect(state.index).toBe(1);
    expect(state.line?.segments).toEqual([
      { text: 'Верно: все три вида.', main: false },
      { text: NEXT_LINE, main: false },
      { text: 'Вопрос номер 2?', main: true },
    ]);
    expect(state.protocol.slice(-1)[0]).toMatchObject({ role: 'tutor', text: 'Верно: все три вида. Дальше. Вопрос номер 2?' });
    expect(state.pending).toBeNull();
  });

  it('the voice says every part of the line', () => {
    const sent = say(asked(), 'ответ');
    const state = tutorReducer(sent, { type: 'reply', turn: sent.turn, response: reply({ say: 'Верно.' }), now: 1 });
    expect(state.phase).toBe('speaking');
    expect(state.speech?.parts).toEqual(['Верно.', NEXT_LINE, 'Вопрос номер 2?']);
  });

  it('hint, then the lecture’s words, then an explanation that closes the card as «не вспомнили»', () => {
    let state = answer(asked(), 'не знаю', { move: 'nudge', say: 'Подумайте: что происходит с кредитами?', done: false, rung: 1, assisted: true, status: 'missing' });
    expect(state.cards[0]).toMatchObject({ rung: 1, outcome: null });
    expect(state.index).toBe(0);
    expect(state.line?.segments).toEqual([{ text: 'Подумайте: что происходит с кредитами?', main: true }]);

    state = answer(state, 'что-то с деньгами', {
      move: 'quote',
      say: 'Вот как сказано в лекции. Скажите своими словами.',
      quote: { source_id: 'S03', text: 'кредиты дорожают, спрос снижается' },
      done: false,
      rung: 2,
      assisted: true,
      status: 'partial',
    });
    expect(state.cards[0].rung).toBe(2);
    expect(state.line?.slip).toEqual({ sourceId: 'S03', text: 'кредиты дорожают, спрос снижается', kind: 'quote' });
    expect(slipCaption(state.line!.slip!)).toBe('Из лекции, фрагмент 3');
    expect(slipPanelNote(state.line!.slip!)).toBeUndefined();
    expect(state.pending).toBeNull();

    const sent = say(state, 'чтобы курс был выше');
    expect(sent.pending).toMatchObject({ rung: 2, targetId: 'c1' });
    state = tutorReducer(sent, {
      type: 'reply',
      turn: sent.turn,
      response: reply({ move: 'explain', say: 'Ставка делает кредиты дороже.', quote: { source_id: 'S03', text: 'кредиты дорожают' }, done: true, rung: 2, assisted: true, status: 'wrong' }),
      now: 9,
    });
    expect(state.cards[0].outcome).toBe('missed');
    expect(state.index).toBe(1);
    expect(state.line?.segments.map((segment) => segment.text)).toEqual(['Ставка делает кредиты дороже.', NEXT_LINE, 'Вопрос номер 2?']);
    expect(state.line?.slip?.sourceId).toBe('S03');
  });

  it('a covered answer after a hint is «с подсказкой»', () => {
    let state = answer(asked(), 'не помню', { move: 'nudge', say: 'Подумайте.', done: false, rung: 1, assisted: true, status: 'missing' });
    state = answer(state, 'фрикционная', { move: 'confirm', say: 'Верно.', done: true, rung: 1, assisted: true });
    expect(state.cards[0].outcome).toBe('assisted');
  });

  it('off topic: back to the card’s question at the same rung', () => {
    let state = answer(asked(), 'не помню', { move: 'nudge', say: 'Подумайте.', done: false, rung: 1, assisted: true, status: 'missing' });
    state = answer(state, 'какая сегодня погода', { move: 'redirect', say: 'Это не по лекции. Вернёмся к вопросу.', done: false, rung: 1, assisted: true, status: 'missing', intent: 'off_topic' });
    expect(state.cards[0].rung).toBe(1);
    expect(state.line?.segments).toEqual([
      { text: 'Это не по лекции. Вернёмся к вопросу.', main: false },
      { text: 'Вопрос номер 1?', main: true },
    ]);
  });

  it('after the fourth card the conversation ends; its last line is still said', () => {
    let state = asked();
    for (let i = 0; i < 3; i += 1) state = answer(state, 'ответ', { move: 'confirm', say: 'Верно.', done: true });
    expect(state.index).toBe(3);
    const sent = say(state, 'ответ');
    state = tutorReducer(sent, { type: 'reply', turn: sent.turn, response: reply({ move: 'confirm', say: 'Верно: так и есть.', done: true }), now: 61_000 });
    expect(state).toMatchObject({ phase: 'ended', endReason: 'done', endedAt: 61_000 });
    expect(state.line?.segments).toEqual([
      { text: 'Верно: так и есть.', main: true },
      { text: LAST_LINE, main: false },
    ]);
    expect(state.speech?.parts).toEqual(['Верно: так и есть.', LAST_LINE]);
    // The voice finishing does not leave the summary.
    state = tutorReducer(state, { type: 'spoken', speech: state.speech!.id, played: true });
    expect(state.phase).toBe('ended');
    expect(tally(state)).toEqual({ cards: 4, self: 4, assisted: 0, missed: 0 });
    // Cards five and six were never asked.
    expect(state.protocol.filter((row) => row.text.includes('Вопрос номер 5'))).toHaveLength(0);
  });

  it('a lecture with one card ends after it', () => {
    const state = answer(asked({ targets: [target(1)] }), 'ответ', { move: 'confirm', done: true });
    expect(state.phase).toBe('ended');
  });

  it('a move without words gets the code’s own', () => {
    const sent = say(asked(), 'ответ');
    const state = tutorReducer(sent, { type: 'reply', turn: sent.turn, response: reply({ move: 'nudge', say: '  ', done: false, rung: 1, assisted: true }), now: 1 });
    expect(lineText(state.line!)).toBe('Подумайте ещё. Что об этом говорится в лекции?');
  });
});

describe('history', () => {
  it('sends the four lines before the reply, never the reply itself', () => {
    let state = asked();
    state = answer(state, 'первый', { move: 'nudge', say: 'Подсказка один.', done: false, rung: 1, assisted: true });
    state = answer(state, 'второй', { move: 'quote', say: 'Слова лекции.', done: false, rung: 2, assisted: true });
    const sent = say(state, 'третий');
    expect(sent.pending?.history).toHaveLength(HISTORY_LINES);
    expect(sent.pending?.history).toEqual([
      { role: 'student', text: 'первый' },
      { role: 'tutor', text: 'Подсказка один.' },
      { role: 'student', text: 'второй' },
      { role: 'tutor', text: 'Слова лекции.' },
    ]);
    expect(historyOf(sent.protocol).slice(-1)[0]).toEqual({ role: 'student', text: 'третий' });
  });
});

describe('waiting and errors', () => {
  it('«Так…» and «Отвечаю дольше обычного» belong to the request in flight only', () => {
    const state = say(asked(), 'ответ');
    expect(tutorReducer(state, { type: 'slow', turn: state.turn - 1 })).toBe(state);
    expect(tutorReducer(state, { type: 'slow', turn: state.turn }).slow).toBe(true);
    expect(tutorReducer(state, { type: 'filler', turn: state.turn }).fillerPlayed).toBe(true);
    const idle = asked();
    expect(tutorReducer(idle, { type: 'slow', turn: idle.turn })).toBe(idle);
  });

  it('a late reply to an older request is ignored', () => {
    const state = say(asked(), 'ответ');
    expect(tutorReducer(state, { type: 'reply', turn: state.turn - 1, response: reply({}), now: 1 })).toBe(state);
    const idle = asked();
    expect(tutorReducer(idle, { type: 'reply', turn: idle.turn, response: reply({}), now: 1 })).toBe(idle);
  });

  it('a busy service keeps what was said; «Повторить» sends it again as a new request', () => {
    let state = say(asked(), 'фрикционная');
    const pending = state.pending;
    state = tutorReducer(state, { type: 'failed', turn: state.turn, error: { kind: 'busy', message: 'Сервис ИИ занят. Подождите минуту — ответ сохранён.' } });
    expect(state.phase).toBe('error');
    expect(state.pending).toEqual(pending);
    expect(state.protocol.slice(-1)[0]).toMatchObject({ role: 'student', text: 'фрикционная' });
    const turn = state.turn;
    state = tutorReducer(state, { type: 'retry' });
    expect(state).toMatchObject({ phase: 'thinking', turn: turn + 1, error: null, slow: false, fillerPlayed: false });
    expect(state.pending).toEqual(pending);
  });

  it('the daily limit and a lost card cannot be repeated', () => {
    const limit = tutorReducer(say(asked(), 'ответ'), { type: 'failed', turn: 1, error: { kind: 'limit', message: 'лимит' } });
    expect(limit.phase).toBe('error');
    expect(tutorReducer(limit, { type: 'retry' })).toBe(limit);
    const lost = tutorReducer(say(asked(), 'ответ'), { type: 'failed', turn: 1, error: { kind: 'restart', message: 'нет карточки' } });
    expect(tutorReducer(lost, { type: 'retry' })).toBe(lost);
  });

  it('words the server refused (too long) go back into the field', () => {
    let state = say(asked(), 'очень длинный ответ');
    state = tutorReducer(state, { type: 'failed', turn: state.turn, error: { kind: 'fix', message: 'Реплика слишком длинная: можно до 1500 знаков.' } });
    expect(state).toMatchObject({ phase: 'typing', mode: 'text', typed: 'очень длинный ответ', pending: null });
    expect(state.notice).toEqual({ kind: 'fix', text: 'Реплика слишком длинная: можно до 1500 знаков.' });
    expect(state.protocol.slice(-1)[0]?.role).toBe('tutor');
  });
});

describe('finishing', () => {
  it('«Закончить» ends the conversation as left', () => {
    const state = tutorReducer(asked(), { type: 'finish', now: 30_000 });
    expect(state).toMatchObject({ phase: 'ended', endReason: 'left', endedAt: 30_000, line: null, speech: null });
  });

  it('after the daily limit it ends as limit, after another error as error', () => {
    const limit = tutorReducer(say(asked(), 'ответ'), { type: 'failed', turn: 1, error: { kind: 'limit', message: 'лимит' } });
    expect(tutorReducer(limit, { type: 'finish', now: 1 }).endReason).toBe('limit');
    const busy = tutorReducer(say(asked(), 'ответ'), { type: 'failed', turn: 1, error: { kind: 'busy', message: 'занят' } });
    expect(tutorReducer(busy, { type: 'finish', now: 1 }).endReason).toBe('error');
  });

  it('there is nothing to finish before the start or after the end', () => {
    const start = run([{ type: 'loaded', title: 'Т', targets: TARGETS }]);
    expect(tutorReducer(start, { type: 'finish', now: 1 })).toBe(start);
    const ended = tutorReducer(asked(), { type: 'finish', now: 1 });
    expect(tutorReducer(ended, { type: 'finish', now: 2 })).toBe(ended);
  });

  it('«Продолжить разговор» goes on with the cards not asked yet, at once', () => {
    let state = asked();
    expect(state.asked).toEqual(['c1']);
    state = answer(state, 'ответ', { move: 'confirm', done: true });
    expect(state.asked).toEqual(['c1', 'c2']);
    state = tutorReducer(state, { type: 'finish', now: 10_000 });
    state = tutorReducer(state, { type: 'continue', now: 20_000 });
    // c3 and c4 were in the session but never asked: they come first.
    expect(state.cards.map((card) => card.target.id)).toEqual(['c3', 'c4', 'c5', 'c6']);
    expect(state).toMatchObject({ phase: 'speaking', index: 0, startedAt: 20_000, endReason: null, endedAt: null, title: 'Макроэкономика' });
    expect(state.protocol).toEqual([expect.objectContaining({ role: 'tutor', text: 'Вопрос номер 3?' })]);
    expect(state.speech?.parts).toEqual(['Вопрос номер 3?']);
    expect(state.asked).toEqual(['c1', 'c2', 'c3']);
  });

  it('when every card was asked, the conversation goes round again', () => {
    let state = asked({ targets: [target(1), target(2)] });
    state = answer(state, 'ответ', { move: 'confirm', done: true });
    state = answer(state, 'ответ', { move: 'confirm', done: true });
    expect(state.phase).toBe('ended');
    state = tutorReducer(state, { type: 'continue', now: 1 });
    expect(state.cards.map((card) => card.target.id)).toEqual(['c1', 'c2']);
    expect(state.asked).toEqual(['c1']);
  });

  it('continues only from the summary', () => {
    const state = asked();
    expect(tutorReducer(state, { type: 'continue', now: 1 })).toBe(state);
  });

  it('a lost card (409) starts the conversation over from the server', () => {
    let state = tutorReducer(say(asked(), 'ответ'), { type: 'failed', turn: 1, error: { kind: 'restart', message: 'Этой карточки в лекции больше нет. Начните разговор заново.' } });
    state = tutorReducer(state, { type: 'reload' });
    expect(state).toMatchObject({ phase: 'loading', protocol: [], pool: [], asked: [], pending: null, loads: 1 });
  });

  it('a new session starts over and keeps the voice settings', () => {
    let state = tutorReducer({ ...asked(), voiceOn: false, mode: 'text' }, { type: 'finish', now: 1 });
    const lastId = state.nextId;
    state = tutorReducer(state, { type: 'loaded', title: 'Т', targets: TARGETS.slice(4) });
    expect(state).toMatchObject({ phase: 'start', voiceOn: false, mode: 'text', protocol: [], index: 0, endReason: null, startedAt: null });
    expect(state.cards.map((card) => card.target.id)).toEqual(['c5', 'c6']);
    // Ids keep growing: a line of the new session is never taken for one of the old.
    expect(state.nextId).toBe(lastId);
  });
});

describe('the summary', () => {
  it('says the time, the counts and what to reread', () => {
    let state = asked();
    state = answer(state, 'ответ', { move: 'confirm', done: true, assisted: false });
    state = answer(state, 'не помню', { move: 'nudge', say: 'Подумайте.', done: false, rung: 1, assisted: true });
    state = answer(state, 'вспомнил', { move: 'confirm', done: true, rung: 1, assisted: true });
    state = answer(state, 'не знаю', { move: 'nudge', done: false, rung: 1, assisted: true });
    state = answer(state, 'не знаю', { move: 'quote', done: false, rung: 2, assisted: true });
    state = answer(state, 'не знаю', { move: 'explain', done: true, rung: 2, assisted: true });
    state = tutorReducer(state, { type: 'finish', now: 1_000 + 3 * 60_000 + 10_000 });
    expect(tally(state)).toEqual({ cards: 3, self: 1, assisted: 1, missed: 1 });
    expect(rereadFragments(state)).toEqual([3, 4, 7]);
    expect(summaryOf(state, 0)).toEqual({
      title: 'Поговорили 3 мин.',
      counts: 'Сами: 1. С подсказкой: 1. Не вспомнили: 1.',
      reread: 'Перечитайте: фрагменты 3, 4 и 7.',
    });
  });

  it('a short talk where everything was said alone', () => {
    const state = tutorReducer(answer(asked(), 'ответ', { move: 'confirm', done: true }), { type: 'finish', now: 20_000 });
    expect(summaryOf(state, 0)).toEqual({ title: 'Поговорили меньше минуты.', counts: 'Сами: 1. С подсказкой: 0.', reread: null });
  });

  it('words and numbers', () => {
    expect(talkTime(59_999)).toBe('меньше минуты');
    expect(talkTime(60_000)).toBe('1 мин.');
    expect(talkTime(150_000)).toBe('3 мин.');
    expect(fragmentsWord([4])).toBe('фрагмент 4');
    expect(fragmentsWord([4, 7])).toBe('фрагменты 4 и 7');
    expect(fragmentsWord([])).toBe('');
    expect(questionsWord(1)).toBe('1 вопрос');
    expect(questionsWord(4)).toBe('4 вопроса');
    expect(fragmentNumber('S04')).toBe(4);
    expect(fragmentNumber('S12')).toBe(12);
    expect(fragmentNumber('x')).toBeNull();
    expect(slipCaption({ sourceId: 'S10', text: '…', kind: 'quote' })).toBe('Из лекции, фрагмент 10');
  });
});

describe('the line on screen and in the voice', () => {
  it('sizes the main text by its length', () => {
    expect(lineSize('Какие виды безработицы бывают?')).toBe('l');
    expect(lineSize('а'.repeat(120))).toBe('m');
    expect(lineSize('а'.repeat(200))).toBe('s');
    expect(lineSize('а'.repeat(300))).toBe('xs');
  });

  it('splits a line into sentences for the voice', () => {
    expect(sentences('Верно: все три вида. Дальше.')).toEqual(['Верно: все три вида.', 'Дальше.']);
    expect(sentences('Так…')).toEqual(['Так…']);
    expect(sentences('Что это? Подумайте!  А ещё')).toEqual(['Что это?', 'Подумайте!', 'А ещё']);
    // Abbreviations and initials are not ends.
    expect(sentences('Налоги, сборы и т. д. влияют на цены. Да.')).toEqual(['Налоги, сборы и т. д. влияют на цены.', 'Да.']);
    expect(sentences('Так писал А. С. Пушкин. Верно.')).toEqual(['Так писал А. С. Пушкин.', 'Верно.']);
    // Closing quotes stay with their sentence.
    expect(sentences('Он сказал «хватит». Дальше.')).toEqual(['Он сказал «хватит».', 'Дальше.']);
    expect(sentences('   ')).toEqual([]);
  });
});
