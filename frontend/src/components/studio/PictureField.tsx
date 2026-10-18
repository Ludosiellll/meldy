import { useMemo } from 'react';
import { coverUrl } from '../../api/itemPictures';
import { STUDIO } from './copyStudio';
import { PRESETS, presetDataUrl, type PresetId } from './presets';
import { targetKey, type PictureTarget } from './pictures';
import type { SideApi } from './Workspace';

/**
 * A picture setting of the page (a cover, a picture block, the background, a result message): what is there now,
 * «Загрузить / Заменить», «Убрать», and — for a cover and the background — the six ready pictures (presets.ts), one
 * press each.
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
  const busy = api.uploading === targetKey(target);
  const thumbs = useMemo(() => (presets ? PRESETS.map((preset) => ({ ...preset, url: presetDataUrl(preset.id, 160, presets === 'cover' ? 64 : 100) })) : []), [presets]);
  return (
    <div className="st-pic-field">
      <p className="st-field-label">{label}</p>
      {path ? (
        <div className="st-pic-now">
          <img src={imageUrl(path)} alt="" />
        </div>
      ) : null}
      <p className="st-pic-acts">
        <button type="button" className="st-pill" disabled={busy} onClick={() => api.pickPicture(target)}>
          {path ? STUDIO.pictureReplace : presets ? STUDIO.pictureOwn : STUDIO.pictureUpload}
        </button>
        {path && onRemove ? (
          <button type="button" className="sf-link" data-muted="" onClick={onRemove}>
            {STUDIO.pictureRemove}
          </button>
        ) : null}
        {busy ? <span className="st-muted">{STUDIO.imageUploading}</span> : null}
      </p>
      {api.pictureNote ? (
        <p className="st-note" data-bad="" role="alert">
          {api.pictureNote}
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
