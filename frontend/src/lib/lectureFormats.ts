/**
 * Форматы лекций и строки о распознавании сканов — одни на загрузку материала и на импорт
 * «только текст». Сервер читает PPTX (backend/parser.py), а скан PDF без текста и фото
 * страниц распознаёт Gemini (backend/ocr.py); ответ тогда несёт ocr: true и pages.
 */

/** MIME-тип PPTX: по нему поле выбора файла показывает презентации и на телефонах. */
export const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

/** Старый двоичный .ppt сервер не читает; тот же текст отвечает сервер (parser.PPT_LEGACY_DETAIL). */
export const PPT_LEGACY_MESSAGE =
  'Старый формат PowerPoint (.ppt) не читается. Сохраните презентацию как PPTX или PDF и загрузите снова.';

/** Строка там, где появился текст, распознанный со скана (как ocr.OCR_NOTICE на сервере). */
export const OCR_NOTICE = 'Текст распознан со скана — сверьте формулы и числа с оригиналом.';

/** То же для фото страницы. */
export const OCR_PHOTO_NOTICE = 'Текст распознан с фото — сверьте формулы и числа с оригиналом.';

/** Текст из записи лекции (text_extracted с transcribed: true): речь распознаётся с ошибками в терминах и именах. */
export const TRANSCRIPT_NOTICE = 'Текст распознан из записи — сверьте термины, числа и имена.';

export function isLegacyPpt(fileName: string): boolean {
  return /\.ppt$/i.test(fileName.trim());
}

/** Старый двоичный .doc сервер не читает так же, как .ppt: поле выбора говорит это сразу, а не после запуска. */
export const DOC_LEGACY_MESSAGE = 'Старый формат Word (.doc) не читается. Сохраните файл как DOCX или PDF и загрузите снова.';

/** The formats the picker names: the document tab's (pictures are photos of pages) and the recordings'. */
export const DOC_FORMATS = ['PDF', 'DOCX', 'PPTX', 'HTML', 'TXT', 'MD', 'JPG', 'PNG'];
export const RECORDING_FORMATS = ['MP4', 'MP3', 'WAV', 'MPEG', 'M4A'];

/** «MP4, MP3, WAV, MPEG и M4A». */
export function formatsList(formats: readonly string[]): string {
  return formats.length > 1 ? `${formats.slice(0, -1).join(', ')} и ${formats[formats.length - 1]}` : formats.join('');
}

/**
 * The extensions the server reads (backend/main.py): /api/analyze takes DOCUMENT_EXTENSIONS, /api/analyze/media takes
 * MEDIA_EXTENSIONS (the recordings and the photos).
 */
const READABLE_EXTENSIONS = ['pdf', 'txt', 'docx', 'pptx', 'md', 'html', 'htm', 'mp4', 'mp3', 'wav', 'mpeg', 'm4a', 'jpg', 'jpeg', 'png'];
/** Recordings people have that the server does not read: the picker answers them as recordings. */
const OTHER_RECORDINGS = ['ogg', 'oga', 'opus', 'webm', 'mov', 'avi', 'mkv', 'flac', 'aac', 'wma', 'amr', '3gp', 'm4v', 'wmv', 'mpg', 'aif', 'aiff'];

function extensionOf(fileName: string): string {
  return (/\.([a-z0-9]{1,8})$/i.exec(fileName.trim())?.[1] ?? '').toLowerCase();
}

function formatName(ext: string): string {
  return ext ? `Формат .${ext}` : 'Формат этого файла';
}

/**
 * Why the picker stops a file the server would refuse by its format, or null (live QA 2026-10-11: .doc and .ogg were
 * refused only after the start, as a bare list of extensions). The old Office formats get their own words; a
 * recording, or anything chosen in «Аудио и видео», is told the recording formats; anything else, the document ones.
 * An extension the server reads is never stopped here, whichever tab it came through.
 */
export function unreadableFileMessage(file: { name: string; type?: string }, tab: 'file' | 'media'): string | null {
  const ext = extensionOf(file.name);
  if (ext === 'ppt') return PPT_LEGACY_MESSAGE;
  if (ext === 'doc') return DOC_LEGACY_MESSAGE;
  if (READABLE_EXTENSIONS.includes(ext)) return null;
  const recording = /^(audio|video)\//i.test(file.type || '') || OTHER_RECORDINGS.includes(ext);
  if (recording || tab === 'media') {
    return `${formatName(ext)} не читается. Подойдут записи ${formatsList(RECORDING_FORMATS)} — сохраните запись в одном из этих форматов и загрузите снова.`;
  }
  return `${formatName(ext)} не читается. Подойдут ${formatsList(DOC_FORMATS)} — сохраните файл в одном из этих форматов и загрузите снова.`;
}

/**
 * A link to a video host. Meldy reads the text of a page, and a video's page has none worth a summary (live QA
 * 2026-10-11: a YouTube link was taken silently, spent the units and made a «конспект» of the page's frame). The
 * server refuses the same links with the same words (backend utils.is_video_link): keep the two lists in step, or a
 * link passes here and is refused only after the start.
 */
export const VIDEO_LINK_MESSAGE =
  'Ссылку на видео Meldy пока не открывает. Если запись лекции есть у вас файлом, загрузите её во вкладке «Аудио и видео» (до 15 МБ).';

/** Hosts all of whose pages are videos. */
const VIDEO_HOSTS = ['youtube.com', 'youtube-nocookie.com', 'youtu.be', 'rutube.ru', 'vkvideo.ru', 'vimeo.com', 'tiktok.com'];
/** Hosts where only some pages are videos: VK and OK clips and videos, Dzen videos and shorts. */
const VIDEO_PATHS: Record<string, RegExp> = {
  'vk.com': /^\/(?:video|clip)/i,
  'vk.ru': /^\/(?:video|clip)/i,
  'ok.ru': /^\/video/i,
  'dzen.ru': /^\/(?:video|shorts)/i,
  'zen.yandex.ru': /^\/(?:video|shorts)/i,
};
/** «vk.com/wall-1_2?z=video-1_2»: a video opened over another page. */
const VIDEO_OVER_PAGE = /(?:^|&)z=(?:video|clip)/i;

function sameOrSubdomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** «youtube.com/watch?v=…», «https://m.youtube.com/…», «youtu.be/…», «vk.com/video-1_2» — typed or pasted, with or without https://. */
export function isVideoLink(value: string): boolean {
  const text = value.trim();
  if (!text) return false;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (VIDEO_HOSTS.some((domain) => sameOrSubdomain(host, domain))) return true;
  return Object.entries(VIDEO_PATHS).some(
    ([domain, path]) => sameOrSubdomain(host, domain) && (path.test(url.pathname) || VIDEO_OVER_PAGE.test(url.search.slice(1))),
  );
}

/**
 * The format of a lecture sent for analysis, for the statistics (lib/telemetry, event lecture_upload):
 * pdf, docx, pptx, txt, md, html, photo, audio, video, url or other. A pasted text goes as a .txt file.
 */
export function lectureFormatOf(file: File | null | undefined, url?: string): string {
  if (url) return 'url';
  const type = file?.type || '';
  if (type.startsWith('image/')) return 'photo';
  if (type.startsWith('audio/')) return 'audio';
  if (type.startsWith('video/')) return 'video';
  const ext = (/\.([a-z0-9]+)$/i.exec(file?.name || '')?.[1] || '').toLowerCase();
  if (['pdf', 'docx', 'pptx', 'txt', 'md'].includes(ext)) return ext;
  if (ext === 'html' || ext === 'htm') return 'html';
  if (['jpg', 'jpeg', 'png'].includes(ext)) return 'photo';
  if (['mp3', 'wav', 'm4a', 'mpeg'].includes(ext)) return 'audio';
  if (ext === 'mp4') return 'video';
  return 'other';
}
