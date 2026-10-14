import { useEffect, useMemo, useRef } from 'react';
import { IMPORT, QUEUE } from '../copyImport';
import { filePictures } from '../ItemPictures';
import KeyQuestion, { QueueBar, type KeyAction, type TapMode } from '../keys/KeyQuestion';
import type { BankPicture } from '../../../types/container';
import type { DraftItem, DraftSubject, ItemFix, Problem } from './importModel';

/**
 * «Проверить» on the import page (Concept 1 §3.2 and the design table I16): one question at a time, across all
 * subjects, with one line about what is wrong and the one-tap answers. Nothing here blocks saving: «Пропустить»
 * keeps the question as it is (saved without a key when it has none). The list is the one the student opened, so
 * «3 из 11» does not jump while questions are fixed.
 */

interface Props {
  subjects: DraftSubject[];
  uids: string[];
  index: number;
  onIndex: (index: number) => void;
  onFix: (uid: string, fix: ItemFix) => void;
  onDone: () => void;
  /** The files' pictures (by id), shown as the file has them. */
  pictures?: Record<string, BankPicture>;
}

interface Located {
  item: DraftItem;
  subject: DraftSubject;
}

function locate(subjects: DraftSubject[], uid: string): Located | null {
  for (const subject of subjects) {
    if (subject.removed) continue;
    const item = subject.test.find((entry) => entry.uid === uid) ?? subject.blocked.find((entry) => entry.uid === uid);
    if (item) return { item, subject };
  }
  return null;
}

function problemsOf({ item, subject }: Located): Problem[] {
  return subject.allNoKey ? item.problems.filter((problem) => problem !== 'no_key') : item.problems;
}

export function needsLook(subjects: DraftSubject[], uid: string): boolean {
  const found = locate(subjects, uid);
  return Boolean(found && problemsOf(found).length > 0);
}

interface View {
  reason: string;
  tapMode: TapMode;
  instruction: string | null;
  actions: Array<{ key: string; label: string; fix: ItemFix | null; muted?: boolean }>;
  dropped: number[];
}

function viewOf(item: DraftItem, problem: Problem): View {
  const drop = { key: 'remove', label: QUEUE.remove, fix: { removed: true } as ItemFix };
  const dropped = item.rawOptions.map((_, index) => index).filter((index) => !item.optionMap.includes(index) && item.rawOptions[index] !== '');
  const multiple = item.kind === 'multiple';
  const keyMode: TapMode = multiple ? 'keys' : 'key';
  const keyInstruction = multiple ? QUEUE.pickKeys : QUEUE.pickKey;
  switch (problem) {
    case 'image':
      return { reason: item.images && (item.images.stem.length > 0 || item.images.fileOptions.some((list) => list.length > 0)) ? QUEUE.imageMark : QUEUE.image, tapMode: 'none', instruction: null, actions: [{ key: 'image', label: QUEUE.imageOk, fix: { imageOk: true } }, drop], dropped };
    case 'no_options':
      return { reason: QUEUE.noOptions, tapMode: 'none', instruction: null, actions: [{ key: 'oral', label: QUEUE.keepOral, fix: { oral: true } }, drop], dropped };
    case 'few_options':
      return { reason: QUEUE.fewOptions, tapMode: 'none', instruction: null, actions: [{ key: 'oral', label: QUEUE.keepOral, fix: { oral: true } }, drop], dropped };
    case 'many_options':
      return { reason: QUEUE.manyOptions, tapMode: 'drop', instruction: QUEUE.pickDrop, actions: [{ key: 'oral', label: QUEUE.keepOral, fix: { oral: true } }, drop], dropped };
    case 'empty_option': {
      const empty = item.rawOptions.findIndex((option, index) => option === '' && !dropped.includes(index));
      return { reason: QUEUE.emptyOption(Math.max(0, empty)), tapMode: 'drop', instruction: QUEUE.pickDrop, actions: [drop], dropped };
    }
    case 'same_options': {
      const seen = new Map<string, number>();
      const same: number[] = [];
      item.rawOptions.forEach((option, index) => {
        const key = option.toLowerCase().replace(/\s+/g, ' ').trim();
        const first = seen.get(key);
        if (first !== undefined && option) {
          if (!same.includes(first)) same.push(first);
          same.push(index);
        } else seen.set(key, index);
      });
      return {
        reason: QUEUE.sameOptions(same.length ? same : [0, 1]),
        tapMode: 'drop',
        instruction: QUEUE.pickDrop,
        actions: [{ key: 'accept', label: QUEUE.keepAsIs, fix: { accept: true }, muted: true }, drop],
        dropped,
      };
    }
    case 'several':
      return {
        reason: QUEUE.several(item.marked),
        tapMode: 'key',
        instruction: QUEUE.pickKey,
        actions: [{ key: 'both', label: QUEUE.bothRight(item.marked.length), fix: { kind: 'multiple', correct: item.marked } }, drop],
        dropped,
      };
    case 'key_conflict':
      return { reason: QUEUE.keyConflict, tapMode: keyMode, instruction: keyInstruction, actions: [drop], dropped };
    case 'key_invalid':
      return { reason: QUEUE.keyInvalid, tapMode: keyMode, instruction: keyInstruction, actions: [drop], dropped };
    case 'key_letter':
      return { reason: QUEUE.keyLetter, tapMode: keyMode, instruction: keyInstruction, actions: [drop], dropped };
    case 'partial':
      return { reason: QUEUE.partial, tapMode: keyMode, instruction: keyInstruction, actions: [drop], dropped };
    case 'no_key':
      return { reason: QUEUE.noKey, tapMode: keyMode, instruction: multiple ? QUEUE.pickKeys : null, actions: [drop], dropped };
    case 'duplicate':
      return {
        reason: item.twin ? QUEUE.duplicate(item.twin, item.label || String(item.position)) : QUEUE.duplicateSame,
        tapMode: 'none',
        instruction: null,
        actions: [
          { key: 'one', label: QUEUE.keepOne, fix: { removed: true } },
          { key: 'both', label: QUEUE.keepBoth, fix: { keepBoth: true }, muted: true },
        ],
        dropped,
      };
    case 'too_long':
    default:
      return { reason: QUEUE.tooLong, tapMode: 'none', instruction: null, actions: [{ key: 'accept', label: QUEUE.keepAsIs, fix: { accept: true } }, drop], dropped };
  }
}

export default function ImportQueue({ subjects, uids, index, onIndex, onFix, onDone, pictures }: Props) {
  const fixedRef = useRef(new Set<string>());
  const current = index < uids.length ? locate(subjects, uids[index]) : null;
  const problems = current ? problemsOf(current) : [];

  // A question fixed (or gone) moves the queue on to the next one that still needs a look.
  useEffect(() => {
    if (index >= uids.length) return;
    if (current && problems.length > 0) return;
    if (current || !locate(subjects, uids[index])) fixedRef.current.add(uids[index]);
    let next = index + 1;
    while (next < uids.length && !needsLook(subjects, uids[next])) next += 1;
    onIndex(next);
  }, [current, problems.length, index, uids, subjects, onIndex]);

  const headingRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    headingRef.current?.scrollIntoView?.({ block: 'start' });
  }, [index]);

  const view = useMemo(() => (current && problems.length ? viewOf(current.item, problems[0]) : null), [current, problems]);

  if (index >= uids.length || !current || !view) {
    return (
      <div className="im-queue" ref={headingRef}>
        <QueueBar title={QUEUE.title} at={0} of={0} onDone={onDone} />
        <p className="im-queue-end" role="status">
          {uids.length === 0 ? QUEUE.empty : QUEUE.finished(fixedRef.current.size, uids.length)}
        </p>
        <button type="button" className="sf-primary" onClick={onDone}>
          {IMPORT.back}
        </button>
      </div>
    );
  }

  const { item, subject } = current;
  const apply = (fix: ItemFix) => {
    fixedRef.current.add(item.uid);
    onFix(item.uid, fix);
  };
  const actions: KeyAction[] = [
    ...view.actions.map((action) => ({ key: action.key, label: action.label, muted: action.muted, onClick: () => action.fix && apply(action.fix) })),
    {
      key: 'skip',
      label: QUEUE.skip,
      muted: true,
      onClick: () => {
        let next = index + 1;
        while (next < uids.length && !needsLook(subjects, uids[next])) next += 1;
        onIndex(next);
      },
    },
  ];

  return (
    <div className="im-queue" ref={headingRef}>
      <QueueBar title={QUEUE.title} at={index + 1} of={uids.length} onDone={onDone} />
      <KeyQuestion
        context={QUEUE.context(subject.title, item.label, item.topicTitle)}
        reason={view.reason}
        stem={item.text}
        code={item.code}
        options={item.rawOptions}
        kind={item.kind === 'short' ? 'short' : item.kind}
        answers={item.answers}
        current={problems[0] === 'several' ? [] : item.rawCorrect}
        marked={item.marked}
        dropped={view.dropped}
        tapMode={view.tapMode}
        instruction={view.instruction}
        onTap={(option) => {
          if (view.tapMode === 'drop') {
            const prior = item.rawOptions.map((_, at) => at).filter((at) => !item.optionMap.includes(at));
            apply({ drop: Array.from(new Set([...prior, option])) });
          } else if (view.tapMode === 'key') {
            apply({ correct: [option], kind: 'single' });
          }
        }}
        onSaveKeys={(keys) => apply({ correct: keys, kind: 'multiple' })}
        actions={actions}
        pictures={
          item.images
            ? {
                stem: filePictures(item.images.stem, pictures),
                options: item.rawOptions.map((_, at) => filePictures(item.images?.fileOptions[at], pictures)),
              }
            : null
        }
      />
    </div>
  );
}
