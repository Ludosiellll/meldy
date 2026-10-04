import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { ShieldCheck, KeyRound } from 'lucide-react';

/** Новый пароль (Meldy 2026-10-04): карточка с формой и синяя панель. */
export default function UpdatePassword() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
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

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password.length < 6) {
      setError('Пароль должен содержать минимум 6 символов');
      return;
    }

    if (password !== confirm) {
      setError('Пароли не совпадают');
      return;
    }

    setLoading(true);
    setError('');

    const { error } = await supabase.auth.updateUser({
      password: password
    });

    if (error) {
      setError('Произошла ошибка при обновлении пароля.');
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
            <p className="au-lede">Используйте не менее шести символов.</p>

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
                <p className="au-done-title">Пароль успешно изменён! Перенаправляем...</p>
              </div>
            ) : (
              <form onSubmit={handleUpdate} className="au-form">
                <div className="au-field">
                  <label htmlFor="new-password" className="au-label">Новый пароль</label>
                  <input
                    id="new-password"
                    name="new-password"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="au-input"
                    placeholder="••••••••"
                    required
                  />
                </div>

                <div className="au-field">
                  <label htmlFor="confirm-new-password" className="au-label">Подтвердите пароль</label>
                  <input
                    id="confirm-new-password"
                    name="confirm-new-password"
                    type="password"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                    className="au-input"
                    placeholder="••••••••"
                    required
                  />
                </div>

                <button type="submit" disabled={loading} data-busy={loading ? '' : undefined} className="sf-primary au-submit">
                  {loading ? 'Сохраняем...' : 'Сохранить'}
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
