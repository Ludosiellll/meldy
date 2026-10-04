import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConversationPlayer, {
  nextSpeed,
  plainLineText,
  sheetMetrics,
  SLOW_NOTE_MS,
  speedLabel,
  WAIT_NOTE_MS,
  waitMessage,
} from './ConversationPlayer';
import { resetJobsForTests } from './jobs';

const tts = vi.hoisted(() => ({
  playTTS: vi.fn(),
  pauseTTS: vi.fn(),
  resumeTTS: vi.fn(),
  stopTTS: vi.fn(),
  prefetchTTSInOrder: vi.fn(),
  isTTSSounding: vi.fn(),
  getTTSPlaybackRate: vi.fn(),
  setTTSPlaybackRate: vi.fn(),
  forgetTTSFailures: vi.fn(),
  isTTSUnavailable: (error: unknown) =>
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'unavailable',
}));

const db = vi.hoisted(() => ({
  from: vi.fn(),
  update: vi.fn(),
  snapshot: null as null | { summary_json: Record<string, unknown>; original_text: string },
}));

const limits = vi.hoisted(() => ({ incrementAIUsage: vi.fn() }));
const quests = vi.hoisted(() => ({ updateQuestProgress: vi.fn() }));
const energy = vi.hoisted(() => ({ verifyEnergy: vi.fn() }));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock('../../utils/tts', () => tts);
vi.mock('../../lib/supabase', () => ({ supabase: { from: db.from } }));
vi.mock('../../api/limits', () => ({ incrementAIUsage: limits.incrementAIUsage }));
vi.mock('../../api/quests', () => ({ updateQuestProgress: quests.updateQuestProgress }));
vi.mock('../../hooks/useEnergyConfirm', () => ({ useEnergyConfirm: () => ({ verifyEnergy: energy.verifyEnergy }) }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
vi.mock('react-hot-toast', () => ({ default: toasts }));

const modelLines = [
  { speaker: 'Макс', text: 'Привет! Сегодня разбираем термодинамику.', visual: { type: 'scene', title: 'Термодинамика', icon: 'flask', caption: 'Тепло и работа' } },
  { speaker: 'Софья', text: 'Начнём с главного понятия.', visual: { type: 'term', term: 'Энтропия', definition: 'Мера беспорядка системы.' } },
  { speaker: 'Макс', text: 'А как проверить себя?', visual: { type: 'question', question: 'Что растёт в изолированной системе?', answer: 'Энтропия.' } },
  { speaker: 'Софья', text: 'Посмотрим на цифры из лекции.', source_ids: ['S02'], visual: { type: 'chart', title: 'Температура кипения', kind: 'bar', unit: '°C', data: [{ label: 'Вода', value: 100 }, { label: 'Спирт', value: 78 }] } },
];

const legacyLines = [
  { speaker: 'Макс', text: 'Привет! О чём сегодня?' },
  { speaker: 'Софья', text: 'Про энтропию и порядок.' },
];

function fetchResponse(body: unknown, ok = true, status = 200) {
  return Promise.resolve({ ok, status, json: () => Promise.resolve(body) } as Response);
}

function setupDatabase() {
  db.from.mockImplementation(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        single: vi.fn(() => Promise.resolve({ data: db.snapshot, error: null })),
      })),
    })),
    update: vi.fn((payload: unknown) => {
      db.update(payload);
      return {
        eq: vi.fn(() => ({
          select: vi.fn(() => Promise.resolve({ data: [{ id: 'material-1' }], error: null })),
        })),
      };
    }),
  }));
}

/** Видимое изображение сцены (невидимые копии для расчёта высоты не в счёт). */
function activeScene(): HTMLElement {
  const stage = screen.getByRole('region', { name: 'Сцена' });
  const layer = stage.querySelector<HTMLElement>('[data-scene-layer="active"]');
  if (!layer) throw new Error('no active scene layer');
  return layer;
}

type PlayCall = [string, string, () => void, (error: unknown) => void, () => void, { fallback?: string; persist?: boolean }];
const lastPlay = () => tts.playTTS.mock.calls[tts.playTTS.mock.calls.length - 1] as PlayCall;
/** The hosts speak only with the server voice (never the browser's) and their clips are kept for a replay. */
const HOST_VOICE = { fallback: 'none', persist: true };

/** «Текст разговора» — ссылка в строке плеера; расшифровка открывается панелью поверх листа. */
function openTranscript(): HTMLElement {
  const link = screen.getByRole('button', { name: 'Текст разговора' });
  if (link.getAttribute('aria-expanded') !== 'true') fireEvent.click(link);
  return screen.getByRole('complementary', { name: 'Текст разговора' });
}

describe('ConversationPlayer', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    resetJobsForTests();
    tts.getTTSPlaybackRate.mockReturnValue(1);
    tts.isTTSSounding.mockReturnValue(false);
    tts.prefetchTTSInOrder.mockResolvedValue(undefined);
    tts.playTTS.mockResolvedValue(undefined);
    limits.incrementAIUsage.mockResolvedValue(undefined);
    quests.updateQuestProgress.mockResolvedValue(true);
    energy.verifyEnergy.mockResolvedValue(true);
    db.snapshot = null;
    setupDatabase();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('opens with an outline of what will be on screen; the transcript waits behind its link', async () => {
    const user = userEvent.setup();
    render(<ConversationPlayer lines={modelLines} title="Термодинамика" />);

    // No permanent 340 px column: the transcript opens from «Текст разговора».
    expect(screen.queryByRole('complementary', { name: 'Текст разговора' })).not.toBeInTheDocument();
    const transcript = openTranscript();
    for (const line of modelLines) {
      expect(within(transcript).getByText(line.text)).toBeInTheDocument();
    }
    fireEvent.click(within(transcript).getByRole('button', { name: 'Закрыть текст разговора' }));
    expect(screen.getByText('Реплика 1 из 4')).toBeInTheDocument();
    expect(screen.getByText('Макс и Софья обсуждают лекцию · 4 реплики, около минуты')).toBeInTheDocument();

    const scene = activeScene();
    expect(within(scene).getByText('О чём разговор')).toBeInTheDocument();
    expect(within(scene).getByText('Тепло и работа')).toBeInTheDocument();
    expect(within(scene).getByRole('button', { name: /Энтропия.*реплика 2/ })).toBeInTheDocument();
    expect(screen.queryByText('Из конспекта')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Добавить схемы/ })).not.toBeInTheDocument();

    // Строка плана ведёт к своей реплике, но не включает звук сама.
    await user.click(within(scene).getByRole('button', { name: /Температура кипения/ }));
    expect(screen.getByText('Реплика 4 из 4')).toBeInTheDocument();
    expect(tts.playTTS).not.toHaveBeenCalled();
  });

  it('opens an old saved conversation with a plan of distinct topics, never its self-check question or quote', async () => {
    // summary_json.podcast as the previous prompt wrote it (the owner's conversation, 2026-10-04): a question
    // as the scene caption, the same term twice, a self-check question and a quote among the pictures.
    const saved = [
      { speaker: 'Макс', text: 'Софья, привет! Звучит немного сложно. Что такое эластичность?', source_ids: ['S01'], visual: { type: 'scene', title: 'Эластичность спроса', icon: 'scale', caption: 'Как изменение цены влияет на покупки?' } },
      { speaker: 'Софья', text: 'Если цена чуть растёт, а покупают намного меньше, спрос эластичный.', visual: { type: 'term', term: 'Эластичный спрос', definition: 'Покупки меняются сильнее, чем цена.' } },
      { speaker: 'Макс', text: 'То есть от покупки легко отказаться?', visual: { type: 'term', term: 'эластичный спрос!', definition: 'Покупки меняются сильнее, чем цена.' } },
      { speaker: 'Софья', text: 'Сравним кофе и хлеб.', visual: { type: 'compare', title: 'Спрос на кофе и хлеб', left: { label: 'Капучино', points: ['Легко заменить'] }, right: { label: 'Хлеб', points: ['Нужен каждый день'] } } },
      { speaker: 'Макс', text: 'Проверю себя.', visual: { type: 'question', question: 'Объясните экономическую причину, по которой пекарня может заработать больше, подняв цену на хлеб, а кофейня — меньше, подняв цену на капучино.', answer: 'Спрос на хлеб неэластичен.' } },
      { speaker: 'Софья', text: 'Так сказано в лекции.', visual: { type: 'fact', title: 'Определение', text: 'Эластичность показывает, насколько меняется спрос.' } },
      { speaker: 'Макс', text: 'Что из этого следует?', visual: { type: 'steps', title: 'Последствия эластичного спроса', items: ['Выручка падает', 'Скидки работают'] } },
    ];
    const user = userEvent.setup();
    render(<ConversationPlayer lines={saved} title="Тема 4. Эластичность" />);

    const scene = activeScene();
    expect(within(scene).getByText('О чём разговор')).toHaveClass('cv-kicker');
    expect(within(scene).getByRole('heading', { name: 'Эластичность спроса' })).toBeInTheDocument();
    // The caption is the lede under the topic, not a question over a list of answers.
    expect(within(scene).getByText('Как изменение цены влияет на покупки?')).toHaveClass('cv-scene-lede');
    const plan = within(scene).getByRole('list', { name: 'Дальше в разговоре' });
    const names = (list: HTMLElement) => within(list).getAllByRole('button').map(button => button.getAttribute('aria-label'));
    expect(names(plan)).toEqual([
      'Эластичный спрос, реплика 2',
      'Спрос на кофе и хлеб, реплика 4',
      'Последствия эластичного спроса, реплика 7',
    ]);
    expect(within(plan).getByRole('button', { name: 'Спрос на кофе и хлеб, реплика 4' })).toHaveTextContent('Спрос на кофе и хлебреплика 4');
    expect(scene.textContent).not.toMatch(/Объясните экономическую причину|Определение|Эластичность показывает/);

    await user.click(within(plan).getByRole('button', { name: /Спрос на кофе и хлеб/ }));
    expect(screen.getByText('Реплика 4 из 7')).toBeInTheDocument();
    expect(within(activeScene()).getByRole('heading', { name: 'Спрос на кофе и хлеб' })).toBeInTheDocument();
    expect(tts.playTTS).not.toHaveBeenCalled();
    cleanup();

    // A conversation saved without pictures: the cover is the material title; the plan comes from the summary
    // terms found in the lines, each once; one topic is no plan — the cover stands alone.
    const legacy = [
      { speaker: 'Макс', text: 'Привет! О чём сегодня?' },
      { speaker: 'Софья', text: 'Про эластичность спроса и выручку.', source_ids: ['S01'] },
      { speaker: 'Макс', text: 'А что с выручкой при росте цены?' },
      { speaker: 'Софья', text: 'Выручка падает, если покупки сильно сокращаются.' },
    ];
    const terms = [
      { term: 'Эластичность спроса', definition: 'Насколько покупки зависят от цены.' },
      { term: 'Выручка', definition: 'Цена, умноженная на количество проданного.' },
    ];
    render(<ConversationPlayer lines={legacy} title="Тема 4. Эластичность" terms={terms} />);
    let cover = activeScene();
    expect(within(cover).getByText('О чём разговор')).toBeInTheDocument();
    expect(within(cover).getByRole('heading', { name: 'Тема 4. Эластичность' })).toBeInTheDocument();
    expect(names(within(cover).getByRole('list'))).toEqual(['Эластичность спроса, реплика 2', 'Выручка, реплика 3']);
    cleanup();

    render(<ConversationPlayer lines={legacy} title="Тема 4. Эластичность" terms={terms.slice(1)} />);
    cover = activeScene();
    expect(within(cover).getByRole('heading', { name: 'Тема 4. Эластичность' })).toBeInTheDocument();
    expect(within(cover).queryByRole('list')).not.toBeInTheDocument();
  });

  it('shows the clicked line visual, says where the numbers come from and plays from it', async () => {
    const user = userEvent.setup();
    render(<ConversationPlayer lines={modelLines} title="Термодинамика" />);

    const transcript = openTranscript();
    await user.click(within(transcript).getByRole('button', { name: /Посмотрим на цифры из лекции/ }));

    const scene = activeScene();
    // No small type label over the picture («График»): the title says what it is.
    expect(within(scene).queryByText('График')).not.toBeInTheDocument();
    expect(within(scene).getByRole('heading', { name: 'Температура кипения, °C' })).toBeInTheDocument();
    // The source note in the corner of the sheet: where the numbers come from. There are no fragments
    // here, so there is no number either: «S02» of the line cannot be checked against anything.
    expect(within(scene).getByText('Числа — из лекции')).toHaveClass('sf-pnote');
    expect(within(scene).queryByText(/S02|фрагмент/)).not.toBeInTheDocument();
    expect(within(scene).getByRole('img', { name: /Температура кипения/ })).toBeInTheDocument();
    const subtitles = screen.getByRole('region', { name: 'Субтитры' });
    expect(within(subtitles).getByText('Посмотрим на цифры из лекции.')).toBeInTheDocument();
    expect(screen.getByText('Реплика 4 из 4')).toBeInTheDocument();

    expect(tts.playTTS).toHaveBeenCalledWith(
      'Посмотрим на цифры из лекции.',
      'female',
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      HOST_VOICE,
    );
    // Пока звук не пошёл, кнопка честно показывает загрузку.
    expect(screen.getByRole('button', { name: 'Загружаем звук' })).toBeInTheDocument();
    act(() => lastPlay()[4]());
    expect(screen.getByRole('button', { name: 'Пауза' })).toBeInTheDocument();
  });

  it('marks automatically matched visuals and shows the material title on a legacy cover', async () => {
    const user = userEvent.setup();
    render(
      <ConversationPlayer
        lines={legacyLines}
        title="Порядок и хаос"
        terms={[{ term: 'Энтропия', definition: 'Мера беспорядка.' }]}
        materialId="material-1"
      />,
    );

    const cover = activeScene();
    expect(within(cover).getByText('Порядок и хаос')).toBeInTheDocument();
    expect(within(cover).queryByText('Подобрано по словам реплики')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Добавить схемы/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Реплика 2' }));
    const term = activeScene();
    expect(within(term).getByRole('heading', { name: 'Энтропия' })).toBeInTheDocument();
    // Подобранный по словам реплики термин честно подписан: он из конспекта, а не от модели.
    expect(within(term).getByText('Из конспекта')).toHaveClass('sf-pnote');
    expect(within(term).queryByText('Термин')).not.toBeInTheDocument();
  });

  it('reveals the answer of a question card', async () => {
    const user = userEvent.setup();
    render(<ConversationPlayer lines={modelLines} />);

    const transcript = openTranscript();
    await user.click(within(transcript).getByRole('button', { name: /А как проверить себя/ }));

    const scene = activeScene();
    expect(within(scene).getByRole('heading', { name: 'Что растёт в изолированной системе?' })).toBeInTheDocument();
    expect(within(scene).queryByText('Энтропия.')).not.toBeInTheDocument();
    await user.click(within(scene).getByRole('button', { name: 'Показать ответ' }));
    expect(within(activeScene()).getByText('Энтропия.')).toBeInTheDocument();
  });

  it('moves between lines with the keyboard; Space starts a line and presses while it loads change nothing', () => {
    render(<ConversationPlayer lines={modelLines} />);
    const player = screen.getByRole('region', { name: 'Разговор по материалу' });
    // The warm-up: the first two lines are prepared as soon as the player is on screen.
    expect(tts.prefetchTTSInOrder).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(player, { key: 'ArrowRight' });
    expect(screen.getByText('Реплика 2 из 4')).toBeInTheDocument();
    expect(within(activeScene()).getByText('Энтропия')).toBeInTheDocument();
    expect(tts.playTTS).not.toHaveBeenCalled();

    fireEvent.keyDown(player, { key: 'ArrowRight' });
    fireEvent.keyDown(player, { key: 'ArrowLeft' });
    expect(screen.getByText('Реплика 2 из 4')).toBeInTheDocument();

    fireEvent.keyDown(player, { key: ' ' });
    expect(tts.playTTS).toHaveBeenCalledWith(
      'Начнём с главного понятия.',
      'female',
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      HOST_VOICE,
    );
    // The next lines are prepared only once this one sounds: they do not compete with it for the server.
    expect(tts.prefetchTTSInOrder).toHaveBeenCalledTimes(1);

    // Presses while the sound loads (K, Space, the button itself) neither cancel nor restart the loading:
    // a user on a slow network who clicks again and again no longer starts it over every time.
    tts.stopTTS.mockClear();
    const play = screen.getByRole('button', { name: 'Загружаем звук' });
    fireEvent.keyDown(player, { key: 'k' });
    fireEvent.keyDown(player, { key: ' ' });
    fireEvent.click(play);
    expect(tts.stopTTS).not.toHaveBeenCalled();
    expect(tts.playTTS).toHaveBeenCalledTimes(1);
    expect(play).toHaveAccessibleName('Загружаем звук');
    expect(play).toHaveAttribute('aria-busy', 'true');

    // Once the sound plays, K pauses it and K goes on.
    act(() => lastPlay()[4]());
    tts.isTTSSounding.mockReturnValue(true);
    fireEvent.keyDown(player, { key: 'k' });
    expect(tts.pauseTTS).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Продолжить' })).toBeInTheDocument();
    fireEvent.keyDown(player, { key: 'K' });
    expect(tts.resumeTTS).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Пауза' })).toBeInTheDocument();
  });

  it('answers a press at once: a ring on ▶, then «Готовим голос…», and after 6 s that the line can be read', () => {
    vi.useFakeTimers();
    try {
      render(<ConversationPlayer lines={modelLines} />);
      const play = screen.getByRole('button', { name: 'Слушать' });
      expect(play.querySelector('.cv-play-ring')).toBeNull();
      expect(play).not.toHaveAttribute('aria-busy');

      fireEvent.click(play);
      expect(play).toHaveAttribute('data-state', 'loading');
      expect(play).toHaveAttribute('aria-busy', 'true');
      expect(play.querySelector('.cv-play-ring')).not.toBeNull();
      // A fast network gets no words at all: the sound simply starts.
      act(() => vi.advanceTimersByTime(WAIT_NOTE_MS - 1));
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      act(() => vi.advanceTimersByTime(1));
      expect(screen.getByRole('status')).toHaveTextContent('Готовим голос…');

      act(() => vi.advanceTimersByTime(SLOW_NOTE_MS - WAIT_NOTE_MS));
      expect(screen.getByRole('status')).toHaveTextContent(
        'Звук загружается дольше обычного. Реплика уже на экране — её можно читать.',
      );
      // The line is indeed on screen while its sound loads.
      expect(within(screen.getByRole('region', { name: 'Субтитры' })).getByText(modelLines[0].text)).toBeInTheDocument();
      expect(tts.playTTS).toHaveBeenCalledTimes(1);

      // The sound starts: the ring and the note go away.
      act(() => lastPlay()[4]());
      const pause = screen.getByRole('button', { name: 'Пауза' });
      expect(pause).not.toHaveAttribute('aria-busy');
      expect(pause.querySelector('.cv-play-ring')).toBeNull();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();

      // A failed load replaces the note with the honest error and «Повторить».
      act(() => lastPlay()[2]());
      act(() => vi.advanceTimersByTime(WAIT_NOTE_MS));
      expect(screen.getByRole('status')).toHaveTextContent('Готовим голос…');
      act(() => lastPlay()[3]({ code: 'unavailable', reason: 'server' }));
      expect(screen.getByRole('status')).toHaveTextContent('Звук не загрузился. Попробуйте ещё раз.');
      act(() => vi.advanceTimersByTime(SLOW_NOTE_MS));
      expect(screen.getByRole('status')).toHaveTextContent('Звук не загрузился. Попробуйте ещё раз.');
      expect(within(screen.getByRole('status')).getByRole('button', { name: 'Повторить' })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('blames the internet only when the browser itself says the connection is slow', () => {
    expect(waitMessage('wait')).toBe('Готовим голос…');
    expect(waitMessage('slow')).toBe('Звук загружается дольше обычного. Реплика уже на экране — её можно читать.');
    Object.defineProperty(navigator, 'connection', { value: { effectiveType: '3g' }, configurable: true });
    try {
      expect(waitMessage('slow')).toBe('Медленный интернет: звук ещё загружается. Реплика уже на экране — её можно читать.');
    } finally {
      Reflect.deleteProperty(navigator, 'connection');
    }
  });

  it('prepares the sound of the first two lines once the player is on screen, once per conversation', () => {
    const observers: Array<{ callback: (entries: Array<{ isIntersecting: boolean }>) => void; disconnect: ReturnType<typeof vi.fn> }> = [];
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        disconnect = vi.fn();
        observe = vi.fn();
        constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) {
          observers.push({ callback, disconnect: this.disconnect });
        }
      },
    );
    render(<ConversationPlayer lines={modelLines} />);
    expect(observers).toHaveLength(1);
    act(() => observers[0].callback([{ isIntersecting: false }]));
    expect(tts.prefetchTTSInOrder).not.toHaveBeenCalled();

    act(() => observers[0].callback([{ isIntersecting: true }]));
    expect(tts.prefetchTTSInOrder).toHaveBeenCalledTimes(1);
    expect(tts.prefetchTTSInOrder).toHaveBeenCalledWith(
      [
        { text: modelLines[0].text, role: 'male' },
        { text: modelLines[1].text, role: 'female' },
      ],
      { persist: true },
    );
    expect(observers[0].disconnect).toHaveBeenCalled();
    // The same conversation is not prepared twice; the first ▶ plays what is ready.
    act(() => observers[0].callback([{ isIntersecting: true }]));
    expect(tts.prefetchTTSInOrder).toHaveBeenCalledTimes(1);
  });

  it('shows every new picture from its top, even when the sheet was scrolled', () => {
    render(<ConversationPlayer lines={modelLines} />);
    const body = screen.getByRole('region', { name: 'Сцена' }).querySelector('.cv-sheet-body') as HTMLElement;
    body.scrollTop = 30;
    fireEvent.keyDown(screen.getByRole('region', { name: 'Разговор по материалу' }), { key: 'ArrowRight' });
    expect(within(activeScene()).getByRole('heading', { name: 'Энтропия' })).toBeInTheDocument();
    expect(body.scrollTop).toBe(0);
  });

  it('pauses and resumes real sound', async () => {
    const user = userEvent.setup();
    render(<ConversationPlayer lines={modelLines} />);
    await user.click(screen.getByRole('button', { name: 'Слушать' }));
    act(() => lastPlay()[4]());
    tts.isTTSSounding.mockReturnValue(true);

    await user.click(screen.getByRole('button', { name: 'Пауза' }));
    expect(tts.pauseTTS).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Продолжить' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Продолжить' }));
    expect(tts.resumeTTS).toHaveBeenCalledTimes(1);
    expect(tts.playTTS).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Пауза' })).toBeInTheDocument();
  });

  it('plays the next line when a line ends, counts the quest once and stops audio on unmount', () => {
    const { unmount } = render(<ConversationPlayer lines={modelLines} />);
    fireEvent.click(screen.getByRole('button', { name: 'Слушать' }));
    expect(tts.playTTS).toHaveBeenLastCalledWith(
      modelLines[0].text,
      'male',
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      HOST_VOICE,
    );
    expect(quests.updateQuestProgress).not.toHaveBeenCalled();
    act(() => lastPlay()[4]());
    expect(quests.updateQuestProgress).toHaveBeenCalledWith('user-1', 'podcast', 1);

    act(() => lastPlay()[2]());
    expect(tts.playTTS).toHaveBeenLastCalledWith(
      modelLines[1].text,
      'female',
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      HOST_VOICE,
    );
    // Между репликами кнопка остаётся «Пауза», а не мигает загрузкой.
    expect(screen.getByRole('button', { name: 'Пауза' })).toBeInTheDocument();
    act(() => lastPlay()[4]());
    expect(quests.updateQuestProgress).toHaveBeenCalledTimes(1);

    tts.stopTTS.mockClear();
    unmount();
    expect(tts.stopTTS).toHaveBeenCalled();
  });

  it('says honestly when sound is unavailable and lets the user retry', async () => {
    const user = userEvent.setup();
    render(<ConversationPlayer lines={modelLines} />);
    await user.click(screen.getByRole('button', { name: 'Слушать' }));
    act(() => lastPlay()[3]({ code: 'unavailable', reason: 'no-voices' }));

    expect(screen.getByRole('status')).toHaveTextContent('Звук недоступен в этом браузере');
    expect(screen.getByRole('button', { name: 'Слушать' })).toBeInTheDocument();

    await user.click(within(screen.getByRole('status')).getByRole('button', { name: 'Повторить' }));
    expect(tts.forgetTTSFailures).toHaveBeenCalled();
    expect(tts.playTTS).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('creates a conversation from the empty state after the energy check without dropping summary fields', async () => {
    const user = userEvent.setup();
    db.snapshot = {
      summary_json: {
        content: 'Конспект лекции',
        terms: [{ term: 'Энтропия', definition: 'Мера беспорядка.' }],
        cheatsheet: '# Шпаргалка',
        grounding: { source_count: 1, sources: [{ id: 'S01', text: 'Фрагмент' }] },
        source_ids: ['S01'],
        podcast: [],
        _startTab: 'podcast',
      },
      original_text: 'Полный текст лекции о термодинамике.',
    };
    const generated = [
      { speaker: 'Макс', text: 'Начинаем разговор.', visual: { type: 'scene', title: 'Термодинамика', icon: 'flask', caption: 'Тепло и работа' } },
      { speaker: 'Софья', text: 'Энтропия — мера беспорядка.', source_ids: ['S01'] },
    ];
    fetchMock.mockImplementation(() => fetchResponse({ podcast: generated }));
    const onLinesUpdate = vi.fn();

    render(<ConversationPlayer lines={[]} title="Термодинамика" materialId="material-1" onLinesUpdate={onLinesUpdate} />);
    expect(screen.getByText('Для этого материала разговор ещё не создан')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Создать разговор' }));

    await waitFor(() => expect(onLinesUpdate).toHaveBeenCalled());
    expect(energy.verifyEnergy).toHaveBeenCalledWith('user-1', 5, 'Создание разговора');
    expect(fetchMock).toHaveBeenCalledWith('/api/podcast/generate', expect.objectContaining({ method: 'POST' }));
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({
      context: 'Полный текст лекции о термодинамике.',
      title: 'Термодинамика',
      terms: [{ term: 'Энтропия', definition: 'Мера беспорядка.' }],
    });

    expect(db.update).toHaveBeenCalledTimes(1);
    const saved = (db.update.mock.calls[0][0] as { summary_json: Record<string, unknown> }).summary_json;
    expect(saved).toEqual({
      content: 'Конспект лекции',
      terms: [{ term: 'Энтропия', definition: 'Мера беспорядка.' }],
      cheatsheet: '# Шпаргалка',
      grounding: { source_count: 1, sources: [{ id: 'S01', text: 'Фрагмент' }] },
      source_ids: ['S01'],
      podcast: generated,
    });
    expect(saved).not.toHaveProperty('_startTab');
    expect(limits.incrementAIUsage).toHaveBeenCalledWith('user-1', 5);
    expect(onLinesUpdate).toHaveBeenCalledWith(generated);
    expect(toasts.success).toHaveBeenCalledWith('Разговор готов');

    await screen.findByRole('region', { name: 'Сцена' });
    const transcript = openTranscript();
    expect(within(transcript).getByText('Энтропия — мера беспорядка.')).toBeInTheDocument();
  });

  it('keeps fields written while the model was answering', async () => {
    const user = userEvent.setup();
    db.snapshot = { summary_json: { content: 'Конспект' }, original_text: 'Текст лекции.' };
    const generated = [{ speaker: 'Макс', text: 'Начинаем.' }];
    fetchMock.mockImplementation(() => {
      // Пока модель отвечает, в другой вкладке появилась шпаргалка.
      db.snapshot = { summary_json: { content: 'Конспект', cheatsheet: 'Новая шпаргалка' }, original_text: 'Текст лекции.' };
      return fetchResponse({ podcast: generated });
    });

    render(<ConversationPlayer lines={[]} title="Тема" materialId="material-1" />);
    await user.click(screen.getByRole('button', { name: 'Создать разговор' }));
    await waitFor(() => expect(db.update).toHaveBeenCalled());
    const saved = (db.update.mock.calls[0][0] as { summary_json: Record<string, unknown> }).summary_json;
    expect(saved).toEqual({ content: 'Конспект', cheatsheet: 'Новая шпаргалка', podcast: generated });
  });

  it('does not call the model when the energy check fails', async () => {
    const user = userEvent.setup();
    energy.verifyEnergy.mockResolvedValue(false);
    db.snapshot = { summary_json: { content: 'Конспект' }, original_text: 'Текст' };

    render(<ConversationPlayer lines={[]} title="Тема" materialId="material-1" />);
    await user.click(screen.getByRole('button', { name: 'Создать разговор' }));

    await waitFor(() => expect(energy.verifyEnergy).toHaveBeenCalled());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Создать разговор' })).toBeEnabled();
  });

  it('shows a calm error with retry when creation fails and does not charge energy', async () => {
    const user = userEvent.setup();
    db.snapshot = { summary_json: { content: 'Конспект' }, original_text: '' };
    fetchMock.mockImplementation(() => fetchResponse({ detail: 'Не удалось подготовить разговор. Попробуйте ещё раз.' }, false, 502));

    render(<ConversationPlayer lines={[]} title="Тема" materialId="material-1" />);
    await user.click(screen.getByRole('button', { name: 'Создать разговор' }));

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Не удалось подготовить разговор. Попробуйте ещё раз.')).toBeInTheDocument();
    expect(within(alert).getByRole('button', { name: 'Повторить' })).toBeInTheDocument();
    expect(db.update).not.toHaveBeenCalled();
    expect(limits.incrementAIUsage).not.toHaveBeenCalled();
  });

  it('adds model visuals to a legacy conversation and saves them', async () => {
    const user = userEvent.setup();
    db.snapshot = {
      summary_json: { content: 'Конспект', cheatsheet: 'Коротко', podcast: legacyLines },
      original_text: 'Исходный текст',
    };
    // Форма ответа сервера: { visuals: [{ index, visual }] }.
    fetchMock.mockImplementation(() =>
      fetchResponse({ visuals: [{ index: 0, visual: { type: 'steps', title: 'План', items: ['Один', 'Два'] } }] }),
    );
    const onLinesUpdate = vi.fn();

    render(<ConversationPlayer lines={legacyLines} title="Тема" materialId="material-1" onLinesUpdate={onLinesUpdate} />);
    await user.click(screen.getByRole('button', { name: /Добавить схемы/ }));

    await waitFor(() => expect(onLinesUpdate).toHaveBeenCalled());
    expect(energy.verifyEnergy).toHaveBeenCalledWith('user-1', 5, 'Подбор схем');
    expect(fetchMock).toHaveBeenCalledWith('/api/podcast/visuals', expect.objectContaining({ method: 'POST' }));
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.lines).toEqual(legacyLines);
    expect(body.context).toBe('Исходный текст');

    const saved = (db.update.mock.calls[0][0] as { summary_json: Record<string, unknown> }).summary_json;
    expect(saved.cheatsheet).toBe('Коротко');
    expect(saved.podcast).toEqual([
      { ...legacyLines[0], visual: { type: 'steps', title: 'План', items: ['Один', 'Два'] } },
      legacyLines[1],
    ]);
    expect(limits.incrementAIUsage).toHaveBeenCalledWith('user-1', 5);
    await waitFor(() => expect(within(activeScene()).getByText('План')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Добавить схемы/ })).not.toBeInTheDocument();
  });
  it('tells screen readers about the line the user moved to', () => {
    render(<ConversationPlayer lines={modelLines} />);
    const player = screen.getByRole('region', { name: 'Разговор по материалу' });
    const live = player.querySelector('[aria-live="polite"][aria-atomic="true"]') as HTMLElement;
    expect(live).toBeTruthy();
    expect(live.textContent?.trim()).toBe('');

    fireEvent.keyDown(player, { key: 'ArrowRight' });
    expect(live).toHaveTextContent('Реплика 2 из 4. Софья: Начнём с главного понятия. На экране: Термин — Энтропия.');

    fireEvent.click(screen.getByRole('button', { name: 'Следующая реплика' }));
    expect(live).toHaveTextContent('Реплика 3 из 4. Макс: А как проверить себя?');

    // Пока звук идёт, голос сам читает реплику: говорим только, где мы и что на экране.
    const transcript = openTranscript();
    fireEvent.click(within(transcript).getByRole('button', { name: /Посмотрим на цифры из лекции/ }));
    expect(live).toHaveTextContent('Реплика 4 из 4. На экране: График — Температура кипения.');
    expect(live.textContent).not.toContain('Посмотрим на цифры');
  });

  it('keeps keyboard focus inside the player when a scene control is used', async () => {
    const user = userEvent.setup();
    render(<ConversationPlayer lines={modelLines} title="Термодинамика" />);
    const player = screen.getByRole('region', { name: 'Разговор по материалу' });

    // Строка плана исчезает вместе со сценой — фокус переходит на плеер, клавиши продолжают работать.
    await user.click(within(activeScene()).getByRole('button', { name: /Энтропия/ }));
    expect(screen.getByText('Реплика 2 из 4')).toBeInTheDocument();
    expect(player).toHaveFocus();
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowRight' });
    expect(screen.getByText('Реплика 3 из 4')).toBeInTheDocument();

    // «Показать ответ» не пропадает: это переключатель с честным aria-expanded.
    const reveal = within(activeScene()).getByRole('button', { name: 'Показать ответ' });
    expect(reveal).toHaveAttribute('aria-expanded', 'false');
    await user.click(reveal);
    const toggle = within(activeScene()).getByRole('button', { name: 'Скрыть ответ' });
    expect(toggle).toHaveFocus();
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const answer = document.getElementById(toggle.getAttribute('aria-controls') as string) as HTMLElement;
    expect(answer).toHaveAttribute('aria-live', 'polite');
    expect(answer).toHaveTextContent('Энтропия.');
    fireEvent.keyDown(toggle, { key: 'ArrowLeft' });
    expect(screen.getByText('Реплика 2 из 4')).toBeInTheDocument();
  });

  it('gives each host a voice and writes every name in ink, even when the names are spelled in Latin', () => {
    const latin = [
      { speaker: 'Max', text: 'Hi! Today we talk about entropy.' },
      { speaker: 'sofia:', text: 'Let us start with the definition.' },
    ];
    const { container } = render(<ConversationPlayer lines={latin} />);
    fireEvent.click(screen.getByRole('button', { name: 'Слушать' }));
    expect(tts.playTTS).toHaveBeenLastCalledWith(
      'Hi! Today we talk about entropy.',
      'male',
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      HOST_VOICE,
    );
    act(() => lastPlay()[4]());
    expect(tts.prefetchTTSInOrder).toHaveBeenCalledWith([{ text: 'Let us start with the definition.', role: 'female' }], { persist: true });

    // Spec 5.7: the speaker's name is ink (Onest 600 16); the host colours --sf-voice-a/b are gone
    // (#a84a22 read as «wrong»).
    const subtitles = screen.getByRole('region', { name: 'Субтитры' });
    const name = subtitles.querySelector('[data-speaker]') as HTMLElement;
    expect(name).toHaveTextContent('Макс');
    expect(name).toHaveClass('cv-who');
    expect(name.getAttribute('style')).toBeNull();
    const transcript = openTranscript();
    expect(within(transcript).getByText('Софья').getAttribute('style')).toBeNull();
    expect(container.innerHTML).not.toMatch(/sf-voice/);
    expect(screen.getByText(/^Макс и Софья обсуждают лекцию · 2 реплики/)).toBeInTheDocument();
  });

  it('draws no looping voice bars: the ▶ button alone says whether the sound plays', () => {
    const { container } = render(<ConversationPlayer lines={modelLines} />);
    expect(container.querySelector('[data-waveform]')).toBeNull();
    const play = screen.getByRole('button', { name: 'Слушать' });
    expect(play).toHaveAttribute('data-state', 'idle');
    fireEvent.click(play);
    expect(play).toHaveAttribute('data-state', 'loading');
    act(() => lastPlay()[4]());
    expect(screen.getByRole('button', { name: 'Пауза' })).toHaveAttribute('data-state', 'playing');
    expect(container.querySelector('.animate-spin')).toBeNull();
  });

  it('marks only verified quotes as quotes and says nothing about unchecked pictures', async () => {
    const user = userEvent.setup();
    const sources = [
      { id: 'S01', text: 'Герман Эббингауз в 1885 году описал кривую забывания.' },
      { id: 'S02', text: 'Каждое повторение делает след памяти прочнее, поэтому кривая забывания становится пологой.' },
    ];
    const lines = [
      { speaker: 'Макс', text: 'Что сказано в материале?', source_ids: ['S01'], visual: { type: 'fact', title: 'Повторение', text: 'Каждое повторение делает след памяти прочнее…' } },
      { speaker: 'Софья', text: 'А это уже выдумка.', source_ids: ['S01'], visual: { type: 'fact', title: 'Сон', text: 'Эббингауз лично доказал, что сон удваивает память.' } },
      { speaker: 'Макс', text: 'Формула?', source_ids: ['S01'], visual: { type: 'formula', title: 'Кривая', latex: 'R = e^{-t/S}' } },
    ];
    render(<ConversationPlayer lines={lines} sources={sources} />);

    let scene = activeScene();
    // A verified quote: «ёлочки» and the source note in the corner; no «Цитата» label over it.
    expect(within(scene).queryByText('Цитата')).not.toBeInTheDocument();
    expect(scene.querySelector('blockquote')).toHaveTextContent('«Каждое повторение делает след памяти прочнее…»');
    const fragment = within(scene).getByRole('button', { name: 'фрагмент 2' });
    expect(scene.querySelector('[data-source-note]')).toHaveTextContent('Из лекции, фрагмент 2');
    await user.click(fragment);
    expect(fragment).toHaveAttribute('aria-expanded', 'true');
    // The fragment opens as a slip over the sheet, so the quote can be checked word for word.
    const slip = within(scene).getByRole('region', { name: 'Лекция, фрагмент 2' });
    expect(within(slip).getByText(sources[1].text)).toBeInTheDocument();
    fireEvent.keyDown(within(slip).getByRole('button', { name: 'Закрыть фрагмент' }), { key: 'Escape' });
    expect(within(scene).queryByRole('region', { name: 'Лекция, фрагмент 2' })).not.toBeInTheDocument();
    expect(fragment).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Следующая реплика' }));
    scene = activeScene();
    expect(within(scene).getByText('Пересказ')).toHaveClass('cv-kind');
    expect(scene.querySelector('blockquote')).toBeNull();
    expect(scene.textContent).not.toContain('«');
    expect(scene.querySelector('[data-source-note]')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Следующая реплика' }));
    scene = activeScene();
    expect(within(scene).getByRole('heading', { name: 'Кривая' })).toBeInTheDocument();
    expect(within(scene).queryByText('Формула')).not.toBeInTheDocument();
    expect(scene.querySelector('[data-source-note]')).toBeNull();
    expect(scene.textContent).not.toMatch(/Из лекции|Из материала|S01/);
  });

  it('does not offer paid model work on a material the user cannot change', () => {
    render(<ConversationPlayer lines={[]} materialId="material-1" canEdit={false} />);
    expect(screen.getByText('Разговор может создать только автор материала.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Создать разговор' })).not.toBeInTheDocument();
    cleanup();
    render(<ConversationPlayer lines={legacyLines} materialId="material-1" canEdit={false} />);
    expect(screen.queryByRole('button', { name: /Добавить схемы/ })).not.toBeInTheDocument();
  });

  it('stores the fragments the server found for added charts instead of the old word-matched ones', async () => {
    const user = userEvent.setup();
    const lines = [
      { speaker: 'Макс', text: 'Сколько помнил Эббингауз?', source_ids: ['S01'] },
      { speaker: 'Софья', text: 'Цифры такие.', source_ids: ['S01'] },
    ];
    db.snapshot = { summary_json: { content: 'Конспект', podcast: lines }, original_text: 'Текст' };
    const chart = { type: 'chart', title: 'Кривая', kind: 'line', unit: '%', data: [{ label: '20 мин', value: 58 }, { label: '1 день', value: 33 }] };
    fetchMock.mockImplementation(() =>
      fetchResponse({ visuals: [{ index: 1, visual: chart, source_ids: ['S03'] }, { index: 0, visual: { type: 'term', term: 'Память', definition: 'Способность помнить.' } }] }),
    );
    render(<ConversationPlayer lines={lines} materialId="material-1" />);
    await user.click(screen.getByRole('button', { name: /Добавить схемы/ }));
    await waitFor(() => expect(db.update).toHaveBeenCalled());
    const saved = (db.update.mock.calls[0][0] as { summary_json: { podcast: Array<Record<string, unknown>> } }).summary_json.podcast;
    expect(saved[1]).toMatchObject({ source_ids: ['S03'], visual: { type: 'chart' } });
    expect(saved[0]).toMatchObject({ source_ids: ['S01'], visual: { type: 'term' } });
  });

  it('has one speed button that cycles 1× → 1,25× → 1,5× → 2× with Russian decimals', () => {
    render(<ConversationPlayer lines={modelLines} />);
    // One button instead of the four chips.
    expect(screen.getAllByRole('button', { name: /^Скорость/ })).toHaveLength(1);
    expect(screen.queryByRole('group', { name: 'Скорость' })).not.toBeInTheDocument();
    const speed = screen.getByRole('button', { name: 'Скорость 1×, изменить' });
    expect(speed).toHaveTextContent('1×');
    for (const [label, rate] of [['1,25×', 1.25], ['1,5×', 1.5], ['2×', 2], ['1×', 1]] as const) {
      fireEvent.click(speed);
      expect(speed).toHaveTextContent(label);
      expect(speed).toHaveAccessibleName(`Скорость ${label}, изменить`);
      expect(tts.setTTSPlaybackRate).toHaveBeenLastCalledWith(rate);
    }
    expect(speedLabel(1.25)).toBe('1,25×');
    expect(nextSpeed(2)).toBe(1);
    // A rate stored outside the cycle starts it again from 1×.
    expect(nextSpeed(1.75)).toBe(1);
  });

  it('shows one segment per line, marks the current and the heard ones and says «Реплика N из M»', () => {
    const fourteen = Array.from({ length: 14 }, (_, index) => ({ speaker: index % 2 ? 'Софья' : 'Макс', text: `Реплика номер ${index + 1}.` }));
    render(<ConversationPlayer lines={fourteen} />);
    const group = screen.getByRole('group', { name: 'Реплики' });
    const segments = within(group).getAllByRole('button');
    expect(segments).toHaveLength(14);
    segments.forEach((segment, index) => {
      expect(segment).toHaveAccessibleName(`Реплика ${index + 1}`);
      // The segments are a pointer shortcut; the keyboard has ← → and the transcript.
      expect(segment).toHaveAttribute('tabindex', '-1');
    });
    expect(screen.getByText('Реплика 1 из 14')).toBeInTheDocument();

    fireEvent.click(segments[7]);
    expect(screen.getByText('Реплика 8 из 14')).toBeInTheDocument();
    expect(segments[7]).toHaveAttribute('aria-current', 'step');
    expect(segments.filter(segment => segment.hasAttribute('data-past'))).toHaveLength(7);
    expect(segments.slice(8).every(segment => !segment.hasAttribute('data-past') && !segment.hasAttribute('aria-current'))).toBe(true);
    expect(within(screen.getByRole('region', { name: 'Субтитры' })).getByText('Реплика номер 8.')).toBeInTheDocument();
    expect(tts.playTTS).not.toHaveBeenCalled();
  });

  it('opens the transcript as a panel over the sheet from its link; Escape and × close it and give the focus back', async () => {
    const user = userEvent.setup();
    render(<ConversationPlayer lines={modelLines} />);
    const link = screen.getByRole('button', { name: 'Текст разговора' });
    expect(link).toHaveAttribute('aria-expanded', 'false');

    await user.click(link);
    expect(link).toHaveAttribute('aria-expanded', 'true');
    const panel = screen.getByRole('complementary', { name: 'Текст разговора' });
    expect(link).toHaveAttribute('aria-controls', panel.id);
    // The panel lies over the sheet (inside the stage), not in a column next to it.
    expect(panel.closest('.cv-stage')).not.toBeNull();
    expect(within(panel).getAllByRole('listitem')).toHaveLength(4);
    // The focus goes to the current line: Enter plays it, Escape closes the panel.
    expect(within(panel).getByRole('button', { name: /Привет! Сегодня разбираем термодинамику/ })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('complementary', { name: 'Текст разговора' })).not.toBeInTheDocument();
    expect(link).toHaveFocus();
    expect(link).toHaveAttribute('aria-expanded', 'false');

    await user.click(link);
    await user.click(screen.getByRole('button', { name: 'Закрыть текст разговора' }));
    expect(screen.queryByRole('complementary', { name: 'Текст разговора' })).not.toBeInTheDocument();
    expect(link).toHaveFocus();

    // The keys of the player keep working while the panel is open.
    await user.click(link);
    const player = screen.getByRole('region', { name: 'Разговор по материалу' });
    fireEvent.keyDown(player, { key: 'ArrowRight' });
    expect(screen.getByText('Реплика 2 из 4')).toBeInTheDocument();
    expect(within(screen.getByRole('complementary', { name: 'Текст разговора' })).getByRole('button', { name: /Начнём с главного понятия/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  it('keeps one paper sheet with every picture of an old conversation and no white panel around the player', () => {
    // Old summary_json.podcast shapes: no visuals, lower-case source ids, a broken visual, a visual of every kind.
    const old = [
      { speaker: 'max', text: 'Привет, начинаем.' },
      { speaker: 'Софья', text: 'Энтропия растёт.', source_ids: ['s01'] },
      { speaker: 'Макс', text: 'Схема.', visual: { type: 'diagram', title: 'Связь', nodes: [{ id: 1, label: 'Тепло' }, { id: 2, label: 'Работа' }], edges: [{ from: 1, to: 2, label: 'превращается' }] } },
      { speaker: 'Софья', text: 'Шаги.', visual: { type: 'steps', title: 'Цикл Карно', items: ['Нагрев', 'Расширение', 'Охлаждение'] } },
      { speaker: 'Макс', text: 'Сломанное.', visual: { type: 'chart', title: 'Нет чисел', data: [{ label: 'А', value: 'много' }] } },
      { speaker: 'Софья', text: 'Даты.', visual: { type: 'timeline', title: 'История', events: [{ date: '1824', label: 'Карно' }, { date: '1850', label: 'Клаузиус' }] } },
      { speaker: 'Макс', text: 'Сравним.', visual: { type: 'compare', title: 'Два начала', left: { label: 'Первое', points: ['Энергия сохраняется'] }, right: { label: 'Второе', points: ['Энтропия растёт'] } } },
    ];
    const sources = [{ id: 'S01', text: 'Энтропия изолированной системы не убывает.' }];
    const { container } = render(<ConversationPlayer lines={old} sources={sources} title="Термодинамика" />);
    const sheet = screen.getByRole('region', { name: 'Сцена' });
    expect(sheet).toHaveClass('sf-sheet');
    expect(container.querySelectorAll('.sf-sheet')).toHaveLength(1);
    expect(container.querySelector('.rounded-xl, .bg-\\[var\\(--sf-surface\\)\\]')).toBeNull();
    // Every picture of the conversation is laid out once (invisible copies give the sheet its height).
    const kinds = [...sheet.querySelectorAll('[data-scene-layer="measure"] [class~="min-w-0"]')].length;
    expect(kinds).toBeGreaterThanOrEqual(5);

    const player = screen.getByRole('region', { name: 'Разговор по материалу' });
    const shown: string[] = [];
    for (let index = 0; index < old.length; index += 1) {
      shown.push(activeScene().querySelector('[data-visual-type]')?.getAttribute('data-visual-type') ?? '');
      fireEvent.keyDown(player, { key: 'ArrowRight' });
    }
    // The cover, the quote found by source_ids, the model's pictures; the broken chart carries the steps.
    expect(shown).toEqual(['scene', 'fact', 'diagram', 'steps', 'steps', 'timeline', 'compare']);
    expect(within(activeScene()).getByText('Энергия сохраняется')).toBeInTheDocument();
  });

  it('knows the height of the sheet for every window, the 1280×720 projector window included', () => {
    expect(sheetMetrics(1440, 900)).toEqual({ height: 392, max: 520, padTop: 28, padBottom: 26 });
    expect(sheetMetrics(1024, 900).height).toBe(392);
    expect(sheetMetrics(800, 900)).toEqual({ height: 360, max: 520, padTop: 28, padBottom: 26 });
    expect(sheetMetrics(390, 844)).toEqual({ height: 336, max: 520, padTop: 16, padBottom: 14 });
    // The low window (≥1024 wide, ≤780 high): what is left of 100vh, at least 300, and no growth.
    expect(sheetMetrics(1280, 720)).toEqual({ height: 344, max: 344, padTop: 22, padBottom: 18 });
    expect(sheetMetrics(1366, 640)).toEqual({ height: 300, max: 300, padTop: 22, padBottom: 18 });
    expect(sheetMetrics(1280, 781).height).toBe(392);
  });

  it('sets a long line a step smaller so that the subtitle keeps to its reserved lines', () => {
    const style = document.createElement('style');
    style.textContent = '.cv-line { min-height: 108px; }';
    document.head.appendChild(style);
    const heights: Record<string, number> = { '0': 180, '1': 140, '2': 104 };
    const spy = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('cv-line') ? heights[this.getAttribute('data-fit') ?? '0'] : 0;
    });
    try {
      render(<ConversationPlayer lines={modelLines} />);
      const line = within(screen.getByRole('region', { name: 'Субтитры' })).getByText(modelLines[0].text);
      expect(line).toHaveAttribute('data-fit', '2');
      heights['0'] = 100;
      fireEvent.keyDown(screen.getByRole('region', { name: 'Разговор по материалу' }), { key: 'ArrowRight' });
      expect(within(screen.getByRole('region', { name: 'Субтитры' })).getByText(modelLines[1].text)).toHaveAttribute('data-fit', '0');
    } finally {
      spy.mockRestore();
      style.remove();
    }
  });

  it('speaks every line with the server voice only and says honestly when the sound did not load', async () => {
    const user = userEvent.setup();
    render(<ConversationPlayer lines={modelLines} />);
    await user.click(screen.getByRole('button', { name: 'Слушать' }));
    // fallback 'none': Max is never read by the browser voice; persist: a replay and a revisit need no server.
    expect(lastPlay()[5]).toEqual(HOST_VOICE);

    // The speech module asked the server three times and gave up: no other voice, an honest message.
    act(() => lastPlay()[3]({ code: 'unavailable', reason: 'server' }));
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Звук не загрузился. Попробуйте ещё раз.');
    expect(screen.getByRole('button', { name: 'Слушать' })).toBeInTheDocument();
    // Only the warm-up of the first two lines; nothing more is asked of a server that has just failed.
    expect(tts.prefetchTTSInOrder).toHaveBeenCalledTimes(1);

    // «Повторить» forgets the failures first, then asks for the same line again.
    await user.click(within(status).getByRole('button', { name: 'Повторить' }));
    expect(tts.forgetTTSFailures).toHaveBeenCalledTimes(1);
    expect(tts.playTTS).toHaveBeenCalledTimes(2);
    expect(tts.forgetTTSFailures.mock.invocationCallOrder[0]).toBeLessThan(tts.playTTS.mock.invocationCallOrder[1]);
    expect(lastPlay()[0]).toBe(modelLines[0].text);
    expect(lastPlay()[5]).toEqual(HOST_VOICE);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('prepares the first two lines on screen, then the next three one plan at a time, once the current line is heard', () => {
    const six = Array.from({ length: 6 }, (_, index) => ({ speaker: index % 2 ? 'Софья' : 'Макс', text: `Реплика номер ${index + 1}.` }));
    const line = (number: number) => ({ text: `Реплика номер ${number}.`, role: number % 2 ? 'male' : 'female' });
    const { unmount } = render(<ConversationPlayer lines={six} />);
    // The player is on screen (no IntersectionObserver here: at once) — the first ▶ will not wait for the server.
    expect(tts.prefetchTTSInOrder).toHaveBeenCalledTimes(1);
    expect(tts.prefetchTTSInOrder).toHaveBeenLastCalledWith([line(1), line(2)], { persist: true });
    fireEvent.click(screen.getByRole('button', { name: 'Слушать' }));
    expect(tts.prefetchTTSInOrder).toHaveBeenCalledTimes(1);

    act(() => lastPlay()[4]());
    expect(tts.prefetchTTSInOrder).toHaveBeenLastCalledWith([line(2), line(3), line(4)], { persist: true });

    // The second line starts loading: nothing new until it sounds, then the plan moves one line on.
    act(() => lastPlay()[2]());
    expect(tts.prefetchTTSInOrder).toHaveBeenCalledTimes(2);
    act(() => lastPlay()[4]());
    expect(tts.prefetchTTSInOrder).toHaveBeenLastCalledWith([line(3), line(4), line(5)], { persist: true });

    // A jump to the fifth line: only what is left after it.
    fireEvent.click(screen.getByRole('button', { name: 'Реплика 5' }));
    act(() => lastPlay()[4]());
    expect(tts.prefetchTTSInOrder).toHaveBeenLastCalledWith([line(6)], { persist: true });

    // The last line has nothing after it.
    act(() => lastPlay()[2]());
    act(() => lastPlay()[4]());
    expect(tts.prefetchTTSInOrder).toHaveBeenCalledTimes(4);

    // Leaving the page stops the queue.
    unmount();
    expect(tts.prefetchTTSInOrder).toHaveBeenLastCalledWith([]);
  });

  it('shows and speaks the lines without markdown and leaves the saved lines untouched', () => {
    const marked = [
      {
        speaker: 'Софья',
        text: 'Есть уровни изоляции. Например, `Read Committed` исключает грязное чтение. А `Repeatable Read`, который строже…',
      },
      { speaker: 'Макс', text: '## Итог\n**Главное**: *грязное* чтение — это ***плохо***. Подробнее [в лекции](https://example.com/lecture).' },
    ];
    const saved = JSON.parse(JSON.stringify(marked));
    const clean = 'Есть уровни изоляции. Например, Read Committed исключает грязное чтение. А Repeatable Read, который строже…';
    render(<ConversationPlayer lines={marked} />);

    const subtitles = screen.getByRole('region', { name: 'Субтитры' });
    expect(within(subtitles).getByText(clean)).toBeInTheDocument();
    expect(subtitles.textContent).not.toMatch(/[`*#]/);

    fireEvent.click(screen.getByRole('button', { name: 'Слушать' }));
    expect(lastPlay()[0]).toBe(clean);
    act(() => lastPlay()[4]());
    expect(tts.prefetchTTSInOrder).toHaveBeenLastCalledWith(
      [{ text: 'Итог\nГлавное: грязное чтение — это плохо. Подробнее в лекции.', role: 'male' }],
      { persist: true },
    );

    const transcript = openTranscript();
    expect(transcript.textContent).not.toMatch(/[`*#]|https?:/);
    expect(within(transcript).getByText(/Главное: грязное чтение — это плохо\. Подробнее в лекции\./)).toBeInTheDocument();
    // Only what is shown and spoken changes; the stored conversation stays as it was.
    expect(marked).toEqual(saved);
  });

  it('strips markdown but keeps code, identifiers and arithmetic intact', () => {
    expect(plainLineText('Например, `Read Committed` исключает…')).toBe('Например, Read Committed исключает…');
    expect(plainLineText('**жирный**, *курсив*, ***оба***')).toBe('жирный, курсив, оба');
    expect(plainLineText('**Важно *очень* важно**')).toBe('Важно очень важно');
    expect(plainLineText('# Заголовок\n- пункт списка')).toBe('Заголовок\nпункт списка');
    expect(plainLineText('Читайте [главу 2](https://example.com/ch2) и ~~не~~ спешите')).toBe('Читайте главу 2 и не спешите');
    expect(plainLineText('Пример:\n```python\nprint(1)\n```')).toBe('Пример:\nprint(1)');
    expect(plainLineText('Инлайн ```Read Committed``` тоже')).toBe('Инлайн Read Committed тоже');
    // Code keeps its own symbols, words keep their underscores, arithmetic keeps its stars.
    expect(plainLineText('Метод `__init__` и переменная snake_case_name')).toBe('Метод __init__ и переменная snake_case_name');
    expect(plainLineText('Аргументы `*args, **kwargs` в Python')).toBe('Аргументы *args, **kwargs в Python');
    expect(plainLineText('Считаем 2*3*4 и a * b')).toBe('Считаем 2*3*4 и a * b');
    expect(plainLineText('C# и #хештег остаются')).toBe('C# и #хештег остаются');
    expect(plainLineText('Обычная реплика без разметки.')).toBe('Обычная реплика без разметки.');
    // Nothing would be left: the line stays as it was rather than going blank.
    expect(plainLineText('**')).toBe('**');
  });
});

describe('ConversationPlayer with the real speech module', () => {
  /** Plays at once; the test says when the sound «starts» (playing) or ends. */
  class FakeAudio {
    static instances: FakeAudio[] = [];
    src: string;
    paused = true;
    playbackRate = 1;
    currentTime = 0;
    onended: (() => void) | null = null;
    onerror: (() => void) | null = null;
    private listeners = new Map<string, Array<() => void>>();

    constructor(src: string) {
      this.src = src;
      FakeAudio.instances.push(this);
    }

    addEventListener(type: string, listener: () => void) {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    }

    emit(type: string) {
      (this.listeners.get(type) ?? []).forEach(listener => listener());
    }

    play() {
      this.paused = false;
      return Promise.resolve();
    }

    pause() {
      this.paused = true;
    }
  }

  class FakeUtterance {
    constructor(readonly text: string) {}
  }

  class FakeResponse {
    constructor(private readonly body: Blob) {}
    async blob() {
      return this.body;
    }
  }

  let fetchMock: ReturnType<typeof vi.fn>;
  let synth: { speak: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn>; getVoices: () => unknown[] };
  let urls = 0;

  const ttsRequests = () =>
    fetchMock.mock.calls
      .filter(([url]) => url === '/api/tts')
      .map(([, init]) => JSON.parse(String((init as RequestInit).body)).text as string);

  /** Every speech function of the mocked module calls the real one. */
  async function useRealSpeech() {
    const actual = await vi.importActual<typeof import('../../utils/tts')>('../../utils/tts');
    tts.playTTS.mockImplementation(actual.playTTS);
    tts.pauseTTS.mockImplementation(actual.pauseTTS);
    tts.resumeTTS.mockImplementation(actual.resumeTTS);
    tts.stopTTS.mockImplementation(actual.stopTTS);
    tts.prefetchTTSInOrder.mockImplementation(actual.prefetchTTSInOrder);
    tts.isTTSSounding.mockImplementation(actual.isTTSSounding);
    tts.getTTSPlaybackRate.mockImplementation(actual.getTTSPlaybackRate);
    tts.setTTSPlaybackRate.mockImplementation(actual.setTTSPlaybackRate);
    tts.forgetTTSFailures.mockImplementation(actual.forgetTTSFailures);
    actual.forgetTTSFailures();
    return actual;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    resetJobsForTests();
    FakeAudio.instances = [];
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('Audio', FakeAudio);
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
    vi.stubGlobal('Response', FakeResponse);
    synth = { speak: vi.fn(), cancel: vi.fn(), getVoices: () => [{ name: 'Google русский', lang: 'ru-RU' }] };
    Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true, writable: true });
    Object.defineProperty(URL, 'createObjectURL', { value: () => `blob:clip-${++urls}`, configurable: true, writable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: () => undefined, configurable: true, writable: true });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(window, 'speechSynthesis');
    Reflect.deleteProperty(URL, 'createObjectURL');
    Reflect.deleteProperty(URL, 'revokeObjectURL');
  });

  it('never lends Max another voice: with the server down it retries, then says the sound did not load', async () => {
    vi.useFakeTimers();
    const actual = await useRealSpeech();
    let serverUp = false;
    fetchMock.mockImplementation(async (url: string) => {
      if (url !== '/api/tts') throw new Error(`unexpected request ${url}`);
      return serverUp
        ? { ok: true, status: 200, blob: async () => new Blob(['mp3']) }
        : { ok: false, status: 502, headers: new Headers(), blob: async () => new Blob() };
    });
    const lines = [
      { speaker: 'Макс', text: 'Макс начинает разговор о транзакциях.' },
      { speaker: 'Софья', text: 'Софья рассказывает про уровни изоляции.' },
    ];
    render(<ConversationPlayer lines={lines} />);

    fireEvent.click(screen.getByRole('button', { name: 'Слушать' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    // ▶ shares the warm-up's request for Max's line and then tries twice more (after 1 s, after 3 more s);
    // the warm-up asked for Sofia's line once. The browser voice never speaks.
    const asked = (text: string) => ttsRequests().filter(request => request === text).length;
    expect(asked(lines[0].text)).toBe(3);
    expect(asked(lines[1].text)).toBe(1);
    expect(synth.speak).not.toHaveBeenCalled();
    expect(FakeAudio.instances).toHaveLength(0);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Звук не загрузился. Попробуйте ещё раз.');

    // The server is back: «Повторить» plays Max's line in Max's server voice.
    serverUp = true;
    fireEvent.click(within(status).getByRole('button', { name: 'Повторить' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(asked(lines[0].text)).toBe(4);
    expect(FakeAudio.instances).toHaveLength(1);
    act(() => FakeAudio.instances[0].emit('playing'));
    expect(screen.getByRole('button', { name: 'Пауза' })).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    // Once Max sounds, Sofia's line is prepared — by the server, too.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(asked(lines[1].text)).toBe(2);
    expect(ttsRequests()[ttsRequests().length - 1]).toBe(lines[1].text);
    expect(synth.speak).not.toHaveBeenCalled();
    actual.stopTTS();
  });

  it('prepares the first two lines on screen and the next ones once the sound starts, one request at a time; a replay needs no server', async () => {
    await useRealSpeech();
    const stored = new Map<string, FakeResponse>();
    const cache = {
      match: vi.fn(async (url: string) => stored.get(String(url))),
      put: vi.fn(async (url: string, response: FakeResponse) => {
        stored.set(String(url), response);
      }),
      keys: vi.fn(async () => Array.from(stored.keys())),
      delete: vi.fn(async (url: string) => stored.delete(String(url))),
    };
    vi.stubGlobal('caches', { open: vi.fn(async () => cache) });
    const pending: Array<() => void> = [];
    let inFlight = 0;
    let mostInFlight = 0;
    fetchMock.mockImplementation((url: string) => {
      if (url !== '/api/tts') throw new Error(`unexpected request ${url}`);
      inFlight += 1;
      mostInFlight = Math.max(mostInFlight, inFlight);
      return new Promise(resolve => {
        pending.push(() => {
          inFlight -= 1;
          resolve({ ok: true, status: 200, blob: async () => new Blob(['mp3']) });
        });
      });
    });
    const lines = Array.from({ length: 5 }, (_, index) => ({
      speaker: index % 2 ? 'Софья' : 'Макс',
      text: `Сохраняемая реплика ${index + 1}.`,
    }));
    render(<ConversationPlayer lines={lines} />);

    // The player is on screen: the first line is asked for before any press, and only it.
    await waitFor(() => expect(pending).toHaveLength(1));
    expect(ttsRequests()).toEqual([lines[0].text]);
    // ▶ while it loads joins that request instead of asking again.
    fireEvent.click(screen.getByRole('button', { name: 'Слушать' }));
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 20));
    });
    expect(ttsRequests()).toEqual([lines[0].text]);
    act(() => pending.shift()?.());
    await waitFor(() => expect(FakeAudio.instances).toHaveLength(1));
    // Then the second line of the warm-up, still one request at a time.
    await waitFor(() => expect(pending).toHaveLength(1));
    expect(ttsRequests()).toEqual([lines[0].text, lines[1].text]);
    act(() => pending.shift()?.());

    // The first line sounds: the lines after the ready second one follow.
    act(() => FakeAudio.instances[0].emit('playing'));
    for (const next of [2, 3]) {
      await waitFor(() => expect(pending).toHaveLength(1));
      expect(ttsRequests()).toEqual(lines.slice(0, next + 1).map(line => line.text));
      act(() => pending.shift()?.());
    }
    await waitFor(() => expect(stored.size).toBe(4));
    expect(Array.from(stored.keys()).every(key => /^\/__tts\/(male|female)\/[0-9a-f]{64}$/.test(key))).toBe(true);

    // Line 1 ends: line 2 is ready and plays without a request; then line 5 is prepared.
    act(() => FakeAudio.instances[0].onended?.());
    await waitFor(() => expect(FakeAudio.instances).toHaveLength(2));
    expect(ttsRequests()).toHaveLength(4);
    act(() => FakeAudio.instances[1].emit('playing'));
    await waitFor(() => expect(pending).toHaveLength(1));
    expect(ttsRequests()[4]).toBe(lines[4].text);
    act(() => pending.shift()?.());
    await waitFor(() => expect(stored.size).toBe(5));
    expect(mostInFlight).toBe(1);

    // A replay from the first line asks the server for nothing.
    fireEvent.click(screen.getByRole('button', { name: 'Реплика 1' }));
    await waitFor(() => expect(FakeAudio.instances).toHaveLength(3));
    act(() => FakeAudio.instances[2].emit('playing'));
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 20));
    });
    expect(ttsRequests()).toHaveLength(5);
    expect(synth.speak).not.toHaveBeenCalled();
  });
});
