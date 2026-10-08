import { describe, expect, it } from 'vitest';
import {
  CHECK_ORDER,
  STT_SIGNED_OUT,
  VOICE_SIGNED_OUT,
  ageLabel,
  codeText,
  deepView,
  joinRu,
  micError,
  micIdle,
  micVerdict,
  msLabel,
  quoted,
  result,
  serverResult,
  siteResult,
  speechIdle,
  speechVerdict,
  sttVerdict,
  summarize,
  supabaseResult,
  voiceVerdict,
  type CheckId,
  type CheckResult,
  type CheckState,
} from './checkModel';

function all(state: CheckState, overrides: Partial<Record<CheckId, CheckResult>> = {}): Record<CheckId, CheckResult> {
  const base = Object.fromEntries(CHECK_ORDER.map((id) => [id, result(state, 'x')])) as Record<CheckId, CheckResult>;
  return { ...base, ...overrides };
}

const response = (status: number, ms = 120, body?: unknown) => ({ kind: 'response' as const, status, ms, body });
const failure = (timedOut = false) => ({ kind: 'error' as const, timedOut, ms: 15000 });

describe('words', () => {
  it('joins Russian lists with «и»', () => {
    expect(joinRu([])).toBe('');
    expect(joinRu(['ИИ'])).toBe('ИИ');
    expect(joinRu(['ИИ', 'голос'])).toBe('ИИ и голос');
    expect(joinRu(['сервер', 'ИИ', 'голос'])).toBe('сервер, ИИ и голос');
  });

  it('sets recognised words in «» with the full stop outside', () => {
    expect(quoted(' Спрос зависит от цены. ')).toBe('«Спрос зависит от цены»');
    expect(quoted('Что такое спрос?')).toBe('«Что такое спрос?»');
  });

  it('says times the Russian way', () => {
    expect(msLabel(87.4)).toBe('87 мс');
    expect(msLabel(1449)).toBe('1,4 с');
    expect(msLabel(12_300)).toBe('12 с');
    expect(ageLabel(10)).toBe('только что');
    expect(ageLabel(170)).toBe('3 мин назад');
    expect(ageLabel(7300)).toBe('2 ч назад');
  });

  it('names every deep-check code without provider text', () => {
    expect(codeText('timeout')).toBe('не ответил вовремя');
    expect(codeText('rate_limited')).toBe('упёрся в лимит запросов');
    expect(codeText('unconfigured')).toBe('не настроен, нет ключа');
    expect(codeText('http_503')).toBe('ошибка 503');
    expect(codeText('something new')).toBe('ошибка');
    expect(codeText(null)).toBe('ошибка');
  });
});

describe('summary', () => {
  it('«Можно показывать» when everything works', () => {
    const summary = summarize(all('ok'));
    expect(summary).toEqual({ tone: 'ready', title: 'Можно показывать', lines: [] });
  });

  it('names the problems first, even while other checks run', () => {
    const summary = summarize(all('ok', { supabase: result('fail', 'x'), mic: result('fail', 'x'), ai: result('running', 'x') }));
    expect(summary.tone).toBe('problems');
    expect(summary.title).toBe('Есть проблемы: Supabase и микрофон');
    expect(summary.lines).toContain('Ещё проверяется: ИИ.');
  });

  it('says what is left to check before saying the demo can go', () => {
    const summary = summarize(all('ok', { ai: result('idle', 'x'), voice: result('idle', 'x'), speech: result('warn', 'x') }));
    expect(summary.tone).toBe('pending');
    expect(summary.title).toBe('Пока всё в порядке');
    expect(summary.lines).toEqual(['Осталось проверить: ИИ и голос.', 'Замечания: распознавание в браузере.']);
  });

  it('shows «Проверяем…» while the automatic checks run', () => {
    const summary = summarize(all('idle', { site: result('running', 'x'), server: result('running', 'x') }));
    expect(summary.tone).toBe('checking');
    expect(summary.lines).toEqual(['Сейчас проверяется: интернет и сервер.']);
  });

  it('a caveat or a check that needs an account does not stop the demo, but is said', () => {
    const summary = summarize(all('ok', { ai: result('warn', 'x'), stt: STT_SIGNED_OUT, voice: VOICE_SIGNED_OUT }));
    expect(summary.tone).toBe('ready');
    expect(summary.lines).toEqual(['Замечания: ИИ — подробности ниже.', 'Без входа не проверены: распознавание на сервере и голос.']);
  });
});

describe('the site, the server and Supabase', () => {
  it('site: fast, slow, offline, not answering, an error page', () => {
    expect(siteResult(response(200, 240), true)).toEqual(result('ok', 'Сайт отвечает за 240 мс.'));
    expect(siteResult(response(200, 2600), true).state).toBe('warn');
    const offline = siteResult(failure(), false);
    expect(offline.state).toBe('fail');
    expect(offline.text).toBe('Нет подключения к интернету.');
    expect(offline.fix).toMatch(/раздайте интернет с телефона/);
    expect(siteResult(failure(true), true).text).toBe('Сайт не ответил вовремя.');
    const sleeping = siteResult(response(503), true);
    expect(sleeping.text).toBe('Сайт ответил ошибкой 503.');
    expect(sleeping.fix).toMatch(/засыпает/);
  });

  it('server: both keys, one key, no keys, not answering', () => {
    expect(serverResult(response(200, 90, { status: 'ok', groq_configured: true, gemini_configured: true })).state).toBe('ok');
    const one = serverResult(response(200, 90, { status: 'ok', groq_configured: true, gemini_configured: false }));
    expect(one.state).toBe('warn');
    expect(one.text).toMatch(/Задан только Groq/);
    expect(one.fix).toBe('Добавьте GEMINI_API_KEY в секреты Space.');
    const none = serverResult(response(200, 90, { status: 'ok', groq_configured: false, gemini_configured: false }));
    expect(none.state).toBe('fail');
    expect(none.fix).toMatch(/GEMINI_API_KEY и GROQ_API_KEY/);
    expect(serverResult(response(502, 90, '<html>Bad Gateway</html>')).text).toBe('Сервер приложения не отвечает (ошибка 502).');
    expect(serverResult(failure()).state).toBe('fail');
  });

  it('supabase: reachable, blocked by the network, an error, slow, not in the build', () => {
    expect(supabaseResult(response(200, 300))).toEqual(result('ok', 'Supabase доступен из этой сети: ответ за 300 мс.'));
    const throughSite = supabaseResult(failure(), response(200, 450));
    expect(throughSite.state).toBe('warn');
    expect(throughSite.text).toBe('Эта сеть не пускает к supabase.co, но приложение работает через сайт Meldy: ответ за 450 мс.');
    expect(throughSite.fix).toMatch(/Google/);
    expect(supabaseResult(failure(), failure()).state).toBe('fail');
    const blocked = supabaseResult(failure());
    expect(blocked.state).toBe('fail');
    expect(blocked.text).toMatch(/Эта сеть не пускает к Supabase/);
    expect(blocked.fix).toMatch(/раздайте интернет с телефона/i);
    expect(blocked.fix).toMatch(/\/try работает и без Supabase/);
    expect(supabaseResult(response(503)).fix).toMatch(/не на паузе/);
    expect(supabaseResult(response(200, 4200)).state).toBe('warn');
    expect(supabaseResult(null).state).toBe('fail');
  });
});

describe('the AI on the server (/api/health/deep)', () => {
  const ok = (extra: Record<string, unknown> = {}) => ({ ok: true, ms: 640, code: null, ...extra });
  const down = (code: string) => ({ ok: false, ms: 8000, code });
  const deep = (checks: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    response(200, 900, { ok: true, checked_at: '2026-10-05T10:00:00Z', cached: false, age_seconds: 0, fresh_in_seconds: 600, checks, ...extra });
  const healthy = {
    gemini: ok({ provider: 'Gemini', model: 'model-a', fallback: false }),
    groq: ok({ provider: 'Groq', model: 'groq-fast' }),
    tts: ok({ provider: 'edge-tts' }),
    supabase: ok({ provider: 'Supabase' }),
  };

  it('names the model that answered for each provider', () => {
    const view = deepView(deep(healthy));
    expect(view.result.state).toBe('ok');
    expect(view.rows.map((row) => row.text)).toEqual([
      'Gemini отвечает: model-a, 640 мс.',
      'Groq отвечает: groq-fast, 640 мс.',
      'Озвучка на сервере работает, 640 мс.',
      'Сервер достаёт до Supabase, 640 мс.',
    ]);
    expect(view.note).toBe('Проверено только что. Результат хранится 10 минут, чтобы проверка не тратила дневной лимит запросов. Свежая проверка — через 10 мин.');
  });

  it('adds the /try example’s AI check: whose key, today’s calls against the cap, never the key', () => {
    const own = deepView(deep(healthy, { try: { key: 'own', day: '2026-10-07', calls: 12, cap: 400, keywords: 0 } }));
    expect(own.result.state).toBe('ok');
    expect(own.rows[4]).toEqual({ id: 'try', ok: true, text: 'Пример /try: ответы проверяет ИИ на своём ключе, сегодня 12 из 400.' });
    const shared = deepView(deep(healthy, { try: { key: 'shared', day: '2026-10-07', calls: 60, cap: 60, keywords: 3 } }));
    expect(shared.rows[4]).toEqual({
      id: 'try',
      ok: false,
      text: 'Пример /try: ответы проверяет ИИ на основных ключах (своего ключа у примера нет), сегодня 60 из 60. Проверки на сегодня закончились, дальше — по ключевым словам. По ключевым словам сегодня проверено ответов: 3.',
    });
    const none = deepView(deep(healthy, { try: { key: 'none', day: '2026-10-07', calls: 0, cap: 0, keywords: 1 } }));
    expect(none.rows[4]).toEqual({ id: 'try', ok: false, text: 'Пример /try: ключа Gemini нет, ответы проверяются по ключевым словам. По ключевым словам сегодня проверено ответов: 1.' });
    // The example does not change the verdict on the AI, and an older server without `try` shows no row.
    expect(none.result.state).toBe('ok');
    expect(deepView(deep(healthy)).rows).toHaveLength(4);
    expect(deepView(deep(healthy, { try: { key: 'secret-key-value' } })).rows).toHaveLength(4);
  });

  it('says when a spare Gemini model answered and how old a cached answer is', () => {
    const view = deepView(deep({ ...healthy, gemini: ok({ model: 'model-b', fallback: true }) }, { cached: true, age_seconds: 250, fresh_in_seconds: 350 }));
    expect(view.rows[0].text).toBe('Gemini отвечает: model-b, 640 мс. Первая модель из списка не ответила — работает запасная.');
    expect(view.note).toMatch(/^Проверено 4 мин назад\./);
    expect(view.note).toMatch(/через 6 мин\.$/);
  });

  it('names the models that did not answer, a quick-check refusal and a retired fast model', () => {
    const view = deepView(deep({
      ...healthy,
      gemini: ok({ model: 'gemini-3.1-flash-lite', fallback: true,
        tried: [{ model: 'gemini-2.5-flash-lite', code: 'not_found', detail: 'not_found' }],
        fast: { ok: false, code: 'invalid_argument', detail: 'invalid_argument:thinking' } }),
      groq: ok({ model: 'openai/gpt-oss-120b', fast: { model: 'openai/gpt-oss-20b', ok: false, code: 'invalid_argument', detail: 'model_decommissioned' } }),
    }));
    expect(view.rows[0].text).toBe(
      'Gemini отвечает: gemini-3.1-flash-lite, 640 мс. Первая модель из списка не ответила — работает запасная. '
      + 'Не ответили: gemini-2.5-flash-lite — модель недоступна (not_found). '
      + 'Быстрые проверки ответов на этой модели не проходят: запрос отклонён (не принимает настройку размышлений).',
    );
    expect(view.rows[1].text).toBe('Groq отвечает: openai/gpt-oss-120b, 640 мс. Быстрая модель openai/gpt-oss-20b не отвечает: запрос отклонён (модель снята).');
    const down = deepView(deep({ ...healthy, gemini: { ok: false, ms: 900, code: 'not_found', tried: [
      { model: 'a', code: 'not_found', detail: null }, { model: 'b', code: 'invalid_argument', detail: 'invalid_argument:thinking' }] } }));
    expect(down.rows[0].text).toBe('Gemini не отвечает: модель недоступна. Модели: a — модель недоступна; b — запрос отклонён (не принимает настройку размышлений).');
  });

  it('says when the provider has restricted the whole account', () => {
    const view = deepView(deep({ ...healthy, groq: { ok: false, ms: 99, model: 'openai/gpt-oss-120b', code: 'permission', detail: 'organization_restricted' } }));
    expect(view.rows[1].text).toContain('аккаунт у провайдера ограничен');
  });

  it('one AI provider down is a caveat, both down is a problem', () => {
    const one = deepView(deep({ ...healthy, gemini: down('rate_limited') }));
    expect(one.result.state).toBe('warn');
    expect(one.result.text).toBe('Работает только Groq: Gemini не отвечает.');
    expect(one.rows[0]).toEqual({ id: 'gemini', ok: false, text: 'Gemini не отвечает: упёрся в лимит запросов.' });
    const both = deepView(deep({ ...healthy, gemini: down('timeout'), groq: down('unconfigured') }));
    expect(both.result.state).toBe('fail');
    expect(both.result.fix).toMatch(/\/try/);
    // The example checks answers by the AI too; without it, by key words (audit PUB-27): never «работает без ИИ».
    expect(both.result.fix).not.toMatch(/работает без ИИ/);
    expect(both.result.fix).toContain('без ИИ он проверяет ответы по ключевым словам');
  });

  it('the server not reaching Supabase is a problem; speech synthesis down is a caveat', () => {
    expect(deepView(deep({ ...healthy, supabase: down('http_503') })).result.state).toBe('fail');
    const tts = deepView(deep({ ...healthy, tts: down('network') }));
    expect(tts.result.state).toBe('warn');
    expect(tts.rows[2].text).toBe('Озвучка на сервере не работает: нет связи с сервисом.');
  });

  it('an older server, the rate limit, an error page or no answer', () => {
    expect(deepView(response(401)).result).toEqual(
      result('warn', 'Сервер этой версии не умеет проверять ИИ.', 'Выпустите свежую версию приложения и проверьте снова.'),
    );
    expect(deepView(response(404)).result.state).toBe('warn');
    expect(deepView(response(429)).result.text).toBe('Слишком много проверок подряд.');
    expect(deepView(response(502, 100, '<html>')).result.state).toBe('fail');
    const none = deepView(failure(true));
    expect(none.result.state).toBe('fail');
    expect(none.rows).toEqual([]);
    expect(none.note).toBeNull();
  });

  it('a broken answer shape reads as «не отвечает», never as working', () => {
    const view = deepView(deep({ gemini: { ok: 'yes' }, groq: null }));
    expect(view.rows.every((row) => !row.ok)).toBe(true);
    expect(view.result.state).toBe('fail');
  });
});

describe('microphone, speech, voice', () => {
  it('microphone before the test: the permission the browser already knows', () => {
    expect(micIdle('granted', true).state).toBe('idle');
    expect(micIdle('denied', true)).toMatchObject({ state: 'fail', text: 'Доступ к микрофону для этого сайта запрещён.' });
    expect(micIdle('prompt', true).text).toMatch(/разрешите/);
    expect(micIdle('unknown', false).state).toBe('fail');
  });

  it('microphone errors and the verdict after a few seconds', () => {
    expect(micError('not-allowed').fix).toMatch(/разрешите микрофон/);
    expect(micError('audio-capture').text).toBe('Микрофон не найден или занят другой программой.');
    expect(micError('unsupported').fix).toMatch(/Chrome или Edge/);
    expect(micError('other').state).toBe('fail');
    expect(micVerdict(400).state).toBe('ok');
    expect(micVerdict(100)).toMatchObject({ state: 'warn', text: 'Микрофон включён, но голоса почти не слышно.' });
  });

  it('speech in the browser: there or not, what it heard, its errors', () => {
    expect(speechIdle(true).state).toBe('idle');
    expect(speechIdle(false)).toMatchObject({ state: 'warn', text: 'В этом браузере нет распознавания речи.' });
    expect(speechVerdict(' спрос зависит от цены ', null)).toEqual(result('ok', 'Браузер распознал: «спрос зависит от цены».'));
    expect(speechVerdict('', null).state).toBe('warn');
    const network = speechVerdict('', 'network');
    expect(network.state).toBe('fail');
    expect(network.text).toMatch(/Google/);
    expect(network.fix).toMatch(/на сервере/);
    expect(speechVerdict('', 'not-allowed').fix).toMatch(/разрешите микрофон/);
    expect(speechVerdict('', 'restart-failed').state).toBe('fail');
  });

  it('speech on the server: no speech in the recording, the text, the errors', () => {
    expect(sttVerdict({ heard: false }).state).toBe('warn');
    expect(sttVerdict({ heard: true, text: 'Спрос зависит от цены.' })).toEqual(result('ok', 'Сервер распознал: «Спрос зависит от цены».'));
    expect(sttVerdict({ heard: true, text: '  ' }).text).toBe('Сервер не разобрал слов.');
    expect(sttVerdict({ heard: true, status: 401, code: null }).text).toBe('Сессия истекла.');
    expect(sttVerdict({ heard: true, status: 429, code: 'ai_busy' }).state).toBe('warn');
    expect(sttVerdict({ heard: true, status: 503, code: 'stt_unconfigured' }).text).toBe('Распознавание на сервере не настроено.');
    expect(sttVerdict({ heard: true, status: null, code: null }).fix).toMatch(/Текстом/);
    expect(STT_SIGNED_OUT.state).toBe('skip');
  });

  it('the examiner voice: heard, not heard, the server, the browser', () => {
    expect(voiceVerdict('ended', true).state).toBe('ok');
    expect(voiceVerdict('not-heard', true).fix).toMatch(/HDMI/);
    expect(voiceVerdict('server', true).fix).toMatch(/голос браузера/);
    expect(voiceVerdict('server', false).fix).toMatch(/останутся текстом/);
    expect(voiceVerdict('not-allowed', true).text).toBe('Браузер не дал включить звук.');
    expect(VOICE_SIGNED_OUT.text).toMatch(/В примере \/try голоса нет/);
  });
});
