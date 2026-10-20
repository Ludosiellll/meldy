import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyDoc } from '../../lib/studio/doc';
import type { DocBlock, TestDoc } from '../../types/testDoc';
import { STUDIO } from './copyStudio';
import DocView, { type DocEditApi } from './DocView';
import PictureField from './PictureField';
import { BLOCK_KINDS } from './Palette';
import { rememberPreset, type PictureTarget, type UploadStage } from './pictures';
import type { SideApi } from './Workspace';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const EXAM = '11111111-2222-4333-8444-555555555555';
const PIC = `${EXAM}/${'a'.repeat(64)}.png`;
const url = (path: string) => `https://covers.test/${path}`;
const png = (name = 'photo.png') => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, { type: 'image/png' });

function sideApi(over: Partial<SideApi> = {}): SideApi {
  return {
    pickPicture: vi.fn(),
    uploadFile: vi.fn(),
    usePreset: vi.fn(),
    stageOf: () => null,
    noteOf: () => null,
    touch: false,
    removeBlock: vi.fn(),
    ...over,
  };
}

const COVER: PictureTarget = { kind: 'cover', blockId: 'cover0000001' };

describe('PictureField: the author’s own picture first', () => {
  it('«Загрузить свою картинку» leads, with the other ways in under it; the ready pictures come after it', () => {
    const api = sideApi();
    render(<PictureField label={STUDIO.picture} path={null} target={COVER} api={api} presets="cover" />);
    const field = screen.getByRole('group', { name: STUDIO.picture });
    const buttons = within(field).getAllByRole('button');
    expect(buttons[0]).toHaveAccessibleName(STUDIO.pictureUpload);
    expect(buttons[0]).toHaveAccessibleDescription(STUDIO.pictureDropHint('Ctrl+V'));
    // Six ready covers after the upload.
    expect(buttons.slice(1)).toHaveLength(6);
    expect(within(field).getByText(STUDIO.presetsCover)).toBeInTheDocument();
    fireEvent.click(buttons[0]);
    expect(api.pickPicture).toHaveBeenCalledWith(COVER);
  });

  it('a picture there (a ready one): «Заменить своей» and «Убрать»; a field without presets says «Загрузить другую»', () => {
    const onRemove = vi.fn();
    rememberPreset(PIC);
    const { rerender } = render(<PictureField label={STUDIO.picture} path={PIC} target={COVER} api={sideApi()} presets="cover" onRemove={onRemove} imageUrl={url} />);
    expect(screen.getByRole('button', { name: STUDIO.pictureReplaceOwn })).toBeInTheDocument();
    expect(document.querySelector('.st-pic-now img')).toHaveAttribute('src', url(PIC));
    fireEvent.click(screen.getByRole('button', { name: STUDIO.pictureRemove }));
    expect(onRemove).toHaveBeenCalled();
    rerender(<PictureField label={STUDIO.picture} path={PIC} target={{ kind: 'image', blockId: 'img00000001' }} api={sideApi()} imageUrl={url} />);
    expect(screen.getByRole('button', { name: STUDIO.pictureReplace })).toBeInTheDocument();
    expect(screen.queryByText(STUDIO.presetsCover)).toBeNull();
  });

  it('the author’s own picture there: «Загрузить другую», not «Заменить своей» (live check of 47.4)', () => {
    const own = `${EXAM}/${'b'.repeat(64)}.jpg`;
    rememberPreset(PIC);
    render(<PictureField label={STUDIO.background} path={own} target={{ kind: 'background' }} api={sideApi()} presets="background" imageUrl={url} />);
    expect(screen.getByRole('button', { name: STUDIO.pictureReplace })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: STUDIO.pictureReplaceOwn })).toBeNull();
  });

  it('the line goes in the order of the work: «Готовлю картинку…», «Уменьшаю фото…», «Загружаю картинку…»', () => {
    const { rerender } = render(<PictureField label={STUDIO.picture} path={null} target={COVER} api={sideApi({ stageOf: () => 'read' })} imageUrl={url} />);
    expect(screen.getByRole('status')).toHaveTextContent(STUDIO.imagePreparing);
    expect(screen.getByRole('status')).not.toHaveTextContent(STUDIO.imageUploading);
    rerender(<PictureField label={STUDIO.picture} path={null} target={COVER} api={sideApi({ stageOf: () => 'shrink' })} imageUrl={url} />);
    expect(screen.getByRole('status')).toHaveTextContent(STUDIO.imageShrinking);
    rerender(<PictureField label={STUDIO.picture} path={null} target={COVER} api={sideApi({ stageOf: () => 'upload' })} imageUrl={url} />);
    expect(screen.getByRole('status')).toHaveTextContent(STUDIO.imageUploading);
  });

  it('a file dragged over it lights it up and says so; dropped, it is uploaded into this picture', () => {
    const api = sideApi();
    render(<PictureField label={STUDIO.picture} path={null} target={COVER} api={api} presets="cover" />);
    const field = screen.getByRole('group', { name: STUDIO.picture });
    const file = png();
    fireEvent.dragEnter(field, { dataTransfer: { types: ['Files'], files: [file] } });
    expect(field).toHaveAttribute('data-drop');
    expect(within(field).getByText(STUDIO.pictureDropNow)).toBeInTheDocument();
    // Passing over a child and back: still over the field.
    fireEvent.dragEnter(within(field).getByRole('button', { name: STUDIO.pictureUpload }), { dataTransfer: { types: ['Files'], files: [file] } });
    fireEvent.dragLeave(within(field).getByRole('button', { name: STUDIO.pictureUpload }), { dataTransfer: { types: ['Files'], files: [file] } });
    expect(field).toHaveAttribute('data-drop');
    fireEvent.drop(field, { dataTransfer: { types: ['Files'], files: [file] } });
    expect(field).not.toHaveAttribute('data-drop');
    expect(api.uploadFile).toHaveBeenCalledWith(COVER, file);
  });

  it('a drag of words or of a block is not a file: the field stays as it is', () => {
    const api = sideApi();
    render(<PictureField label={STUDIO.picture} path={null} target={COVER} api={api} />);
    const field = screen.getByRole('group', { name: STUDIO.picture });
    fireEvent.dragEnter(field, { dataTransfer: { types: ['text/plain'], files: [] } });
    fireEvent.drop(field, { dataTransfer: { types: ['text/plain'], files: [] } });
    expect(field).not.toHaveAttribute('data-drop');
    expect(api.uploadFile).not.toHaveBeenCalled();
  });

  it('Ctrl+V with a picture while the focus is in it: uploaded here (the page’s own paste does not take it)', () => {
    const api = sideApi();
    render(<PictureField label={STUDIO.picture} path={null} target={COVER} api={api} />);
    const button = screen.getByRole('button', { name: STUDIO.pictureUpload });
    const file = png('Снимок экрана.png');
    const pasted = fireEvent.paste(button, { clipboardData: { files: [file], getData: () => '' } });
    expect(pasted).toBe(false); // defaultPrevented
    expect(api.uploadFile).toHaveBeenCalledWith(COVER, file);
    // Words pasted are left alone.
    expect(fireEvent.paste(button, { clipboardData: { files: [], getData: () => 'слова' } })).toBe(true);
  });

  it('the line of what is done, the error with the old picture kept, nothing pressed twice while busy', () => {
    const stages: Array<UploadStage | null> = ['shrink', 'upload'];
    const { rerender } = render(<PictureField label={STUDIO.picture} path={PIC} target={COVER} api={sideApi({ stageOf: () => stages[0] })} imageUrl={url} />);
    expect(screen.getByRole('status')).toHaveTextContent(STUDIO.imageShrinking);
    expect(screen.getByRole('button', { name: STUDIO.pictureReplace })).toBeDisabled();
    rerender(<PictureField label={STUDIO.picture} path={PIC} target={COVER} api={sideApi({ stageOf: () => stages[1] })} imageUrl={url} />);
    expect(screen.getByRole('status')).toHaveTextContent(STUDIO.imageUploading);
    rerender(<PictureField label={STUDIO.picture} path={PIC} target={COVER} api={sideApi({ noteOf: () => STUDIO.pictureHeic })} imageUrl={url} />);
    expect(screen.getByRole('alert')).toHaveTextContent(`${STUDIO.pictureHeic} ${STUDIO.pictureKept}`);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(document.querySelector('.st-pic-now img')).toHaveAttribute('src', url(PIC));
  });

  it('on a phone: the hint names the photos, not dragging or Ctrl+V', () => {
    render(<PictureField label={STUDIO.picture} path={null} target={COVER} api={sideApi({ touch: true })} />);
    expect(screen.getByRole('button', { name: STUDIO.pictureUpload })).toHaveAccessibleDescription(STUDIO.pictureTouchHint);
  });
});

describe('the palette and the copy', () => {
  it('«Видео» is a page block, right after «Картинка»', () => {
    expect(BLOCK_KINDS.slice(3, 5)).toEqual(['image', 'video']);
    expect(STUDIO.types.video).toBe('Видео');
  });

  it('the HEIC words say the browser, not a phone (a computer shows them too), without an exclamation mark', () => {
    expect(STUDIO.pictureHeic).toBe('Этот браузер не открывает фото HEIC. Сохраните его как JPEG или PNG и загрузите снова.');
    expect(STUDIO.pictureHeic).not.toMatch(/телефон/);
    for (const words of [STUDIO.pictureUpload, STUDIO.pictureReplaceOwn, STUDIO.pictureDropNow, STUDIO.canvasDrop, STUDIO.videoBad, STUDIO.videoHint]) expect(words).not.toContain('!');
  });
});

// ── DocView: the video block ──

const YT = 'https://youtu.be/dQw4w9WgXcQ?t=42';
const video = (over: Partial<DocBlock & { type: 'video' }> = {}): DocBlock => ({ type: 'video', id: 'video0000001', url: YT, caption: 'Опыт с натрием', ...over });
const pageWith = (...blocks: DocBlock[]): TestDoc => ({ ...emptyDoc('Видео'), layout: 'one_page', blocks });

/** The canvas's side, as plain stubs (nothing chosen, nothing typed in). */
function editor(over: Partial<DocEditApi> = {}): DocEditApi {
  return {
    Frame: ({ block, children }) => <div data-frame={block.id}>{children}</div>,
    Gap: () => <hr />,
    EndGap: () => <hr />,
    useEditing: () => false,
    useSelected: () => false,
    setEditing: vi.fn(),
    change: vi.fn(),
    slash: vi.fn(),
    pickImage: vi.fn(),
    pictureStage: () => null,
    pictureNote: () => null,
    problemOf: () => null,
    busyId: () => null,
    ...over,
  };
}

describe('DocView: a video is the provider’s player in a sandboxed frame', () => {
  it('the participant’s page (and the preview): the player with every attribute, the caption under it', () => {
    render(<DocView mode="answer" doc={pageWith(video())} items={new Map()} dark={false} onSubmit={() => ({ score: 0, max: 0, percent: 0, band: null })} />);
    const frame = screen.getByTitle('Опыт с натрием');
    expect(frame.tagName).toBe('IFRAME');
    expect(frame).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=42');
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation');
    expect(frame).toHaveAttribute('allow', 'fullscreen; picture-in-picture');
    expect(frame).toHaveAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    expect(frame).toHaveAttribute('loading', 'lazy');
    // `allow` alone (both made the browser warn).
    expect(frame).not.toHaveAttribute('allowfullscreen');
    expect(frame).not.toHaveAttribute('tabindex');
    expect(screen.getByText('Опыт с натрием', { selector: 'figcaption' })).toBeInTheDocument();
    expect(document.querySelector('.dv-video-shield')).toBeNull();
  });

  it('RuTube and VK Видео; without a caption the frame is named by its provider', () => {
    render(
      <DocView
        mode="answer"
        doc={pageWith(
          video({ id: 'video0000001', url: 'https://rutube.ru/video/c6cc4d620b1d4338901770a44b3e82f4/', caption: '' }),
          video({ id: 'video0000002', url: 'https://vk.com/video-22822305_456242110', caption: '' }),
        )}
        items={new Map()}
        dark
        onSubmit={() => ({ score: 0, max: 0, percent: 0, band: null })}
      />,
    );
    expect(screen.getByTitle(STUDIO.videoTitles.rutube)).toHaveAttribute('src', 'https://rutube.ru/play/embed/c6cc4d620b1d4338901770a44b3e82f4');
    expect(screen.getByTitle(STUDIO.videoTitles.vk)).toHaveAttribute('src', 'https://vkvideo.ru/video_ext.php?oid=-22822305&id=456242110');
  });

  it('a link the page does not take shows nothing to the participant', () => {
    render(<DocView mode="answer" doc={pageWith(video({ url: 'https://vimeo.com/1' }))} items={new Map()} dark={false} onSubmit={() => ({ score: 0, max: 0, percent: 0, band: null })} />);
    expect(document.querySelector('iframe')).toBeNull();
    expect(document.querySelector('.dv-video')).toBeNull();
  });

  it('on the canvas: the player out of the Tab order, a layer over it keeps the press for the block', () => {
    render(<DocView mode="edit" doc={pageWith(video())} items={new Map()} dark={false} editor={editor()} />);
    expect(screen.getByTitle('Опыт с натрием')).toHaveAttribute('tabindex', '-1');
    expect(document.querySelector('.dv-video-frame .dv-video-shield')).not.toBeNull();
  });

  it('on the canvas without a link: a field for it; a pasted link shows at once, a wrong one is said', () => {
    const api = editor();
    render(<DocView mode="edit" doc={pageWith(video({ url: '', caption: '' }))} items={new Map()} dark={false} editor={api} />);
    const field = screen.getByRole('textbox', { name: STUDIO.videoEmpty });
    fireEvent.change(field, { target: { value: 'https://vimeo.com/1' } });
    fireEvent.click(screen.getByRole('button', { name: STUDIO.videoPut }));
    expect(screen.getByRole('alert')).toHaveTextContent(STUDIO.videoBad);
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(api.change).not.toHaveBeenCalled();
    fireEvent.paste(field, { clipboardData: { files: [], getData: () => ' youtu.be/dQw4w9WgXcQ ' } });
    expect(api.change).toHaveBeenCalledWith('video0000001', { url: 'https://youtu.be/dQw4w9WgXcQ' }, 'url');
    fireEvent.change(field, { target: { value: '<iframe src="https://rutube.ru/play/embed/c6cc4d620b1d4338901770a44b3e82f4"></iframe>' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(api.change).toHaveBeenLastCalledWith('video0000001', { url: 'https://rutube.ru/play/embed/c6cc4d620b1d4338901770a44b3e82f4' }, 'url');
  });
});

describe('DocView: a picture block without its picture, on the canvas', () => {
  const empty: DocBlock = { type: 'image', id: 'img00000001', path: '', caption: '', width: 'wide' };

  it('the upload first; a file dropped onto it goes into this block', () => {
    const api = editor({ dropPicture: vi.fn() });
    render(<DocView mode="edit" doc={pageWith(empty)} items={new Map()} dark={false} editor={api} />);
    fireEvent.click(screen.getByRole('button', { name: STUDIO.imagePick }));
    expect(api.pickImage).toHaveBeenCalledWith('img00000001');
    const zone = document.querySelector('.dv-pic-empty') as HTMLElement;
    const file = png();
    fireEvent.dragEnter(zone, { dataTransfer: { types: ['Files'], files: [file] } });
    expect(zone).toHaveAttribute('data-drop');
    expect(screen.getByRole('status')).toHaveTextContent(STUDIO.pictureDropNow);
    const dropped = fireEvent.drop(zone, { dataTransfer: { types: ['Files'], files: [file] } });
    expect(dropped).toBe(false);
    expect(api.dropPicture).toHaveBeenCalledWith('img00000001', file);
  });

  it('says what the upload is doing, and why it failed', () => {
    const { rerender } = render(<DocView mode="edit" doc={pageWith(empty)} items={new Map()} dark={false} editor={editor({ pictureStage: () => 'shrink' })} />);
    expect(screen.getByRole('status')).toHaveTextContent(STUDIO.imageShrinking);
    expect(screen.queryByRole('button', { name: STUDIO.imagePick })).toBeNull();
    rerender(<DocView mode="edit" doc={pageWith(empty)} items={new Map()} dark={false} editor={editor({ pictureNote: () => STUDIO.pictureSize })} />);
    expect(screen.getByRole('alert')).toHaveTextContent(STUDIO.pictureSize);
    expect(screen.getByRole('button', { name: STUDIO.imagePick })).toBeInTheDocument();
  });
});

describe('DocView on the canvas: a link not taken', () => {
  it('its words come into sight (on a phone they stood under the bottom bar)', () => {
    const into = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => undefined);
    render(<DocView mode="edit" doc={pageWith(video({ url: '' }))} items={new Map()} dark={false} editor={editor()} />);
    fireEvent.change(screen.getByRole('textbox', { name: STUDIO.videoEmpty }), { target: { value: 'https://example.com/clip' } });
    fireEvent.click(screen.getByRole('button', { name: STUDIO.videoPut }));
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(STUDIO.videoBad);
    expect(into.mock.contexts).toContain(alert);
    into.mockRestore();
  });
});
