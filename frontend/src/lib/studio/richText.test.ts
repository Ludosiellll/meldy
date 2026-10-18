import { describe, expect, it } from 'vitest';
import { escapeRich, LINK_ADDRESS_MAX, linkAddress, parseRich, plainOf, type RichRun } from './richText';

const run = (text: string, marks: Partial<Omit<RichRun, 'text'>> = {}): RichRun => ({ text, bold: false, italic: false, href: null, ...marks });

describe('parseRich', () => {
  it('plain text is one run; nothing is no runs', () => {
    expect(parseRich('Просто текст <b>не HTML</b>')).toEqual([run('Просто текст <b>не HTML</b>')]);
    expect(parseRich('')).toEqual([]);
  });

  it('bold, italic, both', () => {
    expect(parseRich('Это **важно** и *тихо*.')).toEqual([run('Это '), run('важно', { bold: true }), run(' и '), run('тихо', { italic: true }), run('.')]);
    expect(parseRich('***всё сразу***')).toEqual([run('всё сразу', { bold: true, italic: true })]);
    expect(parseRich('**жирный *и курсив* внутри**')).toEqual([
      run('жирный ', { bold: true }),
      run('и курсив', { bold: true, italic: true }),
      run(' внутри', { bold: true }),
    ]);
  });

  it('follows CommonMark for stars between words, around spaces and unclosed', () => {
    expect(parseRich('2*3*4')).toEqual([run('2'), run('3', { italic: true }), run('4')]);
    expect(parseRich('a * b * c')).toEqual([run('a * b * c')]);
    expect(parseRich('**не закрыт')).toEqual([run('**не закрыт')]);
    expect(parseRich('*a**b*')).toEqual([run('a**b', { italic: true })]);
    expect(parseRich('***a**')).toEqual([run('*'), run('a', { bold: true })]);
    expect(parseRich('"*цитата*"')).toEqual([run('"'), run('цитата', { italic: true }), run('"')]);
    expect(parseRich('*x*y')).toEqual([run('x', { italic: true }), run('y')]);
    expect(parseRich('***a***b')).toEqual([run('a', { bold: true, italic: true }), run('b')]);
  });

  it('links: https only, the words may carry marks', () => {
    expect(parseRich('См. [учебник](https://example.com/book).')).toEqual([run('См. '), run('учебник', { href: 'https://example.com/book' }), run('.')]);
    expect(parseRich('[**жирная** ссылка](https://a.ru)')).toEqual([
      run('жирная', { bold: true, href: 'https://a.ru' }),
      run(' ссылка', { href: 'https://a.ru' }),
    ]);
    expect(parseRich('**[внутри](https://a.ru)**')).toEqual([run('внутри', { bold: true, href: 'https://a.ru' })]);
    expect(parseRich('[a\\]b](https://a.ru)')).toEqual([run('a]b', { href: 'https://a.ru' })]);
  });

  it.each([
    '[незащищённая](http://a.ru)',
    '[скрипт](javascript:alert(1))',
    '[](https://a.ru)',
    '[  ](https://a.ru)',
    '[две\nстроки](https://a.ru)',
    '[без скобки](https://a.ru',
    '[без адреса]',
    '[без адреса] (https://a.ru)',
    '[вложенная [скобка]](https://a.ru)',
    '[пробел](https://a.ru/с пробелом)',
    '[не закрыта',
    '[хвост\\',
  ])('anything else stays plain text: %s', (text) => {
    expect(parseRich(text).every((entry) => entry.href === null)).toBe(true);
    expect(plainOf(text)).toBe(text.replace(/\\(?=[\\*[\]()])/g, ''));
  });

  it('a link inside link words is not a link', () => {
    expect(parseRich('[a [b](https://b.ru)](https://a.ru)')).toEqual([run('[a '), run('b', { href: 'https://b.ru' }), run('](https://a.ru)')]);
  });

  it('a backslash keeps a mark as a character', () => {
    expect(parseRich('\\*не курсив\\*')).toEqual([run('*не курсив*')]);
    expect(parseRich('путь C:\\\\temp\\new')).toEqual([run('путь C:\\temp\\new')]);
    expect(parseRich('\\[не ссылка\\](https://a.ru)')).toEqual([run('[не ссылка](https://a.ru)')]);
    expect(parseRich('конец\\')).toEqual([run('конец\\')]);
  });
});

describe('plainOf and escapeRich', () => {
  it('plainOf drops the marks and keeps the words of a link', () => {
    expect(plainOf('**Внимание:** читайте [условие](https://a.ru) *дважды*')).toBe('Внимание: читайте условие дважды');
  });

  it.each(['2 * 3 = 6', '**не жирный**', '[a](https://a.ru)', 'C:\\new\\*', '*', '\\', '[[x]]', 'обычный текст'])('escapeRich keeps «%s» as it is', (text) => {
    expect(parseRich(escapeRich(text))).toEqual([run(text)]);
  });
});

describe('linkAddress', () => {
  it('shows the address without https:// and a final slash', () => {
    expect(linkAddress('https://example.com/')).toBe('example.com');
    expect(linkAddress('https://example.com/a/b')).toBe('example.com/a/b');
  });

  it('cuts a long path, never the host', () => {
    const long = `https://example.com/${'path/'.repeat(20)}`;
    const shown = linkAddress(long);
    expect(shown.startsWith('example.com/path/')).toBe(true);
    expect(shown.endsWith('…')).toBe(true);
    expect(shown.length).toBe(LINK_ADDRESS_MAX);
    const host = `${'sub.'.repeat(15)}example.com`;
    expect(linkAddress(`https://${host}/page`)).toBe(`${host}/…`);
    expect(linkAddress(`https://${host}`)).toBe(host);
  });
});
