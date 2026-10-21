/**
 * The studio's tour plays «Свой тест» from the studio on (UX audit of 21.10, P4): the tour comes once the test is open,
 * so its clip no longer starts with «Нажмите «Новый тест» и назовите тест».
 */
import { ST, STUDIO_STEPS, STUDIO_TOTAL, StudioScene } from './studio';
import { laterScene, laterSteps } from './later';

/** Where the tour's clip starts in «Свой тест»: the studio opens. */
export const TOUR_FROM = ST.studio;
export const STUDIO_TOUR_TOTAL = STUDIO_TOTAL - TOUR_FROM;
export const STUDIO_TOUR_STEPS = laterSteps(STUDIO_STEPS, TOUR_FROM);
export const StudioTourScene = laterScene(StudioScene, TOUR_FROM, STUDIO_TOTAL);
