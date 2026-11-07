import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from '../i18n';
import type {
  PrusaGatewayTarget,
  PrusaConnectPrinter,
  PrusaConnectTokens,
  PrusaConnectUser
} from './prusaConnect';
import {
  startPrusaConnectLogin,
  completePrusaConnectLogin,
  submitPrusaConnectLogin,
  cancelPrusaConnectLogin
} from './prusaConnect';
import { MobileInput } from '../mobile/MobileInput';
import { validateCloudSession, type PrusaSession } from './cloudSessionReuse';
import { usePrinterConnectionStore } from './connectionStore';

export interface PrusaConnectLoginProps {
  gatewayTarget?: PrusaGatewayTarget;
  selectedDeviceId?: string;
  initialSession?: PrusaSession;
  onSelectPrinter: (
    printer: PrusaConnectPrinter,
    tokens: PrusaConnectTokens,
    teamId: number,
    accountName: string
  ) => void;
}

export const PrusaConnectLogin: React.FC<PrusaConnectLoginProps> = ({
  gatewayTarget,
  selectedDeviceId,
  initialSession,
  onSelectPrinter
}) => {
  const { t } = useTranslation();
  const sessionAbort = useRef(new AbortController());
  useEffect(() => {
    sessionAbort.current = new AbortController();
    return () => sessionAbort.current.abort();
  }, []);
  const [step, setStep] = useState<'idle' | 'otp' | 'authorizing' | 'printers'>(initialSession ? 'printers' : 'idle');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [authUrl, setAuthUrl] = useState('');
  const [pkceState, setPkceState] = useState('');
  const [pkceVerifier, setPkceVerifier] = useState('');
  const [pastedUrl, setPastedUrl] = useState('');
  const [copyStatus, setCopyStatus] = useState('');

  const [tokens, setTokens] = useState<PrusaConnectTokens | null>(initialSession?.tokens ?? null);
  const [user, setUser] = useState<PrusaConnectUser | null>(initialSession?.user ?? null);
  const [printers, setPrinters] = useState<PrusaConnectPrinter[]>(initialSession?.printers ?? []);

  const loadPrinters = async (tokenData: PrusaConnectTokens) => {
    setPkceState('');
    setPkceVerifier('');
    setPastedUrl('');
    setAuthUrl('');
    setTokens(tokenData);
    const session = await validateCloudSession({ id: 'prusa-account-session', name: '', host_type: 'prusaconnect', use_gateway: true,
      print_host: gatewayTarget?.print_host ?? 'connect.prusa3d.com', ...gatewayTarget,
      printhost_apikey: tokenData.access_token, cloud_refresh_token: tokenData.refresh_token }, sessionAbort.current.signal);
    if (session.provider !== 'prusaconnect') return;
    const { user: userData, printers: printerList, tokens: currentTokens } = session.data;
    setTokens(currentTokens);
    setUser(userData);
    usePrinterConnectionStore.getState().savePrusaSession({ ...session.credentials, cloud_account: userData.name });
    setPrinters(printerList);
    if (!printerList.length) setError(t('No printers found in your Prusa Connect account.'));
    setStep('printers');
  };

  const handleCredentials = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    // Clear rendered secrets immediately; only the request keeps its local copy.
    const input = step === 'otp' ? { code: otp } : { email, password };
    setPassword('');
    setOtp('');
    try {
      const state = step === 'otp' ? pkceState : (await startPrusaConnectLogin(gatewayTarget)).state;
      setPkceState(state);
      const result = await submitPrusaConnectLogin(gatewayTarget, state, input);
      if ('mfaRequired' in result) setStep('otp');
      else await loadPrinters(result);
    } catch {
      setPkceState('');
      setStep('idle');
      setError(t('Prusa Account sign-in failed. Check your password or code and start again. Social login, passkeys and CAPTCHA are unsupported.'));
    } finally {
      setLoading(false);
    }
  };

  const handleStartLogin = async () => {
    setError(null);
    setLoading(true);
    setPastedUrl('');
    setCopyStatus('');
    try {
      const data = await startPrusaConnectLogin(gatewayTarget);
      setAuthUrl(data.authorizeUrl);
      setPkceState(data.state);
      setPkceVerifier(data.verifier);
      setStep('authorizing');

    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(authUrl);
      setCopyStatus(t('Sign-in link copied.'));
    } catch {
      setCopyStatus(t('Copy failed. Right-click Open Prusa Account and copy the link address.'));
    }
  };

  const handleCompleteLogin = async () => {
    if (!pastedUrl.trim()) {
      setError(t('Please paste the complete callback URL containing code and state.'));
      return;
    }
    setError(null);
    setLoading(true);

    try {
      const tokenData = await completePrusaConnectLogin(gatewayTarget, {
        pasted: pastedUrl.trim(),
        state: pkceState,
        verifier: pkceVerifier
      });
      await loadPrinters(tokenData);
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  const handlePickPrinter = (p: PrusaConnectPrinter) => {
    if (!tokens || !user) return;
    const teamId = p.team_id || user.default_team_id || 0;
    onSelectPrinter(p, tokens, teamId, user.name || user.public_name || 'Prusa User');
  };

  const handleCancel = () => {
    void cancelPrusaConnectLogin(gatewayTarget, pkceState);
    setPassword('');
    setOtp('');
    setEmail('');
    setPkceState('');
    setPkceVerifier('');
    setAuthUrl('');
    setStep('idle');
    setError(null);
    setPastedUrl('');
  };

  return (
    <div className="prusa-connect-login">
      {error && (
        <div
          id="pc-prusa-error"
          style={{
            color: 'var(--danger-fg, #e05252)',
            backgroundColor: 'var(--danger-bg, rgba(224, 82, 82, 0.1))',
            padding: '6px 10px',
            borderRadius: 4,
            fontSize: '0.75rem',
            marginBottom: 8
          }}
        >
          {error}
        </div>
      )}

      {(step === 'idle' || step === 'otp') && (
        <form className="printer-provider-fields" onSubmit={handleCredentials}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            {t('Your password and one-time code pass through this server to Prusa Account. Use your Prusa Account password; social login and passkeys are unsupported.')}
          </div>
          {step === 'idle' ? <>
            <label className="wm-field"><span className="wm-field-label">{t('Email')}</span><MobileInput id="pc-prusa-email" className="ds-input" type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} disabled={loading} /></label>
            <label className="wm-field"><span className="wm-field-label">{t('Password')}</span><MobileInput id="pc-prusa-password" className="ds-input" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} disabled={loading} /></label>
          </> : <label className="wm-field"><span className="wm-field-label">{t('One-time code')}</span><MobileInput id="pc-prusa-otp" className="ds-input" autoComplete="one-time-code" required maxLength={64} value={otp} onChange={e => setOtp(e.target.value)} disabled={loading} /></label>}
          <button
            type="submit"
            id="pc-prusa-login-start"
            className="ds-btn ds-btn--primary"
            disabled={loading}
          >
            {loading ? t('Signing in...') : t('Sign in with Prusa Account')}
          </button>
          <button type="button" className="ds-btn" onClick={handleCancel} disabled={loading}>{t('Cancel')}</button>
          {step === 'idle' && <details><summary>{t('Manual callback fallback')}</summary>
            <button type="button" className="ds-btn" onClick={handleStartLogin} disabled={loading}>{t('Copy sign-in link')}</button>
          </details>}
        </form>
      )}

      {step === 'authorizing' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: '0.75rem', lineHeight: '1.4' }}>
            <p style={{ margin: '0 0 6px 0' }}>
              <strong>1.</strong>{' '}
              {t('Open a blank tab, open DevTools Network, and enable Chrome Preserve log or Firefox Persist Logs before pasting the copied sign-in link into its address bar. Then sign in.')}
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
              <button type="button" id="pc-prusa-copy-auth" className="ds-btn" onClick={handleCopyLink}>
                {t('Copy sign-in link')}
              </button>
              <a
                id="pc-prusa-reopen-auth"
                href={authUrl}
                target="_blank"
                rel="noreferrer"
                style={{ color: 'var(--link, #4a9eff)' }}
              >
                {t('Open Prusa Account')}
              </a>
            </div>
            {copyStatus && <p role="status" style={{ margin: '0 0 6px 0' }}>{copyStatus}</p>}
            <p style={{ margin: '0 0 6px 0' }}>
              <strong>2.</strong>{' '}
              {t('Paste the complete callback URL containing code and state below. Keep this sign-in attempt open.')}
            </p>
            <details>
              <summary>{t('Code disappeared from the address bar?')}</summary>
              <p style={{ margin: '6px 0 0' }}>
                {t('In Network, show All requests and filter auth-callback. Find the document request to https://connect.prusa3d.com/login/auth-callback containing code and state. Right-click it, choose Copy → Copy URL, and paste the full URL here. If it was not recorded, cancel and start a new attempt with recording prepared.')}
              </p>
            </details>
          </div>

          <MobileInput
            id="pc-prusa-pasted-url"
            className="ds-input"
            value={pastedUrl}
            onChange={(e) => setPastedUrl(e.target.value)}
            placeholder={t('Paste the complete redirect URL')}
            disabled={loading}
          />

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              id="pc-prusa-login-complete"
              className="ds-btn ds-btn--primary"
              onClick={handleCompleteLogin}
              disabled={loading || !pastedUrl.trim()}
            >
              {loading ? t('Signing in...') : t('Complete Sign-in')}
            </button>
            <button
              type="button"
              id="pc-prusa-login-cancel"
              className="ds-btn"
              onClick={handleCancel}
              disabled={loading}
            >
              {t('Cancel')}
            </button>
          </div>
        </div>
      )}

      {step === 'printers' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            {user ? t('Signed in as {{name}}. Choose a printer to connect:', { name: user.name || user.public_name || 'User' }) : t('Choose a printer:')}
          </div>

          <div
            id="pc-prusa-printer-list"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              maxHeight: 200,
              overflowY: 'auto',
              border: '1px solid var(--border-color, #333)',
              borderRadius: 4,
              padding: 6
            }}
          >
            {printers.map((p) => {
              const isCurrent = p.uuid === selectedDeviceId;
              return (
                <div
                  key={p.uuid}
                  id={`pc-prusa-printer-${p.uuid}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '6px 8px',
                    borderRadius: 4,
                    backgroundColor: isCurrent ? 'var(--selection-bg, rgba(74, 158, 255, 0.15))' : 'transparent'
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <strong style={{ fontSize: '0.8125rem' }}>{p.name}</strong>
                    <span style={{ fontSize: '0.6875rem', color: 'var(--text-secondary)' }}>
                      {p.printer_type_name || p.printer_model || 'Prusa'} · {p.connect_state || p.printer_state || 'Ready'}
                    </span>
                  </div>
                  <button
                    type="button"
                    id={`pc-prusa-select-${p.uuid}`}
                    className={`ds-btn ${isCurrent ? 'ds-btn--primary' : ''}`}
                    onClick={() => handlePickPrinter(p)}
                  >
                    {isCurrent ? t('Selected') : t('Select')}
                  </button>
                </div>
              );
            })}
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              id="pc-prusa-switch-account"
              className="ds-btn"
              onClick={handleCancel}
            >
              {t('Sign in with a different account')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
