# Hugging Face releases

Each change to this file on `claude/relaxed-hypatia-1tpmq5` runs `.github/workflows/deploy-hf.yml`:
the live Space `main` is tagged `hf-backup-<UTC>-pre-push`, then the released tree (without `qa-screens/`)
is pushed on top of it, and the job waits for `RUNNING` and checks `/` and `/api/health`.

## 2026-10-04 — Meldy for the hackathon (from e366fa7)

Replaces the live version f3b94ba (2026-09-24, still branded StudyForge).

- Meldy name everywhere, secondary features out of the menu, dead code removed.
- New landing «Строчка → карточка»; paper-desk top bar and screens.
- «Разговор»: two hosts with synced diagrams, charts and terms.
- Analysis always ends (full, partial with «Создать заново», or a readable error); nothing is saved or charged
  without a core section; paste-text input; no made-up grades; models and timeouts from env.
- Answer journal (`learning_events`), quiz results and mistakes saved, honest «Прогресс».
- «Билеты»: question list mapped to the student's lectures, share of tickets, «Тянуть билет».
- «Ответ вслух»: spoken answer, code-verified quotes, follow-up on the missed point, protocol.

Database: migration `20261003083154_hackathon_journal_exams_oral` was applied on 2026-10-03 (additive; the old
client keeps working).

Verified before release: tsc -b, Vitest 1169/1169, pytest 681, production build, isolated frontend build as in
the Docker image, three rounds of browser QA on mocked Supabase/API. Not verified: live AI providers and real
speech recognition (no keys in the build environment) — check right after the release.
