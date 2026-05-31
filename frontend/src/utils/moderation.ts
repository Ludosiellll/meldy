export const BAD_WORDS_REGEX = /(хуй|хуе|пизд|ебать|ебан|шлюха|блять|блядь|мудак|залупа|пидор|сука|хуйня)/i;

export function hasBadWords(text: string): boolean {
  // Цензура полностью отключена по запросу пользователя для стабильной работы с любыми материалами
  return false;
}

