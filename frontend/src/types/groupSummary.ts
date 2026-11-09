/**
 * The group's summary for the exam's author, without names (public.container_group_summary, 20261109090000;
 * docs/answers-privacy.md): numbers of the whole group — never a person's answers or progress, never a name, never a
 * number about fewer than `min_members` people. contracts/container/group_summary.json is a sample of what the
 * function returns.
 *
 * In a file of its own, not in ./container.ts: that file is copied byte for byte to the Telegram bot
 * (scripts/sync_bot_plan.mjs), and the bot has nothing to do with the summary.
 */
import type { DayKey, Uuid } from './container';

/** The smallest group the summary gives numbers about. The database decides (`min_members`); the site never takes less. */
export const GROUP_MIN_MEMBERS = 5;

export interface GroupHardTopic {
  subject: string;
  /** The topic's title; null — questions without a topic: the subject as a whole. */
  topic: string | null;
  /** The members' answers in the topic over the last 30 days, and the share of them that were wrong (a whole percent). */
  answers: number;
  wrong_pct: number;
}
export interface GroupNumbers {
  /** Members with an answer of their own in the last 7 days, in the 7 days before those, and ever. */
  studied_7d: number;
  studied_prev_7d: number;
  studied_ever: number;
  /** The average over the members of «learned / questions that count», a whole percent; null — no question counts. */
  learned_pct: number | null;
  /** At most 3, the highest share of wrong answers first; a topic needs 5 different members and 30 answers. */
  hard_topics: GroupHardTopic[];
}
/**
 * What the function returns: the numbers come only from `min_members` members, and not while it is paused. The pause:
 * for 7 days after the author removed a member (and has not restored them) there is no number, only `paused_until`,
 * the day they come back (the Europe/Minsk day) — before and after a removal the numbers would differ by that one
 * person. contracts/container/group_summary_paused.json is a sample.
 */
export interface GroupSummaryWire extends Partial<GroupNumbers> {
  members: number;
  min_members: number;
  paused_until?: DayKey;
}
/**
 * What the page reads (api/containers normalizeGroupSummary): `numbers` null — a group under `min_members`, or a pause;
 * `paused_until` — the day the numbers come back, null when there is no pause (never beside numbers).
 */
export interface GroupSummary {
  members: number;
  min_members: number;
  numbers: GroupNumbers | null;
  paused_until: DayKey | null;
}
/** The RPC, as ContainerRpc lists the others: the exam's author only (P0002 for a member or a stranger). */
export interface GroupSummaryRpc {
  container_group_summary: { args: { p_container_id: Uuid }; returns: GroupSummaryWire };
}
