import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { Eye, EyeOff } from 'lucide-react';
import { validateEmail } from '../utils/validators';
import AuthReel from '../components/authReel/AuthReel';
import { track } from '../lib/telemetry';

/**
 * Вход (Meldy 2026-10-04): форма в белой карточке, рядом цветная панель с полутоновыми точками —
 * как плитки первого экрана лендинга; под заголовком панели по кругу идёт короткий ролик «Как
 * работает Meldy» (AuthReel, на движке ролика лендинга). Отступы следуют высоте экрана, чтобы форма
 * целиком помещалась на ноутбуке. На телефоне панель сжимается до строки над карточкой, без ролика.
 * Стили — .au-* в styles/legacy.css.
 */
export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [emailError, setEmailError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    if (user) navigate('/dashboard');
  }, [user?.id, navigate]);

  const handleGoogleLogin = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + '/auth/callback',
      },
    });
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const ee = validateEmail(email);
    if (ee) {
      setEmailError(ee);
      setLoading(false);
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (!error) track('login_done', { method: 'email' });
    if (error) {
      if (error.message.includes('Invalid login credentials')) {
        setError('Неверный email или пароль');
      } else {
        setError('Произошла ошибка при входе. Проверьте данные.');
      }
    } else navigate('/dashboard');
    setLoading(false);
  };

  return (
    <div className="au">
      <header className="au-bar">
        <button type="button" onClick={() => navigate('/')} className="au-logo">
          Meldy
        </button>
      </header>

      <main className="au-main">
        <section className="au-card au-rise" aria-labelledby="login-title">
          <div className="au-in">
            <h1 id="login-title" className="au-h1">Продолжить подготовку</h1>
            <p className="au-lede">Ваши материалы, карточки и результаты сохранены в одном месте.</p>

            {error && (
              <div role="alert" className="au-alert">
                {error}
              </div>
            )}

            <form onSubmit={handleLogin} className="au-form">
              <div className="au-field">
                <label htmlFor="login-email" className="au-label">Email</label>
                <input
                  id="login-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={e => {
                    setEmail(e.target.value);
                    setEmailError(validateEmail(e.target.value));
                  }}
                  aria-invalid={Boolean(emailError)}
                  aria-describedby={emailError ? 'login-email-error' : undefined}
                  className="au-input"
                  placeholder="you@example.com"
                  required
                />
                {emailError && <p id="login-email-error" role="alert" className="au-hint au-hint--error">{emailError}</p>}
              </div>

              <div className="au-field">
                <div className="au-label-row">
                  <label htmlFor="login-password" className="au-label">Пароль</label>
                  <button type="button" onClick={() => navigate('/forgot-password')} className="au-link">
                    Забыли пароль?
                  </button>
                </div>
                <div className="au-control">
                  <input
                    id="login-password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
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
              <button type="submit" disabled={loading} data-busy={loading ? '' : undefined} className="sf-primary au-submit">
                {loading ? 'Входим…' : 'Войти'}
              </button>
            </form>

            <div className="au-or">или</div>

            <button type="button" onClick={handleGoogleLogin} className="au-oauth">
              <GoogleMark />
              Войти через Google
            </button>

            <p className="au-foot">
              Нет аккаунта?{' '}
              <button type="button" onClick={() => navigate('/register')} className="au-link">
                Зарегистрироваться
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

        <aside className="au-panel au-panel--reel au-rise au-d1" aria-labelledby="login-panel-title">
          <p className="au-cap">Как работает Meldy</p>
          <h2 id="login-panel-title" className="au-panel-h">От источника до уверенного ответа.</h2>
          <div className="au-panel-more">
            <AuthReel variant="login" />
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
