import { useMemo, useState } from 'react';
import PaperSelect from '../ui/PaperSelect';
import { dayText } from '../../lib/containers/words';
import { Sheet } from './ui';
import * as copy from './copy';

/**
 * «Как на экзамене»: the setup (decision 53 — one line of text): «Вопросов [40 ▾] Минут [40 ▾]», «Ответы можно менять до
 * «Завершить»; итог покажем после.», the last try's result («Прошлая попытка 15 октября: 31 из 40.») and «Начать».
 * A minute a question by default, as the teacher critique measured; «без времени» is there too.
 */
const COUNTS = [10, 20, 30, 40, 50, 60, 80, 100];
const MINUTES = [10, 15, 20, 30, 40, 45, 60, 80, 90, 120];

export function mockCounts(keyed: number): number[] {
  const fit = COUNTS.filter((n) => n <= keyed);
  if (keyed > 0 && (fit.length === 0 || fit[fit.length - 1] !== keyed) && keyed < 100) fit.push(keyed);
  return Array.from(new Set(fit)).sort((a, b) => a - b);
}

export function defaultCount(keyed: number): number {
  const counts = mockCounts(keyed);
  return counts.includes(40) ? 40 : counts[counts.length - 1] ?? 0;
}

function defaultMinutes(count: number): number {
  return MINUTES.find((m) => m >= count) ?? MINUTES[MINUTES.length - 1];
}

export interface MockRunSummary {
  local_date: string;
  items: number;
  correct: number;
}

export default function MockSetup({ keyed, last, onClose, onStart }: { keyed: number; last: MockRunSummary | null; onClose: () => void; onStart: (count: number, minutes: number) => void }) {
  const counts = useMemo(() => mockCounts(keyed), [keyed]);
  const [count, setCount] = useState(() => defaultCount(keyed));
  const [minutes, setMinutes] = useState(() => defaultMinutes(defaultCount(keyed)));
  // «без времени» is 0: it is the last choice, never a number of its own at the top of the list.
  const minuteOptions = useMemo(
    () => [
      ...Array.from(new Set(minutes > 0 ? [...MINUTES, minutes] : MINUTES))
        .sort((a, b) => a - b)
        .map((m) => ({ value: m, label: String(m) })),
      { value: 0, label: copy.MOCK_NO_LIMIT },
    ],
    [minutes],
  );
  return (
    <Sheet
      title={copy.MOCK_TITLE}
      onClose={onClose}
      actions={
        count > 0 ? (
          <button type="button" className="sf-primary" onClick={() => onStart(count, minutes)}>
            {copy.MOCK_START}
          </button>
        ) : undefined
      }
    >
      {count > 0 ? (
        <>
          <div className="ct-selects">
            <div className="ct-select">
              <span aria-hidden="true">{copy.MOCK_COUNT}</span>
              <PaperSelect
                value={count}
                ariaLabel={copy.MOCK_COUNT}
                options={counts.map((n) => ({ value: n, label: String(n) }))}
                onChange={(value) => {
                  setCount(value);
                  setMinutes(defaultMinutes(value));
                }}
              />
            </div>
            <div className="ct-select">
              <span aria-hidden="true">{copy.MOCK_MINUTES}</span>
              <PaperSelect value={minutes} ariaLabel={copy.MOCK_MINUTES} options={minuteOptions} onChange={setMinutes} />
            </div>
          </div>
          <p>{copy.MOCK_RULE}</p>
          {last ? <p data-muted="">{copy.mockLast(dayText(last.local_date), last.correct, last.items)}</p> : null}
        </>
      ) : (
        <p>{copy.MOCK_EMPTY}</p>
      )}
    </Sheet>
  );
}
