function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * The key the server signs pushes with (backend/push_router.py GET /api/push/key). The only source: a key built into
 * the page could outlive a rotation on the server, and a subscription made with it would never get a push.
 * The messages end «Ошибка настройки уведомлений: …» in «Профиль».
 */
async function serverVapidKey(): Promise<string> {
  let body: { public_key?: unknown; configured?: unknown } | null = null;
  try {
    const response = await fetch('/api/push/key');
    if (response.ok) body = await response.json();
  } catch {
    body = null;
  }
  if (!body) throw new Error('не удалось узнать ключ уведомлений, попробуйте позже');
  if (body.configured !== true || typeof body.public_key !== 'string' || !body.public_key) {
    throw new Error('уведомления на сервере пока не настроены');
  }
  return body.public_key;
}

function sameKey(current: ArrayBuffer | null, wanted: Uint8Array): boolean {
  if (!current) return false;
  const bytes = new Uint8Array(current);
  return bytes.length === wanted.length && bytes.every((value, index) => value === wanted[index]);
}

export async function subscribeUserToPush(userId: string) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('этот браузер не поддерживает уведомления');
  }

  const applicationServerKey = urlBase64ToUint8Array(await serverVapidKey());
  const registration = await navigator.serviceWorker.ready;

  // A subscription made with an older key (the keys were rotated on the server) cannot be reused.
  const existing = await registration.pushManager.getSubscription();
  if (existing && !sameKey(existing.options?.applicationServerKey ?? null, applicationServerKey)) {
    await existing.unsubscribe();
  }

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey
  });

  // Send subscription to backend
  const response = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: userId,
      subscription: subscription
    })
  });

  if (!response.ok) {
    throw new Error('не удалось сохранить подписку на сервере');
  }

  return true;
}

export async function checkPushSubscription() {
  if (!('serviceWorker' in navigator)) return false;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  return !!subscription;
}

export async function requestNotificationPermission() {
  const permission = await Notification.requestPermission();
  return permission === 'granted';
}
