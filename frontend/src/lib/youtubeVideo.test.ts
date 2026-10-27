import { afterEach, describe, expect, it, vi } from 'vitest';
import { measureYoutubeVideo, serverYoutubeInfo, youtubeVideoId, YOUTUBE_UNREAD_MESSAGE } from './youtubeVideo';

const PLAYER = 'https://www.youtube-nocookie.com';
const frame = () => document.querySelector<HTMLIFrameElement>('iframe[data-youtube-length]');

/** What YouTube's player posts to the page once it is told the page listens. */
function playerSays(data: unknown, { origin = PLAYER, source = frame()?.contentWindow ?? null } = {}) {
  window.dispatchEvent(new MessageEvent('message', { data: typeof data === 'string' ? data : JSON.stringify(data), origin, source }));
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('youtubeVideoId (the same links as backend youtube_video.video_id)', () => {
  it.each([
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'youtube.com/watch?v=dQw4w9WgXcQ&t=42s',
    'https://youtu.be/dQw4w9WgXcQ?si=abc',
    'https://m.youtube.com/watch?feature=share&v=dQw4w9WgXcQ',
    'https://www.youtube.com/shorts/dQw4w9WgXcQ',
    'https://www.youtube.com/embed/dQw4w9WgXcQ',
    'https://www.youtube.com/live/dQw4w9WgXcQ?feature=shared',
  ])('%s', link => {
    expect(youtubeVideoId(link)).toBe('dQw4w9WgXcQ');
  });

  it.each(['https://www.youtube.com/', 'https://www.youtube.com/@channel', 'https://www.youtube.com/playlist?list=PL1',
    'https://youtu.be/short', 'https://example.com/watch?v=dQw4w9WgXcQ', ''])('no video: %s', link => {
    expect(youtubeVideoId(link)).toBeNull();
  });
});

describe('measureYoutubeVideo: the length from YouTube’s player in this page', () => {
  it('takes the player’s length (rounded up) and title, then removes the player', async () => {
    const reading = measureYoutubeVideo('dQw4w9WgXcQ');
    const player = frame()!;
    expect(player.src).toMatch(/^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?enablejsapi=1&origin=/);
    expect(player).toHaveAttribute('aria-hidden', 'true');
    expect(player.tabIndex).toBe(-1);
    playerSays({ event: 'onReady' });
    playerSays({ event: 'initialDelivery', info: { duration: 213.04, videoData: { title: ' Лекция 5 ' } } });
    await expect(reading).resolves.toEqual({ seconds: 214, title: 'Лекция 5' });
    expect(frame()).toBeNull();
  });

  it('tells the player that the page listens once it has loaded', () => {
    void measureYoutubeVideo('dQw4w9WgXcQ');
    const post = vi.spyOn(frame()!.contentWindow!, 'postMessage');
    frame()!.dispatchEvent(new Event('load'));
    expect(post).toHaveBeenCalledWith(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), PLAYER);
  });

  it('hears only the player it made, from YouTube’s address', async () => {
    vi.useFakeTimers();
    const reading = measureYoutubeVideo('dQw4w9WgXcQ', { timeoutMs: 1000 });
    playerSays({ info: { duration: 99 } }, { origin: 'https://evil.example' });
    playerSays({ info: { duration: 99 } }, { source: window });
    playerSays('not json');
    playerSays({ info: { duration: 0 } });
    vi.advanceTimersByTime(1000);
    await expect(reading).resolves.toBeNull();
    expect(frame()).toBeNull();
  });

  it('says nothing when stopped, and nothing for an id that is no id', async () => {
    const controller = new AbortController();
    const reading = measureYoutubeVideo('dQw4w9WgXcQ', { signal: controller.signal });
    controller.abort();
    await expect(reading).resolves.toBeNull();
    expect(frame()).toBeNull();
    await expect(measureYoutubeVideo('<script>')).resolves.toBeNull();
  });
});

describe('serverYoutubeInfo: the server’s reading when the player says nothing', () => {
  it('the video from /api/youtube/info', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ seconds: 600, title: 'Лекция', units: 20 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(serverYoutubeInfo('https://youtu.be/dQw4w9WgXcQ')).resolves.toEqual({
      ok: true,
      video: { seconds: 600, title: 'Лекция', units: 20 },
    });
    expect(fetchMock).toHaveBeenCalledWith(`/api/youtube/info?url=${encodeURIComponent('https://youtu.be/dQw4w9WgXcQ')}`, {
      signal: undefined,
    });
  });

  it('the server’s words for a video it cannot take, ours when it says none', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ detail: 'Это видео недоступно.' }), { status: 400 })));
    await expect(serverYoutubeInfo('x')).resolves.toEqual({ ok: false, message: 'Это видео недоступно.' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { status: 502 })));
    await expect(serverYoutubeInfo('x')).resolves.toEqual({ ok: false, message: YOUTUBE_UNREAD_MESSAGE });
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))));
    await expect(serverYoutubeInfo('x')).resolves.toEqual({ ok: false, message: YOUTUBE_UNREAD_MESSAGE });
  });
});
