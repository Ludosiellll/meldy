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

  // Обрезаем JSON-хвост с terms/терминами, если он приклеился к концу
  const jsonTailIdx = raw.search(/\s*[,"]?\s*"terms"\s*:/);
  if (jsonTailIdx > 0) raw = raw.slice(0, jsonTailIdx);

  return raw.trim();
}

function extractTerms(data: any): { term: string; definition: string }[] {
  return data?.terms || data?.summary_json?.terms || [];
}

function SectionBlock({ index, title, children }: { index: number; title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-2 border-b border-slate-200 py-6 first:pt-0 last:border-b-0 dark:border-slate-800 sm:grid-cols-[2.5rem_minmax(0,1fr)] sm:gap-4">
      <span className="pt-1 font-mono text-[11px] font-medium tabular-nums tracking-wider text-slate-400 dark:text-slate-500" aria-hidden="true">
        {String(index + 1).padStart(2, '0')}
      </span>
      <div className="min-w-0">
        <h2 className="mb-3 text-lg font-semibold leading-snug tracking-[-0.01em] text-slate-950 dark:text-slate-50 md:text-xl">{title}</h2>
        <div className="text-[15px] leading-7 text-slate-700 dark:text-slate-300 md:text-base">
          {children}
        </div>
      </div>
    </section>
  );
}

export default function SummaryView({ data, sources = [] }: { data: SummaryInfo; sources?: { id: string; text: string }[] }) {
  const content = extractCleanContent(data);
  const terms = extractTerms(data);

  if (!content && terms.length === 0) {
    return <p className="text-slate-400">Нет данных для отображения</p>;
  }

  // Разбиваем по заголовкам уровня 2 (## Название)
  const sections = content ? content.split(/(?=^## )/gm).filter(Boolean) : [];

  return (
    <div>
      <div className="mb-6">
        <SourceReferences ids={data?.source_ids} sources={sources} />
      </div>
      {sections.map((sec: string, i: number) => {
        const match = sec.match(/^## (.+)/);
        if (!match) {
          // Первый блок без заголовка — обычный абзац
          return (
            <div key={i} className="markdown-content mb-6 max-w-[70ch] text-[15px] leading-7 text-slate-700 dark:text-slate-300 md:text-base">
              <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{sec.trim()}</ReactMarkdown>
            </div>
          );
        }
        const title = match[1].trim();
        const body = sec.replace(/^## .+\n?/, '').trim();
        const cleanTitle = title.replace(/[📌🔑📖📚💡🏁🗂️]/g, '').trim();
        const headingIndex = sections
          .slice(0, i + 1)
          .filter(section => /^## /m.test(section)).length - 1;

        return (
          <SectionBlock key={i} index={headingIndex} title={cleanTitle}>
            <div className="markdown-content">
              <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{body}</ReactMarkdown>
            </div>
          </SectionBlock>
        );
      })}

      {/* Словарь терминов */}
      {terms.length > 0 && (
        <section className="mt-8 border-t border-slate-300 pt-7 dark:border-slate-700">
          <div className="mb-4 flex items-baseline justify-between gap-4">
            <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-50">Термины</h2>
            <span className="text-xs tabular-nums text-slate-400">{terms.length}</span>
          </div>
          <dl className="divide-y divide-slate-200 border-y border-slate-200 dark:divide-slate-800 dark:border-slate-800">
            {terms.map((t: any, i: number) => (
              <div key={i} className="grid gap-1 py-4 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-6">
                <dt className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t.term}</dt>
                <dd className="text-sm leading-6 text-slate-600 dark:text-slate-400">
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
