import type { ReactNode } from 'react';
import { ProtocolResult, type ProtocolFollowup, type ProtocolPoint } from '../oral/OralProtocol';
import { glue } from '../../lib/oral/format';
import type { TryCheckSummary } from './tryCheck';

/**
 * The example's small line under the result: how this answer was checked and how the guest's own exam is.
 * On a phone the result comes before the protocol, so the line says it itself.
 */
export const EXAMPLE_GRADE_NOTE_AI = 'Ответ в примере проверил ИИ. В вашем экзамене он так же проверит ответ по пунктам из ваших лекций.';
/** Checked by key words: the AI check was not there, or yesterday's answers of the example. */
export const EXAMPLE_GRADE_NOTE = 'Ответ в примере проверен по ключевым словам. В вашем экзамене его проверяет ИИ по пунктам из ваших лекций.';
/** «Не знаю» as the whole answer: nothing was checked. */
export const EXAMPLE_GRADE_NOTE_PLAIN = 'В вашем экзамене ответ проверяет ИИ по пунктам из ваших лекций.';

function gradeNote(checked: TryCheckSummary | null | undefined): string {
  if (checked?.by === 'ai') return EXAMPLE_GRADE_NOTE_AI;
  if (checked?.by === 'dont_know') return EXAMPLE_GRADE_NOTE_PLAIN;
  return EXAMPLE_GRADE_NOTE;
}

/**
 * The scale line of the protocol (OralProtocol.SCALE_NOTE) in the example's words: the lectures of the
 * example are not the guest's own.
 */
export const EXAMPLE_SCALE_NOTE = 'Отметку ставит преподаватель по 10-балльной шкале. Meldy проверяет только, назвали ли вы пункты из лекций.';

/**
 * The result on the example's desk: the real protocol's result card (OralProtocol.ProtocolResult) —
 * «Назвали сами …», the counts in a sentence, «Как считается» — with the example's own two small lines.
 * The protocol says why when the key words checked the answer (ProtocolSheet checkNote, tryCheck.checkLine).
 */
export default function ExampleGrade({
  points,
  followup,
  checked,
  children,
}: {
  points: ReadonlyArray<Pick<ProtocolPoint, 'id' | 'essential' | 'status'>>;
  followup: Pick<ProtocolFollowup, 'pointId' | 'status'> | null;
  /** How the answer was checked; key words when not known. */
  checked?: TryCheckSummary | null;
  children?: ReactNode;
}) {
  return (
    <ProtocolResult
      points={points}
      followup={followup}
      fine={
        <>
          {/* glue: on a phone the note's lines ended in «по» and «В». */}
          <p className="or-grade-fine tx-grade-note">{glue(gradeNote(checked))}</p>
          <p className="or-grade-fine">{glue(EXAMPLE_SCALE_NOTE)}</p>
        </>
      }
    >
      {children}
    </ProtocolResult>
  );
}
