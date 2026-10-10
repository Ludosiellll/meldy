import { Link, Navigate, useParams } from 'react-router-dom';
import { useContainerData } from '../../lib/containers/hooks';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import SubjectView from '../../components/containers/SubjectView';
import { PageState, usePlan } from '../../components/containers/PageState';
import { subjectKind } from '../../components/containers/model';
import * as copy from '../../components/containers/copy';

/**
 * /exams/c/:id/s/:subjectId — a subject with variants (Concept 1 §3.4): topics as rows, «Только ошибки», «Как на
 * экзамене». An oral subject is today's oral page (decision 23), reached with ?from=c:<id> so its top line leads back.
 */
export default function SubjectPage() {
  const { id = '', subjectId = '' } = useParams();
  const state = useContainerData(id);
  const plan = usePlan(state.data?.planInput);
  const subject = state.data?.summary.subjects.find((entry) => entry.id === subjectId) ?? null;
  useDocumentTitle(subject?.title ?? state.data?.summary.title ?? 'Предмет');

  if (!state.data) return <PageState state={state} />;
  if (!subject) {
    return (
      <div className="sf-page ct-page">
        <div className="ct-error">
          <h1>{copy.SUBJECT_MISSING}</h1>
          <Link className="sf-link" to={`/exams/c/${id}`}>
            {state.data.summary.title}
          </Link>
        </div>
      </div>
    );
  }
  if (subjectKind(subject) === 'oral' && subject.oral?.exam_id) return <Navigate to={`/exams/${subject.oral.exam_id}?from=c:${id}`} replace />;
  return <SubjectView containerId={id} data={state.data} plan={plan} offline={state.offline} reload={state.reload} subject={subject} solo={false} />;
}
