/**
 * The cheat sheet's handwriting (spec 5.2): Caveat Variable (OFL, @fontsource-variable/caveat), only
 * the Cyrillic and Latin subsets, loaded with the sheet's chunk — never on other pages. The faces
 * are added through the FontFace API with fixed metrics (ascent 96 %, descent 30 %, no line gap),
 * so the baseline sits at the same height in every browser and the text lies on the paper's grid.
 * The first paint and the replay of changes wait for the font (at most 1.5 s): the masks and the
 * scroll position must not move under a late font.
 */
import cyrillic from '@fontsource-variable/caveat/files/caveat-cyrillic-wght-normal.woff2?url';
import cyrillicExt from '@fontsource-variable/caveat/files/caveat-cyrillic-ext-wght-normal.woff2?url';
import latin from '@fontsource-variable/caveat/files/caveat-latin-wght-normal.woff2?url';
import latinExt from '@fontsource-variable/caveat/files/caveat-latin-ext-wght-normal.woff2?url';

export const HAND_FAMILY = 'Meldy Hand';

const FACES: ReadonlyArray<[string, string]> = [
  [cyrillic, 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116'],
  [cyrillicExt, 'U+0460-052F,U+1C80-1C8A,U+20B4,U+2DE0-2DFF,U+A640-A69F,U+FE2E-FE2F'],
  [latin, 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2212,U+2215,U+FEFF,U+FFFD'],
  [latinExt, 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF'],
];

let loading: Promise<void> | null = null;

/** Adds the faces once and resolves when the Cyrillic one is ready, or after `timeoutMs`. Never rejects. */
export function loadSheetFont(timeoutMs = 1500): Promise<void> {
  if (loading) return loading;
  if (typeof document === 'undefined' || typeof FontFace === 'undefined' || !document.fonts) {
    loading = Promise.resolve();
    return loading;
  }
  const faces = FACES.map(
    ([url, unicodeRange]) =>
      new FontFace(HAND_FAMILY, `url(${url}) format('woff2')`, {
        weight: '400 700',
        style: 'normal',
        display: 'swap',
        unicodeRange,
        ascentOverride: '96%',
        descentOverride: '30%',
        lineGapOverride: '0%',
      } as FontFaceDescriptors),
  );
  faces.forEach((face) => document.fonts.add(face));
  const ready = faces[0].load().then(
    () => undefined,
    () => undefined,
  );
  // The other subsets load when a glyph needs them (unicode-range).
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
  loading = Promise.race([ready, timeout]);
  return loading;
}
