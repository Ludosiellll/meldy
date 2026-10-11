/*
 * Тема до первой отрисовки. Обычный (не модульный) скрипт в <head>, отдельным файлом:
 * CSP сайта (nginx.conf, script-src 'self') запрещает встроенные скрипты.
 * Читает выбор пользователя (studyforge-theme), ничего не записывает; без выбора
 * берёт тему ОС. Ставит класс dark или light на <html> и цвет полосы браузера.
 * Дальше тему ведёт ThemeProvider с тем же ключом и теми же цветами.
 *
 * В мини-приложении Telegram (страница /tg или вкладка, которую она отметила: meldy_tg) тема — как у
 * Telegram: по цвету фона из параметров запуска (tgWebAppThemeParams после # в адресе) или из того,
 * что скрипт Telegram сохранил во вкладке. Тогда на <html> ещё и data-tg-theme: ThemeProvider держит
 * эту тему, пока скрипт Telegram не загрузится (lib/telegram/miniApp.ts, components/telegram/TelegramChrome).
 * Только если вокруг страницы настоящий клиент Telegram (его каналы, как в hasTelegramBridge): адрес с
 * параметрами Telegram, открытый в обычной вкладке браузера, тему сайта не меняет.
 */
(function () {
  function readSession(key) {
    try {
      return window.sessionStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function parseJson(text) {
    if (typeof text !== 'string' || !text) return null;
    try {
      return JSON.parse(text);
    } catch (e) {
      return null;
    }
  }

  function decodePart(text) {
    try {
      return decodeURIComponent(text.replace(/\+/g, '%20'));
    } catch (e) {
      return null;
    }
  }

  // Тёмный ли фон — та же формула, что у telegram-web-app.js: яркость HSP меньше 120.
  function isDarkColor(color) {
    if (typeof color !== 'string') return null;
    var hex = color.replace(/[\s#]/g, '');
    if (/^[0-9a-fA-F]{3}$/.test(hex)) {
      hex = hex.charAt(0) + hex.charAt(0) + hex.charAt(1) + hex.charAt(1) + hex.charAt(2) + hex.charAt(2);
    }
    if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
    var r = parseInt(hex.substr(0, 2), 16);
    var g = parseInt(hex.substr(2, 2), 16);
    var b = parseInt(hex.substr(4, 2), 16);
    return Math.sqrt(0.299 * r * r + 0.587 * g * g + 0.114 * b * b) < 120;
  }

  // tgWebAppThemeParams из адреса после #: так Telegram передаёт параметры запуска.
  function launchThemeParams() {
    var hash = String(window.location.hash || '').replace(/^#/, '');
    var query = hash.indexOf('?');
    if (query >= 0) hash = hash.substr(query + 1);
    var parts = hash.split('&');
    for (var i = 0; i < parts.length; i++) {
      var eq = parts[i].indexOf('=');
      if (eq > 0 && decodePart(parts[i].substr(0, eq)) === 'tgWebAppThemeParams') {
        return parseJson(decodePart(parts[i].substr(eq + 1)));
      }
    }
    return null;
  }

  // Клиент Telegram вокруг страницы: его каналы, которые адрес задать не может (lib/telegram/miniApp.ts).
  function telegramBridge() {
    try {
      if (window.TelegramWebviewProxy !== undefined) return true;
      var external = window.external;
      if (external && typeof external === 'object' && 'notify' in external) return true;
      return window.parent !== window;
    } catch (e) {
      return false;
    }
  }

  // null вне мини-приложения или когда цвет фона Telegram неизвестен.
  function telegramDark() {
    if (window.location.pathname !== '/tg' && readSession('meldy_tg') !== '1') return null;
    if (!telegramBridge()) return null;
    // Как в скрипте Telegram: сохранённые им параметры (с последней смены темы) важнее параметров запуска.
    var stored = parseJson(readSession('__telegram__themeParams'));
    var bg = stored && stored.bg_color;
    if (!bg) {
      var launch = launchThemeParams();
      bg = launch && launch.bg_color;
    }
    if (!bg) {
      var init = parseJson(readSession('__telegram__initParams'));
      var params = init ? parseJson(init.tgWebAppThemeParams) : null;
      bg = params && params.bg_color;
    }
    return bg ? isDarkColor(bg) : null;
  }

  try {
    var root = document.documentElement;
    var dark = null;
    try {
      dark = telegramDark();
    } catch (e) {
      dark = null;
    }

    if (dark !== null) {
      root.setAttribute('data-tg-theme', dark ? 'dark' : 'light');
    } else {
      var stored = null;
      try {
        stored = window.localStorage.getItem('studyforge-theme');
      } catch (e) {
        stored = null;
      }

      if (stored === 'dark') {
        dark = true;
      } else if (stored === 'light') {
        dark = false;
      } else {
        try {
          dark = !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
        } catch (e) {
          dark = false;
        }
      }
    }

    root.classList.remove(dark ? 'light' : 'dark');
    root.classList.add(dark ? 'dark' : 'light');

    var color = dark ? '#0b0f16' : '#f3f3f0';
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < metas.length; i++) {
      metas[i].setAttribute('content', color);
    }
  } catch (e) {
    // Без темы страница всё равно откроется: ThemeProvider применит её после загрузки.
  }
})();
