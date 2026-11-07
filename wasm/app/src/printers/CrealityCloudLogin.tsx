import { MobileInput } from '../mobile/MobileInput';
import { MobileSelect } from '../mobile/MobileSelect';
import { useTranslation } from '../i18n';
import React, { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import type {
  CrealityCloudAuthSession,
  CrealityCloudDevice,
  CrealityCloudQrResult,
  CrealityRegion,
  CrealityGatewayTarget
} from './crealityCloud';
import {
  fetchCrealityCloudDevices,
  isCrealityQrExpired,
  loginCrealityCloudPassword,
  pollCrealityCloudQr,
  requestCrealityCloudQr
} from './crealityCloud';

export interface CrealityCloudLoginProps {
  initialRegion?: CrealityRegion;
  initialSession?: { session: CrealityCloudAuthSession; devices: CrealityCloudDevice[] };
  onRegionChange?: (region: CrealityRegion) => void;
  gatewayTarget?: CrealityGatewayTarget;
  onSelectDevice: (device: CrealityCloudDevice, session: CrealityCloudAuthSession, region: CrealityRegion) => void;
  onCancel?: () => void;
}

export const CrealityCloudLogin: React.FC<CrealityCloudLoginProps> = ({
  initialRegion = 'global',
  initialSession,
  onRegionChange,
  gatewayTarget = {},
  onSelectDevice,
  onCancel
}) => {
  const { t } = useTranslation();
  const [region, setRegion] = useState<CrealityRegion>(initialRegion);
  const [tab, setTab] = useState<'qr' | 'password'>('qr');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Password login state
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');

  // QR login state
  const [qrResult, setQrResult] = useState<CrealityCloudQrResult | null>(null);
  const [qrExpired, setQrExpired] = useState(false);

  // Authenticated state & device selection
  const [session, setSession] = useState<CrealityCloudAuthSession | null>(initialSession?.session ?? null);
  const [devices, setDevices] = useState<CrealityCloudDevice[]>(initialSession?.devices ?? []);

  // Generation guard and active abort controller to prevent stale fetches and rescheduling
  const generationRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelPending = () => {
    generationRef.current++;
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  };

  // Teardown pending operations on unmount
  useEffect(() => {
    return () => {
      cancelPending();
    };
  }, []);

  const handleRegionChange = (newRegion: CrealityRegion) => {
    cancelPending();
    setRegion(newRegion);
    setSession(null);
    setDevices([]);
    onRegionChange?.(newRegion);
    setLoading(false);
    setError(null);
    setQrResult(null);
    setQrExpired(false);
  };

  const handleTabChange = (newTab: 'qr' | 'password') => {
    cancelPending();
    setTab(newTab);
    setLoading(false);
    setError(null);
    setQrResult(null);
    setQrExpired(false);
  };

  const handleStartQr = async () => {
    cancelPending();
    const currentGen = generationRef.current;
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    setError(null);
    setQrExpired(false);

    try {
      const res = await requestCrealityCloudQr({ ...gatewayTarget, region }, controller.signal);
      if (generationRef.current !== currentGen || controller.signal.aborted) return;

      setQrResult(res);
      setLoading(false);

      const confirmation = { userId: '' };
      const pollStep = async () => {
        if (generationRef.current !== currentGen || controller.signal.aborted) return;

        // Check expiration in epoch seconds or normalized ms
        if (res.expireTime && isCrealityQrExpired(res.expireTime)) {
          setQrExpired(true);
          return;
        }

        try {
          const auth = await pollCrealityCloudQr(res.identical, { ...gatewayTarget, region }, controller.signal, confirmation);
          if (generationRef.current !== currentGen || controller.signal.aborted) return;

          if (auth) {
            setSession(auth);
            setPassword('');
            loadDevices(auth, currentGen);
            return;
          }
        } catch (pollErr) {
          if (generationRef.current !== currentGen || controller.signal.aborted) return;
          setError(pollErr instanceof Error ? pollErr.message : String(pollErr));
          setQrResult(null);
          return;
        }

        if (generationRef.current === currentGen && !controller.signal.aborted) {
          pollTimerRef.current = setTimeout(pollStep, 2500);
        }
      };

      pollTimerRef.current = setTimeout(pollStep, 2500);
    } catch (err) {
      if (generationRef.current !== currentGen || controller.signal.aborted) return;
      setLoading(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!account.trim() || !password) return;

    cancelPending();
    const currentGen = generationRef.current;
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const auth = await loginCrealityCloudPassword(account, password, { ...gatewayTarget, region }, controller.signal);
      if (generationRef.current !== currentGen || controller.signal.aborted) return;

      setSession(auth);
      setPassword('');
      await loadDevices(auth, currentGen);
    } catch (err) {
      if (generationRef.current !== currentGen || controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (generationRef.current === currentGen && !controller.signal.aborted) {
        setLoading(false);
      }
    }
  };

  const loadDevices = async (auth: CrealityCloudAuthSession, generation: number) => {
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const { list } = await fetchCrealityCloudDevices(
        {
          ...gatewayTarget,
          region,
          userId: auth.userId,
          token: auth.token
        },
        1,
        50,
        controller.signal
      );
      if (generationRef.current !== generation || controller.signal.aborted) return;
      setDevices(list);
    } catch (err) {
      if (generationRef.current !== generation || controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (generationRef.current === generation && !controller.signal.aborted) {
        setLoading(false);
      }
    }
  };

  const containerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    padding: 16,
    background: 'var(--panel-bg, #2a2a2a)',
    color: 'var(--text-color, #eee)',
    borderRadius: 8,
    maxWidth: 440,
    fontSize: '0.8125rem'
  };

  const buttonStyle: React.CSSProperties = {
    background: 'var(--primary-color, #0088cc)',
    color: '#fff',
    border: 'none',
    borderRadius: 4,
    padding: '6px 12px',
    cursor: 'pointer',
    fontWeight: 500
  };

  return (
    <div className="creality-cloud-login" style={containerStyle}>
      <h3 style={{ margin: '0 0 4px', fontSize: '1rem' }}>{t("Creality Cloud Login")}</h3>

      <label className="cc-region wm-field">
        <span className="wm-field-label">{t("Region:")}</span>
        <MobileSelect
          aria-label={t('Region:')}
          id="cc-region"
          value={region}
          disabled={loading}
          onValueChange={(value) => handleRegionChange(value as CrealityRegion)}
          className="cc-input"
        >
          <option value="global">{t("Global (api.crealitycloud.com)")}</option>
          <option value="china">{t("China (api.crealitycloud.cn)")}</option>
        </MobileSelect>
      </label>

      {error && (
        <div
          id="cc-error"
          style={{
            background: 'var(--error-bg, #551111)',
            color: 'var(--error-color, #ffaaaa)',
            padding: 8,
            borderRadius: 4,
            fontSize: '0.75rem'
          }}
        >
          {error}
        </div>
      )}

      {!session ? (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', borderBottom: '1px solid var(--border-color, #444)', gap: 8 }}>
            <button
              type="button"
              className="btn btn-tab"
              style={{
                background: 'transparent',
                border: 'none',
                borderBottom: tab === 'qr' ? '2px solid var(--primary-color, #0088cc)' : 'none',
                color: tab === 'qr' ? 'var(--text-color, #fff)' : 'var(--text-muted, #aaa)',
                padding: '6px 12px',
                cursor: 'pointer'
              }}
              onClick={() => handleTabChange('qr')}
            >
              {t("QR Code Login")}
            </button>
            <button
              type="button"
              className="btn btn-tab"
              style={{
                background: 'transparent',
                border: 'none',
                borderBottom: tab === 'password' ? '2px solid var(--primary-color, #0088cc)' : 'none',
                color: tab === 'password' ? 'var(--text-color, #fff)' : 'var(--text-muted, #aaa)',
                padding: '6px 12px',
                cursor: 'pointer'
              }}
              onClick={() => handleTabChange('password')}
            >
              {t("Account / Password")}
            </button>
          </div>

          {tab === 'qr' ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '8px 0' }}>
              {!qrResult ? (
                <button
                  id="cc-show-qr"
                  type="button"
                  className="btn btn-primary"
                  style={buttonStyle}
                  disabled={loading}
                  onClick={handleStartQr}
                >
                  {t(loading ? 'Requesting QR...' : 'Show Login QR Code')}
                </button>
              ) : (
                <>
                  <div style={{ fontSize: '0.75rem', textAlign: 'center', color: 'var(--text-muted, #aaa)' }}>
                    {t("Scan with Creality Cloud mobile app:")}
                  </div>
                  <div
                    id="cc-qr"
                    style={{
                      background: '#ffffff',
                      padding: 12,
                      borderRadius: 6,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    <QRCodeSVG
                      value={qrResult.qrUrl}
                      size={192}
                      level="M"
                      marginSize={4}
                    />
                  </div>
                  {qrExpired ? (
                    <div style={{ color: 'var(--error-color, #ff6666)', fontSize: '0.75rem' }}>
                      {t('QR code expired.')}{' '}
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ ...buttonStyle, padding: '4px 8px' }}
                        onClick={handleStartQr}
                      >
                        {t("Refresh")}
                      </button>
                    </div>
                  ) : (
                    <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted, #888)' }}>
                      {t("Waiting for app authorization...")}
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
            <form className="printer-provider-fields" onSubmit={handlePasswordSubmit}>
              <label className="cc-field wm-field">
                <span className="wm-field-label">{t("Account (Email or Phone):")}</span>
                <MobileInput
                  id="cc-account"
                  type="text"
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                  placeholder="user@example.com"
                  className="cc-input"
                  required
                />
              </label>
              <label className="cc-field wm-field">
                <span className="wm-field-label">{t("Password:")}</span>
                <MobileInput
                  id="cc-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="cc-input"
                  required
                />
              </label>
              <button
                id="cc-password-login"
                type="submit"
                className="btn btn-primary"
                style={buttonStyle}
                disabled={loading || !account.trim() || !password}
              >
                {t(loading ? 'Logging in...' : 'Sign In')}
              </button>
            </form>
          )}
        </>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--success-color, #88cc88)' }}>
            {t('Authenticated as user ID: {{id}}', { id: session.userId })}
          </div>
          <div style={{ fontWeight: 500 }}>{t("Select a bound printer:")}</div>
          {devices.length === 0 ? (
            <div style={{ color: 'var(--text-muted, #aaa)', fontSize: '0.75rem' }}>
              {t(loading ? 'Loading devices...' : 'No bound 3D printers found in this account.')}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 200, overflowY: 'auto' }}>
              {devices.map((dev) => (
                <div
                  key={dev.dn}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 10px',
                    background: 'var(--control-bg, #333)',
                    borderRadius: 4
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 500 }}>{dev.name}</div>
                    <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted, #aaa)' }}>
                      {dev.model} • {t(dev.online ? 'Online' : 'Offline')} • DN: {dev.dn}
                    </div>
                  </div>
                  <button
                    data-testid="cc-device"
                    data-dn={dev.dn}
                    type="button"
                    className="btn btn-primary"
                    style={{ ...buttonStyle, padding: '4px 8px', fontSize: '0.75rem' }}
                    onClick={() => onSelectDevice(dev, session, region)}
                  >
                    {t("Select")}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {onCancel && (
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onCancel}
          style={{
            background: 'transparent',
            border: '1px solid var(--border-color, #555)',
            color: 'var(--text-muted, #ccc)',
            borderRadius: 4,
            padding: 6,
            cursor: 'pointer'
          }}
        >
          {t("Cancel")}
        </button>
      )}
    </div>
  );
};
