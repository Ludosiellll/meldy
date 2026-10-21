import { describe, expect, it } from 'vitest';
import nginxConf from '../../../../nginx.conf?raw';
import { DOC_VIDEO_PATTERN } from '../../types/testDoc';
import { cleanVideoUrl, startSeconds, VIDEO_EMBED_ORIGINS, videoEmbed, videoUrlOk } from './video';

const YT = 'dQw4w9WgXcQ';
const RT = 'c6cc4d620b1d4338901770a44b3e82f4';

describe('videoEmbed: the player of each host, made from the link’s checked parts', () => {
  it.each([
    [`https://www.youtube.com/watch?v=${YT}`, 'youtube', `https://www.youtube-nocookie.com/embed/${YT}`],
    [`https://youtube.com/watch?feature=share&v=${YT}&t=1m30s`, 'youtube', `https://www.youtube-nocookie.com/embed/${YT}?start=90`],
    [`https://m.youtube.com/watch?v=${YT}&start=15`, 'youtube', `https://www.youtube-nocookie.com/embed/${YT}?start=15`],
    [`https://youtu.be/${YT}?t=42`, 'youtube', `https://www.youtube-nocookie.com/embed/${YT}?start=42`],
    [`https://youtu.be/${YT}?si=abcDEF123`, 'youtube', `https://www.youtube-nocookie.com/embed/${YT}`],
    [`https://www.youtube.com/shorts/${YT}`, 'youtube', `https://www.youtube-nocookie.com/embed/${YT}`],
    [`https://www.youtube.com/live/${YT}?feature=shared`, 'youtube', `https://www.youtube-nocookie.com/embed/${YT}`],
    [`https://www.youtube.com/embed/${YT}`, 'youtube', `https://www.youtube-nocookie.com/embed/${YT}`],
    [`https://www.youtube-nocookie.com/embed/${YT}`, 'youtube', `https://www.youtube-nocookie.com/embed/${YT}`],
    [`https://rutube.ru/video/${RT}/`, 'rutube', `https://rutube.ru/play/embed/${RT}`],
    [`https://rutube.ru/video/${RT}/?t=75`, 'rutube', `https://rutube.ru/play/embed/${RT}?t=75`],
    [`https://rutube.ru/video/private/${RT}/?p=Ab_c-12`, 'rutube', `https://rutube.ru/play/embed/${RT}?p=Ab_c-12`],
    [`https://rutube.ru/shorts/${RT}/`, 'rutube', `https://rutube.ru/play/embed/${RT}`],
    [`https://rutube.ru/play/embed/${RT}`, 'rutube', `https://rutube.ru/play/embed/${RT}`],
    ['https://vk.com/video-22822305_456242110', 'vk', 'https://vkvideo.ru/video_ext.php?oid=-22822305&id=456242110'],
    ['https://vkvideo.ru/video-22822305_456242110?list=ln-abc', 'vk', 'https://vkvideo.ru/video_ext.php?oid=-22822305&id=456242110'],
    ['https://m.vk.com/video123_456', 'vk', 'https://vkvideo.ru/video_ext.php?oid=123&id=456'],
    ['https://vk.ru/clip-1_2', 'vk', 'https://vkvideo.ru/video_ext.php?oid=-1&id=2'],
    ['https://vk.com/video_ext.php?oid=-22822305&id=456242110&hash=8d2c4e1a&hd=2', 'vk', 'https://vkvideo.ru/video_ext.php?oid=-22822305&id=456242110&hash=8d2c4e1a'],
  ])('%s → %s', (link, provider, src) => {
    expect(videoEmbed(link)).toEqual({ provider, src, name: provider === 'youtube' ? 'YouTube' : provider === 'rutube' ? 'RuTube' : 'VK Видео' });
  });

  it('every player comes from one of the three origins', () => {
    for (const link of [`https://youtu.be/${YT}`, `https://rutube.ru/video/${RT}/`, 'https://vk.com/video-1_2']) {
      expect(VIDEO_EMBED_ORIGINS).toContain(new URL(videoEmbed(link)!.src).origin);
    }
  });

  it('a key or a hash that is not plain letters and digits is left out of the player’s address', () => {
    expect(videoEmbed(`https://rutube.ru/video/private/${RT}/?p=a%22onload%3D1`)!.src).toBe(`https://rutube.ru/play/embed/${RT}`);
    expect(videoEmbed('https://vk.com/video_ext.php?oid=1&id=2&hash=a-b')!.src).toBe('https://vkvideo.ru/video_ext.php?oid=1&id=2');
  });

  it.each([
    ['another host', 'https://vimeo.com/76979871'],
    ['http', `http://youtu.be/${YT}`],
    ['a lookalike host', `https://youtube.com.evil.example/watch?v=${YT}`],
    ['a subdomain the pattern does not know', `https://music.youtube.com/watch?v=${YT}`],
    ['an id of 10 characters', `https://youtu.be/${YT.slice(0, 10)}`],
    ['an id with a dot', `https://youtu.be/${YT.slice(0, 10)}.`],
    ['a YouTube page without a video', 'https://www.youtube.com/channel/UC1234567890'],
    ['a RuTube id of 31 characters', `https://rutube.ru/video/${RT.slice(1)}/`],
    ['a VK wall post', 'https://vk.com/wall-1_2'],
    ['javascript:', `javascript:alert(1)//youtu.be/${YT}`],
    ['empty', ''],
    ['301 characters', `https://youtu.be/${YT}?x=${'a'.repeat(300)}`],
  ])('null for %s', (_, link) => {
    expect(videoEmbed(link)).toBeNull();
    expect(videoUrlOk(link)).toBe(false);
  });
});

describe('cleanVideoUrl: what the author pastes', () => {
  it.each([
    [`  https://youtu.be/${YT}  `, `https://youtu.be/${YT}`],
    [`youtu.be/${YT}`, `https://youtu.be/${YT}`],
    [`//www.youtube.com/watch?v=${YT}`, `https://www.youtube.com/watch?v=${YT}`],
    [`http://www.youtube.com/watch?v=${YT}`, `https://www.youtube.com/watch?v=${YT}`],
    [`https://WWW.YouTube.com/watch?v=${YT}`, `https://www.youtube.com/watch?v=${YT}`],
    [`https://rutube.ru/video/${RT}/?r=wd`, `https://rutube.ru/video/${RT}/?r=wd`],
    // VK's embed code: only the address is kept (never the HTML).
    ['<iframe src="https://vkvideo.ru/video_ext.php?oid=-1&amp;id=2&amp;hash=ab12&amp;hd=2" width="853" allowfullscreen></iframe>', 'https://vkvideo.ru/video_ext.php?oid=-1&id=2&hash=ab12&hd=2'],
    [`<iframe width="560" src='https://www.youtube.com/embed/${YT}?si=x'></iframe>`, `https://www.youtube.com/embed/${YT}?si=x`],
    // Cyrillic in the query is escaped, so the link is ASCII as the server wants it.
    [`https://youtu.be/${YT}?метка=1`, `https://youtu.be/${YT}?%D0%BC%D0%B5%D1%82%D0%BA%D0%B0=1`],
  ])('%s → %s', (input, out) => {
    expect(cleanVideoUrl(input)).toBe(out);
    expect(videoUrlOk(out)).toBe(true);
  });

  it.each([
    ['another host', 'https://vimeo.com/1'],
    ['words', 'видео про натрий'],
    ['a link with a space', `https://youtu.be/${YT} x`],
    ['a port', `https://youtu.be:8443/${YT}`],
    ['a user name', `https://me@youtu.be/${YT}`],
    ['ftp', `ftp://youtu.be/${YT}`],
    ['nothing', '   '],
  ])('null for %s', (_, input) => {
    expect(cleanVideoUrl(input)).toBeNull();
  });
});

describe('start times', () => {
  it.each([
    ['90', 90],
    ['90s', 90],
    ['1m30s', 90],
    ['1h2m3s', 3723],
    ['2m', 120],
    ['0', null],
    ['', null],
    [null, null],
    ['abc', null],
    ['-5', null],
  ])('%s → %s', (value, seconds) => {
    expect(startSeconds(value)).toBe(seconds);
  });
});

describe('the server’s pattern is the client’s', () => {
  it('meldy_private.test_doc_ok (20261019110000_doc_video.sql) holds DOC_VIDEO_PATTERN character for character', async () => {
    const migrations = import.meta.glob('../../../../supabase/migrations/20261019110000_doc_video.sql', { query: '?raw', import: 'default', eager: true });
    const sql = Object.values(migrations)[0] as string;
    expect(sql).toContain(`c_video constant text := '${DOC_VIDEO_PATTERN}';`);
  });
});

describe('the site lets exactly these players in (nginx.conf frame-src)', () => {
  const policies = Array.from(nginxConf.matchAll(/add_header Content-Security-Policy "([^"]+)" always;/g), (match) => match[1]);
  it('every location names the three origins as frame-src, and nothing more', () => {
    expect(policies).toHaveLength(4);
    for (const policy of policies) {
      const frame = policy
        .split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith('frame-src '));
      expect(frame?.split(/\s+/).slice(1).sort()).toEqual([...VIDEO_EMBED_ORIGINS].sort());
    }
  });
});
