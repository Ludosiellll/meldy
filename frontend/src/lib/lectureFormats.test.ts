import { describe, expect, it } from 'vitest';
import {
  DOC_LEGACY_MESSAGE,
  PPT_LEGACY_MESSAGE,
  VIDEO_LINK_MESSAGE,
  formatsList,
  isVideoLink,
  lectureFormatOf,
  unreadableFileMessage,
} from './lectureFormats';

const RECORDINGS_LINE = 'Подойдут записи MP4, MP3, WAV, MPEG и M4A — сохраните запись в одном из этих форматов и загрузите снова.';
const DOCUMENTS_LINE = 'Подойдут PDF, DOCX, PPTX, HTML, TXT, MD, JPG и PNG — сохраните файл в одном из этих форматов и загрузите снова.';

describe('isVideoLink (live QA 2026-10-11: a YouTube link made a «конспект» of the page frame)', () => {
  it('knows the video hosts, typed with or without https:// and www', () => {
    for (const link of [
      'https://www.youtube.com/watch?v=aircAruvnKk',
      'youtube.com/watch?v=aircAruvnKk',
      'https://youtu.be/aircAruvnKk',
      'https://m.youtube.com/watch?v=aircAruvnKk',
      'https://music.youtube.com/watch?v=aircAruvnKk',
      'HTTPS://YOUTU.BE/aircAruvnKk',
      'HTTPS://WWW.YOUTUBE.COM/shorts/abc',
      'https://www.youtube-nocookie.com/embed/aircAruvnKk',
      'https://rutube.ru/video/0123456789abcdef/',
      'https://vk.com/video-12345_67890',
      'https://m.vk.com/video?z=video-1_2',
      'https://m.vk.com/clip-1_2',
      'https://vk.com/wall-1_2?z=video-1_2%2Fabc',
      'https://vk.ru/video-1_2',
      'https://vkvideo.ru/video-12345_67890',
      'https://ok.ru/video/123',
      'https://dzen.ru/video/watch/650000aa0000000000000000',
      'https://dzen.ru/shorts/abc',
      'https://zen.yandex.ru/video/watch/abc',
      'https://vimeo.com/76979871',
      'https://www.tiktok.com/@user/video/1',
      '  https://youtu.be/abc  ',
    ]) {
      expect(isVideoLink(link), link).toBe(true);
    }
  });

  it('leaves pages with text alone, also on vk.com, ok.ru and dzen.ru', () => {
    for (const link of [
      'https://ru.wikipedia.org/wiki/Фотосинтез',
      'https://vk.com/wall-1_2',
      'https://vk.com/@club1-statya',
      'https://ok.ru/group/1/topic/2',
      'https://dzen.ru/a/ZZZ',
      'https://notyoutube.com/watch',
      'https://youtube.com.example.org/watch',
      'https://example.org/youtube.com',
      'https://example.com/youtube.com/video',
      'youtube',
      '',
      'ftp://youtube.com/watch',
    ]) {
      expect(isVideoLink(link), link).toBe(false);
    }
  });

  it('says what to do in the words the server uses for the same links', () => {
    expect(VIDEO_LINK_MESSAGE).toBe(
      'Ссылку на видео Meldy пока не открывает. Если запись лекции есть у вас файлом, загрузите её во вкладке «Аудио и видео» (до 15 МБ).',
    );
  });
});

describe('unreadableFileMessage (formats stopped in the picker, before the start)', () => {
  it('lets every format the server reads through, whichever tab it came by', () => {
    for (const [name, type] of [
      ['lecture.pdf', 'application/pdf'],
      ['Лекция 3.DOCX', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      ['slides.pptx', ''],
      ['notes.md', ''],
      ['page.htm', 'text/html'],
      ['photo.jpeg', 'image/jpeg'],
      ['scan.png', 'image/png'],
      ['pair.mp3', 'audio/mpeg'],
      ['pair.m4a', 'audio/x-m4a'],
      ['pair.wav', ''],
      ['lecture.mp4', 'video/mp4'],
      ['lecture.mpeg', 'video/mpeg'],
    ]) {
      expect(unreadableFileMessage({ name, type }, 'file'), name).toBeNull();
      expect(unreadableFileMessage({ name, type }, 'media'), name).toBeNull();
    }
  });

  it('says the old Word and PowerPoint formats in their own words', () => {
    expect(unreadableFileMessage({ name: 'Лекция 2.doc', type: 'application/msword' }, 'file')).toBe(DOC_LEGACY_MESSAGE);
    expect(DOC_LEGACY_MESSAGE).toBe('Старый формат Word (.doc) не читается. Сохраните файл как DOCX или PDF и загрузите снова.');
    expect(unreadableFileMessage({ name: 'Лекция 3.PPT', type: '' }, 'file')).toBe(PPT_LEGACY_MESSAGE);
  });

  it('answers a recording with the recording formats only, never the pictures', () => {
    for (const [name, type] of [
      ['voice_note.ogg', 'audio/ogg'],
      ['voice.opus', ''],
      ['screen.webm', 'video/webm'],
      ['IMG_0042.MOV', 'video/quicktime'],
      ['lecture.flac', 'audio/flac'],
    ]) {
      const ext = name.split('.').pop()?.toLowerCase();
      for (const tab of ['file', 'media'] as const) {
        const message = unreadableFileMessage({ name, type }, tab);
        expect(message, `${name} in ${tab}`).toBe(`Формат .${ext} не читается. ${RECORDINGS_LINE}`);
        expect(message).not.toMatch(/JPG|PNG|jpg|png/);
      }
    }
  });

  it('names the recording formats in «Аудио и видео» and the document formats in «Файл»', () => {
    expect(unreadableFileMessage({ name: 'table.xlsx', type: '' }, 'media')).toBe(`Формат .xlsx не читается. ${RECORDINGS_LINE}`);
    expect(unreadableFileMessage({ name: 'table.xlsx', type: '' }, 'file')).toBe(`Формат .xlsx не читается. ${DOCUMENTS_LINE}`);
    expect(unreadableFileMessage({ name: 'shot.webp', type: 'image/webp' }, 'file')).toBe(`Формат .webp не читается. ${DOCUMENTS_LINE}`);
    expect(unreadableFileMessage({ name: 'README', type: '' }, 'file')).toBe(`Формат этого файла не читается. ${DOCUMENTS_LINE}`);
  });

  it('lists formats the Russian way', () => {
    expect(formatsList(['MP4', 'MP3', 'WAV'])).toBe('MP4, MP3 и WAV');
    expect(formatsList(['PDF'])).toBe('PDF');
  });
});

describe('lectureFormatOf', () => {
  it('names the format of what was sent', () => {
    expect(lectureFormatOf(null, 'https://example.org')).toBe('url');
    expect(lectureFormatOf(new File(['x'], 'a.pdf', { type: 'application/pdf' }))).toBe('pdf');
    expect(lectureFormatOf(new File(['x'], 'a.ogg', { type: '' }))).toBe('other');
  });
});
