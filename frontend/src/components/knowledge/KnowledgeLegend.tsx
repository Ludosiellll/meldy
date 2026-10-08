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
 */
export const LEGEND_SAMPLE = '№';
interface LegendProps {
  view: MapView;
  highlight: Highlight | null;
  onToggle: (highlight: Highlight) => void;
}

export default function KnowledgeLegend({ view, highlight, onToggle }: LegendProps) {
  const active = highlightKey(highlight);
  const { readiness, openMistakes, dueCards, weak } = view.counts;
  const onCards = READINESS_ORDER.reduce((sum, value) => sum + readiness[value], 0);
  const items: Array<{ key: string; highlight: Highlight; mark: JSX.Element | null; word: string; count: number }> = [];
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
  return (
    <ul className="km-legend" aria-label="Показать на карте">
      {items.map((item) => (
        <li key={item.key}>
          <button type="button" aria-pressed={active === item.key} onClick={() => onToggle(item.highlight)}>
            {item.mark ? (
              <span className="km-legend-mark" aria-hidden="true">
                {item.mark}
              </span>
            ) : null}
            <span className="km-legend-word">{item.word}</span> <span className="km-count">{item.count}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
