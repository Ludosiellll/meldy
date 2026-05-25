export const BAD_WORDS_REGEX = /(хуй|хуе|пизд|ебать|ебан|шлюха|блять|блядь|мудак|залупа|пидор|сука|хуйня)/i;

export function hasBadWords(text: string): boolean {
  if (!text) return false;
  return BAD_WORDS_REGEX.test(text);
}
