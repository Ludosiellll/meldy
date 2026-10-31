import { lazy, Suspense } from 'react';

/**
 * Words of a question with its formulas (release 48, spec «Формулы $…$»): a stem, an option, a right item, an
 * explanation. A text without «$» is the text itself; with one, the конспект's MathText draws it (KaTeX: a $ opens a
 * formula only before a non-space and closes it after a non-space, not before a digit — «цена 5$ и 10$» stays text).
 * KaTeX loads only when a text has a formula, so a test without formulas costs nothing more.
 */
const MathText = lazy(() => import('../summary/MathText'));

/** Whether the text may hold a formula ($ before a non-space). */
export const mayHaveMath = (text: string) => /\$[^\s$]/.test(text);

export default function QText({ text }: { text: string }) {
  if (!mayHaveMath(text)) return <>{text}</>;
  return (
    <Suspense fallback={<>{text}</>}>
      <MathText text={text} />
    </Suspense>
  );
}
