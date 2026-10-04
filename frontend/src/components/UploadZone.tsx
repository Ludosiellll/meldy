import { useId, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { Camera, FileText, Link as LinkIcon, Type, Video, X, type LucideIcon } from 'lucide-react';
import SettingsPanel from './SettingsPanel';
import type { AnalysisSettings } from '../types';
import { hasBadWords } from '../utils/moderation';
import { compressImage } from '../lib/imageCompression';
import { charactersLabel, pastedTextFile, pastedTextProblem, pastedTextTitle } from '../utils/pastedText';
import { isDemoText } from '../data/demo';

export type UploadTab = 'file' | 'text' | 'url' | 'media';

export interface UploadOptions {
  /** Имя источника для названия материала, если модель его не предложит. */
  sourceName?: string;
  /** Вставленный текст как есть: по нему решается, демо ли это. */
  text?: string;
}

interface Props {
  settings: AnalysisSettings;
  onSettingsChange: (s: AnalysisSettings) => void;
  onUpload: (file: File | null, url?: string, options?: UploadOptions) => void;
  /** «Попробовать на демо-тексте»: открыть вкладку «Текст» с демо-текстом. */
  onDemo: () => void;
  /** Демо-текст заменил текст пользователя: вернуть его («Вернуть мой текст»). */
  onRestoreText?: () => void;
  tab: UploadTab;
  onTabChange: (tab: UploadTab) => void;
  text: string;
  onTextChange: (text: string) => void;
  url: string;
  onUrlChange: (url: string) => void;
  /** Строка о расходе дневного лимита под кнопкой запуска. */
  costNote?: string;
  /** Запуск уже начат: кнопки запуска и демо недоступны. */
  busy?: boolean;
  /** Почему запуск сейчас недоступен (например, лимит исчерпан). */
  startDisabledReason?: string;
}

const TABS: { id: UploadTab; label: string; icon: LucideIcon }[] = [
  { id: 'file', label: 'Файл', icon: FileText },
  { id: 'text', label: 'Текст', icon: Type },
  { id: 'url', label: 'Ссылка', icon: LinkIcon },
  { id: 'media', label: 'Аудио и видео', icon: Video },
];

const MAX_SIZE = 15 * 1024 * 1024;
const DOC_ACCEPT = '.pdf,.docx,.txt,.md,.html,.htm,.jpg,.jpeg,.png';
const MEDIA_ACCEPT = '.mp4,.mp3,.wav,.mpeg,.m4a';

const PRIMARY_BUTTON =
  'inline-flex min-h-[56px] w-full items-center justify-center gap-2 rounded-xl px-5 text-base font-semibold transition-[transform,box-shadow,background-color] duration-100 motion-reduce:transition-none ' +
  'enabled:bg-[var(--sf-accent)] enabled:text-white enabled:shadow-[0_3px_0_color-mix(in_srgb,var(--sf-accent)_72%,#111)] enabled:hover:bg-[var(--sf-accent-hover)] ' +
  'enabled:active:translate-y-[2px] enabled:active:shadow-[0_1px_0_color-mix(in_srgb,var(--sf-accent)_72%,#111)] motion-reduce:enabled:active:translate-y-0 ' +
  'dark:enabled:shadow-[0_2px_0_color-mix(in_srgb,var(--sf-accent)_60%,var(--sf-canvas))] dark:enabled:active:shadow-none ' +
  'disabled:cursor-not-allowed disabled:bg-[var(--sf-surface-soft)] disabled:text-[var(--sf-muted)]';

export default function UploadZone({
  settings,
  onSettingsChange,
  onUpload,
  onDemo,
  onRestoreText,
  tab,
  onTabChange,
  text,
  onTextChange,
  url,
  onUrlChange,
  costNote,
  busy = false,
  startDisabledReason,
}: Props) {
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState('');
  const [isCompressing, setIsCompressing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const tabRefs = useRef<Partial<Record<UploadTab, HTMLButtonElement | null>>>({});
  const ids = useId();
  const panelId = `${ids}-panel`;
  const textId = `${ids}-text`;
  const textHintId = `${ids}-text-hint`;
  const noteId = `${ids}-note`;

  const isFileTab = tab === 'file' || tab === 'media';
  const demoText = tab === 'text' && isDemoText(text);
  const trimmedLength = text.trim().length;
  const textProblem = pastedTextProblem(text);

  const validateAndSet = async (picked: File) => {
    let finalFile = picked;
    if (!picked.name.includes('.') && picked.size > 0 && picked.type.startsWith('image/')) {
      finalFile = new File([picked], `${picked.name}.jpg`, { type: picked.type });
    }
    if (finalFile.type.startsWith('image/')) {
      setIsCompressing(true);
      try {
        finalFile = await compressImage(finalFile);
      } catch (error) {
        console.error('Ошибка сжатия:', error);
      }
      setIsCompressing(false);
    }
    if (finalFile.size > MAX_SIZE) {
      setFileError(`Файл занимает ${(finalFile.size / 1024 / 1024).toFixed(1)} МБ. Максимальный размер — 15 МБ.`);
      setFile(null);
    } else if (hasBadWords(finalFile.name)) {
      setFileError('Название файла содержит недопустимые слова. Пожалуйста, переименуйте файл.');
      setFile(null);
    } else {
      setFileError('');
      setFile(finalFile);
    }
  };

  const selectTab = (next: UploadTab) => {
    if (next === tab) return;
    onTabChange(next);
    setFile(null);
    setFileError('');
  };

  // Вкладки по образцу WAI-ARIA: стрелки, Home и End.
  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = -1;
    if (event.key === 'ArrowRight') next = (index + 1) % TABS.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = TABS.length - 1;
    if (next < 0) return;
    event.preventDefault();
    const target = TABS[next].id;
    selectTab(target);
    tabRefs.current[target]?.focus();
  };

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragOver(false);
    const dropped = event.dataTransfer.files[0];
    if (dropped) void validateAndSet(dropped);
  };

  const isReady =
    tab === 'url' ? Boolean(url.trim()) && url.includes('.') : tab === 'text' ? textProblem === null : Boolean(file) && !isCompressing;
  const limited = Boolean(startDisabledReason);
  const canStart = isReady && !busy && !limited;

  const handleStart = () => {
    if (!canStart) return;
    if (tab === 'url') {
      onUpload(null, url.trim());
    } else if (tab === 'text') {
      onUpload(pastedTextFile(text), undefined, { sourceName: `${pastedTextTitle(text)}.txt`, text });
    } else if (file) {
      onUpload(file);
    }
  };

  let startLabel = 'Запустить анализ';
  if (busy) startLabel = 'Запускаем…';
  else if (!isReady && !limited) {
    if (tab === 'url') startLabel = 'Введите ссылку на страницу';
    else if (tab === 'text') startLabel = trimmedLength === 0 ? 'Вставьте текст' : 'Запустить анализ';
    else startLabel = 'Сначала выберите файл';
  }

  const startNote = limited ? startDisabledReason : demoText ? undefined : costNote;

  return (
    <div className="space-y-8 py-8 text-[var(--sf-ink)] md:py-10">
      <header>
        <h1 className="text-3xl font-semibold leading-tight tracking-[-0.02em] sm:text-4xl">Один материал — полный цикл подготовки</h1>
        <p className="mt-3 max-w-[60ch] text-base leading-relaxed text-[var(--sf-muted)] sm:text-lg">
          Загрузите или вставьте лекцию. Meldy подготовит конспект, карточки и тест со ссылками на исходный текст.
        </p>
      </header>

      <section aria-labelledby={`${ids}-source`}>
        <h2 id={`${ids}-source`} className="mb-3 text-base font-semibold">
          Что разобрать
        </h2>
        <div
          role="tablist"
          aria-label="Источник"
          className="grid grid-cols-4 gap-1 rounded-xl border border-[var(--sf-line)] bg-[var(--sf-surface-soft)] p-1"
        >
          {TABS.map((item, index) => {
            const selected = tab === item.id;
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                ref={element => {
                  tabRefs.current[item.id] = element;
                }}
                id={`${ids}-tab-${item.id}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={panelId}
                tabIndex={selected ? 0 : -1}
                onClick={() => selectTab(item.id)}
                onKeyDown={event => handleTabKeyDown(event, index)}
                className={`flex min-h-[44px] items-center justify-center gap-2 rounded-lg px-2 py-1.5 text-center text-sm font-medium leading-tight transition-colors sm:px-3 ${
                  selected
                    ? 'bg-[var(--sf-surface)] text-[var(--sf-ink)] shadow-sm'
                    : 'text-[var(--sf-muted)] hover:text-[var(--sf-ink)]'
                }`}
              >
                <Icon aria-hidden="true" className="hidden h-4 w-4 shrink-0 sm:inline-block" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        <div id={panelId} role="tabpanel" aria-labelledby={`${ids}-tab-${tab}`} className="mt-4">
          {tab === 'text' && (
            <div>
              <label htmlFor={textId} className="text-sm font-medium">
                Текст лекции или конспекта
              </label>
              <textarea
                id={textId}
                value={text}
                onChange={event => onTextChange(event.target.value)}
                placeholder="Вставьте текст лекции, главы или конспекта"
                aria-describedby={textHintId}
                spellCheck={false}
                className="mt-2 block min-h-[240px] w-full resize-y rounded-xl border border-[var(--sf-line)] bg-[var(--sf-surface)] p-4 text-base leading-relaxed text-[var(--sf-ink)] placeholder:text-[var(--sf-muted)] focus:border-[var(--sf-accent)] focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--sf-accent)_25%,transparent)]"
              />
              <div id={textHintId} className="mt-2 flex flex-wrap items-start justify-between gap-x-4 gap-y-1 text-sm text-[var(--sf-muted)]">
                <span>
                  {demoText
                    ? 'Демо-текст: лимит не списывается, настройки по умолчанию'
                    : trimmedLength > 0 && textProblem
                      ? textProblem
                      : ''}
                  {demoText && onRestoreText && (
                    <button
                      type="button"
                      onClick={onRestoreText}
                      className="ml-3 min-h-[44px] font-medium text-[var(--sf-accent-fg)] underline-offset-4 hover:underline"
                    >
                      Вернуть мой текст
                    </button>
                  )}
                </span>
                <span className="tabular-nums">{charactersLabel(trimmedLength)}</span>
              </div>
            </div>
          )}

          {tab === 'url' && (
            <div className="rounded-xl border border-[var(--sf-line)] bg-[var(--sf-surface)] p-5 sm:p-6">
              <label htmlFor={`${ids}-url`} className="text-sm font-medium">
                Ссылка на статью или учебный материал
              </label>
              <div className="relative mt-2">
                <input
                  id={`${ids}-url`}
                  type="url"
                  name="source-url"
                  autoComplete="url"
                  inputMode="url"
                  placeholder="https://ru.wikipedia.org/wiki/..."
                  value={url}
                  onChange={event => onUrlChange(event.target.value)}
                  className="block min-h-[48px] w-full rounded-lg border border-[var(--sf-line)] bg-[var(--sf-canvas)] px-4 pr-12 text-base text-[var(--sf-ink)] placeholder:text-[var(--sf-muted)] focus:border-[var(--sf-accent)] focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--sf-accent)_25%,transparent)]"
                />
                {url && (
                  <button
                    type="button"
                    onClick={() => onUrlChange('')}
                    aria-label="Очистить ссылку"
                    className="absolute right-1 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-[var(--sf-muted)] hover:bg-[var(--sf-surface-soft)] hover:text-[var(--sf-ink)]"
                  >
                    <X aria-hidden="true" className="h-4 w-4" />
                  </button>
                )}
              </div>
              <p className="mt-3 text-sm leading-relaxed text-[var(--sf-muted)]">
                Подойдёт открытая страница: Meldy возьмёт основной текст без меню и рекламы.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-x-1 gap-y-1 text-sm">
                <span className="mr-1 text-[var(--sf-muted)]">Например:</span>
                <button
                  type="button"
                  onClick={() => onUrlChange('https://ru.wikipedia.org/wiki/Законы_Ньютона')}
                  className="min-h-[44px] rounded-lg px-2 text-[var(--sf-accent-fg)] underline-offset-4 hover:underline"
                >
                  законы Ньютона
                </button>
                <button
                  type="button"
                  onClick={() => onUrlChange('https://ru.wikipedia.org/wiki/Фотосинтез')}
                  className="min-h-[44px] rounded-lg px-2 text-[var(--sf-accent-fg)] underline-offset-4 hover:underline"
                >
                  фотосинтез
                </button>
              </div>
            </div>
          )}

          {isFileTab && (
            <>
              {file ? (
                <div className="flex items-center gap-4 rounded-xl border border-[var(--sf-line)] bg-[var(--sf-surface)] p-4">
                  {tab === 'file' ? (
                    <FileText aria-hidden="true" className="h-8 w-8 shrink-0 text-[var(--sf-accent-fg)]" />
                  ) : (
                    <Video aria-hidden="true" className="h-8 w-8 shrink-0 text-[var(--sf-accent-fg)]" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-medium">{file.name}</p>
                    <p className="text-sm text-[var(--sf-muted)]">{(file.size / 1024 / 1024).toFixed(2)} МБ</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setFile(null)}
                    aria-label="Убрать файл"
                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[var(--sf-muted)] hover:bg-[var(--sf-surface-soft)] hover:text-[var(--sf-ink)]"
                  >
                    <X aria-hidden="true" className="h-5 w-5" />
                  </button>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={event => {
                      event.preventDefault();
                      setDragOver(true);
                    }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleDrop}
                    disabled={isCompressing}
                    className={`block w-full rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors ${
                      dragOver
                        ? 'border-[var(--sf-accent)] bg-[var(--sf-accent-soft)]'
                        : 'border-[var(--sf-line)] bg-[var(--sf-surface)] hover:border-[color-mix(in_srgb,var(--sf-accent)_45%,var(--sf-line))]'
                    }`}
                  >
                    <span className="block text-lg font-semibold">
                      {isCompressing ? 'Сжимаем изображение…' : 'Перетащите файл сюда'}
                    </span>
                    <span className="mt-1 block text-[var(--sf-muted)]">или нажмите, чтобы выбрать</span>
                    <span className="mt-3 block text-sm text-[var(--sf-muted)]">
                      {tab === 'file' ? 'PDF, DOCX, HTML, TXT, MD, JPG и PNG — до 15 МБ' : 'MP4, MP3, WAV, MPEG и M4A — до 15 МБ'}
                    </span>
                  </button>
                  {tab === 'file' && (
                    <div className="mt-3 sm:hidden">
                      <button
                        type="button"
                        onClick={() => cameraInputRef.current?.click()}
                        className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border border-[var(--sf-line)] bg-[var(--sf-surface)] px-4 text-sm font-medium"
                      >
                        <Camera aria-hidden="true" className="h-5 w-5 text-[var(--sf-accent-fg)]" /> Сфотографировать конспект
                      </button>
                      <input
                        ref={cameraInputRef}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="hidden"
                        onChange={event => {
                          const picked = event.target.files?.[0];
                          if (picked) void validateAndSet(picked);
                          event.target.value = '';
                        }}
                      />
                    </div>
                  )}
                </>
              )}
              <input
                ref={fileInputRef}
                data-testid="upload-file-input"
                type="file"
                className="hidden"
                accept={tab === 'file' ? DOC_ACCEPT : MEDIA_ACCEPT}
                onChange={event => {
                  const picked = event.target.files?.[0];
                  if (picked) void validateAndSet(picked);
                  event.target.value = '';
                }}
              />
              {fileError && (
                <p role="alert" className="mt-3 text-sm text-rose-700 dark:text-rose-300">
                  {fileError}
                </p>
              )}
            </>
          )}
        </div>

        <button
          type="button"
          onClick={onDemo}
          disabled={busy}
          className="mt-3 inline-flex min-h-[44px] items-center rounded-lg px-2 text-sm font-medium text-[var(--sf-accent-fg)] underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:opacity-60"
        >
          Попробовать на демо-тексте
        </button>
      </section>

      <section aria-labelledby={`${ids}-settings`}>
        <h2 id={`${ids}-settings`} className="mb-3 text-base font-semibold">
          Что подготовить
        </h2>
        <div className="rounded-xl border border-[var(--sf-line)] bg-[var(--sf-surface)] p-5 sm:p-6">
          <SettingsPanel settings={settings} onChange={onSettingsChange} />
        </div>
      </section>

      <div>
        <button
          type="button"
          onClick={handleStart}
          disabled={!canStart}
          aria-describedby={startNote ? noteId : undefined}
          className={PRIMARY_BUTTON}
        >
          {startLabel}
        </button>
        {startNote && (
          <p id={noteId} className="mt-3 text-sm leading-relaxed text-[var(--sf-muted)]">
            {startNote}
          </p>
        )}
      </div>
    </div>
  );
}
