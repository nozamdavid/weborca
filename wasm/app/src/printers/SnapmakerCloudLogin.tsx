import React, { useEffect, useRef, useState } from 'react';
import { MobileInput } from '../mobile/MobileInput';
import { MobileSelect } from '../mobile/MobileSelect';
import { useTranslation } from '../i18n';
import type { PhysicalPrinter } from './types';
import { loginSnapmaker, readSnapmakerSession, sendSnapmakerCode, type SnapmakerDevice, type SnapmakerSession } from './snapmakerCloud';
import './SnapmakerCloudLogin.css';

interface Props {
  target: PhysicalPrinter;
  initialSession?: SnapmakerSession;
  selectedDeviceId?: string;
  onCredentials: (source: PhysicalPrinter) => void;
  onValidatedDevices: (devices: SnapmakerDevice[]) => void;
  onSelectDevice: (device: SnapmakerDevice, source: PhysicalPrinter) => void;
}
export function SnapmakerCloudLogin({ target, initialSession, selectedDeviceId, onCredentials, onValidatedDevices, onSelectDevice }: Props) {
  const { t } = useTranslation();
  const [email, setEmail] = useState(target.cloud_account ?? '');
  const [mode, setMode] = useState('password');
  const [secret, setSecret] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [session, setSession] = useState(initialSession);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState('');
  const credentials = useRef<PhysicalPrinter | undefined>(initialSession ? target : undefined);
  const active = useRef<AbortController>();
  useEffect(() => () => active.current?.abort(), []);
  const run = async (action: 'login' | 'code' | 'retry') => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setBusy(true); setFailed(false); setNotice('');
    try {
      if (action === 'code') {
        await sendSnapmakerCode(target, email.trim(), controller.signal);
        controller.signal.throwIfAborted();
        setNotice('Email code requested. Check your inbox.');
      } else {
        const source = action === 'retry' && credentials.current ? credentials.current :
          await loginSnapmaker(target, email.trim(), mode === 'password' ? { password: secret } : { code: secret }, controller.signal);
        controller.signal.throwIfAborted();
        credentials.current = source;
        setSecret('');
        onCredentials(source);
        const validated = await readSnapmakerSession(source, controller.signal, tokens => {
          const rotated = { ...source, printhost_apikey: tokens.access_token, cloud_refresh_token: tokens.refresh_token };
          credentials.current = rotated;
          onCredentials(rotated);
        });
        controller.signal.throwIfAborted();
        credentials.current = validated.credentials;
        setSession(validated.data);
        onCredentials(validated.credentials);
        onValidatedDevices(validated.data.devices);
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      if ((error as { status?: number })?.status === 401) {
        credentials.current = undefined;
        setSession(undefined);
        onCredentials({ ...target, printhost_apikey: undefined, cloud_refresh_token: undefined });
      }
      setFailed(true);
      setNotice('Could not complete Snapmaker Cloud request. Retry or check your account details.');
    } finally {
      if (active.current === controller && !controller.signal.aborted) setBusy(false);
    }
  };
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  return <section className="snapmaker-cloud-login" aria-label={t('Snapmaker Cloud')} aria-busy={busy}>
    <p className="snapmaker-note">{t('Experimental Snapmaker Cloud. Account and deployment acceptance are unverified. International accounts only.')}</p>
    <p className="snapmaker-note">{t('Lists printers already bound in the official app. Connect for reported print status and temperatures. Upload, controls and material slots are unavailable.')}</p>
    {session ? <div className="printer-provider-fields">
      <label className="wm-field snapmaker-field"><span className="wm-field-label">{t('Device')}</span>
        <MobileSelect id="sc-device" className="ds-input" value={selectedDeviceId ?? ''} onValueChange={id => {
          const device = session.devices.find(d => d.deviceId === id);
          if (device && credentials.current) onSelectDevice(device, credentials.current);
        }}>
          <option value="" disabled>{t('(Select device)')}</option>
          {session.devices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.name} ({d.deviceId})</option>)}
        </MobileSelect>
      </label>
      {session.devices.length === 0 && <p className="snapmaker-note">{t('No bound printers found. Bind a printer in the official Snapmaker app, then retry.')}</p>}
      <button className="ds-btn" type="button" disabled={busy} onClick={() => void run('retry')}>{t('Retry')}</button>
    </div> : <form className="printer-provider-fields" onSubmit={e => { e.preventDefault(); if (!busy && agreed && validEmail && secret) void run('login'); }}>
      <label className="wm-field snapmaker-field"><span className="wm-field-label">{t('Account (Email)')}</span>
        <MobileInput id="sc-email" className="ds-input" type="email" autoComplete="username" value={email} disabled={busy} onChange={e => { setEmail(e.target.value); credentials.current = undefined; }} required />
      </label>
      <label className="wm-field snapmaker-field"><span className="wm-field-label">{t('Sign-in method')}</span>
        <MobileSelect id="sc-mode" className="ds-input" value={mode} disabled={busy} onValueChange={value => { setMode(value); setSecret(''); }}>
          <option value="password">{t('Password')}</option><option value="code">{t('Email code')}</option>
        </MobileSelect>
      </label>
      <label className="wm-field snapmaker-field"><span className="wm-field-label">{t(mode === 'password' ? 'Password' : 'Email code')}</span>
        <MobileInput id="sc-secret" className="ds-input" type={mode === 'password' ? 'password' : 'text'} autoComplete={mode === 'password' ? 'current-password' : 'one-time-code'} value={secret} disabled={busy} onChange={e => setSecret(e.target.value)} required />
      </label>
      <div className="snapmaker-consent">
        <label><MobileInput id="sc-consent" type="checkbox" checked={agreed} disabled={busy} onChange={e => setAgreed(e.target.checked)} />{t('I agree to Snapmaker terms and privacy policy.')}</label>
        <div className="snapmaker-links">
          {/* URLs from the official identity Policy component, BU-a3sss.js. */}
          <a href="https://www.snapmaker.com/terms-of-use" target="_blank" rel="noopener noreferrer">{t('Terms of use')}</a>
          <a href="https://www.snapmaker.com/privacy-policy" target="_blank" rel="noopener noreferrer">{t('Privacy policy')}</a>
        </div>
      </div>
      {mode === 'code' && <button className="ds-btn" id="sc-send-code" type="button" disabled={busy || !agreed || !validEmail} onClick={() => void run('code')}>{t('Request email code')}</button>}
      <button className="ds-btn" id="sc-login" type="submit" disabled={busy || !agreed || !validEmail || !secret}>{t(busy ? 'Checking Snapmaker Cloud...' : 'Log in / Get devices')}</button>
    </form>}
    {notice && <p className="snapmaker-note" role={failed ? 'alert' : 'status'}>{t(notice)}</p>}
    {failed && credentials.current && <button className="ds-btn" type="button" disabled={busy} onClick={() => void run('retry')}>{t('Retry')}</button>}
  </section>;
}
