import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { SummaryInfo } from '../types';
import SourceReferences from './SourceReferences';

/** Извлекает чистый текст конспекта, защищаясь от сырого JSON в content */
function extractCleanContent(data: any): string {
  // Нормальный случай: объект с полем content
  let raw = data?.content || (data as any)?.raw || '';

  // Если content сам является строкой с JSON — пробуем распарсить
  if (typeof raw === 'string' && raw.trimStart().startsWith('{')) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.content) raw = parsed.content;
    } catch {
      // Попробуем вырезать content из raw вручную
      const match = raw.match(/"content"\s*:\s*"([\s\S]*?)(?:"\s*[,}])/);
      if (match) raw = match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
    }
  }

  // Если data сам — строка (старые записи)
  if (!raw && typeof data === 'string') {
    raw = data;
    if (raw.trimStart().startsWith('{')) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed?.content) raw = parsed.content;
      } catch {}
    }
  }

  // Обрезаем JSON-хвост с терминами, если он приклеился к концу
  const jsonTailIdx = raw.search(/\s*[,"]?\s*"terms"\s*:/);
  if (jsonTailIdx > 0) raw = raw.slice(0, jsonTailIdx);

  return stripSourceMarkers(raw).trim();
}

/**
 * Модель иногда повторяет в тексте метки фрагментов «[S02]», которые видела во входе. На экране они выглядят
 * как сырой вывод машины; фрагменты конспекта и так названы ссылками «фрагмент N».
 */
export function stripSourceMarkers(text: string): string {
  return text.replace(/[ \t]*\[S\d{1,3}\](?:[ \t]*,?[ \t]*\[S\d{1,3}\])*/g, '');
}

function extractTerms(data: any): { term: string; definition: string }[] {
  return data?.terms || data?.summary_json?.terms || [];
}

/**
 * A section of the summary (redesign spec 5.3): its heading in Onest 600 22/28 and the text in a
 * reading column. No «01» numbering: a tiny monospace counter is a template tell, and the headings
 * already order the text.
 */
function SectionBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-[var(--sf-line)] py-8 first:pt-0 last:border-b-0">
      <h2 className="mb-3 text-[20px] font-semibold leading-[26px] tracking-[-0.01em] text-[var(--sf-ink)] md:text-[22px] md:leading-[28px]">{title}</h2>
      <div className="max-w-[36em] text-[16px] leading-6 text-[var(--sf-ink)] md:text-[17px] md:leading-7">
        {children}
      </div>
    </section>
  );
}

export default function SummaryView({ data, sources = [] }: { data: SummaryInfo; sources?: { id: string; text: string }[] }) {
  const content = extractCleanContent(data);
  const terms = extractTerms(data);

  if (!content && terms.length === 0) {
    return <p className="text-[var(--sf-muted)]">Нет данных для отображения</p>;
  }

  // Разбиваем по заголовкам уровня 2 (## Название)
  const sections = content ? content.split(/(?=^## )/gm).filter(Boolean) : [];

  return (
    <div>
      {/* Fragments of the whole summary (it keeps no per-section links): only when there are some. */}
      {data?.source_ids?.length ? (
        <div className="mb-4">
          <SourceReferences ids={data.source_ids} sources={sources} />
        </div>
      ) : null}
      <div>
      {sections.map((sec: string, i: number) => {
        const match = sec.match(/^## (.+)/);
        if (!match) {
          // Первый блок без заголовка — обычный абзац
          return (
            <div key={i} className="markdown-content mb-6 max-w-[36em] text-[16px] leading-6 text-[var(--sf-ink)] md:text-[17px] md:leading-7">
              <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{sec.trim()}</ReactMarkdown>
            </div>
          );
        }
        const title = match[1].trim();
        const body = sec.replace(/^## .+\n?/, '').trim();
        const cleanTitle = title.replace(/[📌🔑📖📚💡🏁🗂️]/g, '').trim();
        return (
          <SectionBlock key={i} title={cleanTitle}>
            <div className="markdown-content">
              <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{body}</ReactMarkdown>
            </div>
          </SectionBlock>
        );
      })}
      </div>

      {/* Словарь терминов */}
      {terms.length > 0 && (
        <section className="mt-8 border-t border-[var(--sf-line)] pt-7">
          <div className="mb-4 flex items-baseline justify-between gap-4">
            <h2 className="text-[20px] font-semibold leading-[26px] text-[var(--sf-ink)] md:text-[22px] md:leading-[28px]">Термины</h2>
            <span className="text-[15px] tabular-nums text-[var(--sf-muted)]">{terms.length}</span>
          </div>
          <dl className="divide-y divide-[var(--sf-line)] border-y border-[var(--sf-line)]">
            {terms.map((t: any, i: number) => (
              <div key={i} className="grid gap-1 py-4 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-6">
                <dt className="text-[16px] font-semibold leading-6 text-[var(--sf-ink)]">{t.term}</dt>
                <dd className="text-[16px] leading-6 text-[var(--sf-muted)]">
                  {t.definition}
                  <SourceReferences ids={t.source_ids} sources={sources} compact />
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </div>
  );
}
