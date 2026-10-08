import { useState, useEffect } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { ArrowRight, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import '../styles/paper.css';
import './SharedMaterial.css';
import { displayMaterialTitle } from '../utils/materialTitle';
import { stripSourceMarkers } from '../components/summary/fragmentModel';
import { repairMathEscapes } from '../lib/mathEscapes';
import { displayCheatsheet } from '../utils/cheatsheetDisplay';
import { useDocumentTitle } from '../lib/useDocumentTitle';

type Load =
  | { state: 'loading' }
  | { state: 'ready'; material: any }
  /** No such material, or its author keeps it closed: the RPC answers null (or refuses a malformed id). */
  | { state: 'missing' }
  /** No answer: no network, a timeout or the server failing. Another try may work. */
  | { state: 'failed' };

/** No network (status 0), a timeout, too many requests or the server failing: worth another try. */
const retryable = (status: number | undefined) => !status || status === 408 || status === 429 || status >= 500;

/**
 * A material opened by its link, without an account (Meldy 2026-10-04): the top line with the wordmark and
 * «Создать аккаунт», the title, the summary (or the cheat sheet) in a white card, and an invitation on a blue panel.
 *
 * Audit 2026-10-08 (PUB-26): a material that is not there and a load that failed are told apart (the second offers
 * «Обновить»); the label «Общий материал» is plain text and only over a material; the way on is the example.
 */
export default function SharedMaterial() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const material = load.state === 'ready' ? load.material : null;
  useDocumentTitle(material ? displayMaterialTitle(material.title) : 'Общий материал');

  useEffect(() => {
    if (!id) {
      setLoad({ state: 'missing' });
      return undefined;
    }
    let live = true;
    setLoad({ state: 'loading' });
    // Only what the link shows (title, subject, summary, cheat sheet), never the lecture's own text;
    // null while the author keeps the material closed (migration *_shared_material_read.sql).
    Promise.resolve(supabase.rpc('shared_material', { p_id: id })).then(
      ({ data, error, status }) => {
        if (!live) return;
        if (error) {
          console.error(error);
          setLoad(retryable(status) ? { state: 'failed' } : { state: 'missing' });
          return;
        }
        setLoad(data && typeof data === 'object' ? { state: 'ready', material: data } : { state: 'missing' });
      },
      (error: unknown) => {
        if (!live) return;
        console.error(error);
        setLoad({ state: 'failed' });
      },
    );
    return () => {
      live = false;
    };
  }, [id, attempt]);

  const bar = (
    <header className="shm-bar">
      <div className="shm-bar-in">
        <Link className="shm-logo" to="/">
          Meldy
        </Link>
        {material ? <span className="shm-bar-label">Общий материал</span> : null}
        {/* «Войти» is always there for a guest (decision 5 of 2026-10-08), sign-up beside it. */}
        <Link to="/login" className="shm-signin">
          Войти
        </Link>
        <button type="button" onClick={() => navigate('/register')} className="shm-cta">
          Создать аккаунт
        </button>
      </div>
    </header>
  );

  if (load.state === 'loading') {
    return (
      <div className="shm">
        {bar}
        <main className="shm-main" role="status" aria-label="Загружаем материал">
          <div className="shm-skeleton" aria-hidden="true">
            <i className="shm-skel-title" />
            <div className="shm-card">
              <i />
              <i />
              <i />
              <i />
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (load.state === 'failed') {
    return (
      <div className="shm">
        {bar}
        <main className="shm-main">
          <section className="shm-card shm-missing" aria-labelledby="shm-failed-title">
            <h1 id="shm-failed-title">Не удалось загрузить материал</h1>
            <p>Проверьте интернет и попробуйте ещё раз.</p>
            <div className="shm-missing-acts">
              <button type="button" onClick={() => setAttempt((value) => value + 1)} className="sf-primary">
                Обновить
              </button>
            </div>
          </section>
        </main>
      </div>
    );
  }

  if (load.state === 'missing') {
    return (
      <div className="shm">
        {bar}
        <main className="shm-main">
          <section className="shm-card shm-missing" aria-labelledby="shm-missing-title">
            <h1 id="shm-missing-title">Материал не найден</h1>
            <p>Возможно, ссылка устарела или автор закрыл к нему доступ.</p>
            <div className="shm-missing-acts">
              <Link to="/try" className="sf-primary">
                Попробовать на примере
              </Link>
              <Link to="/" className="shm-link">
                Что такое Meldy
              </Link>
            </div>
          </section>
        </main>
      </div>
    );
  }

  const cheatsheet = material.summary_json?.cheatsheet;

  const extractCleanContent = (data: any): string => {
    if (!data) return '';
    let raw = data.content || data.raw || '';
    if (typeof raw === 'string' && raw.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed.content) raw = parsed.content;
      } catch (e) {
        const match = raw.match(/"content"\s*:\s*"([\s\S]*?)(?:"\s*[,}])/);
        if (match) raw = match[1];
      }
    }
    return raw;
  };

  return (
    <div className="shm">
      {bar}

      <main className="shm-main">
        <section className="shm-head">
          <p className="shm-origin">
            <Sparkles aria-hidden="true" strokeWidth={1.75} />
            Сгенерировано ИИ на основе лекции
          </p>
          <h1 className="shm-h1">{displayMaterialTitle(material.title)}</h1>
        </section>

        {cheatsheet ? (
          <article className="shm-card">
            <p className="shm-kicker">Выжимка</p>
            <div className="shm-md">
              <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{displayCheatsheet(repairMathEscapes(stripSourceMarkers(cheatsheet)))}</ReactMarkdown>
            </div>
          </article>
        ) : (
          <article className="shm-card">
            {/* The fragment marks «[S02]» are internal ids: a reader of the link never sees them. */}
            <div className="shm-md">
              <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                {repairMathEscapes(stripSourceMarkers(extractCleanContent(material.summary_json))) || 'У этого материала пока нет конспекта.'}
              </ReactMarkdown>
            </div>
          </article>
        )}

        {/* CTA */}
        <section className="shm-final" aria-labelledby="shm-final-title">
          <h2 id="shm-final-title">{'Готовитесь к\u00a0устному экзамену?'}</h2>
          <p>{'Вставьте список вопросов кафедры и\u00a0загрузите свои лекции. Meldy спросит билет вслух и\u00a0переспросит о\u00a0том, что вы пропустили.'}</p>
          <button type="button" onClick={() => navigate('/register')} className="shm-white-pill">
            Начать со своего списка
            <span className="shm-dot" aria-hidden="true">
              <ArrowRight strokeWidth={2} />
            </span>
          </button>
        </section>
      </main>
    </div>
  );
}
