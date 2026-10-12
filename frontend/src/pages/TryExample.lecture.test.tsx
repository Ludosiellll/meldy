import { StrictMode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/** Anything the page asks of an account: the Supabase client must never be touched. */
const watch = vi.hoisted(() => ({ supabase: [] as string[] }));

vi.mock('../lib/supabase', () => ({
  supabase: new Proxy(
    {},
    {
      get(_target, key) {
        watch.supabase.push(String(key));
        return () => {
          throw new Error(`The lecture example must not use supabase.${String(key)}`);
        };
      },
    },
  ),
}));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: null, session: null, loading: false, signOut: vi.fn() }) }));
vi.mock('../contexts/ConfirmContext', () => ({ useConfirm: () => ({ confirm: vi.fn(async () => true), alert: vi.fn() }) }));
vi.mock('../lib/telemetry', async (importOriginal) => ({ ...(await importOriginal<typeof import('../lib/telemetry')>()), track: vi.fn() }));

import TryExample from './TryExample';
import { track } from '../lib/telemetry';
import { tryLecturePart } from '../components/example/tryParts';
import { LECTURE_EXAMPLE_NOTE, exampleLectureVoice } from '../components/example/ExampleLecture';
import { EXAMPLE_LECTURE_RESULTS, EXAMPLE_LECTURE_SOURCE } from '../data/exampleLecture';
import { prefetchTTS } from '../utils/tts';

/** The browser's audio element, driven by the test: what it was given to play, and its events. */
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
    (this.listeners.get(type) ?? []).forEach((listener) => listener());
  }
  play() {
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
}

const FILE = /^\/example\/lecture\/podcast\/\d\d\.mp3$/;
let requests: string[] = [];
/** The object URLs the voice engine made, and the file each one holds. */
const blobs = new Map<string, Blob>();

const plain = (text: string | null | undefined) => (text ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
const fileOf = async (audio: FakeAudio) => (await blobs.get(audio.src)?.text()) ?? `not a file of the example: ${audio.src}`;

function renderLecture({ strict = false } = {}) {
  const tree = (
    <MemoryRouter initialEntries={['/try/lecture']}>
      <Routes>
        <Route path="/try/*" element={<TryExample />} />
      </Routes>
    </MemoryRouter>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

function tab(name: RegExp) {
  return within(screen.getByRole('navigation', { name: 'Разделы результата' })).getByRole('button', { name });
}

/** Nothing went to the backend or to an account: only the example's own voice files were fetched. */
function expectNoServer() {
  expect(requests.filter((url) => !FILE.test(url))).toEqual([]);
  expect(watch.supabase).toEqual([]);
}

// The page is a file of its own (components/example/tryParts); here it is in from the start, as after a visit.
beforeAll(async () => {
  await tryLecturePart.load();
});

beforeEach(() => {
  requests = [];
  watch.supabase = [];
  blobs.clear();
  FakeAudio.instances = [];
  let made = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      requests.push(url);
      if (!FILE.test(url)) throw new Error(`The lecture example must not call ${url}`);
      // The file's own address as its body: the test can tell which file an audio element was given.
      return new Response(url, { status: 200, headers: { 'Content-Type': 'audio/mpeg' } });
    }),
  );
  vi.stubGlobal('Audio', FakeAudio);
  URL.createObjectURL = vi.fn((blob: Blob) => {
    const url = `blob:voice-${++made}`;
    blobs.set(url, blob);
    return url;
  });
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('/try/lecture: what Meldy made of the example’s first lecture, with no account', () => {
  it('is the result screen of the analysis, read-only, under the example’s top line and its note', () => {
    renderLecture();
    expect(track).toHaveBeenCalledWith('try_lecture_opened');
    expect(document.title).toBe('Разбор лекции · пример — Meldy');

    const note = document.querySelector('.tl-note');
    expect(plain(note?.textContent)).toContain(plain(LECTURE_EXAMPLE_NOTE));
    expect(LECTURE_EXAMPLE_NOTE).toBe('Пример: так Meldy разобрал лекцию «Спрос и предложение» из примера экзамена.');
    expect(within(note as HTMLElement).getByRole('link', { name: 'К примеру экзамена' })).toHaveAttribute('href', '/try');
    // The example's top line: the way back and the way into an account, as on the sheet.
    const bar = document.querySelector('.tx-bar') as HTMLElement;
    expect(within(bar).getByRole('link', { name: 'Пример экзамена' })).toHaveAttribute('href', '/try');
    expect(within(bar).getByRole('link', { name: 'Войти' })).toHaveAttribute('href', '/login');
    expect(within(bar).getByRole('link', { name: 'Начать со своего списка' })).toHaveAttribute('href', expect.stringMatching(/^\/register/));

    // The analysis page's header, as the student saw it after the run.
    expect(screen.getByText('Материал обработан')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(EXAMPLE_LECTURE_RESULTS.summarizer.title);
    const meta = Array.from(document.querySelector('.rp-meta')?.children ?? []).map((part) => plain(part.textContent));
    expect(meta).toEqual(['2 943 символа', '·', 'около 4 мин чтения', '·', '11 заданий для практики']);
    const grounding = Array.from(document.querySelector('.rp-grounding')?.children ?? []).map((part) => plain(part.textContent));
    expect(grounding).toEqual(['Конспект, карточки и тест опираются на 7 фрагментов лекции ·', 'у 32 пунктов есть ссылка на похожий фрагмент']);
    const tabs = within(screen.getByRole('navigation', { name: 'Разделы результата' })).getAllByRole('button');
    expect(tabs.map((button) => plain(button.textContent))).toEqual(['Конспект', 'Карточки6', 'Тест5', 'Выжимка', 'Подкаст16']);

    // Nothing that saves, makes anew or analyses again.
    expect(screen.queryByRole('button', { name: 'Новый анализ' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Изменить название' })).toBeNull();
    expect(screen.queryByText(/заново/)).toBeNull();
    expectNoServer();
  });

  it('shows every tab: the summary with the lecture’s fragments, cards that turn, a test with explanations, the выжимка', async () => {
    renderLecture();

    // «Конспект»: a section's «фрагмент 2» opens the lecture's own paragraph, the one the exam example quotes.
    expect(tab(/^Конспект/)).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { name: 'Закон спроса', level: 2 })).toBeInTheDocument();
    const s02 = EXAMPLE_LECTURE_SOURCE.fragments[1];
    fireEvent.click(screen.getAllByRole('button', { name: 'Фрагмент лекции 2' })[0]);
    const slip = document.querySelector('[data-fragment="S02"]');
    expect(plain(slip?.textContent)).toContain('Количество, которое покупают при конкретной цене, называют величиной спроса.');
    expect(plain(slip?.textContent)).toContain(plain(s02.text.split('\n')[1].slice(0, 60)));
    expect(screen.getByText('Термины')).toBeInTheDocument();

    // «Карточки»: six cards; a card turns over to its answer.
    fireEvent.click(tab(/^Карточки/));
    const cards = document.querySelectorAll('.fc-card');
    expect(cards).toHaveLength(6);
    const question = within(cards[0] as HTMLElement).getByRole('button', { name: /Как согласно лекции формируется цена/ });
    expect(question).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(question);
    expect(question).toHaveAttribute('aria-expanded', 'true');
    expect(plain(cards[0].textContent)).toContain('Согласно лекции, рынок сводит вместе покупателей и продавцов.');
    expect(screen.getByText('Ответы здесь не сохраняются и не двигают повторение.')).toBeInTheDocument();

    // «Тест»: five questions; answered, it is checked here with an explanation under each, and nothing is recorded.
    fireEvent.click(tab(/^Тест/));
    const items = Array.from(document.querySelectorAll<HTMLElement>('.qz-card'));
    expect(items).toHaveLength(5);
    // The right answers are B, C, B, C, B; the last one is answered wrongly.
    ['Б', 'В', 'Б', 'В', 'А'].forEach((letter, index) => {
      const option = within(items[index]).getAllByRole('button').find((button) => plain(button.textContent).startsWith(`${letter})`));
      fireEvent.click(option!);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Проверить ответы' }));
    expect(screen.getByText('4 из 5 верно')).toBeInTheDocument();
    expect(screen.getAllByText('Пояснение:')).toHaveLength(5);
    expect(screen.queryByText(/Результат (не )?сохран/)).toBeNull();

    // «Выжимка».
    fireEvent.click(tab(/^Выжимка/));
    expect(screen.getByRole('heading', { name: 'Выжимка', level: 2 })).toBeInTheDocument();
    expect(screen.getByText('Ключевые понятия')).toBeInTheDocument();
    expect(screen.getByText('Где легко ошибиться')).toBeInTheDocument();

    // «Экспорт» makes its files in the browser: copy, print, HTML — nothing goes to a server.
    fireEvent.click(tab(/^Конспект/));
    fireEvent.click(screen.getByRole('button', { name: 'Экспорт' }));
    const menu = screen.getByRole('menu', { name: 'Экспорт' });
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Копировать', 'Печать или PDF', 'Скачать HTML']);
    await waitFor(() => expect(requests.length).toBeGreaterThan(0));
    expectNoServer();
  });

  it('plays the podcast from the files beside the page and never asks /api/tts, in StrictMode too', async () => {
    renderLecture({ strict: true });
    // The panel readies the first lines as soon as it is on screen (ResultsPanel warmConversationVoice): from the files.
    await waitFor(() => expect(requests).toEqual(['/example/lecture/podcast/01.mp3', '/example/lecture/podcast/02.mp3']));

    fireEvent.click(tab(/^Подкаст/));
    const player = screen.getByRole('region', { name: 'Подкаст по лекции' });
    expect(within(player).getByText('Реплика 1 из 16')).toBeInTheDocument();
    fireEvent.click(within(player).getByRole('button', { name: 'Слушать' }));
    await waitFor(() => expect(FakeAudio.instances).toHaveLength(1));
    expect(await fileOf(FakeAudio.instances[0])).toBe('/example/lecture/podcast/01.mp3');

    // The line sounds; the next ones are readied from their files, and the next line plays its own.
    act(() => FakeAudio.instances[0].emit('playing'));
    await waitFor(() => expect(requests).toContain('/example/lecture/podcast/04.mp3'));
    act(() => FakeAudio.instances[0].onended?.());
    await waitFor(() => expect(FakeAudio.instances).toHaveLength(2));
    expect(await fileOf(FakeAudio.instances[1])).toBe('/example/lecture/podcast/02.mp3');
    expect(within(player).getByText('Реплика 2 из 16')).toBeInTheDocument();

    // A jump to the last line plays the last file.
    fireEvent.click(within(player).getByRole('button', { name: 'Реплика 16' }));
    await waitFor(() => expect(FakeAudio.instances).toHaveLength(3));
    expect(await fileOf(FakeAudio.instances[2])).toBe('/example/lecture/podcast/16.mp3');
    // No «Создать подкаст», no «Добавить схемы»: the example's podcast is as it was made.
    expect(within(player).queryByRole('button', { name: /Добавить схемы|Создать подкаст/ })).toBeNull();
    expectNoServer();
    expect(new Set(requests).size).toBe(requests.length);
  });

  it('gives every line of the podcast its own file, with the voice the player gives that line', () => {
    const voice = exampleLectureVoice();
    expect(voice).toHaveLength(16);
    expect(voice.map((line) => line.src)).toEqual(Array.from({ length: 16 }, (_, index) => `/example/lecture/podcast/${String(index + 1).padStart(2, '0')}.mp3`));
    // Макс asks, Софья explains: the hosts take turns, Макс first.
    expect(voice.map((line) => line.role)).toEqual(Array.from({ length: 16 }, (_, index) => (index % 2 === 0 ? 'male' : 'female')));
    expect(voice[0].text).toBe(EXAMPLE_LECTURE_RESULTS.podcast?.podcast[0].text);
  });

  it('gives the voice back to the server once the page is left', async () => {
    renderLecture();
    await waitFor(() => expect(requests).toHaveLength(2));
    cleanup();
    requests = [];
    // A line of a real lecture, after the example: the server again (the test's fetch refuses it).
    await prefetchTTS('Строка настоящей лекции', 'female');
    expect(requests).toEqual(['/api/tts']);
  });
});
