'use strict';
// Classmates for the game take (slide 12 and the reel): players that join and answer through the game's public
// functions (live_join, live_state, live_answer) with the site's anon key, as a guest's phone does. The key is read
// from the site's own bundle and kept in memory; nothing here prints it or a player's token.
//
// The arc of the fight is set by `targets`: the share of the monster's health left after each question. Each
// classmate answers 1.3–14.8 s after the question opens (most within 3–9 s); enough of them answer right to bring
// the monster to its target, the rest answer wrong. Everyone answers, so a question closes on «Все ответили».
const crypto = require('crypto');

const SITE = 'https://ludosiel-studyforge.hf.space';
const SB = 'https://daunnytubqbzafjnpfnw.supabase.co';
const NAMES = ['Тимур', 'Соня', 'Артём', 'Вика', 'Даня', 'Полина', 'Егор', 'Лиза', 'Макс', 'Алина', 'Кирилл', 'Даша', 'Илья', 'Ева', 'Никита', 'Маша', 'Саша К.', 'Варя', 'Рома', 'Катя', 'Миша', 'Ксюша'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let anonKey = null;
async function key() {
  if (anonKey) return anonKey;
  const html = await (await fetch(SITE + '/')).text();
  const main = /assets\/index-[A-Za-z0-9_-]+\.js/.exec(html)[0];
  const js = await (await fetch(`${SITE}/${main}`)).text();
  const chunks = [main, ...new Set(js.match(/assets\/[A-Za-z0-9_-]+\.js/g) || [])];
  for (const c of chunks) {
    const body = c === main ? js : await (await fetch(`${SITE}/${c}`)).text();
    const i = body.indexOf('daunnytubqbzafjnpfnw.supabase.co');
    if (i < 0) continue;
    const m = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.exec(body.slice(i, i + 2000));
    if (m) return (anonKey = m[0]);
  }
  throw new Error('the anon key is not in the site bundle');
}

async function rpc(name, args) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const k = await key();
      const t0 = Date.now();
      const res = await fetch(`${SB}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: { apikey: k, authorization: `Bearer ${k}`, 'content-type': 'application/json' },
        body: JSON.stringify(args),
      });
      const text = await res.text();
      let body = text;
      try { body = JSON.parse(text); } catch { /* text */ }
      return { status: res.status, body, ms: Date.now() - t0 };
    } catch (e) {
      if (attempt >= 2) return { status: 0, body: String(e).slice(0, 120), ms: 0 };
      await sleep(400);
    }
  }
}

/** Damage of a right answer (CONTRACT §3): half for answering at all, half for speed; a streak adds up to +100 %. */
function damage(elapsedMs, timeS, streakAfter) {
  const limit = timeS * 1000;
  const share = 0.5 + 0.5 * Math.max(0, 1 - Math.min(Math.max(elapsedMs, 0), limit) / limit);
  return Math.round(100 * share * (1 + 0.25 * Math.min(Math.max(streakAfter - 1, 0), 4)));
}

class Classmates {
  /**
   * @param pin       the game's PIN
   * @param keyOf     (questionText, options) => index of the right option
   * @param targets   share of the monster's health to leave after each question
   * @param phoneDmg  (qi) => damage the filmed phone is expected to deal on question qi
   */
  constructor({ pin, keyOf, targets, phoneDmg = () => 0 }) {
    Object.assign(this, { pin, keyOf, targets, phoneDmg });
    this.players = [];
    this.scheduled = new Set();
    this.timers = [];
    this.offset = 0;
    this.stopped = false;
    this.errors = [];
  }

  /** Joins one by one, a fraction of a second apart, as a class does after the PIN goes up. */
  async join(names = NAMES, gap = [250, 650]) {
    for (const name of names) {
      const token = crypto.randomBytes(32).toString('base64url');
      const r = await rpc('live_join', { p_pin: this.pin, p_name: name, p_token: token, p_look: null });
      if (r.status !== 200) {
        this.errors.push({ fn: 'live_join', name, status: r.status });
        continue;
      }
      this.game = r.body.game_id;
      this.players.push({ name, token, streak: 0, frozen: false });
      await sleep(gap[0] + Math.random() * (gap[1] - gap[0]));
    }
    return this.players.length;
  }

  start() {
    void (async () => {
      while (!this.stopped) {
        const r = await rpc('live_state', { p_game: this.game, p_token: this.players[0].token, p_since_rev: null });
        if (r.status === 200) {
          const now = Date.parse(r.body.now);
          if (Number.isFinite(now)) this.offset = now - (Date.now() - r.ms / 2);
          const st = r.body;
          if ((st.state === 'countdown' || st.state === 'open') && st.question && !this.scheduled.has(st.qi)) {
            this.scheduled.add(st.qi);
            this.plan(st);
          }
          if (st.state === 'podium' || st.state === 'ended') break;
        } else this.errors.push({ fn: 'live_state', status: r.status });
        await sleep(600);
      }
    })();
  }

  plan(st) {
    const q = st.question;
    const right = this.keyOf(q.text, q.options);
    const opens = Date.parse(q.opens_at) - this.offset;
    let need = st.boss.hp - (this.targets[st.qi] ?? 0) * st.boss.hp_max - this.phoneDmg(st.qi);
    for (const p of this.players.slice().sort(() => Math.random() - 0.5)) {
      const d = Math.round(1300 + Math.pow(Math.random(), 1.6) * 13500);
      const ok = need > 0;
      if (ok) need -= p.frozen ? 0 : damage(d, st.time_s, p.streak + 1);
      const choice = ok ? right : (right + 1 + Math.floor(Math.random() * (q.options.length - 1))) % q.options.length;
      this.timers.push(setTimeout(async () => {
        const r = await rpc('live_answer', { p_game: this.game, p_token: p.token, p_qi: st.qi, p_choice: choice });
        if (r.status !== 200) this.errors.push({ fn: 'live_answer', qi: st.qi, status: r.status });
        if (ok) { p.streak = p.frozen ? 1 : p.streak + 1; p.frozen = false; } else { p.streak = 0; p.frozen = true; }
      }, Math.max(0, opens + d - Date.now())));
    }
  }

  stop() {
    this.stopped = true;
    this.timers.forEach(clearTimeout);
  }
}

module.exports = { Classmates, NAMES, rpc, damage };
