import { useId, useState, type ReactNode } from 'react';
import { READINESS_LABELS } from '../../lib/learning/readiness';
import { highlightKey, type Highlight, type MapView } from './model';
import { NumberMark, WaveUnder } from './NumberMark';
import { READINESS_ORDER } from './copy';

/**
 * The legend above the map is also its filter (as on the exam sheet): the four readiness marks of the
 * question numbers, open mistakes and due cards, each with its count. Choosing one lights the
 * lectures (and concepts) it is about; choosing it again shows everything.
 *
 * A mark's sample is drawn on «№», not on a number: «12 подтверждено 0» read as two numbers (LIB-24),
 * and the only number of an item is its count.
 *
 * On a phone (`folded`, 10_Project/Phone_Declutter_2026-10-08) the row of pills ran past the screen's edge: the
 * legend is one quiet «Обозначения» that opens the items as a list. In the list view (`interactive` false) the
 * items only say what the marks mean, so they are words, not buttons.
 */
export const LEGEND_SAMPLE = '№';
interface LegendProps {
  view: MapView;
  highlight: Highlight | null;
  onToggle: (highlight: Highlight) => void;
  folded?: boolean;
  interactive?: boolean;
}

interface LegendItem {
  key: string;
  highlight: Highlight;
  mark: JSX.Element | null;
  word: string;
  count: number;
}

function itemContent(item: LegendItem): ReactNode {
  return (
    <>
      {item.mark ? (
        <span className="km-legend-mark" aria-hidden="true">
          {item.mark}
        </span>
      ) : null}
      <span className="km-legend-word">{item.word}</span> <span className="km-count">{item.count}</span>
    </>
  );
}

/** An item of the folded list: the mark in its column (empty for the due cards), then the words and the count as one run. */
function foldedContent(item: LegendItem): ReactNode {
  return (
    <>
      <span className="km-legend-mark" aria-hidden="true">
        {item.mark}
      </span>
      <span className="km-legend-text">
        <span className="km-legend-word">{item.word}</span> <span className="km-count">{item.count}</span>
      </span>
    </>
  );
}

export default function KnowledgeLegend({ view, highlight, onToggle, folded = false, interactive = true }: LegendProps) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const active = highlightKey(highlight);
  const { readiness, openMistakes, dueCards, weak } = view.counts;
  const onCards = READINESS_ORDER.reduce((sum, value) => sum + readiness[value], 0);
  const items: LegendItem[] = [];
  if (view.exam && onCards > 0) {
    READINESS_ORDER.forEach((value, index) => {
      items.push({
        key: `rd:${value}`,
        highlight: { kind: 'readiness', value },
        mark: <NumberMark number={LEGEND_SAMPLE} readiness={value} seed={311 + index * 2} />,
        word: READINESS_LABELS[value],
        count: readiness[value],
      });
    });
  }
  if (openMistakes > 0 || weak > 0) {
    items.push({
      key: 'mistakes',
      highlight: { kind: 'mistakes' },
      mark: (
        <span className="km-legend-wave" aria-hidden="true">
          <WaveUnder width={22} seed={417} />
        </span>
      ),
      word: 'открытые ошибки',
      count: openMistakes,
    });
  }
  if (dueCards > 0) {
    items.push({ key: 'due', highlight: { kind: 'due' }, mark: null, word: 'карточки к повторению', count: dueCards });
  }
  if (items.length === 0) return null;

  const buttons = (content: (item: LegendItem) => ReactNode) =>
    items.map((item) => (
      <li key={item.key}>
        <button type="button" aria-pressed={active === item.key} onClick={() => onToggle(item.highlight)}>
          {content(item)}
        </button>
      </li>
    ));
  if (!folded) {
    return (
      <ul className="km-legend" aria-label="Показать на карте">
        {buttons(itemContent)}
      </ul>
    );
  }
  // The chosen filter is named on the fold, so a lit map never hides why it is lit.
  const chosen = interactive ? items.find((item) => item.key === active) : undefined;
  return (
    <div className="km-legend-fold">
      <button
        type="button"
        className="sf-link km-legend-toggle"
        data-muted=""
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        {chosen ? `Обозначения: ${chosen.word}` : 'Обозначения'}
      </button>
      {open ? (
        <ul id={listId} className="km-legend" data-folded="" aria-label={interactive ? 'Показать на карте' : 'Обозначения'}>
          {interactive
            ? buttons(foldedContent)
            : items.map((item) => (
                <li key={item.key} className="km-legend-item">
                  {foldedContent(item)}
                </li>
              ))}
        </ul>
      ) : null}
    </div>
  );
}
