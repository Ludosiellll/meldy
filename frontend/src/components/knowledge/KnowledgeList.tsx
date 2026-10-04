import { memo } from 'react';
import { seedFrom } from '../marks';
import { cardNoteWords, count, inLectures, questionWords, CONCEPTS } from './copy';
import { conceptNode, lectureNode, normalizeQuery, type MapConcept, type MapLecture, type MapView, type NodeId } from './model';
import { NumberMark } from './NumberMark';

/**
 * The map as lists: lectures (with their exam questions and marks, concepts and notes), then the
 * concepts the map shows (where each appears). The same choices open the same panel. This is the
 * phone's first view and the screen reader's version of the map.
 */
interface ListProps {
  view: MapView;
  selected: NodeId | null;
  query: string;
  onSelect: (node: NodeId) => void;
  registerNode: (node: NodeId, element: HTMLButtonElement | null) => void;
}

const LectureRow = memo(function LectureRow({
  lecture,
  view,
  selected,
  onSelect,
  registerNode,
}: {
  lecture: MapLecture;
  view: MapView;
  selected: boolean;
  onSelect: (node: NodeId) => void;
  registerNode: ListProps['registerNode'];
}) {
  const node = lectureNode(lecture.id);
  const shared = lecture.conceptKeys.filter((key) => (view.conceptByKey.get(key)?.lectureIds.length ?? 0) > 1).length;
  const concepts = lecture.conceptKeys.length
    ? `${count(lecture.conceptKeys.length, CONCEPTS)}${shared ? `, общих — ${shared}` : ''}`
    : '';
  const notes = cardNoteWords(lecture);
  return (
    <li className="km-row" data-selected={selected ? '' : undefined}>
      <button type="button" className="km-row-btn" aria-pressed={selected} onClick={() => onSelect(node)} ref={(element) => registerNode(`list:${node}`, element)}>
        <span className="km-row-n" aria-hidden="true">
          {lecture.number}
        </span>
        <span className="km-row-main">
          <span className="km-row-title">{lecture.title}</span>
          {lecture.questions.length > 0 ? (
            <span className="km-row-qs">
              <span className="km-row-ql">{lecture.questions.length === 1 ? 'вопрос' : 'вопросы'}</span>
              {lecture.questions.map((question) => (
                <NumberMark key={question.id} number={question.number} readiness={question.readiness} seed={seedFrom('km-q', question.examId, question.position)} />
              ))}
              <span className="km-sr">{lecture.questions.map(questionWords).join(', ')}</span>
            </span>
          ) : null}
          {concepts || notes ? <span className="km-row-meta">{[concepts, notes].filter(Boolean).join(' · ')}</span> : null}
        </span>
      </button>
    </li>
  );
});

const ConceptRow = memo(function ConceptRow({
  concept,
  view,
  selected,
  onSelect,
  registerNode,
}: {
  concept: MapConcept;
  view: MapView;
  selected: boolean;
  onSelect: (node: NodeId) => void;
  registerNode: ListProps['registerNode'];
}) {
  const node = conceptNode(concept.key);
  const lectures = concept.lectureIds.map((id) => view.lectureById.get(id)?.title).filter(Boolean) as string[];
  const where = concept.lectureIds.length > 1 ? `${inLectures(concept.lectureIds.length)}: ${lectures.join(', ')}` : `в лекции «${lectures[0] ?? ''}»`;
  return (
    <li className="km-row" data-selected={selected ? '' : undefined}>
      <button type="button" className="km-row-btn km-row-concept" aria-pressed={selected} onClick={() => onSelect(node)} ref={(element) => registerNode(`list:${node}`, element)}>
        <span className="km-row-main">
          <span className="km-row-title">{concept.label}</span>
          <span className="km-row-meta">
            {where}
            {concept.weak ? ' · есть открытая ошибка' : ''}
          </span>
        </span>
      </button>
    </li>
  );
});

export default function KnowledgeList({ view, selected, query, onSelect, registerNode }: ListProps) {
  const needle = normalizeQuery(query);
  const matches = (text: string) => !needle || normalizeQuery(text).includes(needle);
  const shared = view.concepts.filter((concept) => concept.lectureIds.length > 1 && matches(concept.label));
  const single = view.concepts.filter((concept) => concept.lectureIds.length <= 1 && matches(concept.label));
  const groups = view.groups
    .map((group) => ({ group, lectures: group.lectureIds.map((id) => view.lectureById.get(id)!).filter((lecture) => lecture && matches(lecture.title)) }))
    .filter((item) => item.lectures.length > 0);
  const nothing = groups.length === 0 && shared.length === 0 && single.length === 0;
  return (
    <div className="km-list">
      {nothing ? (
        <p className="km-quiet" role="status">
          Ничего не найдено.
        </p>
      ) : null}
      {groups.length > 0 ? (
        <section aria-label="Лекции">
          <h2 className="km-list-h">Лекции</h2>
          {groups.map(({ group, lectures }) => (
            <div key={group.id}>
              {view.groups.length > 1 ? <h3 className="km-list-sub">{group.label}</h3> : null}
              <ol className="km-rows">
                {lectures.map((lecture) => (
                  <LectureRow
                    key={lecture.id}
                    lecture={lecture}
                    view={view}
                    selected={selected === lectureNode(lecture.id)}
                    onSelect={onSelect}
                    registerNode={registerNode}
                  />
                ))}
              </ol>
            </div>
          ))}
        </section>
      ) : null}
      {shared.length > 0 ? (
        <section aria-label="Общие понятия">
          <h2 className="km-list-h">Общие понятия</h2>
          <ul className="km-rows">
            {shared.map((concept) => (
              <ConceptRow key={concept.key} concept={concept} view={view} selected={selected === conceptNode(concept.key)} onSelect={onSelect} registerNode={registerNode} />
            ))}
          </ul>
        </section>
      ) : null}
      {single.length > 0 ? (
        <section aria-label="Понятия одной лекции">
          <h2 className="km-list-h">{shared.length > 0 ? 'Понятия одной лекции' : 'Понятия'}</h2>
          <ul className="km-rows">
            {single.map((concept) => (
              <ConceptRow key={concept.key} concept={concept} view={view} selected={selected === conceptNode(concept.key)} onSelect={onSelect} registerNode={registerNode} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
