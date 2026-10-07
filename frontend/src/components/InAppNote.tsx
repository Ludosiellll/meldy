import { useId, useState, type ReactNode } from 'react';
import { chromeIntentUrl, inAppName, type InAppBrowser } from '../lib/inAppBrowser';
import './inAppNote.css';

/**
 * «Откройте ссылку в Chrome или Safari» (2026-10-07): inside the built-in browser of Telegram, Viber, Instagram or
 * Facebook Google refuses to sign in (403 disallowed_useragent) and the microphone is often missing. The same note on
 * /join, /login and /register: «Скопировать ссылку», on Android a link straight into Chrome, on iPhone where to tap.
 * `url` is the address to open elsewhere (with its ?next=, so the visitor lands where they were going).
 */

interface Props {
  browser: InAppBrowser;
  url: string;
  /** One more line at the end (on /login and /register: e-mail works here too). */
  extra?: ReactNode;
}

async function copyLink(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // falls through
  }
  return false;
}

export default function InAppNote({ browser, url, extra }: Props) {
  const headingId = useId();
  const [copied, setCopied] = useState<boolean | null>(null);
  const appName = inAppName(browser.app);
  const intent = browser.os === 'android' ? chromeIntentUrl(url) : null;
  return (
    <section className="ia-note" aria-labelledby={headingId}>
      <h2 id={headingId} className="ia-h">
        Откройте ссылку в Chrome или Safari
      </h2>
      <p>
        {appName ? `Во встроенном браузере ${appName}` : 'Во встроенном браузере приложения'} Google не даёт войти, а микрофон
        для ответов вслух часто не работает.
      </p>
      <div className="ia-do">
        <button type="button" className="sf-primary ia-copy" onClick={() => void copyLink(url).then(setCopied)}>
          {copied ? 'Ссылка скопирована' : 'Скопировать ссылку'}
        </button>
        {intent && (
          <a className="au-link" href={intent}>
            Открыть в Chrome
          </a>
        )}
      </div>
      {copied === false && (
        <p className="ia-hint">
          Не получилось скопировать. Нажмите на ссылку и удерживайте: <span className="ia-url">{url}</span>
        </p>
      )}
      {browser.os === 'ios' && <p className="ia-hint">Или нажмите «⋯» или «Поделиться» → «Открыть в Safari».</p>}
      {browser.os === 'other' && <p className="ia-hint">Вставьте ссылку в адресную строку Chrome или Safari.</p>}
      {extra}
    </section>
  );
}
