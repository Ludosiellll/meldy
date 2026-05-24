"""Скрипт для обновления ALL_CODE.txt — собирает весь код проекта + таблицы Supabase."""
import os

ROOT = r"d:\Для пробной"
OUT = os.path.join(ROOT, "ALL_CODE.txt")

# Список файлов в нужном порядке
FILES = [
    "Dockerfile",
    "nginx.conf",
    "README.md",
    "README_HF.md",
    "start.bat",
    "backend/requirements.txt",
    "backend/main.py",
    "backend/parser.py",
    "backend/agents/__init__.py",
    "backend/agents/base.py",
    "backend/agents/coordinator.py",
    "frontend/package.json",
    "frontend/index.html",
    "frontend/vite.config.ts",
    "frontend/tsconfig.json",
    "frontend/tailwind.config.js",
    "frontend/postcss.config.js",
    "frontend/src/main.tsx",
    "frontend/src/index.css",
    "frontend/src/types.ts",
    "frontend/src/demo.ts",
    "frontend/src/App.tsx",
    "frontend/src/lib/supabase.ts",
    "frontend/src/contexts/AuthContext.tsx",
    "frontend/src/hooks/useAuth.ts",
    "frontend/src/hooks/useHistory.ts",
    "frontend/src/api/materials.ts",
    "frontend/src/api/flashcards.ts",
    "frontend/src/api/quests.ts",
    "frontend/src/components/Layout.tsx",
    "frontend/src/components/Header.tsx",
    "frontend/src/components/UploadZone.tsx",
    "frontend/src/components/AgentCards.tsx",
    "frontend/src/components/ResultsPanel.tsx",
    "frontend/src/components/SummaryView.tsx",
    "frontend/src/components/FlashcardsView.tsx",
    "frontend/src/components/QuizView.tsx",
    "frontend/src/components/HistoryPanel.tsx",
    "frontend/src/components/SettingsPanel.tsx",
    "frontend/src/components/ExpressPrepView.tsx",
    "frontend/src/pages/Landing.tsx",
    "frontend/src/pages/Login.tsx",
    "frontend/src/pages/Register.tsx",
    "frontend/src/pages/AuthCallback.tsx",
    "frontend/src/pages/Dashboard.tsx",
    "frontend/src/pages/Analyze.tsx",
    "frontend/src/pages/Library.tsx",
    "frontend/src/pages/MaterialDetail.tsx",
    "frontend/src/pages/Review.tsx",
    "frontend/src/pages/Planner.tsx",
    "frontend/src/pages/Chat.tsx",
    "frontend/src/pages/Missions.tsx",
    "frontend/src/pages/ProfessorExam.tsx",
    "frontend/src/pages/MistakeDiary.tsx",
    "frontend/src/pages/MoodTracker.tsx",
]

SUPABASE_SCHEMA = r"""================================================================================
SUPABASE SCHEMA — Project: StudyForge (daunnytubqbzafjnpfnw)
================================================================================

-- 1. materials — Проанализированные материалы
CREATE TABLE materials (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title           text NOT NULL DEFAULT '',
  subject         text NOT NULL DEFAULT '',
  original_text   text NOT NULL DEFAULT '',
  summary_json    jsonb,
  flashcards_json jsonb,
  quiz_json       jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE materials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own materials" ON materials FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own materials" ON materials FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own materials" ON materials FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own materials" ON materials FOR DELETE USING (auth.uid() = user_id);
CREATE INDEX idx_materials_user_id ON materials(user_id);

-- 2. profiles — Профиль пользователя (автосоздание при регистрации)
CREATE TABLE profiles (
  id               uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name        text NOT NULL DEFAULT '',
  streak_days      int NOT NULL DEFAULT 0,
  last_active_date date,
  total_reviews    int NOT NULL DEFAULT 0,
  total_materials  int NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- 3. flashcard_progress — Spaced repetition (SM-2)
CREATE TABLE flashcard_progress (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  material_id     uuid NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  question        text NOT NULL DEFAULT '',
  answer          text NOT NULL DEFAULT '',
  ease_factor     real NOT NULL DEFAULT 2.5,
  interval_days   int NOT NULL DEFAULT 1,
  repetitions     int NOT NULL DEFAULT 0,
  next_review     timestamptz NOT NULL DEFAULT now(),
  last_reviewed_at timestamptz
);
ALTER TABLE flashcard_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own progress" ON flashcard_progress FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own progress" ON flashcard_progress FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own progress" ON flashcard_progress FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own progress" ON flashcard_progress FOR DELETE USING (auth.uid() = user_id);
CREATE INDEX idx_flashcard_progress_user ON flashcard_progress(user_id);
CREATE INDEX idx_flashcard_progress_next ON flashcard_progress(user_id, next_review);

-- 4. subjects — Предметы для планировщика
CREATE TABLE subjects (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name       text NOT NULL DEFAULT '',
  exam_date  date,
  color      text NOT NULL DEFAULT '#4F46E5',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE subjects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own subjects" ON subjects FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own subjects" ON subjects FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own subjects" ON subjects FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own subjects" ON subjects FOR DELETE USING (auth.uid() = user_id);
CREATE INDEX idx_subjects_user ON subjects(user_id);

-- 5. study_plans — Планы подготовки
CREATE TABLE study_plans (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title      text NOT NULL DEFAULT '',
  subject    text NOT NULL DEFAULT '',
  exam_date  date,
  notes      text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE study_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own plans" ON study_plans FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own plans" ON study_plans FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own plans" ON study_plans FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own plans" ON study_plans FOR DELETE USING (auth.uid() = user_id);
CREATE INDEX idx_study_plans_user ON study_plans(user_id);

-- 6. chat_messages — AI-чат по материалам
CREATE TABLE chat_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  material_id uuid REFERENCES materials(id) ON DELETE CASCADE,
  role        text NOT NULL CHECK (role IN ('user', 'assistant')),
  content     text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own messages" ON chat_messages FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own messages" ON chat_messages FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own messages" ON chat_messages FOR DELETE USING (auth.uid() = user_id);
CREATE INDEX idx_chat_messages_user ON chat_messages(user_id);
CREATE INDEX idx_chat_messages_material ON chat_messages(material_id);

-- 7. study_sessions — Сессии повторения (для streak и графиков)
CREATE TABLE study_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date            date NOT NULL DEFAULT CURRENT_DATE,
  cards_reviewed  int NOT NULL DEFAULT 0,
  materials_added int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, date)
);
ALTER TABLE study_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own sessions" ON study_sessions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own sessions" ON study_sessions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own sessions" ON study_sessions FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own sessions" ON study_sessions FOR DELETE USING (auth.uid() = user_id);
CREATE INDEX idx_study_sessions_user ON study_sessions(user_id);

-- 8. exam_sessions — Сессии AI-экзаменатора
CREATE TABLE exam_sessions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  material_id      uuid REFERENCES materials(id) ON DELETE CASCADE,
  subject          text NOT NULL DEFAULT '',
  questions_json   jsonb NOT NULL DEFAULT '[]',
  total_questions  int NOT NULL DEFAULT 0,
  score            int NOT NULL DEFAULT 0,
  status           text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz
);
ALTER TABLE exam_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own exams" ON exam_sessions FOR ALL USING (auth.uid() = user_id);

-- 9. mistake_diary — Дневник ошибок
CREATE TABLE mistake_diary (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  material_id      uuid REFERENCES materials(id) ON DELETE CASCADE,
  exam_session_id  uuid REFERENCES exam_sessions(id) ON DELETE SET NULL,
  question         text NOT NULL,
  correct_answer   text NOT NULL,
  student_answer   text NOT NULL DEFAULT '',
  topic            text NOT NULL DEFAULT '',
  is_resolved      boolean NOT NULL DEFAULT false,
  resolved_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE mistake_diary ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own mistakes" ON mistake_diary FOR ALL USING (auth.uid() = user_id);

-- 10. mood_log — Трекер настроения
CREATE TABLE mood_log (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mood             text NOT NULL CHECK (mood IN ('great', 'good', 'okay', 'tired', 'stressed')),
  energy_level     int NOT NULL DEFAULT 3 CHECK (energy_level >= 1 AND energy_level <= 5),
  notes            text DEFAULT '',
  recommended_mode text DEFAULT '',
  logged_at        date NOT NULL DEFAULT CURRENT_DATE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, logged_at)
);
ALTER TABLE mood_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own mood" ON mood_log FOR ALL USING (auth.uid() = user_id);

-- 11. quests — Справочник квестов
CREATE TABLE quests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  description text NOT NULL,
  xp_reward   int NOT NULL DEFAULT 10,
  type        text NOT NULL CHECK (type IN ('daily', 'weekly')),
  target_type text NOT NULL, -- 'analyze', 'quiz', 'chat', 'mood', 'exam', 'review', 'podcast'
  target_count int NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 12. user_quest_progress — Прогресс пользователя в квестах
CREATE TABLE user_quest_progress (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  quest_id      uuid NOT NULL REFERENCES quests(id) ON DELETE CASCADE,
  current_count int NOT NULL DEFAULT 0,
  is_completed  boolean NOT NULL DEFAULT false,
  completed_at  timestamptz,
  reset_at      date NOT NULL, -- Дата, когда квест должен сброситься
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, quest_id, reset_at)
);

ALTER TABLE quests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Quests are readable by all authenticated users" ON quests FOR SELECT USING (auth.role() = 'authenticated');

ALTER TABLE user_quest_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own quest progress" ON user_quest_progress FOR ALL USING (auth.uid() = user_id);

-- Триггер: автосоздание профиля при регистрации
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS 
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''));
  RETURN NEW;
END;
 LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
"""


def main():
    lines = []
    for rel_path in FILES:
        abs_path = os.path.join(ROOT, rel_path.replace("/", os.sep))
        if not os.path.isfile(abs_path):
            print(f"  SKIP (not found): {rel_path}")
            continue

        with open(abs_path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()

        lines.append("=" * 80)
        lines.append(f"FILE: {rel_path}")
        lines.append("=" * 80)
        lines.append(content.rstrip())
        lines.append("")

    # Supabase schema в конце
    lines.append(SUPABASE_SCHEMA.rstrip())
    lines.append("")

    result = "\n".join(lines)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(result)

    print(f"Done! {OUT} — {len(result)} chars, {len(FILES)} files + schema")


if __name__ == "__main__":
    main()
