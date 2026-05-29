import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { SummaryInfo } from '../types';

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

function SectionBlock({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg">{icon}</span>
        <h3 className="font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
      </div>
      <div className="pl-7 text-slate-700 dark:text-slate-300 text-[15px] leading-relaxed">{children}</div>
    </div>
  );
}

export default function SummaryView({ data }: { data: SummaryInfo }) {
  const content = extractCleanContent(data);
  const terms = extractTerms(data);

  if (!content && terms.length === 0) {
    return <p className="text-slate-400">Нет данных для отображения</p>;
  }

  // Разбиваем по заголовкам уровня 2 (## Название)
  const sections = content ? content.split(/(?=^## )/gm).filter(Boolean) : [];

  return (
    <div className="space-y-1">
      {sections.map((sec: string, i: number) => {
        const match = sec.match(/^## (.+)/);
        if (!match) {
          // Первый блок без заголовка — обычный абзац
          return (
            <div key={i} className="markdown-content text-slate-700 dark:text-slate-300 mb-4">
              <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{sec.trim()}</ReactMarkdown>
            </div>
          );
        }
        const title = match[1].trim();
        const body = sec.replace(/^## .+\n?/, '').trim();
        const icon =
          title.includes('📌') ? '📌' :
          title.includes('🔑') ? '🔑' :
          title.includes('📖') ? '📖' :
          title.includes('💡') ? '💡' :
          title.includes('Вывод') ? '🏁' :
          title.includes('Ключев') ? '🔑' :
          title.includes('Структур') ? '🗂️' :
          '📄';
        const cleanTitle = title.replace(/[📌🔑📖📚💡]/g, '').trim();

        return (
          <SectionBlock key={i} icon={icon} title={cleanTitle}>
            <div className="markdown-content">
              <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{body}</ReactMarkdown>
            </div>
          </SectionBlock>
        );
      })}

      {/* Словарь терминов */}
      {terms.length > 0 && (
        <div className="mt-6 pt-5 border-t border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-lg">📚</span>
            <h3 className="font-semibold text-slate-900 dark:text-slate-100">Словарь терминов</h3>
            <span className="ml-1 text-xs bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 font-bold px-2 py-0.5 rounded-full">
              {terms.length}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {terms.map((t: any, i: number) => (
              <div key={i} className="bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800/60 rounded-xl p-3">
                <p className="font-bold text-slate-900 dark:text-slate-100 text-sm mb-0.5">{t.term}</p>
                <p className="text-slate-500 dark:text-slate-400 text-xs leading-relaxed">{t.definition}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
