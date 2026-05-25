const BAD_WORDS_ROOTS = [
  'fuck', 'shit', 'bitch', 'asshole', 'cunt', 'dick', 'pussy', 'whore', 'slut', 'fag', 'nigg', 'crap', 'bastard',
  'хуй', 'хуе', 'пизд', 'ебат', 'ебан', 'ёбан', 'бляд', 'блят', 'шлюх', 'мудак', 'мудил', 'пидор', 'педик', 'залуп', 'хуйн', 'гондон', 'гандон', 'сука', 'сучк', 'дроч', 'хер'
];

export const validateName = (name: string) => {
  if (!name) return '';
  const trimmed = name.trim();
  if (trimmed.length < 2) return 'Имя должно содержать минимум 2 символа';
  if (trimmed.length > 50) return 'Имя слишком длинное (макс. 50)';
  
  if (!/^[a-zA-Zа-яА-ЯёЁ\s\-]+$/.test(trimmed)) {
    return 'Разрешены только буквы, пробелы и дефисы (без цифр)';
  }

  const lowerName = trimmed.toLowerCase().replace(/[^a-zа-яё]/g, '');
  for (const root of BAD_WORDS_ROOTS) {
    if (lowerName.includes(root)) {
      return 'Недопустимое имя пользователя';
    }
  }

  return '';
};

export const validateEmail = (email: string) => {
  if (!email) return '';
  const trimmed = email.trim();
  // Requires at least 2 characters for TLD, prevents .r
  if (!/^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/.test(trimmed)) {
    return 'Некорректный формат email';
  }

  const parts = trimmed.split('@');
  if (parts.length === 2) {
    const domain = parts[1].toLowerCase();
    
    // Smart Typo Detection for popular Russian and Global providers
    if (domain.includes('gmail.') && domain !== 'gmail.com') return 'Опечатка? Возможно, вы имели в виду gmail.com';
    if (domain.includes('mail.') && domain !== 'mail.ru' && domain !== 'email.com') return 'Опечатка? Возможно, вы имели в виду mail.ru';
    if (domain.includes('yandex.') && !['yandex.ru', 'yandex.com', 'yandex.kz', 'yandex.by'].includes(domain)) return 'Опечатка? Возможно, вы имели в виду yandex.ru';
    if (domain.includes('bk.') && domain !== 'bk.ru') return 'Опечатка? Возможно, вы имели в виду bk.ru';
    if (domain.includes('inbox.') && domain !== 'inbox.ru') return 'Опечатка? Возможно, вы имели в виду inbox.ru';
    if (domain.includes('list.') && domain !== 'list.ru') return 'Опечатка? Возможно, вы имели в виду list.ru';
    if (domain.includes('ya.') && domain !== 'ya.ru') return 'Опечатка? Возможно, вы имели в виду ya.ru';
    if (domain.includes('icloud.') && domain !== 'icloud.com') return 'Опечатка? Возможно, вы имели в виду icloud.com';
  }

  return '';
};

export const validatePassword = (pwd: string) => {
  if (!pwd) return '';
  if (pwd.length < 8) return `Минимум 8 символов (не хватает ${8 - pwd.length})`;
  if (!/[A-ZА-ЯЁ]/.test(pwd)) return 'Нужна хотя бы одна заглавная буква';
  if (!/[0-9]/.test(pwd)) return 'Нужна хотя бы одна цифра';
  return '';
};

// Helper for UI password strength bar
export const getPasswordStrength = (pwd: string): number => {
  if (!pwd) return 0;
  let score = 0;
  if (pwd.length >= 8) score++;
  if (/[A-ZА-ЯЁ]/.test(pwd)) score++;
  if (/[0-9]/.test(pwd)) score++;
  if (/[^a-zA-Z0-9а-яА-ЯёЁ]/.test(pwd)) score++; // Special char bonus
  return Math.min(3, score); // Max 3 for the UI
};
