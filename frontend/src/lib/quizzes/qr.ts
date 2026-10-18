/**
 * The QR code of a quiz's link, made on the device (qrcode-generator 1.4.4; nothing leaves the page): the modules as a
 * matrix and as one SVG path of the dark ones, one unit a module, without the quiet zone (the drawing adds it).
 * Error correction M: a link of ~40 characters fits version 3 (29 × 29), large enough to read off a projector.
 */
import qrcode from 'qrcode-generator';

export interface QrCode {
  /** Modules a side (21 for version 1, 4 more each version). */
  size: number;
  /** dark[row][column]. */
  dark: boolean[][];
  /** «M0 0h7v1h-7z…»: each run of dark modules in a row as one rectangle. */
  path: string;
}

export function qrCode(text: string): QrCode {
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  const size = qr.getModuleCount();
  const dark: boolean[][] = [];
  let path = '';
  for (let row = 0; row < size; row += 1) {
    const line: boolean[] = [];
    for (let col = 0; col < size; col += 1) line.push(qr.isDark(row, col));
    dark.push(line);
    let col = 0;
    while (col < size) {
      if (!line[col]) {
        col += 1;
        continue;
      }
      let run = 1;
      while (col + run < size && line[col + run]) run += 1;
      path += `M${col} ${row}h${run}v1h-${run}z`;
      col += run;
    }
  }
  return { size, dark, path };
}

/** «meldy.ru/k/k7m2p9q4r8st»: the link as a person types it (no scheme). */
export function shortLink(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}
