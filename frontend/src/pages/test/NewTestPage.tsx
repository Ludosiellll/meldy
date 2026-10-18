import { useId, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createContainer } from '../../api/containers';
import { rememberContainerTitle } from '../../lib/containers/titleCache';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { useFrame } from '../../components/exams/useFrame';
import { errorText } from '../../components/containers/copyImport';
import { TO_EXAMS } from '../../components/containers/copy';
import { NEW_TEST, TEST_TITLE_MAX } from '../../components/test/copyTest';
import '../../components/exams/exams.css';
import '../../components/test/build.css';

/**
 * /tests/new — «Новый тест» (spec 2026-10-18 §47.2): one field, the test's name, and «Создать». The test is an exam of
 * one subject «Вопросы» (container_create), opened in «Студия теста» (release 47.2: its empty page offers the starters);
 * this page is left out of the history, so «Назад» from the studio does not bring the empty form back.
 */
export default function NewTestPage() {
  const navigate = useNavigate();
  const frame = useFrame<HTMLDivElement>();
  useDocumentTitle(NEW_TEST.docTitle);
  const id = useId();
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const name = title.trim();
    if (!name) {
      setError(NEW_TEST.nameEmpty);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await createContainer(name.slice(0, TEST_TITLE_MAX), null, [{ title: NEW_TEST.subject }]);
      rememberContainerTitle(created.container_id, name);
      navigate(`/exams/c/${created.container_id}/studio`, { replace: true });
    } catch (failure) {
      setError(errorText(failure));
      setBusy(false);
    }
  };

  return (
    <div className="sf-page tb-page tb-new-page" ref={frame.ref} data-frame={frame.size}>
      <header className="ex-head tb-head">
        <div style={{ minWidth: 0 }}>
          <p className="ex-crumb">
            <Link to="/exams">{TO_EXAMS}</Link>
          </p>
          <h1 className="ex-h1">{NEW_TEST.title}</h1>
          <p className="ex-meta">{NEW_TEST.lede}</p>
        </div>
      </header>
      <form className="tb-new-form" onSubmit={(event) => void submit(event)} noValidate>
        <label className="tb-label" htmlFor={`${id}-title`}>
          {NEW_TEST.name}
        </label>
        <input
          id={`${id}-title`}
          className="tb-input"
          value={title}
          maxLength={TEST_TITLE_MAX}
          autoComplete="off"
          enterKeyHint="go"
          aria-invalid={error === NEW_TEST.nameEmpty || undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          disabled={busy}
          onChange={(event) => {
            setTitle(event.target.value);
            if (error) setError(null);
          }}
        />
        {title.length > TEST_TITLE_MAX - 20 ? (
          <p className="tb-count" aria-live="polite">
            {`${title.length} / ${TEST_TITLE_MAX}`}
          </p>
        ) : null}
        {error ? (
          <p id={`${id}-error`} className="tb-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="tb-new-acts">
          <button type="submit" className="sf-primary" disabled={busy} aria-busy={busy || undefined}>
            {busy ? NEW_TEST.creating : NEW_TEST.create}
          </button>
        </div>
      </form>
    </div>
  );
}
