/**
 * Checks of the sign-up and sign-in fields. A real name or a real address is never refused (audit 2026-10-08,
 * PUB-4 and PUB-19): «Гарик Сукачёв», «Шехерезада», «Д'Артаньян», «Anna-Maria O’Neil» are names, and
 * student@mail.com, @inbox.lv, @mail.kz, @yandex.ua are addresses. Only a malformed address stops a form; a likely
 * typo in a popular domain is a hint with a one-click fix (emailTypo), never an error.
 */

/** Whole words a name may not be (lower case, «ё» as «е»). Whole words only: a name that merely contains one is a name. */
const BAD_NAME_WORDS = new Set([
  'хуй', 'хуи', 'хуя', 'хуйня', 'хуило', 'хуесос', 'пизда', 'пиздец', 'пиздюк', 'блядь', 'блять', 'бля', 'ебать', 'ебал',
  'ебаный', 'ебанат', 'уебок', 'уебан', 'долбоеб', 'мудак', 'мудила', 'пидор', 'пидорас', 'залупа', 'гондон', 'гандон',
  'шлюха', 'сука', 'сучка', 'дрочила',
  'fuck', 'fucker', 'motherfucker', 'shit', 'bitch', 'cunt', 'asshole', 'whore', 'slut', 'faggot', 'nigger', 'nigga',
]);

export const NAME_CHARS_MESSAGE = 'В имени можно писать буквы, пробелы, дефисы, апострофы и точки';

export const validateName = (name: string) => {
  if (!name) return '';
  const trimmed = name.trim();
  if (trimmed.length < 2) return 'Имя должно содержать минимум 2 символа';
  if (trimmed.length > 50) return 'Имя слишком длинное (макс. 50)';
  // Letters of any alphabet (with their accents), spaces, hyphens, apostrophes and dots: «O’Neil», «Д'Артаньян», «Ж.-Б.».
  if (!/^[\p{L}\p{M}\s'’.-]+$/u.test(trimmed) || !/\p{L}/u.test(trimmed)) return NAME_CHARS_MESSAGE;
  const words = trimmed.toLowerCase().replace(/ё/g, 'е').split(/[\s'’.-]+/u).filter(Boolean);
  if (words.some((word) => BAD_NAME_WORDS.has(word))) return 'Недопустимое имя пользователя';
  return '';
};

export const EMAIL_FORMAT_MESSAGE = 'Проверьте адрес: он должен быть вида name@mail.ru';

/** A malformed address — the only thing about an address that stops a form. Any domain of any country is fine. */
export const validateEmail = (email: string) => {
  if (!email) return '';
  const trimmed = email.trim();
  // A part before «@», a domain with a dot, and a top-level domain of two or more letters (or its punycode form).
  if (!/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)*\.(?:\p{L}{2,}|xn--[a-z0-9-]+)$/iu.test(trimmed)) return EMAIL_FORMAT_MESSAGE;
  return '';
};

/** Domains of real mail services that look like typos of one another: never a hint for them. */
const KNOWN_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'mail.ru', 'mail.com', 'mail.kz', 'mail.ua', 'bk.ru', 'inbox.ru', 'inbox.lv', 'inbox.lt',
  'inbox.eu', 'list.ru', 'internet.ru', 'yandex.ru', 'yandex.com', 'yandex.kz', 'yandex.by', 'yandex.ua', 'yandex.uz',
  'ya.ru', 'rambler.ru', 'rambler.ua', 'ro.ru', 'icloud.com', 'me.com', 'mac.com', 'outlook.com', 'hotmail.com',
  'live.com', 'live.ru', 'msn.com', 'yahoo.com', 'proton.me', 'protonmail.com', 'pm.me', 'ukr.net', 'tut.by', 'i.ua',
]);

/**
 * Providers whose name is one word before the top-level domain, with the top-level domains they really have.
 * «gmail.ru» or «icloud.co» can only be a typo; «mail.ry» is one, «mail.kz» is not.
 */
const PROVIDER_TLDS: Record<string, readonly string[]> = {
  gmail: ['com'],
  icloud: ['com'],
  mail: ['ru', 'com', 'kz', 'ua'],
  yandex: ['ru', 'com', 'kz', 'by', 'ua', 'uz'],
  ya: ['ru'],
  bk: ['ru'],
  inbox: ['ru', 'lv', 'lt', 'eu'],
  list: ['ru'],
  rambler: ['ru', 'ua'],
};
/** Providers whose name is a whole word on its own: «outlook.de», «yahoo.fr» are real, so only their names are checked. */
const OTHER_PROVIDERS = new Set(['outlook', 'hotmail', 'yahoo', 'live', 'proton', 'protonmail']);
/** What a misspelt domain is compared with («gmial.com», «yandx.ru», «mial.ru»). */
const POPULAR = ['gmail.com', 'mail.ru', 'yandex.ru', 'ya.ru', 'bk.ru', 'inbox.ru', 'list.ru', 'icloud.com', 'rambler.ru', 'outlook.com', 'hotmail.com', 'yahoo.com'];

/** Edits between two words (insertion, deletion, substitution and a swap of two neighbours). */
function distance(a: string, b: string): number {
  const rows: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j += 1) rows[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
    }
  }
  return rows[a.length][b.length];
}

export interface EmailTypo {
  /** The domain it probably is («gmail.com»). */
  domain: string;
  /** The whole address with that domain, the part before «@» as typed. */
  fixed: string;
}

/** A likely typo in the domain of a popular mail service («@gmail.co», «@mail.ry», «@gmial.com»), else null. */
export function emailTypo(email: string): EmailTypo | null {
  const trimmed = email.trim();
  if (validateEmail(trimmed)) return null;
  const at = trimmed.lastIndexOf('@');
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1).toLowerCase();
  if (KNOWN_DOMAINS.has(domain)) return null;
  const dot = domain.indexOf('.');
  const name = domain.slice(0, dot);
  const tld = domain.slice(dot + 1);
  let suggestion: string | null = null;
  const tlds = PROVIDER_TLDS[name];
  if (tlds) {
    // The provider's own name with a wrong ending: Gmail and iCloud have only .com; the others, the nearest real one.
    if (tlds.length === 1 && (name === 'gmail' || name === 'icloud')) suggestion = `${name}.${tlds[0]}`;
    else {
      const near = tlds.filter((real) => distance(tld, real) <= 1);
      if (near.length > 0) suggestion = `${name}.${near[0]}`;
    }
  } else if (!OTHER_PROVIDERS.has(name)) {
    // A misspelt name: one edit away from a popular domain (two for a long one).
    let best: { domain: string; edits: number } | null = null;
    for (const popular of POPULAR) {
      const edits = distance(domain, popular);
      if (!best || edits < best.edits) best = { domain: popular, edits };
    }
    if (best && best.edits > 0 && best.edits <= (domain.length >= 9 ? 2 : 1)) suggestion = best.domain;
  }
  if (!suggestion || suggestion === domain) return null;
  return { domain: suggestion, fixed: `${local}@${suggestion}` };
}

/** The password's rules (sign-up and a new password): the same numbers on screen and in the check. */
export const PASSWORD_MIN_LENGTH = 8;

export const PASSWORD_RULES: ReadonlyArray<{ id: 'length' | 'upper' | 'digit'; label: string; met: (password: string) => boolean }> = [
  { id: 'length', label: `от ${PASSWORD_MIN_LENGTH} символов`, met: (password) => password.length >= PASSWORD_MIN_LENGTH },
  { id: 'upper', label: 'заглавная буква', met: (password) => /[A-ZА-ЯЁ]/.test(password) },
  { id: 'digit', label: 'цифра', met: (password) => /[0-9]/.test(password) },
];

export const validatePassword = (pwd: string) => {
  if (!pwd) return '';
  if (pwd.length < PASSWORD_MIN_LENGTH) return `Минимум ${PASSWORD_MIN_LENGTH} символов (не хватает ${PASSWORD_MIN_LENGTH - pwd.length})`;
  if (!/[A-ZА-ЯЁ]/.test(pwd)) return 'Нужна хотя бы одна заглавная буква';
  if (!/[0-9]/.test(pwd)) return 'Нужна хотя бы одна цифра';
  return '';
};
