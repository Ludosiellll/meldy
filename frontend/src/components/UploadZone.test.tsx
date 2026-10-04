import { afterEach, describe, expect, it, vi } from 'vitest';
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
const startButton = () => screen.getByRole('button', { name: /Запустить анализ|Вставьте текст|Сначала выберите файл|Введите ссылку|Запускаем/ });
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

  it('disables start at 299 characters and explains why', () => {
    render(<Harness onUpload={vi.fn()} />);
    fireEvent.change(textarea(), { target: { value: `  ${'б'.repeat(299)}  ` } });
    expect(startButton()).toBeDisabled();
    expect(screen.getByText('Нужно хотя бы 300 символов, сейчас 299')).toBeInTheDocument();
    expect(screen.getByText(`299 символов`)).toBeInTheDocument();
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
    expect(screen.getByText('Демо-текст: лимит не списывается, настройки по умолчанию')).toBeInTheDocument();
    // За демо-текст лимит не списывается, поэтому строки о расходе нет.
    expect(screen.queryByText('Анализ расходует 20 из 100 единиц дневного лимита.')).not.toBeInTheDocument();

    fireEvent.change(textarea(), { target: { value: `${DEMO_TEXT} Мой абзац.` } });
    expect(screen.queryByText('Демо-текст: лимит не списывается, настройки по умолчанию')).not.toBeInTheDocument();
    expect(screen.getByText('Анализ расходует 20 из 100 единиц дневного лимита.')).toBeInTheDocument();
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
