import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { TestDoc } from '../../types/testDoc';
import { STUDIO } from './copyStudio';
import DocView from './DocView';
import { bandFor, gradeDoc, type DocItem, type DocResultView } from './docRun';
import { UiIcon } from './icons';

/**
 * «Посмотреть как участник» (spec §47.6): the page as the participant gets it (DocView in answer mode) in a phone's
 * or a computer's frame. Answers are kept on this screen only and graded here by the author's keys; nothing is sent.
 * Escape or «Закрыть» close it; the focus comes back to the button that opened it.
 */
export default function Preview({
  doc,
  items,
  dark,
  device: first,
  percent,
  onClose,
}: {
  doc: TestDoc;
  items: ReadonlyMap<string, DocItem>;
  dark: boolean;
  device: 'phone' | 'desktop';
  /** Open on the result screen at this percent (a band of «Результат»). */
  percent?: number | null;
  onClose: () => void;
}) {
  const [device, setDevice] = useState(first);
  const [round, setRound] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLElement | null>(null);
  // A band looked at from «Результат»: the score as the page's points would give that percent.
  const max = doc.blocks.reduce((sum, block) => (block.type === 'question' && items.has(block.item_id) ? sum + block.points : sum), 0) || 10;
  const given: DocResultView | null =
    percent !== null && percent !== undefined && round === 0 ? { score: Math.round((percent * max) / 100), max, percent, band: bandFor(doc, percent) } : null;

  // The page under it does not scroll with it: the preview keeps its scrolling to itself (studio.css .st-preview), the
  // window's own overflow is left alone (setting it laid the whole studio out again at each open and close: the
  // smoothness audit of 20.10).
  useEffect(() => {
    back.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    boxRef.current?.focus({ preventScroll: true });
    return () => {
      back.current?.focus?.({ preventScroll: true });
    };
  }, []);

  return createPortal(
    <div
      ref={boxRef}
      className="st-preview"
      role="dialog"
      aria-modal="true"
      aria-labelledby="st-preview-title"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="st-preview-bar">
        <div className="st-preview-words">
          <h2 id="st-preview-title" className="st-preview-title">
            {STUDIO.previewTitle}
          </h2>
          <p className="st-preview-note">{STUDIO.previewNote}</p>
        </div>
        <div className="st-seg" role="group" aria-label={STUDIO.deviceLabel}>
          {(['phone', 'desktop'] as const).map((name) => (
            <button key={name} type="button" className="st-seg-btn" aria-pressed={device === name} onClick={() => setDevice(name)}>
              <UiIcon name={name} />
              <span>{STUDIO.device[name]}</span>
            </button>
          ))}
        </div>
        <button type="button" className="st-close" onClick={onClose}>
          <UiIcon name="close" />
          <span>{STUDIO.previewClose}</span>
        </button>
      </header>
      <div className="st-preview-stage" data-device={device}>
        <div className="st-frame" data-device={device}>
          <div className="st-scroll">
            <DocView
              key={round}
              mode="answer"
              doc={doc}
              items={items}
              dark={dark}
              result={given}
              onSubmit={(answers) => gradeDoc(doc, items, answers)}
              onRestart={() => setRound((n) => n + 1)}
            />
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
