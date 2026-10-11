import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { stripSourceMarkers } from './summary/sourceMarkers';
import { repairMathEscapes } from '../lib/mathEscapes';
import { displayCheatsheet } from '../utils/cheatsheetDisplay';
import { SECTION_LABELS } from '../utils/analysisSections';
import './CheatsheetSheet.css';

/**
 * The lecture's «Выжимка» (summary_json.cheatsheet) in its white card: the name and what it is for, then the text with
 * its formulas. One card on both screens that show it — the lecture page's «Выжимка» and the analysis result's tab
 * (QA 2026-10-11: the result screen had no выжимка at all) — so it reads and is named the same in both.
 */
export default function CheatsheetSheet({ text }: { text: string }) {
  return (
    <article className="xp-sheet">
      <header className="xp-sheet-head">
        <h2>{SECTION_LABELS.cheatsheet}</h2>
        <p>Главное из материала для быстрого повторения</p>
      </header>
      <div className="xp-md">
        <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
          {cheatsheetText(text)}
        </ReactMarkdown>
      </div>
    </article>
  );
}

/** The выжимка as it is shown and copied: no fragment marks, formulas repaired, no heading with its old name. */
export function cheatsheetText(text: string): string {
  return displayCheatsheet(repairMathEscapes(stripSourceMarkers(text)));
}
