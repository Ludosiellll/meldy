import { useId } from 'react';
import type { PortItem } from '../../api/testPort';
import { PORT } from './copyPort';

const LETTERS = ['А', 'Б', 'В', 'Г', 'Д', 'Е', 'Ж', 'З'];

/**
 * Questions made from a lecture, a text or a file, each with a box to take it: the right option marked, the sentence
 * of the text behind the key, and whether the key checked against it («Ответ сверен с фразой») or the sentence fits
 * another option as well («Проверьте ответ…», not ticked at first).
 */
export default function PortList({ items, picked, onPick }: { items: readonly PortItem[]; picked: ReadonlySet<number>; onPick: (index: number, on: boolean) => void }) {
  const base = useId();
  return (
    <ol className="pt-list">
      {items.map((item, index) => {
        const id = `${base}-${index}`;
        return (
          <li key={index} className="pt-q" data-doubt={item.checked ? undefined : ''}>
            <label className="pt-q-head" htmlFor={id}>
              <input id={id} type="checkbox" checked={picked.has(index)} onChange={(event) => onPick(index, event.target.checked)} />
              <span className="pt-q-stem">{item.stem}</span>
            </label>
            <ul className="pt-opts" aria-label={item.stem}>
              {item.options.map((option, at) => (
                <li key={at} className="pt-opt" data-right={item.correct.includes(at) ? '' : undefined}>
                  <span className="pt-opt-l" aria-hidden="true">
                    {LETTERS[at] ?? at + 1}
                  </span>
                  <span>{option}</span>
                  {item.correct.includes(at) ? <span className="sr-only">, {PORT.right}</span> : null}
                </li>
              ))}
            </ul>
            <blockquote className="pt-quote">{item.quote}</blockquote>
            <p className="pt-check" data-ok={item.checked ? '' : undefined}>
              {item.checked ? PORT.checked : PORT.doubt}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

/** The questions ticked at first: the checked ones. */
export function firstPicks(items: readonly PortItem[]): Set<number> {
  return new Set(items.flatMap((item, index) => (item.checked ? [index] : [])));
}
