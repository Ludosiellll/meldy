export interface SandboxCase {
  input: unknown;
  expected: unknown;
}

export interface SandboxResult {
  results: Array<{ actual: unknown; passed: boolean }>;
}

/**
 * Runs practice code in a short-lived Worker. The Worker has no DOM,
 * localStorage, cookies or access to the app's authenticated page context.
 */
export function runCodeSandbox(
  source: string,
  cases: SandboxCase[],
  timeoutMs = 1500,
): Promise<SandboxResult> {
  const workerSource = `
    self.fetch = undefined;
    self.XMLHttpRequest = undefined;
    self.WebSocket = undefined;
    self.EventSource = undefined;
    self.importScripts = undefined;
    self.onmessage = (event) => {
      try {
        const factory = new Function('"use strict"; return (' + event.data.source + ')');
        const candidate = factory();
        if (typeof candidate !== 'function') throw new Error('Решение должно возвращать функцию');
        const results = event.data.cases.map((testCase) => {
          const args = Array.isArray(testCase.input) ? testCase.input : [testCase.input];
          const actual = candidate(...args);
          return { actual, passed: JSON.stringify(actual) === JSON.stringify(testCase.expected) };
        });
        self.postMessage({ ok: true, results });
      } catch (error) {
        self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    };
  `;

  return new Promise((resolve, reject) => {
    const blobUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
    const worker = new Worker(blobUrl);
    const cleanup = () => {
      worker.terminate();
      URL.revokeObjectURL(blobUrl);
    };
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error('Проверка заняла слишком много времени и была остановлена'));
    }, timeoutMs);

    worker.onmessage = (event) => {
      window.clearTimeout(timer);
      cleanup();
      if (!event.data?.ok) {
        reject(new Error(event.data?.error || 'Не удалось выполнить код'));
        return;
      }
      resolve({ results: event.data.results });
    };
    worker.onerror = () => {
      window.clearTimeout(timer);
      cleanup();
      reject(new Error('Не удалось запустить изолированную проверку'));
    };
    worker.postMessage({ source, cases });
  });
}
