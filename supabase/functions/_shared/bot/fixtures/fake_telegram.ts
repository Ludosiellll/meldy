// A fake Bot API for the bot's tests (spec §8.1): a `fetch` that records (method, params), answers with canned
// results and injects failures — 429 with retry_after, 403 «bot was blocked», 400 «message is not modified» /
// «message to edit not found» / «query is too old», AbortError / TimeoutError, 5xx, and a network error whose
// message carries the request URL (as Deno's does), to prove the token never leaks.

/** The only token tests use: obviously fake (BUILD_BRIEF «Secrets»). */
export const TEST_TOKEN = '123456:TEST_TOKEN_NOT_REAL_xxxxxxxxxxxxxxxxxxxxx';
export const TEST_BOT = { id: 123456, is_bot: true, first_name: 'Meldy', username: 'Meldyteach_bot' };

export type Failure =
  | { kind: '429'; retryAfter: number }
  | { kind: '403'; description?: string }
  | { kind: '400'; description: string }
  | { kind: 'migrate'; to: number }
  | { kind: 'abort' }
  | { kind: 'timeout' }
  | { kind: '5xx'; json?: boolean }
  | { kind: 'network' };

export interface Call { method: string; params: Record<string, any>; at: number }

export const NOT_MODIFIED = 'Bad Request: message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message';
export const EDIT_NOT_FOUND = 'Bad Request: message to edit not found';
export const DELETE_NOT_FOUND = 'Bad Request: message to delete not found';
export const QUERY_TOO_OLD = 'Bad Request: query is too old and response timeout expired or query ID is invalid';
export const BLOCKED = 'Forbidden: bot was blocked by the user';

/** The test project's function URL (`https://<ref>.supabase.co/functions/v1/telegram`). */
export const TEST_FUNCTION_URL = 'https://abcdefghijklmnopqrst.supabase.co/functions/v1/telegram';

export function fakeTelegram(options: { token?: string; now?: () => number; webhookUrl?: string } = {}) {
  const token = options.token ?? TEST_TOKEN;
  const webhookInfoUrl = options.webhookUrl ?? '';
  const now = options.now ?? (() => Date.now());
  const calls: Call[] = [];
  const failures = new Map<string, Failure[]>();
  const results = new Map<string, (params: Record<string, any>) => unknown>();
  let nextMessageId = 1000;
  /** Messages the fake «chat» holds: id → text and keyboard (for assertions on edits and deletions). */
  const messages = new Map<string, { chatId: number; messageId: number; text: string; markup: any }>();
  const key = (chatId: number, messageId: number) => `${chatId}:${messageId}`;

  async function readParams(init?: RequestInit): Promise<Record<string, any>> {
    const body = init?.body;
    if (typeof body === 'string') return JSON.parse(body);
    if (body instanceof FormData) {
      const out: Record<string, any> = {};
      for (const [k, v] of body.entries()) {
        if (typeof v === 'string') {
          try { out[k] = JSON.parse(v); } catch { out[k] = v; }
        } else {
          out[k] = { file: (v as File).name, type: (v as File).type, size: (v as File).size };
        }
      }
      return out;
    }
    return {};
  }

  const fetchFn = async (url: string, init?: RequestInit): Promise<Response> => {
    const m = /^https:\/\/api\.telegram\.org\/bot([^/]+)\/(\w+)$/.exec(url);
    if (!m) throw new Error(`fake telegram: unexpected URL shape`);
    if (m[1] !== token) throw new Error('fake telegram: wrong token');
    const method = m[2];
    const params = await readParams(init);
    calls.push({ method, params, at: now() });
    const queue = failures.get(method);
    const failure = queue && queue.length > 0 ? queue.shift() : undefined;
    if (failure) {
      switch (failure.kind) {
        case 'abort': throw new DOMException('The signal has been aborted', 'AbortError');
        case 'timeout': throw new DOMException('The operation timed out.', 'TimeoutError');
        case 'network': throw new TypeError(`error sending request for url (${url}): connection reset`);
        case '5xx':
          return failure.json
            ? Response.json({ ok: false, error_code: 502, description: 'Bad Gateway' }, { status: 502 })
            : new Response('<html>502 Bad Gateway</html>', { status: 502 });
        case '429':
          return Response.json({ ok: false, error_code: 429, description: `Too Many Requests: retry after ${failure.retryAfter}`,
            parameters: { retry_after: failure.retryAfter } }, { status: 429 });
        case '403':
          return Response.json({ ok: false, error_code: 403, description: failure.description ?? BLOCKED }, { status: 403 });
        case '400':
          return Response.json({ ok: false, error_code: 400, description: failure.description }, { status: 400 });
        case 'migrate':
          return Response.json({ ok: false, error_code: 400, description: 'Bad Request: group chat was upgraded to a supergroup chat',
            parameters: { migrate_to_chat_id: failure.to } }, { status: 400 });
      }
    }
    const custom = results.get(method);
    let result: unknown = true;
    if (custom) result = custom(params);
    else if (method === 'sendMessage') {
      const messageId = nextMessageId++;
      messages.set(key(params.chat_id, messageId), { chatId: params.chat_id, messageId, text: params.text, markup: params.reply_markup ?? null });
      result = { message_id: messageId, date: Math.floor(now() / 1000), chat: { id: params.chat_id, type: params.chat_id > 0 ? 'private' : 'group' }, text: params.text };
    } else if (method === 'editMessageText') {
      const k = key(params.chat_id, params.message_id);
      const old = messages.get(k);
      if (old && old.text === params.text && JSON.stringify(old.markup ?? null) === JSON.stringify(params.reply_markup ?? null)) {
        return Response.json({ ok: false, error_code: 400, description: NOT_MODIFIED }, { status: 400 });
      }
      messages.set(k, { chatId: params.chat_id, messageId: params.message_id, text: params.text, markup: params.reply_markup ?? null });
      result = { message_id: params.message_id, date: 1, chat: { id: params.chat_id, type: 'private' }, text: params.text };
    } else if (method === 'editMessageReplyMarkup') {
      const k = key(params.chat_id, params.message_id);
      const old = messages.get(k);
      if (old) old.markup = params.reply_markup ?? null;
    } else if (method === 'deleteMessage') {
      messages.delete(key(params.chat_id, params.message_id));
    } else if (method === 'getMe') result = TEST_BOT;
    else if (method === 'getWebhookInfo') {
      result = { url: webhookInfoUrl, has_custom_certificate: false,
        pending_update_count: 0, max_connections: 10, allowed_updates: ['message', 'callback_query', 'my_chat_member'] };
    } else if (method === 'getUserProfilePhotos') result = { total_count: 0, photos: [] };
    return Response.json({ ok: true, result });
  };

  return {
    token,
    fetch: fetchFn,
    calls,
    messages,
    /** Queue failures for a method; each is used once, in order. */
    fail(method: string, ...queue: Failure[]) {
      failures.set(method, [...(failures.get(method) ?? []), ...queue]);
    },
    /** A custom result for a method. */
    result(method: string, fn: (params: Record<string, any>) => unknown) {
      results.set(method, fn);
    },
    /** Put a message in the fake chat (one the bot sent earlier). */
    seed(chatId: number, messageId: number, text: string, markup: any = null) {
      messages.set(key(chatId, messageId), { chatId, messageId, text, markup });
    },
    of(method: string): Call[] {
      return calls.filter((call) => call.method === method);
    },
    methods(): string[] {
      return calls.map((call) => call.method);
    },
    reset() {
      calls.length = 0;
      failures.clear();
    },
  };
}

export type FakeTelegram = ReturnType<typeof fakeTelegram>;

/** A sleep that records the waits and returns at once. */
export function fakeSleep() {
  const waits: number[] = [];
  return { waits, sleep: async (ms: number) => { waits.push(ms); } };
}
