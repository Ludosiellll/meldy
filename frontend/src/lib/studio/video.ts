/**
 * The video block (owner, 2026-10-19): a link to YouTube, RuTube or VK Видео, shown as the provider's player. The page
 * keeps only the link (types/testDoc.ts DOC_VIDEO_RE, the server's rule `block:<n>:url`); the player's address is made
 * here when the page is drawn, from the parts of the link that are checked one by one (the video's id, a start time, a
 * private link's key) — never from the link as a whole, and never from HTML.
 *
 * - YouTube plays from youtube-nocookie.com (no cookies until the video is played).
 * - RuTube: rutube.ru/play/embed/<id> (a private video keeps its key `p`).
 * - VK Видео: vkvideo.ru/video_ext.php?oid=…&id=… (with `hash` when the link has one: VK's own embed code carries it).
 *
 * The hosts the players come from are VIDEO_EMBED_ORIGINS; nginx.conf's frame-src lists exactly these.
 */
import { DOC_URL_MAX, DOC_VIDEO_RE } from '../../types/testDoc';

export type VideoProvider = 'youtube' | 'rutube' | 'vk';

export const VIDEO_PROVIDER_NAMES: Record<VideoProvider, string> = { youtube: 'YouTube', rutube: 'RuTube', vk: 'VK Видео' };

/** Where the players come from (the iframe's src), one origin per provider. */
export const VIDEO_EMBED_ORIGINS = ['https://www.youtube-nocookie.com', 'https://rutube.ru', 'https://vkvideo.ru'] as const;

/** A video block's link as the server takes it: one of the known forms, https, at most 300 characters. */
export function videoUrlOk(url: unknown): url is string {
  return typeof url === 'string' && Array.from(url).length <= DOC_URL_MAX && DOC_VIDEO_RE.test(url);
}

/**
 * What the author pasted, as the link the page keeps, or null when it is not a video of the three: spaces trimmed, the
 * address of a pasted embed code (`<iframe src="…">`) taken out of it, «https://» added when missing, http made https,
 * the host in lower case and other characters escaped (URL), then checked as the server checks it.
 */
export function cleanVideoUrl(input: string): string | null {
  let text = input.trim();
  const framed = /<iframe\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i.exec(text);
  if (framed) text = framed[1].replace(/&amp;/g, '&').trim();
  if (!text || /\s/.test(text)) return null;
  if (text.startsWith('//')) text = `https:${text}`;
  else if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) text = `https://${text}`;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol === 'http:') url.protocol = 'https:';
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  const href = url.href;
  return videoUrlOk(href) ? href : null;
}

export interface VideoEmbed {
  provider: VideoProvider;
  /** The player's address. */
  src: string;
  /** «YouTube», «RuTube», «VK Видео». */
  name: string;
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const RUTUBE_ID = /^[0-9a-f]{32}$/;
const VK_NUMBER = /^-?[0-9]{1,20}$/;
const KEY = /^[A-Za-z0-9_-]{1,64}$/;

/** A start time in seconds: «90», «90s», «1m30s», «1h2m3s»; null for anything else or 0. */
export function startSeconds(value: string | null): number | null {
  if (!value) return null;
  const match = /^(?:(\d{1,2})h)?(?:(\d{1,4})m)?(?:(\d{1,6})s?)?$/.exec(value);
  if (!match || (!match[1] && !match[2] && !match[3])) return null;
  const seconds = Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
  return seconds > 0 && seconds < 360000 ? seconds : null;
}

function withQuery(base: string, params: Record<string, string | number | null>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== null && value !== '') query.set(key, String(value));
  const text = query.toString();
  return text ? `${base}?${text}` : base;
}

function youtube(url: URL): string | null {
  const parts = url.pathname.split('/').filter(Boolean);
  let id: string | null = null;
  if (url.hostname === 'youtu.be') id = parts[0] ?? null;
  else if (parts[0] === 'watch') id = url.searchParams.get('v');
  else if (['shorts', 'embed', 'live'].includes(parts[0] ?? '')) id = parts[1] ?? null;
  if (!id || !YOUTUBE_ID.test(id)) return null;
  const start = startSeconds(url.searchParams.get('t')) ?? startSeconds(url.searchParams.get('start'));
  return withQuery(`https://www.youtube-nocookie.com/embed/${id}`, { start });
}

function rutube(url: URL): string | null {
  const id = url.pathname.split('/').find((part) => RUTUBE_ID.test(part));
  if (!id) return null;
  const key = url.searchParams.get('p');
  return withQuery(`https://rutube.ru/play/embed/${id}`, { p: key && KEY.test(key) ? key : null, t: startSeconds(url.searchParams.get('t')) });
}

function vk(url: URL): string | null {
  let oid: string | null = null;
  let id: string | null = null;
  const path = /^\/(?:video|clip)(-?[0-9]{1,20})_([0-9]{1,20})(?:\/|$)/.exec(url.pathname);
  if (path) [, oid, id] = path;
  else if (url.pathname === '/video_ext.php') {
    oid = url.searchParams.get('oid');
    id = url.searchParams.get('id');
  }
  if (!oid || !id || !VK_NUMBER.test(oid) || !/^[0-9]{1,20}$/.test(id)) return null;
  const hash = url.searchParams.get('hash');
  return withQuery('https://vkvideo.ru/video_ext.php', { oid, id, hash: hash && /^[0-9A-Za-z]{1,64}$/.test(hash) ? hash : null });
}

/** The player of a video block's link, or null when the link is not one the page takes. */
export function videoEmbed(link: string): VideoEmbed | null {
  if (!videoUrlOk(link)) return null;
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(?:www|m)\./, '');
  const provider: VideoProvider | null =
    host === 'youtube.com' || host === 'youtu.be' || host === 'youtube-nocookie.com' ? 'youtube' : host === 'rutube.ru' ? 'rutube' : ['vk.com', 'vk.ru', 'vkvideo.ru'].includes(host) ? 'vk' : null;
  if (!provider) return null;
  const src = provider === 'youtube' ? youtube(url) : provider === 'rutube' ? rutube(url) : vk(url);
  return src ? { provider, src, name: VIDEO_PROVIDER_NAMES[provider] } : null;
}
