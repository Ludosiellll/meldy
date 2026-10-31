# Question kinds (release 48) — contract

Spec: meldy-notes `10_Project/Test_Builder_Spec_2026-10-18.md`, «Выпуск 48 — типы вопросов». This file fixes the data shape
of every new kind: the `test_items` row, the answer JSON each client sends, the grading, partial credit and what each
surface shows. The TypeScript mirror is `frontend/src/lib/kinds/` (`number.ts`, `grade.ts`, `cloze.ts`); the SQL is
`supabase/migrations/20261101090000_question_kinds.sql` and the migrations after it. Shared cases:
`contracts/kinds/number_vectors.json` (`meldy_number_right`) and `contracts/kinds/grade_vectors.json`
(`meldy_private.grade_item`); the SQL rehearsal and Vitest both read them. Where this file and code disagree, fix one of
them in the same commit.

**Additive.** `single`, `multiple` and `short` rows, answers, quizzes, sessions, the bot and the live game behave exactly as
before. Every JSON the server gives for an item of an old kind without partial credit is the same as before, key for
key: the new keys appear only on items of a new kind or with `partial`. A new column has a default that every existing row already satisfies; a widened check accepts every row the old
one accepted; a new kind appears only when an author picks it. `truefalse` stays a preset of `single`.

## 1. The row (`public.test_items`)

New columns (all nullable or with a default; `rev` rules in §1.3):

| column | type | meaning |
|---|---|---|
| `tolerance` | `numeric` null | `number` only: the accepted distance, ≥ 0; null = exact |
| `unit` | `text` null | `number` only: 1..20 characters once trimmed; null = none |
| `partial` | `boolean not null default false` | partial credit, by the author's choice: only `multiple`, `order`, `match`, `cloze` |
| `material_ids` | `uuid[] not null default '{}'` | `essay` only: 0..10 of the author's lectures (`public.materials`) the check reads |

Per kind (`options`, `correct`, `answers` keep their types; `keyed` stays `cardinality(correct) > 0 or cardinality(answers) > 0`):

| kind | `options` | `correct` | `answers` | keyed |
|---|---|---|---|---|
| `single`, `multiple`, `short` | as before | as before | as before | as before |
| `number` | `[]` | `{}` | 1..10 accepted numbers, canonical text `^-?[0-9]+(\.[0-9]+)?$`, ≤ 40 characters | yes |
| `order` | 2..8 items **in the right order** (`meldy_options_ok`) | `{0, 1, …, n−1}` (required: the identity) | `{}` | yes |
| `match` | 2..8 left items (`meldy_options_ok`) | `{}` | the right items: `answers[i]` (i < n) is the pair of `options[i]`; then 0..(10 − n) extra right items (distractors); each 1..200 characters, distinct after `meldy_short_norm` | yes |
| `cloze` | `[]` | `{}` | one element per gap (1..10): the gap's accepted forms joined by `\n` (1..10 forms, each 1..200 characters, not empty after `meldy_short_norm`) | yes |
| `essay` | `[]` | `{}` | `{}` | **no** |

- **Cloze gaps** are written in the stem as runs of three or more underscores (`___`); the number of runs equals
  `cardinality(answers)`. Gap *k* is the *k*-th run from the start of the stem. Other kinds may contain `___` freely.
- **Essay** has no automatic key, so it is never offered by a study session, the plan, the mock exam or the bot (they
  take keyed questions only). It lives in the контрольная (and the studio). The quiz pool takes `keyed or kind = 'essay'`.
- `tolerance` and `unit` are null for every other kind; `material_ids` is `{}` for every kind but `essay`; `partial` is
  false for `single`, `short`, `number`, `essay`. `container_item_update` clears them when a patch changes the kind away.
- Writes go through `container_items_add` / `container_item_update` (new keys `tolerance`, `unit`, `partial`,
  `material_ids`; 22023 detail names the rule). `material_ids` must be the author's own materials. `tolerance` is written
  as a JSON number or a string `^[0-9]+(\.[0-9]{1,6})?$` (at most six decimals, ≤ 10⁹).

### 1.1 `public.meldy_number_right(p_text text, p_answers text[], p_tolerance numeric, p_unit text) returns boolean`

Immutable, `set search_path = ''`. Fixed (the live game builds on it):

1. `p_text` null → false. Remove every whitespace character (the set of `meldy_short_norm`: `\t\n\v\f\r`, space,
   U+00A0, U+1680, U+2000–U+200B, U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF). `,` → `.`; `−` (U+2212) → `-`.
2. Lower-case as `meldy_short_norm` does (its Latin/Cyrillic table), drop one trailing `.`.
3. If `p_unit` is set: its `meldy_short_norm` form without spaces; when the text ends with it, cut it off.
4. What is left must be `^[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)$` and at most 40 characters, else false.
5. Right when `|x − a| ≤ coalesce(p_tolerance, 0)` for some `a` of `p_answers` that is canonical (exact `numeric`
   arithmetic; non-canonical elements are ignored).

TypeScript twin: `frontend/src/lib/kinds/number.ts` `numberRight(text, answers, tolerance, unit)` — the same steps with
exact decimal arithmetic on `BigInt` (a double would make `|1.1 − 1| ≤ 0.1` false). Cases: `contracts/kinds/number_vectors.json`.

### 1.2 Checks

`test_items_kind_check` takes the eight kinds. `options`, `correct` (`meldy_key_ok(correct, n, kind)`), `answers`
(`meldy_answers_ok(answers, kind)`) follow the table; `test_items_kind_fields_check` holds the per-kind rules that need
more than one column (tolerance, unit, partial, material_ids, the match counts, the cloze gaps). `test_answers_kind_check`
takes the eight kinds too.

### 1.3 `rev`

`rev` grows when the key changes (`test_items_guard`). The old kinds keep their rule. For a new kind (or a change to or
from one) the key is: `number` — the set of accepted values (as numbers), `tolerance`, the normalised unit; `order` — the
normalised options in order; `match` — the normalised options in order and the normalised right items in order;
`cloze` — per gap, the set of normalised forms, in gap order; `essay` — nothing (it has no state). `partial`,
`material_ids` and the explanation never move `rev`.

## 2. Answers

### 2.1 The answer element (`record_test_answers`, `container_mock_finish`, the bot)

The element of `AnswerInput` gets one more key, `texts`. Indices are file indices.

| kind | answer | «Не знаю» / unanswered |
|---|---|---|
| `number` | `text`: the typed string (≤ 1000 characters, not blank) | `text: null` |
| `order` | `chosen`: the arrangement, top to bottom — a permutation of `0..n−1` | `chosen: null` |
| `match` | `chosen`: per left item (file order) the index of its right item in `answers`, or `-1` (left empty); length n | `chosen: null` (or all `-1`) |
| `cloze` | `texts`: one string per gap (≤ 200 characters each; `''` = left empty) | `texts: null` (or all blank) |
| `essay` | not recorded here (`no_key`) | — |

`shown_order` is optional: for `order` a permutation of `0..n−1` (the order the items were first shown), for `match` a
permutation of `0..m−1` (the right column as shown); absent or null for `number`, `cloze`, `essay`. Anything else is
`invalid`.

### 2.2 Grading — `meldy_private.grade_item(p_item public.test_items, p_a jsonb)`

Returns `grade_answer`'s columns (`o_valid, o_correct, o_result, o_chosen, o_text, o_order`) plus `o_credit numeric`
(0..1). The old kinds are graded by `grade_answer` unchanged; `o_credit` is 1 when right, else 0, except `multiple`
with `partial`.

- `number`: right ⇔ `meldy_number_right(text, answers, tolerance, unit)`. `o_text` = the text.
- `order`: right ⇔ `chosen = [0, 1, …, n−1]`. `o_chosen` = the arrangement (not sorted).
- `match`: right ⇔ `chosen[i] = i` for every i. `o_chosen` = the chosen list as given (with `-1`).
- `cloze`: gap k right ⇔ `meldy_short_norm(texts[k])` equals the normalised form of one of its forms; right ⇔ every gap
  right. `o_text` = the texts joined by `\n` (a newline inside a gap becomes a space).
- `o_result`: `right` / `wrong` / `dont_know` as before.

**Partial credit** (`o_credit` when `partial`; otherwise 1 for right, 0 for anything else):

| kind | credit |
|---|---|
| `multiple` | `max(0, (picked keys − picked others) / keys)` |
| `order` | pairs in the right relative order / all pairs: `1 − inversions / (n(n−1)/2)` |
| `match` | right pairs / n |
| `cloze` | right gaps / gaps |

Credit is a `numeric` rounded to 4 decimals. **The rule «верно в два разных дня» and the mock exam count only right
answers** (credit 1); partial credit counts in the контрольная score only.

TypeScript twin: `frontend/src/lib/kinds/grade.ts` `gradeItem(item, answer) → {valid, correct, credit, result}`. Cases:
`contracts/kinds/grade_vectors.json`.

### 2.3 The answer core's reply

For a new kind `record_test_answers` returns, beside `correct`, both `key` (`correct` sorted) and `answers`, and for
`number` also `tolerance` and `unit`. The old kinds' reply is unchanged. `test_answers` keeps `chosen` (the arrangement
or the match list), `answer_text` (number; cloze joined by `\n`), `shown_order`.

## 3. The контрольная

### 3.1 What the participant receives (`quiz_start`, `quiz_guest_start`, the attempt)

An item of a new kind carries, beside `id, kind, stem, options, code, keep_order, images`:

- `partial` (boolean) for every kind;
- `number`: `unit`;
- `order`: `options` **already shuffled for this attempt** (never the right order: the right order is the key). The
  permutation is `meldy_private.quiz_perm(attempt, item, n)`, fixed per attempt and item, never the identity for n ≥ 2;
- `match`: `options` = the left items (file order) and `right` = the right items shuffled the same way
  (`quiz_perm(attempt, item, m)`);
- `cloze`: `gaps` = the number of gaps;
- `essay`: nothing more.

The saved answers come back in the same shown indices.

### 3.2 What the participant sends (`quiz_answer`, `quiz_guest_answer`)

| kind | element | emptied (the saved answer is taken back) |
|---|---|---|
| `number` | `{item_id, text}` (≤ 200 characters) | `text` null or blank |
| `order` | `{item_id, chosen: [shown indices top to bottom]}` (a permutation) | `chosen` null or `[]` |
| `match` | `{item_id, chosen: [per left, the shown index in right, or -1]}` | `chosen` null, `[]` or all `-1` |
| `cloze` | `{item_id, texts: [one per gap]}` (≤ 200 each) | `texts` null or all blank |
| `essay` | `{item_id, text}` (≤ 6000 characters) | `text` null or blank |

The server maps shown indices to file indices before it stores them (`quiz_answers.chosen` in file indices, as the
answer core). `quiz_answers.text` holds the number, the essay, or the cloze texts joined by `\n`;
`quiz_answers_text_check` is widened to ≤ 6000 characters (the per-kind limits are checked by `quiz_answer_for`).

### 3.3 Score

`meldy_private.quiz_graded` gains `credit numeric` and `pending boolean` (an essay not checked yet). An attempt's score is
`Σ weight × credit` (weight = the studio block's points, else 1), max = `Σ weight`; the percent, `passed` and the band
follow it. Without partial credit or essays every credit is 0 or 1, so every existing number stays the same; a score
that is not whole is given with up to two decimals. The result says `pending` (the number of essays not checked yet).

### 3.4 Essays

`public.quiz_essay_marks (attempt_id, item_id, verdict, quote, source, checked_at)`: verdict `full` (credit 1) |
`partial` (0.5) | `none` (0); `source` `ai` | `author`; `quote` ≤ 600 characters (from a lecture). RLS on, no client
right. Calls:

- `quiz_essay_task(attempt, item)` (the author): the stem, the answer, `material_ids`, the mark — what the check needs.
- `quiz_essay_mark(attempt, item, verdict, quote default null, source default 'author')` (the author): sets or clears
  (`verdict` null) the mark. The author's choice always wins over the check.
- `POST /api/quiz/essay-check {attempt_id, item_id}` (backend, the author's session): reads the task, the lectures
  (`material_ids`), builds the reference points from them with the examiner's engine (`oral_api`: points with quotes
  checked by code, the same cache), judges the answer (`judge_answer`), maps it to `full` (every main point named),
  `partial` (some), `none`, with the quote of the first point missed (or the first point when full), and saves it with
  `source = 'ai'`. Spends the author's AI units as `/api/oral/rubric` + `/api/oral/evaluate` do. Without lectures:
  409 `no_lectures` — the author marks by hand.

### 3.5 The review (`quiz_result`) and the author's view

Review item fields for the new kinds: `chosen` in the attempt's shown indices (order, match), `text` (number, essay),
`texts` (cloze), `right`, `credit`, and `right_items` (match: the right column as shown). With the answers shown:
`key` (order: the right arrangement in shown indices; match: per left the shown index of its pair), `forms` (number:
the accepted numbers), `gap_forms` (cloze: per gap its forms), `gaps_right` (cloze: which gaps were right, shown with
every review but the score), `tolerance`, `unit`, the explanation. An essay always shows its `mark`
(verdict, quote) or `pending`.

`quiz_attempt_answers` (the author) adds `credit`, `texts` (cloze) and `mark` (essay). `quiz_results` item stats:
`picks` is `[]` for every kind but `single` and `multiple` (no per-option breakdown for order and match), `wrong_texts`
covers `short` and `number`, and a new `credit` (the sum of credits) beside `correct` (full answers).

## 4. Surfaces

| surface | number | order | match | cloze | essay |
|---|---|---|---|---|---|
| Ключи editor (`QuestionEditor`) | numbers, tolerance, unit | items in the right order | pairs + extra right items | text with gaps, forms per gap | lectures to check by |
| Studio (canvas, list, properties) | yes | yes | yes | yes | yes |
| Studio text view | kept as a marked block: the stem is text, the key is edited on the canvas | same | same | same | same |
| Study session, mock exam | typed | drag + keyboard | drag + keyboard / select | inline fields | not offered |
| Контрольная (one by one, studio page) | yes | yes | yes | yes | yes |
| Review | your answer, the key | your order, the right order | your pairs, the right pairs | each gap | the mark and quote |
| Author stats | wrong numbers | right share only | right share only | right share | marks to set |
| Bot (plan, «ошибки», extra) | typed | «Открыть в приложении» | «Открыть в приложении» | typed when one gap, else app | not offered |
| Live game | — (the game agent) | — | — | — | — |

- **Partial credit:** a switch «Частичный балл» in the editor and the studio for multiple, order, match, cloze; the
  participant sees «Засчитывается частично» under the question.
- **Formulas** `$…$` and `$$…$$` (KaTeX, as the конспект: `splitMath`) in stems, options, right items, gap text and
  explanations, on every web surface above (not in code stems, not in the bot). Loaded only when a text has a formula.
- **«Озвучить вопрос»** for the participant (контрольная, session): reads the stem, the options (or the items) through
  Meldy's voice (`/api/tts`) when signed in, the browser's own voice otherwise; formulas are read as written.
- **Keyboard and screen readers:** an order item is a list of buttons — Space/Enter takes an item, ↑/↓ moves it, Space
  drops it; «Выше» / «Ниже» buttons on each row; the live region says «Пункт 2 из 4». A match left item has a select of
  the right items (and drag onto it); the pair is announced.
