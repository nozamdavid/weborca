import { useEffect, useRef, useState } from 'react';
import { confirmDialog } from '../components/ModalBackdrop';
import { Dialog } from "../components/Dialog";
import { useTranslation } from '../i18n';
import { useAppStore } from '../store/appStore';
import { loadUserPresets } from '../presets/presetStorage';
import { useWizardStore } from '../wizard/wizardStore';
import { type CloudAccount, type OAuthProvider } from './index';
import { checkCloudSession, cloudClient, cloudSync, setAutomaticSync, signOutCloud, useCloudAccount } from './account';
import { SavedPrinterSelector } from '../printers/SavedPrinterSelector';
import './cloud.css';

export function CloudDialog() {
  const open = useCloudAccount(s => s.open);
  return open ? <AccountDialog /> : null;
}
function AccountDialog() {
  const { t } = useTranslation();
  const status = useCloudAccount(s => s.status);
  const connectionError = useCloudAccount(s => s.error);
  const automatic = useCloudAccount(s => s.automatic);
  const autoMessage = useCloudAccount(s => s.autoMessage);
  const userPresets = useAppStore(s => s.userPresets);
  const [manual, setManual] = useState('');
  const [account, setAccount] = useState<CloudAccount>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [consent, setConsent] = useState(false);
  const [copyNames, setCopyNames] = useState<Record<string, string>>({});
  const abort = useRef(new AbortController());
  const mounted = useRef(true);
  const expires = useRef(Date.now() + 300000);
  const accountId = status?.accountId;
  const refreshChoices = async () => {
    const userPresets = await loadUserPresets();
    // Stored choices only: applying a preset would overwrite the open project.
    useAppStore.setState({ userPresets });
  };
  const refreshJournal = async () => {
    if (useCloudAccount.getState().status?.accountId) {
      const next = await cloudSync().snapshot();
      if (mounted.current) setAccount(next);
    }
  };
  useEffect(() => {
    mounted.current = true;
    abort.current = new AbortController();
    void checkCloudSession().catch(() => {});
    return () => { mounted.current = false; abort.current.abort(); };
  }, []);
  useEffect(() => {
    abort.current.abort(); abort.current = new AbortController();
    setAccount(undefined); setConsent(false); setManual(''); setCopyNames({});
    if (accountId) void refreshJournal().catch(() => { if (mounted.current) setMessage('Cloud operation failed'); });
  }, [accountId]);
  useEffect(() => {
    if (accountId) void refreshJournal().catch(() => {});
  }, [userPresets]);
  useEffect(() => {
    if (!status?.pending) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (stopped || Date.now() >= expires.current) {
        if (!stopped) setMessage('Cloud sign-in expired');
        return;
      }
      try {
        const next = await checkCloudSession();
        if (!stopped && next?.pending) timer = setTimeout(poll, 1500);
      } catch { if (!stopped) setMessage('Cloud connection failed'); }
    };
    timer = setTimeout(poll, 1500);
    return () => { stopped = true; clearTimeout(timer); };
  }, [status?.pending, accountId]);
  const close = () => { setManual(''); abort.current.abort(); useCloudAccount.setState({ open: false }); };
  const run = async (work: () => Promise<void | false | string>) => {
    if (busy) return;
    setBusy(true); setMessage(''); useCloudAccount.setState({ working: true });
    try { const result = await work(); if (mounted.current) { await refreshJournal(); setMessage(typeof result === 'string' ? result : result === false ? 'Cloud operation canceled' : 'Cloud operation complete'); } }
    catch { if (mounted.current) setMessage('Cloud operation failed'); }
    finally { useCloudAccount.setState({ working: false }); if (mounted.current) setBusy(false); }
  };
  const authenticated = async (work: () => Promise<void>) => {
    const before = accountId;
    const next = await checkCloudSession();
    if (!before || next?.accountId !== before) throw new Error('Account changed');
    await work();
    await refreshChoices();
  };
  const begin = (provider: OAuthProvider) => {
    // Open synchronously so browser popup policy does not block provider navigation.
    const tab = window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
    void run(async () => {
      try {
        const flow = await cloudClient().begin(provider);
        const url = new URL(flow.url);
        if (url.origin !== 'https://auth.orcaslicer.com' || url.pathname !== '/auth/v1/authorize') throw new Error('Invalid provider URL');
        expires.current = flow.expiresAt;
        if (tab) tab.location.replace(url.href);
        else return 'Cloud popup blocked';
        await checkCloudSession();
      } catch (error) { tab?.close(); throw error; }
    });
  };
  const resolve = (id: string, choice: 'use-cloud' | 'use-local' | 'copy') => void run(async () => {
    if (!await confirmDialog({ title: t('Cloud resolve conflict'), message: t(choice === 'use-local' ? 'Cloud override consent' : 'Cloud replace consent'), confirmLabel: t('Confirm'), cancelLabel: t('Cancel') })) return false;
    await authenticated(async () => { await cloudSync().resolve(id, choice, copyNames[id]); });
  });
  return <Dialog id="orca-cloud-dialog" className="modal-backdrop cloud-backdrop" role="dialog" aria-modal="true" aria-labelledby="cloud-title" onClose={close}>
    <section className="cloud-dialog ds-dialog ds-dialog--lg">
      <header className="ds-dialog__head"><h2 id="cloud-title">Orca Cloud</h2><button onClick={close} aria-label={t('Close')}>×</button></header>
      <div className="ds-dialog__body cloud-body">
        <p>{t('Cloud intro')}</p>
        {connectionError && <p role="alert">{t('Cloud connection failed')}</p>}
        {status && <>
          <p id="cloud-account-status" role="status">{t(accountId ? 'Cloud signed in' : 'Cloud signed out')}</p>
          {status.setup === 'callback-required' && <p role="alert">{t('Cloud callback required')}</p>}
          <p id="cloud-write-policy">{t(status.presetWrites ? 'Cloud writes enabled' : 'Cloud pull only')}</p>
          {status.pending && <p role="status">{t('Cloud sign-in pending')}</p>}
          {status.outcome === 'expired' && <p role="alert">{t('Cloud sign-in expired')}</p>}
          {status.outcome === 'failed' && <p role="alert">{t('Cloud sign-in incomplete')}</p>}
          {!accountId && <>
            <div className="cloud-actions">{(['google', 'apple', 'github'] as const).map(provider => <button key={provider} id={`cloud-login-${provider}`} disabled={busy || status.pending || status.setup === 'callback-required'} onClick={() => begin(provider)}>{t(`Cloud provider ${provider}`)}</button>)}</div>
            {status.pending && <section aria-label={t('Cloud manual callback')}><h3>{t('Cloud manual callback')}</h3><p>{t('Cloud manual instructions')}</p><label>{t('Cloud callback URL')}<input id="cloud-manual-url" type="password" autoComplete="off" value={manual} onChange={e => setManual(e.target.value)} /></label><div className="cloud-actions"><button id="cloud-complete" disabled={busy || !manual || !status.pending} onClick={() => {
              const callbackUrl = manual; setManual('');
              void run(async () => { await cloudClient().complete(callbackUrl); const next = await checkCloudSession(); if (!next?.accountId) throw new Error('Incomplete login'); });
            }}>{t('Cloud complete sign-in')}</button></div></section>}
          </>}
          {accountId && <>
            <div className="cloud-actions"><button id="cloud-pull" disabled={busy} onClick={() => void run(() => authenticated(async () => { await cloudSync().pull(abort.current.signal); }))}>{t('Cloud sync pull')}</button><button id="cloud-logout" disabled={busy} onClick={() => void run(async () => { abort.current.abort(); await signOutCloud(); })}>{t('Cloud sign out')}</button></div>
            <p>{t('Cloud backup consent help')}</p>
            <label className="cloud-consent"><input id="cloud-backup-consent" type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />{t('Cloud backup consent')}</label>
            <div className="cloud-actions"><button id="cloud-backup" disabled={busy || !consent || !status.presetWrites} onClick={() => void run(() => authenticated(async () => { await cloudSync().backupLocal(); setConsent(false); }))}>{t('Cloud backup local')}</button><button id="cloud-push" disabled={busy || !status.presetWrites} onClick={() => void run(async () => {
              if (!await confirmDialog({ title: t('Cloud push title'), message: t('Cloud push consent'), confirmLabel: t('Cloud push'), cancelLabel: t('Cancel') })) return false;
              await authenticated(() => cloudSync().push(abort.current.signal));
            })}>{t('Cloud push')}</button></div>
            <p>{t('Cloud journal help')}</p>
            <label className="cloud-consent"><input id="cloud-auto-sync" type="checkbox" checked={automatic} disabled={busy} onChange={e => {
              const enable = e.target.checked;
              if (!enable) { setAutomaticSync(false); return; }
              void run(async () => {
                if (await confirmDialog({ title: t('Cloud automatic sync'), message: t('Cloud auto consent'), confirmLabel: t('Confirm'), cancelLabel: t('Cancel') })) {
                  await authenticated(async () => { if (status.presetWrites) await cloudSync().backupLocal(); setAutomaticSync(true); });
                } else return false;
              });
            }} />{t('Cloud automatic sync')}</label>
            <p>{t('Cloud auto interval')} {autoMessage && t(autoMessage)}</p>
            <ul id="cloud-records">{Object.values(account?.records ?? {}).map(record => <li key={record.id}>
              <strong>{record.preset.name}</strong> <span>{t(record.preset.kind === 'printer' ? 'Printer' : record.preset.kind === 'filament' ? 'Filament' : 'Process')}</span>
              <p>{t(record.conflict ? 'Cloud conflict' : record.deleted ? 'Cloud pending deletion' : record.dirty ? 'Cloud pending upload' : 'Cloud saved')}</p>
              {record.conflict && <p>{t(record.conflict.server === null ? 'Cloud server deleted' : record.conflict.server.content ? 'Cloud server changed' : 'Cloud full pull needed')}</p>}
              {record.deleted && record.conflict && <p>{t('Cloud pending deletion')}</p>}
              {record.conflict && <><div className="cloud-actions"><button disabled={busy} onClick={() => resolve(record.id, 'use-cloud')}>{t('Cloud use cloud')}</button><button disabled={busy || !status.presetWrites} onClick={() => resolve(record.id, 'use-local')}>{t('Cloud use local')}</button></div><label>{t('Cloud copy name')}<input value={copyNames[record.id] ?? ''} onChange={e => setCopyNames({ ...copyNames, [record.id]: e.target.value })} /></label><div className="cloud-actions"><button disabled={busy || !copyNames[record.id]?.trim()} onClick={() => resolve(record.id, 'copy')}>{t('Cloud keep copy')}</button></div></>}
            </li>)}</ul>
            <details><summary>{t('Cloud offline profiles')}</summary><div className="cloud-actions"><button disabled={busy} onClick={() => void run(async () => {
              const profiles = await cloudSync().exportProfiles();
              const url = URL.createObjectURL(new Blob([JSON.stringify(profiles, null, 2)], { type: 'application/json' }));
              const a = document.createElement('a'); a.href = url; a.download = 'orca-cloud-presets.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
            })}>{t('Cloud export')}</button></div><label>{t('Cloud import')}<input id="cloud-import" type="file" accept="application/json,.json" disabled={busy} onChange={e => {
              const file = e.target.files?.[0]; e.target.value = '';
              if (file) void run(() => authenticated(async () => { await cloudSync().importProfiles(JSON.parse(await file.text())); }));
            }} /></label></details>
          </>}
        </>}
        <p role="status" id="cloud-message">{busy ? t('Cloud working') : message ? t(message) : ''}</p>
        {userPresets.some(p => p.kind === 'printer') && <label>{t('Cloud choose saved printer')}<SavedPrinterSelector id="cloud-printer-select" disabled={busy} onSelected={() => {
          if (!localStorage.getItem('orca.wizard')) localStorage.setItem('orca.wizard', JSON.stringify({ printers: [], filaments: [], completedAt: new Date().toISOString() }));
          useWizardStore.getState().setOpen(false); close();
        }} /></label>}
      </div>
      <footer className="ds-dialog__foot cloud-actions"><button id="cloud-close" onClick={close}>{t('Cloud return to printers')}</button></footer>
    </section>
  </Dialog>;
}
