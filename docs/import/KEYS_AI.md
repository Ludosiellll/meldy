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
- More than 300 questions: split them into several requests. Each request is charged and rate-limited separately (see
  below), so send as many as fit in one request.
- Body size: at most 8 MB, otherwise 413.

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

- Kind `keysAI` in the daily AI limit: **5 units for each started 100 questions** (1–100 questions cost 5, 101–200
  cost 10, 201–300 cost 15). It is the same price as `importAI`. Server: `plans.AI_COSTS["keysAI"]`,
  `plans.KEYS_AI_QUESTIONS_PER_CHARGE`, `plans.keys_ai_cost()`.
- The mirror in `frontend/src/lib/plans.ts` still has to be added: `keysAI: 5` in `AI_COSTS`,
  `KEYS_AI_QUESTIONS_PER_CHARGE = 100` and a `keysAiCost(questions)` shaped like `importAiCost`. Until then
  `backend/tests/test_quota.py::test_the_browser_shows_the_prices_the_server_charges` skips `keysAI` (`server_first`).
  Once `plans.ts` lists it, the test checks that the price is the same. Empty `server_first` after the frontend lands.
- The server charges **before** calling the model. If no answer came back at all, the units are returned and the
  request fails. If some answers came back, the charge stays even if some questions end up without a key.
- Read the top bar's AI limit again after the answer, success or error (`notifyAIUsageChanged()`, as `parseBankAi` does).
- Aborting the request in the browser does not refund it: the server finishes the work and keeps the charge.

## Errors

The body is always `{"detail": "<Russian text>", "code": "..."}`, except the two rows marked «no code».

| Status | `code` | `detail` | When |
|---|---|---|---|
| 401 | no code | «Требуется войти в аккаунт» (or the session middleware's own text) | no session or an expired one; nothing charged |
| 413 | `too_big` | «Слишком большой запрос. Отправьте вопросы частями.» | body over 8 MB |
| 422 | `bad_request` | «Не удалось прочитать запрос. Обновите страницу и попробуйте ещё раз.» | not JSON, wrong types, unknown or missing field, bad or duplicate `id`, bad `kind` (a client bug) |
| 422 | `bad_request` | «Отправьте от 1 до 300 вопросов.» | empty list or more than 300 |
| 422 | `bad_request` | «Название предмета длиннее 200 знаков.» | `subject` too long |
| 422 | `bad_request` | «Вопрос N: нет текста вопроса.» / «Вопрос N: текст длиннее 2000 знаков.» | N is the 1-based position in `questions` |
| 422 | `bad_request` | «Вопрос N: нужно от 2 до 10 вариантов ответа.» / «Вопрос N: вариант ответа длиннее 500 знаков.» / «Вопрос N: пустой вариант ответа.» | options out of limits |
| 429 | no code | «Слишком много запросов. Подождите минуту и повторите.» or «На сегодня предел этой функции исчерпан — он обновится завтра.» | rate limit: 5 a minute and 30 a day per user; `Retry-After` header |
| 429 | `ai_limit` | «Дневной лимит ИИ на сегодня исчерпан.» plus `used`, `limit`, `resets_at`, `pro`, `units` | not enough units today; nothing charged; open the limit window as for other AI actions |
| 429 | `ai_busy` | «ИИ сейчас занят. Попробуйте подобрать ключи через минуту.» | the model is overloaded; units returned |
| 502 / 503 / 504 | `ai_failed` | «Не удалось подобрать ключи. Попробуйте ещё раз.» | the model failed, is not configured, or ran out of time with no answer; units returned |

Nothing is charged for 401, 413, 422, rate-limit 429 or `ai_limit`. The client's `backendError` already shows its own
words for every 5xx; the `code` is kept.

## Timing

One request can take a while. The server sends up to 25 questions per model call, asks each batch twice, and runs up
to 4 calls at a time, each call allowed 45 s. The server's own deadline is 150 s: answers that came in by then are
returned, the rest get `sure: "none"`. Real timings have not been measured yet (no live calls were made when this was
built); expect seconds for a few questions and up to the full 150 s for 300. Show progress rather than a frozen
button, and keep the review queue usable while it runs.

## How the server decides (for reference)

- Two independent answers per question. When both AI providers are configured, each answers once, with the options in
  the order sent. With only one, it answers twice, and the second time the options are reordered (each one moves,
  except «все перечисленные»-like options) and mapped back. If one provider fails on a batch, the other answers that
  batch again with reordered options.
- The model gets only the question text, the options and the subject: no ids, no keys, no other answers. It is told
  to answer by option number, in JSON, with «уверен» / «не уверен», temperature 0.
- A broken or cut-off reply is asked again in halves. Questions missing from a good reply are asked once more.
- The server log gets counters only, never question text.
