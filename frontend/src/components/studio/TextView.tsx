import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { fromText, TEXT_SYNTAX, toText, type TextResult } from '../../lib/studio/textFormat';
import type { TestItem } from '../../types/container';
import { errorText } from '../containers/copyImport';
import { STUDIO } from './copyStudio';
import StudioPasteNote from '../quick/StudioPasteNote';
import { questionParagraphs } from '../quick/studioPaste';
import type { Studio } from './useStudio';

/**
 * «Текст» (spec §47.6 «весь тест текстом с разметкой»): the page as text (lib/studio/textFormat toText) in a plain
 * field, the marks beside it, and «Применить»: fromText reads it back — problems are listed by line (a press puts the
 * cursor on that line) and nothing changes until there are none; questions the text left out are deleted only after
 * «Удалить и применить». New questions are added (container_items_add), changed ones saved (container_item_update).
 * While the text holds changes not applied, the canvas's changes do not overwrite it.
 */
export default function TextView({ studio, items, start }: { studio: Studio; items: readonly TestItem[]; start?: string | null }) {
  const id = useId();
  const base = useMemo(() => toText(studio.doc, items), [studio.doc, items]);
  const [text, setText] = useState(() => start ?? base);
  const [held, setHeld] = useState(Boolean(start));
  const [checked, setChecked] = useState<TextResult | null>(null);
  const [confirm, setConfirm] = useState<TextResult | null>(null);
  const [status, setStatus] = useState<{ text: string; bad: boolean } | null>(null);
  const [working, setWorking] = useState(false);
  /** Paragraphs about to be added that read like questions from Word (UX audit of 21.10): asked before applying. */
  const [rescue, setRescue] = useState<string[] | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  // The canvas changed (Ctrl+Z, another view): the text follows while it holds nothing of its own.
  useEffect(() => {
    if (!held) setText(base);
  }, [base, held]);

  const run = async (result: TextResult) => {
    setConfirm(null);
    setWorking(true);
    setStatus({ text: STUDIO.textApplying, bad: false });
    try {
      await studio.applyText(result);
      setHeld(false);
      setChecked(null);
      setStatus({ text: STUDIO.textApplied, bad: false });
    } catch (error) {
      setStatus({ text: errorText(error), bad: true });
    } finally {
      setWorking(false);
    }
  };

  /** `ask` false: no question about Word paragraphs (they were made questions, or kept as text on purpose). */
  const apply = (value: string = text, ask = true) => {
    const result = fromText(value, studio.doc, items);
    setChecked(result);
    setStatus(null);
    setRescue(null);
    if (result.problems.length > 0) return;
    const paragraphs = ask ? questionParagraphs(studio.doc, result.doc) : [];
    if (paragraphs.length > 0) {
      setRescue(paragraphs);
      return;
    }
    const nothing = result.doc === studio.doc && result.adds.length === 0 && result.updates.length === 0 && result.removes.length === 0;
    if (nothing) {
      setHeld(false);
      setStatus({ text: STUDIO.textNothing, bad: false });
      return;
    }
    if (result.removes.length > 0) {
      setConfirm(result);
      return;
    }
    void run(result);
  };

  const goToLine = (line: number) => {
    const area = areaRef.current;
    if (!area) return;
    const lines = area.value.split('\n');
    let start = 0;
    for (let at = 0; at < line - 1 && at < lines.length; at += 1) start += lines[at].length + 1;
    const end = start + (lines[line - 1]?.length ?? 0);
    area.focus();
    area.setSelectionRange(start, end);
    const lineHeight = parseFloat(getComputedStyle(area).lineHeight) || 24;
    area.scrollTop = Math.max(0, (line - 4) * lineHeight);
  };

  const problems = checked?.problems ?? [];

  return (
    <div className="st-textview">
      <div className="st-text-main">
        <label className="sr-only" htmlFor={id}>
          {STUDIO.textLabel}
        </label>
        <textarea
          ref={areaRef}
          id={id}
          className="st-text-area"
          value={text}
          spellCheck={false}
          aria-describedby={`${id}-lead`}
          aria-invalid={problems.length > 0 || undefined}
          onChange={(event) => {
            setText(event.target.value);
            setHeld(true);
            setStatus(null);
            setRescue(null);
            if (checked) setChecked(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              apply();
            }
          }}
        />
      </div>
      <aside className="st-text-side">
        <p className="st-lead" id={`${id}-lead`}>
          {STUDIO.textLead}
        </p>
        <div className="st-text-acts">
          <button type="button" className="sf-primary st-apply" disabled={working} aria-busy={working || undefined} onClick={() => apply()}>
            {STUDIO.textApply}
          </button>
          {held ? (
            <button
              type="button"
              className="sf-link"
              data-muted=""
              onClick={() => {
                setHeld(false);
                setText(base);
                setChecked(null);
                setConfirm(null);
                setStatus(null);
                setRescue(null);
              }}
            >
              {STUDIO.textReset}
            </button>
          ) : null}
        </div>
        {rescue ? (
          <StudioPasteNote
            text={text}
            paragraphs={rescue}
            onKeep={() => apply(text, false)}
            onMade={(next) => {
              // Questions without a marked answer are listed by the text's own problems («отметьте его «+»»).
              setText(next);
              setHeld(true);
              apply(next, false);
            }}
          />
        ) : null}
        {confirm ? (
          <div className="st-confirm st-text-confirm" role="alertdialog" aria-label={STUDIO.textRemoves(confirm.removes.length)}>
            <p>{STUDIO.textRemoves(confirm.removes.length)}</p>
            <p className="st-confirm-acts">
              <button type="button" className="st-confirm-yes" autoFocus onClick={() => void run(confirm)}>
                {STUDIO.textRemovesYes}
              </button>
              <button type="button" className="sf-link" data-muted="" onClick={() => setConfirm(null)}>
                {STUDIO.textRemovesNo}
              </button>
            </p>
          </div>
        ) : null}
        {status ? (
          <p className="st-note" data-bad={status.bad ? '' : undefined} role="status">
            {status.text}
          </p>
        ) : null}
        {problems.length > 0 ? (
          <div className="st-text-problems" role="alert">
            <p className="st-text-problems-h">{STUDIO.textProblems(problems.length)}</p>
            <ul>
              {problems.map((problem, at) => (
                <li key={at}>
                  <button type="button" className="st-text-problem" onClick={() => goToLine(problem.line)}>
                    {problem.message}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="st-syntax">
          <p className="st-field-label">{STUDIO.textSyntax}</p>
          <dl>
            {TEXT_SYNTAX.map((entry) => (
              <div key={entry.mark} className="st-syntax-row">
                <dt>
                  <code>{entry.mark.trim()}</code>
                </dt>
                <dd>{entry.words}</dd>
              </div>
            ))}
          </dl>
        </div>
      </aside>
    </div>
  );
}
