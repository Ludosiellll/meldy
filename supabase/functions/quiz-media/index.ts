// The `quiz-media` Edge Function (release 47): a question picture of a guest's quiz attempt, from the private bucket
// test-item-images, for the device's token of that attempt. Deploy with verify_jwt = true: the site calls it with its
// public anon key. The service key never leaves the function; the token, the attempt and the path are never logged.
//
// Deno glue only: the checks, the database call, storage and the answer are in ../_shared/quizMedia.ts (plain TS,
// tested with `node --experimental-strip-types --test supabase/functions/_shared/quizMedia.test.ts`).
import { createQuizMedia, readMediaEnv, type MediaLogLine } from '../_shared/quizMedia.ts';

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): unknown;
};

const env = readMediaEnv((name) => Deno.env.get(name));

/** One JSON line a request: the outcome and the status, never what was asked (quizMedia.ts MediaLogLine). */
function log(line: MediaLogLine): void {
  const text = JSON.stringify(line);
  if (line.status >= 500) console.error(text);
  else console.log(text);
}

const handle = createQuizMedia({ url: env.supabaseUrl, key: env.serviceKey, fetch: (input, init) => fetch(input, init), log });

Deno.serve((req: Request) => handle(req));
