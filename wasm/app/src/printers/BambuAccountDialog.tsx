import { useEffect, useRef, useState } from 'react';
import { Dialog } from '../components/Dialog';
import { useTranslation } from '../i18n';
import { signInBambu, signOutBambu, useBambuAccount, watchBambuAccount } from './bambuAccount';

export function BambuAccountDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { account, status } = useBambuAccount();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const submitting = useRef(false);
  useEffect(() => () => { if (submitting.current) signOutBambu(); }, []);
  return <Dialog onClose={onClose} aria-label={t('Bambu Cloud account')}><div className="modal-content ds-dialog">
    <h3>{t('Bambu Cloud account')}</h3>
    <p>{t('Sign in to download MakerWorld models. No printer required.')}</p>
    <p role="status">{t(message || status)}</p>
    {account ? <button className="ds-btn" onClick={signOutBambu}>{t('Sign out')}</button> :
      <form onSubmit={async event => {
        event.preventDefault(); submitting.current = true; setBusy(true); setMessage('');
        try { await signInBambu(email, code ? { code } : { password }); }
        catch { setMessage('Sign-in failed. Check credentials or enter the email verification code.'); }
        finally { submitting.current = false; setPassword(''); setCode(''); setBusy(false); }
      }} style={{ display: 'grid', gap: 12 }}>
        <label>{t('Email')}<input type="email" required autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} /></label>
        <label>{t('Password')}<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /></label>
        <label>{t('Verification code')}<input autoComplete="one-time-code" inputMode="numeric" value={code} onChange={e => setCode(e.target.value)} /></label>
        <button className="ds-btn ds-btn--primary" disabled={busy || !email || (!password && !code)}>{t('Sign in')}</button>
      </form>}
    <button className="ds-btn" onClick={() => { if (busy) signOutBambu(); onClose(); }}>{t('Close')}</button>
  </div></Dialog>;
}
export function BambuAccountLifecycle() { useEffect(watchBambuAccount, []); return null; }
