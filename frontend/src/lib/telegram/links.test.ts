import { afterEach, describe, expect, it, vi } from 'vitest';
import { BOT_USERNAME, DEFAULT_ZONE, botName, browserZone, chatUrl, knownZone, linkPayload, linkQr, linkUrl, onComputer, zoneWords } from './links';
import { encodeQr } from './qr';

const HEX = '0123456789abcdef0123456789abcdef';

const UA = {
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  linux: 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36',
  androidTablet: 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36',
  telegram: 'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36 Telegram-Android/11.2.3',
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the bot’s link (spec decision 9)', () => {
  it('opens @Meldyteach_bot with «L» and the 32 hex digits of the code', () => {
    expect(linkUrl(`L${HEX}`)).toBe(`https://t.me/Meldyteach_bot?start=L${HEX}`);
    // The digits alone get their «L»; their case is kept, the code is the server's.
    expect(linkUrl(HEX.toUpperCase())).toBe(`https://t.me/Meldyteach_bot?start=L${HEX.toUpperCase()}`);
    expect(linkPayload(` L${HEX} `)).toBe(`L${HEX}`);
  });

  it('builds no link from something that is not a code', () => {
    for (const code of ['', 'L', `L${HEX.slice(1)}`, `L${HEX}0`, `G${HEX}`, `L${HEX.slice(0, 31)}g`, `L${HEX.slice(0, 16)} ${HEX.slice(16)}`, null, undefined, 42, {}]) {
      expect(linkUrl(code)).toBeNull();
    }
  });

  it('fits the 64 characters Telegram allows in «start»', () => {
    const url = linkUrl(`L${HEX}`)!;
    const payload = new URL(url).searchParams.get('start')!;
    expect(payload).toHaveLength(33);
    expect(payload).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  });

  it('takes the server’s bot name only when it is a bot’s', () => {
    expect(botName('Meldyteach_bot')).toBe('Meldyteach_bot');
    expect(botName('@MeldyStagingBot')).toBe('MeldyStagingBot');
    expect(linkUrl(`L${HEX}`, 'MeldyStagingBot')).toBe(`https://t.me/MeldyStagingBot?start=L${HEX}`);
    for (const name of [null, undefined, '', 'abot', 'meldy', 'evil.example/bot', 'Meldy bot', '1Meldybot', `${'a'.repeat(30)}bot`]) {
      expect(botName(name)).toBe(BOT_USERNAME);
    }
  });

  it('opens the chat without a code', () => {
    expect(chatUrl()).toBe('https://t.me/Meldyteach_bot');
  });
});

describe('the browser’s zone (spec decision 32)', () => {
  const zone = (name: unknown) =>
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({ timeZone: name } as Intl.ResolvedDateTimeFormatOptions);

  it('is the zone Intl names', () => {
    zone('Europe/Minsk');
    expect(browserZone()).toBe('Europe/Minsk');
    zone('Asia/Vladivostok');
    expect(browserZone()).toBe('Asia/Vladivostok');
    zone('UTC');
    expect(browserZone()).toBe('UTC');
  });

  it('falls back to Europe/Minsk when the browser names none or an unknown one', () => {
    for (const name of [undefined, '', 'Etc/Unknown', 'Mars/Olympus_Mons', 'Europe/Minsk; drop', 42]) {
      zone(name);
      expect(browserZone()).toBe(DEFAULT_ZONE);
    }
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(() => {
      throw new Error('no zones');
    });
    expect(browserZone()).toBe(DEFAULT_ZONE);
  });

  it('knows a zone by its IANA name only', () => {
    expect(knownZone('Europe/Kyiv')).toBe(true);
    expect(knownZone('America/Argentina/Buenos_Aires')).toBe(true);
    expect(knownZone('Europe/Atlantis')).toBe(false);
    expect(knownZone(null)).toBe(false);
  });

  it('names frequent zones by their city, the rest by the IANA name', () => {
    expect(zoneWords('Europe/Minsk')).toBe('по Минску');
    expect(zoneWords('Europe/Moscow')).toBe('по Москве');
    expect(zoneWords('Asia/Vladivostok')).toBe('по Владивостоку');
    expect(zoneWords('Asia/Almaty')).toBe('по Asia/Almaty');
  });
});

describe('a computer shows the QR code', () => {
  it('is a computer for Windows, macOS and Linux browsers', () => {
    expect(onComputer(UA.windows, 0)).toBe(true);
    expect(onComputer(UA.mac, 0)).toBe(true);
    expect(onComputer(UA.linux, 0)).toBe(true);
  });

  it('is not one for phones, tablets and an iPad that calls itself a Mac', () => {
    expect(onComputer(UA.iphone, 5)).toBe(false);
    expect(onComputer(UA.android, 5)).toBe(false);
    expect(onComputer(UA.androidTablet, 10)).toBe(false);
    expect(onComputer(UA.telegram, 5)).toBe(false);
    expect(onComputer(UA.mac, 5)).toBe(false);
    expect(onComputer('Mozilla/5.0 (Mobile; rv:48.0) Gecko/48.0 Firefox/48.0 KAIOS/2.5', 0)).toBe(false);
  });

  it('draws the link’s QR code in a box of 45 modules (version 5 and the quiet zone)', () => {
    const url = linkUrl(`L${HEX}`)!;
    const { d, box } = linkQr(url);
    expect(box).toBe(45);
    expect(d.startsWith('M4 4h7v1h-7z')).toBe(true);
    expect(encodeQr(url).version).toBe(5);
  });
});
