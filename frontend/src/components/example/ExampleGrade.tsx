import type { ReactNode } from 'react';
import { ProtocolResult, type ProtocolFollowup, type ProtocolPoint } from '../oral/OralProtocol';
import { glue } from '../../lib/oral/format';

/** The example's one honest line under the result (the owner's brief, word for word). */
export const EXAMPLE_GRADE_NOTE =
  'В примере ответ проверяется по ключевым словам на этом устройстве. В вашем экзамене его проверяет ИИ по пунктам из ваших лекций.';

/**
 * The scale line of the protocol (OralProtocol.SCALE_NOTE) in the example's words: the lectures of the
 * example are not the guest's own.
 */
export const EXAMPLE_SCALE_NOTE = 'Отметку ставит преподаватель по 10-балльной шкале. Meldy проверяет только, назвали ли вы пункты из лекций.';

/**
 * The result on the example's desk: the real protocol's result card (OralProtocol.ProtocolResult) —
 * «Назвали сами …», the counts in a sentence, «Как считается» — with the example's own two small lines.
 */
export default function ExampleGrade({
  points,
  followup,
  children,
}: {
  points: ReadonlyArray<Pick<ProtocolPoint, 'id' | 'essential' | 'status'>>;
  followup: Pick<ProtocolFollowup, 'pointId' | 'status'> | null;
  children?: ReactNode;
}) {
  return (
    <ProtocolResult
      points={points}
      followup={followup}
      fine={
        <>
          {/* glue: on a phone the note's lines ended in «по» and «В». */}
          <p className="or-grade-fine tx-grade-note">{glue(EXAMPLE_GRADE_NOTE)}</p>
          <p className="or-grade-fine">{glue(EXAMPLE_SCALE_NOTE)}</p>
        </>
      }
    >
      {children}
    </ProtocolResult>
  );
}
