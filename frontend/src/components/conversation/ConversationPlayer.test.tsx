import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConversationPlayer from './ConversationPlayer';

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

describe('ConversationPlayer', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
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

  it('opens with an outline of what will be on screen and the transcript', async () => {
    const user = userEvent.setup();
    render(<ConversationPlayer lines={modelLines} title="Термодинамика" />);

    const transcript = screen.getByRole('complementary', { name: 'Текст разговора' });
    for (const line of modelLines) {
      expect(within(transcript).getByText(line.text)).toBeInTheDocument();
    }
    expect(screen.getByText('Реплика 1 из 4')).toBeInTheDocument();
    expect(screen.getByText('4 реплики · около 1 мин')).toBeInTheDocument();

    const scene = activeScene();
    expect(within(scene).getByText('О чём разговор')).toBeInTheDocument();
    expect(within(scene).getByText('Тепло и работа')).toBeInTheDocument();
    expect(within(scene).getByRole('button', { name: /Энтропия.*реплика 2/ })).toBeInTheDocument();
    expect(screen.queryByText('Подобрано по словам реплики')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Добавить схемы/ })).not.toBeInTheDocument();

    // Строка плана ведёт к своей реплике, но не включает звук сама.
    await user.click(within(scene).getByRole('button', { name: /Температура кипения/ }));
    expect(screen.getByText('Реплика 4 из 4')).toBeInTheDocument();
    expect(tts.playTTS).not.toHaveBeenCalled();
  });

  it('shows the clicked line visual, says where the numbers come from and plays from it', async () => {
    const user = userEvent.setup();
    render(<ConversationPlayer lines={modelLines} title="Термодинамика" />);

    const transcript = screen.getByRole('complementary', { name: 'Текст разговора' });
    await user.click(within(transcript).getByRole('button', { name: /Посмотрим на цифры из лекции/ }));

    const scene = activeScene();
    expect(within(scene).getByText('График')).toBeInTheDocument();
    expect(within(scene).getByText('Температура кипения, °C')).toBeInTheDocument();
    expect(within(scene).getByText('Числа из материала')).toBeInTheDocument();
    expect(within(scene).getByText('S02')).toBeInTheDocument();
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
    expect(within(term).getByText('Энтропия')).toBeInTheDocument();
    expect(within(term).getByText('Подобрано по словам реплики')).toBeInTheDocument();
  });

  it('reveals the answer of a question card', async () => {
    const user = userEvent.setup();
    render(<ConversationPlayer lines={modelLines} />);

    const transcript = screen.getByRole('complementary', { name: 'Текст разговора' });
    await user.click(within(transcript).getByRole('button', { name: /А как проверить себя/ }));

    const scene = activeScene();
    expect(within(scene).getByText('Проверьте себя')).toBeInTheDocument();
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

    const transcript = await screen.findByRole('complementary', { name: 'Текст разговора' });
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
});
