import { describe, expect, it } from 'vitest';
import { SIGN_UP_MESSAGES, signUpErrorMessage } from './signUpErrors';

/** The shapes auth-js 2.105 gives (AuthApiError, AuthWeakPasswordError, AuthRetryableFetchError). */
const api = (status: number, code: string | undefined, message: string) => ({ name: 'AuthApiError', status, code, message });

describe('signUpErrorMessage', () => {
  it.each([
    ['a taken address', api(422, 'user_already_exists', 'User already registered'), SIGN_UP_MESSAGES.exists],
    ['a taken address (email_exists)', api(422, 'email_exists', 'Email address already registered by another user'), SIGN_UP_MESSAGES.exists],
    ['a taken address on a server without codes', api(400, undefined, 'User already registered'), SIGN_UP_MESSAGES.exists],
    ['a weak password', { name: 'AuthWeakPasswordError', status: 422, code: 'weak_password', message: 'Password should be at least 6 characters.', reasons: ['length'] }, SIGN_UP_MESSAGES.weakPassword],
    ['a leaked password', { name: 'AuthWeakPasswordError', status: 422, code: 'weak_password', message: 'Password is known to be weak', reasons: ['pwned'] }, SIGN_UP_MESSAGES.leakedPassword],
    ['a wrong address', api(400, 'email_address_invalid', 'Email address "a@b" is invalid'), SIGN_UP_MESSAGES.invalidEmail],
    ['a wrong address (validation_failed)', api(422, 'validation_failed', 'Unable to validate email address: invalid format'), SIGN_UP_MESSAGES.invalidEmail],
    ['an address the mail service refuses', api(400, 'email_address_not_authorized', 'Email address not authorized'), SIGN_UP_MESSAGES.refusedEmail],
    ['too many letters', api(429, 'over_email_send_rate_limit', 'email rate limit exceeded'), SIGN_UP_MESSAGES.tooManyEmails],
    ['a letter asked for again too soon', api(429, 'over_email_send_rate_limit', 'For security purposes, you can only request this after 37 seconds.'), SIGN_UP_MESSAGES.tooManyEmails],
    ['too many attempts', api(429, 'over_request_rate_limit', 'Request rate limit reached'), SIGN_UP_MESSAGES.tooManyAttempts],
    ['no network', { name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' }, SIGN_UP_MESSAGES.offline],
    ['no network in Safari', new TypeError('Load failed'), SIGN_UP_MESSAGES.offline],
    ['a letter that could not be sent', api(500, 'unexpected_failure', 'Error sending confirmation email'), SIGN_UP_MESSAGES.emailNotSent],
    ['the service down', { name: 'AuthRetryableFetchError', status: 503, message: 'Service Unavailable' }, SIGN_UP_MESSAGES.unavailable],
    ['anything else', api(403, 'signup_disabled', 'Signups not allowed for this instance'), SIGN_UP_MESSAGES.failed],
    ['not an error at all', null, SIGN_UP_MESSAGES.failed],
  ])('says what happened: %s', (_, error, message) => {
    expect(signUpErrorMessage(error, true)).toBe(message);
  });

  it('says there is no network when the browser is offline, whatever the error', () => {
    expect(signUpErrorMessage(api(500, 'unexpected_failure', 'Internal error'), false)).toBe(SIGN_UP_MESSAGES.offline);
  });

  it('never shows the old catch-all, and «try in a few minutes» where waiting helps', () => {
    for (const text of Object.values(SIGN_UP_MESSAGES)) expect(text).not.toMatch(/Проверьте данные/);
    for (const key of ['tooManyEmails', 'tooManyAttempts', 'emailNotSent', 'unavailable'] as const) {
      expect(SIGN_UP_MESSAGES[key]).toMatch(/через несколько минут/);
    }
  });
});
