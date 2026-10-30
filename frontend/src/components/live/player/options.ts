/**
 * The answer options of «Битва с монстром» on the phone (2–6; a real test's five or six since 20261030090000_live_pictures.sql): the letter the projector shows (CONTRACT §4: the letters on
 * the projector are the letters on the phones), Meldy's colour for it and a shape, so an option is told apart without
 * colour. The accessible name says the letter, the colour and the text.
 */
export type OptionShape = 'triangle' | 'diamond' | 'circle' | 'square' | 'pentagon' | 'hexagon';

export interface OptionStyle {
  letter: string;
  /** The colour's name as the label reads it. */
  colour: string;
  /** The shape's name, for the label. */
  shapeName: string;
  shape: OptionShape;
}

export const OPTION_STYLES: readonly OptionStyle[] = [
  { letter: 'А', colour: 'синий', shapeName: 'треугольник', shape: 'triangle' },
  { letter: 'Б', colour: 'жёлтый', shapeName: 'ромб', shape: 'diamond' },
  { letter: 'В', colour: 'зелёный', shapeName: 'круг', shape: 'circle' },
  { letter: 'Г', colour: 'розовый', shapeName: 'квадрат', shape: 'square' },
  { letter: 'Д', colour: 'оранжевый', shapeName: 'пятиугольник', shape: 'pentagon' },
  { letter: 'Е', colour: 'фиолетовый', shapeName: 'шестиугольник', shape: 'hexagon' },
];

/** «А, синий треугольник: READ COMMITTED» (and «, с рисунком» when the option has a picture). */
export function optionLabel(index: number, text: string, picture = false): string {
  const o = OPTION_STYLES[index] ?? OPTION_STYLES[0];
  return `${o.letter}, ${o.colour} ${o.shapeName}: ${text}${picture ? ', с рисунком' : ''}`;
}

/** Long options get a smaller size (by length: no layout read). */
export function optionSize(text: string): 'l' | 'm' | 's' {
  const n = [...text].length;
  if (n > 52) return 's';
  if (n > 28) return 'm';
  return 'l';
}

/** Long questions get a smaller size. */
export function questionSize(text: string): 'l' | 'm' | 's' {
  const n = [...text].length;
  if (n > 150) return 's';
  if (n > 72) return 'm';
  return 'l';
}
