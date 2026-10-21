import { closedRibbon, closedTopicLine, nearestLine, topicsLeftLine, type Topic } from '../../lib/containers/topics';
import './learnLeft.css';

/**
 * The end of a session when it closed a topic (design learn-left §3, mock end-1536): the ribbon «Тема выучена», the
 * topic, its bar full, then what is left of the exam and the topic closest to closing. Nothing else: the headline above
 * is the figure, the paragraph under it the session's numbers.
 */
export default function TopicClosed({ closed, left, total, near }: { closed: Topic[]; left: number; total: number; near: Topic | null }) {
  if (closed.length === 0) return null;
  const [first] = closed;
  return (
    <section className="ll-won" aria-label={closedRibbon(closed.length)}>
      <span className="ll-ribbon">{closedRibbon(closed.length)}</span>
      {closed.map((topic) => (
        <h2 key={topic.key} className="ll-won-t">
          {topic.title}
        </h2>
      ))}
      <span className="ll-segs ll-won-segs" aria-hidden="true">
        {first.questions.map((q) => (
          <i key={q.id} data-s="done" />
        ))}
      </span>
      <p className="ll-won-w1">{closedTopicLine(first)}</p>
      <p className="ll-won-w2">
        {left === 0 ? 'Все темы выучены.' : topicsLeftLine(left, total)}
        {near && left > 0 ? ` ${nearestLine(near)}` : null}
      </p>
    </section>
  );
}
