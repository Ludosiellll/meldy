import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// ── Fakes: the tutor's API, the voice (TTS) and the microphone (useVoiceAnswer) ─────────────

interface Play {
  text: string;
  role: string;
  onEnd?: () => void;
  onError?: (error: unknown) => void;
  onStart?: () => void;
  options?: { fallback?: string };
  done: boolean;
}

const tts = vi.hoisted(() => ({
  plays: [] as Play[],
  stops: 0,
  ready: new Set<string>(),
  prefetched: [] as string[][],
}));

vi.mock('../utils/tts', () => ({
  playTTS: vi.fn(async (text: string, role: string, onEnd?: () => void, onError?: (error: unknown) => void, onStart?: () => void, options?: { fallback?: string }) => {
    // Like the real one: a new line stops the one before it.
    for (const play of tts.plays) play.done = true;
    tts.plays.push({ text, role, onEnd, onError, onStart, options, done: false });
  }),
  stopTTS: vi.fn(() => {
    tts.stops += 1;
    for (const play of tts.plays) play.done = true;
  }),
  prefetchTTS: vi.fn(async () => null),
  prefetchTTSInOrder: vi.fn(async (lines: Array<{ text: string }>) => {
    tts.prefetched.push(lines.map((line) => line.text));
  }),
  isTTSReady: vi.fn(async (text: string) => tts.ready.has(text)),
  forgetTTSFailures: vi.fn(),
}));

const voice = vi.hoisted(() => ({
  supported: true,
  engine: 'browser' as 'browser' | 'server',
  status: 'idle' as string,
  error: null as string | null,
  text: '',
  interim: '',
  starts: 0,
  stops: 0,
  pauses: 0,
  resets: [] as string[],
  rerender: null as null | (() => void),
}));

vi.mock('../hooks/useVoiceAnswer', async () => {
  const React = await import('react');
  const said = () => [voice.text, voice.interim].filter(Boolean).join(' ');
  return {
    useVoiceAnswer: () => {
      const [, setTick] = React.useState(0);
      voice.rerender = () => setTick((value) => value + 1);
      return {
        supported: voice.supported,
        status: voice.status,
        error: voice.error,
        finalText: voice.text,
        interimText: voice.interim,
        lastActivityAt: null,
        start: () => {
          voice.starts += 1;
          voice.status = 'listening';
          voice.error = null;
          voice.rerender?.();
          return true;
        },
        pause: () => {
          voice.pauses += 1;
          voice.status = 'paused';
        },
        stop: async () => {
          voice.stops += 1;
          voice.status = 'stopped';
          voice.text = said();
          voice.interim = '';
          return voice.text;
        },
        reset: (text = '') => {
          voice.resets.push(text);
          voice.text = text;
          voice.interim = '';
          voice.status = 'idle';
        },
        snapshot: said,
        engine: voice.engine,
        serverSupported: true,
        pending: 0,
        lost: 0,
        stuck: false,
        switchedBecause: null,
        level: { subscribe: () => () => undefined },
        settle: async () => said(),
        switchToServer: () => true,
      };
    },
  };
});

interface TurnCall {
  body: Record<string, unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  signal?: AbortSignal;
}

const api = vi.hoisted(() => ({
  session: null as unknown,
  sessionError: null as unknown,
  turns: [] as TurnCall[],
}));

vi.mock('../api/tutor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/tutor')>();
  return {
    ...actual,
    startTutor: vi.fn(async () => {
      if (api.sessionError) throw api.sessionError;
      return api.session;
    }),
    tutorTurn: vi.fn(
      (body: Record<string, unknown>, options?: { signal?: AbortSignal }) =>
        new Promise((resolve, reject) => {
          api.turns.push({ body, resolve, reject, signal: options?.signal });
        }),
    ),
  };
});

const telemetry = vi.hoisted(() => ({ events: [] as Array<[string, Record<string, unknown> | undefined]> }));
vi.mock('../lib/telemetry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/telemetry')>()),
  track: (name: string, props?: Record<string, unknown>) => telemetry.events.push([name, props]),
}));

import LectureTalk, { VOICE_KEY } from './LectureTalk';
import { TutorApiError } from '../api/tutor';

// ── Fixtures ────────────────────────────────────────────────────────────────────────

const MATERIAL = 'm-1';
const QUESTIONS = ['Какие виды безработицы бывают?', 'Зачем ЦБ повышает ключевую ставку?', 'Что такое инфляция?', 'Чем измеряют инфляцию?', 'Что такое ВВП?'];
const SESSION = {
  title: 'Макроэкономика',
  targets: QUESTIONS.map((question, index) => ({
    id: `c${index + 1}`,
    question,
    fragments: [{ source_id: `S0${index + 2}`, text: `Фрагмент ${index + 2} лекции.` }],
  })),
};

function reply(partial: Record<string, unknown> = {}) {
  return { move: 'confirm', say: 'Верно.', quote: null, nearest: null, status: 'covered', intent: 'answer', done: true, rung: 0, assisted: false, ...partial };
}

function renderRoom() {
  return render(
    <MemoryRouter initialEntries={[`/library/${MATERIAL}/talk`]}>
      <Routes>
        <Route path="/library/:id/talk" element={<LectureTalk />} />
        <Route path="/library/:id" element={<h1>Страница лекции</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}

const desk = () => screen.getByRole('region', { name: 'Разговор' });
const tutorCard = () => within(desk()).getByRole('region', { name: 'Meldy' });
const pill = (name: string) => within(desk()).getByRole('button', { name });
const played = () => tts.plays.map((play) => play.text);

/** The voice plays every sentence still waiting, to its end. */
function hearAll() {
  for (let guard = 0; guard < 30; guard += 1) {
    const play = tts.plays.find((item) => !item.done);
    if (!play) return;
    play.done = true;
    act(() => {
      play.onStart?.();
      play.onEnd?.();
    });
  }
}

async function started(mode: 'voice' | 'text' = 'voice') {
  renderRoom();
  await screen.findByRole('heading', { name: 'Поговорить о лекции' });
  fireEvent.click(screen.getByRole('button', { name: mode === 'voice' ? 'Начать' : 'Текстом, без микрофона' }));
}

/** «Отвечать», the words, «Готово». */
async function answerAloud(words: string) {
  fireEvent.click(pill('Отвечать'));
  await waitFor(() => expect(voice.status).toBe('listening'));
  act(() => {
    voice.text = words;
    voice.rerender?.();
  });
  fireEvent.click(pill('Готово'));
  await waitFor(() => expect(api.turns.length).toBeGreaterThan(0));
}

async function answerWith(response: Record<string, unknown>) {
  const turn = api.turns[api.turns.length - 1];
  await act(async () => {
    turn.resolve(response);
  });
}

beforeEach(() => {
  api.session = structuredClone(SESSION);
  api.sessionError = null;
  api.turns = [];
  tts.plays = [];
  tts.stops = 0;
  tts.ready = new Set();
  tts.prefetched = [];
  Object.assign(voice, { supported: true, engine: 'browser', status: 'idle', error: null, text: '', interim: '', starts: 0, stops: 0, pauses: 0, resets: [] });
  telemetry.events = [];
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// ── Tests ───────────────────────────────────────────────────────────────────────────

describe('the room’s name (finding LIB-5)', () => {
  it('is the pill’s own name with the lecture’s title, in the bar and in the browser tab', async () => {
    const { container } = renderRoom();
    await screen.findByRole('heading', { name: 'Поговорить о лекции' });
    expect(container.querySelector('.or-where .or-long')?.textContent?.replace(/\s/g, ' ')).toBe('Поговорить о лекции · Макроэкономика');
    expect(container.querySelector('.or-where .or-short')?.textContent).toBe('Поговорить о лекции');
    expect(document.title).toBe('Поговорить о лекции — Meldy');
    expect(container.textContent).not.toMatch(/Разговор о лекции/);
  });
});

describe('the start card', () => {
  it('says what will happen before any microphone prompt', async () => {
    renderRoom();
    expect(await screen.findByRole('heading', { name: 'Поговорить о лекции' })).toBeInTheDocument();
    expect(screen.getByText('Лекция «Макроэкономика»')).toBeInTheDocument();
    expect(screen.getByText('Meldy задаст 4 вопроса по карточкам этой лекции.')).toBeInTheDocument();
    expect(screen.getByText('Включите звук. Когда браузер спросит про микрофон, разрешите его.')).toBeInTheDocument();
    expect(screen.getByText('Микрофон слушает, только пока на кнопке написано «Готово».')).toBeInTheDocument();
    expect(
      screen.getByText('Реплики пишет ИИ только по тексту этой лекции. Слова лекции — на карточках с номером фрагмента, остальное — пояснения Meldy.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Текстом, без микрофона' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'К лекции' })).toHaveAttribute('href', `/library/${MATERIAL}`);
    expect(voice.starts).toBe(0);
    expect(tts.plays).toHaveLength(0);
    // The first question goes into the lasting cache first, then «Так…» and the code's own lines.
    await waitFor(() => expect(tts.prefetched.length).toBeGreaterThan(0));
    expect(tts.prefetched[0].slice(0, 3)).toEqual([QUESTIONS[0], 'Так…', 'Дальше.']);
  });

  it('«Начать» starts the first question’s voice within the tap, in the tutor’s voice only', async () => {
    renderRoom();
    await screen.findByRole('heading', { name: 'Поговорить о лекции' });
    fireEvent.click(screen.getByRole('button', { name: 'Начать' }));
    // No await between the tap and the voice: Safari allows the sound only from the tap itself.
    expect(played()).toEqual([QUESTIONS[0]]);
    expect(tts.plays[0]).toMatchObject({ role: 'female', options: { fallback: 'none' } });
    expect(within(tutorCard()).getByText(QUESTIONS[0])).toBeInTheDocument();
    expect(pill('Отвечать')).toBeInTheDocument();
    expect(screen.getByText('Вопрос 1 из 4')).toBeInTheDocument();
    expect(telemetry.events).toContainEqual(['tutor_started', { cards: 4, mode: 'voice' }]);
  });

  it('a lecture without cards: the server’s words and the way back', async () => {
    api.sessionError = new TutorApiError('http', 'Сначала разберите лекцию: репетитор спрашивает по её карточкам.', { status: 409 });
    renderRoom();
    expect(await screen.findByText('Сначала разберите лекцию: репетитор спрашивает по её карточкам.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Повторить' })).not.toBeInTheDocument();
    const back = screen.getAllByRole('link', { name: 'К лекции' });
    expect(back.every((link) => link.getAttribute('href') === `/library/${MATERIAL}`)).toBe(true);
  });

  it('a busy server can be asked again', async () => {
    api.sessionError = new TutorApiError('busy', 'Не удалось начать разговор: сервер не ответил. Повторите через минуту.');
    renderRoom();
    expect(await screen.findByText('Не удалось начать разговор: сервер не ответил. Повторите через минуту.')).toBeInTheDocument();
    api.sessionError = null;
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByRole('heading', { name: 'Поговорить о лекции' })).toBeInTheDocument();
  });
});

describe('a turn aloud', () => {
  it('the microphone opens only after the voice, 300 ms after it stopped', async () => {
    await started();
    expect(voice.starts).toBe(0);
    // «Отвечать» while Meldy speaks: the voice stops, the microphone waits.
    fireEvent.click(pill('Отвечать'));
    expect(tts.stops).toBeGreaterThan(0);
    expect(voice.starts).toBe(0);
    expect(pill('Готово')).toBeInTheDocument();
    await waitFor(() => expect(voice.starts).toBe(1));
  });

  it('sends the answer with the card, its rung and the lines before it; «Дальше.» and the next question', async () => {
    await started();
    hearAll();
    await answerAloud('фрикционная и структурная');
    expect(api.turns[0].body).toEqual({
      material_id: MATERIAL,
      kind: 'answer',
      target_id: 'c1',
      rung: 0,
      utterance: 'фрикционная и структурная',
      history: [{ role: 'tutor', text: QUESTIONS[0] }],
    });
    // Waiting: the pill is not for pressing, the answer stays on screen.
    expect(pill('Отвечать')).toHaveAttribute('aria-disabled', 'true');
    expect(within(desk()).getByText('фрикционная и структурная')).toBeInTheDocument();
    await answerWith(reply({ say: 'Верно: все три вида.' }));
    expect(within(tutorCard()).getByText('Верно: все три вида. Дальше.')).toBeInTheDocument();
    expect(within(tutorCard()).getByText(QUESTIONS[1])).toHaveClass('lt-tutor-main');
    expect(screen.getByText('Вопрос 2 из 4')).toBeInTheDocument();
    // Sentence by sentence, the lead first.
    expect(played().slice(-1)).toEqual(['Верно: все три вида.']);
    hearAll();
    expect(played().slice(-3)).toEqual(['Верно: все три вида.', 'Дальше.', QUESTIONS[1]]);
    // The protocol: speaker words and the lines, no bubbles.
    const protocol = screen.getByRole('list', { name: 'Текст разговора' });
    // Short words are glued to the next one with no-break spaces (Russian typesetting).
    expect(within(protocol).getAllByRole('listitem').map((row) => row.textContent?.replace(/\u00a0/g, ' '))).toEqual([
      `Meldy${QUESTIONS[0]}`,
      'Выфрикционная и структурная',
      `MeldyВерно: все три вида. Дальше. ${QUESTIONS[1]}`,
    ]);
    expect(telemetry.events.find(([name]) => name === 'tutor_turn')).toEqual(['tutor_turn', { move: 'confirm', status: 'covered', wait: '<1s' }]);
  });

  it('shows the lecture’s words with their fragment; the nearest fragment says it is the nearest', async () => {
    await started();
    hearAll();
    await answerAloud('не помню');
    await answerWith(reply({ move: 'quote', say: 'Вот как сказано в лекции. Скажите своими словами.', quote: { source_id: 'S03', text: 'кредиты дорожают, спрос снижается' }, done: false, rung: 2, assisted: true, status: 'missing' }));
    expect(screen.getByText('Из лекции, фрагмент 3')).toBeInTheDocument();
    expect(within(desk()).getByText('кредиты дорожают, спрос снижается')).toBeInTheDocument();
    hearAll();
    fireEvent.click(pill('Спросить'));
    await waitFor(() => expect(voice.status).toBe('listening'));
    expect(within(desk()).getByText('Ваш вопрос')).toBeInTheDocument();
    act(() => {
      voice.text = 'что такое бозон хиггса';
      voice.rerender?.();
    });
    fireEvent.click(pill('Готово'));
    await waitFor(() => expect(api.turns).toHaveLength(2));
    expect(api.turns[1].body).toMatchObject({ kind: 'question', utterance: 'что такое бозон хиггса' });
    expect(api.turns[1].body).not.toHaveProperty('target_id');
    await answerWith(reply({ move: 'not_in_lecture', say: 'В лекции об этом не сказано.', nearest: { source_id: 'S04', text: 'Безработица бывает фрикционной.' }, done: false, rung: 0, status: null }));
    expect(screen.getByText('Больше всего слов из вопроса во фрагменте 4')).toBeInTheDocument();
    expect(within(tutorCard()).getByText('В лекции об этом не сказано. Вернёмся к вопросу.')).toBeInTheDocument();
    expect(within(tutorCard()).getByText(QUESTIONS[0])).toBeInTheDocument();
  });

  it('opens a long fragment of the desk whole in the fragment panel; the desk keeps its start (owner 21.10)', async () => {
    await started();
    hearAll();
    await answerAloud('не помню');
    const long = `${'Безработица бывает фрикционной, структурной и циклической. '.repeat(12)}Конец фрагмента.`;
    await answerWith(reply({ move: 'quote', say: 'Вот как сказано в лекции. Скажите своими словами.', quote: { source_id: 'S03', text: long }, done: false, rung: 2, assisted: true, status: 'missing' }));
    expect(desk().querySelector('.lt-slip-text')?.textContent?.endsWith('…')).toBe(true);
    const more = within(desk()).getByRole('button', { name: 'Показать целиком' });
    fireEvent.click(more);
    const panel = screen.getByRole('dialog', { name: 'Фрагмент 3 лекции' });
    expect(panel.querySelector('.fp-slip')?.textContent).toContain('Конец фрагмента.');
    expect(panel.querySelector('.fp-note')).toBeNull();
    // Whole at once: no second «Показать целиком» in the panel; the desk does not grow.
    expect(within(panel).queryByRole('button', { name: 'Показать целиком' })).toBeNull();
    expect(desk().querySelector('.lt-slip-text')?.textContent?.endsWith('…')).toBe(true);
    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(more).toHaveFocus();
  });

  it('«Не знаю» is the answer «не знаю»', async () => {
    await started();
    fireEvent.click(pill('Не знаю'));
    await waitFor(() => expect(api.turns).toHaveLength(1));
    expect(api.turns[0].body).toMatchObject({ kind: 'answer', utterance: 'не знаю', target_id: 'c1', rung: 0 });
    expect(tts.stops).toBeGreaterThan(0);
  });

  it('nothing heard: «Не расслышала» aloud, then the advice about the microphone', async () => {
    await started();
    hearAll();
    fireEvent.click(pill('Отвечать'));
    await waitFor(() => expect(voice.status).toBe('listening'));
    fireEvent.click(pill('Готово'));
    expect(await within(desk()).findByText('Не расслышала. Повторите, пожалуйста.')).toBeInTheDocument();
    expect(played().slice(-1)).toEqual(['Не расслышала.']);
    hearAll();
    expect(played().slice(-2)).toEqual(['Не расслышала.', 'Повторите, пожалуйста.']);
    fireEvent.click(pill('Отвечать'));
    await waitFor(() => expect(voice.status).toBe('listening'));
    const plays = tts.plays.length;
    fireEvent.click(pill('Готово'));
    expect(
      await within(desk()).findByText('Ничего не слышно. Проверьте, какой микрофон выбран (значок слева от адреса), или ответьте текстом.'),
    ).toBeInTheDocument();
    expect(tts.plays).toHaveLength(plays);
    expect(api.turns).toHaveLength(0);
  });

  it('a forbidden microphone moves the answer into writing', async () => {
    await started();
    hearAll();
    fireEvent.click(pill('Отвечать'));
    await waitFor(() => expect(voice.status).toBe('listening'));
    act(() => {
      voice.text = 'начало';
      voice.status = 'error';
      voice.error = 'not-allowed';
      voice.rerender?.();
    });
    expect(
      await screen.findByText('Микрофон запрещён для этого сайта. Нажмите значок слева от адреса, разрешите микрофон и обновите страницу. Пока можно отвечать текстом.'),
    ).toBeInTheDocument();
    const field = screen.getByRole('textbox', { name: 'Ваш ответ' });
    expect(field).toHaveValue('начало');
    expect(field).toHaveFocus();
  });

  it('a failed recognition keeps what was said', async () => {
    await started();
    hearAll();
    fireEvent.click(pill('Отвечать'));
    await waitFor(() => expect(voice.status).toBe('listening'));
    act(() => {
      voice.text = 'сказанное раньше';
      voice.status = 'error';
      voice.error = 'network';
      voice.rerender?.();
    });
    expect(await screen.findByText('Не удалось распознать речь. Сказанное раньше сохранено — повторите или допишите текстом.')).toBeInTheDocument();
    expect(within(desk()).getByText('сказанное раньше')).toBeInTheDocument();
    expect(pill('Отвечать')).toBeInTheDocument();
  });
});

describe('a turn in writing', () => {
  it('works without the microphone at all', async () => {
    await started('text');
    const field = screen.getByRole('textbox', { name: 'Ваш ответ' });
    expect(field).toHaveFocus();
    fireEvent.click(pill('Готово'));
    expect(screen.getByText('Напишите ответ или нажмите «Не знаю».')).toBeInTheDocument();
    fireEvent.change(field, { target: { value: 'фрикционная' } });
    fireEvent.click(pill('Готово'));
    await waitFor(() => expect(api.turns).toHaveLength(1));
    expect(api.turns[0].body).toMatchObject({ kind: 'answer', utterance: 'фрикционная' });
    expect(voice.starts).toBe(0);
  });
});

describe('owner 21.10: a reload keeps what was typed and not sent', () => {
  it('comes back in the field of its card when the conversation starts again; a sent answer leaves nothing', async () => {
    await started('text');
    fireEvent.change(screen.getByRole('textbox', { name: 'Ваш ответ' }), { target: { value: 'фрикционная и структурная' } });
    cleanup();

    // The conversation itself is on the page only: it starts again from «Начать».
    await started('text');
    expect(screen.getByRole('textbox', { name: 'Ваш ответ' })).toHaveValue('фрикционная и структурная');
    fireEvent.click(pill('Готово'));
    await waitFor(() => expect(api.turns).toHaveLength(1));
    expect(api.turns[0].body).toMatchObject({ kind: 'answer', target_id: 'c1', utterance: 'фрикционная и структурная' });
    cleanup();

    await started('text');
    expect(screen.getByRole('textbox', { name: 'Ваш ответ' })).toHaveValue('');
  });

  it('started aloud, the card opens in writing with the words; a question of one’s own stays a question', async () => {
    await started('text');
    fireEvent.click(pill('Спросить'));
    fireEvent.change(screen.getByRole('textbox', { name: 'Ваш вопрос' }), { target: { value: 'Что такое NAIRU?' } });
    cleanup();

    await started('voice');
    const field = await screen.findByRole('textbox', { name: 'Ваш вопрос' });
    expect(field).toHaveValue('Что такое NAIRU?');
    hearAll();
    fireEvent.click(pill('Готово'));
    await waitFor(() => expect(api.turns).toHaveLength(1));
    expect(api.turns[0].body).toMatchObject({ kind: 'question', utterance: 'Что такое NAIRU?' });
  });

  it('is kept per card: another card’s words wait for that card', async () => {
    await started('text');
    fireEvent.click(pill('Не знаю'));
    await waitFor(() => expect(api.turns).toHaveLength(1));
    await answerWith(reply());
    expect(within(tutorCard()).getByText(QUESTIONS[1])).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Ваш ответ' }), { target: { value: 'чтобы сдержать инфляцию' } });
    cleanup();
    api.turns = [];

    await started('text');
    expect(screen.getByRole('textbox', { name: 'Ваш ответ' })).toHaveValue('');
    fireEvent.click(pill('Не знаю'));
    await waitFor(() => expect(api.turns).toHaveLength(1));
    await answerWith(reply());
    expect(within(tutorCard()).getByText(QUESTIONS[1])).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Ваш ответ' })).toHaveValue('чтобы сдержать инфляцию');
  });
});

describe('the voice', () => {
  it('«Без звука» is remembered; the line is then read to screen readers instead', async () => {
    await started();
    const live = document.querySelector('[aria-live="polite"]') as HTMLElement;
    // Said aloud: not announced as well.
    expect(live).toHaveTextContent('');
    fireEvent.click(within(tutorCard()).getByRole('button', { name: 'Без звука' }));
    expect(window.localStorage.getItem(VOICE_KEY)).toBe('off');
    expect(within(tutorCard()).getByRole('button', { name: 'Включить голос' })).toBeInTheDocument();
    fireEvent.click(pill('Не знаю'));
    await waitFor(() => expect(api.turns).toHaveLength(1));
    const plays = tts.plays.length;
    await answerWith(reply({ move: 'nudge', say: 'Подумайте: что происходит с кредитами?', done: false, rung: 1, assisted: true }));
    expect(tts.plays).toHaveLength(plays);
    expect(live).toHaveTextContent('Meldy: Подумайте: что происходит с кредитами?');
    // Nothing is announced while the microphone is open.
    fireEvent.click(pill('Отвечать'));
    expect(live).toHaveTextContent('');
  });

  it('a voice that does not start says so; twice and the lines stay on screen only', async () => {
    await started();
    act(() => tts.plays[0].onError?.(new Error('no audio')));
    expect(await screen.findByText(/Голос не включился — реплика на экране\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить звук' }));
    expect(played()).toEqual([QUESTIONS[0], QUESTIONS[0]]);
    act(() => tts.plays[1].onError?.(new Error('no audio')));
    expect(await screen.findByText('Голос пока недоступен — реплики только текстом.')).toBeInTheDocument();
    expect(within(tutorCard()).queryByRole('button', { name: 'Повторить' })).not.toBeInTheDocument();
  });

  it('Space answers and finishes, Esc stops the voice', async () => {
    await started();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(tts.stops).toBeGreaterThan(0);
    expect(pill('Отвечать')).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: ' ', code: 'Space' });
    await waitFor(() => expect(voice.status).toBe('listening'));
    act(() => {
      voice.text = 'ответ пробелом';
      voice.rerender?.();
    });
    fireEvent.keyDown(document.body, { key: ' ', code: 'Space' });
    await waitFor(() => expect(api.turns).toHaveLength(1));
    expect(api.turns[0].body).toMatchObject({ utterance: 'ответ пробелом' });
  });

  it('Space in the text field types', async () => {
    await started('text');
    const field = screen.getByRole('textbox', { name: 'Ваш ответ' });
    fireEvent.keyDown(field, { key: ' ', code: 'Space' });
    expect(voice.starts).toBe(0);
    expect(api.turns).toHaveLength(0);
  });
});

describe('waiting and errors', () => {
  it('«Так…» from the cache at 700 ms, «Отвечаю дольше обычного» at 6 s', async () => {
    tts.ready.add('Так…');
    await started();
    hearAll();
    vi.useFakeTimers({ shouldAdvanceTime: false });
    fireEvent.click(pill('Не знаю'));
    expect(api.turns).toHaveLength(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(played().slice(-1)).toEqual(['Так…']);
    expect(screen.queryByText('Отвечаю дольше обычного.')).not.toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_400);
    });
    expect(screen.getByText('Отвечаю дольше обычного.')).toBeInTheDocument();
    expect(played().filter((text) => text === 'Так…')).toHaveLength(1);
  });

  it('«Так…» is not fetched live when it is not cached', async () => {
    await started();
    hearAll();
    vi.useFakeTimers({ shouldAdvanceTime: false });
    fireEvent.click(pill('Не знаю'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(played()).not.toContain('Так…');
  });

  it('the daily limit keeps what was said and leads back to the lecture', async () => {
    await started();
    hearAll();
    await answerAloud('ставка растёт');
    await act(async () => {
      api.turns[0].reject(new TutorApiError('limit', 'Дневной лимит ИИ на сегодня исчерпан. Сказанное сохранено.', { status: 429, code: 'ai_limit' }));
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Дневной лимит ИИ на сегодня исчерпан. Сказанное сохранено.');
    expect(within(desk()).getByText('ставка растёт')).toBeInTheDocument();
    expect(within(desk()).getByRole('link', { name: 'К лекции' })).toHaveAttribute('href', `/library/${MATERIAL}`);
    fireEvent.click(within(desk()).getByRole('button', { name: 'Закончить' }));
    expect(telemetry.events.find(([name]) => name === 'tutor_finished')?.[1]).toMatchObject({ reason: 'limit', cards: 0 });
  });

  it('a busy service: «Повторить» sends the same words again', async () => {
    await started();
    hearAll();
    await answerAloud('ставка растёт');
    await act(async () => {
      api.turns[0].reject(new TutorApiError('busy', 'Сервис ИИ занят. Подождите минуту — ответ сохранён.', { status: 503 }));
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Сервис ИИ занят. Подождите минуту — ответ сохранён.');
    fireEvent.click(within(desk()).getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(api.turns).toHaveLength(2));
    expect(api.turns[1].body).toEqual(api.turns[0].body);
  });

  it('no connection: the turn goes again when the browser is back online', async () => {
    await started();
    hearAll();
    await answerAloud('ставка растёт');
    await act(async () => {
      api.turns[0].reject(new TutorApiError('offline', 'Нет интернета. Разговор на паузе, сказанное сохранено.'));
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Нет интернета. Разговор на паузе, сказанное сохранено.');
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(() => expect(api.turns).toHaveLength(2));
  });
});

describe('the end', () => {
  it('after the fourth card: the time, the counts, what to reread; «Продолжить разговор» goes on', async () => {
    await started();
    for (let index = 0; index < 4; index += 1) {
      hearAll();
      fireEvent.click(pill('Не знаю'));
      await waitFor(() => expect(api.turns).toHaveLength(index + 1));
      await answerWith(index === 1 ? reply({ move: 'explain', say: 'Ставка делает кредиты дороже.', assisted: true, rung: 2 }) : reply());
    }
    expect(await screen.findByRole('heading', { name: 'Поговорили меньше минуты.' })).toBeInTheDocument();
    expect(screen.getByText('Сами: 3. С подсказкой: 0. Не вспомнили: 1.')).toBeInTheDocument();
    expect(screen.getByText('Перечитайте: фрагмент 3.')).toBeInTheDocument();
    expect(screen.getByText('Разговор окончен')).toBeInTheDocument();
    expect(telemetry.events.find(([name]) => name === 'tutor_finished')).toEqual([
      'tutor_finished',
      { cards: 4, self: 3, assisted: 0, minutes: '<1m', reason: 'done' },
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Продолжить разговор' }));
    // The fifth card, at once from the tap.
    expect(within(tutorCard()).getByText(QUESTIONS[4])).toBeInTheDocument();
    expect(played().slice(-1)).toEqual([QUESTIONS[4]]);
    expect(screen.getByText('Вопрос 1 из 1')).toBeInTheDocument();
    expect(telemetry.events.filter(([name]) => name === 'tutor_started')).toEqual([
      ['tutor_started', { cards: 4, mode: 'voice' }],
      ['tutor_started', { cards: 1, mode: 'voice' }],
    ]);
  });

  it('«Закончить» ends early; leaving the room mid-way counts as left', async () => {
    const { unmount } = renderRoom();
    await screen.findByRole('heading', { name: 'Поговорить о лекции' });
    fireEvent.click(screen.getByRole('button', { name: 'Начать' }));
    fireEvent.click(pill('Закончить'));
    expect(screen.getByRole('heading', { name: 'Поговорили меньше минуты.' })).toBeInTheDocument();
    expect(screen.getByText('Сами: 0. С подсказкой: 0.')).toBeInTheDocument();
    expect(telemetry.events.filter(([name]) => name === 'tutor_finished')).toEqual([
      ['tutor_finished', { cards: 0, self: 0, assisted: 0, minutes: '<1m', reason: 'left' }],
    ]);
    unmount();
    // Already reported: leaving after the summary sends nothing more.
    expect(telemetry.events.filter(([name]) => name === 'tutor_finished')).toHaveLength(1);
  });

  it('leaving in the middle of the conversation is reported once', async () => {
    const { unmount } = renderRoom();
    await screen.findByRole('heading', { name: 'Поговорить о лекции' });
    fireEvent.click(screen.getByRole('button', { name: 'Начать' }));
    unmount();
    expect(telemetry.events.filter(([name]) => name === 'tutor_finished')).toEqual([
      ['tutor_finished', { cards: 0, self: 0, assisted: 0, minutes: '<1m', reason: 'left' }],
    ]);
  });
});

describe('the conversation text on a phone', () => {
  it('opens in a sheet that Esc closes', async () => {
    await started();
    fireEvent.click(screen.getByRole('button', { name: 'Текст разговора' }));
    const sheet = screen.getByRole('dialog', { name: 'Текст разговора' });
    expect(within(sheet).getByText(QUESTIONS[0])).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Закрыть' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
