import type { TestItem } from '../../types/container';

/**
 * A key «Подобрать ключи с ИИ» suggested (owner, 2026-11-04): the flag ai_key, saved with the question, and the key not
 * changed since (rev 1: a change of the key raises rev, test_items_guard). container_item_update does not write flags, so
 * a key the author changed keeps the flag in the row; rev tells it is the author's key now. (Not in types/container.ts:
 * that file is copied into the bot's plan, which shows no keys.)
 */
export const aiKeyShown = (item: Pick<TestItem, 'flags' | 'rev'>) => (item.flags ?? []).includes('ai_key') && item.rev === 1;
