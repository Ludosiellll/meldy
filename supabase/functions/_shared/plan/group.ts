/**
 * The group «Вопрос дня» picker for the Telegram bot (package D2; Concept 2 §3.15). Pure; stable ties.
 *
 * Input: per item (by `item_rev`, the same in every member's copy), counts across the members, aggregated by SQL —
 * no member rows reach the bot. Ranking: members who can turn it into «верно в два разных дня» today, then mistakes
 * and due checks, then not yesterday's topic, then the most members who have not seen it, then a stable FNV-1a hash
 * of (rev, day), so a retried cron tick picks the same item. Never: a blocked item (someone doubts or changed the key,
 * an image is missing, several correct options, text too long for a chat), fewer than 2 members, or an item posted
 * in the last `minGapDays` days.
 */
import type { LocalDay } from './container.ts';
import { daysBetween } from './time.ts';
import { hashSeed } from './session.ts';

export interface GroupItemCounts { rev: string; label: string; topic: number | null; members: number; confirmable: number; relearn: number; due: number; unseen: number; blocked: boolean }
export interface GroupInput { day: LocalDay; items: GroupItemCounts[]; recent: Array<{ rev: string; day: LocalDay }>; minGapDays: number }
export interface GroupPick { rev: string; label: string; reason: 'confirm' | 'relearn' | 'due' | 'new'; confirmable: number; relearn: number; due: number; members: number }

export const GROUP_MIN_MEMBERS = 2;

function compare(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

export function pickGroupQuestion(input: GroupInput): GroupPick | null {
  const lastPosted = new Map<string, LocalDay>();
  let latest: { rev: string; day: LocalDay } | null = null;
  for (const r of input.recent ?? []) {
    const prev = lastPosted.get(r.rev);
    if (prev === undefined || r.day > prev) lastPosted.set(r.rev, r.day);
    if (r.day < input.day && (latest === null || r.day > latest.day || (r.day === latest.day && r.rev > latest.rev))) latest = r;
  }
  let lastTopic: number | null = null;
  if (latest !== null) {
    const rev = latest.rev;
    const item = input.items.find((i) => i.rev === rev);
    lastTopic = item && item.topic !== null && item.topic !== undefined ? item.topic : null;
  }
  const gap = Math.max(0, Math.floor(input.minGapDays));
  let best: { item: GroupItemCounts; key: number[] } | null = null;
  for (const item of input.items ?? []) {
    if (item.blocked || item.members < GROUP_MIN_MEMBERS) continue;
    const posted = lastPosted.get(item.rev);
    if (posted !== undefined && daysBetween(posted, input.day) < gap) continue;
    const key = [
      Math.max(0, item.confirmable),
      Math.max(0, item.relearn) + Math.max(0, item.due),
      lastTopic !== null && item.topic === lastTopic ? 0 : 1,
      Math.max(0, item.unseen),
      hashSeed(`${item.rev}:${input.day}`),
    ];
    if (best === null || compare(key, best.key) > 0 || (compare(key, best.key) === 0 && item.rev < best.item.rev)) best = { item, key };
  }
  if (best === null) return null;
  const it = best.item;
  const reason: GroupPick['reason'] = it.confirmable > 0 ? 'confirm' : it.relearn > 0 ? 'relearn' : it.due > 0 ? 'due' : 'new';
  return { rev: it.rev, label: it.label, reason, confirmable: it.confirmable, relearn: it.relearn, due: it.due, members: it.members };
}
