/*
 * Тема до первой отрисовки. Обычный (не модульный) скрипт в <head>, отдельным файлом:
 * CSP сайта (nginx.conf, script-src 'self') запрещает встроенные скрипты.
 * Читает выбор пользователя (studyforge-theme), ничего не записывает; без выбора
 * берёт тему ОС. Ставит класс dark или light на <html> и цвет полосы браузера.
 * Дальше тему ведёт ThemeProvider с тем же ключом и теми же цветами.
 */
(function () {
  try {
    var stored = null;
    try {
      stored = window.localStorage.getItem('studyforge-theme');
    } catch (e) {
      stored = null;
    }

    var dark;
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

    var root = document.documentElement;
    root.classList.remove(dark ? 'light' : 'dark');
    root.classList.add(dark ? 'dark' : 'light');

    var color = dark ? '#1f1e1c' : '#f6f5f4';
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < metas.length; i++) {
      metas[i].setAttribute('content', color);
    }
  } catch (e) {
    // Без темы страница всё равно откроется: ThemeProvider применит её после загрузки.
  }
})();
