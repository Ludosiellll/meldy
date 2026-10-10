/** The group «Вопрос дня» picker for the Telegram bot (package D2; Concept 2 §3.15). Pure; stable ties. */
import type { LocalDay } from '../../types/container';

export interface GroupItemCounts { rev: string; label: string; topic: number | null; members: number; confirmable: number; relearn: number; due: number; unseen: number; blocked: boolean }
export interface GroupInput { day: LocalDay; items: GroupItemCounts[]; recent: Array<{ rev: string; day: LocalDay }>; minGapDays: number }
export interface GroupPick { rev: string; label: string; reason: 'confirm' | 'relearn' | 'due' | 'new'; confirmable: number; relearn: number; due: number; members: number }

export function pickGroupQuestion(_input: GroupInput): GroupPick | null {
  throw new Error('lib/containers/group.pickGroupQuestion: not built yet (package D2)');
}
