import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import UploadZone, { type UploadOptions, type UploadTab } from './UploadZone';
import { DEFAULT_SETTINGS } from '../types';
import { DEMO_TEXT } from '../data/demo';

type UploadCall = [File | null, string | undefined, UploadOptions | undefined];

function Harness({
  onUpload,
  onDemo,
  initialTab = 'text',
  initialText = '',
  costNote,
  busy,
  startDisabledReason,
}: {
  onUpload: (...args: UploadCall) => void;
  onDemo?: () => void;
  initialTab?: UploadTab;
  initialText?: string;
  costNote?: string;
  busy?: boolean;
  startDisabledReason?: string;
}) {
  const [tab, setTab] = useState<UploadTab>(initialTab);
  const [text, setText] = useState(initialText);
  const [url, setUrl] = useState('');
  return (
    <UploadZone
      settings={DEFAULT_SETTINGS}
      onSettingsChange={() => undefined}
      onUpload={(file, sourceUrl, options) => onUpload(file, sourceUrl, options)}
      onDemo={() => {
        onDemo?.();
        setTab('text');
        setText(DEMO_TEXT);
      }}
      tab={tab}
      onTabChange={setTab}
      text={text}
      onTextChange={setText}
      url={url}
      onUrlChange={setUrl}
      costNote={costNote}
      busy={busy}
      startDisabledReason={startDisabledReason}
    />
  );
}

const textarea = () => screen.getByLabelText('Текст лекции или конспекта') as HTMLTextAreaElement;
const startButton = () =>
  screen.getByRole('button', { name: /Запустить анализ|Вставьте текст|Сначала выберите файл|Вставьте ссылку|Ссылку на видео не открыть|Запускаем/ });
const lecture = (length: number) => `Лекция 3. Эластичность спроса\n${'а'.repeat(Math.max(0, length - 30))}`;

afterEach(cleanup);

describe('UploadZone source tabs', () => {
  it('offers four tabs: file, text, link, audio and video', () => {
    render(<Harness onUpload={vi.fn()} initialTab="file" />);
    expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['Файл', 'Текст', 'Ссылка', 'Аудио и видео']);
    expect(screen.getByRole('tab', { name: 'Файл' })).toHaveAttribute('aria-selected', 'true');
  });

  it('does not offer .doc files the server cannot read', () => {
    render(<Harness onUpload={vi.fn()} initialTab="file" />);
    const accept = screen.getByTestId('upload-file-input').getAttribute('accept') || '';
    expect(accept.split(',')).not.toContain('.doc');
    expect(accept.split(',')).toContain('.docx');
  });

  it('starts a file analysis with the chosen file', async () => {
    const onUpload = vi.fn();
    render(<Harness onUpload={onUpload} initialTab="file" />);
    expect(startButton()).toBeDisabled();
    expect(startButton()).toHaveTextContent('Сначала выберите файл');
    const file = new File(['Текст лекции'], 'lecture.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByTestId('upload-file-input'), { target: { files: [file] } });
    expect(await screen.findByText('lecture.pdf')).toBeInTheDocument();
    fireEvent.click(startButton());
    expect(onUpload).toHaveBeenCalledWith(file, undefined, undefined);
  });
});

describe('UploadZone text tab', () => {
  it('asks for text while empty', () => {
    render(<Harness onUpload={vi.fn()} />);
    expect(startButton()).toBeDisabled();
    expect(startButton()).toHaveTextContent('Вставьте текст');
    expect(textarea()).toHaveAttribute('placeholder', 'Вставьте текст лекции, главы или конспекта');
  });

  it('disables start at 299 characters and explains why, saying the count once (QA 2026-10-11)', () => {
    render(<Harness onUpload={vi.fn()} />);
    fireEvent.change(textarea(), { target: { value: `  ${'б'.repeat(299)}  ` } });
    expect(startButton()).toBeDisabled();
    expect(screen.getByText('Нужно хотя бы 300 символов, сейчас 299')).toBeInTheDocument();
    // «…сейчас 299» is the count: no «299 символов» beside or under it.
    expect(screen.queryByText('299 символов')).toBeNull();
    expect(document.querySelector('.az-count')).toBeNull();

    // Enough text: the line is the count alone again.
    fireEvent.change(textarea(), { target: { value: lecture(400) } });
    expect(document.querySelector('.az-count')?.textContent).toBe('400 символов');
  });

  it('disables start above 80 000 characters and asks to split the text', () => {
    render(<Harness onUpload={vi.fn()} />);
    fireEvent.change(textarea(), { target: { value: 'б'.repeat(80_001) } });
    expect(startButton()).toBeDisabled();
    // Testing Library сводит неразрывные пробелы разрядов к обычным.
    expect(screen.getByText('Это 80 001 символ, за один раз можно до 80 000. Разделите текст на части')).toBeInTheDocument();
  });

  it('sends valid text as pasted-text.txt with the first line as the source name', async () => {
    const onUpload = vi.fn();
    render(<Harness onUpload={onUpload} />);
    const text = lecture(400);
    fireEvent.change(textarea(), { target: { value: text } });
    expect(startButton()).toBeEnabled();
    fireEvent.click(startButton());
    expect(onUpload).toHaveBeenCalledTimes(1);
    const [file, url, options] = onUpload.mock.calls[0] as UploadCall;
    expect(url).toBeUndefined();
    expect(file?.name).toBe('pasted-text.txt');
    expect(await file?.text()).toBe(text);
    expect(options).toEqual({ sourceName: 'Лекция 3. Эластичность спроса.txt', text });
  });

  it('asks for the link in two words, like the text tab (a long reason stood out of the 340 px column)', () => {
    render(<Harness onUpload={vi.fn()} initialTab="url" />);
    expect(startButton()).toHaveTextContent('Вставьте ссылку');
    expect(startButton()).toBeDisabled();
  });

  it('keeps the text when switching to another tab and back', () => {
    render(<Harness onUpload={vi.fn()} />);
    fireEvent.change(textarea(), { target: { value: lecture(350) } });
    fireEvent.click(screen.getByRole('tab', { name: 'Ссылка' }));
    expect(screen.queryByLabelText('Текст лекции или конспекта')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Текст' }));
    expect(textarea().value).toBe(lecture(350));
  });

  it('moves between tabs with the arrow keys', () => {
    render(<Harness onUpload={vi.fn()} initialTab="file" />);
    const fileTab = screen.getByRole('tab', { name: 'Файл' });
    fireEvent.keyDown(fileTab, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Текст' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Текст' }), { key: 'End' });
    expect(screen.getByRole('tab', { name: 'Аудио и видео' })).toHaveFocus();
  });
});

describe('UploadZone demo text', () => {
  it('«Попробовать на демо-тексте» fills the text tab and labels it until the text is edited', () => {
    const onDemo = vi.fn();
    render(<Harness onUpload={vi.fn()} onDemo={onDemo} initialTab="file" costNote="Анализ расходует 20 из 100 единиц дневного лимита." />);
    const demoButton = screen.getByRole('button', { name: 'Попробовать на демо-тексте' });
    expect(demoButton.textContent).not.toMatch(/▶/);
    fireEvent.click(demoButton);
    expect(onDemo).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('tab', { name: 'Текст' })).toHaveAttribute('aria-selected', 'true');
    expect(textarea().value).toBe(DEMO_TEXT);
    expect(screen.getByText('Демо-текст: лимит не списывается')).toBeInTheDocument();
    // За демо-текст лимит не списывается, поэтому строки о расходе нет.
    expect(screen.queryByText('Анализ расходует 20 из 100 единиц дневного лимита.')).not.toBeInTheDocument();
    // The demo is analysed with its own settings: step 2 says what will be made, why it cannot be changed, and waits.
    expect(screen.getByText('Конспект, 6 карточек и тест из 5 вопросов')).toBeInTheDocument();
    const change = screen.getByRole('button', { name: 'Изменить' });
    expect(change).toBeDisabled();
    expect(change).toHaveAccessibleDescription('Для демо-текста настройки не меняются.');

    fireEvent.change(textarea(), { target: { value: `${DEMO_TEXT} Мой абзац.` } });
    expect(screen.queryByText('Демо-текст: лимит не списывается')).not.toBeInTheDocument();
    expect(screen.getByText('Анализ расходует 20 из 100 единиц дневного лимита.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Изменить' })).toBeEnabled();
    expect(screen.queryByText('Для демо-текста настройки не меняются.')).not.toBeInTheDocument();
  });
});

describe('UploadZone start states', () => {
  it('shows the cost note under the start button and links it for screen readers', () => {
    render(<Harness onUpload={vi.fn()} initialText={lecture(400)} costNote="Анализ расходует 20 из 100 единиц дневного лимита. Осталось 80, лимит обновится в 3:00." />);
    const note = screen.getByText('Анализ расходует 20 из 100 единиц дневного лимита. Осталось 80, лимит обновится в 3:00.');
    expect(startButton()).toHaveAttribute('aria-describedby', note.id);
  });

  it('a start disabled reason blocks start but keeps the demo button', () => {
    render(
      <Harness
        onUpload={vi.fn()}
        initialText={lecture(400)}
        startDisabledReason="На сегодня лимит исчерпан, он обновится в 3:00. Демо-текст доступен без лимита."
      />,
    );
    expect(startButton()).toBeDisabled();
    expect(screen.getByText('На сегодня лимит исчерпан, он обновится в 3:00. Демо-текст доступен без лимита.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Попробовать на демо-тексте' })).toBeEnabled();
  });

  it('busy disables start and demo so a second click cannot start another run', async () => {
    const onUpload = vi.fn();
    render(<Harness onUpload={onUpload} initialText={lecture(400)} busy />);
    expect(startButton()).toBeDisabled();
    expect(startButton()).toHaveTextContent('Запускаем…');
    expect(screen.getByRole('button', { name: 'Попробовать на демо-тексте' })).toBeDisabled();
    fireEvent.click(startButton());
    await act(async () => undefined);
    expect(onUpload).not.toHaveBeenCalled();
  });

  it('starts a link analysis with the trimmed URL', async () => {
    const onUpload = vi.fn();
    render(<Harness onUpload={onUpload} initialTab="url" />);
    fireEvent.change(screen.getByLabelText('Ссылка на статью или учебный материал'), { target: { value: '  https://example.org/lecture  ' } });
    await waitFor(() => expect(startButton()).toBeEnabled());
    fireEvent.click(startButton());
    expect(onUpload).toHaveBeenCalledWith(null, 'https://example.org/lecture', undefined);
  });
});

describe('UploadZone lecture formats', () => {
  const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

  it('takes PPTX by extension and by MIME type and lists it with the other formats', () => {
    render(<Harness onUpload={vi.fn()} initialTab="file" />);
    const accept = (screen.getByTestId('upload-file-input').getAttribute('accept') || '').split(',');
    expect(accept).toEqual(expect.arrayContaining(['.pdf', '.docx', '.pptx', '.jpg', '.png', PPTX]));
    expect(accept).not.toContain('.ppt');
    const chips = Array.from(document.querySelectorAll('.az-format')).map(chip => chip.textContent);
    expect(chips).toEqual(['PDF', 'DOCX', 'PPTX', 'HTML', 'TXT', 'MD', 'JPG', 'PNG']);
    expect(screen.getByText('PDF, DOCX, PPTX, HTML, TXT, MD, JPG и PNG — до 15 МБ')).toBeInTheDocument();
  });

  it('says honestly that scans and photos are recognised by Google Gemini, on the file tab only', () => {
    render(<Harness onUpload={vi.fn()} initialTab="file" />);
    const note = () => document.querySelector('.az-scan-note');
    expect(note()?.textContent).toBe('Сканы и фото страниц распознаёт ИИ-сервис Google Gemini.');
    // «ИИ-сервис» не разрывается на «ИИ-» и «сервис» в конце строки.
    expect(note()?.querySelector('.az-nowrap')?.textContent).toBe('ИИ-сервис');
    fireEvent.click(screen.getByRole('tab', { name: 'Аудио и видео' }));
    expect(note()).toBeNull();
  });

  it('says how long a recording fits into 15 МБ, on the audio tab (finding LIB-20)', async () => {
    render(<Harness onUpload={vi.fn()} initialTab="media" />);
    const plain = (node: Element | null) => node?.textContent?.replace(/\s/g, ' ');
    expect(plain(document.querySelector('.az-media-note'))).toBe(
      'До 15 МБ — это примерно 15–30 минут звука. Запись целой пары обычно больше: разделите её на части.',
    );
    expect(screen.getByText('MP4, MP3, WAV, MPEG и M4A — до 15 МБ, примерно 15–30 минут звука')).toBeInTheDocument();

    // A whole pair is refused at once, with the same numbers and what to do.
    const pair = new File(['x'], 'Пара 3.mp3', { type: 'audio/mpeg' });
    Object.defineProperty(pair, 'size', { value: 60 * 1024 * 1024 });
    fireEvent.change(screen.getByTestId('upload-file-input'), { target: { files: [pair] } });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Файл занимает 60,0 МБ, а можно до 15 МБ — примерно 15–30 минут звука. Разделите запись на части.',
    );
  });

  it('starts an analysis of a presentation', async () => {
    const onUpload = vi.fn();
    render(<Harness onUpload={onUpload} initialTab="file" />);
    const deck = new File(['PK'], 'Лекция 3.pptx', { type: PPTX });
    fireEvent.change(screen.getByTestId('upload-file-input'), { target: { files: [deck] } });
    expect(await screen.findByText('Лекция 3.pptx')).toBeInTheDocument();
    fireEvent.click(startButton());
    expect(onUpload).toHaveBeenCalledWith(deck, undefined, undefined);
  });

  it('stops an old .ppt at once and asks to save it as PPTX or PDF', async () => {
    const onUpload = vi.fn();
    render(<Harness onUpload={onUpload} initialTab="file" />);
    const old = new File(['old'], 'Лекция 3.PPT', { type: 'application/vnd.ms-powerpoint' });
    fireEvent.drop(document.querySelector('.az-panel') as Element, { dataTransfer: { files: [old] } });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Старый формат PowerPoint (.ppt) не читается. Сохраните презентацию как PPTX или PDF и загрузите снова.',
    );
    expect(screen.queryByText('Лекция 3.PPT')).toBeNull();
    expect(startButton()).toBeDisabled();
    expect(onUpload).not.toHaveBeenCalled();
  });
});

describe('video links in «Ссылка» (live QA 2026-10-11)', () => {
  const VIDEO_NOTE =
    'Ссылку на видео Meldy пока не открывает. Если запись лекции есть у вас файлом, загрузите её во вкладке «Аудио и видео» (до 15 МБ).';
  const urlField = () => screen.getByLabelText('Ссылка на статью или учебный материал');
  /** The note without the no-break spaces of the typesetting. */
  const plainText = (node: Element | null) => node?.textContent?.replace(/ /g, ' ');

  it.each([
    'https://www.youtube.com/watch?v=aircAruvnKk',
    'youtu.be/aircAruvnKk',
    'https://m.youtube.com/watch?v=aircAruvnKk',
    'https://music.youtube.com/watch?v=aircAruvnKk',
    'https://rutube.ru/video/0123456789abcdef/',
    'https://vk.com/video-12345_67890',
    'https://vkvideo.ru/video-12345_67890',
    'https://dzen.ru/video/watch/650000aa0000000000000000',
  ])('says it before the start and keeps the start waiting: %s', async link => {
    const onUpload = vi.fn();
    render(<Harness onUpload={onUpload} initialTab="url" />);
    fireEvent.change(urlField(), { target: { value: link } });
    const note = screen.getByRole('alert');
    expect(plainText(note)).toBe(VIDEO_NOTE);
    expect(urlField()).toHaveAttribute('aria-describedby', note.id);
    expect(startButton()).toBeDisabled();
    // The waiting start says why, as «Вставьте ссылку» and «Сначала выберите файл» do (QA 2026-10-11).
    expect(startButton()).toHaveTextContent('Ссылку на видео не открыть');
    expect(startButton().getAttribute('aria-describedby')).toContain(note.id);
    expect(screen.queryByText(/Подойдёт открытая страница/)).toBeNull();
    fireEvent.click(startButton());
    await act(async () => undefined);
    expect(onUpload).not.toHaveBeenCalled();
  });

  it('opens «Аудио и видео» in one tap, its file picker in focus, and gives the link back when the tab is switched back', () => {
    render(<Harness onUpload={vi.fn()} initialTab="url" />);
    fireEvent.change(urlField(), { target: { value: 'https://youtu.be/aircAruvnKk' } });
    fireEvent.click(screen.getByRole('button', { name: 'Открыть «Аудио и видео»' }));
    expect(screen.getByRole('tab', { name: 'Аудио и видео' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('upload-file-input')).toHaveAttribute('accept', '.mp4,.mp3,.wav,.mpeg,.m4a');
    expect(document.activeElement).toBe(document.querySelector('.az-drop'));
    fireEvent.click(screen.getByRole('tab', { name: 'Ссылка' }));
    expect(urlField()).toHaveValue('https://youtu.be/aircAruvnKk');
  });

  it('says nothing about a page with text, and the start goes', async () => {
    const onUpload = vi.fn();
    render(<Harness onUpload={onUpload} initialTab="url" />);
    fireEvent.change(urlField(), { target: { value: 'https://vk.com/wall-1_2' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText(/Подойдёт открытая страница/)).toBeInTheDocument();
    await waitFor(() => expect(startButton()).toBeEnabled());
    fireEvent.click(startButton());
    expect(onUpload).toHaveBeenCalledWith(null, 'https://vk.com/wall-1_2', undefined);
  });

  it('goes away as the link is cleared', () => {
    render(<Harness onUpload={vi.fn()} initialTab="url" />);
    fireEvent.change(urlField(), { target: { value: 'https://youtu.be/aircAruvnKk' } });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Очистить ссылку' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(startButton()).toHaveTextContent('Вставьте ссылку');
  });
});

describe('formats the server does not read are stopped in the picker (live QA 2026-10-11)', () => {
  const choose = (file: File) => fireEvent.change(screen.getByTestId('upload-file-input'), { target: { files: [file] } });

  it('an old Word .doc: what to do, at once, and no start', async () => {
    const onUpload = vi.fn();
    render(<Harness onUpload={onUpload} initialTab="file" />);
    choose(new File(['old'], 'История.doc', { type: 'application/msword' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Старый формат Word (.doc) не читается. Сохраните файл как DOCX или PDF и загрузите снова.',
    );
    expect(screen.queryByText('История.doc')).toBeNull();
    expect(startButton()).toBeDisabled();
    expect(onUpload).not.toHaveBeenCalled();
  });

  it.each(['voice_note.ogg', 'voice.opus', 'screen.webm', 'IMG_0042.mov'])(
    'a recording in «Аудио и видео» the server cannot read (%s) is told the recording formats, never JPG or PNG',
    async name => {
      const onUpload = vi.fn();
      render(<Harness onUpload={onUpload} initialTab="media" />);
      choose(new File(['x'], name, { type: '' }));
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(
        `Формат .${name.split('.').pop()} не читается. Подойдут записи MP4, MP3, WAV, MPEG и M4A — сохраните запись в одном из этих форматов и загрузите снова.`,
      );
      expect(alert.textContent).not.toMatch(/JPG|PNG|jpe?g|png/);
      expect(startButton()).toBeDisabled();
      expect(onUpload).not.toHaveBeenCalled();
    },
  );

  it('the recording tab names recordings only, and a recording it reads goes', async () => {
    const onUpload = vi.fn();
    render(<Harness onUpload={onUpload} initialTab="media" />);
    expect(Array.from(document.querySelectorAll('.az-format')).map(chip => chip.textContent)).toEqual(['MP4', 'MP3', 'WAV', 'MPEG', 'M4A']);
    choose(new File(['x'], 'table.xlsx', { type: '' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Подойдут записи MP4, MP3, WAV, MPEG и M4A');
    const pair = new File(['x'], 'Пара 3.mp3', { type: 'audio/mpeg' });
    choose(pair);
    expect(await screen.findByText('Пара 3.mp3')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(startButton());
    expect(onUpload).toHaveBeenCalledWith(pair, undefined, undefined);
  });

  it('a dropped spreadsheet on «Файл» is told the document formats', async () => {
    render(<Harness onUpload={vi.fn()} initialTab="file" />);
    fireEvent.drop(document.querySelector('.az-panel') as Element, { dataTransfer: { files: [new File(['x'], 'Оценки.xlsx', { type: '' })] } });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Формат .xlsx не читается. Подойдут PDF, DOCX, PPTX, HTML, TXT, MD, JPG и PNG — сохраните файл в одном из этих форматов и загрузите снова.',
    );
  });
});

describe('a refused file is in view (QA 2026-10-11: below the first screen of a 1532×734 laptop)', () => {
  const originalRect = Element.prototype.getBoundingClientRect;
  const scrolls: Array<{ text: string; options: ScrollIntoViewOptions | boolean | undefined }> = [];

  beforeEach(() => {
    scrolls.length = 0;
    // src/test/setup.ts gives HTMLElement a silent scrollIntoView; here it reports what it was asked.
    vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(function scroll(this: HTMLElement, options?: ScrollIntoViewOptions | boolean) {
      scrolls.push({ text: this.textContent ?? '', options });
    });
  });
  afterEach(() => {
    Element.prototype.getBoundingClientRect = originalRect;
  });

  const oversized = () => {
    const pdf = new File(['x'], 'Биология.pdf', { type: 'application/pdf' });
    Object.defineProperty(pdf, 'size', { value: 16.3 * 1024 * 1024 });
    return pdf;
  };

  it('stands over the file panel, not under it', async () => {
    render(<Harness onUpload={vi.fn()} initialTab="file" />);
    fireEvent.change(screen.getByTestId('upload-file-input'), { target: { files: [oversized()] } });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Файл занимает 16,3 МБ. Максимальный размер — 15 МБ.');
    const drop = document.querySelector('.az-drop') as Element;
    expect(alert.compareDocumentPosition(drop) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('is brought into view when the screen ends above it, and left alone when it is seen', async () => {
    // The refusal lies under the bottom of an 800 px window.
    Element.prototype.getBoundingClientRect = function rect(this: Element) {
      const top = this.classList.contains('az-file-error') ? 820 : 0;
      return { top, bottom: top + 60, left: 0, right: 600, width: 600, height: 60, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    };
    const { unmount } = render(<Harness onUpload={vi.fn()} initialTab="file" />);
    fireEvent.change(screen.getByTestId('upload-file-input'), { target: { files: [oversized()] } });
    await screen.findByRole('alert');
    await waitFor(() => expect(scrolls).toHaveLength(1));
    expect(scrolls[0].text).toContain('Файл занимает 16,3 МБ');
    expect(scrolls[0].options).toMatchObject({ block: 'end' });
    // The same refusal again (the same file chosen twice) is brought into view again.
    fireEvent.change(screen.getByTestId('upload-file-input'), { target: { files: [oversized()] } });
    await waitFor(() => expect(scrolls).toHaveLength(2));
    unmount();

    // Seen: nothing moves.
    Element.prototype.getBoundingClientRect = function rect() {
      return { top: 300, bottom: 360, left: 0, right: 600, width: 600, height: 60, x: 0, y: 300, toJSON: () => ({}) } as DOMRect;
    };
    render(<Harness onUpload={vi.fn()} initialTab="file" />);
    fireEvent.change(screen.getByTestId('upload-file-input'), { target: { files: [oversized()] } });
    await screen.findByRole('alert');
    await act(async () => undefined);
    expect(scrolls).toHaveLength(2);
  });
});

describe('«Разобрать лекцию»: three steps, the start on the first screen (finding LIB-8)', () => {
  it('names the page by its action and the steps in plain words', () => {
    render(<Harness onUpload={vi.fn()} initialTab="file" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Разобрать лекцию' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2 }).map(heading => heading.textContent)).toEqual(['Что разобрать', 'Что подготовить']);
    expect(document.body.textContent).not.toMatch(/Модули|генерац|агент/i);
  });

  it('folds what will be made into one line that «Изменить» opens and «Свернуть настройки» closes', () => {
    render(<Harness onUpload={vi.fn()} initialText={lecture(400)} />);
    expect(screen.getByText('Конспект, 6 карточек и тест из 5 вопросов')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Настройки разбора' })).not.toBeInTheDocument();
    const change = screen.getByRole('button', { name: 'Изменить' });
    expect(change).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(change);
    const settings = screen.getByRole('region', { name: 'Настройки разбора' });
    expect(settings).toBeInTheDocument();
    expect(change).toHaveAttribute('aria-expanded', 'true');
    expect(change).toHaveAttribute('aria-controls', settings.id);
    expect(change).toHaveTextContent('Свернуть настройки');
    fireEvent.click(change);
    expect(screen.queryByRole('region', { name: 'Настройки разбора' })).not.toBeInTheDocument();
  });

  it('puts the start right after the two steps, before the settings', () => {
    render(<Harness onUpload={vi.fn()} initialText={lecture(400)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Изменить' }));
    const start = startButton();
    const plan = screen.getByRole('heading', { level: 2, name: 'Что подготовить' });
    const settings = screen.getByRole('region', { name: 'Настройки разбора' });
    expect(plan.compareDocumentPosition(start) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(start.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('«Разобрать лекцию» on a phone (10_Project/Phone_Declutter_2026-10-08)', () => {
  const PHONE_QUERY = '(max-width: 639px)';
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({
        matches: query === PHONE_QUERY,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
      }),
    });
  });
  afterEach(() => {
    delete (window as unknown as { matchMedia?: unknown }).matchMedia;
  });

  it('leads with one line and picks the file with «Выбрать файл» in one frame: no drag line, the formats as text', async () => {
    const onUpload = vi.fn();
    render(<Harness onUpload={onUpload} initialTab="file" />);
    expect(screen.getByText('Meldy сделает конспект, карточки и тест.')).toBeInTheDocument();
    expect(screen.queryByText(/Перетащите файл/)).toBeNull();
    expect(document.querySelectorAll('.az-format')).toHaveLength(0);
    expect(screen.getByText('PDF, DOCX, PPTX, HTML, TXT, MD, JPG, PNG · до 15 МБ')).toBeInTheDocument();
    // The four sources and both other ways stay.
    expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['Файл', 'Текст', 'Ссылка', 'Аудио и видео']);
    expect(screen.getByRole('button', { name: 'Попробовать на демо-тексте' })).toBeEnabled();
    expect(screen.getByRole('heading', { level: 2, name: 'Что подготовить' })).toBeInTheDocument();

    const input = screen.getByTestId('upload-file-input') as HTMLInputElement;
    const pick = vi.spyOn(input, 'click');
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать файл' }));
    expect(pick).toHaveBeenCalledTimes(1);
    const camera = document.querySelector('input[capture]') as HTMLInputElement;
    expect(camera).toHaveAttribute('accept', 'image/*');
    const shoot = vi.spyOn(camera, 'click');
    fireEvent.click(screen.getByRole('button', { name: 'Сфотографировать конспект' }));
    expect(shoot).toHaveBeenCalledTimes(1);

    const file = new File(['Текст лекции'], 'lecture.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(await screen.findByText('lecture.pdf')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Выбрать файл' })).toBeNull();
    fireEvent.click(startButton());
    expect(onUpload).toHaveBeenCalledWith(file, undefined, undefined);
  });

  it('says who recognises scans in one line, still naming the service', () => {
    render(<Harness onUpload={vi.fn()} initialTab="file" />);
    // The words a phone leaves out are only drawn wider (az-wide); the service is named on every size.
    expect(document.querySelector('.az-scan-note')?.textContent).toBe('Сканы и фото страниц распознаёт ИИ-сервис Google Gemini.');
    expect(Array.from(document.querySelectorAll('.az-scan-note .az-wide')).map(span => span.textContent?.trim())).toEqual(['страниц', 'ИИ-сервис']);
  });

  it('the audio tab: the formats as text and the length in one line', () => {
    render(<Harness onUpload={vi.fn()} initialTab="media" />);
    expect(screen.getByText('MP4, MP3, WAV, MPEG, M4A · до 15 МБ')).toBeInTheDocument();
    expect(document.querySelector('.az-media-note')?.textContent?.replace(/\s/g, ' ')).toBe('15 МБ — это примерно 15–30 минут звука.');
    expect(screen.queryByRole('button', { name: 'Сфотографировать конспект' })).toBeNull();
  });
});
