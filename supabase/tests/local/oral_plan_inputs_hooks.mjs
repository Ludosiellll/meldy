// LOCAL ONLY. Node module hooks for oral_plan_inputs_equivalence.mjs: the site's own modules (frontend/src, written for
// Vite) run in plain Node with --experimental-strip-types. Two things differ from Vite:
//   * a relative import without an extension ('../../api/learning') resolves to its .ts file;
//   * frontend/src/lib/supabase.ts (the Supabase client, an npm package) is replaced by a PostgREST stand-in: every query
//     the site builds (from().select().in().eq().gte().order().range()) runs as the SQL PostgREST would run, with psql as
//     role authenticated and the JWT sub of globalThis.__T11_USER__, so the policies apply as for the signed-in user.
//     The database is process.env.T11_DB (psql's PGHOST / PGPORT / PGUSER).
const FAKE_URL = 't11-fake:supabase';

const FAKE_SOURCE = `
import { execFileSync } from 'node:child_process';
const lit = (v) => (v === null || v === undefined ? 'null' : "'" + String(v).replace(/'/g, "''") + "'");
function ident(name) {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error('t11 stand-in: bad name ' + name);
  return '"' + name + '"';
}
function column(expr) {
  const m = /^([a-z_]+)(->>?)([a-z_]+)$/.exec(expr);
  return m ? ident(m[1]) + m[2] + lit(m[3]) : ident(expr);
}
class Query {
  constructor(table) { this.table = table; this.columns = '*'; this.where = []; this.orders = []; this.limit = null; this.offset = null; }
  select(columns) { this.columns = columns.split(',').map((c) => { const name = c.trim(); return column(name) + ' as ' + ident(name.replace(/\\W+/g, '_')); }).join(', '); return this; }
  in(col, values) { this.where.push(column(col) + ' in (' + (values.length ? values.map(lit).join(', ') : 'null') + ')'); return this; }
  eq(col, value) { this.where.push(column(col) + ' = ' + lit(value)); return this; }
  gte(col, value) { this.where.push(column(col) + ' >= ' + lit(value)); return this; }
  order(col, options = {}) { this.orders.push(column(col) + (options.ascending === false ? ' desc' : ' asc')); return this; }
  range(from, to) { this.offset = from; this.limit = to - from + 1; return this; }
  then(resolve, reject) {
    let result;
    try { result = this.run(); } catch (error) { if (reject) return reject(error); throw error; }
    return resolve ? resolve(result) : result;
  }
  run() {
    let sql = 'select ' + this.columns + ' from public.' + ident(this.table);
    if (this.where.length) sql += ' where ' + this.where.join(' and ');
    if (this.orders.length) sql += ' order by ' + this.orders.join(', ');
    if (this.limit !== null) sql += ' limit ' + this.limit;
    if (this.offset !== null) sql += ' offset ' + this.offset;
    const script = 'begin;\\nset local role authenticated;\\n'
      + "select set_config('request.jwt.claim.sub', " + lit(globalThis.__T11_USER__) + ', true) \\\\g /dev/null\\n'
      + "select coalesce(json_agg(t), '[]'::json) from (" + sql + ') t;\\ncommit;\\n';
    const out = execFileSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-d', process.env.T11_DB, '-f', '-'], { input: script, encoding: 'utf8' });
    return { data: JSON.parse(out), error: null };
  }
}
export const supabase = { from: (table) => new Query(table) };
export const SUPABASE_URL = 'http://postgrest.local';
`;

export async function resolve(specifier, context, nextResolve) {
  let resolved;
  try {
    resolved = await nextResolve(specifier, context);
  } catch (error) {
    if (error?.code !== 'ERR_MODULE_NOT_FOUND' || !specifier.startsWith('.')) throw error;
    resolved = null;
    for (const suffix of ['.ts', '.tsx', '/index.ts']) {
      try {
        resolved = await nextResolve(specifier + suffix, context);
        break;
      } catch {
        // try the next form
      }
    }
    if (!resolved) throw error;
  }
  if (resolved.url.endsWith('/frontend/src/lib/supabase.ts')) return { url: FAKE_URL, shortCircuit: true };
  return resolved;
}

export async function load(url, context, nextLoad) {
  if (url === FAKE_URL) return { format: 'module', source: FAKE_SOURCE, shortCircuit: true };
  return nextLoad(url, context);
}
