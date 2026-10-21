/**
 * «Как ученик пишет», the teacher's second card of the first run (UX audit of 21.10, P4): «Как это видит ученик» from
 * the student's phone on. A quick test's link comes from «Получить ссылку», so the clip's first step, the studio's
 * «Отправить по ссылке», is left out.
 */
import { QUIZ_STEPS, QUIZ_TOTAL, QZ, QuizLinkScene } from './quizLink';
import { laterScene, laterSteps } from './later';

export const QUIZ_STUDENT_FROM = QZ.phone;
export const QUIZ_STUDENT_TOTAL = QUIZ_TOTAL - QUIZ_STUDENT_FROM;
export const QUIZ_STUDENT_STEPS = laterSteps(QUIZ_STEPS, QUIZ_STUDENT_FROM);
export const QuizStudentScene = laterScene(QuizLinkScene, QUIZ_STUDENT_FROM, QUIZ_TOTAL);
