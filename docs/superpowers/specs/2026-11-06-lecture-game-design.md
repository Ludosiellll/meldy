# «Игра по лекции»: любой материал → игра на паре за минуту

Status: draft for the owner's review (06.11.2026).

## Why

The owner (06.11) liked «тест из материала ментора» for the stand of the CodingFest-11 final and asked to build it
through «Лекции», with a constraint: «надо учитывать, что интерфейс уже перегружен». Goal: a teacher (or a mentor at
the stand) turns a photo of a page, a file, a text or a recording into a class game with a QR on the projector in
about a minute; a lecture that exists becomes a game in seconds.

## What the owner said / what is assumed

- Said: through the lectures section; big features are fine; the interface must not grow heavier.
- Assumed: the game uses the lecture's own «Самопроверка» (its questions carry a quote of the lecture checked by code
  and cost no AI units); the class game's setup page (/live/new) stays the one place for game settings.

## Design (no new page, no new section, three touch points)

1. **«Самопроверка» of a lecture** (ResultsPanel: the lecture page and the screen right after the analysis): the row
   «Сделать контрольную · Добавить в тест» (LectureToTest) gains a first chip **«Сыграть»**. It opens a small sheet
   with three choices — «Игра на паре» (main), «Дуэль», «Соревнование по ссылке» — each going to its existing setup
   (/live/new?c=…, /live/duel?c=…, /live/challenge?c=…) with the lecture's test chosen.
2. **«Игры» → «Начать игру» (GamePicker)**: below the tests and exams, a group **«Лекции»** (the author's lectures with
   a self-test, newest first) and one quiet link at the end **«Новая лекция из фото или файла»** → «Разобрать лекцию»
   with `?then=game`.
3. **«Разобрать лекцию» with `?then=game`**: the page's heading says «Игра из материала»; the self-test is on with
   8 questions (the author can change it); once the lecture is saved, the page goes straight to the class game's
   setup with that lecture's test (no stop on the results).

## How a lecture becomes a test (one per lecture, never a pile)

- The questions: POST /api/tests/from-lecture (existing; no model, no units; each question with its quote).
- The test: saveQuick (container_create kind 'test', title = the lecture's title, container_items_add) with
  deterministic refs `lec:<material_id>:<n>`. Before creating, the client looks for the author's test item whose
  import_ref starts with `lec:<material_id>:` and reuses its test; a resent batch is a no-op (refs). A lecture whose
  self-test changed («Тест заново») adds its new questions to the same test.
- No migration: refs fit test_items_import_ref_check (`^[A-Za-z0-9_:.-]{1,80}$`).

## Errors

- No self-test questions (the self-test was off or empty): the sheet says so and offers «Сделать самопроверку»
  (the existing «Раздел заново», priced as today).
- from-lecture or saving fails: the sheet's line in plain words, «Повторить»; nothing half-made is left behind
  (saveQuick resumes from the failed step).
- Fewer than 3 playable questions: the setup page's own message (MIN_GAME_QUESTIONS), as today.

## Measured goals

- An existing lecture → the game's room with a QR: ≤ 5 s on the owner's laptop.
- A photo of a page → the room with a QR: ≤ 60 s (OCR + analysis 4–21 s measured 11.10, + the steps above).

## Testing

- Unit: the lecture → test lookup and refs (reuse, resend, a changed self-test), GamePicker's lectures group.
- Component: the «Сыграть» chip and sheet (three paths, the no-questions case), Analyze with `?then=game` (forward
  after save, no forward without it).
- A browser check of the whole path with the fake API: photo → lecture → setup page → room.
- The full gate before release.

## Later (not in this release)

- On the projector, after each answer, the lecture sentence the question came from («вот откуда вопрос»).
- The analysis running the self-test first when `then=game`.
