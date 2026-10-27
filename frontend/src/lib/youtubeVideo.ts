/**
 * A YouTube lecture by its link (owner, 2026-10-27): the server has Gemini write down the video's speech and prices it
 * as a recording of its length (backend youtube_video.py). The length is read here, before the start, from YouTube's
 * own embedded player in this browser: a data centre soon gets YouTube's «unusual traffic» page instead of the video's
 * page, a browser does not. The player comes from youtube-nocookie.com (no cookies until a video is played), the one
 * YouTube origin nginx.conf lets into a frame (lib/studio/video.ts), and is never shown or played: it is asked for the
 * video's details with the messages of YouTube's IFrame API («listening» → «initialDelivery»).
 *
 * The server writes down only as much of the video as the length says (its clips have bounds), so a length that is
 * wrong costs the one who sent it, never the site.
 */

export interface YoutubeVideo {
  /** The video's length in seconds, rounded up. */
  seconds: number;
  title: string;
}

const PLAYER_ORIGIN = 'https://www.youtube-nocookie.com';
const VIDEO_ID = /^[0-9A-Za-z_-]{11}$/;
const YOUTUBE_HOST = /(^|\.)(youtube\.com|youtube-nocookie\.com)$/;
/** How often the player is told the page listens, until it answers. */
const LISTEN_EVERY_MS = 250;
export const MEASURE_TIMEOUT_MS = 10_000;

/** The 11-character id of a YouTube video link (watch?v=, youtu.be/, shorts/, embed/, live/), or null. */
export function youtubeVideoId(link: string): string | null {
  let text = (link || '').trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `https://${text}`;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);
  let id: string | null = null;
  if (host === 'youtu.be' || host.endsWith('.youtu.be')) id = parts[0] ?? null;
  else if (YOUTUBE_HOST.test(host)) {
    if (['shorts', 'embed', 'live', 'v'].includes(parts[0] ?? '') && parts.length > 1) id = parts[1];
    else id = url.searchParams.get('v');
  }
  return id && VIDEO_ID.test(id) ? id : null;
}

interface PlayerInfo {
  duration?: unknown;
  videoData?: { title?: unknown };
}

/**
 * The length and title of the video ``id`` from YouTube's player, or null when the player says nothing of them in
 * ``timeoutMs`` (no network, a removed or private video) or ``signal`` aborts. The player's frame is gone either way.
 */
export function measureYoutubeVideo(
  id: string,
  { timeoutMs = MEASURE_TIMEOUT_MS, signal }: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<YoutubeVideo | null> {
  if (!VIDEO_ID.test(id) || typeof document === 'undefined') return Promise.resolve(null);
  return new Promise(resolve => {
    const frame = document.createElement('iframe');
    const query = new URLSearchParams({ enablejsapi: '1', origin: window.location.origin, widgetid: '1', mute: '1' });
    frame.src = `${PLAYER_ORIGIN}/embed/${id}?${query}`;
    frame.title = 'YouTube';
    frame.tabIndex = -1;
    frame.setAttribute('aria-hidden', 'true');
    frame.setAttribute('data-youtube-length', id);
    frame.style.cssText = 'position:fixed;left:-10px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;border:0';

    let listening: number | undefined;
    let timer: number | undefined;
    let settled = false;
    const finish = (value: YoutubeVideo | null) => {
      if (settled) return;
      settled = true;
      window.clearInterval(listening);
      window.clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      signal?.removeEventListener('abort', onAbort);
      frame.remove();
      resolve(value);
    };
    const onAbort = () => finish(null);
    function onMessage(event: MessageEvent) {
      if (event.origin !== PLAYER_ORIGIN || event.source !== frame.contentWindow) return;
      let data: { info?: PlayerInfo } | null = null;
      try {
        data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      } catch {
        return;
      }
      const duration = Number(data?.info?.duration);
      if (!Number.isFinite(duration) || duration <= 0) return;
      const title = data?.info?.videoData?.title;
      finish({ seconds: Math.ceil(duration), title: typeof title === 'string' ? title.trim().slice(0, 200) : '' });
    }

    if (signal?.aborted) {
      resolve(null);
      return;
    }
    signal?.addEventListener('abort', onAbort);
    window.addEventListener('message', onMessage);
    frame.addEventListener('load', () => {
      const say = () =>
        frame.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), PLAYER_ORIGIN);
      say();
      listening = window.setInterval(say, LISTEN_EVERY_MS);
    });
    timer = window.setTimeout(() => finish(null), timeoutMs);
    document.body.appendChild(frame);
  });
}

export interface ServerVideoInfo extends YoutubeVideo {
  units: number;
}

/**
 * The server's reading of the video (its watch page, /api/youtube/info) when the player in the page said nothing:
 * the video, or the server's words why it cannot be taken (a closed, removed or unlisted video, a live stream).
 */
export async function serverYoutubeInfo(
  link: string,
  signal?: AbortSignal,
): Promise<{ ok: true; video: ServerVideoInfo } | { ok: false; message: string }> {
  try {
    const response = await fetch(`/api/youtube/info?url=${encodeURIComponent(link)}`, { signal });
    const body = await response.json().catch(() => null);
    if (response.ok && body && Number(body.seconds) > 0) {
      return {
        ok: true,
        video: { seconds: Math.ceil(Number(body.seconds)), title: String(body.title ?? ''), units: Number(body.units) },
      };
    }
    const detail = body && typeof body.detail === 'string' ? body.detail : '';
    return { ok: false, message: detail || YOUTUBE_UNREAD_MESSAGE };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    return { ok: false, message: YOUTUBE_UNREAD_MESSAGE };
  }
}

export const YOUTUBE_UNREAD_MESSAGE =
  'Не удалось узнать длину видео. Проверьте ссылку или попробуйте через минуту. Если под видео есть «Показать расшифровку», скопируйте текст и вставьте во вкладку «Текст».';
