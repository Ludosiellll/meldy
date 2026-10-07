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
import { displayCheatsheet } from '../utils/cheatsheetDisplay';

/**
 * A material opened by its link, without an account (Meldy 2026-10-04): the top line with the wordmark and
 * «Создать свой», the title, the summary (or the cheat sheet) in a white card, and an invitation on a blue panel.
 */
export default function SharedMaterial() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [material, setMaterial] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadMaterial() {
      try {
        // Only what the link shows (title, subject, summary, cheat sheet), never the lecture's own text;
        // null while the author keeps the material closed (migration *_shared_material_read.sql).
        const { data, error } = await supabase.rpc('shared_material', { p_id: id });

        if (error) throw error;
        setMaterial(data && typeof data === 'object' ? data : null);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    if (id) loadMaterial();
  }, [id]);

  const bar = (
    <header className="shm-bar">
      <div className="shm-bar-in">
        <Link className="shm-logo" to="/">
          Meldy
        </Link>
        <span className="shm-bar-label">Общий материал</span>
        <button type="button" onClick={() => navigate('/register')} className="shm-cta">
          Создать свой
        </button>
      </div>
    </header>
  );

  if (loading) {
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

  if (!material) {
    return (
      <div className="shm">
        {bar}
        <main className="shm-main">
          <section className="shm-card shm-missing">
            <h1>Материал не найден</h1>
            <p>Возможно, ссылка устарела или автор закрыл к нему доступ.</p>
            <button type="button" onClick={() => navigate('/')} className="sf-primary">
              На главную
            </button>
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
              <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{displayCheatsheet(stripSourceMarkers(cheatsheet))}</ReactMarkdown>
            </div>
          </article>
        ) : (
          <article className="shm-card">
            {/* The fragment marks «[S02]» are internal ids: a reader of the link never sees them. */}
            <div className="shm-md">
              <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                {stripSourceMarkers(extractCleanContent(material.summary_json)) || 'У этого материала пока нет конспекта.'}
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
