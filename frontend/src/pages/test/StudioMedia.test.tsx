import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocBlock, TestDoc } from '../../types/testDoc';

/**
 * The studio's own pictures and videos (owner, 2026-10-19): Ctrl+V and a file dropped on the page make picture blocks,
 * a picture field takes a dropped file, a failure keeps the old picture, the background waits for the author's file,
 * a video block from the palette. The page is StudioPage with its data mocked as in StudioPage.test.tsx; the pictures go
 * through the real pictureFromFile (jsdom cannot draw: a small PNG is kept as it is, a HEIC is said in words) into a
 * mocked bucket.
 */
const api = vi.hoisted(() => ({
  addItems: vi.fn(),
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
  reorderItems: vi.fn(),
  fetchTestDoc: vi.fn(),
  saveTestDoc: vi.fn(),
  upload: vi.fn(),
  state: { summary: null as unknown, items: null as unknown },
}));

vi.mock('../../api/containers', () => ({
  addItems: api.addItems,
  updateItem: api.updateItem,
  deleteItem: api.deleteItem,
  reorderItems: api.reorderItems,
  isGone: (error: { code?: string } | null) => error?.code === 'P0002',
  isOffline: (error: { code?: string } | null) => error?.code === 'network',
}));
vi.mock('../../api/testDocs', () => ({
  fetchTestDoc: api.fetchTestDoc,
  saveTestDoc: api.saveTestDoc,
  isStale: (error: { code?: string } | null) => error?.code === 'MC020',
  refusedRule: (error: { code?: string; detail?: string } | null) => (error?.code === '22023' ? error.detail ?? null : null),
}));
vi.mock('../../lib/containers/hooks', () => ({
  useContainerData: () => ({
    data: { summary: api.state.summary, items: api.state.items, planInput: null, oralWithoutPoints: 0 },
    loading: false,
    offline: false,
    unavailable: false,
    error: null,
    gone: false,
    reload: vi.fn(),
  }),
}));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: null, session: null, loading: false }) }));
vi.mock('../../api/itemPictures', async (original) => ({
  ...(await original<typeof import('../../api/itemPictures')>()),
  uploadPicture: api.upload,
  coverUrl: (path: string) => `https://covers.test/${path}`,
}));

import StudioPage from './StudioPage';
import { item, subject, summary } from '../../components/containers/testkit/fixtures';
import { STUDIO } from '../../components/studio/copyStudio';
import { emptyDoc } from '../../lib/studio/doc';

const EXAM = '11111111-2222-4333-8444-555555555555';
const SUBJ = '22222222-3333-4444-8555-666666666666';
const Q1 = item({ container_id: EXAM, subject_id: SUBJ, topic: null, key_source: 'manual', images: null, id: 'c0000000-0000-4000-8000-000000000001', position: 1, file_no: '1', stem: 'Какой газ выделяется?', options: ['Кислород', 'Водород'], correct: [1] });
const OLD = `${EXAM}/${'c'.repeat(64)}.png`;
const PATH_RE = new RegExp(`^${EXAM}/[0-9a-f]{64}\\.png$`);

function storedDoc(): TestDoc {
  return {
    ...emptyDoc('Опыты'),
    layout: 'one_page',
    blocks: [
      { type: 'cover', id: 'cover0000001', title: 'Опыты', subtitle: '', image: OLD, align: 'center' },
      { type: 'heading', id: 'head00000001', text: 'Часть первая', size: 'l' },
      { type: 'text', id: 'text00000001', text: 'Посмотрите опыт.', align: 'left' },
      { type: 'question', id: 'qblock000001', item_id: Q1.id, points: 1, required: false },
    ],
  };
}

const png = (name = 'Снимок.png', bytes = [0x89, 0x50, 0x4e, 0x47, 1, 2, 3]) => new File([new Uint8Array(bytes)], name, { type: 'image/png' });
const order = () => Array.from(document.querySelectorAll<HTMLElement>('.st-block')).map((node) => node.dataset.block as string);
const frame = (id: string) => document.querySelector<HTMLElement>(`[data-block="${id}"]`) as HTMLElement;
const side = () => screen.getByRole('complementary', { name: STUDIO.panelsLabel });
const canvas = () => document.querySelector('.st-scroll') as HTMLElement;
const files = (list: File[]) => ({ dataTransfer: { types: ['Files'], files: list, dropEffect: 'none' } });
/** A drag event at a height of the window (jsdom has no DragEvent: a MouseEvent carrying the files). */
function dragAt(node: Element, type: 'dragenter' | 'dragover' | 'drop', list: File[], clientY: number): boolean {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY });
  Object.defineProperty(event, 'dataTransfer', { value: files(list).dataTransfer });
  let passed = true;
  act(() => {
    passed = node.dispatchEvent(event);
  });
  return passed;
}

async function openStored(doc: TestDoc = storedDoc()) {
  api.fetchTestDoc.mockResolvedValue({ container_id: EXAM, doc, rev: 3, updated_at: '2026-10-19T08:00:00Z' });
  render(
    <MemoryRouter initialEntries={[`/exams/c/${EXAM}/studio`]}>
      <Routes>
        <Route path="/exams/c/:id/studio" element={<StudioPage />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByRole('group', { name: '1 из 4: Обложка' });
}

/** The page's blocks stand 100 px apart, 80 px high, in their order (jsdom lays nothing out). */
function layOut() {
  return vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const at = this.classList.contains('st-block') ? Number(this.dataset.index) : 0;
    const top = at * 100;
    return { top, bottom: top + 80, height: 80, left: 0, right: 600, width: 600, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
  });
}

beforeEach(() => {
  api.state.summary = summary({
    id: EXAM,
    title: 'Химия',
    exam_date: null,
    subjects: [subject({ id: SUBJ, title: 'Вопросы', exam_date: null, oral: null, topic_titles: [], topics: [], kinds: { single: 1, multiple: 0, short: 0 } })],
    owner: { members: 0, doubts_open: 0, links: [] },
  });
  api.state.items = new Map([[Q1.id, Q1]]);
  api.fetchTestDoc.mockReset();
  api.saveTestDoc.mockReset().mockImplementation(async (_id: string, _doc: TestDoc, rev: number) => ({ rev: rev + 1, updated_at: '2026-10-19T08:00:01Z' }));
  api.upload.mockReset().mockResolvedValue('kept');
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the studio: own pictures in every way', () => {
  it('Ctrl+V with a picture anywhere: a picture block after the selected one, uploaded into quiz-covers', async () => {
    await openStored();
    fireEvent.click(frame('head00000001'));
    const pasted = fireEvent.paste(document.body, { clipboardData: { files: [png()], getData: () => '' } });
    expect(pasted).toBe(false);
    await waitFor(() => expect(api.upload).toHaveBeenCalledTimes(1));
    const [path, picture, bucket] = api.upload.mock.calls[0] as [string, { type: string }, string];
    expect(path).toMatch(PATH_RE);
    expect(picture.type).toBe('image/png');
    expect(bucket).toBe('quiz-covers');
    const ids = order();
    expect(ids).toHaveLength(5);
    expect(frame(ids[2])).toHaveAttribute('data-type', 'image');
    expect(frame(ids[2])).toHaveAttribute('data-selected');
    await waitFor(() => expect(frame(ids[2]).querySelector('.dv-pic img')).toHaveAttribute('src', `https://covers.test/${path}`));
  });

  it('words pasted stay words; a picture pasted into the question editor stays the editor’s', async () => {
    await openStored();
    fireEvent.click(frame('head00000001'));
    expect(fireEvent.paste(document.body, { clipboardData: { files: [], getData: () => 'слова' } })).toBe(true);
    expect(order()).toHaveLength(4);
    // Something else took the picture first (the editor's texts call preventDefault): the page leaves it.
    const taken = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(taken, 'clipboardData', { value: { files: [png()], getData: () => '' } });
    taken.preventDefault();
    document.body.dispatchEvent(taken);
    expect(order()).toHaveLength(4);
  });

  it('«Картинка» from the palette opens the files first; a picture pasted then fills that block', async () => {
    await openStored();
    const click = vi.spyOn(HTMLInputElement.prototype, 'click');
    fireEvent.click(frame('head00000001'));
    fireEvent.click(within(screen.getByRole('complementary', { name: STUDIO.palette })).getByRole('button', { name: STUDIO.types.image }));
    expect(click).toHaveBeenCalledTimes(1);
    const added = order()[2];
    expect(frame(added)).toHaveAttribute('data-type', 'image');
    expect(within(frame(added)).getByRole('button', { name: STUDIO.imagePick })).toBeInTheDocument();
    fireEvent.paste(document.body, { clipboardData: { files: [png()], getData: () => '' } });
    await waitFor(() => expect(frame(added).querySelector('.dv-pic img')).not.toBeNull());
    expect(order()).toHaveLength(5);
  });

  it('files dragged from the computer onto the page: the line where they land, then a picture block each', async () => {
    await openStored();
    layOut();
    const two = [png('Опыт 1.png', [1, 2]), png('Опыт 2.png', [3, 4])];
    // Over the lower half of block 2 (the text): the line between it and the question.
    dragAt(canvas(), 'dragenter', two, 250);
    expect(dragAt(canvas(), 'dragover', two, 250)).toBe(false);
    const line = document.querySelectorAll('.st-gap')[3] as HTMLElement;
    expect(line).toHaveAttribute('data-file');
    expect(line).toHaveTextContent(STUDIO.canvasDrop);
    expect(document.querySelectorAll('.st-gap[data-file]')).toHaveLength(1);
    expect(canvas()).toHaveAttribute('data-file-over');
    // Higher up, over the heading's upper half: the line moves before it.
    dragAt(canvas(), 'dragover', two, 110);
    expect(document.querySelectorAll('.st-gap')[1]).toHaveAttribute('data-file');
    dragAt(canvas(), 'drop', two, 250);
    expect(document.querySelector('.st-gap[data-file]')).toBeNull();
    const ids = order();
    expect(ids.map((id) => frame(id).dataset.type)).toEqual(['cover', 'heading', 'text', 'image', 'image', 'question']);
    await waitFor(() => expect(api.upload).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(document.querySelectorAll('.dv-figure .dv-pic img')).toHaveLength(2));
  });

  it('a file that is not a picture, dropped on the page: its block says why it is empty', async () => {
    await openStored();
    layOut();
    const pdf = new File(['%PDF'], 'Задание.pdf', { type: 'application/pdf' });
    dragAt(canvas(), 'drop', [pdf], 5);
    const added = order()[0];
    expect(frame(added)).toHaveAttribute('data-type', 'image');
    expect(await within(frame(added)).findByRole('alert')).toHaveTextContent(STUDIO.pictureType);
    expect(api.upload).not.toHaveBeenCalled();
  });

  it('a file dropped where nothing takes it is refused, so the browser does not leave the studio', async () => {
    await openStored();
    const outside = document.querySelector('.st-bar') ?? document.body;
    const over = fireEvent.dragOver(outside, files([png()]));
    const dropped = fireEvent.drop(outside, files([png()]));
    expect(over).toBe(false);
    expect(dropped).toBe(false);
    expect(order()).toHaveLength(4);
  });

  it('a cover’s field: a file dropped onto it replaces the ready picture; a failure says why and keeps the old one', async () => {
    await openStored();
    fireEvent.click(frame('cover0000001'));
    const field = within(side()).getByRole('group', { name: STUDIO.picture });
    expect(within(field).getAllByRole('button')[0]).toHaveAccessibleName(STUDIO.pictureReplaceOwn);
    // A phone's HEIC the browser cannot draw.
    const heic = new File([new Uint8Array(10)], 'IMG_2042.HEIC', { type: '' });
    fireEvent.drop(field, files([heic]));
    expect(await within(field).findByRole('alert')).toHaveTextContent(`${STUDIO.pictureHeic} ${STUDIO.pictureKept}`);
    expect(document.querySelector('.dv-cover-pic img')).toHaveAttribute('src', `https://covers.test/${OLD}`);
    // The bucket refuses: the old picture stays too.
    api.upload.mockResolvedValueOnce('refused');
    fireEvent.drop(field, files([png()]));
    await waitFor(() => expect(within(field).getByRole('alert')).toHaveTextContent(`${STUDIO.pictureFailed} ${STUDIO.pictureKept}`));
    expect(document.querySelector('.dv-cover-pic img')).toHaveAttribute('src', `https://covers.test/${OLD}`);
    // Then it goes.
    fireEvent.drop(field, files([png('Своя.png', [9, 9, 9])]));
    await waitFor(() => expect(document.querySelector('.dv-cover-pic img')?.getAttribute('src')).not.toBe(`https://covers.test/${OLD}`));
    expect(within(field).queryByRole('alert')).toBeNull();
  });

  it('the file field takes any picture: exactly image/*, so a phone opens its photos', async () => {
    await openStored();
    expect(document.querySelector('input[type="file"][data-studio-file]')).toHaveAttribute('accept', 'image/*');
  });

  it('«Оформление» → «Картинка»: the author’s own upload first, the ready ones after; the page waits for a picture', async () => {
    await openStored();
    fireEvent.click(screen.getByRole('tab', { name: STUDIO.panels.design }));
    fireEvent.click(within(side()).getByRole('button', { name: STUDIO.backgrounds.image }));
    expect(within(side()).getByRole('button', { name: STUDIO.backgrounds.image })).toHaveAttribute('aria-pressed', 'true');
    // Nothing applied by itself: no ready picture uploaded, the page still plain.
    expect(api.upload).not.toHaveBeenCalled();
    expect(document.querySelector('.st-doc')).toHaveAttribute('data-bg', 'plain');
    const field = within(side()).getByRole('group', { name: STUDIO.picture });
    expect(within(field).getAllByRole('button')[0]).toHaveAccessibleName(STUDIO.pictureUpload);
    expect(within(field).getByText(STUDIO.presetsBackground)).toBeInTheDocument();
    expect(within(side()).queryByLabelText(STUDIO.dim)).toBeNull();
    fireEvent.drop(field, files([png('Фон.png', [5, 6, 7])]));
    await waitFor(() => expect(document.querySelector('.st-doc')).toHaveAttribute('data-bg', 'image'));
    expect(document.querySelector('.st-doc .dv-bg img')?.getAttribute('src')).toMatch(/^https:\/\/covers\.test\//);
    expect(within(side()).getByLabelText(STUDIO.dim)).toHaveValue('40');
  });
});

describe('the studio: a video block', () => {
  it('from the palette, after the selected block, its link field in focus; a link makes it a player and is saved', async () => {
    await openStored();
    fireEvent.click(frame('head00000001'));
    fireEvent.click(within(screen.getByRole('complementary', { name: STUDIO.palette })).getByRole('button', { name: STUDIO.types.video }));
    const added = order()[2];
    expect(frame(added)).toHaveAttribute('data-type', 'video');
    const link = within(frame(added)).getByRole('textbox', { name: STUDIO.videoEmpty });
    await waitFor(() => expect(link).toHaveFocus());
    expect(within(side()).getByLabelText(STUDIO.videoLink)).toHaveValue('');
    fireEvent.paste(link, { clipboardData: { files: [], getData: () => 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' } });
    const player = await within(frame(added)).findByTitle(STUDIO.videoTitles.youtube);
    expect(player).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    await waitFor(() => expect(api.saveTestDoc).toHaveBeenCalled(), { timeout: 3000 });
    const saved = api.saveTestDoc.mock.calls[api.saveTestDoc.mock.calls.length - 1][1] as TestDoc;
    expect(saved.blocks[2]).toEqual({ type: 'video', id: added, url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', caption: '' });
  });

  it('the settings change the link; a link of another site is said and not taken', async () => {
    const doc = storedDoc();
    doc.blocks.splice(2, 0, { type: 'video', id: 'video0000001', url: 'https://youtu.be/dQw4w9WgXcQ', caption: '' } as DocBlock);
    api.fetchTestDoc.mockResolvedValue({ container_id: EXAM, doc, rev: 3, updated_at: '' });
    render(
      <MemoryRouter initialEntries={[`/exams/c/${EXAM}/studio`]}>
        <Routes>
          <Route path="/exams/c/:id/studio" element={<StudioPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByRole('group', { name: '1 из 5: Обложка' });
    fireEvent.click(frame('video0000001'));
    const input = within(side()).getByLabelText(STUDIO.videoLink);
    expect(input).toHaveValue('https://youtu.be/dQw4w9WgXcQ');
    fireEvent.change(input, { target: { value: 'https://vimeo.com/1' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(within(side()).getByRole('alert')).toHaveTextContent(STUDIO.videoBad);
    expect(within(frame('video0000001')).getByTitle(STUDIO.videoTitles.youtube)).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'rutube.ru/video/c6cc4d620b1d4338901770a44b3e82f4/' } });
    fireEvent.blur(input);
    expect(await within(frame('video0000001')).findByTitle(STUDIO.videoTitles.rutube)).toHaveAttribute('src', 'https://rutube.ru/play/embed/c6cc4d620b1d4338901770a44b3e82f4');
  });
});
