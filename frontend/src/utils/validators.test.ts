import { describe, expect, it } from 'vitest';
import { EMAIL_FORMAT_MESSAGE, NAME_CHARS_MESSAGE, PASSWORD_RULES, emailTypo, validateEmail, validateName, validatePassword } from './validators';

describe('validateName (audit 2026-10-08, PUB-19): a real name is never refused', () => {
  it.each(['Гарик Сукачёв', 'Шехерезада', 'Херсонский', 'Херувимов', 'Shitov', 'Charles Dickens', "Д'Артаньян", 'Anna-Maria O’Neil', 'Ж.-Б. Мольер', 'Ілля', 'Әлия', 'José Müller', 'Ли'])(
    '«%s» is a name',
    (name) => {
      expect(validateName(name)).toBe('');
    },
  );

  it('refuses digits and signs, too short or too long, and an obscene whole word', () => {
    expect(validateName('Алина1')).toBe(NAME_CHARS_MESSAGE);
    expect(validateName('Алина!')).toBe(NAME_CHARS_MESSAGE);
    expect(validateName('..')).toBe(NAME_CHARS_MESSAGE);
    expect(validateName('А')).toBe('Имя должно содержать минимум 2 символа');
    expect(validateName('А'.repeat(51))).toBe('Имя слишком длинное (макс. 50)');
    expect(validateName('Сука')).toBe('Недопустимое имя пользователя');
    expect(validateName('Вася Хуй')).toBe('Недопустимое имя пользователя');
    expect(validateName('')).toBe('');
  });
});

describe('validateEmail (PUB-4): only a malformed address is an error', () => {
  it.each(['student@mail.com', 'student@inbox.lv', 'student@mail.kz', 'student@yandex.ua', 'student@gmail.co', 'a.b+exam@edu.hse.ru', 'почта@домен.рф', 'x@xn--80a1acny.xn--p1ai'])(
    '%s has the form of an address',
    (email) => {
      expect(validateEmail(email)).toBe('');
    },
  );

  it.each(['student', 'student@', 'student@mail', 'student@mail.r', 'student@.ru', 'student@mail..ru', 'stu dent@mail.ru'])('%s is not an address', (email) => {
    expect(validateEmail(email)).toBe(EMAIL_FORMAT_MESSAGE);
  });
});

describe('emailTypo (PUB-4): a hint with a fix, never for a real domain', () => {
  it.each([
    ['student@gmail.co', 'gmail.com'],
    ['student@gmail.ru', 'gmail.com'],
    ['student@gmial.com', 'gmail.com'],
    ['student@mail.ry', 'mail.ru'],
    ['student@yandex.tu', 'yandex.ru'],
    ['student@yndex.ru', 'yandex.ru'],
    ['student@icloud.co', 'icloud.com'],
    ['Student.Name@Inbox.ry', 'inbox.ru'],
  ])('%s → %s', (email, domain) => {
    const typo = emailTypo(email);
    expect(typo?.domain).toBe(domain);
    // The part before «@» stays as typed.
    expect(typo?.fixed).toBe(`${email.slice(0, email.lastIndexOf('@'))}@${domain}`);
  });

  it.each(['student@mail.com', 'student@inbox.lv', 'student@mail.kz', 'student@yandex.ua', 'student@gmail.com', 'student@mail.ru', 'student@outlook.de', 'student@yahoo.fr', 'student@edu.hse.ru', 'student@hse.ru', 'student@mail', 'не адрес'])(
    'no hint for %s',
    (email) => {
      expect(emailTypo(email)).toBeNull();
    },
  );
});

describe('the password rules', () => {
  it('are the rules the check applies', () => {
    expect(PASSWORD_RULES.map((rule) => rule.label)).toEqual(['от 8 символов', 'заглавная буква', 'цифра']);
    for (const password of ['short', 'longenough', 'Longenough', 'Longenough1', 'Кириллица1']) {
      const allMet = PASSWORD_RULES.every((rule) => rule.met(password));
      expect(validatePassword(password) === '').toBe(allMet);
    }
  });
});
