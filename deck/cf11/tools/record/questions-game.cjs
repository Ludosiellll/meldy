'use strict';
// The deck game's test on account A: «Спрос и предложение», six questions with short options (they sit in the host's
// four answer tiles). Sim players map the key's text to the shown index.
const TITLE = 'Спрос и предложение';
const QUESTIONS = [
  { q: 'Цена товара выросла. Что происходит с величиной спроса?', right: 'Падает', wrong: ['Растёт', 'Не меняется', 'Сначала растёт'] },
  { q: 'Как называется цена, при которой спрос равен предложению?', right: 'Равновесная', wrong: ['Максимальная', 'Средняя', 'Розничная'] },
  { q: 'Цена выше равновесной. Что появляется на рынке?', right: 'Излишек', wrong: ['Дефицит', 'Инфляция', 'Ничего'] },
  { q: 'Какая пара товаров — заменители?', right: 'Чай и кофе', wrong: ['Чай и сахар', 'Машина и бензин', 'Хлеб и вода'] },
  { q: 'Что сдвигает кривую спроса на обычный товар вправо?', right: 'Рост доходов', wrong: ['Рост цены товара', 'Налог на продавцов', 'Падение цены товара'] },
  { q: 'Цена выросла на 10 %, спрос упал на 25 %. Спрос…', right: 'Эластичный', wrong: ['Неэластичный', 'Единичный', 'Не определить'] },
];

function text() {
  return QUESTIONS.map((x) => [x.q, `+ ${x.right}`, ...x.wrong.map((w) => `- ${w}`)].join('\n')).join('\n\n') + '\n';
}

function keyOf(questionText, options) {
  const item = QUESTIONS.find((x) => x.q === questionText);
  if (!item) return -1;
  return options.indexOf(item.right);
}

module.exports = { TITLE, QUESTIONS, text, keyOf };
