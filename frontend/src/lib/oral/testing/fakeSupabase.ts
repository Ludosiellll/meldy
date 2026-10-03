/**
 * Test helper: a tiny stand-in for the Supabase query builder used by the answer screen
 * (select / eq / in / order / range / maybeSingle, awaited directly or through maybeSingle) and
 * for rpc. Rows live in plain arrays per table; a table can be made to fail. Not used by app code.
 */
type Row = Record<string, unknown>;

export interface FakeQueryCall {
  table: string;
  columns: string | null;
  filters: Array<{ op: 'eq' | 'in'; column: string; value: unknown }>;
}

export interface FakeSupabaseOptions {
  tables?: Record<string, Row[]>;
  /** Tables whose reads answer with this error. */
  failing?: Record<string, { code?: string; message?: string }>;
  rpc?: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
}

export function createFakeSupabase(options: FakeSupabaseOptions = {}) {
  const tables: Record<string, Row[]> = options.tables ?? {};
  const calls: FakeQueryCall[] = [];
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];

  class Query implements PromiseLike<{ data: Row[] | null; error: unknown }> {
    private call: FakeQueryCall;
    private window: [number, number] | null = null;

    constructor(table: string) {
      this.call = { table, columns: null, filters: [] };
      calls.push(this.call);
    }

    select(columns?: string) {
      this.call.columns = columns ?? '*';
      return this;
    }

    eq(column: string, value: unknown) {
      this.call.filters.push({ op: 'eq', column, value });
      return this;
    }

    in(column: string, value: unknown[]) {
      this.call.filters.push({ op: 'in', column, value });
      return this;
    }

    order() {
      return this;
    }

    range(from: number, to: number) {
      this.window = [from, to];
      return this;
    }

    private result(): { data: Row[] | null; error: unknown } {
      const failure = options.failing?.[this.call.table];
      if (failure) return { data: null, error: failure };
      let rows = (tables[this.call.table] ?? []).filter((row) =>
        this.call.filters.every((filter) =>
          filter.op === 'eq' ? row[filter.column] === filter.value : (filter.value as unknown[]).includes(row[filter.column]),
        ),
      );
      if (this.window) rows = rows.slice(this.window[0], this.window[1] + 1);
      return { data: rows, error: null };
    }

    maybeSingle() {
      const { data, error } = this.result();
      return Promise.resolve({ data: error ? null : (data?.[0] ?? null), error });
    }

    then<A = { data: Row[] | null; error: unknown }, B = never>(
      onfulfilled?: ((value: { data: Row[] | null; error: unknown }) => A | PromiseLike<A>) | null,
      onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
    ): PromiseLike<A | B> {
      return Promise.resolve(this.result()).then(onfulfilled, onrejected);
    }
  }

  const client = {
    from: (table: string) => new Query(table),
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return options.rpc ? options.rpc(fn, args) : Promise.resolve({ data: null, error: { code: 'PGRST202' } });
    },
  };
  return { client, calls, rpcCalls, tables };
}
