import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Mail, ShieldCheck, HelpCircle } from 'lucide-react';
import { ty } from '../components/landing/typo';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import AuthHalftone from '../components/AuthHalftone';

/** For an account made with Google there is no password to restore (audit 2026-10-08, PUB-20). */
export const GOOGLE_ONLY_NOTE = 'Входили через Google? Пароль не нужен:';

/**
 * Восстановление пароля (Meldy 2026-10-04): карточка с формой и тёмно-синяя панель с подсказкой. Under the form,
 * one line for an account made with Google: it has no password, the way in is «Войти через Google».
 */
export default function ForgotPassword() {
  useDocumentTitle('Восстановление пароля');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: window.location.origin + '/update-password',
    });

    if (error) {
      if (error.message.includes('not found') || error.message.includes('invalid')) {
        setError('Не удалось найти пользователя с таким email.');
      } else {
        setError('Произошла ошибка при отправке. Попробуйте позже.');
      }
    } else {
      setSuccess(true);
    }
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
        <section className="au-card au-rise" aria-labelledby="reset-title">
          <div className="au-in">
            <h1 id="reset-title" className="au-h1">Восстановить пароль</h1>
            <p className="au-lede">Отправим ссылку для сброса на почту аккаунта.</p>

            {error && (
              <div role="alert" className="au-alert">
                {error}
              </div>
            )}

            {success ? (
              <div className="au-done" role="status">
                <span className="au-done-mark" aria-hidden="true">
                  <Mail />
                </span>
                <p>Инструкции по восстановлению пароля отправлены на почту <b>{email.trim()}</b></p>
                <button type="button" onClick={() => navigate('/login')} className="au-quiet">
                  Вернуться ко входу
                </button>
              </div>
            ) : (
              <>
                <form onSubmit={handleReset} className="au-form">
                  <div className="au-field">
                    <label htmlFor="reset-email" className="au-label">Email</label>
                    <input
                      id="reset-email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      className="au-input"
                      placeholder="you@example.com"
                      required
                    />
                  </div>

                  <button type="submit" disabled={loading} data-busy={loading ? '' : undefined} className="sf-primary au-submit">
                    {loading ? 'Отправляем…' : 'Получить ссылку'}
                  </button>
                </form>
                <p className="au-aside">
                  {GOOGLE_ONLY_NOTE}{' '}
                  <Link to="/login" className="au-link">
                    {'войдите через\u00a0Google'}
                  </Link>
                  {' на странице входа.'}
                </p>
              </>
            )}

            <p className="au-foot">
              Вспомнили пароль?{' '}
              <button type="button" onClick={() => navigate('/login')} className="au-link">
                Войти в аккаунт
              </button>
            </p>
          </div>
        </section>

        <aside className="au-panel au-panel--night au-rise au-d1" aria-labelledby="reset-panel-title">
          <span className="au-badge au-badge--sm" aria-hidden="true">
            <ShieldCheck />
          </span>
          <h2 id="reset-panel-title" className="au-panel-h">{ty('Вернитесь к своим материалам')}</h2>
          <p className="au-panel-p">
            {ty('Укажите почту аккаунта и откройте ссылку из письма. После смены пароля материалы останутся на месте.')}
          </p>
          <div className="au-panel-more">
            <p className="au-note">
              <HelpCircle aria-hidden="true" />
              Проверьте папку «Спам», если письмо долго не приходит.
            </p>
          </div>
          <AuthHalftone />
        </aside>
      </main>
    </div>
  );
}
