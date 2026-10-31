# Telegram-бот Meldy: выкладка и эксплуатация

Бот [@Meldyteach_bot](https://t.me/Meldyteach_bot) — это одна функция Supabase `telegram` в проекте StudyForge
(`daunnytubqbzafjnpfnw`) и схема `bot` в его базе. Сайт на Hugging Face с Telegram не связан. Что бот делает и почему
он так устроен, описано в спецификации `meldy-notes/10_Project/Telegram_Bot_Spec_2026-10-09.md` (ниже «спецификация»,
§…). Здесь описано, как бота выложить, проверить и держать в работе. Документ для владельца и для агентов.

Цифры Supabase (квоты, цены, регионы, хранение журналов) сверены с документацией и страницей цен 2026-10-10. Они
меняются: перед решением о деньгах откройте [supabase.com/pricing](https://supabase.com/pricing).

## Коротко для владельца

- **Один раз, до запуска:** удалите `TELEGRAM_BOT_TOKEN` из секретов Space на Hugging Face (Space → Settings →
  Variables and secrets). Там он не нужен, а по токену можно подделать запросы к боту.
- **Только если агент попросит:** включите `pg_cron` и `pg_net` в Supabase (Database → Extensions). Это нужно, если
  миграция не сможет включить их сама.
- **Если токен мог утечь** (показали на экране, вставили в чат, отправили файлом): раздел «Смена токена», три шага,
  около 5 минут.
- **Раз в неделю** смотрите расход (раздел «Лимиты»). Когда за месяц набирается 60 % бесплатной квоты, бот сам
  переходит на экономный тик, а агент присылает вам цифры. Переходить ли на платный план, решаете вы.
- Токен вводится только в двух местах: в @BotFather и в Supabase → Edge Functions → Secrets. Не присылайте его агенту
  и не кладите в чат, GitHub, файлы или адресную строку браузера.
- Остальное делает агент через `/setup`: вебхук, имя и описание бота, команды, аватарку, кнопку меню «Открыть Meldy».
  В @BotFather ничего менять не нужно: режим приватности включён, группы разрешены, inline выключен (§5).
- **По желанию:** в @BotFather можно включить Main Mini App (раздел «Мини-приложение»). Кнопке меню и кнопкам
  «Открыть занятие» это не нужно.
- **По желанию:** монитор сайта пишет вам в Telegram, когда сайт или сервис (озвучка, Gemini, Groq, Supabase) не
  работает и когда снова работает. Включается одной строкой SQL (раздел «Монитор сайта»).

## Из чего состоит бот

| Часть | Где | Кто меняет |
|---|---|---|
| Функция `telegram` | `supabase/functions/telegram/index.ts` и `supabase/functions/_shared/{bot,plan}/*` | агент, строка в `deploy/supabase-functions.md` |
| Токен бота `TELEGRAM_BOT_TOKEN` | Supabase → Edge Functions → Secrets | только владелец |
| Ключи базы для функции | `SUPABASE_URL`, `SUPABASE_SECRET_KEYS` (запасной ключ — `SUPABASE_SERVICE_ROLE_KEY`) | Supabase ставит сам |
| Секрет вебхука и токен тика | вычисляются из токена бота (HMAC-SHA256 с метками `meldy:webhook:v1` и `meldy:tick:v1`); токен тика хранится в `bot.config` | `/setup` |
| Схема `bot`, функции `bot_*` и `telegram_*` | `supabase/migrations/20261010120000…120003_telegram_bot*.sql` | агент, `deploy/supabase-migrate.md` |
| Тик | задание pg_cron `meldy-telegram-tick` раз в минуту → `bot.tick()` → pg_net → `POST /telegram/tick?forceFunctionRegion=<регион>`; в экономном режиме `bot.tick()` зовёт функцию, только когда `bot.tick_due()` видит дело, и каждую 15-ю минуту | миграция `…120001_telegram_bot_cron.sql` |
| Регион функции | `eu-central-1` (Франкфурт): константа `FUNCTION_REGION` в коде функции, её же `/setup` пишет в `bot.config.function_region`. База остаётся в `eu-north-1` (Стокгольм) | агент: выкладка функции и `/setup` |
| Карточка Telegram в профиле сайта | `frontend/src/components/telegram/TelegramCard.tsx` | выпуск сайта, `deploy/hf-release.md` |
| Мини-приложение (сайт внутри Telegram) | сайт: `/tg` — `frontend/src/pages/TelegramMiniApp.tsx`, `frontend/src/lib/telegram/miniApp.ts`, CSP в `nginx.conf`; функция: `supabase/functions/_shared/bot/webapp.ts` | выпуск сайта и функции |
| Использованные `initData` | `bot.webapp_uses` (только `sha256(hash)`, 2 часа) и `bot_webapp_session` — миграция `20261010150000_telegram_webapp.sql` | агент, `deploy/supabase-migrate.md` |
| Монитор сайта | шаг тика «monitor» — `supabase/functions/_shared/bot/monitor.ts`; `bot.monitor`, `bot_monitor_*` и переключатель `bot.config.monitor_chat_id` — миграция `20261012100000_telegram_bot_monitor.sql` | агент; включает владелец (раздел «Монитор сайта») |
| Картинки удалённых тестов и экзаменов | шаг тика «sweep» — `supabase/functions/_shared/bot/sweep.ts`: папки `<id>/` в `quiz-covers` и `test-item-images` удаляет через Storage API ключом сервиса; очередь `meldy_private.picture_sweep` (её заполняет триггер на удаление строки `containers`), `bot_picture_sweep` и `bot_picture_swept` — миграция `20261103090200_picture_sweep.sql` | агент; сначала миграция, потом функция, потом сайт |
| Копия плана контейнера | `supabase/functions/_shared/plan/*` и `SOURCE_HASH` из `frontend/src/lib/containers/*` | `scripts/sync_bot_plan.mjs` |

Адрес функции — `https://daunnytubqbzafjnpfnw.supabase.co/functions/v1/telegram`. Маршруты (§6.1):

| Маршрут | Кто вызывает | Вход |
|---|---|---|
| `POST /telegram` | Telegram (вебхук) | заголовок `X-Telegram-Bot-Api-Secret-Token`, иначе 401 |
| `POST /telegram/tick` | pg_cron через pg_net | заголовок `x-meldy-tick`, иначе 401; ответ 202 |
| `POST /telegram/setup` | агент после выкладки | без входа, не чаще раза в минуту |
| `GET /telegram/status` | кто угодно | без входа и без секретов |
| `GET /telegram/file?t=` | сайт (этап 4) | одноразовый билет |
| `POST /telegram/webapp/session` | мини-приложение `/tg`, только внутри клиента Telegram | `initData` с подписью от токена бота, не старше часа, один раз; CORS — только сайт. Ничего не привязывает |

Функция ходит в базу только через `/rest/v1/rpc/bot_*` с секретным ключом (роль `service_role`). `SUPABASE_DB_URL`,
который Supabase тоже даёт функции, бот не использует, и тест это проверяет.

## Выкладка (агент)

Порядок такой: миграции → функция → проверка региона → `/setup` → проверка сразу после → выпуск сайта с карточкой →
живая проверка. Бот работает и без карточки на сайте, но привязаться можно только из профиля сайта. Поэтому живая
проверка идёт после выпуска сайта.

### 0. Перед выкладкой

- [ ] Пакеты слиты в порядке §7 (T1 → T5 → T2 → T6 → T3). Локальные проверки зелёные:
  `node --experimental-strip-types --test supabase/functions/_shared/bot/*.test.ts`, SQL на локальном PostgreSQL 16
  (`supabase/tests/local/telegram_bot_*`), Vitest и `npx tsc -b` для сайта.
- [ ] Владелец удалил `TELEGRAM_BOT_TOKEN` из секретов Space (§9, шаг 1).
- [ ] Токен на месте и рабочий. Функция `tg-health` (verify_jwt включён, вызывать с публичным ключом приложения)
  отвечает `configured: true`, `valid: true`, `username: "Meldyteach_bot"`. Сам токен она не показывает.
- [ ] В Supabase → Edge Functions → Secrets есть `SUPABASE_SECRET_KEYS`. Если его нет, создайте новые ключи:
  Settings → API Keys → «Create new API keys». Это безопасно, старые ключи продолжат работать. Без нового ключа
  функция берёт старый `service_role`, а старые ключи Supabase работают только до конца 2026 года.
- [ ] Регион функции в слитом дереве один — `eu-central-1` (раздел «Регион функции»). Команда
  `grep -rn "eu-north-1" supabase/functions supabase/migrations/*telegram_bot*` ничего не находит, кроме слов о базе.

### 1. Миграции

Миграции идут тем же путём, что у контейнера. Новая строка в `deploy/supabase-migrate.md` запускает workflow
`.github/workflows/supabase-migrate.yml`, а тот запускает `supabase/migrate.py` с токеном владельца (секрет
репозитория `SUPABASE_ACCESS_TOKEN`). Workflow срабатывает на push этого файла в ветку `claude/relaxed-hypatia-1tpmq5`.
Пушит оркестратор.

Строка добавляется в конец файла. Имена файлов сверьте в слитом дереве (`ls supabase/migrations/*telegram_bot*`):

```
- 2026-10-XX — apply: supabase/migrations/20261010120000_telegram_bot.sql, supabase/migrations/20261010120001_telegram_bot_cron.sql, supabase/migrations/20261010120002_telegram_bot_revokes.sql, supabase/migrations/20261010120003_telegram_bot_sessions.sql; check: supabase/tests/telegram_bot.sql, supabase/tests/containers.sql
```

Как работает этот путь:
- Скрипт читает только последнюю строку. Формат строгий: дата, длинное тире « — », `apply:` со списком через
  запятую, `;`, `check:` со списком. Часть `check:` обязательна.
- Применяются только файлы `supabase/migrations/<14 цифр>_<имя>.sql`. Проверками могут быть только файлы
  `supabase/tests/<имя>.sql`. Файлы из `tests/local/` меняют базу и на живой проект не идут никогда. Файл из
  `supabase/pending/` скрипт не примет вовсе, поэтому отзыв прав (`…120002_telegram_bot_revokes.sql`) лежит в
  `migrations/`.
- Каждый файл уходит одним запросом и применяется целиком или не применяется совсем. Версия записывается в
  `supabase_migrations.schema_migrations`, и уже записанную версию скрипт пропускает. Чтобы повторить запуск, добавьте
  новую строку с тем же списком.
- Каждая проверка должна вернуть `contract_ok: true`. `telegram_bot.sql` только читает. `containers.sql` подтверждает,
  что объекты контейнера не задеты.
- В журнал workflow попадают только имена файлов, статусы и имена упавших проверок, без данных.
- У этого пути нет подтверждения человеком. Поэтому миграции, которые удаляют данные или отзывают права, на которые
  уже кто-то полагается, запускаются только с согласия владельца. Обычные миграции этой работы (контейнер, затем бот)
  владелец разрешил без отдельного вопроса 2026-10-09 (`10_Project/Current_Focus`, `30_Tech/Codebase_Map`). Отзыв
  прав по умолчанию у новых объектов бота (`…120002`) входит в ту же выкладку, как у контейнера
  (`20261009093501_containers_revokes.sql`).
- Откат (`supabase/rollback/*_down.sql`) этот путь применить не может. Его применяет агент через коннектор с согласия
  владельца или сам владелец в SQL Editor. После отката удалите версии из `supabase_migrations.schema_migrations`,
  иначе следующий запуск их пропустит.
- `…120001_telegram_bot_cron.sql` включает `pg_cron` и `pg_net`. Если Supabase не разрешит сделать это запросом, файл
  упадёт целиком, и в журнале будет ошибка на `create extension`. Тогда владелец включает оба расширения в Database →
  Extensions, а агент добавляет новую строку.
- Задание тика появляется сразу, но молчит, пока `/setup` не заполнит `bot.config`: без адреса и токена `bot.tick()`
  ничего не отправляет.

После зелёного запуска проверьте через коннектор (только чтение):

```sql
select jobname, schedule, active from cron.job where jobname = 'meldy-telegram-tick';  -- одна строка, active = true
select function_url is null as waits_for_setup from bot.config;                         -- true, пока не было /setup
```

### 2. Функция

Выкладка идёт тем же путём, что и миграции. Новая строка в конце `deploy/supabase-functions.md`:

```
- 2026-10-10 — deploy: telegram
```

Push этого файла в ветку `claude/relaxed-hypatia-1tpmq5` запускает workflow `.github/workflows/supabase-functions.yml`.
Тот запускает `supabase/deploy_functions.py` с токеном владельца (секрет репозитория `SUPABASE_ACCESS_TOKEN`), а скрипт —
Supabase CLI: `supabase functions deploy telegram --use-api --no-verify-jwt`. CLI сам собирает функцию из
`supabase/functions/telegram/` и всего, что она импортирует из `supabase/functions/_shared/`, сборка идёт через
Management API, Docker не нужен. Скрипт читает только последнюю строку файла.

Проверка JWT задаётся в `supabase/config.toml` (`[functions.telegram] verify_jwt = false`). Функцию без своей секции там
скрипт не выкладывает. Почему `false`: Telegram и pg_cron не присылают JWT, а функция сама проверяет HMAC-заголовки
(§6.1, §6.4). С `true` шлюз Supabase ответит 401 на каждое обновление и каждый тик, и бот замолчит. Проверить
настройку можно запросом `GET /telegram/status`: при `false` он отвечает 200, при `true` — 401.

Запасной путь — инструмент `deploy_edge_function` (Supabase MCP). Он подходит только для маленьких функций: все файлы
идут одним вызовом, а у бота их больше 30. **У инструмента по умолчанию `verify_jwt: true`**, поэтому `false` надо
передавать при каждой выкладке.

Каждая выкладка создаёт новую версию функции. Если какого-то импортируемого файла не хватает, сборка не проходит, и
остаётся прежняя версия. Отката одной кнопкой нет: чтобы откатиться, выложите файлы прежнего коммита. Функция и сайт
выкладываются независимо: выпуск Space функцию не трогает, и наоборот.

### 3. Регион функции

Функция работает в `eu-central-1` (Франкфурт), а база остаётся в `eu-north-1` (Стокгольм). Закрепить функцию в
Стокгольме Supabase не даёт: на [supabase.com/regions](https://supabase.com/regions) сказано «Edge Functions with
regional invocation … Not available in Ohio or Stockholm», а в
[списке регионов функций](https://supabase.com/docs/guides/functions/regional-invocation) и в `FunctionRegion`
библиотеки `@supabase/functions-js` 2.117.3 Стокгольма нет (проверено 2026-10-10). Франкфурт — ближайший доступный
регион. Без закрепления запрос идёт в регион, ближайший к вызывающему: так `tg-health` однажды ответил из `us-east-1`.

Регион задан в одном месте: константа `FUNCTION_REGION` в коде функции (пакет T2). Она уходит:
- в адрес вебхука: `setWebhook` получает `…/functions/v1/telegram?forceFunctionRegion=eu-central-1`;
- в базу: `/setup` передаёт её в `bot_setup(p_function_region)`, функция пишет её в `bot.config.function_region`, а
  `bot.tick()` добавляет к адресу тика `?forceFunctionRegion=<function_region>`.

Поэтому сменить регион — значит изменить константу, выложить функцию и запустить `/setup`. Миграция для этого не
нужна.

Проверка после выкладки функции, до `/setup`:

```bash
curl -sS -o /dev/null -D - 'https://daunnytubqbzafjnpfnw.supabase.co/functions/v1/telegram/status?forceFunctionRegion=eu-central-1' \
  | grep -i -E '^HTTP|^x-sb-edge-region'
```

Ожидается код 200 и `x-sb-edge-region: eu-central-1`. В теле ответа `/status` есть `SB_REGION` — регион, где
функция выполнила этот запрос; там тоже `eu-central-1`. После `/setup` проверьте базу и журнал:
`select function_region from bot.config;` возвращает `eu-central-1`, а в журнале функции и вебхук, и тик идут из
`eu-central-1` (запрос «Регион вебхука и тика» в разделе «Журнал функции без токена»).

Каждый запрос функции к базе идёт из Франкфурта в Стокгольм. Сколько это стоит по времени, показывает живая проверка
(§8.3, п. 10).

### 4. `/setup`

```bash
curl -sS -X POST 'https://daunnytubqbzafjnpfnw.supabase.co/functions/v1/telegram/setup'
```

Вход не нужен. Чаще раза в минуту вызов не пройдёт. Что делает `/setup` (§6.1, §5):
1. `getMe` → `bot_setup`: записывает в `bot.config` имя и id бота, адрес функции, токен тика и регион функции
   (`function_region`).
2. `setWebhook`: адрес `…/functions/v1/telegram?forceFunctionRegion=eu-central-1`, секрет вебхука,
   `allowed_updates = ["message","callback_query","my_chat_member"]`, `max_connections = 10`.
3. Профиль бота: имя «Meldy», короткое описание и описание, команды `today`, `settings`, `help` (только в личных
   чатах), кнопка меню «Открыть Meldy» (тип `web_app`, адрес `<сайт>/tg`; команды остаются в списке по «/»), аватарка.

В ответе есть итог каждого шага, секретов там нет. Если шаг не прошёл, ищите его в журнале функции, поле `error_name`
(раздел «Журнал функции без токена»).

Запускайте `/setup` снова после смены токена или региона, после изменения слов профиля, команд, аватарки или
параметров вебхука, а также если `/status` показывает чужой адрес вебхука. После обычной выкладки кода `/setup` не
нужен, но и не вредит.

### 5. Сразу после выкладки

- [ ] `GET …/telegram/status` отвечает 200. Ждущих обновлений 0, ошибки вебхука нет, `SB_REGION` — `eu-central-1`,
  режим тика (`tick_mode`) обычный, через 1–2 минуты появляется свежий тик.
- [ ] `select function_region from bot.config;` возвращает `eu-central-1`.
- [ ] `POST` без заголовка получает 401, с чужим заголовком тоже:

  ```bash
  curl -sS -o /dev/null -w '%{http_code}\n' -X POST -H 'content-type: application/json' -d '{}' \
    'https://daunnytubqbzafjnpfnw.supabase.co/functions/v1/telegram'
  ```
- [ ] Тик доходит до функции, ответы — 202. Таблицу `net.http_request_queue` не читайте: пока запрос тика не ушёл, в
  ней лежит его заголовок `x-meldy-tick`.

  ```sql
  select status_code, timed_out, error_msg, created from net._http_response order by created desc limit 5;
  ```
- [ ] В Telegram у @Meldyteach_bot видны имя «Meldy», описание в пустом чате, три команды в меню и аватарка.

### Повторная выкладка

| Что изменилось | Что делать |
|---|---|
| код функции | выложить функцию (`verify_jwt: false`) |
| слова профиля, команды, аватарка, параметры вебхука | выложить функцию и запустить `/setup` |
| регион (константа `FUNCTION_REGION`) | выложить функцию и запустить `/setup`; миграция не нужна |
| SQL | новый файл миграции и новая строка в `deploy/supabase-migrate.md` |
| `frontend/src/lib/containers/*` (выпуск сайта) | `node scripts/sync_bot_plan.mjs`, тесты, выложить функцию в тот же день. Иначе бот и «Сегодня» посчитают план по-разному, бот покажет код в вопросе не так, как сайт (`stemCode.ts`, `codeLines.ts`), а тест `SOURCE_HASH` покажет расхождение |
| карточка Telegram на сайте | выпуск сайта (`deploy/hf-release.md`) |
| мини-приложение `/tg`, CSP | выпуск сайта; кнопки бота и меню — функция и `/setup` (раздел «Мини-приложение») |

### Аварийная остановка

Это изменения на живом проекте. Агент делает их через коннектор, с согласия владельца, и записывает в Task_Log.
- **Остановить напоминания:**
  `select cron.alter_job((select jobid from cron.job where jobname = 'meldy-telegram-tick'), active := false);`.
  Тик перестаёт ходить, данные не удаляются. Включается так же, с `active := true`. Напоминания, чьё время прошло не
  больше 3 часов назад, придут в ближайшую минуту (окно из §6.6).
- **Остановить бота целиком:** выложить функцию с `verify_jwt: true` (в `supabase/config.toml` и новой строкой в
  `deploy/supabase-functions.md`). Шлюз будет отвечать 401 раньше кода бота, и на обновления, и на тик. Telegram
  сохранит сообщения и будет повторять их до 24 часов. Чтобы вернуть бота, верните `false` и выложите функцию снова.
  `/setup` не нужен, если токен не меняли.

## Мини-приложение (2026-10-10)

Сайт открывается внутри Telegram: кнопка меню «Открыть Meldy» ведёт на `/tg` → «Сегодня», кнопка «Открыть занятие»
в карточке дня и в итоге занятия — на `/tg?c=<экзамен>` → занятие этого экзамена поверх «Сегодня». Вход — по данным
Telegram (`initData`): привязанный студент входит сразу. Неподключённому мини-приложение говорит, как подключить
Telegram: в браузере, в профиле, «Подключить Telegram» (код `/start L…` в боте). Само оно ничего не привязывает: данные
запуска приходят в адресе, и любой может вложить свои в ссылку на `/tg` (проверка безопасности 2026-10-11). По той же
причине режим мини-приложения включается только внутри клиента Telegram (его мост: `TelegramWebviewProxy`,
`external.notify` или рамка Telegram Web); в обычной вкладке браузера `/tg` — просто сайт. Если в WebView уже открыт
другой аккаунт Meldy, приложение спрашивает, прежде чем его сменить. Спецификация:
`meldy-notes/10_Project/Telegram_Mini_App_Spec_2026-10-10.md`.

**Порядок выпуска:**
1. Миграция `20261010150000_telegram_webapp.sql` — строкой в `deploy/supabase-migrate.md`, проверка
   `supabase/tests/telegram_bot.sql` (пакет WA).
2. Выпуск сайта (`deploy/hf-release.md`): страница `/tg`, CSP в `nginx.conf`, путь `/sb/` для нового POST. До
   функции: иначе кнопки откроют сайт, где `/tg` ещё нет.
3. Функция `telegram` — строкой в `deploy/supabase-functions.md` (`verify_jwt: false`, как всегда).
4. `/setup` ставит кнопку меню «Открыть Meldy».

**Откат:** прежняя версия функции и `/setup` (прежний `/setup` ставит кнопку меню с командами). Страница `/tg` на сайте
без функции безвредна: вход через Telegram отвечает «Meldy сейчас не отвечает».

**По желанию владельца, в @BotFather:**
- Main Mini App: /mybots → Meldy → Bot Settings → Configure Mini App → Enable Mini App, адрес `<сайт>/tg`. Даёт кнопку
  «Открыть» в профиле бота и ссылки `t.me/Meldyteach_bot?startapp`.
- Прямая ссылка `t.me/Meldyteach_bot/<имя>?startapp=<id экзамена>`: /newapp, адрес `<сайт>/tg`. Порядок вопросов
  BotFather не сверен с документацией.

**Журнал:** `route` — `webapp`; `kind` — `session`, а при сбое Auth — `magic_link`; `outcome` — `linked`, `same`,
`other` (в WebView другой аккаунт), `unlinked`, `replayed`, `stale`, `invalid`, `slow_down`, `unavailable` и другие.
`initData`, токены, JWT, почта и id в журнал не пишутся.

**Живая проверка** (Android, iPhone, Telegram Desktop, Telegram Web):
- [ ] Кнопка меню «Открыть Meldy» открывает «Сегодня» уже со входом; повторное открытие не создаёт новую сессию.
- [ ] «Открыть занятие» из карточки и из итога открывает занятие; ответ — с вибро; «Назад» Telegram ведёт на «Сегодня».
- [ ] Тема Meldy следует теме Telegram, в том числе после её смены при открытом приложении.
- [ ] Неподключённый Telegram: экран «…этот Telegram ещё не подключён к Meldy» и «Открыть профиль в браузере»; после
  «Подключить Telegram» в профиле повторное открытие входит сразу.
- [ ] В WebView открыт другой аккаунт Meldy: вопрос «В Meldy уже открыт другой аккаунт», без смены до ответа.
- [ ] Ссылка `/tg#tgWebAppData=…` в обычном браузере открывает сайт как обычно: без входа через Telegram, без режима
  Telegram, «Выйти» на месте.
- [ ] В Telegram Web «Перезагрузить» оставляет на той же странице со входом.
- [ ] В журнале функции нет `initData` и токенов.

## Монитор сайта (2026-10-12)

Тик бота проверяет сайт и пишет владельцу в Telegram, когда что-то не работает и когда снова работает. Код —
`supabase/functions/_shared/bot/monitor.ts` (шаг тика «monitor», после остальных шагов), база — миграция
`20261012100000_telegram_bot_monitor.sql`. Пока `bot.config.monitor_chat_id` пуст, монитор выключен: ничего не
проверяет и не пишет.

Что проверяется:
- каждые 5 минут (в экономном режиме тика — раз в 15 минут): `/api/health` — ответ 200 за 15 с; `/try` — ответ 200, и в
  странице есть сборка `index-*.js`;
- каждые 30 минут: `/api/health/deep` — ответ 200 за 20 с; по нему — `tts`, `gemini`, `groq` и `supabase` с их кодами.

Сообщение о сбое приходит после двух неудачных проверок подряд, пока сбой длится — не чаще раза в 6 часов. Когда
проверка снова проходит, приходит одно сообщение с длительностью перерыва. Время в UTC. Сообщение о сбое — со звуком,
о восстановлении — без звука. Сообщение, которое не ушло, монитор повторит при следующей проверке. Примеры:
«Meldy: сайт не отвечает (/api/health: 503) с 02:51 UTC.», «Meldy: не работает озвучка (tts: network) с 02:51 UTC.»,
«Meldy: озвучка снова работает, перерыв 47 мин.» Токенов, ключей, адресов и текстов ошибок провайдеров в сообщениях нет.

**Включить** (владелец в SQL Editor или агент с его согласия). Сначала откройте бота в Telegram и нажмите «Старт»: бот не
может написать первым. Чат берётся из привязки вашего Telegram к Meldy:

```sql
update bot.config
   set monitor_chat_id = (select l.chat_id from bot.links l join auth.users u on u.id = l.user_id
                           where u.email = '<ваша почта>' and l.unlinked_at is null)
 where id = 1;
select monitor_chat_id is not null as monitor_on from bot.config;
```

Без привязки: `update bot.config set monitor_chat_id = <id вашего Telegram> where id = 1;` (в личном чате id чата равен
id пользователя). Выключить: `update bot.config set monitor_chat_id = null where id = 1;`. Проверять другой адрес:
`update bot.config set monitor_site = 'https://<хост>' where id = 1;` (только https и имя хоста; пусто —
`https://ludosiel-studyforge.hf.space`). Состояние проверок: `select checks, health_slot, deep_slot from bot.monitor;`.

В числах тика (`/status` → `last_tick`, журнал функции): `monitor_checked` и `monitor_failed` — проверки за прогон,
`monitor_sent` — сообщение ушло, `monitor_unsent` — не ушло (повторится), `monitor_late` — проверке не хватило времени
тика (её возьмёт следующий тик), `monitor_missing` — миграция монитора не применена, `monitor_error` — сбой самого
монитора (имя ошибки — в журнале). Остальные шаги тика от монитора не зависят.

## Смена токена

Меняйте токен, если он мог утечь: его видели на экране или скриншоте, вставили в чат, коммит или файл, или в журнале
нашлась строка, похожая на токен (раздел «Журнал функции без токена»). Меняйте и тогда, когда доступ к @BotFather был
у человека, который больше не работает с проектом. Если сомневаетесь, меняйте: это занимает около 5 минут.

1. **Владелец, @BotFather:** отправьте `/revoke` и выберите @Meldyteach_bot (другой путь: `/mybots` → бот →
   «API Token» → «Revoke current token»). BotFather пришлёт новый токен, а старый сразу перестанет работать.
2. **Новый токен — в секрет функции.** Владелец: Supabase → Edge Functions → Secrets → `TELEGRAM_BOT_TOKEN` → новое
   значение → Save. Другой путь: агент вызывает `create_edge_function_secret` с `name: "TELEGRAM_BOT_TOKEN"` и
   `replace: true`, а владелец вводит значение в окне Supabase. Через агента токен при этом не проходит. Выкладывать
   функцию заново не нужно: по документации Supabase новый секрет виден функции сразу.
3. **Агент: `/setup`.** Он заново вычисляет из токена секрет вебхука и токен тика, ставит вебхук с новым секретом и
   записывает новый токен тика в `bot.config`.
4. **Проверка:** в `/status` ждущих обновлений 0 и ошибки нет, через 1–2 минуты появляется свежий тик. В чате с
   ботом `/today` получает ответ.

Между шагами 1 и 3 бот молчит. До шага 2 у функции ещё старый токен, и Telegram отклоняет её запросы. После шага 2
функция ждёт секрет от нового токена, а Telegram и тик до `/setup` присылают старый и получают 401. Сообщения
Telegram хранит и повторяет до 24 часов, после шага 3 они дойдут. Нажатия кнопок старше 150 секунд потеряются.
Напоминания догонят, если с их времени прошло не больше 3 часов. Поэтому делайте шаги 1–3 подряд и не около 20:00,
когда уходит большинство напоминаний.

Если через 3 минуты после `/setup` вебхук всё ещё получает 401, выложите функцию заново теми же файлами (новые
экземпляры функции прочитают новый секрет) и запустите `/setup` ещё раз.

## `/status`

Откройте `https://daunnytubqbzafjnpfnw.supabase.co/functions/v1/telegram/status?forceFunctionRegion=eu-central-1` в
браузере или через `curl`. Вход не нужен, секретов в ответе нет (§6.1). Состояние вебхука (`getWebhookInfo`) Telegram
отдаёт только по токену, поэтому смотреть его можно только здесь. Поля ответа (пакет T2): `region`, `function_region`,
`webhook.{url_ok, pending_update_count, last_error_date, last_error_message, max_connections, allowed_updates}`,
`tick_mode`, `last_tick_at`, `last_setup_at`, `calls.{month, updates, ticks, total}`, `ledger.{started, failed, done}`;
счётчики и режим тика приходят из `bot_status`. Ответ держится в памяти функции 15 секунд. Что они значат:

| Поле | Норма | Если не так |
|---|---|---|
| ждущие обновления (`webhook.pending_update_count`) | 0–3 | число растёт — функция не принимает обновления; смотрите последнюю ошибку |
| последняя ошибка вебхука (`webhook.last_error_date`, `webhook.last_error_message`) | нет или давняя | «401»: секрет не совпадает (токен сменили без `/setup` или функцию выложили с `verify_jwt: true`); «503»: база не ответила, Telegram повторит; «timed out»: холодный старт или долгая работа |
| адрес вебхука (`webhook.url_ok`; сам адрес не показывается) | `true`: `…/functions/v1/telegram?forceFunctionRegion=eu-central-1` | `false` — запустите `/setup` |
| регион (`region` — `SB_REGION`; `function_region` — из `bot.config`) | оба `eu-central-1` | другой — запрос пришёл без параметра региона; как работают вебхук и тик, смотрите в журнале (запрос «Регион вебхука и тика») |
| режим тика (`tick_mode`) | обычный: тик каждую минуту | экономный (`when_due`) — это не сбой: он включается сам на 300 000 вызовах за месяц или флагом; раздел «Что делать на 60 %» |
| последний тик (`last_tick_at`) | обычный режим — не старше 2 минут, экономный — не старше 16 минут | строка «тик не идёт» в разделе «Если что-то не так» |
| вызовы за месяц (`calls`: обновления и тики, месяц по UTC) | раздел «Лимиты» | от 300 000 тик сам становится экономным; агент сообщает владельцу — «Что делать на 60 %» |

Каждое открытие `/status` тоже считается вызовом функции. Чтобы следить за ботом, хватит одного раза в день.

## Журнал функции без токена

Токена в журнале нет и быть не должно. На каждое обновление, тик и служебный вызов функция пишет одну строку JSON
через `log()`: `route`, `update_id`, `kind`, `ms`, `outcome`, `error_name`, `tg_code` и счётчики шага тика (§6.7,
`_shared/bot/log.ts`). Тексты сообщений, имена, id пользователей и чатов в журнал не пишутся. Адреса тоже: адрес
api.telegram.org содержит токен. Секретные заголовки Supabase не сохраняет: из заголовков запроса в журнал функции
попадают только `accept`, `content-length`, `host` и `user-agent` (справочник полей Supabase, 2026-10-10). Поэтому
журнал читается без токена, и токен для этого никому не нужен.

Где смотреть:
- **Владелец:** Supabase → Edge Functions → `telegram` → Logs (строки `log()`) и Invocations (запросы с кодом ответа
  и временем), или Logs → тип «Edge Function».
- **Агент:** `query_logs` (Supabase MCP), запросы на ClickHouse SQL. Окно не больше 24 часов, `iso_timestamp_start` и
  `iso_timestamp_end` указывать обязательно. Источник `function_edge_logs` — запросы к функции, `function_logs` —
  строки `log()` и служебные строки среды.

На бесплатном плане журналы хранятся 1 день. Поэтому журнал проверяют в тот же день, что и проверяемое событие.
`select *` и `count(*)` эта поверхность не принимает, вместо них пишут `count()`.

**Коды ответов по маршрутам:**

```sql
select log_attributes['request.method'] as method, log_attributes['request.pathname'] as path,
       log_attributes['response.status_code'] as status, count() as n
from logs
where source = 'function_edge_logs' and log_attributes['request.pathname'] like '/functions/v1/telegram%'
group by method, path, status
order by n desc
limit 50;
```

**Время ответа по маршрутам (p50, p95)** — весь запрос к функции, с холодными стартами:

```sql
select log_attributes['request.pathname'] as path, count() as n,
       quantile(0.5)(toInt32OrZero(log_attributes['execution_time_ms'])) as p50_ms,
       quantile(0.95)(toInt32OrZero(log_attributes['execution_time_ms'])) as p95_ms
from logs
where source = 'function_edge_logs' and log_attributes['request.pathname'] like '/functions/v1/telegram%'
group by path
order by n desc;
```

**Последние строки бота:**

```sql
select timestamp, log_attributes['level'] as level, log_attributes['region'] as region, event_message
from logs
where source = 'function_logs'
order by timestamp desc
limit 100;
```

Строка бота — JSON. Значения `route`, `kind` и `outcome` задаёт `_shared/bot/log.ts`: `route` — `webhook`, `tick`,
`setup`, `status`, `file`, `webapp`; `kind` у нажатия — `callback`; `outcome` — `ok`, `skip`, `busy`, `failed`, `unauthorized` и
другие.

**Исходы по маршрутам и ошибкам:**

```sql
select JSONExtractString(event_message, 'route') as route, JSONExtractString(event_message, 'outcome') as outcome,
       JSONExtractString(event_message, 'error_name') as error_name, count() as n
from logs
where source = 'function_logs' and JSONHas(event_message, 'outcome')
group by route, outcome, error_name
order by n desc
limit 50;
```

**Регион вебхука и тика.** Обе дороги должны идти из `eu-central-1`:

```sql
select JSONExtractString(event_message, 'route') as route, log_attributes['region'] as region, count() as n
from logs
where source = 'function_logs' and JSONHas(event_message, 'route')
group by route, region
order by n desc;
```

**«Нажатие → правка» по строкам бота (p50, p95)** — время обработки нажатия в функции, без доставки через Telegram:

```sql
select count() as n,
       quantile(0.5)(JSONExtractInt(event_message, 'ms')) as p50_ms,
       quantile(0.95)(JSONExtractInt(event_message, 'ms')) as p95_ms
from logs
where source = 'function_logs'
  and JSONExtractString(event_message, 'route') = 'webhook'
  and JSONExtractString(event_message, 'kind') = 'callback';
```

**Регион, тип и уровень строк.** Этот запрос показывает, какие значения `level` и `event_type` вообще встречаются. В
нём же видны строки загрузки, по ним считается холодный старт:

```sql
select log_attributes['region'] as region, log_attributes['event_type'] as event_type,
       log_attributes['level'] as level, count() as n
from logs
where source = 'function_logs'
group by region, event_type, level
order by n desc;
```

**Нет ли в журнале токена.** Самого токена для проверки не нужно: запрос ищет строки, похожие на токен (цифры,
двоеточие, 30 и больше знаков), и адреса Bot API. Норма — пустой результат:

```sql
select source, count() as hits
from logs
where source in ('function_logs', 'function_edge_logs', 'edge_logs')
  and (match(event_message, '[0-9]{5,}:[A-Za-z0-9_-]{30,}')
       or match(log_attributes['request.url'], '[0-9]{5,}:[A-Za-z0-9_-]{30,}')
       or event_message ilike '%api.telegram.org/bot%')
group by source;
```

Владелец может дополнительно проверить по §8.3, п. 10: в Logs (тип «Edge Function», последние 24 часа) ввести в
поиск 8–10 знаков из второй половины токена, после «:», и убедиться, что совпадений нет. Весь токен в поиск не
вводите. Если совпадение нашлось, меняйте токен (раздел «Смена токена»).

## Если что-то не так

| Что видно | Вероятная причина | Что делать |
|---|---|---|
| бот не отвечает, в `/status` ошибка «401» | секрет вебхука не совпадает: токен сменили без `/setup` или функцию выложили с `verify_jwt: true` | если `GET /status` отвечает 401, выложите функцию с `verify_jwt: false`; иначе запустите `/setup` |
| ждущих обновлений много, ошибка «503» | база не ответила, Telegram повторяет до 24 часов | Supabase → Logs (Postgres); когда база ответит, очередь разойдётся сама |
| тик не идёт: последний тик старше 2–3 минут (в экономном режиме — старше 16 минут) | задание cron выключено или удалено; остановился планировщик pg_cron или процесс pg_net; тик получает 401 (токен тика устарел) | запросы ниже; при 401 запустите `/setup` |
| вебхук или тик работают не в `eu-central-1` (журнал, запрос «Регион вебхука и тика») | вебхук поставлен до выкладки с `FUNCTION_REGION`, или в `bot.config.function_region` пусто | `/setup`; затем `select function_region from bot.config;` |
| одному студенту не пришло напоминание | пауза, блокировка, «Не присылать», тишина после K2, бот отключён; или на сегодня всё сделано или сегодня экзамен (`skipped`) | строки его `bot.deliveries` и `bot.links`, запросы ниже |
| много `unknown` среди напоминаний | функция падала между `sendMessage` и отметкой об отправке | журнал функции за это время; такое напоминание повторно не отправляется, так задумано (§2, решение 7) |
| все вызовы `bot_*` — 401 «Invalid JWT» | новый секретный ключ отправлен в `Authorization: Bearer` | ошибка в коде (T2): ключ передаётся только в заголовке `apikey` |
| все вызовы `bot_*` — 42501 | функция пришла не с ключом `service_role` | проверьте, есть ли `SUPABASE_SECRET_KEYS` в секретах функции |
| после 31.12.2026 перестало работать всё сразу | старые ключи Supabase выключены, а новых в проекте нет | заранее: Settings → API Keys → создать новые ключи |
| письмо Supabase о превышении квоты | — | раздел «Лимиты», действовать сразу |

**Тик не идёт** (только чтение):

```sql
select jobid, schedule, active from cron.job where jobname = 'meldy-telegram-tick';
select status, return_message, start_time from cron.job_run_details
 where jobid = (select jobid from cron.job where jobname = 'meldy-telegram-tick')
 order by start_time desc limit 5;
select count(*) as cron_scheduler from pg_stat_activity where application_name ilike 'pg_cron scheduler';  -- 0: остановлен
select count(*) as pg_net_worker from pg_stat_activity where backend_type ilike '%pg_net%';                -- 0: остановлен
select status_code, timed_out, error_msg, created from net._http_response order by created desc limit 5;
select last_tick_at, function_url is not null as set_up, function_region, flags ->> 'tick' as tick_flag from bot.config;
```

В экономном режиме задание cron по-прежнему идёт каждую минуту, а запросов в `net._http_response` меньше: функцию
зовут, только когда есть дело, и каждую 15-ю минуту.

Что делать: если планировщик pg_cron остановлен, владелец делает быстрый перезапуск (Settings → General → Fast
reboot). Если остановлен процесс pg_net, агент через коннектор выполняет `select net.worker_restart();`. Если
задание выключено, его включает `cron.alter_job(…, active := true)`. Если тик получает 401, нужен `/setup`.

**Одному студенту не пришло напоминание.** Запрос по почте студента; id Telegram в результат не попадают:

```sql
select d.local_day, d.kind, d.status, d.error, d.attempts
  from bot.deliveries d join bot.links l on l.id = d.link_id
 where l.user_id = (select id from auth.users where email = '<почта студента>')
 order by d.id desc limit 10;
select l.remind_on, l.remind_at, l.tz, l.paused_until, l.blocked_at is not null as blocked,
       l.unlinked_at is not null as unlinked,
       l.asked_at is not null and coalesce(l.last_seen_at, '-infinity'::timestamptz) <= l.asked_at
         and not exists (select 1 from public.test_answers a
                          where a.user_id = l.user_id and a.created_at > l.asked_at) as k2_silent
  from bot.links l where l.user_id = (select id from auth.users where email = '<почта студента>')
 order by l.id desc limit 1;
```

## Лимиты бесплатного плана и что делать на 60 %

Цифры взяты со [страницы цен](https://supabase.com/pricing) и из документации Supabase на 2026-10-10. Квоты общие для
всех проектов организации Supabase и считаются за расчётный период (его даты — Organization → Billing), а не за
календарный месяц.

| Квота (Free) | Сколько | На что тратит бот | Где смотреть |
|---|---|---|---|
| вызовы функций | 500 000 за период | тик: в обычном режиме вызов в минуту, 43 200 за 30 дней (8,6 % квоты); в экономном — каждая 15-я минута (2 880 за 30 дней) и минуты, когда есть дело; каждое сообщение и нажатие студента — один вызов; `/status`, `/setup` и чужие запросы без заголовка тоже считаются, при любом коде ответа | Organization → Usage → Edge Function Invocations; счётчик бота с начала месяца (UTC) — `/status` |
| исходящий трафик | 5 ГБ, общие с сайтом | план дня (`plan_inputs`), около 55 КБ в сжатом виде на одну загрузку; загрузка идёт на каждую карточку и на каждое начало занятия (§10) | Usage → Egress |
| размер базы | 500 МБ на проект, сейчас около 17 МБ | журнал обновлений (строка на сообщение или нажатие), история cron (1 440 строк в день), ответы | запрос ниже |
| журналы | хранятся 1 день; объём журналов — новая квота, её только вводят (страница цен: 1 ГБ, документация: 5 ГБ, списание пока не включено) | каждый вызов тика пишет несколько строк журнала | Usage, когда там появится строка Logs |
| функция | 150 с на запуск, 2 с процессора на запрос, 256 МБ памяти, 20 МБ кода | тик укладывается в 30 с (§6.6) | — |

**Сколько это в людях.** Это оценка, её надо сверить в пилоте. Занятие в чате из 20 вопросов стоит около 30 вызовов:
ответы, «Дальше» после ошибок, начало и итог. Карточка дня — ещё 1–2 вызова. Формула для 30 дней:
`тик + активные студенты × занятия в день × 30 × 30`, где тик — 43 200 в обычном режиме. Если студент проходит
полтора занятия в день (так считала спецификация), 60 % квоты наступает примерно при 190 активных студентах, 90 % —
примерно при 300. Трафик плана при
таком темпе — около 4 МБ на студента за 30 дней, то есть около 1,2 ГБ на 300 студентов. Это четверть квоты, общей с
сайтом.

**Что будет при превышении** (документация Supabase). На адрес для счетов приходит письмо, и начинается льготный
период. Если превышение продолжается, Supabase ограничивает **всю организацию**: ставит проекты на паузу, переводит
базу в режим только для чтения или отвечает 402 на все запросы API. Это остановит и сайт, не только бота. При
повторном превышении нового льготного периода не будет. Ограничения снимаются в начале следующего расчётного периода
или сразу после перехода на Pro.

**Размер базы и того, что растёт само** (только чтение):

```sql
select pg_size_pretty(pg_database_size(current_database())) as database,
       pg_size_pretty(pg_total_relation_size('bot.updates')) as bot_updates,
       pg_size_pretty(pg_total_relation_size('cron.job_run_details')) as cron_history,
       pg_size_pretty(pg_total_relation_size('public.test_answers')) as answers;
```

Без уборки база росла бы сама. При 300 активных студентах журнал обновлений прибавлял бы 40–50 МБ в месяц, а история
тика — около 10 МБ (оценка по размеру строк). pg_cron свою историю не чистит вовсе. Поэтому старые строки бота
убирает сама база, раз в час во время тика (пакет T1): журнал обновлений старше 3 дней, неудачные попытки старше
суток, коды — через 30 дней после их срока, отключённые ссылки — через 30 дней, история тика — старше 7 дней. Точный
список — в `CONTRACT_T1.md`. Если размеры из запроса выше растут неделями, уборка не идёт: смотрите журнал функции за
тики.

### Что делать на 60 %

Порог — 300 000 вызовов, 60 % квоты. Вызовы считают два счётчика, и смотреть надо оба. Бот считает свои вызовы за
календарный месяц по UTC (`/status`, поле вызовов). Supabase считает вызовы всей организации за расчётный период
(Usage). Решение принимают по тому, что больше; прогноз = вызовы за прошедшие дни ÷ число прошедших дней × число дней
в периоде.

1. **Тик сам переходит на экономный режим** (§10, пакет T1). Как только счётчик бота за месяц доходит до 300 000,
   `bot.tick()` зовёт функцию, только когда `bot.tick_due()` видит, что что-то может быть пора: напоминание,
   закрытие дня, сброс ответа старше 30 минут, сообщение после даты экзамена. Кроме того, функция вызывается каждую
   15-ю минуту, что бы `bot.tick_due()` ни ответил. Режим виден в `/status` (`tick_mode`). Тик тратит тогда не
   43 200 вызовов за 30 дней, а от 2 880 плюс минуты, когда есть дело. То, чего `bot.tick_due()` не предусмотрел, ждёт
   не дольше 15 минут.
   - **Включить заранее**, не дожидаясь 300 000 у бота. Это нужно, например, когда Usage уже показывает прогноз выше
     60 %, а счётчик бота ещё меньше: Usage считает всю организацию. Агент ставит флаг через коннектор, с согласия
     владельца, и записывает это в Task_Log:
     `update bot.config set flags = flags || '{"tick": "when_due"}'::jsonb where id = 1;`.
     Снять флаг: `update bot.config set flags = flags - 'tick' where id = 1;`. Переключение на 300 000 вызовах от
     флага не зависит.
   - **Крайняя мера**, только если экономный режим не работает (тик ходит каждую минуту или не ходит вовсе): сделать
     реже само задание cron миграцией через `deploy/supabase-migrate.md`:
     `select cron.schedule('meldy-telegram-tick', '*/5 * * * *', 'select bot.tick()');`. При том же имени задания
     расписание просто заменяется. Напоминания будут опаздывать до 5 минут, но окно в 3 часа и правило «не позже
     23:00» их не теряют. Вернуть прежнее расписание можно той же строкой с `'* * * * *'`.
2. **Агент: сообщить владельцу и понять, что растёт.** Запустите `docs/pilot-numbers-bot.sql` и посмотрите строки
   «вызовы функции на 30 дней» (обновлений в день) и «занятия в чате». Сообщите владельцу: сколько вызовов
   израсходовано по обоим счётчикам, сколько активных студентов, какой прогноз на конец периода и при скольких
   студентах наступит 90 %.
3. **Владелец: решение.** Если прогноз и в экономном режиме выше 90 %, решите, переходить ли на Pro. На 2026-10-10 Pro
   стоит 25 $ в месяц и включает 2 млн вызовов и 250 ГБ трафика. Пока решения нет, не приглашайте в бот новых
   студентов: сам бот вызовы студентов не ограничивает.

Тот же порог 60 % действует для трафика: 3 ГБ из 5. Агент сообщает о нём владельцу. Сократить трафик можно только в
коде функции (пакеты T2 и T6, например загружать меньше данных на начало занятия). Это отдельная задача, и решает о
ней владелец.

## Живая проверка (§8.3)

Проводит оркестратор вместе с владельцем. Участники: учётки Meldy A (автор экзамена) и B (участник по ссылке группы
`/g/`); два Telegram — телефон владельца и второй аккаунт, третий неподключённый, если есть; Android шириной 360 px,
iPhone и Telegram Desktop. Экзамен для проверки — синтетический, например «Осенняя сессия (проверка)» тестовой
учётки. Результат каждого пункта записывается в Task_Log.

**1. Профиль и вебхук**
- [ ] `/setup` прошёл. В `/status` адрес вебхука наш (`…?forceFunctionRegion=eu-central-1`), ждущих обновлений 0,
  ошибки нет, `SB_REGION` — `eu-central-1`, режим тика обычный.
- [ ] Видны имя «Meldy», короткое описание в профиле, описание в пустом чате, команды `today`, `settings`, `help` и
  аватарка.
- [ ] Запрос без заголовка получает 401. `/status` показывает последний тик не старше 2 минут.

**2. Привязка**
- [ ] Холодный `/start` с неподключённого Telegram показывает M1 с кнопкой «Открыть профиль Meldy».
- [ ] Профиль → «Подключить Telegram» приводит к M2, сообщение с кодом удаляется.
- [ ] Повторная попытка с тем же кодом: «Эта ссылка уже использована…».
- [ ] Код старше 15 минут: «Ссылка устарела: она действует 15 минут…».

**3. Напоминание**
- [ ] Время напоминания поставлено на 2 минуты вперёд. Когда оно наступило, через коннектор выполняется
  `select bot.tick(), bot.tick();` — приходит ровно одна карточка.
- [ ] За сегодня одна строка `bot.deliveries` с `status = 'sent'`, и у неё есть `tg_message_id`:

  ```sql
  select d.kind, d.local_day, d.status, d.attempts, d.tg_message_id is not null as has_message
    from bot.deliveries d join bot.links l on l.id = d.link_id
   where l.user_id = (select id from auth.users where email = '<почта учётки A>') and l.unlinked_at is null
   order by d.id desc limit 5;
  ```
- [ ] Время сдвинуто ещё на 2 минуты в тот же день, снова `select bot.tick();` — второй карточки нет.

**4. Занятие**
- [ ] Проверены: верный ответ, неверный, «Не знаю», «Нажали не туда?», «Сомневаюсь в ключе», несколько верных, короткий
  ответ, код в условии и в вариантах, «Закончить» → «Продолжить».
- [ ] Счёт в боте совпадает с сайтом и с `test_answers`:

  ```sql
  select source, count(*) as answers, count(*) filter (where correct) as correct,
         count(*) filter (where misclick) as misclicks
    from public.test_answers
   where user_id = (select id from auth.users where email = '<почта учётки A>') and local_date >= current_date - 1
   group by source;
  ```

  `local_date` — день студента, а `current_date` в базе считается по UTC, поэтому запрос берёт вчера и сегодня.

**5. Сайт и бот вместе**
- [ ] На один и тот же вопрос ответили на сайте и в боте в пределах минуты — состояния совпадают.

**6. Защита от пересылки**
- [ ] На Android и iPhone нельзя переслать карточку, вопрос и итог занятия, в том числе после правок сообщения. Пост
  беседы проверяется так же на этапе 3.

**7. Пауза, блокировка, отключение**
- [ ] Пауза «До завтра»: сегодня карточка не приходит. «Снять паузу» её снимает.
- [ ] Бот заблокирован: у ссылки появился `blocked_at`. После разблокировки он снят. `/stop` отключает бота.

  ```sql
  select blocked_at is not null as blocked, unlinked_at is not null as unlinked, paused_until, remind_on
    from bot.links where user_id = (select id from auth.users where email = '<почта учётки A>')
   order by id desc limit 1;
  ```

**8. Беседа группы** — этап 3, проверяется после выпуска T7 и T8 (§8.3, п. 8).

**9. Файл** — этап 4, проверяется после выпуска T9 (§8.3, п. 9).

**10. Журнал**
- [ ] Поиск строк, похожих на токен, и адресов Bot API даёт 0 совпадений (раздел «Журнал функции без токена»).
  Владелец может дополнительно поискать фрагмент своего токена.
- [ ] Записаны p50 и p95 «нажатие → правка» (по строкам бота), время ответа по маршрутам и время холодного старта
  по строкам загрузки.
- [ ] Вебхук и тик работают в `eu-central-1` (запрос «Регион вебхука и тика»), `x-sb-edge-region` у `/status` —
  `eu-central-1`. Записано, во что обходятся запросы из Франкфурта к базе в Стокгольме: p95 «нажатие → правка».

**11. Телефоны**
- [ ] Подписи кнопок не обрезаются при крупном шрифте.
- [ ] Разбор ошибки с буквами вариантов помещается на экран 360 px.
- [ ] Цвета кнопок видны.
- [ ] Правки сообщений приходят без звука.
- [ ] В уведомлении видна строка плана.

## Цифры пилота

`docs/pilot-numbers-bot.sql` выдаёт цифры бота в том же виде, что и `docs/container-numbers.sql`: строки «что ·
значение». Запускать в SQL Editor или через `execute_sql`; файл только читает. По умолчанию окно — последние 14 дней
(параметры `d0`, `d1` в начале файла). Аккаунты из `analytics.excluded_accounts` не учитываются нигде, их число
показано в первой строке. Id людей, Telegram и чатов файл не выводит.

Что в нём:
- **охват** — сколько людей подключено, сколько получают план, получили напоминание, нажали «Начать», отвечали в
  боте (в том числе в 2 и в 4 разных дня);
- **привязка** — коды «Подключить Telegram» и сколько из них использовано; новые ссылки; кто отключил бота сам; чья
  ссылка ушла в другой Telegram;
- **напоминания** — отправлено, пропущено (с причинами), `unknown`, ошибки; после скольких напоминаний нажали
  «Начать» или занимались в тот же день; на сколько минут напоминания опаздывали; то же по дням;
- **K2** — сколько раз ушёл вопрос «Присылать план дальше?» и что сейчас у получивших: план выключен, пауза, тишина
  или план снова приходит;
- **занятия в чате** — начато, закончено, брошено; медианы вопросов, ответов и минут на занятие;
- **ответы по источникам** — `web`, `bot`, `bot_group`: ответы, люди, дни, верные, «Нажали не туда?», сколько
  вопросов вошло в счёт; доля чата у подключённых;
- **паузы и блокировки** — сейчас на паузе, заблокировали, выключили план; выбранное время напоминаний;
- **вызовы функции на 30 дней** — нижняя оценка по темпу последних 3 дней, для раздела «Лимиты»;
- **проверка допущений** — совпадают ли с базой поля, которых нет в §6.2 (ответ на K2 в `bot.deliveries.answer`,
  причина пропуска в `error`, ключи `tg:<sid>:<позиция>`). Если здесь `false` или не 0, поправьте файл.

Как читать главное. Доля нажавших «Начать» после напоминания (`sent_then_start / sent`) показывает, работает ли
карточка дня. Доля заблокировавших среди получавших напоминания (`blocked_in_window / got_reminder`) показывает, не
надоел ли бот. `unknown` и `failed` должны быть единичными. Растущее число `bot_days_2_plus` означает, что студенты
возвращаются в бот в разные дни.

Файл проверен локально на PostgreSQL 16 в транзакции только для чтения: на миграции контейнера со схемой `bot` в форме
§6.2 и на миграции T1 (`pkg-t1`, 2026-10-10), на синтетических данных с заранее посчитанными ответами.

## Источники (проверены 2026-10-10)

- Спецификация бота, §5, §6, §8.3, §9, §10; `deploy/supabase-migrate.md`, `.github/workflows/supabase-migrate.yml`,
  `supabase/migrate.py`.
- Решения по сборке бота от 2026-10-10: функция работает в `eu-central-1`, регион задан одной константой
  `FUNCTION_REGION` (`bot.config.function_region`); экономный тик (`bot.tick_due()`, сам на 300 000 вызовах за месяц
  или флагом, плюс каждая 15-я минута); коды привязки хранятся 30 дней после срока; `verify_jwt: false` при каждой
  выкладке.
- Supabase: [цены](https://supabase.com/pricing) (Free: 500 000 вызовов, 5 ГБ трафика, 500 МБ базы, журналы 1 день,
  пауза после недели простоя; Pro от 25 $), [лимиты функций](https://supabase.com/docs/guides/functions/limits),
  [вызовы функций](https://supabase.com/docs/guides/platform/manage-your-usage/edge-function-invocations),
  [трафик](https://supabase.com/docs/guides/platform/manage-your-usage/egress),
  [Fair Use Policy](https://supabase.com/docs/guides/platform/billing-faq#fair-use-policy),
  [журналы](https://supabase.com/docs/guides/observability/logs),
  [запросы к журналам](https://supabase.com/docs/guides/observability/advanced-log-filtering),
  [поля журналов](https://supabase.com/docs/guides/observability/log-field-reference),
  [секреты функций](https://supabase.com/docs/guides/functions/secrets),
  [регионы функций](https://supabase.com/docs/guides/functions/regional-invocation),
  [регионы проекта](https://supabase.com/regions),
  [отладка pg_cron](https://supabase.com/docs/guides/troubleshooting/pgcron-debugging-guide-n1KTaz),
  [pg_net](https://supabase.com/docs/guides/database/extensions/pg_net),
  [новые ключи API](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys).
- Supabase MCP (`@supabase/mcp-server-supabase` 0.13.0): у `deploy_edge_function` по умолчанию `verify_jwt: true`;
  `create_edge_function_secret` запрашивает значение у владельца в панели Supabase.
- Telegram: [Bot API](https://core.telegram.org/bots/api#getting-updates) — обновления хранятся не дольше 24 часов.
  Срок нажатия кнопки (150 секунд) и порядок повторов доставки взяты из исходников сервера Bot API
  (`tdlib/telegram-bot-api`) по техническому отчёту к спецификации (2026-10-09); в документации их нет, живая проверка
  их подтверждает (§10 спецификации).
