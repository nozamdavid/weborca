import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Dialog } from '../components/Dialog';
import { useTranslation } from '../i18n';
import { signInBambu, signOutBambu, useBambuAccount, watchBambuAccount } from './bambuAccount';
import './BambuAccountDialog.css';

export function BambuAccountDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { account, status } = useBambuAccount();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [needsCode, setNeedsCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const submitting = useRef<AbortController>();
  useEffect(() => () => submitting.current?.abort(), []);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (account || submitting.current) return;
    const controller = new AbortController();
    submitting.current = controller;
    setBusy(true);
    setMessage('');
    try {
      const result = await signInBambu(email, needsCode ? { code } : { password }, controller.signal);
      if (!controller.signal.aborted && result === 'verification-required') setNeedsCode(true);
    } catch {
      if (!controller.signal.aborted) setMessage(needsCode
        ? 'Sign-in failed. Check the verification code and try again.'
        : 'Sign-in failed. Check your email and password and try again.');
    } finally {
      submitting.current = undefined;
      if (!controller.signal.aborted) {
        setPassword('');
        setCode('');
        setBusy(false);
      }
    }
  };
  return <Dialog onClose={onClose} aria-label={t('Bambu Cloud account')}>
    <form className="bambu-account-dialog" onSubmit={submit} aria-busy={busy}>
      <header className="ds-dialog__head"><h2>{t('Bambu Cloud account')}</h2></header>
      <div className="ds-dialog__body">
        <p>{t('Sign in with your Bambu Cloud or MakerWorld account to download 3MF files and open them directly in the slicer.')}</p>
        {account ? <p role="status">{t(message || status)}</p> : <div className="bambu-account-dialog__fields">
          <label>
            <span>{t('Email')}</span>
            <input className="ds-input" type="email" required autoComplete="username" readOnly={needsCode || busy} value={email} onChange={e => setEmail(e.target.value)} />
          </label>
          {needsCode ? <div className="bambu-account-dialog__code">
            <label>
              <span>{t('Verification code')}</span>
              <input className="ds-input" autoFocus required autoComplete="one-time-code" inputMode="numeric" readOnly={busy} value={code} onChange={e => setCode(e.target.value)} aria-describedby="bambu-account-code-help" />
            </label>
            <p id="bambu-account-code-help" className="bambu-account-dialog__hint" role="status">{t('Check your email for a verification code from Bambu Lab.')}</p>
          </div> : <label>
            <span>{t('Password')}</span>
            <input className="ds-input" type="password" required autoComplete="current-password" readOnly={busy} value={password} onChange={e => setPassword(e.target.value)} />
          </label>}
          {message && <p className="bambu-account-dialog__error" role="status">{t(message)}</p>}
        </div>}
        <p className="bambu-account-dialog__privacy">{t('WebOrca does not store your email, password, or verification code. Your access and refresh tokens are saved only in this browser.')}</p>
      </div>
      <footer className="ds-dialog__foot">
        <button type="button" className="ds-btn" onClick={onClose}>{t('Close')}</button>
        {account ? <button type="button" className="ds-btn" onClick={signOutBambu}>{t('Sign out')}</button> : <>
          {needsCode && <button type="button" className="ds-btn" disabled={busy} onClick={() => { setNeedsCode(false); setCode(''); setMessage(''); }}>{t('Back')}</button>}
          <button type="submit" className="ds-btn ds-btn--primary" disabled={busy || !email || !(needsCode ? code : password)}>{t(busy ? 'Signing in…' : needsCode ? 'Verify code' : 'Sign in')}</button>
        </>}
      </footer>
    </form>
  </Dialog>;
}
export function BambuAccountLifecycle() { useEffect(watchBambuAccount, []); return null; }
