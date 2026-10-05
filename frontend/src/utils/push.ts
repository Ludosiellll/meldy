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

/** The key the server signs pushes with (backend/push_router.py GET /api/push/key); null if it cannot say. */
async function serverVapidKey(): Promise<string | null> {
  try {
    const response = await fetch('/api/push/key');
    if (!response.ok) return null;
    const body = await response.json();
    return typeof body?.public_key === 'string' && body.public_key ? body.public_key : null;
  } catch {
    return null;
  }
}

function sameKey(current: ArrayBuffer | null, wanted: Uint8Array): boolean {
  if (!current) return false;
  const bytes = new Uint8Array(current);
  return bytes.length === wanted.length && bytes.every((value, index) => value === wanted[index]);
}

export async function subscribeUserToPush(userId: string) {
  if (!('serviceWorker' in navigator)) {
    throw new Error('Service Worker is not supported by browser.');
  }
  if (!('PushManager' in window)) {
    throw new Error('Push notifications are not supported by browser.');
  }

  const registration = await navigator.serviceWorker.ready;
  const publicVapidKey = (await serverVapidKey()) || import.meta.env.VITE_VAPID_PUBLIC_KEY;
  if (!publicVapidKey) {
    throw new Error('VAPID public key not found in env.');
  }
  const applicationServerKey = urlBase64ToUint8Array(publicVapidKey);

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
    throw new Error('Failed to save subscription on server');
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
