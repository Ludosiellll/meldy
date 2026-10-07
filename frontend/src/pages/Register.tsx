import { useState, useEffect, useMemo } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { Mail, BookOpen, Eye, EyeOff, RefreshCw } from 'lucide-react';
import { validateName, validateEmail, validatePassword, getPasswordStrength } from '../utils/validators';
import { SIGN_UP_MESSAGES, emptySignUpFields, signUpErrorMessage } from '../lib/signUpErrors';
import AuthReel from '../components/authReel/AuthReel';
import { track } from '../lib/telemetry';
import { afterSignIn, emailRedirectTo, oauthRedirectTo, returnToFromSearch, withReturn } from '../lib/returnTo';
import { detectInAppBrowser } from '../lib/inAppBrowser';
import InAppNote from '../components/InAppNote';

/**
 * Регистрация (Meldy 2026-10-04): та же раскладка, что у входа, — карточка с формой и цветная панель
 * с коротким роликом «Материал становится планом подготовки» (AuthReel). Пароль и его повтор стоят
 * рядом, чтобы форма помещалась на экране ноутбука. Во встроенном браузере мессенджера — как на входе:
 * просьба открыть ссылку в Chrome или Safari вместо кнопки Google, регистрация по почте остаётся.
 */
export default function Register() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [nameError, setNameError] = useState('');
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [resendMessage, setResendMessage] = useState('');
  const navigate = useNavigate();
  const { user } = useAuth();
  const location = useLocation();
  // The page the visitor signs up for (?next=, a safe path of this site only), else «Сегодня» (lib/returnTo). The
  // confirmation letter carries it in its address: the letter is often opened in another browser.
  const returnTo = returnToFromSearch(location.search);
  const browser = useMemo(() => detectInAppBrowser(typeof navigator === 'undefined' ? '' : navigator.userAgent), []);

  useEffect(() => {
    if (user) navigate(afterSignIn(returnTo));
  }, [user?.id, navigate, returnTo]);

  useEffect(() => track('signup_view'), []);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');

    // An empty field never goes to Supabase: it would take the form for an anonymous sign-up (422).
    const empty = emptySignUpFields({ name, email, password });
    const ne = empty.name || validateName(name);
    const ee = empty.email || validateEmail(email);
    const pe = empty.password || validatePassword(password);

    if (ne || ee || pe) {
      setNameError(ne); setEmailError(ee); setPasswordError(pe);
      setLoading(false);
      // The first field to fix gets the focus (its message is read out: role="alert").
      const first = ne ? 'register-name' : ee ? 'register-email' : 'register-password';
      document.getElementById(first)?.focus();
      return;
    }

    if (password !== confirm) {
      setError('Пароли не совпадают');
      setLoading(false);
      return;
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: name },
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
        setSuccess('Успешно! Мы отправили письмо с подтверждением на вашу почту. Пожалуйста, перейдите по ссылке в письме.');
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
      email: email,
      options: {
        emailRedirectTo: emailRedirectTo(window.location.origin, returnTo),
      }
    });
    setLoading(false);
    if (error) {
      setError('Ошибка при повторной отправке. Возможно, вы пытаетесь отправить письмо слишком часто.');
    } else {
      setResendMessage('Письмо отправлено повторно! Пожалуйста, проверьте папку "Спам".');
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

  const strength = password.length > 0 ? Math.max(1, getPasswordStrength(password)) : 0;

  return (
    <div className="au">
      <header className="au-bar">
        <button type="button" onClick={() => navigate('/')} className="au-logo">
          Meldy
        </button>
      </header>

      <main className="au-main">
        <section className="au-card au-rise" aria-labelledby="register-title">
          <div className="au-in">
            <h1 id="register-title" className="au-h1">Создать аккаунт</h1>
            <p className="au-lede">Сохраните материалы и продолжайте подготовку с любого устройства.</p>

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
                <span className="au-done-mail">{email}</span>
                <p>Проверьте «Входящие» и «Спам» и перейдите по ссылке из письма.</p>

                <button type="button" onClick={handleResend} disabled={loading} className="au-quiet">
                  <RefreshCw aria-hidden="true" className={loading ? 'au-spinning' : undefined} />
                  {loading ? 'Отправка...' : 'Отправить письмо еще раз'}
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
                        setNameError(validateName(e.target.value));
                      }}
                      aria-invalid={Boolean(nameError)}
                      aria-describedby={nameError ? 'register-name-error' : undefined}
                      className="au-input"
                      placeholder="Ваше имя"
                      required
                    />
                    {nameError && <p id="register-name-error" role="alert" className="au-hint au-hint--error">{nameError}</p>}
                  </div>

                  <div className="au-field">
                    <label htmlFor="register-email" className="au-label">Email</label>
                    <input
                      id="register-email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={e => {
                        setEmail(e.target.value);
                        setEmailError(validateEmail(e.target.value));
                      }}
                      aria-invalid={Boolean(emailError)}
                      aria-describedby={emailError ? 'register-email-error' : undefined}
                      className="au-input"
                      placeholder="you@example.com"
                      required
                    />
                    {emailError && <p id="register-email-error" role="alert" className="au-hint au-hint--error">{emailError}</p>}
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
                          setPasswordError(validatePassword(e.target.value));
                        }}
                        aria-invalid={Boolean(passwordError)}
                        aria-describedby={passwordError ? 'register-password-error' : undefined}
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
                    {passwordError && <p id="register-password-error" role="alert" className="au-hint au-hint--warn">{passwordError}</p>}
                    {/* Надёжность пароля: три полоски — розовая, жёлтая, зелёная. */}
                    <div className="au-meter" data-level={strength} aria-hidden="true">
                      <i />
                      <i />
                      <i />
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
                        onChange={e => setConfirm(e.target.value)}
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
                  </div>
                  </div>

                  <button type="submit" disabled={loading} data-busy={loading ? '' : undefined} className="sf-primary au-submit">
                    {loading ? 'Регистрируем...' : 'Зарегистрироваться'}
                  </button>
                </form>

                {/* Inside a messenger's browser Google refuses to sign in: no button that cannot work. */}
                {!browser.app && (
                  <>
                    <div className="au-or">или войти через</div>

                    <button type="button" onClick={handleGoogleLogin} className="au-oauth">
                      <GoogleMark />
                      Войти через Google
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
              <Link to="/try" className="au-link" style={{ minHeight: 44 }}>
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
            Материал становится<br />планом подготовки
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
