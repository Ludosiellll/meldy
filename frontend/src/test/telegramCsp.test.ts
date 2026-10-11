import { describe, expect, it } from 'vitest';
import nginxConf from '../../../nginx.conf?raw';
import { TELEGRAM_SCRIPT } from '../lib/telegram/miniApp';

/**
 * The site's CSP (nginx.conf) and the Telegram Mini App (meldy-notes 10_Project/Telegram_Mini_App_Spec_2026-10-10.md,
 * decision 12): scripts from the site and Telegram's one file, frames only inside Telegram Web; nothing else widened.
 */
const policies = Array.from(nginxConf.matchAll(/add_header Content-Security-Policy "([^"]+)" always;/g), (match) => match[1]);

function directives(policy: string): Map<string, string> {
  return new Map(
    policy
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [name, ...sources] = part.split(/\s+/);
        return [name, sources.join(' ')] as [string, string];
      }),
  );
}

describe('the CSP of every location (nginx.conf)', () => {
  it('is one policy, sent from the server and from each location that sets headers of its own', () => {
    expect(policies).toHaveLength(3);
    expect(new Set(policies).size).toBe(1);
  });

  it('runs scripts from the site and Telegram\'s telegram-web-app.js only — the file, not the host', () => {
    const csp = directives(policies[0]);
    expect(csp.get('script-src')).toBe("'self' https://telegram.org/js/telegram-web-app.js");
    const script = new URL(TELEGRAM_SCRIPT);
    expect(`${script.origin}${script.pathname}`).toBe('https://telegram.org/js/telegram-web-app.js');
    expect(policies[0]).not.toMatch(/unsafe-eval/);
    // Telegram appears twice: its one script file and Telegram Web as the frame.
    expect(policies[0].match(/https:\/\/[^\s;]*telegram\.org[^\s;]*/g)).toEqual(['https://telegram.org/js/telegram-web-app.js', 'https://web.telegram.org']);
  });

  it('lets only Telegram Web frame the site, and sends no X-Frame-Options against it', () => {
    expect(directives(policies[0]).get('frame-ancestors')).toBe('https://web.telegram.org');
    expect(nginxConf).not.toMatch(/add_header X-Frame-Options/);
  });

  it('keeps everything else as it was', () => {
    const csp = directives(policies[0]);
    expect(csp.get('default-src')).toBe("'self'");
    expect(csp.get('connect-src')).toBe("'self' https://*.supabase.co wss://*.supabase.co");
    expect(csp.get('style-src')).toBe("'self' 'unsafe-inline'");
    expect(csp.get('base-uri')).toBe("'self'");
    expect(csp.get('form-action')).toBe("'self' https://accounts.google.com");
    expect(csp.get('worker-src')).toBe("'self' blob:");
  });
});
