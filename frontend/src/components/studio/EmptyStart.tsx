import { ACCENTS } from '../../lib/studio/contrast';
import { TEMPLATES, type TemplateId } from '../../lib/studio/templates';
import { PORT } from '../port/copyPort';
import { STUDIO, type QuestionType } from './copyStudio';
import { QuestionIcon } from './icons';
import { FIRST_KINDS as QUESTION_KINDS } from './Palette';

/**
 * An empty test on the canvas (spec §47.6 «пустой тест — начать с шаблона или вставить готовый»): the four starters of
 * lib/studio/templates (each brings its page, theme, result screen and sample questions), «Вставить готовый тест»
 * (the text view with a short example of its marks), and the four kinds of question to start from one.
 */

/** Each starter's look on its card, from its own theme (templates.ts). */
const LOOKS: Record<TemplateId, { tone: string; lines: number }> = {
  topic_check: { tone: ACCENTS.blue.light.fill, lines: 4 },
  quiz: { tone: ACCENTS.orange.light.fill, lines: 2 },
  entry: { tone: ACCENTS.green.light.fill, lines: 3 },
  self_check: { tone: ACCENTS.violet.light.fill, lines: 3 },
};

export default function EmptyStart({
  busy,
  onTemplate,
  onPaste,
  onQuestion,
  onGenerate,
}: {
  busy: boolean;
  onTemplate: (id: TemplateId) => void;
  onPaste: () => void;
  onQuestion: (type: QuestionType) => void;
  /** Release 49: questions from a lecture, a text or a file. */
  onGenerate?: () => void;
}) {
  return (
    <div className="st-start" aria-busy={busy || undefined}>
      <h2 className="st-start-h">{STUDIO.emptyTitle}</h2>
      <p className="st-start-lead">{STUDIO.emptyLead}</p>
      <ul className="st-templates">
        {TEMPLATES.map((template) => (
          <li key={template.id}>
            <button type="button" className="st-template" disabled={busy} onClick={() => onTemplate(template.id)} style={{ ['--st-tone' as string]: LOOKS[template.id].tone }}>
              <span className="st-template-pic" data-id={template.id} aria-hidden="true">
                <span className="st-template-sheet">
                  {Array.from({ length: LOOKS[template.id].lines }, (_, at) => (
                    <span key={at} className="st-template-line" />
                  ))}
                </span>
              </span>
              <span className="st-template-title">{template.title}</span>
              <span className="st-template-lead">{template.lead}</span>
              <span className="st-template-n">{STUDIO.templateQuestions(template.questions)}</span>
            </button>
          </li>
        ))}
      </ul>
      {busy ? (
        <p className="st-start-busy" role="status">
          {STUDIO.templating}
        </p>
      ) : null}
      <div className="st-start-paste">
        <button type="button" className="st-pill" disabled={busy} onClick={onPaste}>
          {STUDIO.pasteTest}
        </button>
        <span>{STUDIO.pasteLead}</span>
      </div>
      {onGenerate ? (
        <div className="st-start-paste">
          <button type="button" className="st-pill" disabled={busy} onClick={onGenerate}>
            {PORT.generateOpen}
          </button>
          <span>{PORT.generateLead}</span>
        </div>
      ) : null}
      <p className="st-start-or">{STUDIO.orFirst}</p>
      <div className="st-start-types">
        {QUESTION_KINDS.map((type) => (
          <button key={type} type="button" className="st-type" disabled={busy} onClick={() => onQuestion(type)}>
            <QuestionIcon type={type} />
            <span>{STUDIO.qtypes[type]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
