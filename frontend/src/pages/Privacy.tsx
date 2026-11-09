import { Link } from 'react-router-dom';
import '../styles/paper.css';
import '../components/oral/oral.css';
import '../components/example/example.css';
import './Privacy.css';
import TryBar from '../components/example/TryBar';
import { useAuth } from '../hooks/useAuth';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { SUPPORT_LABEL, supportUrl } from '../lib/support';
import { DELETION_DAYS } from '../components/account/AccountData';

/**
 * /privacy — «Данные и приватность» (audit of 07.11: the app said nowhere what it keeps, who sees it and how to have
 * it deleted; the owner, 09.11). Open without signing in: the landing, the sign-up page and «Профиль» link here. Every
 * sentence states what the code does, and each has its source beside it — when one of those changes, this page changes
 * with it (pages/Privacy.test.tsx pins the sentences that other screens also say).
 *
 * - what is kept: docs/analytics.md (statistics), lib/oral/answerTexts.ts (answer texts by consent), pages/ExamTicket.tsx
 *   PRIVACY_LINE (no voice recording; the checks and short excerpts);
 * - who sees what: docs/answers-privacy.md, components/containers/copyImport.ts JOIN.lede (the author sees the name and
 *   the group's numbers without names), components/quiz/copyTake.ts `privacy` (a контрольная's author sees the name,
 *   the answers and the result);
 * - who processes: Supabase (the project's region eu-north-1), the Hugging Face Space, Google Gemini and Groq
 *   (backend/agents), the browser's speech recognition, Microsoft's read-aloud voices (backend/edge_voice.py), Jina
 *   Reader for a page by link (backend/utils.py scrape_url), Telegram for the bot;
 * - deleting: components/account/AccountData.tsx (a request, done by hand within DELETION_DAYS).
 */
export const PRIVACY_UPDATED = '9 ноября 2026';

export const PRIVACY = {
  title: 'Данные и приватность',
  lede: 'Что Meldy хранит, кто это видит и как это удалить.',
  kept: {
    title: 'Что хранится',
    items: [
      'Аккаунт: почта, имя и фото профиля, если вы их указали.',
      'Лекции: текст, который вы загрузили, и то, что из него сделал Meldy, — конспект, карточки, самопроверка, подкаст.',
      'Экзамены и тесты: вопросы и ответы из ваших файлов.',
      'Ваши ответы и прогресс: на какие вопросы вы ответили, верно или нет и когда.',
      'Устные ответы: итоги проверки по пунктам и короткие отрывки ответа. Запись голоса не хранится. Полный текст ответа хранится, только если вы включили «Сохранять текст ответов» в профиле.',
      'Статистика использования и отчёты об ошибках: какой экран открыт, тип устройства, версия приложения. Тексты лекций и ответы туда не попадают.',
    ],
  },
  seen: {
    title: 'Кто что видит',
    items: [
      'Ваши ответы на занятиях видите только вы.',
      'Автор экзамена, в который вы вошли по ссылке группы, видит ваше имя среди вошедших и общие цифры группы без имён: сколько человек занимается и какие темы трудные.',
      'В контрольной автор видит ваше имя, ответы и результат: так устроена контрольная, и об этом сказано перед началом.',
      'В игре на паре, дуэли и соревновании имя, которое вы ввели, и очки видят участники этой игры.',
    ],
  },
  sent: {
    title: 'Кто помогает Meldy работать',
    lede: 'Meldy передаёт данные другим сервисам только затем, чтобы сделать то, о чём вы попросили.',
    items: [
      'База данных и вход — Supabase, серверы в Европейском союзе (Стокгольм).',
      'Сайт и сервер — Hugging Face Spaces.',
      'Разбор лекций и проверка ответов — Google Gemini, запасной сервис — Groq: туда уходит текст лекции или ответа.',
      'Распознавание речи — ваш браузер (в Chrome это сервис Google) или Groq.',
      'Озвучка вопросов и подкаста — сервис чтения вслух Microsoft: туда уходит текст, который нужно прочитать.',
      'Страницу по ссылке читает сервис Jina Reader, видео YouTube — Google Gemini.',
      'Бот Meldy работает в Telegram: то, что вы пишете боту, проходит через Telegram.',
      'Вход через Google: Google сообщает Meldy вашу почту и имя.',
    ],
    foot: 'Рекламы и чужих счётчиков на сайте нет: статистику Meldy ведёт сам, в своей базе.',
  },
  remove: {
    title: 'Как удалить',
    items: [
      'Лекцию, экзамен или тест — в их меню «Ещё».',
      'Сохранённые тексты устных ответов — в профиле, «Проверка точности Meldy».',
      `Аккаунт целиком — в профиле, «Аккаунт и данные» → «Запросить удаление». Удаляем в течение ${DELETION_DAYS} дней; до этого запрос можно отменить.`,
    ],
  },
  write: {
    title: 'Как написать',
    text: 'Напишите боту Meldy в Telegram: он передаст сообщение автору, ответ придёт туда же.',
  },
  toProfile: 'Открыть профиль',
  updated: `Обновлено ${PRIVACY_UPDATED}.`,
} as const;

function List({ items }: { items: readonly string[] }) {
  return (
    <ul className="pv-list">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

export default function Privacy() {
  const { user } = useAuth();
  useDocumentTitle(PRIVACY.title);
  return (
    <div className="tx-shell pv-shell">
      <TryBar where={PRIVACY.title} />
      <main className="sf-page pv-page">
        <header className="sf-head pv-head">
          <div>
            <h1 className="sf-h1">{PRIVACY.title}</h1>
            <p className="sf-lede">{PRIVACY.lede}</p>
          </div>
        </header>
        <section className="pv-card" aria-labelledby="pv-kept">
          <h2 id="pv-kept" className="pv-h2">
            {PRIVACY.kept.title}
          </h2>
          <List items={PRIVACY.kept.items} />
        </section>
        <section className="pv-card" aria-labelledby="pv-seen">
          <h2 id="pv-seen" className="pv-h2">
            {PRIVACY.seen.title}
          </h2>
          <List items={PRIVACY.seen.items} />
        </section>
        <section className="pv-card" aria-labelledby="pv-sent">
          <h2 id="pv-sent" className="pv-h2">
            {PRIVACY.sent.title}
          </h2>
          <p className="pv-p">{PRIVACY.sent.lede}</p>
          <List items={PRIVACY.sent.items} />
          <p className="pv-p">{PRIVACY.sent.foot}</p>
        </section>
        <section className="pv-card" aria-labelledby="pv-remove">
          <h2 id="pv-remove" className="pv-h2">
            {PRIVACY.remove.title}
          </h2>
          <List items={PRIVACY.remove.items} />
          {user ? (
            <p className="pv-p">
              <Link className="sf-link" to="/profile">
                {PRIVACY.toProfile}
              </Link>
            </p>
          ) : null}
        </section>
        <section className="pv-card" aria-labelledby="pv-write">
          <h2 id="pv-write" className="pv-h2">
            {PRIVACY.write.title}
          </h2>
          <p className="pv-p">{PRIVACY.write.text}</p>
          <p className="pv-p">
            <a className="sf-link" href={supportUrl()} target="_blank" rel="noreferrer">
              {SUPPORT_LABEL}
            </a>
          </p>
        </section>
        <p className="pv-updated">{PRIVACY.updated}</p>
      </main>
    </div>
  );
}
