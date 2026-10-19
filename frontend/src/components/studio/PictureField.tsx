import { useId, useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { coverUrl } from '../../api/itemPictures';
import { STUDIO } from './copyStudio';
import { UiIcon } from './icons';
import { PRESETS, presetDataUrl, type PresetId } from './presets';
import { draggingFiles, pasteKeys, pictureFiles, type PictureTarget } from './pictures';
import type { SideApi } from './Workspace';

/**
 * A picture setting of the page (a cover, a picture block, the background, a result message). The author's own picture
 * comes first (owner, 2026-10-19: «почему нельзя добавлять свои картинки»): «Загрузить свою картинку» — «Заменить
 * своей» once a picture is there — opens the files (on a phone, the photos); the whole field takes a file dragged onto
 * it (it says so while one is over it) and a picture pasted while the focus is in it (Ctrl+V / ⌘V). Under the button: a
 * line of what is being done («Уменьшаю фото…», «Загружаю картинку…») and the words of a failure (the picture that was
 * there stays). The ready pictures (presets.ts) come after it — a cover's and the background's.
 */
export default function PictureField({
  label,
  path,
  target,
  api,
  presets,
  onRemove,
  imageUrl = coverUrl,
}: {
  label: string;
  path: string | null;
  target: PictureTarget;
  api: SideApi;
  presets?: 'cover' | 'background';
  onRemove?: () => void;
  imageUrl?: (path: string) => string;
}) {
  const id = useId();
  const stage = api.stageOf(target);
  const busy = stage !== null;
  const note = api.noteOf(target);
  const [over, setOver] = useState(false);
  // dragenter / dragleave come for every child the file passes over: the field is «over» until the count is back at 0.
  const depth = useRef(0);
  const thumbs = useMemo(() => (presets ? PRESETS.map((preset) => ({ ...preset, url: presetDataUrl(preset.id, 160, presets === 'cover' ? 64 : 100) })) : []), [presets]);

  const enter = (event: DragEvent<HTMLDivElement>) => {
    if (!draggingFiles(event.dataTransfer)) return;
    event.preventDefault();
    depth.current += 1;
    setOver(true);
  };
  const overIt = (event: DragEvent<HTMLDivElement>) => {
    if (!draggingFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = busy ? 'none' : 'copy';
  };
  const leave = (event: DragEvent<HTMLDivElement>) => {
    if (!draggingFiles(event.dataTransfer)) return;
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setOver(false);
  };
  const drop = (event: DragEvent<HTMLDivElement>) => {
    if (!draggingFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    depth.current = 0;
    setOver(false);
    // The first picture; a file that is not one goes too, so the field says why it does not take it.
    const file = pictureFiles(event.dataTransfer.files)[0] ?? event.dataTransfer.files[0];
    if (file && !busy) api.uploadFile(target, file);
  };
  const paste = (event: ClipboardEvent<HTMLDivElement>) => {
    const file = pictureFiles(event.clipboardData?.files)[0];
    if (!file) return;
    event.preventDefault();
    if (!busy) api.uploadFile(target, file);
  };

  const button = path ? (presets ? STUDIO.pictureReplaceOwn : STUDIO.pictureReplace) : STUDIO.pictureUpload;
  return (
    <div
      className="st-pic-field"
      role="group"
      aria-labelledby={`${id}-label`}
      data-drop={over ? '' : undefined}
      data-busy={busy ? '' : undefined}
      onDragEnter={enter}
      onDragOver={overIt}
      onDragLeave={leave}
      onDrop={drop}
      onPaste={paste}
    >
      <p className="st-field-label" id={`${id}-label`}>
        {label}
      </p>
      <div className="st-pic-zone" data-has={path ? '' : undefined}>
        {path ? (
          <div className="st-pic-now">
            <img src={imageUrl(path)} alt="" />
          </div>
        ) : null}
        <div className="st-pic-cta">
          <button type="button" className="st-upload" disabled={busy} aria-describedby={`${id}-hint`} onClick={() => api.pickPicture(target)}>
            <UiIcon name="upload" />
            <span>{button}</span>
          </button>
          <p className="st-pic-hint" id={`${id}-hint`}>
            {api.touch ? STUDIO.pictureTouchHint : STUDIO.pictureDropHint(pasteKeys())}
          </p>
        </div>
        {over ? (
          <p className="st-pic-dropnow" aria-hidden="true">
            <UiIcon name="upload" />
            <span>{STUDIO.pictureDropNow}</span>
          </p>
        ) : null}
      </div>
      <p className="st-pic-status" role="status" data-on={busy ? '' : undefined}>
        {stage === 'shrink' ? STUDIO.imageShrinking : stage === 'upload' ? STUDIO.imageUploading : ''}
      </p>
      {note ? (
        <p className="st-note" data-bad="" role="alert">
          {path ? `${note} ${STUDIO.pictureKept}` : note}
        </p>
      ) : null}
      {path && onRemove ? (
        <p className="st-pic-acts">
          <button type="button" className="sf-link" data-muted="" disabled={busy} onClick={onRemove}>
            {STUDIO.pictureRemove}
          </button>
        </p>
      ) : null}
      {thumbs.length > 0 ? (
        <>
          <p className="st-field-sub">{presets === 'cover' ? STUDIO.presetsCover : STUDIO.presetsBackground}</p>
          <ul className="st-presets" data-use={presets}>
            {thumbs.map((preset) => (
              <li key={preset.id}>
                <button type="button" className="st-preset" disabled={busy} onClick={() => api.usePreset(target, preset.id as PresetId)} title={preset.title}>
                  <img src={preset.url} alt="" />
                  <span>{preset.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
