# «Подобрать ключи с ИИ»: contract

`POST /api/exams/keys/ai` (`backend/bank_keys_ai.py`, tests `backend/tests/test_bank_keys_ai.py`). The AI suggests
answer keys for imported test questions that the file gave no key for. Owner's decision of 2026-11-04 (meldy-notes
`40_Decisions/Decision_Log.md`). This file is for the frontend: the button in the import and the review queue are built
from it. If this file and the code disagree, fix one of them in the same commit.

## Product rules the client keeps

- The button only runs when the student presses it. Nothing calls the endpoint on its own.
- Only keys with `sure: "high"` become keys. Each one is labelled «ключ подобран ИИ, не из файла», goes into the
  import's review queue for the student to confirm, and keeps the label afterwards. A student studying the question
  sees the label and can press «Сомневаюсь в ключе». The decision log says the key is stored as a normal key with the
  flag `ai_key`.
- Keys found in the file (`parse-bank`, `parse-bank/ai`) never go through this endpoint.
- Where the flag goes (migration `20261107090300_ai_key_flag.sql`):
  - the import saves the key with `flags` containing `ai_key` and `key_source 'manual'` (`container_items_add`);
  - «Вопросы и ключи» writes `container_item_update(id, {"correct": [...], "ai_key": true})`; `ai_key` must be a
    boolean, and true only together with a non-empty `correct` on a single or multiple choice question (else 22023
    `ai_key`). A question that has a key already is refused with 22023 `keyed`: the author may have set one by hand
    while the AI was answering, and the AI's key never overwrites it (the page counts it as «уже есть ключ» and goes
    on). The result carries `ai_key` (the flag as stored): a page that asked for it and does not get `true` back is
    talking to a database without this migration;
  - any later change of the key without `ai_key: true` (or `{"ai_key": false}`), and any other change that moves `rev`
    (an option added, single turned multiple), takes the flag off, so the label never stays on a key the author set;
  - the bot's view gives `review.ai_key`: the bot says «Ключ подобран ИИ, не из файла.», «Верный ответ — …» instead of
    «В файле — …», and no «Автор исправил ключ» for it (`bot/render.ts`); «Вопрос дня» in a group never posts such a
    question (`bot.group_item_ok`).
- No model or vendor names anywhere in the interface. Say «ИИ».

## Request

`Content-Type: application/json`, session token as for every `/api/*` call.

```json
{
  "subject": "Анатомия человека",
  "questions": [
    {"id": "q-12", "text": "Какой орган отвечает за зрение?", "options": ["Печень", "Глаз", "Ухо"], "kind": "single"},
    {"id": "q-13", "text": "Какие кости относятся к черепу?", "options": ["Лобная", "Бедренная", "Височная", "Локтевая"], "kind": "multiple"}
  ]
}
```

| Field | Rule |
|---|---|
| `subject` | optional; string up to 200 characters, or `null`. Context only (the exam or subject title). Blank counts as absent. |
| `questions` | 1 to 300 items. |
| `id` | string, 1 to 64 characters from `A-Z a-z 0-9 _ : . -`; unique within the request. Never sent to the model; it only ties a result to its question. |
| `text` | string up to 2000 characters, not blank. |
| `options` | 2 to 10 strings, each up to 500 characters and not blank, in the order the student sees them. |
| `kind` | `"single"` or `"multiple"`. |

- No other fields, at the top level or in a question. An unknown field is a 422.
- Send only questions without a key from the file, of kind single or multiple, **without pictures**. The server has no
  image path, and the model would be answering blind.
- A question over a limit fails the whole request (422 naming its position). Leave such questions out on the client.
  They stay without a key.
- Lengths are counted in characters (code points) on the server. JavaScript's `length` counts UTF-16 units, so
  checking with `length` on the client is never looser than the server.
- More than 300 questions, or more than 12 model batches: split them into several requests (see «Batches» below). Each
  request is charged and rate-limited separately, so send as many as fit in one request, and send them one after
  another: a second request while the first is running is refused (429 `keys_running`).
- Body size: at most 8 MB, otherwise 413.

### Batches

The server asks the model in batches (`bank_keys_ai.make_batches`): questions in request order, a new batch when the
current one has 25 questions or the next question would take it over 12 000 characters. A question's size is its text
(trimmed) plus each option plus 4, plus 40, in code points. A request may hold at most **12 batches** (300 ordinary
questions; 12 long ones go one per batch), otherwise 413 `too_big`. The client mirrors this
(`frontend/src/components/containers/import/keysAi.ts`, `keysAiRequests`) to split requests and to show the price, and
sends at most **100 questions and 4 batches** a request, one request after another: with 2 calls at a time a request
of 12 batches could run out of the 150 s with its last batches unanswered but paid. The price per 100 questions or 4
batches is the same, so the split costs what one bigger request would.

## Response 200

```json
{
  "results": [
    {"id": "q-12", "correct": [1], "agree": true, "sure": "high"},
    {"id": "q-13", "correct": null, "agree": false, "sure": "low", "note": "ответы ИИ разошлись"}
  ],
  "units": 5,
  "spent_questions": 2
}
```

- `results`: one entry per question, in request order.
- `correct`: 0-based indices into `options` **as sent**, ascending, or `null` when there is no suggestion. When it is
  not null, `sure` is `"high"` and `agree` is `true`. A `single` question gets exactly one index. A `multiple` question
  gets at least 1 and at most n−1 (if every option is picked, the result is `null`).
- `agree`: the two independent answers chose the same non-empty set of options. It can be `true` while `correct` is
  `null`, for example when they agreed but one said it was unsure.
- `sure`:
  - `"high"`: both answers were confident and agreed. This is the only case with a key.
  - `"low"`: answers came back, but the server gives no key: they disagreed, one was unsure, every option was picked,
    or the second answer could not be independent.
  - `"none"`: one of the answers is missing or did not follow the format.
- `note`: present only when `correct` is `null`. Short Russian text, ready to show next to the question:

  | `note` | `sure` | Meaning |
  |---|---|---|
  | «ИИ не уверен» | low | at least one answer said «не уверен» |
  | «ответы ИИ разошлись» | low | both confident, different options |
  | «ИИ выбрал все варианты» | low | a `multiple` question with every option picked |
  | «ИИ не смог перепроверить ответ» | low | only one AI source was available, and the options could not be reordered for the second answer (an option points at others by letter or number, such as «а и б») |
  | «ИИ не дал ответа» | none | no answer, or an answer off the rules (two numbers for `single`, a number outside the options, the request ran out of time) |

  Show the note as it is, or map `sure` to your own wording. Do not build logic on the note text.
- `units`: units charged for this request. `spent_questions`: questions sent to the model (all of them).

## Cost

- Kind `keysAI` in the daily AI limit, per request: **5 units for each started 100 questions or for each started 4
  batches, whichever is more**. Ordinary questions: 1–100 cost 5, 101–200 cost 10, 201–300 cost 15 (100 ordinary
  questions are 4 batches). Long questions cost by batches: 12 questions of 2000 characters with ten long options go
  one per batch, 12 batches, 15 units. Server: `plans.AI_COSTS["keysAI"]`, `plans.KEYS_AI_QUESTIONS_PER_CHARGE`,
  `plans.KEYS_AI_BATCHES_PER_CHARGE`, `plans.keys_ai_cost(questions, batches)`.
- The mirror in `frontend/src/lib/plans.ts`: `keysAI: 5` in `AI_COSTS`, `KEYS_AI_QUESTIONS_PER_CHARGE = 100`,
  `KEYS_AI_BATCHES_PER_CHARGE = 4` and `keysAiCost(questions, batches)`.
  `backend/tests/test_quota.py::test_the_browser_shows_the_prices_the_server_charges` checks that both sides name the
  same price.
- The server charges **before** calling the model. The units are returned only when no model call got a reply (errors,
  busy, out of time): the request then fails. A reply that came back, even an unusable one, keeps the charge: the
  provider has done that work. Questions without a usable answer get `sure: "none"`.
- Read the top bar's AI limit again after the answer, success or error (`notifyAIUsageChanged()`, as `parseBankAi` does).
- Aborting the request in the browser does not refund it: the server finishes the work and keeps the charge.

## Errors

The body is always `{"detail": "<Russian text>", "code": "..."}`, except the two rows marked «no code».

| Status | `code` | `detail` | When |
|---|---|---|---|
| 401 | no code | «Требуется войти в аккаунт» (or the session middleware's own text) | no session or an expired one; nothing charged |
| 413 | `too_big` | «Слишком большой запрос. Отправьте вопросы частями.» | body over 8 MB, or more than 12 batches |
| 422 | `bad_request` | «Не удалось прочитать запрос. Обновите страницу и попробуйте ещё раз.» | not JSON, wrong types, unknown or missing field, bad or duplicate `id`, bad `kind` (a client bug) |
| 422 | `bad_request` | «Отправьте от 1 до 300 вопросов.» | empty list or more than 300 |
| 422 | `bad_request` | «Название предмета длиннее 200 знаков.» | `subject` too long |
| 422 | `bad_request` | «Вопрос N: нет текста вопроса.» / «Вопрос N: текст длиннее 2000 знаков.» | N is the 1-based position in `questions` |
| 422 | `bad_request` | «Вопрос N: нужно от 2 до 10 вариантов ответа.» / «Вопрос N: вариант ответа длиннее 500 знаков.» / «Вопрос N: пустой вариант ответа.» | options out of limits |
| 429 | no code | «Слишком много запросов. Подождите минуту и повторите.» or «На сегодня предел этой функции исчерпан — он обновится завтра.» | rate limit: 5 a minute and 30 a day per user; `Retry-After` header |
| 429 | `ai_limit` | «Дневной лимит ИИ на сегодня исчерпан.» plus `used`, `limit`, `resets_at`, `pro`, `units` | not enough units today; nothing charged; open the limit window as for other AI actions |
| 429 | `keys_running` | «Ключи уже подбираются — в другой вкладке или окне. Дождитесь конца и попробуйте снова.» | this user's previous request is still running; `Retry-After: 30`; nothing charged |
| 429 | `ai_busy` | «ИИ сейчас занят. Попробуйте подобрать ключи через минуту.» | the model is overloaded; units returned |
| 502 / 503 / 504 | `ai_failed` | «Не удалось подобрать ключи. Попробуйте ещё раз.» | the model failed, is not configured, or ran out of time with no answer; units returned |

Nothing is charged for 401, 413, 422, rate-limit 429, `keys_running` or `ai_limit`. The client's `backendError` already shows its own
words for every 5xx; the `code` is kept.

## Timing

One request can take a while. The server sends up to 25 questions per model call, asks each batch twice, and runs up
to 2 calls at a time (at most 2 places of the server's shared queue of heavy calls), each call allowed 45 s. Retries
of broken replies stay within 4 calls per batch on average. The server's own deadline is 150 s: answers that came in by then are
returned, the rest get `sure: "none"`. Real timings have not been measured yet (no live calls were made when this was
built); expect seconds for a few questions and up to the full 150 s for 300. Show progress rather than a frozen
button, and keep the review queue usable while it runs.

## How the server decides (for reference)

- Two independent answers per question. The first answer sees the options in the order sent, the second one reordered
  (each one moves, except «все перечисленные»-like options) and mapped back. When both AI providers are configured,
  each gives one of the two answers; with only one, it answers twice. If one provider fails on a batch, the other
  answers that batch again in the order the remaining answer did not use.
- The model gets only the question text, the options and the subject: no ids, no keys, no other answers. Each question
  is a heading «Вопрос N. Один верный ответ.» with one line of JSON under it (`{"текст": …, "варианты": {"1": …}}`), so
  a question's own text cannot pose as another question. It is told to answer by option number, in JSON, with
  «уверен» / «не уверен», temperature 0.
- A broken or cut-off reply is asked again in halves. Questions missing from a good reply are asked once more.
- The server log gets counters only, never question text.
