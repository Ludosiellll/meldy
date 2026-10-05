/**
 * The pure part of «Проверка перед показом» (/check, pages/Check.tsx): what each check found, in plain
 * Russian, with what to do about a problem, and the summary line at the top of the page. Nothing here
 * touches the network, the microphone or the clock.
 */

export type CheckId = 'site' | 'server' | 'supabase' | 'ai' | 'mic' | 'speech' | 'stt' | 'voice';
/** idle — not run yet; skip — cannot be run here (no account); warn — works with a caveat. */
export type CheckState = 'idle' | 'running' | 'ok' | 'warn' | 'fail' | 'skip';

export interface CheckResult {
  state: CheckState;
  /** What the check found, one or two plain sentences. */
  text: string;
  /** What to do about it; null when there is nothing to do. */
  fix: string | null;
}

export const CHECK_ORDER: readonly CheckId[] = ['site', 'server', 'supabase', 'ai', 'mic', 'speech', 'stt', 'voice'];

export const CHECK_TITLES: Record<CheckId, string> = {
  site: 'Интернет и этот сайт',
  server: 'Сервер приложения',
  supabase: 'Вход и данные (Supabase) из этой сети',
  ai: 'ИИ и сервисы на сервере',
  mic: 'Микрофон',
  speech: 'Распознавание речи в браузере',
  stt: 'Распознавание речи на сервере',
  voice: 'Голос экзаменатора',
};

/** Names in the summary line: «Есть проблемы: Supabase и микрофон». */
export const CHECK_SHORT: Record<CheckId, string> = {
  site: 'интернет',
  server: 'сервер',
  supabase: 'Supabase',
  ai: 'ИИ',
  mic: 'микрофон',
  speech: 'распознавание в браузере',
  stt: 'распознавание на сервере',
  voice: 'голос',
};

/** A page answer slower than this is «медленно». */
export const SLOW_SITE_MS = 1500;
export const SLOW_SUPABASE_MS = 3000;
/** Speech heard by the recorder (lib/oral/recorder MIN_SPEECH_MS): less than this is «голоса не слышно». */
export const MIC_SPEECH_MS = 250;

export const VOICE_LINE = 'Проверка звука. Если вы слышите эту фразу, голос экзаменатора работает.';

const MIC_PERMISSION_FIX =
  'Нажмите значок слева от адреса сайта, разрешите микрофон и обновите страницу.';
const WAKE_FIX =
  'Обновите страницу. Бесплатный сервер на Hugging Face засыпает, если сайт долго не открывали, и просыпается около минуты — поэтому сайт открывают заранее. Если не помогло, показывайте запасное видео.';

export function result(state: CheckState, text: string, fix: string | null = null): CheckResult {
  return { state, text, fix };
}

/** «A», «A и B», «A, B и C». */
export function joinRu(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} и ${items[items.length - 1]}`;
}

/** Recognised words inside «»: the sentence's own full stop goes after the quote, the way Russian sets it. */
export function quoted(text: string): string {
  return `«${text.trim().replace(/\.+$/, '').trim()}»`;
}

/** «120 мс», «1,4 с», «12 с». */
export function msLabel(ms: number): string {
  const value = Math.max(0, Math.round(ms));
  if (value < 1000) return `${value} мс`;
  const seconds = value / 1000;
  return `${(seconds < 10 ? seconds.toFixed(1) : String(Math.round(seconds))).replace('.', ',')} с`;
}

/** «только что», «3 мин назад», «2 ч назад». */
export function ageLabel(seconds: number): string {
  const value = Math.max(0, Math.round(seconds));
  if (value < 45) return 'только что';
  if (value < 3600) return `${Math.max(1, Math.round(value / 60))} мин назад`;
  return `${Math.round(value / 3600)} ч назад`;
}

// ---------------------------------------------------------------------------------------------
// The summary at the top

export interface Summary {
  tone: 'checking' | 'problems' | 'pending' | 'ready';
  title: string;
  lines: string[];
}

export function summarize(results: Readonly<Record<CheckId, CheckResult>>): Summary {
  const ids = (state: CheckState) => CHECK_ORDER.filter((id) => results[id]?.state === state);
  const names = (list: CheckId[]) => joinRu(list.map((id) => CHECK_SHORT[id]));
  const failing = ids('fail');
  const running = ids('running');
  const idle = ids('idle');
  const warned = ids('warn');
  const skipped = ids('skip');

  if (failing.length > 0) {
    const lines = ['Что сделать — в карточках ниже.'];
    if (warned.length > 0) lines.push(`Ещё замечания: ${names(warned)}.`);
    if (running.length > 0) lines.push(`Ещё проверяется: ${names(running)}.`);
    return { tone: 'problems', title: `Есть проблемы: ${names(failing)}`, lines };
  }
  if (running.length > 0) {
    return { tone: 'checking', title: 'Проверяем…', lines: [`Сейчас проверяется: ${names(running)}.`] };
  }
  if (idle.length > 0) {
    const lines = [`Осталось проверить: ${names(idle)}.`];
    if (warned.length > 0) lines.push(`Замечания: ${names(warned)}.`);
    return { tone: 'pending', title: 'Пока всё в порядке', lines };
  }
  const lines: string[] = [];
  if (warned.length > 0) lines.push(`Замечания: ${names(warned)} — подробности ниже.`);
  if (skipped.length > 0) lines.push(`Без входа не проверены: ${names(skipped)}.`);
  return { tone: 'ready', title: 'Можно показывать', lines };
}

// ---------------------------------------------------------------------------------------------
// Network checks

/** What a fetch ended with: an HTTP answer, or no answer at all (network error or the time limit). */
export type FetchOutcome =
  | { kind: 'response'; status: number; ms: number; body?: unknown }
  | { kind: 'error'; timedOut: boolean; ms: number };

/** Интернет и этот сайт: a request for the page itself, past every cache. */
export function siteResult(outcome: FetchOutcome, online: boolean): CheckResult {
  if (outcome.kind === 'error') {
    if (!online) {
      return result('fail', 'Нет подключения к интернету.', 'Подключитесь к сети площадки или раздайте интернет с телефона, затем нажмите «Проверить ещё раз».');
    }
    return result('fail', outcome.timedOut ? 'Сайт не ответил вовремя.' : 'Сайт не отвечает.', WAKE_FIX);
  }
  if (outcome.status < 200 || outcome.status >= 400) {
    return result('fail', `Сайт ответил ошибкой ${outcome.status}.`, WAKE_FIX);
  }
  if (outcome.ms > SLOW_SITE_MS) {
    return result(
      'warn',
      `Сайт отвечает, но медленно: ${msLabel(outcome.ms)}.`,
      'Сеть площадки перегружена. Если можно, раздайте интернет с телефона и сравните.',
    );
  }
  return result('ok', `Сайт отвечает за ${msLabel(outcome.ms)}.`);
}

interface HealthBody {
  status?: unknown;
  groq_configured?: unknown;
  gemini_configured?: unknown;
}

/** Сервер приложения: GET /api/health. */
export function serverResult(outcome: FetchOutcome): CheckResult {
  const restartFix =
    'Подождите минуту и проверьте снова: после сна или перезапуска сервер стартует около минуты. Если ошибка не уходит, перезапустите Space на huggingface.co.';
  if (outcome.kind === 'error') {
    return result('fail', outcome.timedOut ? 'Сервер приложения не ответил вовремя.' : 'Сервер приложения не отвечает.', restartFix);
  }
  const body = (outcome.body && typeof outcome.body === 'object' ? outcome.body : {}) as HealthBody;
  if (outcome.status !== 200 || body.status !== 'ok') {
    const code = outcome.status !== 200 ? ` (ошибка ${outcome.status})` : '';
    return result('fail', `Сервер приложения не отвечает${code}.`, restartFix);
  }
  const groq = body.groq_configured === true;
  const gemini = body.gemini_configured === true;
  const took = `Сервер отвечает за ${msLabel(outcome.ms)}.`;
  if (!groq && !gemini) {
    return result(
      'fail',
      `${took} Но ключи ИИ на нём не заданы.`,
      'Добавьте GEMINI_API_KEY и GROQ_API_KEY в секреты Space на huggingface.co и перезапустите его.',
    );
  }
  if (!groq || !gemini) {
    const only = groq ? 'Groq' : 'Gemini';
    const missing = groq ? 'GEMINI_API_KEY' : 'GROQ_API_KEY';
    return result('warn', `${took} Задан только ${only}: запасного сервиса ИИ нет.`, `Добавьте ${missing} в секреты Space.`);
  }
  return result('ok', `${took} Ключи ИИ заданы: Gemini и Groq.`);
}

/**
 * Supabase from this network: GET {VITE_SUPABASE_URL}/auth/v1/health with the anon key, and when that
 * fails, the same through the Meldy site (/sb/…, lib/supabaseRoute.ts) — the app then takes that way.
 */
export function supabaseResult(outcome: FetchOutcome | null, viaSite: FetchOutcome | null = null): CheckResult {
  if (outcome === null) {
    return result('fail', 'В этой сборке не задан адрес Supabase.', 'Соберите приложение с VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY (они лежат в frontend/.env).');
  }
  if (outcome.kind === 'error') {
    if (viaSite?.kind === 'response' && viaSite.status === 200) {
      return result(
        'warn',
        `Эта сеть не пускает к supabase.co, но приложение работает через сайт Meldy: ответ за ${msLabel(viaSite.ms)}.`,
        'Вход по почте и паролю, экзамены и материалы работают. Вход через Google в этой сети может не открыться.',
      );
    }
    return result(
      'fail',
      'Эта сеть не пускает к Supabase (supabase.co), и запасной путь через сайт Meldy не ответил: вход, экзамены и материалы не загрузятся.',
      'Раздайте интернет с телефона (лучше другой оператор) и проверьте снова. Пример на /try работает и без Supabase.',
    );
  }
  if (outcome.status !== 200) {
    return result(
      'fail',
      `Supabase ответил ошибкой ${outcome.status}.`,
      'Откройте панель Supabase и проверьте, что проект не на паузе: бесплатный проект ставится на паузу, если им долго не пользуются.',
    );
  }
  if (outcome.ms > SLOW_SUPABASE_MS) {
    return result(
      'warn',
      `Supabase доступен, но отвечает медленно: ${msLabel(outcome.ms)}.`,
      'Вход и загрузка данных будут подтормаживать. Можно раздать интернет с телефона и сравнить.',
    );
  }
  return result('ok', `Supabase доступен из этой сети: ответ за ${msLabel(outcome.ms)}.`);
}

// ---------------------------------------------------------------------------------------------
// ИИ и сервисы на сервере: GET /api/health/deep

export type DeepCheckName = 'gemini' | 'groq' | 'tts' | 'supabase';

export interface DeepCheck {
  ok: boolean;
  provider?: string | null;
  model?: string | null;
  ms?: number;
  code?: string | null;
  fallback?: boolean;
}

export interface DeepRow {
  id: DeepCheckName;
  ok: boolean;
  text: string;
}

export interface DeepView {
  result: CheckResult;
  rows: DeepRow[];
  /** «Проверено 3 мин назад…»; null without an answer. */
  note: string | null;
}

/** An error code of the deep check in words. */
export function codeText(code: string | null | undefined): string {
  switch (code) {
    case 'timeout':
      return 'не ответил вовремя';
    case 'rate_limited':
      return 'упёрся в лимит запросов';
    case 'not_found':
      return 'модель недоступна';
    case 'permission':
      return 'ключ не подходит или отключён';
    case 'invalid_argument':
      return 'запрос отклонён';
    case 'network':
      return 'нет связи с сервисом';
    case 'empty':
      return 'пустой ответ';
    case 'unconfigured':
      return 'не настроен, нет ключа';
    default:
      if (typeof code === 'string' && /^http_\d{3}$/.test(code)) return `ошибка ${code.slice(5)}`;
      return 'ошибка';
  }
}

function deepCheck(value: unknown): DeepCheck | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.ok !== 'boolean') return null;
  return {
    ok: record.ok,
    provider: typeof record.provider === 'string' ? record.provider : null,
    model: typeof record.model === 'string' ? record.model : null,
    ms: typeof record.ms === 'number' && Number.isFinite(record.ms) ? record.ms : 0,
    code: typeof record.code === 'string' ? record.code : null,
    fallback: record.fallback === true,
  };
}

function deepRow(id: DeepCheckName, check: DeepCheck | null): DeepRow {
  const ms = check?.ms ? `, ${msLabel(check.ms)}` : '';
  const why = codeText(check?.code);
  switch (id) {
    case 'gemini':
      if (check?.ok) {
        const spare = check.fallback ? ' Первая модель из списка не ответила — работает запасная.' : '';
        return { id, ok: true, text: `Gemini отвечает: ${check.model ?? 'модель не названа'}${ms}.${spare}` };
      }
      return { id, ok: false, text: `Gemini не отвечает: ${why}.` };
    case 'groq':
      if (check?.ok) return { id, ok: true, text: `Groq отвечает: ${check.model ?? 'модель не названа'}${ms}.` };
      return { id, ok: false, text: `Groq не отвечает: ${why}.` };
    case 'tts':
      if (check?.ok) return { id, ok: true, text: `Озвучка на сервере работает${ms}.` };
      return { id, ok: false, text: `Озвучка на сервере не работает: ${why}.` };
    default:
      if (check?.ok) return { id, ok: true, text: `Сервер достаёт до Supabase${ms}.` };
      return { id, ok: false, text: `Сервер не достаёт до Supabase: ${why}.` };
  }
}

/** The deep check's answer as the card shows it: the verdict, one row per service, the age of the answer. */
export function deepView(outcome: FetchOutcome): DeepView {
  if (outcome.kind === 'error') {
    return {
      result: result('fail', 'Сервер не ответил на проверку ИИ.', 'Посмотрите карточку «Сервер приложения» выше и проверьте снова через минуту.'),
      rows: [],
      note: null,
    };
  }
  if (outcome.status === 401 || outcome.status === 404) {
    return {
      result: result('warn', 'Сервер этой версии не умеет проверять ИИ.', 'Выпустите свежую версию приложения и проверьте снова.'),
      rows: [],
      note: null,
    };
  }
  if (outcome.status === 429) {
    return { result: result('warn', 'Слишком много проверок подряд.', 'Подождите минуту и нажмите снова.'), rows: [], note: null };
  }
  const body = outcome.body && typeof outcome.body === 'object' ? (outcome.body as Record<string, unknown>) : null;
  const checks = body?.checks && typeof body.checks === 'object' ? (body.checks as Record<string, unknown>) : null;
  if (outcome.status !== 200 || !checks) {
    return {
      result: result('fail', `Проверка ИИ не удалась (ошибка ${outcome.status}).`, 'Посмотрите карточку «Сервер приложения» выше и проверьте снова через минуту.'),
      rows: [],
      note: null,
    };
  }
  const gemini = deepCheck(checks.gemini);
  const groq = deepCheck(checks.groq);
  const tts = deepCheck(checks.tts);
  const supabase = deepCheck(checks.supabase);
  const rows = [deepRow('gemini', gemini), deepRow('groq', groq), deepRow('tts', tts), deepRow('supabase', supabase)];

  let verdict: CheckResult;
  const aiUp = [gemini?.ok ? 'Gemini' : null, groq?.ok ? 'Groq' : null].filter((name): name is string => name !== null);
  if (aiUp.length === 0) {
    verdict = result(
      'fail',
      'ИИ не отвечает.',
      'Без ИИ не работают разбор лекций, билеты и проверка ответа. Покажите пример на /try — он работает без ИИ — и запасное видео. Если причина в лимите запросов, проверьте позже.',
    );
  } else if (!supabase?.ok) {
    verdict = result(
      'fail',
      'Сервер не достаёт до Supabase.',
      'Сервер проверяет вход через Supabase, поэтому функции с ИИ ответят ошибкой. Проверьте в панели Supabase, что проект не на паузе.',
    );
  } else if (aiUp.length === 1) {
    const down = aiUp[0] === 'Gemini' ? 'Groq' : 'Gemini';
    verdict = result(
      'warn',
      `Работает только ${aiUp[0]}: ${down} не отвечает.`,
      'Показывать можно: приложение само переключится на рабочий сервис, ответы могут идти дольше.',
    );
  } else if (!tts?.ok) {
    verdict = result('warn', 'ИИ отвечает, но озвучка на сервере не работает.', 'В билете вопросы экзаменатора прочитает голос браузера или они останутся текстом.');
  } else {
    verdict = result('ok', 'ИИ отвечает, озвучка и Supabase на сервере работают.');
  }

  const age = typeof body?.age_seconds === 'number' ? body.age_seconds : 0;
  const freshIn = typeof body?.fresh_in_seconds === 'number' ? body.fresh_in_seconds : 0;
  const when = age < 45 ? 'Проверено только что.' : `Проверено ${ageLabel(age)}.`;
  const next = freshIn > 0 ? ` Свежая проверка — через ${Math.max(1, Math.ceil(freshIn / 60))} мин.` : '';
  const note = `${when} Результат хранится 10 минут, чтобы проверка не тратила дневной лимит запросов.${next}`;
  return { result: verdict, rows, note };
}

// ---------------------------------------------------------------------------------------------
// Microphone, speech, voice

export type MicPermission = 'granted' | 'prompt' | 'denied' | 'unknown';

/** Before the microphone is switched on: what the browser already says about the permission. */
export function micIdle(permission: MicPermission, supported: boolean): CheckResult {
  if (!supported) {
    return result('fail', 'Этот браузер не умеет записывать звук на этой странице.', 'Откройте сайт в Chrome или Edge по адресу с https.');
  }
  if (permission === 'denied') return result('fail', 'Доступ к микрофону для этого сайта запрещён.', MIC_PERMISSION_FIX);
  if (permission === 'granted') return result('idle', 'Доступ к микрофону уже разрешён. Включите микрофон и скажите пару слов.');
  if (permission === 'prompt') return result('idle', 'Браузер спросит разрешение на микрофон — разрешите.');
  return result('idle', 'Включите микрофон и скажите пару слов.');
}

/** The microphone could not be opened (lib/oral/recorder RecorderError kinds). */
export function micError(kind: string): CheckResult {
  switch (kind) {
    case 'not-allowed':
      return result('fail', 'Браузер не дал доступ к микрофону.', MIC_PERMISSION_FIX);
    case 'audio-capture':
      return result('fail', 'Микрофон не найден или занят другой программой.', 'Подключите микрофон и закройте программы, которые могут его держать: Zoom, Teams, Telegram.');
    case 'unsupported':
      return result('fail', 'Этот браузер не умеет записывать звук на этой странице.', 'Откройте сайт в Chrome или Edge по адресу с https.');
    default:
      return result('fail', 'Микрофон не включился.', 'Обновите страницу и попробуйте снова.');
  }
}

/** After a few seconds with the microphone on: was a voice heard (the recorder's own speech detector)? */
export function micVerdict(speechMs: number): CheckResult {
  if (speechMs >= MIC_SPEECH_MS) return result('ok', 'Микрофон работает: голос слышно.');
  return result(
    'warn',
    'Микрофон включён, но голоса почти не слышно.',
    'Проверьте, какой микрофон выбран в браузере (значок слева от адреса) и в системе, и не выключен ли он кнопкой на ноутбуке или гарнитуре.',
  );
}

/** Web Speech before the test: there or not. */
export function speechIdle(supported: boolean): CheckResult {
  if (!supported) {
    return result(
      'warn',
      'В этом браузере нет распознавания речи.',
      'В билетах приложение распознаёт речь на сервере — проверьте это ниже. В примере /try отвечайте текстом или откройте Chrome.',
    );
  }
  return result('idle', 'Есть в этом браузере. Скажите фразу — за 5 секунд браузер покажет, что расслышал. В Chrome речь распознаёт сервис Google.');
}

/** Web Speech after the 5-second test (hooks/useSpeechAnswer error kinds). */
export function speechVerdict(text: string, error: string | null): CheckResult {
  const fallback = 'В билетах приложение само переключится на распознавание на сервере — проверьте его ниже. В примере /try отвечайте текстом.';
  switch (error) {
    case null:
      break;
    case 'not-allowed':
      return result('fail', 'Браузер не дал доступ к микрофону.', MIC_PERMISSION_FIX);
    case 'audio-capture':
      return result('fail', 'Микрофон не найден.', 'Подключите микрофон и проверьте карточку «Микрофон» выше.');
    case 'network':
      return result('fail', 'Распознаванию речи в браузере нужна связь с сервисом Google, а её нет.', fallback);
    case 'service-not-allowed':
      return result('fail', 'Браузер не разрешает распознавание речи на этой странице.', `Откройте сайт в Chrome или Edge. ${fallback}`);
    default:
      return result('fail', 'Распознавание речи остановилось.', `Попробуйте ещё раз. ${fallback}`);
  }
  const said = text.trim();
  if (!said) {
    return result('warn', 'Браузер ничего не распознал.', 'Скажите фразу громче и ближе к микрофону. Если снова пусто — в билетах приложение переключится на распознавание на сервере.');
  }
  return result('ok', `Браузер распознал: ${quoted(said)}.`);
}

/** Server recognition, signed out. */
export const STT_SIGNED_OUT = result('skip', 'Войдите, чтобы проверить: распознавание на сервере работает только с аккаунтом.');

/** Server recognition: the recording had no speech, or what the server said. */
export function sttVerdict(outcome: { heard: false } | { heard: true; text: string } | { heard: true; status: number | null; code: string | null }): CheckResult {
  if (!outcome.heard) return result('warn', 'В записи не было слышно речи.', 'Скажите фразу громче, пока идёт запись, и проверьте карточку «Микрофон».');
  if ('text' in outcome) {
    const said = outcome.text.trim();
    if (!said) return result('warn', 'Сервер не разобрал слов.', 'Скажите фразу чётче и ближе к микрофону.');
    return result('ok', `Сервер распознал: ${quoted(said)}.`);
  }
  if (outcome.status === 401) return result('fail', 'Сессия истекла.', 'Войдите снова и повторите проверку.');
  if (outcome.status === 429) return result('warn', 'Слишком много запросов подряд.', 'Подождите минуту и попробуйте снова.');
  if (outcome.code === 'stt_unconfigured') {
    return result('fail', 'Распознавание на сервере не настроено.', 'Нужен GROQ_API_KEY или GEMINI_API_KEY в секретах Space.');
  }
  return result(
    'fail',
    'Сервер не смог распознать речь.',
    'Попробуйте ещё раз. Если не выходит, отвечайте текстом: в билете это «Ответить текстом», а во время ответа голосом — «Текстом».',
  );
}

/** The examiner's voice, signed out. */
export const VOICE_SIGNED_OUT = result(
  'skip',
  'Войдите, чтобы проверить: голос экзаменатора работает только с аккаунтом. В примере /try голоса нет — вопросы показываются текстом.',
);

/** The examiner's voice: played to the end, not heard, or failed (utils/tts TTSUnavailableError or a playback error). */
export function voiceVerdict(outcome: 'ended' | 'not-heard' | 'server' | 'not-allowed' | 'playback', browserVoice: boolean): CheckResult {
  switch (outcome) {
    case 'ended':
      return result('ok', 'Фраза прозвучала до конца.');
    case 'not-heard':
      return result('fail', 'Звук играет, но его не слышно.', 'Проверьте громкость и устройство вывода звука в системе: колонки, наушники, HDMI проектора.');
    case 'server':
      return result(
        'fail',
        'Сервер не озвучил фразу.',
        browserVoice
          ? 'В билете вопросы прочитает голос браузера — он звучит иначе. Проверьте строку «Озвучка на сервере» в карточке ИИ.'
          : 'В билете вопросы останутся текстом: у браузера нет своего голоса. Проверьте строку «Озвучка на сервере» в карточке ИИ.',
      );
    case 'not-allowed':
      return result('fail', 'Браузер не дал включить звук.', 'Нажмите кнопку ещё раз. Если не помогает, разрешите звук для сайта в настройках браузера.');
    default:
      return result('fail', 'Звук не воспроизвёлся.', 'Проверьте устройство вывода звука и попробуйте снова.');
  }
}
