import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { isDraftQuestion } from '../../lib/studio/checker';
import { emptyDoc } from '../../lib/studio/doc';
import { draftProblems } from '../containers/keys/editorModel';
import type { TestItem } from '../../types/container';
import type { DocBlock, ResultBand } from '../../types/testDoc';
import { STUDIO } from './copyStudio';
import Editable, { wrapMark } from './Editable';
import { draftInput, draftOf } from './newQuestion';
import { ENTRIES, paletteEntry, paletteId } from './Palette';
import { PRESETS, presetDataUrl, presetSvg } from './presets';
import { bandIssues, freeRange } from './ResultPanel';
import { toSend } from './useStudio';
import { hintFor } from './Workspace';

afterEach(() => cleanup());

const band = (from: number, to: number, title = 'Итог'): ResultBand => ({ from, to, title, text: '', image: null });

describe('the marks of a rich text', () => {
  it('wraps the selection, or the mark’s word when nothing is selected', () => {
    expect(wrapMark('Это важно', 4, 9, 'bold')).toEqual({ value: 'Это **важно**', start: 6, end: 11 });
    expect(wrapMark('Это важно', 4, 9, 'italic').value).toBe('Это *важно*');
    expect(wrapMark('См. тут', 4, 7, 'link', 'https://site.ru').value).toBe('См. [тут](https://site.ru)');
    expect(wrapMark('', 0, 0, 'bold').value).toBe('**жирный**');
  });

  it('Ctrl+B, Ctrl+I and Ctrl+K in the field; a link must be https', () => {
    function Field() {
      const [value, setValue] = useState('Это важно');
      return <Editable value={value} onChange={setValue} label="Текст" rich multiline max={4000} active onActivate={() => undefined} onDone={() => undefined} />;
    }
    render(<Field />);
    const field = screen.getByRole('textbox', { name: 'Текст' }) as HTMLTextAreaElement;
    field.setSelectionRange(4, 9);
    fireEvent.keyDown(field, { key: 'b', ctrlKey: true });
    expect(field.value).toBe('Это **важно**');
    field.setSelectionRange(0, 3);
    fireEvent.keyDown(field, { key: 'ш', ctrlKey: true });
    expect(field.value).toBe('*Это* **важно**');
    field.setSelectionRange(0, 0);
    fireEvent.keyDown(field, { key: 'k', ctrlKey: true });
    const href = screen.getByRole('textbox', { name: STUDIO.linkAsk });
    fireEvent.change(href, { target: { value: 'http://site.ru' } });
    fireEvent.keyDown(href, { key: 'Enter' });
    expect(screen.getByRole('alert')).toHaveTextContent(STUDIO.linkBad);
    fireEvent.change(href, { target: { value: 'https://site.ru' } });
    fireEvent.click(screen.getByRole('button', { name: STUDIO.linkPut }));
    expect(field.value).toBe('[ссылка](https://site.ru)*Это* **важно**');
  });

  it('a one-line field ends on Enter and keeps one line', () => {
    let done = '';
    function Field() {
      const [value, setValue] = useState('Заголовок');
      return <Editable value={value} onChange={setValue} label="Заголовок" max={200} active onActivate={() => undefined} onDone={(how) => (done = how)} />;
    }
    render(<Field />);
    const field = screen.getByRole('textbox', { name: 'Заголовок' }) as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: 'Две\nстроки' } });
    expect(field.value).toBe('Две строки');
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(done).toBe('enter');
    expect(screen.queryByRole('toolbar')).toBeNull();
  });
});

describe('a block’s first words (live check of release 47.2: «ЗаметкаЗаметка 47.2»)', () => {
  /** A field shown as the page shows it until a click, as the canvas has it. */
  function Field({ first, starter, slash }: { first: string; starter?: string; slash?: () => void }) {
    const [value, setValue] = useState(first);
    const [active, setActive] = useState(false);
    return (
      <Editable
        value={value}
        onChange={setValue}
        label="Заметка"
        rich
        multiline
        max={4000}
        starter={starter}
        active={active}
        onActivate={() => setActive(true)}
        onDone={() => setActive(false)}
        onSlash={slash ? () => slash() : undefined}
      />
    );
  }
  const field = () => screen.getByRole('textbox', { name: 'Заметка' }) as HTMLTextAreaElement;

  it('the words the block started with open selected whole: the first key typed replaces them', async () => {
    const user = userEvent.setup();
    render(<Field first="Заметка" starter="Заметка" />);
    await user.click(screen.getByText('Заметка'));
    expect(field()).toHaveFocus();
    expect([field().selectionStart, field().selectionEnd]).toEqual([0, 'Заметка'.length]);
    await user.keyboard('Заметка 47.3: прочитайте вопрос до конца.');
    expect(field()).toHaveValue('Заметка 47.3: прочитайте вопрос до конца.');
  });

  it('words the author wrote open with the cursor at their end', async () => {
    const user = userEvent.setup();
    render(<Field first="Заметка о главном" starter="Заметка" />);
    await user.click(screen.getByText('Заметка о главном'));
    expect([field().selectionStart, field().selectionEnd]).toEqual([17, 17]);
    await user.keyboard('.');
    expect(field()).toHaveValue('Заметка о главном.');
  });

  it('a field without first words (a caption, a subtitle) opens with the cursor at the end, as before', async () => {
    const user = userEvent.setup();
    render(<Field first="Заметка" />);
    await user.click(screen.getByText('Заметка'));
    expect([field().selectionStart, field().selectionEnd]).toEqual([7, 7]);
  });

  it('«/» over the selected first words asks for the block menu, as in an empty block; in the author’s words it is typed', async () => {
    const user = userEvent.setup();
    let asked = 0;
    render(<Field first="Текст" starter="Текст" slash={() => (asked += 1)} />);
    await user.click(screen.getByText('Текст'));
    fireEvent.keyDown(field(), { key: '/' });
    expect(asked).toBe(1);
    await user.keyboard('Дроби');
    expect(field()).toHaveValue('Дроби');
    fireEvent.keyDown(field(), { key: '/' });
    expect(asked).toBe(1);
  });
});

describe('«Результат»: the ranges as typed', () => {
  it('says a start after its end, overlaps and a missing title as problems', () => {
    expect(bandIssues([band(60, 40)]).map((issue) => [issue.at, issue.bad])).toEqual([[0, true]]);
    const overlap = bandIssues([band(0, 49), band(40, 100)]);
    expect(overlap).toEqual([{ at: 1, bad: true, message: STUDIO.bandOverlap('0–49 %', '40–100 %') }]);
    expect(bandIssues([band(0, 100, ' ')])[0].message).toBe(STUDIO.bandNoTitle);
  });

  it('says ranges nobody covers as a thought; none when the bands cover 0–100', () => {
    expect(bandIssues([band(0, 49), band(50, 100)])).toEqual([]);
    expect(bandIssues([band(10, 49), band(60, 90)])).toEqual([
      { at: 0, bad: false, message: STUDIO.bandGap(0, 9) },
      { at: 1, bad: false, message: STUDIO.bandGap(50, 59) },
      { at: 1, bad: false, message: STUDIO.bandGap(91, 100) },
    ]);
  });

  it('a new band takes the first free range', () => {
    expect(freeRange([])).toEqual({ from: 0, to: 100 });
    expect(freeRange([band(0, 49)])).toEqual({ from: 50, to: 100 });
    expect(freeRange([band(20, 100)])).toEqual({ from: 0, to: 19 });
    expect(freeRange([band(0, 100)])).toEqual({ from: 90, to: 100 });
  });
});

describe('the palette, new questions and the hints', () => {
  it('palette ids go both ways', () => {
    for (const entry of ENTRIES) expect(paletteEntry(paletteId(entry))).toEqual(entry);
    expect(paletteEntry('block-1')).toBeNull();
    expect(paletteEntry('palette:block:nope')).toBeNull();
  });

  it('a question new from the palette is a valid row the checker calls a draft', () => {
    for (const type of ['single', 'multiple', 'truefalse', 'short'] as const) {
      expect(draftProblems(draftOf(type)), type).toEqual([]);
      const input = draftInput(type, `studio:${type}`);
      const row = { ...input, kind: input.kind ?? 'single', answers: input.answers ?? [] } as unknown as TestItem;
      expect(isDraftQuestion(row), type).toBe(true);
    }
    expect(draftInput('multiple', 'r').kind).toBe('multiple');
    expect(draftInput('short', 'r')).toMatchObject({ kind: 'short', answers: ['ответ'], options: [] });
    expect(draftInput('truefalse', 'r')).toMatchObject({ options: ['Верно', 'Неверно'], keep_order: true });
  });

  it('one line near the selected block, by its kind and the page', () => {
    const doc = emptyDoc('Т');
    const page: DocBlock = { type: 'page', id: 'p1', title: '' };
    expect(hintFor(page, doc, new Map())).toBe(STUDIO.hints.pageOff);
    expect(hintFor(page, { ...doc, layout: 'pages' }, new Map())).toBe(STUDIO.hints.pageOn);
    const row = { id: 'r', kind: 'single', stem: 'Вопрос', options: ['а', 'б'], correct: [], answers: [] } as unknown as TestItem;
    const question: DocBlock = { type: 'question', id: 'q', item_id: 'r', points: 1, required: true };
    expect(hintFor(question, doc, new Map([['r', row]]))).toBe(STUDIO.hints.questionNoKey);
    expect(hintFor(question, doc, new Map([['r', { ...row, correct: [0] }]]))).toBe(STUDIO.hints.questionRequired);
    expect(hintFor(question, { ...doc, layout: 'one_page' }, new Map([['r', { ...row, correct: [0] }]]))).toBe(STUDIO.hints.question);
    expect(hintFor(question, doc, new Map())).toBe(STUDIO.gone);
  });

  it('a save leaves out a picture block still waiting for its picture, and a video still waiting for its link', () => {
    const doc = {
      ...emptyDoc('Т'),
      blocks: [
        { type: 'image', id: 'img00001', path: '', caption: '', width: 'wide' },
        { type: 'video', id: 'vid00001', url: '', caption: '' },
        { type: 'divider', id: 'div00001' },
      ] as DocBlock[],
    };
    expect(toSend(doc, []).blocks.map((block) => block.id)).toEqual(['div00001']);
    const video = { ...doc, blocks: [{ type: 'video', id: 'vid00001', url: 'https://youtu.be/dQw4w9WgXcQ', caption: '' }] as DocBlock[] };
    expect(toSend(video, [])).toBe(video);
    doc.blocks.splice(1, 1);
    const ready = { ...doc, blocks: [doc.blocks[1]] };
    expect(toSend(ready, [])).toBe(ready);
  });
});

describe('the six ready pictures', () => {
  it('are six, drawn the same each time, plain SVG with no script or outside address', () => {
    expect(PRESETS).toHaveLength(6);
    for (const preset of PRESETS) {
      const svg = presetSvg(preset.id, 320, 128);
      expect(svg).toBe(presetSvg(preset.id, 320, 128));
      expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
      expect(svg).not.toMatch(/<script|href=|<image|foreignObject/i);
      expect(presetDataUrl(preset.id, 10, 4)).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
    }
  });
});
