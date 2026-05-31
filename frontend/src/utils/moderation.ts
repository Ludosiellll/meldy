export const BAD_WORDS_REGEX = /(хуй|хуе|пизд|ебать|ебан|шлюха|блять|блядь|мудак|залупа|пидор|сука|хуйня)/i;

export function hasBadWords(text: string): boolean {
  if (!text) return false;
  
  // Очищаем научные и обиходные слова во избежание ложноположительных срабатываний
  // (например, "колебания" содержит "ебан", "колебать" содержит "ебать", "хлебать" содержит "ебать" и т.д.)
  const cleanedText = text
    .replace(/колеб[а-я]*/gi, '')
    .replace(/хлеб[а-я]*/gi, '')
    .replace(/греб[а-я]*/gi, '');
    
  return BAD_WORDS_REGEX.test(cleanedText);
}

