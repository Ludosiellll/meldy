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

export async function subscribeUserToPush(userId: string) {
  if (!('serviceWorker' in navigator)) {
    throw new Error('Service Worker is not supported by browser.');
  }
  if (!('PushManager' in window)) {
    throw new Error('Push notifications are not supported by browser.');
  }

  const registration = await navigator.serviceWorker.ready;
  const publicVapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  if (!publicVapidKey) {
    throw new Error('VAPID public key not found in env.');
  }

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicVapidKey)
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
