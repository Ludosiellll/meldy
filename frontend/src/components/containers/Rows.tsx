import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Chevron } from './ui';

/**
 * Rows of one card (phone rule 8): a subject of the exam or a topic of a subject, its name and one muted line of
 * numbers, the whole row a link (or a button that opens the topic's sheet).
 */
export interface RowView {
  key: string;
  title: string;
  meta: string;
  to?: string;
  onOpen?: () => void;
}

export default function Rows({ rows, label, head }: { rows: RowView[]; label: string; head?: ReactNode }) {
  if (rows.length === 0) return null;
  return (
    <>
      {head}
      <ul className="ct-rows" aria-label={label}>
        {rows.map((row) => {
          const body = (
            <>
              <span>
                <span className="ct-row-t">{row.title}</span>
                <span className="ct-row-m">{row.meta}</span>
              </span>
              <Chevron />
            </>
          );
          return (
            <li key={row.key}>
              {row.to ? (
                <Link className="ct-row" to={row.to}>
                  {body}
                </Link>
              ) : (
                <button type="button" className="ct-row" aria-haspopup="dialog" onClick={row.onOpen}>
                  {body}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
