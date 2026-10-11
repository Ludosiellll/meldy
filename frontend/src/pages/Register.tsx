import { useState, useEffect, useMemo } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { Mail, BookOpen, Eye, EyeOff, RefreshCw } from 'lucide-react';
import { emailTypo, validateName, validateEmail, validatePassword, type EmailTypo } from '../utils/validators';
import { SIGN_UP_MESSAGES, emptySignUpFields, signUpErrorMessage } from '../lib/signUpErrors';
import AuthReel from '../components/authReel/AuthReel';
import PasswordRules from '../components/auth/PasswordRules';
import { freePlanLine } from '../components/landing/freePlan';
import { track } from '../lib/telemetry';
import { afterSignIn, cameFromTry, emailRedirectTo, oauthRedirectTo, returnToFromSearch, withReturn } from '../lib/returnTo';
import { detectInAppBrowser } from '../lib/inAppBrowser';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import InAppNote from '../components/InAppNote';

/** The sign-up's own words: the heading and the button say the same (decision 5 of 2026-10-08: «Создать аккаунт»). */
export const SIGN_UP_TITLE = 'Создать аккаунт';
export const GOOGLE_SIGN_UP = 'Продолжить с Google';
export const MISMATCH = 'Пароли не совпадают';
export const REPEAT_EMPTY = 'Повторите пароль';
export const TYPO_NOTE = 'Возможно, опечатка в адресе.';
/** Under the heading: what the account keeps. */
export const SIGN_UP_LEDE = 'Сохраните экзамены и продолжайте подготовку с\u00a0любого устройства.';
/** The panel above the reel: the way from the department's file to the plan of each day (the reel's story). */
export const SIGN_UP_PANEL_TITLE = 'От файла с\u00a0вопросами\u00a0— до плана на\u00a0каждый день';
/**
 * The e-mail field in the page's own language (it read «Email», «you@example.com»: jury QA of /try, 2026-10-11); the
 * placeholder keeps a reserved example domain (RFC 2606), so it never names somebody's real mailbox.
 */
export const EMAIL_LABEL = 'Почта';
export const EMAIL_PLACEHOLDER = 'student@example.com';
/** Opened from the example (/try): the quiet way back to it, beside the wordmark. */
export const BACK_TO_TRY = 'Вернуться к примеру';

/**
 * Регистрация (Meldy 2026-10-04): та же раскладка, что у входа, — карточка с формой и цветная панель
 * с коротким роликом под заголовком «От файла с вопросами — до плана на каждый день» (AuthReel). Пароль и его повтор стоят
 * рядом, чтобы форма помещалась на экране ноутбука. Во встроенном WebView — как на входе: просьба открыть
 * ссылку в Chrome или Safari вместо кнопки Google, регистрация по почте остаётся (lib/inAppBrowser: Custom Tabs и
 * SFSafariViewController — настоящие браузеры, там кнопка Google есть).
 *
 * Audit 2026-10-08: what the free account gives is said under the heading (PUB-21); the password's rules are on
 * screen before typing and tick as they are met, a repeat that differs says so as it is typed (PUB-20); a likely
 * typo in the address is a hint with a one-click fix, never a refusal (PUB-4); a field says what is wrong once it
 * is left or the form is sent, and its message goes away as soon as it is right.
 */
export default function Register() {
  useDocumentTitle('Регистрация');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [nameError, setNameError] = useState('');
  const [emailError, setEmailError] = useState('');
  const [emailHint, setEmailHint] = useState<EmailTypo | null>(null);
  const [passwordError, setPasswordError] = useState('');
  const [confirmError, setConfirmError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [resendMessage, setResendMessage] = useState('');
  const navigate = useNavigate();
  const { user } = useAuth();
  const location = useLocation();
  // The page the visitor signs up for (?next=, a safe path of this site only), else «Сегодня» (lib/returnTo). The
  // confirmation letter carries it in its address: the letter is often opened in another browser.
  const returnTo = returnToFromSearch(location.search);
  const fromTry = cameFromTry(location.state);
  const browser = useMemo(() => detectInAppBrowser(typeof navigator === 'undefined' ? '' : navigator.userAgent), []);

  useEffect(() => {
    if (user) navigate(afterSignIn(returnTo));
  }, [user?.id, navigate, returnTo]);

  useEffect(() => track('signup_view'), []);

  // The repeat says it differs once it is as long as the password (or after a refused submit), and stops as soon as it matches.
  let confirmMessage = '';
  if (confirm !== password) {
    if (!confirm) confirmMessage = confirmError ? REPEAT_EMPTY : '';
    else if (confirmError || (password.length > 0 && confirm.length >= password.length)) confirmMessage = MISMATCH;
  }

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess(false);

    // An empty field never goes to Supabase: it would take the form for an anonymous sign-up (422).
    const empty = emptySignUpFields({ name, email, password });
    const ne = empty.name || validateName(name);
    const ee = empty.email || validateEmail(email);
    const pe = empty.password || validatePassword(password);

    if (ne || ee || pe) {
      setNameError(ne); setEmailError(ee); setPasswordError(pe);
      // The first field to fix gets the focus (its message is read out: role="alert").
      const first = ne ? 'register-name' : ee ? 'register-email' : 'register-password';
      document.getElementById(first)?.focus();
      return;
    }

    if (password !== confirm) {
      setConfirmError(confirm ? MISMATCH : REPEAT_EMPTY);
      document.getElementById('register-confirm')?.focus();
      return;
    }

    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: { full_name: name.trim() },
        emailRedirectTo: emailRedirectTo(window.location.origin, returnTo),
      },
    });

    if (error) {
      // A taken address, a weak password, a typo, too many attempts or letters, no network — each says so.
      setError(signUpErrorMessage(error));
    } else if (data?.user?.identities && data.user.identities.length === 0) {
      // Supabase "Prevent email enumeration" is ON, so it returns success but empty identities array
      // for users that already exist in the database.
      setError(SIGN_UP_MESSAGES.exists);
    } else {
      track('signup_done', { method: 'email', confirmed: Boolean(data.session) });
      if (data.session) {
        navigate(afterSignIn(returnTo));
      } else {
        setSuccess(true);
      }
    }

    setLoading(false);
  };

  const handleResend = async () => {
    setLoading(true);
    setError('');
    setResendMessage('');
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: email.trim(),
      options: {
        emailRedirectTo: emailRedirectTo(window.location.origin, returnTo),
      }
    });
    setLoading(false);
    if (error) {
      setError('Не удалось отправить письмо ещё раз. Возможно, письма уходят слишком часто: попробуйте через несколько минут.');
    } else {
      setResendMessage('Письмо отправлено ещё раз. Проверьте и папку «Спам».');
    }
  };

  const handleGoogleLogin = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: oauthRedirectTo(window.location.origin, returnTo),
      },
    });
  };

  const fixEmail = () => {
    if (!emailHint) return;
    setEmail(emailHint.fixed);
    setEmailHint(null);
    setEmailError('');
    document.getElementById('register-email')?.focus();
  };

  const emailDescribedBy = [emailError ? 'register-email-error' : '', emailHint && !emailError ? 'register-email-hint' : ''].filter(Boolean).join(' ') || undefined;
  const passwordDescribedBy = ['register-password-rules', passwordError ? 'register-password-error' : ''].filter(Boolean).join(' ');

  return (
    <div className="au">
      <header className="au-bar">
        <button type="button" onClick={() => navigate('/')} className="au-logo">
          Meldy
        </button>
        {/* Came from the example: one quiet step back to it (the example's answers live in this tab). */}
        {fromTry ? (
          <Link to="/try" className="au-link au-bar-back">
            {BACK_TO_TRY}
          </Link>
        ) : null}
      </header>

      <main className="au-main">
        <section className="au-card au-rise" aria-labelledby="register-title">
          <div className="au-in">
            <h1 id="register-title" className="au-h1">{SIGN_UP_TITLE}</h1>
            <p className="au-lede">{SIGN_UP_LEDE}</p>
            <p className="au-free">{freePlanLine()}</p>

            {browser.app && !success && (
              <InAppNote
                browser={browser}
                url={`${window.location.origin}${location.pathname}${location.search}`}
                extra={<p className="ia-hint">Зарегистрироваться по почте можно и здесь.</p>}
              />
            )}

            {error && (
              <div role="alert" className="au-alert">
                {error}
              </div>
            )}

            {success && (
              <div className="au-done" role="status">
                <span className="au-done-mark" aria-hidden="true">
                  <Mail />
                </span>
                <p className="au-done-title">Мы отправили письмо на</p>
                <span className="au-done-mail">{email.trim()}</span>
                <p>Проверьте «Входящие» и «Спам» и перейдите по ссылке из письма.</p>

                <button type="button" onClick={handleResend} disabled={loading} className="au-quiet">
                  <RefreshCw aria-hidden="true" className={loading ? 'au-spinning' : undefined} />
                  {loading ? 'Отправляем…' : 'Отправить письмо ещё раз'}
                </button>

                {resendMessage && <span className="au-done-note">{resendMessage}</span>}
              </div>
            )}

            {!success && (
              <>
                <form onSubmit={handleRegister} className="au-form" noValidate>
                  <div className="au-field">
                    <label htmlFor="register-name" className="au-label">Имя</label>
                    <input
                      id="register-name"
                      name="name"
                      type="text"
                      autoComplete="name"
                      value={name}
                      onChange={e => {
                        setName(e.target.value);
                        if (nameError) setNameError(validateName(e.target.value));
                      }}
                      onBlur={() => setNameError(validateName(name))}
                      aria-invalid={Boolean(nameError)}
                      aria-describedby={nameError ? 'register-name-error' : undefined}
                      className="au-input"
                      placeholder="Ваше имя"
                      required
                    />
                    {nameError && <p id="register-name-error" role="alert" className="au-hint au-hint--error">{nameError}</p>}
                  </div>

                  <div className="au-field">
                    <label htmlFor="register-email" className="au-label">{EMAIL_LABEL}</label>
                    <input
                      id="register-email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={e => {
                        setEmail(e.target.value);
                        setEmailHint(null);
                        if (emailError) setEmailError(validateEmail(e.target.value));
                      }}
                      onBlur={() => {
                        const problem = validateEmail(email);
                        setEmailError(problem);
                        setEmailHint(problem ? null : emailTypo(email));
                      }}
                      aria-invalid={Boolean(emailError)}
                      aria-describedby={emailDescribedBy}
                      className="au-input"
                      placeholder={EMAIL_PLACEHOLDER}
                      required
                    />
                    {emailError && <p id="register-email-error" role="alert" className="au-hint au-hint--error">{emailError}</p>}
                    {/* A hint, not an error: the form is sent as it is if the address is right (mail.com, inbox.lv…). */}
                    {emailHint && !emailError && (
                      <p id="register-email-hint" role="status" className="au-hint au-hint--warn au-typo">
                        <span>{TYPO_NOTE}</span>
                        <button type="button" className="au-typo-fix" onClick={fixEmail}>
                          Исправить на {emailHint.domain}
                        </button>
                      </p>
                    )}
                  </div>

                  <div className="au-pair">
                    <div className="au-field">
                      <label htmlFor="register-password" className="au-label">Пароль</label>
                      <div className="au-control">
                        <input
                          id="register-password"
                          name="password"
                          type={showPassword ? 'text' : 'password'}
                          autoComplete="new-password"
                          value={password}
                          onChange={e => {
                            setPassword(e.target.value);
                            if (passwordError) setPasswordError(validatePassword(e.target.value));
                          }}
                          aria-invalid={Boolean(passwordError)}
                          aria-describedby={passwordDescribedBy}
                          className="au-input au-input--eye"
                          placeholder="••••••••"
                          required
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="au-eye"
                          aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                        >
                          {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                        </button>
                      </div>
                    </div>

                    <div className="au-field">
                      <label htmlFor="register-confirm" className="au-label">Повтор пароля</label>
                      <div className="au-control">
                        <input
                          id="register-confirm"
                          name="password-confirmation"
                          type={showConfirm ? 'text' : 'password'}
                          autoComplete="new-password"
                          value={confirm}
                          onChange={e => {
                            setConfirm(e.target.value);
                            if (e.target.value === password) setConfirmError('');
                          }}
                          aria-invalid={Boolean(confirmMessage)}
                          aria-describedby={confirmMessage ? 'register-confirm-error' : undefined}
                          className="au-input au-input--eye"
                          placeholder="••••••••"
                        />
                        <button
                          type="button"
                          onClick={() => setShowConfirm(!showConfirm)}
                          className="au-eye"
                          aria-label={showConfirm ? 'Скрыть повтор пароля' : 'Показать повтор пароля'}
                        >
                          {showConfirm ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                        </button>
                      </div>
                      {confirmMessage && <p id="register-confirm-error" role="alert" className="au-hint au-hint--error">{confirmMessage}</p>}
                    </div>

                    {/* Under both fields, the whole width: the rules before anything is typed, the refusal after a submit. */}
                    <div className="au-pair-foot">
                      <PasswordRules id="register-password-rules" password={password} flagged={Boolean(passwordError)} />
                      {passwordError && <p id="register-password-error" role="alert" className="au-hint au-hint--warn">{passwordError}</p>}
                    </div>
                  </div>

                  <button type="submit" disabled={loading} data-busy={loading ? '' : undefined} className="sf-primary au-submit">
                    {loading ? 'Создаём аккаунт…' : SIGN_UP_TITLE}
                  </button>
                </form>

                {/* Inside an embedded WebView Google refuses to sign in (lib/inAppBrowser): no button that cannot work. */}
                {!browser.app && (
                  <>
                    <div className="au-or">или</div>

                    <button type="button" onClick={handleGoogleLogin} className="au-oauth">
                      <GoogleMark />
                      {GOOGLE_SIGN_UP}
                    </button>
                  </>
                )}
              </>
            )}

            <p className="au-foot">
              Уже есть аккаунт?{' '}
              <button type="button" onClick={() => navigate(withReturn('/login', returnTo))} className="au-link">
                Войти
              </button>
            </p>
            <p className="au-foot">
              Или сначала{' '}
              <Link to="/try" className="au-link">
                попробуйте на примере
              </Link>
              {' — без регистрации.'}
            </p>
          </div>
        </section>

        <aside className="au-panel au-panel--dawn au-panel--reel au-rise au-d1" aria-labelledby="register-panel-title">
          <span className="au-badge au-badge--sm" aria-hidden="true">
            <BookOpen />
          </span>
          <h2 id="register-panel-title" className="au-panel-h">
            {SIGN_UP_PANEL_TITLE}
          </h2>
          <div className="au-panel-more">
            <AuthReel variant="register" />
          </div>
        </aside>
      </main>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M17.64 9.20455C17.64 8.56636 17.5827 7.95273 17.4764 7.36364H9V10.845H13.8436C13.635 11.97 13.0009 12.9232 12.0477 13.5614V15.8195H14.9564C16.6582 14.2527 17.64 11.9455 17.64 9.20455Z" fill="#4285F4"/>
      <path d="M9 18C11.43 18 13.4673 17.1941 14.9564 15.8195L12.0477 13.5614C11.2418 14.1014 10.2109 14.4205 9 14.4205C6.65591 14.4205 4.67182 12.8373 3.96409 10.71H0.957275V13.0418C2.43818 15.9832 5.48182 18 9 18Z" fill="#34A853"/>
      <path d="M3.96409 10.71C3.78409 10.17 3.68182 9.59318 3.68182 9C3.68182 8.40682 3.78409 7.83 3.96409 7.29V4.95818H0.957275C0.347727 6.17318 0 7.54773 0 9C0 10.4523 0.347727 11.8268 0.957275 13.0418L3.96409 10.71Z" fill="#FBBC05"/>
      <path d="M9 3.57955C10.3214 3.57955 11.5077 4.03364 12.4405 4.92545L15.0218 2.34409C13.4632 0.891818 11.4259 0 9 0C5.48182 0 2.43818 2.01682 0.957275 4.95818L3.96409 7.29C4.67182 5.16273 6.65591 3.57955 9 3.57955Z" fill="#EA4335"/>
    </svg>
  );
}
