/**
 * Embedded browsers (2026-10-07, «группа по ссылке»; corrected the same day on the owner's test). A group link is
 * opened from the group's chat. Telegram and most messengers open a link in Chrome Custom Tabs (Android) or
 * SFSafariViewController (iOS): that is Chrome or Safari itself, its user agent is theirs, and Google sign-in works
 * there. Google refuses only inside a real embedded WebView (403 disallowed_useragent): Telegram Mini Apps, the
 * browsers of Instagram and Facebook, some apps' own browsers; the microphone may be missing there too.
 *
 * So only a WebView's own mark counts, the one Google goes by: «; wv)» on Android, an iOS WebKit view without
 * Safari's «Safari/». The app's mark (Telegram, Viber …) only names the app in the note: without a WebView mark
 * the browser is a real one.
 */

export type InAppApp = 'telegram' | 'viber' | 'instagram' | 'facebook' | 'webview';
export type DeviceOs = 'android' | 'ios' | 'other';

export interface InAppBrowser {
  /** null — a real browser (Chrome, Safari, Firefox …, a Custom Tab, SFSafariViewController); else a WebView. */
  app: InAppApp | null;
  os: DeviceOs;
}

const IOS_BROWSERS = /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|YaBrowser|DuckDuckGo|GSA\//i;

/** The WebView's own mark: «; wv)» of Android System WebView, or an iOS WebKit view that is not Safari. */
function isWebView(ua: string, os: DeviceOs): boolean {
  if (os === 'android') return /;\s*wv\)/i.test(ua);
  if (os === 'ios') return /AppleWebKit/i.test(ua) && !/Safari\//i.test(ua) && !IOS_BROWSERS.test(ua);
  return false;
}

export function detectInAppBrowser(userAgent: string | null | undefined): InAppBrowser {
  const ua = typeof userAgent === 'string' ? userAgent : '';
  const os: DeviceOs = /Android/i.test(ua) ? 'android' : /iPhone|iPad|iPod/i.test(ua) ? 'ios' : 'other';
  if (!isWebView(ua, os)) return { app: null, os };
  let app: InAppApp = 'webview';
  if (/Telegram/i.test(ua)) app = 'telegram';
  else if (/Viber/i.test(ua)) app = 'viber';
  else if (/Instagram/i.test(ua)) app = 'instagram';
  else if (/FBAN|FBAV|FB_IAB|FBIOS|FB4A|FBMD|FBSV/i.test(ua)) app = 'facebook';
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
