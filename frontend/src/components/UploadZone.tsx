import { useEffect, useId, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { ChevronDown, FileText, Link as LinkIcon, Type, Video, X, type LucideIcon } from 'lucide-react';
import SettingsPanel, { settingsSummary } from './SettingsPanel';
import type { AnalysisSettings } from '../types';
import { hasBadWords } from '../utils/moderation';
import { compressImage } from '../lib/imageCompression';
import { charactersLabel, pastedTextFile, pastedTextProblem, pastedTextTitle } from '../utils/pastedText';
import { DEMO_SETTINGS, isDemoText } from '../data/demo';
import {
  DOC_FORMATS,
  PPTX_MIME,
  RECORDING_FORMATS,
  VIDEO_LINK_MESSAGE,
  formatsList,
  isVideoLink,
  unreadableFileMessage,
} from '../lib/lectureFormats';
import { usePhone } from '../lib/usePhone';
import { NBSP, ty } from './landing/typo';
import './UploadZone.css';

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

/** Цвет панели у каждого источника (язык Meldy: синяя, голубая, розовая и тёплая панели). */
const PANEL_TONE: Record<UploadTab, string> = { file: 'blue', text: 'sky', url: 'rose', media: 'warm' };

export const MAX_SIZE_MB = 15;
const MAX_SIZE = MAX_SIZE_MB * 1024 * 1024;
/**
 * How long a recording fits into MAX_SIZE (finding LIB-20: the guide promised «запись пары», and a 90-minute pair is
 * 40–85 МБ): sound at 128 and 64 kbit/s, rounded down to 5 minutes — «примерно 15–30 минут звука».
 */
const AUDIO_KBPS = [128, 64] as const;
function audioMinutes(kbps: number): number {
  return Math.floor((MAX_SIZE * 8) / (kbps * 1000) / 60 / 5) * 5;
}
export const MEDIA_LENGTH = `${audioMinutes(AUDIO_KBPS[0])}–${audioMinutes(AUDIO_KBPS[1])} минут звука`;
const DOC_ACCEPT = `.pdf,.docx,.pptx,.txt,.md,.html,.htm,.jpg,.jpeg,.png,${PPTX_MIME}`;
const MEDIA_ACCEPT = '.mp4,.mp3,.wav,.mpeg,.m4a';
/**
 * Форматы на плашках — ровно то, что принимает поле выбора файла (HTM и JPEG — те же HTML и JPG); у записей — только
 * записи (lib/lectureFormats, там же слова о формате, который сервер не прочтёт).
 */
const MEDIA_FORMATS = RECORDING_FORMATS;
const DOC_FORMATS_TEXT = `${formatsList(DOC_FORMATS)} — до ${MAX_SIZE_MB} МБ`;
const MEDIA_FORMATS_TEXT = `${formatsList(MEDIA_FORMATS)} — до ${MAX_SIZE_MB} МБ, примерно ${MEDIA_LENGTH}`;
/** A phone writes the formats as one line of text, not chips (10_Project/Phone_Declutter_2026-10-08). */
const formatsLine = (formats: string[]) => `${formats.join(', ')} · до ${MAX_SIZE_MB}${NBSP}МБ`;
/** What the demo text is analysed with, whatever the panel says (Analyze.startRun uses DEMO_SETTINGS). */
const DEMO_LOCKED = 'Для демо-текста настройки не меняются.';

function ArrowIcon() {
  return (
    <svg className="az-arrow" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function megabytes(bytes: number, digits: number): string {
  return (bytes / 1024 / 1024).toFixed(digits).replace('.', ',');
}

/**
 * Brings a refusal into view when it is not (a file dropped on a panel scrolled half away), clear of the sticky top line
 * and of the start bar at the bottom by its CSS scroll margins. The focus stays where it was: the refusal is an alert.
 * Not scrollIntoView({ block: 'nearest' }): Chromium takes a block under a sticky bar for a visible one.
 */
function bringIntoView(element: HTMLElement | null) {
  if (!element || typeof element.scrollIntoView !== 'function' || typeof window === 'undefined') return;
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  const above = parseFloat(style.scrollMarginTop) || 0;
  const below = parseFloat(style.scrollMarginBottom) || 0;
  const still = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const behavior: ScrollBehavior = still ? 'auto' : 'smooth';
  if (rect.top - above < 0) element.scrollIntoView({ block: 'start', behavior });
  else if (rect.bottom + below > window.innerHeight) element.scrollIntoView({ block: 'end', behavior });
}

/**
 * «Разобрать лекцию» (finding LIB-8, 2026-10-08). The start button used to be 1 218 px under the file field, behind
 * 868 px of optional settings with good defaults, under a slogan. Now: the button's own name as the heading; step 1
 * is the source; step 2 is one line — what will be made — that «Изменить» opens; step 3, the start with the line about
 * the daily limit, follows the reader at the bottom of the screen until its place comes.
 *
 * A phone (10_Project/Phone_Declutter_2026-10-08) has nothing to drag a file from: one plain frame with «Выбрать
 * файл», the formats as one line of text and «Сфотографировать конспект» under it; the lead is one line; the source
 * tabs and «Изменить» are lighter (UploadZone.css).
 */
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
  // Every refusal, the same words again included, is brought into view.
  const [refusals, setRefusals] = useState(0);
  const [isCompressing, setIsCompressing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // «Открыть «Аудио и видео»» under a video link: the focus goes on to the file picker of that tab.
  const [focusPicker, setFocusPicker] = useState(false);
  const phone = usePhone();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLButtonElement | null>(null);
  const errorRef = useRef<HTMLParagraphElement | null>(null);
  const tabRefs = useRef<Partial<Record<UploadTab, HTMLButtonElement | null>>>({});
  const ids = useId();
  const panelId = `${ids}-panel`;
  const textId = `${ids}-text`;
  const textHintId = `${ids}-text-hint`;
  const noteId = `${ids}-note`;
  const videoNoteId = `${ids}-video`;
  const settingsId = `${ids}-settings-panel`;
  const settingsWhyId = `${ids}-settings-why`;

  const isFileTab = tab === 'file' || tab === 'media';
  const demoText = tab === 'text' && isDemoText(text);
  const trimmedLength = text.trim().length;
  const textProblem = pastedTextProblem(text);
  // A link to a video (YouTube, RuTube, VK Video, Dzen…): said before the start, which waits (lib/lectureFormats).
  const videoLink = tab === 'url' && isVideoLink(url);

  useEffect(() => {
    if (refusals > 0) bringIntoView(errorRef.current);
  }, [refusals]);

  useEffect(() => {
    if (!focusPicker) return;
    setFocusPicker(false);
    pickerRef.current?.focus();
  }, [focusPicker]);

  const refuse = (message: string) => {
    setFileError(message);
    setFile(null);
    setRefusals(count => count + 1);
  };

  const validateAndSet = async (picked: File) => {
    let finalFile = picked;
    if (!picked.name.includes('.') && picked.size > 0 && picked.type.startsWith('image/')) {
      finalFile = new File([picked], `${picked.name}.jpg`, { type: picked.type });
    }
    // A dropped file, or one chosen with «Все файлы», bypasses the picker's list of formats: a format the server would
    // refuse (an old .ppt or .doc, a recording in .ogg or .mov) is stopped here, before the start, with what to do.
    const unreadable = unreadableFileMessage(finalFile, tab === 'media' ? 'media' : 'file');
    if (unreadable) {
      refuse(unreadable);
      return;
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
      const media = finalFile.type.startsWith('audio/') || finalFile.type.startsWith('video/');
      refuse(
        media
          ? `Файл занимает ${megabytes(finalFile.size, 1)} МБ, а можно до ${MAX_SIZE_MB} МБ — примерно ${MEDIA_LENGTH}. Разделите запись на части.`
          : `Файл занимает ${megabytes(finalFile.size, 1)} МБ. Максимальный размер — ${MAX_SIZE_MB} МБ.`,
      );
    } else if (hasBadWords(finalFile.name)) {
      refuse('Название файла содержит недопустимые слова. Пожалуйста, переименуйте файл.');
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

  /** Under a video link: «Аудио и видео» in one tap, its file picker focused. */
  const openRecordings = () => {
    selectTab('media');
    setFocusPicker(true);
  };

  const isReady =
    tab === 'url'
      ? Boolean(url.trim()) && url.includes('.') && !videoLink
      : tab === 'text'
        ? textProblem === null
        : Boolean(file) && !isCompressing;
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
    // A video link: the button says why it waits, as the other waiting starts do (QA 2026-10-11: it said «Запустить
    // анализ» and did nothing); the line under the link says what to do instead.
    if (tab === 'url') startLabel = videoLink ? 'Ссылку на видео не открыть' : 'Вставьте ссылку';
    else if (tab === 'text') startLabel = trimmedLength === 0 ? 'Вставьте текст' : 'Запустить анализ';
    else startLabel = 'Сначала выберите файл';
  }

  const startNote = limited ? startDisabledReason : demoText ? undefined : costNote;
  const startDescribedBy = [videoLink ? videoNoteId : '', startNote ? noteId : ''].filter(Boolean).join(' ') || undefined;
  const formats = tab === 'media' ? MEDIA_FORMATS : DOC_FORMATS;
  // The demo text is analysed with its own settings: the line says what will be made, and «Изменить» waits.
  const summary = settingsSummary(demoText ? DEMO_SETTINGS : settings);
  const showSettings = settingsOpen && !demoText;

  return (
    <div className="az-upload">
      <header className="az-head az-rise">
        <h1 className="az-h1">Разобрать лекцию</h1>
        <p className="az-lede">
          {phone
            ? 'Meldy сделает конспект, карточки и тест.'
            : ty('Загрузите файл или вставьте текст — Meldy сделает конспект, карточки и тест со ссылками на фрагменты лекции.')}
        </p>
      </header>

      <div className="az-layout">
      <section className="az-card az-step az-source az-rise" data-d="1" aria-labelledby={`${ids}-source`}>
        <div className="az-step-head">
          <span className="az-step-n" aria-hidden="true">
            1
          </span>
          <h2 id={`${ids}-source`} className="az-h2">
            Что разобрать
          </h2>
          <div role="tablist" aria-label="Источник" className="az-tabs">
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
                  className="az-tab"
                >
                  <Icon aria-hidden="true" className="az-tab-icon" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div id={panelId} role="tabpanel" aria-labelledby={`${ids}-tab-${tab}`} className="az-tabpanel">
          {tab === 'text' && (
            <div className="az-panel" data-tone={PANEL_TONE.text}>
              <div className="az-window az-field az-field-text">
                <label htmlFor={textId} className="az-label">
                  Текст лекции или конспекта
                </label>
                <textarea
                  id={textId}
                  value={text}
                  onChange={event => onTextChange(event.target.value)}
                  placeholder="Вставьте текст лекции, главы или конспекта"
                  aria-describedby={textHintId}
                  spellCheck={false}
                  className="az-textarea"
                />
                <div id={textHintId} className="az-hint">
                  <span>
                    {demoText
                      ? 'Демо-текст: лимит не списывается'
                      : trimmedLength > 0 && textProblem
                        ? textProblem
                        : ''}
                    {demoText && onRestoreText && (
                      <button type="button" onClick={onRestoreText} className="az-inline">
                        Вернуть мой текст
                      </button>
                    )}
                  </span>
                  {/* «Нужно хотя бы 300 символов, сейчас 67» already says the count: one number, not two (QA 2026-10-11). */}
                  {!demoText && trimmedLength > 0 && textProblem ? null : <span className="az-count">{charactersLabel(trimmedLength)}</span>}
                </div>
              </div>
            </div>
          )}

          {tab === 'url' && (
            <div className="az-panel" data-tone={PANEL_TONE.url}>
              <div className="az-window az-field">
                <label htmlFor={`${ids}-url`} className="az-label">
                  Ссылка на статью или учебный материал
                </label>
                <div className="az-url">
                  <input
                    id={`${ids}-url`}
                    type="url"
                    name="source-url"
                    autoComplete="url"
                    inputMode="url"
                    placeholder="https://ru.wikipedia.org/wiki/..."
                    value={url}
                    onChange={event => onUrlChange(event.target.value)}
                    aria-describedby={videoLink ? videoNoteId : undefined}
                    className="az-input"
                  />
                  {url && (
                    <button type="button" onClick={() => onUrlChange('')} aria-label="Очистить ссылку" className="az-round az-url-clear">
                      <X aria-hidden="true" />
                    </button>
                  )}
                </div>
                {videoLink ? (
                  // Said as the link is typed or pasted, before the start: the page of a video has no text to analyse
                  // (live QA 2026-10-11). The way out is one tap: the recording as a file.
                  <div className="az-error az-video">
                    <p id={videoNoteId} role="alert">
                      {ty(VIDEO_LINK_MESSAGE)}
                    </p>
                    <button type="button" onClick={openRecordings} className="az-inline az-video-go">
                      Открыть «Аудио и видео»
                    </button>
                  </div>
                ) : (
                  <p className="az-help">
                    Подойдёт открытая страница<span className="az-wide">: Meldy возьмёт основной текст без меню и рекламы</span>.
                  </p>
                )}
                <div className="az-examples">
                  <span className="az-examples-l">Например:</span>
                  <button type="button" onClick={() => onUrlChange('https://ru.wikipedia.org/wiki/Законы_Ньютона')} className="az-chip">
                    законы Ньютона
                  </button>
                  <button type="button" onClick={() => onUrlChange('https://ru.wikipedia.org/wiki/Фотосинтез')} className="az-chip">
                    фотосинтез
                  </button>
                </div>
              </div>
            </div>
          )}

          {isFileTab && (
            <>
              {/* A refusal stands over the file's place, where the eye is after choosing (QA 2026-10-11: under the panel
                  it was below the first screen of a 1532×734 laptop). */}
              {fileError && (
                <p ref={errorRef} role="alert" className="az-error az-file-error">
                  {fileError}
                </p>
              )}
              {phone && !file ? (
                // A phone: one plain frame — the button, the formats as one line of text and, for a lecture, the camera.
                <div className="az-pick">
                  <button
                    ref={pickerRef}
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isCompressing}
                    className="az-pick-btn"
                  >
                    {isCompressing ? 'Сжимаем изображение…' : 'Выбрать файл'}
                  </button>
                  <p className="az-pick-fmt">{formatsLine(formats)}</p>
                  {tab === 'file' && (
                    <button type="button" onClick={() => cameraInputRef.current?.click()} className="az-pick-cam">
                      Сфотографировать конспект
                    </button>
                  )}
                </div>
              ) : (
                <div
                  className="az-panel"
                  data-tone={PANEL_TONE[tab]}
                  data-drag={dragOver && !file ? '' : undefined}
                  // Пока файл не выбран, файл можно бросить на всю цветную панель, а не только в окно.
                  onDragOver={
                    file
                      ? undefined
                      : event => {
                          event.preventDefault();
                          setDragOver(true);
                        }
                  }
                  onDragLeave={file ? undefined : () => setDragOver(false)}
                  onDrop={file ? undefined : handleDrop}
                >
                  {file ? (
                    <div className="az-window az-file">
                      <span className="az-file-icon" aria-hidden="true">
                        {tab === 'file' ? <FileText /> : <Video />}
                      </span>
                      <div className="az-file-text">
                        <p className="az-file-name">{file.name}</p>
                        <p className="az-file-size">{megabytes(file.size, 2)} МБ</p>
                      </div>
                      <button type="button" onClick={() => setFile(null)} aria-label="Убрать файл" className="az-round">
                        <X aria-hidden="true" />
                      </button>
                    </div>
                  ) : (
                    <button
                      ref={pickerRef}
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isCompressing}
                      className="az-window az-drop"
                    >
                      <span className="az-drop-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" focusable="false">
                          <path d="M12 16V5M7 10l5-5 5 5M5 19h14" />
                        </svg>
                      </span>
                      <span className="az-drop-title">{isCompressing ? 'Сжимаем изображение…' : 'Перетащите файл сюда'}</span>
                      <span className="az-drop-sub">или нажмите, чтобы выбрать</span>
                      <span className="az-formats" aria-hidden="true">
                        {formats.map(format => (
                          <span key={format} className="az-format">
                            {format}
                          </span>
                        ))}
                        <span className="az-format-max">до {MAX_SIZE_MB} МБ</span>
                      </span>
                      <span className="sr-only">{tab === 'file' ? DOC_FORMATS_TEXT : MEDIA_FORMATS_TEXT}</span>
                    </button>
                  )}
                </div>
              )}
              {/* «Сфотографировать конспект» is the phone's (in its frame above): a camera is a phone's thing. */}
              {!file && tab === 'file' && (
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
              )}
              {/* One line on a phone: «Сканы и фото распознаёт Google Gemini.» */}
              {tab === 'file' && (
                <p className="az-help az-scan-note">
                  Сканы и фото<span className="az-wide"> страниц</span> распознаёт{' '}
                  <span className="az-wide">
                    <span className="az-nowrap">ИИ-сервис</span>{' '}
                  </span>
                  Google Gemini.
                </p>
              )}
              {/* A phone: the length only (the frame says «до 15 МБ»; a recording too long is refused with the advice). */}
              {tab === 'media' && (
                <p className="az-help az-media-note">
                  {phone
                    ? ty(`${MAX_SIZE_MB} МБ — это примерно ${MEDIA_LENGTH}.`)
                    : ty(`До ${MAX_SIZE_MB} МБ — это примерно ${MEDIA_LENGTH}. Запись целой пары обычно больше: разделите её на части.`)}
                </p>
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
            </>
          )}
        </div>

        <button type="button" onClick={onDemo} disabled={busy} className="az-demo">
          {/* «демо-тексте» never breaks at its hyphen. */}
          <span>
            Попробовать на <span className="az-nowrap">демо-тексте</span>
          </span>
          <ArrowIcon />
        </button>
      </section>

      {/* Step 2, folded: what will be made, in one line, and what it spends; the defaults are good, «Изменить» opens
          the settings under the steps. */}
      <section className="az-card az-plan az-rise" data-d="2" aria-labelledby={`${ids}-settings`}>
        <div className="az-plan-head">
          <span className="az-step-n" aria-hidden="true">
            2
          </span>
          <h2 id={`${ids}-settings`} className="az-h2 az-plan-h">
            Что подготовить
          </h2>
        </div>
        <p className="az-plan-line">{summary.charAt(0).toUpperCase() + summary.slice(1)}</p>
        {demoText ? (
          <p id={settingsWhyId} className="az-plan-why">
            {DEMO_LOCKED}
          </p>
        ) : null}
        <button
          type="button"
          className="az-change"
          aria-expanded={showSettings}
          aria-controls={settingsId}
          aria-describedby={demoText ? settingsWhyId : undefined}
          disabled={demoText}
          onClick={() => setSettingsOpen(open => !open)}
        >
          {showSettings ? 'Свернуть настройки' : 'Изменить'}
          <ChevronDown aria-hidden="true" className="az-change-icon" />
        </button>
        {startNote && (
          <p id={noteId} className="az-note">
            {startNote}
          </p>
        )}
      </section>

      {/* Step 3: beside step 1 on a wide screen; below it on a narrow one, where it follows the reader at the
          bottom of the screen until its place comes. */}
      <div className="az-launch az-rise" data-d="3">
        <span className="az-step-n" aria-hidden="true">
          3
        </span>
        <button
          type="button"
          onClick={handleStart}
          disabled={!canStart}
          aria-describedby={startDescribedBy}
          className="sf-primary az-start"
        >
          {startLabel}
        </button>
      </div>
      </div>

      {showSettings ? (
        <section id={settingsId} className="az-card az-settings-card" aria-label="Настройки разбора">
          <SettingsPanel settings={settings} onChange={onSettingsChange} />
        </section>
      ) : null}
    </div>
  );
}
