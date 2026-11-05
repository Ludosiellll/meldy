import { memo } from 'react';
import { STUDIO } from './copyStudio';
import { UiIcon } from './icons';

/**
 * The canvas's pages (owner, 2026-11-05: an exam of 960 questions — «перейти на вторую страницу»): «Холст» shows one
 * page of the test at a time (lib/studio/pages.ts), and this quiet bar over it goes back and forth and jumps to any
 * page by its number, its title and its questions. PageFoot, under the page's last block, goes on to the next page (and
 * back), so a long page read to its end does not send the author back up. Both only ask: the studio decides whether the
 * page changes at once or after the question editor's own answer (StudioPage, as for another block).
 */

export interface PageInfo {
  /** The page's own title («Новая страница»'s), or ''. */
  title: string;
  /** Its questions: how many, and the number of the first over the whole test. */
  first: number;
  count: number;
}

const optionOf = (page: PageInfo, at: number) => STUDIO.pageOption(at + 1, page.title, STUDIO.pageQuestions(page.first, page.count));

export const PageBar = memo(function PageBar({ pages, shown, onPage }: { pages: readonly PageInfo[]; shown: number; onPage: (page: number) => void }) {
  const last = pages.length - 1;
  return (
    <nav className="st-pages" aria-label={STUDIO.pagesNav}>
      <button type="button" className="st-icon-btn st-pages-step" aria-label={STUDIO.pagePrev} title={STUDIO.pagePrev} disabled={shown <= 0} onClick={() => onPage(shown - 1)}>
        <UiIcon name="back" />
      </button>
      <label className="st-pages-pick">
        <span className="st-pages-now" aria-hidden="true">
          <span className="st-pages-n">{STUDIO.pageOf(shown + 1, pages.length)}</span>
          {pages[shown]?.title ? <span className="st-pages-title">{pages[shown].title}</span> : null}
          <svg className="st-pages-caret" viewBox="0 0 12 12">
            <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <select aria-label={`${STUDIO.pageJump}. ${STUDIO.pageOf(shown + 1, pages.length)}`} value={shown} onChange={(event) => onPage(Number(event.target.value))}>
          {pages.map((page, at) => (
            <option key={at} value={at}>
              {optionOf(page, at)}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="st-icon-btn st-pages-step" data-next="" aria-label={STUDIO.pageNext} title={STUDIO.pageNext} disabled={shown >= last} onClick={() => onPage(shown + 1)}>
        <UiIcon name="back" />
      </button>
    </nav>
  );
});

/** Under the page's last block: the next page by its number and title, and the way back. */
export const PageFoot = memo(function PageFoot({ pages, shown, onPage }: { pages: readonly PageInfo[]; shown: number; onPage: (page: number) => void }) {
  const next = pages[shown + 1];
  return (
    <div className="st-pagefoot">
      {shown > 0 ? (
        <button type="button" className="st-pagefoot-btn" data-back="" onClick={() => onPage(shown - 1)}>
          <UiIcon name="back" />
          <span>{STUDIO.pageBack(shown)}</span>
        </button>
      ) : (
        <span />
      )}
      {next ? (
        <button type="button" className="st-pagefoot-btn" data-next="" onClick={() => onPage(shown + 1)}>
          <span>{STUDIO.pageOn(shown + 2, next.title)}</span>
          <UiIcon name="back" />
        </button>
      ) : null}
    </div>
  );
});

/**
 * A page of the canvas is full: the block waits for a new page («Начать новую страница» makes it after this one). Or,
 * without `onNew`, why a move or a removal did not happen (a page would pass 400 blocks).
 */
export const PageFull = memo(function PageFull({ text, toast, onNew, onClose }: { text: string; toast: boolean; onNew?: () => void; onClose: () => void }) {
  return (
    <div className={toast ? 'st-toast st-pagefull' : 'st-pagefull'} role="status">
      <p className={toast ? 'st-toast-t' : 'st-pagefull-t'}>{text}</p>
      {onNew ? (
        <button type="button" className={toast ? 'st-toast-btn' : 'sf-link st-pagefull-new'} onClick={onNew}>
          {STUDIO.pageFullNew}
        </button>
      ) : null}
      <button type="button" className="st-icon-btn st-pagefull-x" aria-label={STUDIO.pageFullClose} title={STUDIO.pageFullClose} onClick={onClose}>
        <UiIcon name="close" />
      </button>
    </div>
  );
});
