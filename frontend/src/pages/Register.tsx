import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { Mail, BookOpen, Eye, EyeOff, RefreshCw } from 'lucide-react';
import { validateName, validateEmail, validatePassword, getPasswordStrength } from '../utils/validators';
import { RegisterStory } from '../components/auth/AuthStory';

/**
 * Регистрация (Meldy 2026-10-04): та же раскладка, что у входа, — карточка с формой и цветная панель,
 * в окне которой по очереди отмечаются части плана подготовки (RegisterStory). Пароль и его повтор
 * стоят рядом, чтобы форма помещалась на экране ноутбука.
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

  useEffect(() => {
    if (user) navigate('/dashboard');
  }, [user?.id, navigate]);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');

    const ne = validateName(name);
    const ee = validateEmail(email);
    const pe = validatePassword(password);

    if (ne || ee || pe) {
      setNameError(ne); setEmailError(ee); setPasswordError(pe);
      setLoading(false);
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
        emailRedirectTo: window.location.origin + '/dashboard',
      },
    });

    if (error) {
      if (error.message.includes('already registered')) {
        setError('Пользователь с таким email уже существует');
      } else {
        setError('Произошла ошибка при регистрации. Проверьте данные.');
      }
    } else if (data?.user?.identities && data.user.identities.length === 0) {
      // Supabase "Prevent email enumeration" is ON, so it returns success but empty identities array
      // for users that already exist in the database.
      setError('Пользователь с таким email уже существует');
    } else {
      if (data.session) {
        navigate('/dashboard');
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
        emailRedirectTo: window.location.origin + '/dashboard',
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
        redirectTo: window.location.origin + '/auth/callback',
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
                <p className="au-done-title">Успешно! Мы отправили письмо на вашу почту:</p>
                <span className="au-done-mail">{email}</span>
                <p>Пожалуйста, перейдите по ссылке в письме.</p>

                <button type="button" onClick={handleResend} disabled={loading} className="au-quiet">
                  <RefreshCw aria-hidden="true" className={loading ? 'au-spinning' : undefined} />
                  {loading ? 'Отправка...' : 'Отправить письмо еще раз'}
                </button>

                {resendMessage && <span className="au-done-note">{resendMessage}</span>}
              </div>
            )}

            {!success && (
              <>
                <form onSubmit={handleRegister} className="au-form">
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

                <div className="au-or">или войти через</div>

                <button type="button" onClick={handleGoogleLogin} className="au-oauth">
                  <GoogleMark />
                  Войти через Google
                </button>
              </>
            )}

            <p className="au-foot">
              Уже есть аккаунт?{' '}
              <button type="button" onClick={() => navigate('/login')} className="au-link">
                Войти
              </button>
            </p>
          </div>
        </section>

        <aside className="au-panel au-panel--dawn au-rise au-d1" aria-labelledby="register-panel-title">
          <span className="au-badge au-badge--sm" aria-hidden="true">
            <BookOpen />
          </span>
          <h2 id="register-panel-title" className="au-panel-h">
            Материал становится<br />планом подготовки
          </h2>
          <div className="au-panel-more">
            <RegisterStory />
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
