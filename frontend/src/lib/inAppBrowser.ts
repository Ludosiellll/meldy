/**
 * Built-in browsers of messengers and social apps (2026-10-07, «группа по ссылке»): a group link is
 * opened from the group's chat, and inside Telegram, Viber, Instagram or Facebook Google refuses to sign in
 * (403 disallowed_useragent) and the microphone is often missing. Told by the user agent: the app's own
 * mark, else a plain Android WebView («; wv)») or an iOS WebKit view without Safari's mark.
 */

export type InAppApp = 'telegram' | 'viber' | 'instagram' | 'facebook' | 'webview';
export type DeviceOs = 'android' | 'ios' | 'other';

export interface InAppBrowser {
  /** null — a real browser (Chrome, Safari, Firefox …). */
  app: InAppApp | null;
  os: DeviceOs;
}

const IOS_BROWSERS = /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|YaBrowser|DuckDuckGo|GSA\//i;

export function detectInAppBrowser(userAgent: string | null | undefined): InAppBrowser {
  const ua = typeof userAgent === 'string' ? userAgent : '';
  const os: DeviceOs = /Android/i.test(ua) ? 'android' : /iPhone|iPad|iPod/i.test(ua) ? 'ios' : 'other';
  let app: InAppApp | null = null;
  if (/Telegram/i.test(ua)) app = 'telegram';
  else if (/Viber/i.test(ua)) app = 'viber';
  else if (/Instagram/i.test(ua)) app = 'instagram';
  else if (/FBAN|FBAV|FB_IAB|FBIOS|FB4A|FBMD|FBSV/i.test(ua)) app = 'facebook';
  else if (os === 'android' && /;\s*wv\)/i.test(ua)) app = 'webview';
  else if (os === 'ios' && /AppleWebKit/i.test(ua) && !/Safari\//i.test(ua) && !IOS_BROWSERS.test(ua)) app = 'webview';
  return { app, os };
}

/** The app's name for the sentence «во встроенном браузере …», or null for an unnamed web view. */
export function inAppName(app: InAppApp | null): string | null {
  switch (app) {
    case 'telegram':
      return 'Telegram';
    case 'viber':
      return 'Viber';
    case 'instagram':
      return 'Instagram';
    case 'facebook':
      return 'Facebook';
    default:
      return null;
  }
}

/**
 * Android: the same address opened in Chrome (the site is https; http only on a developer's machine). Without
 * Chrome, Android goes to the fallback address (the page itself), so the link never leads nowhere.
 */
export function chromeIntentUrl(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const scheme = url.protocol.slice(0, -1);
  const fallback = `${url.origin}${url.pathname}${url.search}`;
  return `intent://${url.host}${url.pathname}${url.search}#Intent;scheme=${scheme};package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(fallback)};end`;
}
