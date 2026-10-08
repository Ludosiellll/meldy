/**
 * Why a sign-up failed, in words a student can act on. Until 2026-10-07 every failure read «Произошла
 * ошибка при регистрации. Проверьте данные.» — a taken address, a refused password and a dropped
 * network all looked the same.
 *
 * Read by shape, not by class (installed auth-js 2.105): API errors carry `code` and `status`
 * (email_exists / user_already_exists, weak_password with `reasons`, email_address_invalid or
 * validation_failed about the address, over_email_send_rate_limit, over_request_rate_limit);
 * no network is AuthRetryableFetchError with status 0, an unreachable service the same error with
 * 502–504. A confirmation letter that could not be sent is a 500 «Error sending confirmation email».
 * The messages of older servers without codes are matched too.
 */

export const SIGN_UP_MESSAGES = {
  exists: 'Этот адрес уже зарегистрирован. Войдите или восстановите пароль.',
  weakPassword: 'Пароль слишком простой. Сделайте его длиннее, добавьте заглавные буквы и цифры.',
  leakedPassword: 'Этот пароль встречался в утечках. Придумайте другой.',
  invalidEmail: 'Адрес почты указан неверно. Проверьте, нет ли опечатки.',
  refusedEmail: 'На этот адрес письмо отправить нельзя. Укажите другой адрес или войдите через Google.',
  tooManyEmails: 'Слишком много писем за короткое время. Попробуйте через несколько минут.',
  tooManyAttempts: 'Слишком много попыток. Попробуйте через несколько минут.',
  offline: 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.',
  emailNotSent: 'Не удалось отправить письмо с подтверждением. Попробуйте через несколько минут.',
  unavailable: 'Сервис регистрации сейчас не отвечает. Попробуйте через несколько минут.',
  failed: 'Не удалось зарегистрироваться. Попробуйте ещё раз через минуту.',
} as const;

/**
 * The words under an empty field, in the inline style of the other field errors (live run of 2026-10-07: an empty
 * form went to Supabase, which took it for an anonymous sign-up — 422 — and the page said «Не удалось
 * зарегистрироваться…»). Spaces alone are empty too.
 */
export const EMPTY_FIELD_MESSAGES = {
  name: 'Введите имя',
  email: 'Введите адрес почты',
  // The rules are shown with the field from the start (components/auth/PasswordRules), so the hint only asks.
  password: 'Придумайте пароль',
} as const;

/** The message for each empty field of the sign-up form ('' — filled). */
export function emptySignUpFields(fields: { name: string; email: string; password: string }): { name: string; email: string; password: string } {
  return {
    name: fields.name.trim() ? '' : EMPTY_FIELD_MESSAGES.name,
    email: fields.email.trim() ? '' : EMPTY_FIELD_MESSAGES.email,
    password: fields.password.trim() ? '' : EMPTY_FIELD_MESSAGES.password,
  };
}

interface AuthErrorShape {
  name?: unknown;
  message?: unknown;
  status?: unknown;
  code?: unknown;
  reasons?: unknown;
}

const NETWORK_MESSAGE = /failed to fetch|networkerror|load failed|network request failed|fetch failed/;

/** The message for a failed supabase.auth.signUp; `online` is navigator.onLine (false: no network for sure). */
export function signUpErrorMessage(error: unknown, online: boolean = typeof navigator === 'undefined' || navigator.onLine !== false): string {
  const shape: AuthErrorShape = typeof error === 'object' && error !== null ? (error as AuthErrorShape) : {};
  const name = typeof shape.name === 'string' ? shape.name : '';
  const code = typeof shape.code === 'string' ? shape.code : '';
  const status = typeof shape.status === 'number' ? shape.status : null;
  const message = typeof shape.message === 'string' ? shape.message.toLowerCase() : typeof error === 'string' ? error.toLowerCase() : '';
  const retryable = name === 'AuthRetryableFetchError';

  if (!online || (retryable && !status) || NETWORK_MESSAGE.test(message)) return SIGN_UP_MESSAGES.offline;
  if (code === 'email_exists' || code === 'user_already_exists' || /already (been )?registered|already exists/.test(message)) {
    return SIGN_UP_MESSAGES.exists;
  }
  if (code === 'weak_password' || name === 'AuthWeakPasswordError') {
    const reasons = Array.isArray(shape.reasons) ? shape.reasons : [];
    return reasons.includes('pwned') ? SIGN_UP_MESSAGES.leakedPassword : SIGN_UP_MESSAGES.weakPassword;
  }
  if (code === 'over_email_send_rate_limit' || /email rate limit|for security purposes/.test(message)) return SIGN_UP_MESSAGES.tooManyEmails;
  if (code === 'over_request_rate_limit' || status === 429 || /rate limit|too many/.test(message)) return SIGN_UP_MESSAGES.tooManyAttempts;
  if (code === 'email_address_not_authorized') return SIGN_UP_MESSAGES.refusedEmail;
  if (
    code === 'email_address_invalid' ||
    (code === 'validation_failed' && message.includes('email')) ||
    /email address .* is invalid|unable to validate email|invalid email/.test(message)
  ) {
    return SIGN_UP_MESSAGES.invalidEmail;
  }
  if (/sending .*email|confirmation email/.test(message)) return SIGN_UP_MESSAGES.emailNotSent;
  if (retryable || (status !== null && status >= 500)) return SIGN_UP_MESSAGES.unavailable;
  return SIGN_UP_MESSAGES.failed;
}
