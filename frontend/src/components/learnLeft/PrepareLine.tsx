import { useEffect, useRef, useSyncExternalStore } from 'react';
import { getSheetWrite, startSheetWrite, subscribeSheetWrites } from '../../api/cheatSheet';
import { forgetLearnLeft } from '../../api/learnLeft';
import { pluralRu } from '../conversation/visuals';

/**
 * One quiet line under «Осталось выучить» (design learn-left §3): oral questions in the lectures whose answer points are
 * not prepared yet, and «Подготовить» — the existing writing job (api/cheatSheet.ts startSheetWrite), no longer a step
 * of the page. An answer is checked without them too (the points are made then); «Показать пункты» of the self-check
 * needs them. When the job ends the topics are read again.
 */
export default function PrepareLine({ examId, toWrite, units, onDone }: { examId: string; toWrite: number; units: number; onDone: () => void }) {
  const write = useSyncExternalStore(subscribeSheetWrites, () => getSheetWrite(examId));
  const ended = useRef(write.phase);
  useEffect(() => {
    const was = ended.current;
    ended.current = write.phase;
    if (was === 'running' && write.phase !== 'running') {
      forgetLearnLeft();
      onDone();
    }
  }, [write.phase, onDone]);

  const questions = `${toWrite} ${pluralRu(toWrite, ['вопроса', 'вопросов', 'вопросов'])}`;
  if (write.phase === 'running') {
    const total = write.total || toWrite;
    return (
      <p className="ll-prep" role="status">
        Готовим пункты ответа. Готово {write.done} из {total}.
      </p>
    );
  }
  const price = units > 0 ? `${units} ${pluralRu(units, ['единицу', 'единицы', 'единиц'])} ИИ` : '';
  return (
    <p className="ll-prep">
      {`У ${questions} пока нет пунктов ответа.`}{' '}
      <button type="button" className="sf-link" onClick={() => void startSheetWrite(examId)}>
        {price ? `Подготовить за ${price}` : 'Подготовить'}
      </button>
      {(write.phase === 'failed' || write.phase === 'interrupted') && write.message ? (
        <span className="ll-prep-err" role="alert">
          {' '}
          {write.message}
        </span>
      ) : null}
      {write.phase === 'done' && write.limit ? <span className="ll-prep-err"> Дневной лимит ИИ закончился. Остальные можно подготовить завтра.</span> : null}
    </p>
  );
}
