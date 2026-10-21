import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import 'katex/dist/katex.min.css';
import { SummaryInfo } from '../types';
import { FragmentRefs } from './summary/FragmentSlip';
import { buildSections, stemsOf, stripSourceMarkers, type RefKind, type SourceFragment } from './summary/fragmentModel';
import { repairMathEscapes } from '../lib/mathEscapes';
import { observeSize } from '../lib/observeSize';
import { MathMarkdown } from './summary/MathMarkdown';
import './summary/summary.css';

export { stripSourceMarkers };

/** From this width of the summary the list of its sections stands on the margin to the right (spec 5.3: 36em + 64 + margin). */
const MARGIN_FROM = 980;
/** The section whose top is above this line is the one being read. */
const READING_LINE = 0.38;

/** Извлекает текст конспекта, защищаясь от сырого JSON в content (метки фрагментов остаются: они — ссылки разделов). */
function extractContent(data: any): string {
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

  return typeof raw === 'string' ? raw.trim() : '';
}

interface TermItem {
  term: string;
  definition: string;
  source_ids?: string[];
}

/**
 * The glossary as it is read: a term and its definition without the fragment marks the model copied into them
 * (QA 2026-10-11: «…существованию [S01].» in a definition). The term's fragments are its source_ids.
 */
function extractTerms(data: any): TermItem[] {
  const terms = data?.terms || data?.summary_json?.terms || [];
  if (!Array.isArray(terms)) return [];
  return terms
    .filter((item: any) => item && typeof item.term === 'string')
    .map((item: any) => ({
      ...item,
      term: stripSourceMarkers(item.term).trim(),
      definition: typeof item.definition === 'string' ? stripSourceMarkers(item.definition).trim() : '',
    }));
}

/**
 * Width of the summary itself, not of the window: the summary also sits in narrower pages. It starts from the
 * window's width and takes the summary's own from the size observer (lib/observeSize), which reports it before the
 * first paint without laying the page out again; only crossing MARGIN_FROM draws the summary anew.
 */
function useWide(ref: React.RefObject<HTMLElement | null>): boolean {
  const fallback = () => (typeof window !== 'undefined' && window.innerWidth > 0 ? window.innerWidth - 80 : 0);
  const [wide, setWide] = useState(() => fallback() >= MARGIN_FROM);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    return observeSize(element, () => {
      const width = element.clientWidth > 0 ? element.clientWidth : fallback();
      setWide(width >= MARGIN_FROM);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref]);
  return wide;
}

/**
 * Why the fragments stand by a section or a term, in plain words (owner 21.10, plain-words rules): the section's own
 * marks say «ссылается»; a fragment found by shared words says so, it is not a confirmation.
 */
export function fragmentNote(kind: RefKind | null, where: { title: string | null; term?: string }): string {
  if (where.term) return `Здесь в лекции больше всего общих слов с термином «${where.term}».`;
  if (kind === 'marked') return where.title ? `Раздел «${where.title}» ссылается на это место лекции.` : 'Начало конспекта ссылается на это место лекции.';
  return `Здесь в лекции больше всего общих слов с ${where.title ? `разделом «${where.title}»` : 'началом конспекта'}.`;
}

/**
 * The summary of a lecture (redesign spec 5.3): sections in a reading column of 36em; on a wide
 * page of a longer summary the margin to the right holds the list of its sections and follows the
 * reading. «фрагмент N» under a section or a term opens the lecture fragment in the fragment panel
 * (summary/FragmentPanel.tsx, owner 21.10): on a computer from the left over the page, on a phone
 * from the bottom. Nothing opens inside the text, so no card grows and no row of terms stretches.
 *
 * `card` (the material page and the analysis result, Meldy 2026-10-04): the text stands in a white
 * card with a large radius, the margin beside it holds the list of sections as a soft card. Pages
 * that put the summary into their own box leave it off.
 */
export default function SummaryView({ data, sources = [], card = false }: { data: SummaryInfo; sources?: SourceFragment[]; card?: boolean }) {
  // Formulas of lectures analysed before 2026-10-08 lost their backslashes on the server («\text» → TAB + «ext»).
  const content = useMemo(() => repairMathEscapes(extractContent(data)), [data]);
  // The same terms on every render: what is made of them below is kept with them.
  const terms = useMemo(() => extractTerms(data), [data]);
  const sections = useMemo(() => buildSections(content, sources), [content, sources]);
  const termRefs = useMemo(() => {
    const known = new Set(sources.map((source) => source.id));
    return terms.map((term) => (Array.isArray(term.source_ids) ? term.source_ids.filter((id) => known.has(id)) : []));
  }, [terms, sources]);
  const termStems = useMemo(() => terms.map((term) => [...stemsOf(`${term.term} ${term.definition}`)]), [terms]);

  const rootRef = useRef<HTMLDivElement>(null);
  const uid = useId();
  const wide = useWide(rootRef);
  const outline = [
    ...sections.filter((section) => section.title).map((section) => ({ part: section.index, title: section.title as string })),
    ...(terms.length > 0 ? [{ part: sections.length, title: 'Термины' }] : []),
  ];
  const showOutline = outline.length >= 3;
  const margin = wide && showOutline;

  const [reading, setReading] = useState(0);

  // Which section is being read: the last one whose top has passed the reading line.
  useEffect(() => {
    if (!margin) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const nodes = rootRef.current?.querySelectorAll<HTMLElement>('[data-sv-part]');
      if (!nodes || nodes.length === 0) return;
      const line = Math.max(120, window.innerHeight * READING_LINE);
      let current = Number(nodes[0].dataset.svPart);
      nodes.forEach((node) => {
        if (node.getBoundingClientRect().top <= line) current = Number(node.dataset.svPart);
      });
      setReading((previous) => (previous === current ? previous : current));
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    document.addEventListener('scroll', schedule, { capture: true, passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      document.removeEventListener('scroll', schedule, { capture: true });
      window.removeEventListener('resize', schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [margin, sections.length, terms.length]);

  if (!content && terms.length === 0) {
    return <p className="text-[var(--sf-muted)]">Нет данных для отображения</p>;
  }

  const anchor = (part: number) => `${uid}-part-${part}`;
  const goTo = (part: number) => {
    const node = document.getElementById(anchor(part));
    if (!node) return;
    const smooth = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    node.scrollIntoView?.({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
  };

  return (
    <div ref={rootRef} className="sv-doc" data-margin={margin ? '' : undefined} data-card={card ? '' : undefined}>
      <div className="sv-text">
        {sections.map((section) => (
          <section
            key={section.index}
            id={anchor(section.index)}
            className="sv-sec"
            data-sv-part={section.index}
            data-reading={margin && reading === section.index ? '' : undefined}
          >
            {section.title && <h2 className="sv-h2">{section.title}</h2>}
            <div className="markdown-content sv-body">
              <MathMarkdown text={section.body} />
            </div>
            <FragmentRefs
              ids={section.refs}
              sources={sources}
              stems={section.stems}
              note={fragmentNote(section.refKind, { title: section.title })}
            />
          </section>
        ))}

        {terms.length > 0 && (
          <section id={anchor(sections.length)} className="sv-sec sv-terms" data-sv-part={sections.length}>
            <div className="sv-terms-head">
              <h2 className="sv-h2">Термины</h2>
              <span className="sv-terms-n">{terms.length}</span>
            </div>
            <dl className="sv-dl">
              {terms.map((term, index) => (
                <div key={`${term.term}-${index}`} className="sv-term">
                  <dt>{term.term}</dt>
                  <dd>
                    {term.definition}
                    {termRefs[index].length > 0 && (
                      <FragmentRefs
                        ids={termRefs[index]}
                        sources={sources}
                        stems={termStems[index]}
                        note={fragmentNote('near', { title: null, term: term.term })}
                        compact
                      />
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        )}
      </div>

      {margin && (
        <aside className="sv-margin" aria-label="Поле конспекта">
          <div className="sv-margin-in">
            {showOutline && (
              <nav className="sv-outline" aria-label="Разделы конспекта">
                <ol>
                  {outline.map((entry) => (
                    <li key={entry.part}>
                      <a
                        href={`#${anchor(entry.part)}`}
                        aria-current={reading === entry.part ? 'true' : undefined}
                        onClick={(event) => {
                          event.preventDefault();
                          goTo(entry.part);
                        }}
                      >
                        {entry.title}
                      </a>
                    </li>
                  ))}
                </ol>
              </nav>
            )}
          </div>
        </aside>
      )}
    </div>
  );
}
