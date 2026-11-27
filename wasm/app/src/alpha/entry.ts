import { authorizeApp } from './bootstrap';

export async function enterApp() {
  const start = () => import('../appEntry').then(({ start }) => start());
  if (/^\/slicer(?:\/(?:models|prepare|preview|device))?\/?$/.test(location.pathname)) {
    try {
      const response = await fetch('/_alpha/config', { cache: 'no-store' });
      const config = await response.json();
      if (response.ok && (config.enabled === false || config.guestSlicer === true)) {
        await start();
        return;
      }
    } catch { /* Fall back to the invitation screen when configuration is unavailable. */ }
  }
  await authorizeApp(start);
}
