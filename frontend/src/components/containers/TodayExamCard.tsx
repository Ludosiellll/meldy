/**
 * The «Сегодня» card of an exam container (package D3b builds it; spec §16 #47): the same anatomy as today's oral
 * exam card — flag, one meta line, the one blue button, then the blue number. Package E places it on «Сегодня».
 */
import type { DayPlan, OverviewContainer } from '../../types/container';

export interface TodayExamCardProps {
  container: OverviewContainer;
  plan: DayPlan | null; // null while loading
  offline?: boolean;
  /** This card leads «Сегодня» and holds the page's one blue button. */
  lead: boolean;
}

export default function TodayExamCard(_props: TodayExamCardProps): JSX.Element | null {
  return null;
}
