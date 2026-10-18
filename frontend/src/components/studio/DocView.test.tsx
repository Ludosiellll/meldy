import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyDoc } from '../../lib/studio/doc';
import type { DocBlock, TestDoc } from '../../types/testDoc';
import DocView, { type DocEditApi } from './DocView';
import { gradeDoc, type DocItem } from './docRun';
import { DOC, STUDIO } from './copyStudio';

const EXAM = '11111111-2222-4333-8444-555555555555';
const PIC = `${EXAM}/${'a'.repeat(64)}.jpg`;
const single: DocItem = { id: 'i1', kind: 'single', stem: 'Какой газ легче воздуха?', options: ['Водород', 'Хлор'], code: false, correct: [0] };
const short: DocItem = { id: 'i2', kind: 'short', stem: 'Символ натрия?', options: [], code: false, answers: ['Na'] };
const items = new Map([single, short].map((item) => [item.id, item]));
const url = (path: string) => `https://cdn.example/${path}`;

function page(layout: TestDoc['layout'], answers: TestDoc['theme']['answers'] = 'list'): TestDoc {
  const blocks: DocBlock[] = [
    { type: 'cover', id: 'cover', title: 'Газы', subtitle: 'Самопроверка', image: PIC, align: 'center' },
    { type: 'text', id: 'intro', text: 'Смотрите [учебник](https://school.example/book) и **не спешите**. <b>не HTML</b>', align: 'left' },
    { type: 'question', id: 'q1', item_id: 'i1', points: 2, required: true },
    { type: 'page', id: 'p2', title: 'Вторая часть' },
    { type: 'note', id: 'tip', tone: 'tip', text: 'Подсказка' },
    { type: 'question', id: 'q2', item_id: 'i2', points: 1, required: false },
    { type: 'question', id: 'gone', item_id: 'deleted', points: 1, required: false },
  ];
  return {
    ...emptyDoc('Газы'),
    theme: { ...emptyDoc('Газы').theme, answers },
    layout,
    blocks,
    results: {
      bands: [{ from: 50, to: 100, title: 'Хорошо', text: 'Почти **всё** верно.', image: PIC }],
      cta: { label: 'Дальше по курсу', url: 'https://school.example/course/next-topic' },
    },
  };
}

afterEach(() => cleanup());

describe('DocView in answer mode: what the participant gets', () => {
  it('the theme as custom properties, the text as text (marks, https links with their address, never HTML)', () => {
    const doc = page('one_page');
    const { container } = render(<DocView mode="answer" doc={doc} items={items} dark={false} imageUrl={url} onSubmit={(answers) => gradeDoc(doc, items, answers)} />);
    const root = container.querySelector('.dv') as HTMLElement;
    expect(root.style.getPropertyValue('--qt-fill')).toBe('#2869dd');
    expect(root.style.getPropertyValue('--doc-answer-columns')).toBe('1');
    expect(screen.getByRole('link', { name: 'учебник' })).toHaveAttribute('href', 'https://school.example/book');
    expect(screen.getByText('(school.example/book)')).toBeInTheDocument();
    expect(screen.getByText('не спешите').tagName).toBe('STRONG');
    expect(screen.getByText(/<b>не HTML<\/b>/)).toBeInTheDocument();
    expect(container.querySelector('.dv-cover-pic img')).toHaveAttribute('src', url(PIC));
    // A question block whose row is gone is skipped.
    expect(screen.getAllByRole('region').length).toBe(2);
  });

  it('«Одна страница»: required questions are asked for, then the result with its band, picture and the link’s address', async () => {
    const doc = page('one_page');
    render(<DocView mode="answer" doc={doc} items={items} dark imageUrl={url} onSubmit={(answers) => gradeDoc(doc, items, answers)} />);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(DOC.finish) }));
    expect(screen.getByRole('alert')).toHaveTextContent(DOC.missing([1]));
    fireEvent.click(screen.getByRole('radio', { name: /Водород/ }));
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(DOC.finish) }));
    expect(await screen.findByRole('heading', { name: /^67\s%$/ })).toBeInTheDocument();
    expect(screen.getByText(/^2 из 3\sбаллов$/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Хорошо' })).toBeInTheDocument();
    expect(screen.getByText('всё').tagName).toBe('STRONG');
    expect(document.querySelector('.dv-band-pic img')).toHaveAttribute('src', url(PIC));
    expect(screen.getByRole('link', { name: /Дальше по курсу/ })).toHaveAttribute('href', 'https://school.example/course/next-topic');
    expect(screen.getByText('school.example/course/next-topic')).toBeInTheDocument();
  });

  it('«По страницам»: «Дальше» checks the page’s required questions, «Назад» goes back, answers stay', () => {
    const doc = page('pages');
    const submit = vi.fn(() => gradeDoc(doc, items, {}));
    render(<DocView mode="answer" doc={doc} items={items} dark={false} onSubmit={submit} />);
    expect(screen.getByText(DOC.step(1, 2))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(DOC.next) }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /Водород/ }));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(DOC.next) }));
    expect(screen.getByRole('heading', { name: 'Вторая часть' })).toBeInTheDocument();
    expect(screen.getByText('Подсказка')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: DOC.back }));
    expect(screen.getByRole('radio', { name: /Водород/ })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('button', { name: new RegExp(DOC.next) }));
    fireEvent.change(screen.getByRole('textbox', { name: DOC.shortLabel }), { target: { value: 'Na' } });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(DOC.finish) }));
    expect(submit).toHaveBeenCalledWith({ i1: { chosen: [0] }, i2: { text: 'Na' } });
  });

  it('«Завершить» with a required question unanswered: the first such question comes into view and its head takes the focus', () => {
    const base = page('one_page');
    const doc: TestDoc = { ...base, blocks: base.blocks.map((block) => (block.type === 'question' && block.id === 'q2' ? { ...block, required: true } : block)) };
    const into = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => undefined);
    const scrolled = () => into.mock.contexts as unknown as Element[];
    render(<DocView mode="answer" doc={doc} items={items} dark={false} onSubmit={(answers) => gradeDoc(doc, items, answers)} />);
    // Both unanswered: the first of them.
    fireEvent.click(screen.getByRole('button', { name: new RegExp(DOC.finish) }));
    expect(screen.getByRole('alert')).toHaveTextContent(DOC.missing([1, 2]));
    expect(document.activeElement).toBe(document.getElementById('dv-q-q1'));
    expect(scrolled().at(-1)).toBe(document.getElementById('dv-q-q1')?.closest('.dv-q'));
    expect(into).toHaveBeenLastCalledWith({ block: 'start' });
    // The first answered: the second is the one now; every press takes the participant there again.
    fireEvent.click(screen.getByRole('radio', { name: /Водород/ }));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(DOC.finish) }));
    expect(screen.getByRole('alert')).toHaveTextContent(DOC.missing([2]));
    expect(document.activeElement).toBe(document.getElementById('dv-q-q2'));
    expect(scrolled().at(-1)).toBe(document.getElementById('dv-q-q2')?.closest('.dv-q'));
    const count = scrolled().length;
    (document.activeElement as HTMLElement).blur();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(DOC.finish) }));
    expect(scrolled()).toHaveLength(count + 1);
    expect(document.activeElement).toBe(document.getElementById('dv-q-q2'));
  });

  it('the last step’s button is the participant’s own «Завершить», on every layout (release 47.3: it said «Отправить»)', () => {
    for (const layout of ['one_page', 'pages', 'one_by_one'] as const) {
      const doc = page(layout);
      render(<DocView mode="answer" doc={doc} items={items} dark={false} onSubmit={(answers) => gradeDoc(doc, items, answers)} />);
      fireEvent.click(screen.getAllByRole('radio', { name: /Водород/ })[0]);
      if (layout !== 'one_page') fireEvent.click(screen.getByRole('button', { name: new RegExp(DOC.next) }));
      const last = document.querySelector('.dv-nav .dv-btn') as HTMLElement;
      expect(last).toHaveTextContent(DOC.finish);
      expect(screen.queryByRole('button', { name: /Отправить/ })).toBeNull();
      cleanup();
    }
  });

  it('«По одному»: a question per step, blocks before it shown with it; nothing is required on the way', () => {
    const doc = page('one_by_one', 'grid');
    const { container } = render(<DocView mode="answer" doc={doc} items={items} dark={false} onSubmit={(answers) => gradeDoc(doc, items, answers)} />);
    expect(container.querySelector('.dv')).toHaveAttribute('data-answers', 'grid');
    expect(screen.getByRole('heading', { name: 'Газы' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(DOC.next) }));
    expect(screen.getByText('Символ натрия?')).toBeInTheDocument();
    expect(screen.queryByText('Какой газ легче воздуха?')).toBeNull();
  });
});

describe('DocView in edit mode: the canvas', () => {
  function editor(over: Partial<DocEditApi> = {}): DocEditApi {
    return {
      frame: (block, _index, node) => (
        <div key={block.id} data-frame={block.id}>
          {node}
        </div>
      ),
      gap: (index) => <hr key={`gap-${index}`} data-gap={index} />,
      editing: null,
      setEditing: vi.fn(),
      change: vi.fn(),
      slash: vi.fn(),
      pickImage: vi.fn(),
      selected: null,
      ...over,
    };
  }

  it('every block in order with the canvas’s frames and gaps; the key marked; a gone question said; a page shown as a mark', () => {
    const doc = page('one_page');
    render(<DocView mode="edit" doc={doc} items={items} dark={false} imageUrl={url} editor={editor()} />);
    expect(Array.from(document.querySelectorAll('[data-frame]')).map((node) => node.getAttribute('data-frame'))).toEqual(doc.blocks.map((block) => block.id));
    expect(document.querySelectorAll('[data-gap]')).toHaveLength(doc.blocks.length + 1);
    expect(within(document.querySelector('[data-frame="q1"]') as HTMLElement).getByText(STUDIO.keyMark)).toBeInTheDocument();
    expect(screen.getByText(STUDIO.gone)).toBeInTheDocument();
    expect(screen.getByText(STUDIO.pageMark(2))).toBeInTheDocument();
    expect(document.querySelector('.dv-pagemark')).toHaveAttribute('data-off');
  });

  it('a click on a text starts typing there; typing goes to `change`; «/» in an empty text asks for the menu', () => {
    const doc = page('one_page');
    const api = editor();
    const { rerender } = render(<DocView mode="edit" doc={doc} items={items} dark={false} editor={api} />);
    fireEvent.click(screen.getByText('Газы'));
    expect(api.setEditing).toHaveBeenCalledWith('cover:title');
    const typing = editor({ editing: 'intro:text', selected: 'intro' });
    const empty = { ...doc, blocks: doc.blocks.map((block) => (block.id === 'intro' ? { ...block, text: '' } : block)) } as TestDoc;
    rerender(<DocView mode="edit" doc={empty} items={items} dark={false} editor={typing} />);
    const field = screen.getByRole('textbox', { name: STUDIO.types.text });
    fireEvent.change(field, { target: { value: 'Новый текст' } });
    expect(typing.change).toHaveBeenCalledWith('intro', { text: 'Новый текст' }, 'text');
    fireEvent.keyDown(field, { key: '/' });
    expect(typing.slash).toHaveBeenCalledWith('intro', field);
    // The marks' bar: Ctrl+B wraps the words in **…**.
    expect(screen.getByRole('toolbar', { name: STUDIO.marksLabel })).toBeInTheDocument();
  });

  it('a picture block without its picture offers to choose one', () => {
    const doc = { ...page('one_page'), blocks: [{ type: 'image', id: 'img', path: '', caption: '', width: 'wide' } as DocBlock] };
    const api = editor();
    render(<DocView mode="edit" doc={doc} items={items} dark={false} editor={api} />);
    fireEvent.click(screen.getByRole('button', { name: STUDIO.imagePick }));
    expect(api.pickImage).toHaveBeenCalledWith('img');
  });
});
