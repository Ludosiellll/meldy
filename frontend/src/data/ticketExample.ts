/**
 * Question 7 of /try's example exam («Микроэкономика»), as the sign-in reels and the landing reel show it: its text and
 * the short words of its answer points, main points marked (data/example/questions.ts, `short` and `essential`; the oral
 * run shows the same short words). ticketExample.test.ts holds it to the example; the example's data itself is not
 * imported here (the landing and the sign-in pages stay light).
 */

export interface TicketPoint {
  /** The point's short words. */
  text: string;
  /** A main point: the protocol counts these («Сами назвали 3 из 3 главных пунктов»). */
  essential: boolean;
}

export interface TicketQuestion {
  number: number;
  text: string;
  points: readonly TicketPoint[];
}

export const Q7: TicketQuestion = {
  number: 7,
  text: 'Эластичность спроса и выручка продавца.',
  points: [
    { text: 'выручка = цена × количество', essential: true },
    { text: 'эластичный: снижение цены → выручка ↑', essential: true },
    { text: 'неэластичный: выручка ↑ при повышении цены', essential: true },
    { text: 'единичная эластичность: выручка не меняется', essential: false },
  ],
};
