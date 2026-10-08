import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { SummaryInfo } from '../types';
import { FragmentRefs, FragmentSlip } from './summary/FragmentSlip';
import { buildSections, fragmentWord, stemsOf, stripSourceMarkers, type RefKind, type SourceFragment } from './summary/fragmentModel';
import { repairMathEscapes } from '../lib/mathEscapes';
import './summary/summary.css';

export { stripSourceMarkers };

/** From this width of the summary the fragments stand on the margin to the right (spec 5.3: 36em + 64 + margin). */
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

function extractTerms(data: any): TermItem[] {
  const terms = data?.terms || data?.summary_json?.terms || [];
  return Array.isArray(terms) ? terms.filter((item: any) => item && typeof item.term === 'string') : [];
}

/** Width of the summary itself, not of the window: the summary also sits in narrower pages. */
function useWide(ref: React.RefObject<HTMLElement | null>): boolean {
  const fallback = () => (typeof window !== 'undefined' && window.innerWidth > 0 ? window.innerWidth - 80 : 0);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const next = element.clientWidth > 0 ? element.clientWidth : fallback();
      setWidth((previous) => (previous === next ? previous : next));
    };
    measure();
    window.addEventListener('resize', measure);
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(measure);
      observer.observe(element);
    }
    return () => {
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref]);
  return width >= MARGIN_FROM;
}

function captionFor(id: string, kind: RefKind | null, where: { title: string | null; term?: string }): string {
  const fragment = fragmentWord(id).replace('фрагмент', 'Фрагмент');
  if (where.term) return `${fragment} лекции — ближайший по словам к термину «${where.term}»`;
  const place = where.title ? `разделу «${where.title}»` : 'началу конспекта';
  if (kind === 'marked') return `${fragment} лекции — на него ссылается ${where.title ? `раздел «${where.title}»` : 'начало конспекта'}`;
  return `${fragment} лекции — ближайший по словам к ${place}`;
}

interface MarginPick {
  /** Section index (terms = sections.length). */
  part: number;
  id: string;
  term?: string;
  /** The section being read when the fragment was chosen: reading on lets the margin follow again. */
  readingAt: number;
}

/**
 * The summary of a lecture (redesign spec 5.3): sections in a reading column of 36em; on a wide
 * page the margin to the right holds the lecture fragment of the section being read (it follows the
 * reading, a click on «фрагмент N» chooses another one) and, for a longer summary, the list of its
 * sections. On a narrow page «фрагмент N» opens the fragment under its section.
 *
 * `card` (the material page and the analysis result, Meldy 2026-10-04): the text stands in a white
 * card with a large radius, the margin beside it holds the list of sections and the fragment as soft
 * cards. Pages that put the summary into their own box leave it off.
 */
export default function SummaryView({ data, sources = [], card = false }: { data: SummaryInfo; sources?: SourceFragment[]; card?: boolean }) {
  // Formulas of lectures analysed before 2026-10-08 lost their backslashes on the server («\text» → TAB + «ext»).
  const content = repairMathEscapes(extractContent(data));
  const terms = extractTerms(data);
  const sections = useMemo(() => buildSections(content, sources), [content, sources]);
  const termRefs = useMemo(() => {
    const known = new Set(sources.map((source) => source.id));
    return terms.map((term) => (Array.isArray(term.source_ids) ? term.source_ids.filter((id) => known.has(id)) : []));
  }, [terms, sources]);
  const termStems = useMemo(() => terms.map((term) => [...stemsOf(`${term.term} ${term.definition}`)]), [terms]);

  const rootRef = useRef<HTMLDivElement>(null);
  const uid = useId();
  const wide = useWide(rootRef);
  const hasFragments = sections.some((section) => section.refs.length > 0) || termRefs.some((refs) => refs.length > 0);
  const outline = [
    ...sections.filter((section) => section.title).map((section) => ({ part: section.index, title: section.title as string })),
    ...(terms.length > 0 ? [{ part: sections.length, title: 'Термины' }] : []),
  ];
  const showOutline = outline.length >= 3;
  const margin = wide && (hasFragments || showOutline);

  const [reading, setReading] = useState(0);
  const [picked, setPicked] = useState<MarginPick | null>(null);

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

  // Reading on past the section of a chosen fragment hands the margin back to the reading.
  useEffect(() => {
    setPicked((current) => (current && current.readingAt !== reading ? null : current));
  }, [reading]);

  if (!content && terms.length === 0) {
    return <p className="text-[var(--sf-muted)]">Нет данных для отображения</p>;
  }

  const partCount = sections.length + (terms.length > 0 ? 1 : 0);
  const refsOf = (part: number): string[] => (part < sections.length ? sections[part]?.refs ?? [] : termRefs.find((refs) => refs.length > 0) ?? []);

  // The margin: the chosen fragment, or the first fragment of the section being read (or of the nearest section that has one).
  let shown: { part: number; id: string; term?: string } | null = picked;
  if (!shown) {
    for (let step = 0; step < partCount && !shown; step += 1) {
      for (const part of [reading - step, reading + step]) {
        if (part >= 0 && part < partCount && refsOf(part).length > 0) {
          const id = refsOf(part)[0];
          const term = part >= sections.length ? terms[termRefs.findIndex((refs) => refs.length > 0)]?.term : undefined;
          shown = { part, id, term };
          break;
        }
      }
    }
  }
  const shownCaption = shown
    ? shown.term
      ? captionFor(shown.id, 'near', { title: null, term: shown.term })
      : captionFor(shown.id, sections[shown.part]?.refKind ?? 'near', { title: sections[shown.part]?.title ?? null })
    : '';
  const shownStems = shown
    ? shown.term
      ? termStems[terms.findIndex((term) => term.term === shown?.term)] ?? []
      : sections[shown.part]?.stems ?? []
    : [];
  const sourceText = (id: string) => sources.find((source) => source.id === id)?.text;
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
        {hasFragments && (
          <p className="sv-origin">
            {margin ? 'Справа от разделов — фрагменты лекции, ближайшие к ним.' : 'Под разделами — фрагменты лекции, ближайшие к ним.'}
          </p>
        )}
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
              <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                {section.body}
              </ReactMarkdown>
            </div>
            <FragmentRefs
              ids={section.refs}
              sources={sources}
              stems={section.stems}
              mode={margin ? 'margin' : 'inline'}
              current={shown && shown.part === section.index ? shown.id : null}
              onPick={(id) => setPicked({ part: section.index, id, readingAt: reading })}
              captionFor={(id) => captionFor(id, section.refKind, { title: section.title })}
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
                        mode={margin ? 'margin' : 'inline'}
                        current={shown && shown.term === term.term ? shown.id : null}
                        onPick={(id) => setPicked({ part: sections.length, id, term: term.term, readingAt: reading })}
                        captionFor={(id) => captionFor(id, 'near', { title: null, term: term.term })}
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
            {shown && (
              <div className="sv-margin-slip" key={`${shown.part}:${shown.id}`}>
                <FragmentSlip
                  id={shown.id}
                  text={sourceText(shown.id)}
                  stems={shownStems}
                  caption={shownCaption}
                  onClose={picked ? () => setPicked(null) : undefined}
                />
              </div>
            )}
          </div>
        </aside>
      )}
    </div>
  );
}
