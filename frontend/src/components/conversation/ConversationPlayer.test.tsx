import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConversationPlayer, { nextSpeed, sheetMetrics, speedLabel } from './ConversationPlayer';
import { resetJobsForTests } from './jobs';

const tts = vi.hoisted(() => ({
  playTTS: vi.fn(),
  pauseTTS: vi.fn(),
  resumeTTS: vi.fn(),
  stopTTS: vi.fn(),
  prefetchTTS: vi.fn(),
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

type PlayCall = [string, string, () => void, (error: unknown) => void, () => void];
const lastPlay = () => tts.playTTS.mock.calls[tts.playTTS.mock.calls.length - 1] as PlayCall;

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
    tts.prefetchTTS.mockResolvedValue(null);
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

  it('moves between lines with the keyboard and toggles playback with Space and K', () => {
    render(<ConversationPlayer lines={modelLines} />);
    const player = screen.getByRole('region', { name: 'Разговор по материалу' });

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
    );
    expect(tts.prefetchTTS).toHaveBeenCalledWith('А как проверить себя?', 'male');

    // Нажатие во время загрузки отменяет её; «Продолжить» начнёт реплику заново.
    fireEvent.keyDown(player, { key: 'k' });
    expect(tts.stopTTS).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Продолжить' })).toBeInTheDocument();
    fireEvent.keyDown(player, { key: 'k' });
    expect(tts.playTTS).toHaveBeenCalledTimes(2);
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
    expect(tts.playTTS).toHaveBeenLastCalledWith('Hi! Today we talk about entropy.', 'male', expect.any(Function), expect.any(Function), expect.any(Function));
    expect(tts.prefetchTTS).toHaveBeenCalledWith('Let us start with the definition.', 'female');

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
});
