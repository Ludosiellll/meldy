import type { TestItem } from '../../types/container';

/** The flag of a key «Подобрать ключи с ИИ» suggested (owner, 2026-11-04). */
export const AI_KEY = 'ai_key';

/**
 * A key «Подобрать ключи с ИИ» suggested: the flag ai_key in the row. The import writes it with the question;
 * «Вопросы и ключи» writes it with the key (container_item_update, ai_key true); any other change of the key takes it
 * off in the database (migration 20261107090300_ai_key_flag), and withoutAiKey does the same to a row kept on the page.
 * (Not in types/container.ts: that file is copied into the bot's plan.)
 */
export const aiKeyShown = (item: Pick<TestItem, 'flags'>) => (item.flags ?? []).includes(AI_KEY);

/** The flags after a key change that is not the AI's: as the database leaves them. */
export const withoutAiKey = (flags: readonly string[] | null | undefined) => (flags ?? []).filter((flag) => flag !== AI_KEY);
