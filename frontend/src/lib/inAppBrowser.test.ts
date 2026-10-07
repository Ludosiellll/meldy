import { describe, expect, it } from 'vitest';
import { chromeIntentUrl, detectInAppBrowser, inAppName } from './inAppBrowser';

// User agents as these apps and browsers send them (2025–2026 builds).
const UA = {
  telegramAndroid:
    'Mozilla/5.0 (Linux; Android 14; SM-A546B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.100 Mobile Safari/537.36 Telegram-Android/11.2.2 (Samsung SM-A546B; Android 14; SDK 34; AVERAGE)',
  telegramIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  viberAndroid:
    'Mozilla/5.0 (Linux; Android 13; Redmi Note 12; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/128.0.6613.146 Mobile Safari/537.36 Viber/22.8.1.0',
  instagramIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 345.0.0.32.97 (iPhone14,5; iOS 17_5; ru_RU; ru; scale=3.00; 1170x2532; 631246734)',
  facebookIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/473.0.0.37.106;FBBV/619546580;FBDV/iPhone14,5;FBMD/iPhone;FBSN/iOS;FBSV/17.5;FBSS/3;FBID/phone;FBLC/ru_RU;FBOP/5]',
  facebookAndroid:
    'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/AP2A.240805.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/127.0.6533.103 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/476.0.0.49.74;]',
  androidWebView:
    'Mozilla/5.0 (Linux; Android 12; M2101K6G Build/SKQ1.210908.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.230 Mobile Safari/537.36',
  chromeAndroid:
    'Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
  samsungInternet:
    'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
  safariIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
  chromeIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.69 Mobile/15E148 Safari/604.1',
  desktopChrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  macSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15',
};

describe('built-in browsers', () => {
  it.each([
    ['Telegram on Android', UA.telegramAndroid, 'telegram', 'android'],
    ['Telegram on iPhone (a web view without Safari)', UA.telegramIos, 'webview', 'ios'],
    ['Viber', UA.viberAndroid, 'viber', 'android'],
    ['Instagram', UA.instagramIos, 'instagram', 'ios'],
    ['Facebook on iPhone', UA.facebookIos, 'facebook', 'ios'],
    ['Facebook on Android', UA.facebookAndroid, 'facebook', 'android'],
    ['a plain Android web view', UA.androidWebView, 'webview', 'android'],
  ])('tells %s', (_name, ua, app, os) => {
    expect(detectInAppBrowser(ua)).toEqual({ app, os });
  });

  it.each([
    ['Chrome on Android', UA.chromeAndroid, 'android'],
    ['Samsung Internet', UA.samsungInternet, 'android'],
    ['Safari on iPhone', UA.safariIos, 'ios'],
    ['Chrome on iPhone', UA.chromeIos, 'ios'],
    ['Chrome on a computer', UA.desktopChrome, 'other'],
    ['Safari on a Mac', UA.macSafari, 'other'],
  ])('lets %s be', (_name, ua, os) => {
    expect(detectInAppBrowser(ua)).toEqual({ app: null, os });
  });

  it('is calm without a user agent', () => {
    expect(detectInAppBrowser('')).toEqual({ app: null, os: 'other' });
    expect(detectInAppBrowser(undefined)).toEqual({ app: null, os: 'other' });
  });

  it('names the apps for the sentence and leaves an unnamed web view unnamed', () => {
    expect(inAppName('telegram')).toBe('Telegram');
    expect(inAppName('viber')).toBe('Viber');
    expect(inAppName('webview')).toBeNull();
    expect(inAppName(null)).toBeNull();
  });

  it('opens the same https address in Chrome on Android, with the page itself as the fallback', () => {
    expect(chromeIntentUrl('https://ludosiel-studyforge.hf.space/join/abcd2fghjkmn')).toBe(
      'intent://ludosiel-studyforge.hf.space/join/abcd2fghjkmn#Intent;scheme=https;package=com.android.chrome;' +
        'S.browser_fallback_url=https%3A%2F%2Fludosiel-studyforge.hf.space%2Fjoin%2Fabcd2fghjkmn;end',
    );
    expect(chromeIntentUrl('http://localhost:5173/join/x')).toMatch(/^intent:\/\/localhost:5173\/join\/x#Intent;scheme=http;/);
    expect(chromeIntentUrl('ftp://files.example/x')).toBeNull();
    expect(chromeIntentUrl('not a url')).toBeNull();
  });
});
