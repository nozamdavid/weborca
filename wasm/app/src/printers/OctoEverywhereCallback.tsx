import { useEffect, useRef, useState } from 'react';
import { completePortalCallback } from './octoEverywherePortal';

type CallbackStatus = 'pending' | 'complete' | 'failed' | 'ignored';

export function OctoEverywhereCallback({ callbackUrl }: { callbackUrl: string }) {
  const [status, setStatus] = useState<CallbackStatus>('pending');
  const handled = useRef<{ url: string; status: CallbackStatus } | null>(null);

  useEffect(() => {
    if (handled.current?.url === callbackUrl) {
      setStatus(handled.current.status);
      return;
    }
    const result = completePortalCallback(callbackUrl);
    handled.current = { url: callbackUrl, status: result.status };
    setStatus(result.status);
  }, [callbackUrl]);

  const message = status === 'ignored'
    ? 'This authorization link has expired or was already used. Return to WebOrca to start a new connection.'
    : status === 'failed'
      ? 'OctoEverywhere authorization did not complete. Return to WebOrca and try connecting again.'
      : status === 'pending'
        ? 'Completing OctoEverywhere authorization…'
        : 'Return to WebOrca to finish connecting. You can close this tab.';

  return (
    <main style={{ maxWidth: 480, margin: '15vh auto', padding: 24, textAlign: 'center', fontFamily: 'var(--font-sans, sans-serif)' }}>
      <h1>OctoEverywhere</h1>
      <p role="status">{message}</p>
    </main>
  );
}
