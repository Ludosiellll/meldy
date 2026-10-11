# Статистика и отчёты об ошибках (2026-10-05)

Meldy сам записывает, какими экранами и функциями пользуются и какие ошибки случаются. Всё хранится в нашей
базе Supabase, в таблице `public.app_events`. Сторонних сервисов нет: ни Яндекс Метрики, ни Sentry, ни чужих
скриптов. Браузер отправляет события только на наш сайт (`POST /api/telemetry`), сервер — только в нашу базу.

Из чего это сделано:

- `frontend/src/lib/telemetry.ts` — запись событий в браузере;
- `backend/telemetry_api.py` — приём `POST /api/telemetry` и ошибки сервера;
- `supabase/migrations/20261005042323_app_telemetry.sql` — таблица, функция записи и представления для чтения;
- `supabase/tests/app_telemetry.sql` — проверка после применения миграции (`contract_ok`).

## Что записывается

Одна строка — одно событие:

| Поле | Что в нём |
| --- | --- |
| `created_at` | время сервера |
| `kind` | `event` — действие, `client_error` — ошибка в браузере, `server_error` — ошибка сервера |
| `name` | имя события, например `lecture_ready` (список ниже) |
| `route` | шаблон адреса экрана: `/exams/:id/ticket`, у ошибок сервера — `/api/exams/{exam_id}/map` |
| `session` | случайный номер вкладки браузера; живёт, пока открыта вкладка |
| `user_id` | аккаунт, если человек вошёл; ставит сама база по токену входа, браузер его не передаёт |
| `device` | `mobile`, `tablet` или `desktop` — по ширине экрана и типу указателя |
| `app_version` | версия сборки (время сборки, например `20261005.1342`, или `VITE_APP_VERSION`); `dev` — локальная разработка |
| `props` | несколько коротких значений события: формат файла, число вопросов корзиной, причина |
| `message`, `stack` | только у ошибок: текст ошибки (до 500 знаков) и стек (до 4000 знаков) |

## Что не записывается

- IP-адрес и строка браузера (user-agent): в события они не попадают.
- Тексты лекций, конспектов, вопросов, ответов и разговоров. В событиях только счётчики и коды.
- Номера материалов, экзаменов и вопросов в адресах: вместо них `:id`. Параметры адреса (`?q=…`) отбрасываются.
- Почта, имя и другие данные профиля.
- Тела запросов и текст исключений сервера: у ошибки сервера есть только класс исключения (`KeyError`),
  места в коде (`main.py:441 in _guarded`) и код ошибки, который видит пользователь.

В тексте ошибок браузера перед отправкой вырезаются адреса почты, номера записей, параметры ссылок и длинные
фрагменты в кавычках: так в отчёт не попадает кусок пользовательского текста из сообщения об ошибке.

Если браузер отправляет сигнал Do Not Track, действия не записываются совсем. Ошибки записываются и тогда: без
них сайт не починить.

На сайте об этом сказано одной фразой, в подвале главной страницы и в профиле: «Чтобы улучшать сервис, Meldy
записывает статистику использования и отчёты об ошибках — без текстов лекций и ответов.» Слово «анонимно» там
нарочно не стоит: события вошедшего человека связаны с его аккаунтом.

## Как это работает

1. Браузер копит события и отправляет их пачкой: не чаще раза в 5 секунд, сразу при 50 событиях и всё, что
   осталось, когда вкладку скрывают или закрывают. Запрос идёт через общую обёртку `fetch` (`lib/apiAuth.ts`),
   поэтому вошедший пользователь отправляет его со своим токеном.
2. `POST /api/telemetry` открыт и без входа (как `/api/health`): статистика нужна и по главной странице, и по
   примеру `/try`. Сервер проверяет пачку (до 50 событий, до 32 КБ), убирает лишние поля и передаёт её в базу
   функцией `public.log_app_events` — с токеном пользователя или с публичным ключом, если входа нет. Ответ —
   204, что бы ни случилось дальше (кроме 413 для пачки больше 32 КБ и 429 при превышении частоты): сбой
   статистики не ломает страницу.
3. Функция в базе ещё раз проверяет каждое событие, ставит `user_id` по токену и ограничивает объём: не больше
   3000 строк в сутки (UTC) на аккаунт и 50 000 строк в сутки от всех, кто не вошёл. Лишнее отбрасывается.
4. Ограничение частоты на сервере: 30 запросов в минуту и 2000 в сутки на аккаунт (у тех, кто не вошёл, — на
   вкладку), и не больше 600 в минуту с одного адреса.
5. Ошибки сервера пишет сам сервер, в фоне, не задерживая ответ: не больше 60 в минуту на процесс.

Читать таблицу из приложения нельзя: у ролей `anon` и `authenticated` нет никаких прав на неё. Владелец
смотрит данные в SQL Editor Supabase — запросы ниже. Дни в готовых представлениях считаются по московскому
времени.

Выключить запись на сервере: переменная окружения `TELEMETRY_DISABLED=1`.

## События

Действия (`kind = 'event'`):

- `page_view` — открыт экран; какой — в `route`.
- `try_opened` — открыт пример без регистрации `/try`.
- `try_ticket_drawn` — в примере вытянут билет.
- `try_answered` — в примере ответ отправлен на проверку; `mode`: `voice` или `text`.
- `try_checked` — в примере ответ проверен; `by`: `ai` (проверил ИИ, `/api/try/evaluate`), `dont_know` (ответ «не
  знаю», без проверки) или `keywords` (проверка ИИ не состоялась, проверено по ключевым словам); у `keywords` —
  `reason`: `no_key`, `day_cap`, `busy`, `timeout`, `failed`, `client_limit`, `offline` или `too_long`.
- `try_followup_checked` — в примере проверен ответ на вопрос экзаменатора; `by`: `ai` (`/api/try/evaluate` с
  `point_id`) или `keywords`; у `keywords` — `reason`: `no_key`, `day_cap`, `busy`, `timeout`, `failed`,
  `client_limit`, `offline` или `too_long`. Ответ «не знаю» события не шлёт.
- `try_answer_paste_refused` — в примере не вставлен готовый текст, как в настоящем билете (см.
  `answer_paste_refused`).
- `signup_view` — открыта страница регистрации.
- `signup_done` — регистрация по почте прошла; `method`: `email`, `confirmed`: вошёл сразу или ждёт письма.
- `login_done` — вход; `method`: `email`, `oauth` или `telegram` (мини-приложение `/tg`: вход по данным Telegram без
  пароля).
- `guide_done` — знакомство с Meldy пройдено до конца; `first_run`: это был обязательный первый показ.
- `first_steps_done` — на «Сегодня» сделаны все три первых шага (одно событие на устройство).
- `today_erase_open` — на «Сегодня» нажато «Ответить» у строки «Можно стереть: N вопросов» (жеребьёвка «Ждут
  подтверждения» из вопросов, где ответ может стереть строку шпаргалки сейчас); `questions`: N, корзиной.
- `tip_shown` — показана подсказка к функции при первой встрече с ней (карточка с роликом у кнопки функции);
  `id`: какая подсказка — `talk` (к кнопке «Поговорить о лекции» на странице лекции) или `sheet` (к вкладке
  «Шпаргалка» на странице экзамена, когда на ней впервые есть строки). Одно событие на открытие страницы.
- `tip_action` — ответ на подсказку; `id`, `action`: `try` («Попробовать» или сама кнопка функции, пока подсказка
  на экране) или `dismiss` («Не сейчас» или Esc). После любого ответа подсказка больше не показывается.
- `lecture_upload` — сервер прочитал текст лекции; `format`: `pdf`, `docx`, `pptx`, `txt`, `md`, `html`, `scan`
  (скан PDF), `photo`, `audio`, `video`, `url` или `other`; `ocr`: текст распознан со скана или фото.
- `lecture_ready` — разбор лекции готов; `partial`: готовы не все разделы, `demo`: демо-текст, `time`: сколько шёл.
- `analysis_failed` — разбор не удался; `code`: `network`, `timeout`, `server`, `busy`, `empty`, `rate_limited`,
  `too_large`, `unavailable`, `auth`, `bad_request` или `incomplete`.
- `exam_created` — создан экзамен; `questions`: число вопросов корзиной, `lectures`: выбраны лекции, `source`:
  `paste` или `file`.
- `mapping_done` — сверка вопросов с лекциями закончилась; `state`: `done` или `partial`, `questions`: сколько
  вопросов проверено, корзиной.
- `mapping_failed` — сверка не удалась; `reason`: `failed`, `interrupted` или `ai_limit`.
- `ticket_drawn` — вытянут билет; `mode`: `exam`, `weak`, `answered` или `awaiting` (с 2026-10-07 — вопросы, где
  ответ может стереть строку шпаргалки сейчас), `questions`: вопросов в билете.
- `answer_started` — начат ответ на билет; `mode`: `voice` или `text`, `engine`: `browser` или `server` (для
  голоса), `voice_unsupported`: голос в этом браузере недоступен.
- `answer_finished` — нажато «Готово»; `checked`: ответ проверяла модель, `mode`, `time`: сколько длился ответ.
- `answer_paste_refused` — в поле ответа не вставлен готовый текст: во вставке или перетаскивании больше 8 слов
  («Чистый ответ»); `field`: `answer` (ответ на билет) или `followup` (ответ на вопрос экзаменатора), `words`:
  сколько слов было во вставке, корзиной. Сам текст не записывается.
- `voice_engine_switched` — распознавание голоса перешло на сервер; `reason`: `silence` (браузер молчал),
  `chosen` (выбрал человек) или ошибка браузера (`network`, `not-allowed` и другие).
- `conversation_play` — запущен «Разговор»; `from_start`: с первой реплики.
- `pro_window_open` — открыто окно PRO; `reason`: `pricing`, `limit` или `meter`.
- `pro_demo_bought` — нажато «Купить PRO» и PRO включён (демо: оплата не подключена, PRO бесплатный);
  `reason` — откуда было открыто окно. До 2026-10-05 здесь было `pro_interest_sent` («Сообщить, когда появится»).
- `pro_demo_cancelled` — нажато «Отключить PRO» и PRO выключен; `reason` — как у `pro_demo_bought`.
- `ai_limit_hit` — дневной лимит ИИ не пустил действие; `kind`: `check` (проверка до действия) или `server`
  (отказ сервера), `pro`, `units` — сколько единиц просило действие.
- `sheet_view` — открыт вид «Шпаргалка» экзамена (одно событие на открытие страницы); `left`: сколько строк
  осталось, `total`: сколько всего, корзинами.
- `sheet_write_started` — нажато «Написать шпаргалку» или «Дописать N вопросов»; `questions`: сколько вопросов,
  `units`: их цена в единицах ИИ, корзинами.
- `sheet_write_done` — запись шпаргалки закончилась; `written`, `failed`: сколько вопросов записано и не удалось,
  корзинами, `limit`: кончился дневной лимит, `phase`: `done`, `failed` или `interrupted` (связь прервалась —
  сервер дописывает сам).
- `sheet_peek` — строку шпаргалки подсмотрели (кнопка «Подсмотреть» или открытая строка в «Закрыть строки»);
  `state`: состояние строки до этого (`rubbed`, `due`, `fresh` и другие). В тот же день такая строка не стирается.
- `sheet_replay` — шпаргалка показала, что изменил ответ (сразу после ответа или «Показать последний ответ»);
  `erased`, `rubbed`, `returned`: сколько строк стёрлось, стёрлось наполовину и вернулось, корзинами.
- `sheet_history` — запущена «История листа»; `days`: сколько дней в истории, корзиной.
- `review_done` — повторение карточек закончено; `cards`: сколько карточек корзиной, `early`: закончено раньше
  конца очереди.
- `tutor_started` — начат разговор с репетитором «Поговорить о лекции» («Начать» или «Продолжить разговор»);
  `cards`: сколько карточек в разговоре (до 4), `mode`: `voice` или `text`.
- `tutor_turn` — репетитор ответил на реплику; `move`: ход (`confirm`, `nudge`, `quote`, `explain`, `redirect`, на
  вопрос студента — `answer` или `not_in_lecture`), `status`: оценка ответа (`covered`, `partial`, `missing`,
  `wrong`; `none` у вопроса), `wait`: сколько ждали ответа сервера (`<1s`, `1-2s`, `2-3s`, `3s+`).
- `tutor_finished` — разговор закончен; `cards`: сколько карточек закрыто, `self`: сколько закрыто самим студентом,
  `assisted`: с подсказкой, `minutes`: сколько шёл (`<1m`, `1-2m`, `2-5m`, `5-10m`, `10-20m`, `20m+`), `reason`:
  `done` (все карточки), `left` («Закончить» или ушёл со страницы), `limit` (дневной лимит), `error` (сбой).
- `group_invite_open` — автор открыл «Пригласить группу» на странице экзамена; `ready`: ссылку можно сделать,
  `copy`: экзамен сам копия из ссылки, `links`: сколько ссылок у экзамена уже есть.
- `group_link_created` — автор отметил согласие и создал ссылку группы.
- `group_link_revoked` — автор закрыл ссылку группы.
- `group_join_view` — открыта страница приглашения `/join/<код>` (сам код в статистику не попадает: адрес идёт
  шаблоном `/join/:id`); `inapp`: встроенный браузер-WebView — `telegram`, `viber`, `instagram`, `facebook`, `webview`
  или `none` (с 2026-10-07 — только по отметке WebView в user agent: ссылка из Telegram в Chrome Custom Tabs или
  SFSafariViewController — это `none`).
- `group_join_done` — однокурсник вошёл по ссылке и открыл свою копию экзамена; `again`: копия была сделана раньше,
  `without_points`: в копии есть вопросы без пунктов ответа.
- `group_join_failed` — вход по ссылке не удался; `code`: `link_revoked`, `link_expired`, `link_full`, `own_link`,
  `link_not_found`, `share_not_ready`, `copy_mismatch`, `offline` и другие.
- `report_print` — на странице «Отчёт для преподавателя» (`/exams/:id/report`) нажата «Печать»; `questions`: сколько
  вопросов в отчёте, корзиной. Открытие самой страницы видно по просмотрам адреса.
- `report_csv` — там же нажато «Скачать CSV»; `questions` — как у `report_print`.
- `reminder_downloaded` — скачан файл календаря «Напоминать каждый день» (событие каждый день в выбранное время);
  `from`: `today` (строка под «Можно стереть» на «Сегодня») или `profile` («Профиль», «Уведомления»); `time`: `19:00`,
  `20:00`, `21:00` или `custom` (своё время; какое — не записывается); `again`: на этом устройстве файл уже скачивали,
  время меняют; `zone`: `fixed` (в файле часовой пояс устройства без перехода на летнее время, в Беларуси
  `Europe/Minsk`) или `floating` (время по часам устройства). Добавил ли студент событие в календарь, Meldy не знает.
- `group_question_copied` — автор экзамена с открытой ссылкой группы скопировал «Вопрос дня» для беседы группы;
  `from`: `today` («Сегодня») или `invite` (окно «Пригласить группу»); `link`: в сообщении есть ссылка группы (её код
  хранится на этом устройстве); `copied`: браузер скопировал текст (`false` — показан текст, чтобы скопировать его
  самому). Ни вопрос, ни ссылка в статистику не попадают.

Корзины чисел: `0`, `1-2`, `3-5`, `6-10`, `11-20`, `21-40`, `41-80`, `81-150`, `151-300`, `301+`.
Корзины времени: `<30s`, `30-60s`, `1-2m`, `2-5m`, `5-10m`, `10m+`.

Ошибки браузера (`kind = 'client_error'`):

- `window_error` — необработанная ошибка JavaScript;
- `unhandled_rejection` — необработанный отказ промиса;
- `react_render` — экран внутри приложения упал при отрисовке (его ловит рамка экрана);
- `react_app` — упало всё приложение (общая рамка в `main.tsx`, человек видит «Что-то пошло не так»);
- `api_failure` — запрос к нашему серверу вернул 500 и выше или не получил ответа; в `props` только шаблон
  пути (`/api/exams/:id/map`) и код ответа (`0` — ответа не было).

Одинаковая ошибка уходит не больше трёх раз за загрузку страницы, всего ошибок — не больше 30.

Ошибки сервера (`kind = 'server_error'`), в `props` — `error_id` и `exception`:

- `unhandled` — необработанное исключение любого запроса (ответ 500 с `error_id`);
- `analysis_stream` — исключение в потоке разбора лекции («Не удалось завершить анализ. Код ошибки: …»);
- `analysis_no_terminal` — поток разбора закончился без результата и без ошибки;
- `url_fetch` — не удалось забрать текст по ссылке.

## Готовые запросы

Все запросы — для SQL Editor Supabase. Они только читают, кроме очистки старых строк в конце.

### Воронка по дням

```sql
select * from analytics.daily_funnel order by day desc limit 30;
```

Столбцы: `visits` — вкладки с хотя бы одним просмотром экрана, `try_opened` — вкладки, где открыли пример,
`signups` — новые аккаунты, `first_lecture` / `first_exam` / `first_ticket` — сколько людей в этот день впервые
загрузили лекцию с текстом, создали экзамен и ответили на билет. Последние три берутся из таблиц `materials`,
`exams` и `learning_events`, поэтому верны и для дней до появления статистики.

Воронка за последние 30 дней одной строкой:

```sql
select sum(visits) as visits, sum(try_opened) as try_opened, sum(signups) as signups,
       sum(first_lecture) as first_lecture, sum(first_exam) as first_exam, sum(first_ticket) as first_ticket
  from analytics.daily_funnel
 where day > (now() at time zone 'Europe/Moscow')::date - 30;
```

Сколько времени проходит от регистрации до первого ответа на билет:

```sql
select percentile_cont(0.5) within group (order by first_answer - u.created_at) as median,
       count(*) as students
  from auth.users u
  join (select user_id, min(created_at) as first_answer
          from public.learning_events where kind = 'exam_answer' group by user_id) a on a.user_id = u.id
 where u.created_at > now() - interval '30 days';
```

### Удержание

```sql
select * from analytics.retention order by signup_day desc limit 30;
```

Для каждого дня регистрации: сколько человек зарегистрировалось и сколько из них вернулись на 1-й, 2-й и 7-й
день (любая запись в журнале учёбы или любое действие в приложении). Доля пустая, пока этот день не наступил.

Удержание за последние 4 недели одной строкой:

```sql
select sum(signups) as signups,
       round(100.0 * sum(day1_active) / nullif(sum(signups), 0), 1) as day1_pct,
       round(100.0 * sum(day7_active) / nullif(sum(signups) filter (where day7_pct is not null), 0), 1) as day7_pct
  from analytics.retention
 where signup_day > (now() at time zone 'Europe/Moscow')::date - 28
   and day1_pct is not null;
```

### Частые ошибки

```sql
select kind, name, message, events, sessions, users, first_seen, last_seen, last_route, last_error_id
  from analytics.top_errors
 order by events desc
 limit 30;
```

Стек последней такой ошибки — в столбце `sample_stack`. Только новые за сутки:

```sql
select * from analytics.top_errors where first_seen > now() - interval '1 day' order by events desc;
```

Какие ошибки появились с новой сборкой:

```sql
select app_version, kind, name, message, count(*) as events
  from public.app_events
 where kind <> 'event' and created_at > now() - interval '3 days'
 group by 1, 2, 3, 4
 order by app_version desc, events desc;
```

### Ошибка по коду, который прислал пользователь

Студент пишет: «Не удалось завершить анализ. Код ошибки: 3f9a1c0b7d2e». Находим событие и его аккаунт:

```sql
select created_at, kind, name, route, user_id, session, message, props, stack
  from public.app_events
 where props ->> 'error_id' = '3f9a1c0b7d2e';
```

Последние ошибки того же человека (и браузерные, и серверные):

```sql
select created_at, kind, name, route, message, props
  from public.app_events
 where user_id = (select user_id from public.app_events
                   where props ->> 'error_id' = '3f9a1c0b7d2e' and user_id is not null limit 1)
   and kind <> 'event'
 order by created_at desc
 limit 50;
```

Если человек назвал почту, а не код:

```sql
select e.created_at, e.kind, e.name, e.route, e.message, e.props
  from public.app_events e
  join auth.users u on u.id = e.user_id
 where u.email = 'student@example.com' and e.kind <> 'event'
 order by e.created_at desc
 limit 50;
```

Подробности ошибки сервера (текст исключения) есть только в журнале сервера, в строке с тем же кодом:
`Global exception [3f9a1c0b7d2e]: …` или `Analysis error [3f9a1c0b7d2e]: …`.

### События по дням

```sql
select day, name, events, sessions, users
  from analytics.events_daily
 where kind = 'event' and day > (now() at time zone 'Europe/Moscow')::date - 7
 order by day desc, events desc;
```

Какими форматами загружают лекции:

```sql
select props ->> 'format' as format, count(*) as uploads, count(*) filter (where (props ->> 'ocr')::boolean) as ocr
  from public.app_events
 where name = 'lecture_upload' and created_at > now() - interval '30 days'
 group by 1
 order by uploads desc;
```

Голос или текст, и как часто браузер не справляется с распознаванием:

```sql
select name, props ->> 'mode' as mode, props ->> 'engine' as engine, props ->> 'reason' as reason, count(*)
  from public.app_events
 where name in ('answer_started', 'voice_engine_switched') and created_at > now() - interval '30 days'
 group by 1, 2, 3, 4
 order by 1, 5 desc;
```

### Сколько места занимает и как чистить

```sql
select count(*) as rows, pg_size_pretty(pg_total_relation_size('public.app_events')) as size
  from public.app_events;
```

Миграция ничего не удаляет. Старые строки чистит владелец вручную (или позже — задачей по расписанию).
Предлагаемый срок хранения — 180 дней:

```sql
delete from public.app_events where created_at < now() - interval '180 days';
```

## После выкладки

1. Применить миграцию `supabase/migrations/20261005042323_app_telemetry.sql`. Перед этим проверить, что схемы
   `analytics` ещё нет: `select 1 from pg_namespace where nspname = 'analytics';` — пусто.
2. Запустить `supabase/tests/app_telemetry.sql`: в ответе `contract_ok` должен быть `true`.
3. Схему `analytics` не добавлять в «Exposed schemas» настроек API Supabase.
4. Переменные окружения не нужны. По желанию: `VITE_APP_VERSION` при сборке фронтенда (иначе версия — время
   сборки), `APP_VERSION` на сервере (версия у ошибок сервера), `TELEMETRY_DISABLED=1` — выключить запись.

Порядок выкладки не важен: пока миграции нет, сервер отвечает 204 и пишет в свой журнал одну строку, что функции
нет; приложение работает как обычно.

## Ограничения

- Публичный ключ Supabase известен всем, поэтому функцию записи можно вызвать и в обход нашего сервера.
  Защита — проверки в самой функции и суточные пределы: подделать `user_id` нельзя, а мусор от тех, кто не
  вошёл, ограничен 50 000 строк в сутки. Из-за этого же события `server_error` нельзя считать доказанно
  серверными.
- Посетители с Do Not Track не попадают в воронку (`visits`, `try_opened`), их ошибки — попадают.
- `session` — вкладка, а не человек: два открытых окна — две вкладки, перезагрузка той же вкладки — та же.
- Удержание считает «вернулся» по журналу учёбы и по действиям в приложении; действия пишутся только с
  5 октября 2026 года, журнал — с 3 октября.
