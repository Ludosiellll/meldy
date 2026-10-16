# Question editor (release 45) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The author of an exam edits a question's text, options, key and pictures and adds new questions on «Вопросы и ключи» (`/exams/c/:id/keys`).

**Architecture:** The server already updates items through `container_item_update` (owner-only, the `test_items_guard` trigger bumps `rev`); a migration lets it take `images`. The frontend gets a pure `editorModel.ts` (draft ↔ item, patch, checks, search), `pictureFromFile` in `api/itemPictures.ts`, and a `QuestionEditor` component used by `KeysPage` for «Изменить» and «Добавить вопрос».

**Tech Stack:** PostgreSQL 16 (Supabase), React 18 + TypeScript, Vitest + Testing Library.

**Spec:** `/home/user/meldy-notes/10_Project/Quiz_and_Editor_Spec_2026-10-16.md`, part 1.

## Global Constraints

- DB limits (CHECKs): stem 1–4000 chars after trim; options 2–8 strings, each 1–600, ≤ 8 KB in all; short answers 1–10 forms, each 1–200; images `{"stem": ≤8 paths, "options": ≤20 lists of ≤4}`, paths `<container id>/<64 hex>.(png|jpg|gif|webp|bmp)`.
- A change of kind, option count, sorted key or set of normalized forms bumps `rev` (everyone's progress on that question restarts, decision 15). A typo fix never does.
- Pictures go to the private bucket `test-item-images`; ≤ 3 MB; the browser shrinks a bigger picture or one wider/taller than 2000 px to JPEG before upload.
- A stem that is only a picture is saved as `PICTURE_STEM` («Вопрос на картинке»), an option that is only a picture as `pictureOption(letter)` («Рисунок Б») — `types/container.ts`.
- `types/container.ts` is copied to the bot (`supabase/functions/_shared/plan/container.ts`): after changing it run `node scripts/sync_bot_plan.mjs`; the release gate runs `--check`.
- Words on screen: Russian, plain, no AI tells. The page is «Вопросы и ключи»; the menu item too.
- Migrations: re-runnable, rollback in `supabase/rollback/<ts>_<name>_down.sql`, rehearsed locally (`supabase/tests/local/*_run.sh`) before the live apply.

## Review Focus

1. An author removes an option that was the key → the key indices must shift with the options (removing option 2 of [А,Б,В] with key В saves key index 1, not 2), pictures of options shift too.
2. Paste of a screenshot into the option field → goes to that option, not the stem; paste of plain text → normal text paste, no picture.
3. Saving with nothing changed → no request, the editor just closes.
4. A phone photo of 6 MB / 4000 px → shrunk and saved, not refused.
5. Editing a question while it is open in the queue («Проверить N вопросов») → the queue shows the edited text after save, the position in the queue stays.

---

### Task 1: `container_item_update` takes `images`

**Files:**
- Create: `supabase/migrations/20261016100000_item_update_images.sql`
- Create: `supabase/rollback/20261016100000_item_update_images_down.sql` (the function exactly as in `20261009093500_containers.sql:1622-1698`)
- Create: `supabase/tests/item_update_images.sql` (contract: the function's source mentions `images`)
- Create: `supabase/tests/local/item_update_images_behaviour.sql`, `supabase/tests/local/item_update_images_run.sh` (copy of `plan_tempo_run.sh` pattern: base → migration ×2 → behaviour → containers contract/behaviour → rollback ×2 → migration → behaviour)
- Modify: `frontend/src/types/container.ts:319` — `ItemPatch` gains `'images'`

**Interfaces:**
- Produces: `container_item_update(p_item_id uuid, p_patch jsonb)` accepts `images` (object). Rejects with 22023 `invalid patch`, detail `images`, when `images` is not an object or `images.options` has more lists than the item's options after the patch. The table CHECK `meldy_images_ok(images, container_id)` stays the shape/folder guard (its violation → 22023 with `detail = sqlerrm`). `ItemPatch.images?: ItemImages`.

- [ ] **Step 1: Behaviour test** (`item_update_images_behaviour.sql`, prints `ITEM IMAGES CHECKS PASSED`): as the owner — patch `{"images": {"stem": ["<c>/<64 hex>.png"]}}` → row has it, `rev` unchanged; patch with a path in another container's folder → 22023; `{"images": {"options": [[],[],[]]}}` on a 2-option item → 22023 detail `images`; `{"images": "x"}` → 22023; options + images together (3 options, 3 lists) → saved; as a member → P0002.
- [ ] **Step 2: Run** `bash supabase/tests/local/item_update_images_run.sh` → FAIL at «behaviour» (images ignored).
- [ ] **Step 3: Migration**: `create or replace` the function with the body of the original plus the `images` pre-check and `images = case when p_patch ? 'images' then p_patch -> 'images' else i.images end` in the update; after the update, `if v_new.images ? 'options' and jsonb_array_length(v_new.images -> 'options') > jsonb_array_length(v_new.options)` → raise 22023 detail `images`. Grants unchanged (`create or replace` keeps them).
- [ ] **Step 4: Run** the rehearsal → every line `ok`, `failures: 0`.
- [ ] **Step 5:** `ItemPatch` gains `'images'`; `node scripts/sync_bot_plan.mjs`; `cd frontend && npx tsc -b` clean.
- [ ] **Step 6: Commit** `Item update takes pictures (migration, rehearsal, contract)`.

### Task 2: `editorModel.ts`

**Files:**
- Create: `frontend/src/components/containers/keys/editorModel.ts`
- Test: `frontend/src/components/containers/keys/editorModel.test.ts`

**Interfaces:**
- Produces:
  - `interface DraftOption { text: string; pictures: string[] }`
  - `interface Draft { stem: string; stemPictures: string[]; code: boolean; keepOrder: boolean; short: boolean; options: DraftOption[]; correct: number[]; forms: string }`
  - `draftOf(item: TestItem): Draft` — `isPictureWord` texts become `''` (the picture stands for them); `forms` = `answers.join('; ')`.
  - `emptyDraft(): Draft` — two empty options, not short.
  - `removeOption(draft: Draft, index: number): Draft` — drops the option and its pictures, shifts `correct` (removed index leaves the key).
  - `type DraftProblem = 'stem' | 'stem_long' | 'option_empty' | 'option_long' | 'options_few' | 'options_many' | 'options_size' | 'forms' | 'form_long'`
  - `draftProblems(draft: Draft): DraftProblem[]`
  - `stemText(draft): string`, `optionTexts(draft): string[]` — the words to save (picture-only → `PICTURE_STEM` / `pictureOption(letter(i))`).
  - `patchOf(item: TestItem, draft: Draft): ItemPatch | null` — only changed fields; kind `'short'` stays short; choice → `'multiple'` when `correct.length ≥ 2`, else `'single'`; `images` sent when any picture list changed, as `{stem, options}` (options lists aligned with options; empty object parts kept as `[]`).
  - `resetsProgress(item: TestItem, patch: ItemPatch): boolean` — the trigger's rule (kind, option count, sorted key, set of trimmed lower-cased forms).
  - `nextFileNo(items: TestItem[], subjectId: string): string` — 1 + the largest whole-number `file_no` of the subject; `'1'` when none.
  - `inputOf(draft: Draft, fileNo: string, ref: string): ItemInput` — `key_source: 'manual'` when keyed, else `'none'`.
  - `searchItems(items: TestItem[], query: string): TestItem[]` — every word of the query (lower case, ё→е) is in stem + options.

- [ ] **Step 1: Tests**: `draftOf` of a picture-only stem gives `stem: ''` and its pictures; `removeOption(draft key [2] of 3, 1)` → key `[1]`, pictures shifted; `draftProblems` on `''` stem without pictures → `['stem']`, with a picture → `[]`; 1 option → `options_few`; 9 → `options_many`; option of 601 chars → `option_long`; `patchOf` with unchanged draft → `null`; only stem changed → `{stem}`; two ticked → `{correct:[0,2], kind:'multiple'}`; picture added → `{images:{stem:[p], options:[[],[],[]]}}`; `resetsProgress(item, {stem})` false, `({correct:[1]})` true when key was `[0]`, `({options: same length})` false, `({options: one more})` true; `nextFileNo` over `['1','2','10','3a']` → `'11'`; `searchItems` «грюнвальд битв» finds «Грюнвальдская битва» option item, «ёж» finds «ежи».
- [ ] **Step 2: Run** `cd frontend && npx vitest run src/components/containers/keys/editorModel.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement** the module.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `Editor model: draft, patch, checks, search`.

### Task 3: `pictureFromFile`

**Files:**
- Modify: `frontend/src/api/itemPictures.ts`
- Test: `frontend/src/api/itemPictures.test.ts` (create if missing)

**Interfaces:**
- Produces: `pictureFromFile(file: Blob, deps?: { shrink?: (file: Blob) => Promise<Blob> }): Promise<{ id: string; picture: BankPicture } | 'type' | 'size'>` — `'type'` for anything but PNG/JPEG/GIF/WebP/BMP; a file over 3 MB or over 2000 px per side goes through `shrink` (default: `createImageBitmap` → canvas scaled to ≤ 2000 px → `image/jpeg` 0.85); `'size'` if still over 3 MB. `id` = sha256 hex of the bytes (`crypto.subtle.digest`). Also `MAX_PICTURE_BYTES = 3 * 1024 * 1024`.

- [ ] **Step 1: Tests**: a 10-byte PNG blob → id is 64 hex and `picture.type === 'image/png'`, base64 round-trips; `text/plain` → `'type'`; a 4 MB blob with a `shrink` stub returning a 1 KB JPEG → type `image/jpeg`; a stub returning 4 MB → `'size'`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `Pictures from a file or the clipboard`.

### Task 4: `QuestionEditor`

**Files:**
- Create: `frontend/src/components/containers/keys/QuestionEditor.tsx`
- Modify: `frontend/src/components/containers/keys/keys.css`, `frontend/src/components/containers/copyImport.ts` (new `EDITOR` words)
- Test: `frontend/src/components/containers/keys/QuestionEditor.test.tsx`

**Interfaces:**
- Consumes: Task 2 model, Task 3 `pictureFromFile`, `picturePath`, `uploadPicture`, `ItemPictures`/`storedPictures`.
- Produces: `<QuestionEditor containerId item={TestItem | null} letters={(i) => string} group={boolean} busy={boolean} onSave={(draft: Draft) => void} onCancel={() => void} upload?={(path, picture) => Promise<'kept'|'refused'>} />` — `item === null` is a new question.
- Words (`EDITOR` in `copyImport.ts`): `stem: 'Текст вопроса'`, `code: 'В вопросе код — показывать как есть'`, `addPicture: 'Добавить картинку'`, `removePicture: 'Убрать картинку'`, `option: (l) => \`Вариант ${l}\``, `right: 'Верный'`, `addOption: 'Добавить вариант'`, `removeOption: 'Убрать вариант'`, `keepOrder: 'Не перемешивать варианты'`, `forms: 'Принятые ответы через «;»'`, `save: 'Сохранить'`, `cancel: 'Отмена'`, `resets: 'Ключ или число вариантов меняется: у участников этот вопрос начнётся заново.'`, `noKey: 'Без отмеченного верного варианта вопрос не попадёт в занятия.'`, `pasteHint: 'Картинку можно вставить: Ctrl+V'`, problem lines per `DraftProblem`, `pictureType: 'Такой файл не картинка. Подойдут PNG, JPEG, GIF, WebP.'`, `pictureSize: 'Картинка больше 3 МБ даже после сжатия.'`, `pictureFailed: 'Картинка не сохранилась. Попробуйте ещё раз.'`.

- [ ] **Step 1: Tests**: editing an item shows its stem and options; typing a new stem and «Сохранить» calls `onSave` with the draft; «Убрать вариант» on the keyed option removes the key line «Верный»; a pasted PNG into option 2's field calls `upload` with `<container>/<sha>.png` and shows the thumbnail under option 2; `group` + key change shows `EDITOR.resets`; with 1 option «Сохранить» is disabled and the problem line is shown.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (layout: one white card like `.kq`; the stem `textarea` grows; each option row = radio/checkbox «Верный» + input + picture button + «×»; mobile: the picture and «×» buttons wrap under the input at < 480 px). **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `Question editor`.

### Task 5: «Вопросы и ключи»: edit, add, search

**Files:**
- Modify: `frontend/src/pages/container/KeysPage.tsx`, `KeysPage.css`, `frontend/src/components/containers/copyImport.ts` (`KEYS.title`/`docTitle` → «Вопросы и ключи», `findTitle` → «Найти вопрос по номеру или словам», `findPlaceholder` → «134 или слова из вопроса», `add: 'Добавить вопрос'`, `edit: 'Изменить'`, `added: (no) => \`Вопрос № ${no} добавлен.\``, `edited: 'Сохранено.'`, `found: (n) => …`, `more: 'Показать ещё'`), `frontend/src/components/containers/copy.ts` (`MENU_KEYS` → «Вопросы и ключи», `menuKeysWaiting`)
- Test: `frontend/src/pages/container/KeysPage.test.tsx` (extend; mock `addItems` too)

**Interfaces:**
- Consumes: Task 4 component; `updateItem`, `addItems` from `api/containers`; Task 2 `patchOf`, `inputOf`, `nextFileNo`, `searchItems`.

- [ ] **Step 1: Tests**: «Изменить» on a found question opens the editor; saving a new stem calls `updateItem(id, {stem})` and the card shows the new stem and «Сохранено.»; an unchanged save calls nothing; «Добавить вопрос» for subject 2 then save calls `addItems(SUBJECT_2, [input with file_no '4' and ref /^man:/])` and reloads; the search «Грюнвальд» lists the subject-2 item; the menu label reads «Вопросы и ключи».
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**: the find input treats `^\s*№?\s*[\d.]+\s*$` as a number, anything else as words (30 results, «Показать ещё» +30); an editor replaces the card in place (also inside the queue); after `updateItem` the local `patched` map takes the new stem/options/correct/answers/kind/images so the queue and lists re-render; after `addItems`, `data.reload()` and the new question opens by its number. **Step 4: Run** the page tests and the whole suite → PASS.
- [ ] **Step 5: Commit** `«Вопросы и ключи»: edit, add and search questions`.

### Task 6: Verify and release 45

- [ ] `cd frontend && npx vitest run` (all green), `npx tsc -b`, `npm run build`; `node scripts/sync_bot_plan.mjs --check`; bot tests as in the release gate.
- [ ] Apply the migration live (Supabase MCP `apply_migration`) after md5 of the live `container_item_update` body equals the repo's original; then `supabase/tests/item_update_images.sql` live → ok.
- [ ] `deploy/hf-release.md` top entry «45 — редактор вопросов» → push → deploy-hf.yml green → live bundle changed.
- [ ] Live check (account B): edit text (no rev change), add a picture by file and by paste, add a question, search by words, on 1532 and 390; then revert the test edits.
