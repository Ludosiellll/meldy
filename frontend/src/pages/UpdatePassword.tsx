import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { ShieldCheck, KeyRound } from 'lucide-react';
import PasswordRules from '../components/auth/PasswordRules';
import { validatePassword } from '../utils/validators';
import { useDocumentTitle } from '../lib/useDocumentTitle';

/**
 * Новый пароль (Meldy 2026-10-04): карточка с формой и синяя панель. The new password follows the sign-up's rules,
 * shown before typing (audit 2026-10-08: this page asked for six characters while sign-up asks for eight with a
 * capital and a digit); a repeat that differs says so as it is typed.
 */
export default function UpdatePassword() {
  useDocumentTitle('Новый пароль');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [confirmError, setConfirmError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    // Listen for auth state changes to make sure we are handling the password recovery event
    const { data: authListener } = supabase.auth.onAuthStateChange(
      async (event) => {
        if (event == 'PASSWORD_RECOVERY') {
          // User is ready to update their password
        }
      }
    );
    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  let confirmMessage = '';
  if (confirm !== password) {
    if (!confirm) confirmMessage = confirmError ? 'Повторите пароль' : '';
    else if (confirmError || (password.length > 0 && confirm.length >= password.length)) confirmMessage = 'Пароли не совпадают';
  }

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const problem = password ? validatePassword(password) : 'Придумайте пароль';
    if (problem) {
      setPasswordError(problem);
      document.getElementById('new-password')?.focus();
      return;
    }

    if (password !== confirm) {
      setConfirmError(confirm ? 'Пароли не совпадают' : 'Повторите пароль');
      document.getElementById('confirm-new-password')?.focus();
      return;
    }

    setLoading(true);

    const { error } = await supabase.auth.updateUser({
      password: password
    });

    if (error) {
      setError('Не удалось сохранить пароль. Откройте ссылку из письма ещё раз и попробуйте снова.');
    } else {
      setSuccess(true);
      setTimeout(() => {
        navigate('/dashboard');
      }, 2000);
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
        <section className="au-card au-rise" aria-labelledby="new-password-title">
          <div className="au-in">
            <h1 id="new-password-title" className="au-h1">Новый пароль</h1>
            <p className="au-lede">Придумайте пароль для входа по почте.</p>

            {error && (
              <div role="alert" className="au-alert">
                {error}
              </div>
            )}

            {success ? (
              <div className="au-done" role="status">
                <span className="au-done-mark" aria-hidden="true">
                  <ShieldCheck />
                </span>
                <p className="au-done-title">Пароль изменён. Открываем Meldy…</p>
              </div>
            ) : (
              <form onSubmit={handleUpdate} className="au-form" noValidate>
                <div className="au-field">
                  <label htmlFor="new-password" className="au-label">Новый пароль</label>
                  <input
                    id="new-password"
                    name="new-password"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={e => {
                      setPassword(e.target.value);
                      if (passwordError) setPasswordError(validatePassword(e.target.value));
                    }}
                    aria-invalid={Boolean(passwordError)}
                    aria-describedby={['new-password-rules', passwordError ? 'new-password-error' : ''].filter(Boolean).join(' ')}
                    className="au-input"
                    placeholder="••••••••"
                    required
                  />
                  <PasswordRules id="new-password-rules" password={password} flagged={Boolean(passwordError)} />
                  {passwordError && <p id="new-password-error" role="alert" className="au-hint au-hint--warn">{passwordError}</p>}
                </div>

                <div className="au-field">
                  <label htmlFor="confirm-new-password" className="au-label">Повтор пароля</label>
                  <input
                    id="confirm-new-password"
                    name="confirm-new-password"
                    type="password"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={e => {
                      setConfirm(e.target.value);
                      if (e.target.value === password) setConfirmError('');
                    }}
                    aria-invalid={Boolean(confirmMessage)}
                    aria-describedby={confirmMessage ? 'confirm-new-password-error' : undefined}
                    className="au-input"
                    placeholder="••••••••"
                    required
                  />
                  {confirmMessage && <p id="confirm-new-password-error" role="alert" className="au-hint au-hint--error">{confirmMessage}</p>}
                </div>

                <button type="submit" disabled={loading} data-busy={loading ? '' : undefined} className="sf-primary au-submit">
                  {loading ? 'Сохраняем…' : 'Сохранить'}
                </button>
              </form>
            )}
          </div>
        </section>

        <aside className="au-panel au-rise au-d1" aria-labelledby="new-password-panel-title">
          <span className="au-badge au-badge--sm" aria-hidden="true">
            <ShieldCheck />
          </span>
          <h2 id="new-password-panel-title" className="au-panel-h">Один шаг до продолжения</h2>
          <p className="au-panel-p">
            После сохранения вы вернётесь в Meldy и продолжите работу с прежними материалами.
          </p>
          <div className="au-panel-more au-panel-art" aria-hidden="true">
            <span className="au-badge">
              <KeyRound />
            </span>
          </div>
        </aside>
      </main>
    </div>
  );
}
