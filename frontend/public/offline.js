/*
 * Страница «Нет подключения» (offline.html). Отдельным файлом: CSP сайта
 * (nginx.conf, script-src 'self') запрещает встроенные скрипты и onclick.
 */
// Self-healing function to recover from Service Worker routing deadlocks when online
async function handleReload() {
  if (navigator.onLine) {
    try {
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const registration of registrations) {
          await registration.unregister();
        }
        console.log('Service workers unregistered successfully to resolve deadlock.');
      }
    } catch (e) {
      console.error('Failed to unregister service worker:', e);
    }
  }
  window.location.reload();
}

document.getElementById('reload')?.addEventListener('click', handleReload);

// Auto-heal on page load if the user is actually online
window.addEventListener('load', () => {
  if (navigator.onLine) {
    // To avoid infinite redirect loops in edge cases, check if we reloaded recently
    let lastAutoReload = null;
    try {
      lastAutoReload = sessionStorage.getItem('last_auto_reload');
    } catch (e) {
      lastAutoReload = null;
    }
    const now = Date.now();
    if (!lastAutoReload || now - parseInt(lastAutoReload, 10) > 10000) {
      try {
        sessionStorage.setItem('last_auto_reload', now.toString());
      } catch (e) {
        return; // без памяти о прошлой перезагрузке не рискуем зациклиться
      }
      handleReload();
    }
  }
});
