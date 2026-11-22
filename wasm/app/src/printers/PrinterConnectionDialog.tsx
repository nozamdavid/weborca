import { MobileInput } from '../mobile/MobileInput';
import { MobileSelect } from '../mobile/MobileSelect';
import React, { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store/appStore';
import { systemProfiles } from '../presets/systemProfiles';
import { loadPrinterCatalog, usePrinterCatalog } from '../presets/printerCatalog';
import type { PresetItem } from '../engine/types';
import { createPrinterApi } from './api';
import { OctoEverywhereConnection } from './OctoEverywhereConnection';
import type { PrinterApi } from './types';
import { usePrinterConnectionStore } from './connectionStore';
import type { GatewayStatus } from './gatewayUrl';
import { fetchGatewayStatus, parseHost } from './gatewayUrl';
import type { HostType, PhysicalPrinter } from './types';
import { HOST_TYPE_LABELS } from './types';
import { CrealityCloudLogin } from './CrealityCloudLogin';
import { loginBambuCloud } from './bambuCloud';
import { PrusaConnectLogin } from './PrusaConnectLogin';
import { SnapmakerCloudLogin } from './SnapmakerCloudLogin';
import type { BambuCloudDevice } from './bambuCloud';
import { Dialog } from '../components/Dialog';
import { useTranslation } from '../i18n';
import { applyCloudSession, cloudScope, savedCloudSession, validateCloudSession, rejectedCloudSession, type CloudSession } from './cloudSessionReuse';

const HOST_PLACEHOLDER: Record<HostType, string> = {
  moonraker: '192.168.0.10 or http://printer.local',
  prusalink: '192.168.0.20',
  octoprint: 'http://octopi.local',
  prusaconnect: 'https://connect.prusa3d.com',
  bambu: '192.168.0.30',
  'bambu-cloud': 'api.bambulab.com',
  'creality-cloud': 'api.crealitycloud.com',
  'snapmaker-cloud': 'id.snapmaker.com',
  flashforge: '192.168.0.40'
};

const blank = (): PhysicalPrinter => ({ id: crypto.randomUUID(), name: '', host_type: 'moonraker', print_host: '', use_gateway: true });

function validate(p: PhysicalPrinter): string | undefined {
  if (!p.name.trim()) return 'Enter a name for the printer.';
  if (!p.print_host.trim()) return 'Enter the printer\'s hostname, IP address or URL.';
  try {
    parseHost(p.print_host);
    if (p.print_host_webui?.trim()) parseHost(p.print_host_webui);
  } catch {
    return 'The address is not valid. Use a hostname, an IP address or an http(s) URL.';
  }
  if (p.host_type === 'bambu-cloud') {
    if (!p.printhost_apikey?.trim() || !/^u_\d+$/.test(p.printhost_user || '')) return 'Log in to the cloud account first.';
    if (!p.serial?.trim()) return 'Choose a printer bound to the cloud account.';
  }
  if (p.host_type === 'creality-cloud') {
    if (!p.printhost_apikey?.trim() || !p.printhost_user?.trim()) return 'Log in to the cloud account first.';
    if (!p.serial?.trim() || !p.cloud_device_id?.trim()) return 'Choose a printer bound to the cloud account.';
  }
  if (p.host_type === 'snapmaker-cloud') {
    if (p.print_host !== 'id.snapmaker.com' || (p.cloud_region ?? 'global') !== 'global') return 'Unsupported Snapmaker Cloud scope.';
    if (!p.printhost_apikey?.trim() || !p.cloud_refresh_token?.trim()) return 'Log in to the cloud account first.';
    if (!p.cloud_device_id?.trim()) return 'Choose a printer bound to the cloud account.';
  }
  if (p.host_type === 'bambu' || p.host_type === 'flashforge') {
    if (!p.serial?.trim()) return 'Enter the printer\'s serial number (Settings > Device on the printer).';
    if (!p.printhost_apikey?.trim()) return 'Enter the access code shown on the printer\'s LAN settings.';
  }
  if (p.host_type === 'prusaconnect') {
    if (!p.printhost_apikey?.trim()) return 'Sign in to Prusa Connect first.';
    if (!p.cloud_device_id?.trim() && (p.print_host === 'connect.prusa3d.com' || p.print_host === 'https://connect.prusa3d.com')) {
      return 'Choose a printer from your Prusa Connect account.';
    }
  }
  return undefined;
}

const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => {
  const { t } = useTranslation();
  return (
    <label className="printer-field wm-field">
      <span className="wm-field-label">{t(label)}</span>
      {children}
      {hint && <span style={{ color: 'var(--text-secondary)', fontSize: '0.6875rem' }}>{t(hint)}</span>}
    </label>
  );
};


/** Add, edit and test physical printers, like desktop's "Physical Printer" dialog. */
export const PrinterConnectionDialog: React.FC = () => {
  const { t: translate } = useTranslation();
  const { dialogOpen, editingId, printers, savePrinter, deletePrinter, closeDialog: storeCloseDialog } = usePrinterConnectionStore();
  const { vendors, loading: catalogLoading, error: catalogError } = usePrinterCatalog();
  useEffect(() => { if (dialogOpen) void loadPrinterCatalog().catch(() => {}); }, [dialogOpen]);
  const appPrinters = useAppStore((s) => s.printers);
  const [brand, setBrand] = useState('');
  const [brandPresets, setBrandPresets] = useState<PresetItem[]>([]);
  const selectedPreset = useAppStore((s) => s.selectedPrinter);
  const selectedVendor = useAppStore((s) => s.selectedVendor);
  const [draft, setDraft] = useState<PhysicalPrinter>(blank);
  const [step, setStep] = useState(0);
  const [attempted, setAttempted] = useState(false);
  const [baseline, setBaseline] = useState('');
  const [gateway, setGateway] = useState<GatewayStatus | null | undefined>(undefined);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [cloudPassword, setCloudPassword] = useState('');
  const [cloudCode, setCloudCode] = useState('');
  const [cloudDevices, setCloudDevices] = useState<BambuCloudDevice[]>([]);
  const cloudLoginAbort = useRef<AbortController | null>(null);
  const testGeneration = useRef(0);
  const testApi = useRef<PrinterApi>();
  const cloudDrafts = useRef<PhysicalPrinter[]>([]);
  const [reusedSession, setReusedSession] = useState<CloudSession | null>(null);
  const [sessionStatus, setSessionStatus] = useState<'idle' | 'checking' | 'retry'>('idle');
  const [sessionAttempt, setSessionAttempt] = useState(0);
  const sessionAbort = useRef<AbortController | null>(null);
  const [sessionRegionUnsupported, setSessionRegionUnsupported] = useState(false);
  const [snapmakerSelection, setSnapmakerSelection] = useState<string>();
  const cancelRequests = () => {
    testApi.current?.dispose?.();
    sessionAbort.current?.abort();
    cloudLoginAbort.current?.abort();
    testGeneration.current++;
  };
  const closeDialog = () => { cancelRequests(); storeCloseDialog(); };
  const openPrinter = (id: string | null) => { cancelRequests(); usePrinterConnectionStore.getState().openDialog(id); };

  useEffect(() => {
    testApi.current?.dispose?.();
    testGeneration.current++;
    cloudLoginAbort.current?.abort();
    cloudLoginAbort.current = null;
    setTesting(false);
    setStep(0);
    setAttempted(false);
    setCloudPassword('');
    setCloudCode('');
    setCloudDevices([]);
    setReusedSession(null);
    cloudDrafts.current = [];
    if (!dialogOpen) return;
    const existing = printers.find((p) => p.id === editingId);
    const initial = existing ?? { ...blank(), preset: selectedPreset || undefined, vendor: selectedVendor || undefined };
    setDraft(initial);
    setBaseline(JSON.stringify(initial));
    setBrand(initial.vendor || selectedVendor);
    setResult(null);
    return () => { cloudLoginAbort.current?.abort(); testApi.current?.dispose?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialogOpen, editingId]);

  useEffect(() => {
    const controller = new AbortController();
    sessionAbort.current = controller;
    setSessionRegionUnsupported(false);
    setReusedSession(null);
    setCloudDevices([]);
    setSessionStatus('idle');
    setSnapmakerSelection(undefined);
    if (!dialogOpen || (editingId && draft.id !== editingId) ||
      !['prusaconnect', 'bambu-cloud', 'creality-cloud', 'snapmaker-cloud'].includes(draft.host_type)) return;
    const source = savedCloudSession(draft, [...cloudDrafts.current, ...printers]);
    if (!source) return;
    setSessionStatus('checking');
    void validateCloudSession(source, controller.signal, tokens => {
      if (controller.signal.aborted) return;
      setDraft(d => ({ ...d, printhost_apikey: tokens.access_token, cloud_refresh_token: tokens.refresh_token }));
      cloudDrafts.current = cloudDrafts.current.map(p => p.id === source.id && cloudScope(p) === cloudScope(source)
        ? { ...p, printhost_apikey: tokens.access_token, cloud_refresh_token: tokens.refresh_token } : p);
    }).then(session => {
      if (controller.signal.aborted) return;
      setReusedSession(session);
      setSessionStatus('idle');
      cloudDrafts.current = cloudDrafts.current.map(p => p.id === source.id && cloudScope(p) === cloudScope(source) ? session.credentials : p);
      setDraft(d => applyCloudSession(d, session));
      if (session.provider === 'snapmaker-cloud') setSnapmakerSelection(applyCloudSession(draft, session).cloud_device_id);
      if (session.provider === 'bambu-cloud') setCloudDevices(session.data.devices);
    }, error => {
      if (controller.signal.aborted) return;
      if (rejectedCloudSession(error) && (draft.host_type !== 'snapmaker-cloud' || error?.status === 401)) {
        setSessionStatus('idle');
        setDraft(d => ({ ...d, printhost_apikey: undefined, cloud_refresh_token: undefined }));
      } else {
        setSessionRegionUnsupported(error?.code === 'unsupported-region');
        setSessionStatus('retry');
      }
    });
    return () => controller.abort();
    // Credentials are applied to the draft after validation; that must not start another request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialogOpen, editingId, draft.id, draft.host_type, draft.print_host, draft.cloud_region, draft.cloud_account, sessionAttempt]);

  // The printer presets of the chosen brand, loaded on demand.
  useEffect(() => {
    if (!dialogOpen || !brand) return;
    let cancelled = false;
    void (async () => {
      if (brand === selectedVendor) return setBrandPresets(appPrinters);
      const all = await systemProfiles(brand, 'machine');
      if (!cancelled) setBrandPresets(all.filter((p) => p.instantiation === true || p.instantiation === 'true').map((p) => ({ name: p.name, vendor: brand, inherits: p.inherits ?? '', isSystem: true, isCompatible: true })));
    })();
    return () => { cancelled = true; };
  }, [dialogOpen, brand, selectedVendor, appPrinters]);

  useEffect(() => {
    if (!dialogOpen) return;
    setGateway(undefined);
    fetchGatewayStatus().then((s) => setGateway(s ?? null));
  }, [dialogOpen]);

  if (!dialogOpen) return null;

  const set = <K extends keyof PhysicalPrinter>(key: K, value: PhysicalPrinter[K]) => {
    testApi.current?.dispose?.();
    testGeneration.current++;
    cloudLoginAbort.current?.abort();
    cloudLoginAbort.current = null;
    setTesting(false);
    const changesScope = ['prusaconnect', 'bambu-cloud', 'creality-cloud', 'snapmaker-cloud'].includes(draft.host_type) &&
      ['print_host', 'cloud_account', 'cloud_region'].includes(key);
    if (changesScope) {
      sessionAbort.current?.abort();
      setReusedSession(null);
      setCloudDevices([]);
      setCloudPassword('');
      setCloudCode('');
    }
    setDraft((d) => ({ ...d, ...(changesScope ? { printhost_apikey: undefined, cloud_refresh_token: undefined,
      printhost_user: undefined, serial: undefined, cloud_device_id: undefined, cloud_team_id: undefined } : {}), [key]: value }));
    setResult(null);
  };
  const error = validate(draft) ?? (draft.host_type === 'snapmaker-cloud' &&
    (!snapmakerSelection || snapmakerSelection !== draft.cloud_device_id || sessionStatus !== 'idle') ? 'Choose a printer bound to the cloud account.' : undefined);
  const isBambu = draft.host_type === 'bambu';
  const isFlashforge = draft.host_type === 'flashforge';
  const isPrusaLink = draft.host_type === 'prusalink';
  const isCrealityCloud = draft.host_type === 'creality-cloud';
  const isSnapmakerCloud = draft.host_type === 'snapmaker-cloud';
  const isCloud = draft.host_type === 'prusaconnect' || draft.host_type === 'bambu-cloud' || isCrealityCloud || isSnapmakerCloud;
  const isBambuCloud = draft.host_type === 'bambu-cloud';
  const isPrusaConnect = draft.host_type === 'prusaconnect';

  const cloudAccount = draft.cloud_account ?? (draft.printhost_user?.startsWith('u_') ? '' : draft.printhost_user ?? '');
  const loginToCloud = async () => {
    cloudLoginAbort.current?.abort();
    const controller = new AbortController();
    cloudLoginAbort.current = controller;
    setTesting(true);
    setResult(null);
    try {
      const { token, refreshToken, username, devices } = await loginBambuCloud(draft, cloudAccount,
        { password: cloudPassword, code: cloudCode }, controller.signal);
      if (controller.signal.aborted) return;
      setDraft((d) => ({ ...d, cloud_account: cloudAccount.trim(), printhost_apikey: token, cloud_refresh_token: refreshToken, printhost_user: username,
        serial: devices.some(device => device.dev_id === d.serial) ? d.serial : devices[0]?.dev_id ?? '' }));
      setCloudDevices(devices);
      setCloudPassword('');
      setCloudCode('');
      setResult({ ok: true, text: translate('Logged in successfully. Found {{count}} devices.', { count: devices.length }) });
    } catch (err) {
      if (!controller.signal.aborted) setResult({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      if (cloudLoginAbort.current === controller) {
        cloudLoginAbort.current = null;
        setTesting(false);
      }
    }
  };

  const test = async () => {
    const generation = ++testGeneration.current;
    setTesting(true);
    setResult(null);
    let api: PrinterApi | undefined;
    try {
      api = createPrinterApi(draft);
      testApi.current = api;
      const text = await api.test();
      if (generation === testGeneration.current) setResult({ ok: true, text });
    } catch (e) {
      if (generation === testGeneration.current) setResult({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      api?.dispose?.();
      if (testApi.current === api) testApi.current = undefined;
      if (generation === testGeneration.current) setTesting(false);
    }
  };

  const save = () => {
    if (error) { setAttempted(true); return; }
    savePrinter({ ...draft, use_gateway: true, name: draft.name.trim(), print_host: draft.print_host.trim() });
    closeDialog();
  };

  const isSaved = Boolean(editingId) && printers.some((p) => p.id === draft.id);
  const cloudService = isSnapmakerCloud ? 'snapmaker-cloud' : isCrealityCloud ? 'creality-cloud' : isBambuCloud ? 'bambu-cloud' : isPrusaConnect ? 'prusa-connect' : undefined;
  const cloudGatewayMessage = isSnapmakerCloud ? 'This gateway does not allow Snapmaker Cloud. Enable snapmaker-cloud on the gateway.' : isCrealityCloud
    ? 'This gateway does not allow Creality Cloud. Enable ORCA_PRINTER_CLOUD=creality-cloud on the server.'
    : isBambuCloud ? 'This gateway does not allow Bambu Cloud. Enable ORCA_PRINTER_CLOUD=bambu-cloud on the server.' : 'This gateway does not allow Prusa Connect. Enable ORCA_PRINTER_CLOUD=prusa-connect on the server.';
  const gatewayNote = gateway === undefined ? 'Checking the gateway...'
    : gateway === null ? 'This server has no printer gateway.'
    : cloudService && !gateway.cloud?.includes(cloudService) ? cloudGatewayMessage
    : !gateway.enabled ? gateway.message ?? 'The printer gateway is off.'
    : draft.host_type === 'prusaconnect' && !gateway.cloud?.includes('prusa-connect') ? 'This gateway does not allow Prusa Connect. Enable ORCA_PRINTER_CLOUD=prusa-connect on the server.'
    : `Gateway on: ${gateway.mode === 'private' ? 'private networks only' : gateway.mode === 'cloud' ? 'cloud services only' : 'listed hosts only'}${gateway.readOnly ? ', read-only' : ''}.`;

  return (
    <Dialog className="ds-scrim" aria-modal="true" onClose={closeDialog} dirty={baseline !== '' && JSON.stringify(draft) !== baseline} dirtyWhat={translate("printer changes")} id="printer-connection-dialog" role="dialog" aria-label={translate("Printer connection")}>
      <div className={`ds-dialog printer-sheet printer-connection ${!editingId ? 'printer-connection--add' : ''}`}><div className="ds-dialog__body printer-connection-layout">
        {editingId && <div className="printer-connection-list">
          <strong style={{ fontSize: '0.75rem' }}>{translate("Printers")}</strong>
          {printers.map((p) => (
            <button key={p.id} className={`ds-btn ${p.id === draft.id ? 'ds-btn--primary' : ''}`} style={{ textAlign: 'left' }} onClick={() => openPrinter(p.id)}>
              {p.name}
            </button>
          ))}
          <button className="ds-btn" id="pc-add" onClick={() => openPrinter(null)}>{translate("+ New printer")}</button>
        </div>}

        <div className="printer-connection-fields">
          <h2 className="ds-title ds-title--dialog">{translate(isSaved ? 'Edit printer' : 'Add a printer')}</h2>
          {!editingId && <p className="printer-steps" role="status">{step + 1} / 2 · {translate(step === 0 ? 'Printer' : 'Connection')}</p>}
          <div id="pc-printer-step" className="printer-step-fields" hidden={!editingId && step !== 0}>
          {catalogLoading && <p role="status">{translate('Loading...')}</p>}
          {catalogError && <div role="alert"><p>{translate('Failed to load printer catalog. Check your connection and retry.')}</p><button className="ds-btn" onClick={() => void loadPrinterCatalog().catch(() => {})}>{translate('Retry')}</button></div>}

          <Field label="Name">
            <MobileInput id="pc-name" className="ds-input" value={draft.name} onChange={(e) => set('name', e.target.value)} placeholder={translate('My Voron')} />
          </Field>
          <Field label="Printer preset" hint="The slicer's printer profile this machine uses.">
            <div className="printer-field-pair">
              <MobileSelect id="pc-brand" aria-label={translate('Brand')} className="ds-input" value={brand} onValueChange={(value) => setBrand(value)}>
                {vendors.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
              </MobileSelect>
              <MobileSelect id="pc-preset" className="ds-input" value={draft.preset ?? ''} onValueChange={(value) => setDraft({ ...draft, preset: value || undefined, vendor: value ? brand || undefined : undefined })}>
                <option value="">{translate("(none)")}</option>
                {draft.preset && !brandPresets.some((p) => p.name === draft.preset) && <option value={draft.preset}>{draft.preset}</option>}
                {brandPresets.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
              </MobileSelect>
            </div>
          </Field>
          <Field label="Host type">
            <MobileSelect id="pc-host-type" className="ds-input" value={draft.host_type} onValueChange={(value) => {
              testGeneration.current++;
              sessionAbort.current?.abort();
              cloudLoginAbort.current?.abort();
              cloudLoginAbort.current = null;
              setCloudDevices([]);
              setTesting(false);
              setReusedSession(null);
              setCloudPassword('');
              setCloudCode('');
              const type = value as HostType;
              cloudDrafts.current = [draft, ...cloudDrafts.current.filter(p => cloudScope(p) !== cloudScope(draft))];
              setDraft((d) => ({ ...d, host_type: type, printhost_user: undefined, printhost_apikey: undefined,
                printhost_password: undefined, cloud_account: undefined, cloud_refresh_token: undefined, cloud_team_id: undefined,
                serial: undefined, cloud_device_id: undefined, cloud_region: undefined,
                ...(['prusaconnect', 'bambu', 'flashforge', 'bambu-cloud', 'creality-cloud', 'snapmaker-cloud'].includes(type) ? { use_gateway: true } : {}),
                ...(type === 'snapmaker-cloud' ? { print_host: 'id.snapmaker.com', print_host_webui: undefined, cloud_region: 'global' } : {}),
                ...(type === 'creality-cloud' ? { print_host: 'api.crealitycloud.com', cloud_region: 'global' } : {}),
                ...(type === 'bambu-cloud' ? { print_host: 'us.mqtt.bambulab.com' } : {}),
                ...(type === 'prusaconnect' ? { print_host: 'connect.prusa3d.com' } : {}) }));
              setResult(null);
            }}>
              {(Object.keys(HOST_TYPE_LABELS) as HostType[]).map((t) => <option key={t} value={t}>{HOST_TYPE_LABELS[t]}</option>)}
            </MobileSelect>
          </Field>
          </div>
          <div id="pc-connection-step" className="printer-step-fields" hidden={!editingId && step !== 1}>
          {isCrealityCloud || isPrusaConnect || isSnapmakerCloud ? null : isBambuCloud ? (
            <Field label="Cloud Region" hint="Select the cloud region for your account.">
              <MobileSelect id="pc-host" className="ds-input" value={draft.print_host || 'us.mqtt.bambulab.com'} onValueChange={(value) => set('print_host', value)}>
                <option value="us.mqtt.bambulab.com">Global / US (us.mqtt.bambulab.com)</option>
                <option value="cn.mqtt.bambulab.com">China (cn.mqtt.bambulab.com)</option>
                <option value="mqtt.bambu-lab.com">Legacy (mqtt.bambu-lab.com)</option>
              </MobileSelect>
            </Field>
          ) : (
            <Field label="Hostname, IP or URL" hint={isBambu ? 'The printer\'s IP address (LAN mode must be on).' : 'Where the printer\'s API answers. Moonraker is usually the same address as Fluidd/Mainsail.'}>
              <MobileInput id="pc-host" className="ds-input" value={draft.print_host} onChange={(e) => set('print_host', e.target.value)} placeholder={HOST_PLACEHOLDER[draft.host_type]} />
            </Field>
          )}
          {!isBambu && !isBambuCloud && !isFlashforge && !isCloud && (
            <details><summary>{translate('Device UI')}</summary><Field label="Device UI" hint="Address of the printer's web UI, shown in the Device tab. Leave empty to use the host.">
              <MobileInput id="pc-webui" className="ds-input" value={draft.print_host_webui ?? ''} onChange={(e) => set('print_host_webui', e.target.value)} placeholder="http://192.168.0.10" />
            </Field></details>
          )}

          {isCrealityCloud && draft.serial && <Field label="Device"><span id="pc-creality-device">{draft.serial}</span></Field>}
          {isPrusaConnect && draft.cloud_device_id && <Field label="Device"><span id="pc-prusa-device">{draft.name || draft.serial} ({draft.cloud_device_id})</span></Field>}
          {isCloud && sessionStatus !== 'idle' ? <div role="status">
            {translate(sessionStatus === 'checking' ? 'Checking saved cloud session...' : sessionRegionUnsupported
              ? 'Saved session validation is unavailable for this Bambu region.' : 'Could not check saved session. Retry when the service is available.')}
            {sessionStatus === 'retry' && <button className="ds-btn" onClick={() => setSessionAttempt(n => n + 1)}>{translate('Retry')}</button>}
          </div> : isSnapmakerCloud ? (
            <SnapmakerCloudLogin key={`${draft.id}:${!!reusedSession}`}
              target={draft} initialSession={reusedSession?.provider === 'snapmaker-cloud' ? reusedSession.data : undefined}
              selectedDeviceId={draft.cloud_device_id}
              onCredentials={source => setDraft(d => ({ ...d, printhost_apikey: source.printhost_apikey,
                cloud_refresh_token: source.cloud_refresh_token }))}
              onValidatedDevices={devices => { setSnapmakerSelection(devices.find(p => p.deviceId === draft.cloud_device_id)?.deviceId);
                if (!devices.some(p => p.deviceId === draft.cloud_device_id)) setDraft(d => ({ ...d, cloud_device_id: undefined, serial: undefined })); }}
              onSelectDevice={(device, source) => { setSnapmakerSelection(device.deviceId); setDraft(d => ({ ...d, name: d.name.trim() || device.name,
                cloud_account: source.cloud_account, printhost_apikey: source.printhost_apikey,
                cloud_refresh_token: source.cloud_refresh_token, cloud_device_id: device.deviceId, serial: device.sn,
                print_host: 'id.snapmaker.com', cloud_region: 'global', print_host_webui: undefined, use_gateway: true })); }} />
          ) : isCrealityCloud ? (
            <CrealityCloudLogin key={`${draft.id}:${draft.cloud_region}:${!!reusedSession}`} initialRegion={draft.cloud_region} gatewayTarget={{ use_gateway: true }}
              initialSession={reusedSession?.provider === 'creality-cloud' ? { session: { token: reusedSession.credentials.printhost_apikey!, userId: reusedSession.credentials.printhost_user! }, devices: reusedSession.data } : undefined}
              onRegionChange={region => { set('cloud_region', region); setDraft(d => ({ ...d, print_host: region === 'china' ? 'api.crealitycloud.cn' : 'api.crealitycloud.com' })); }}
              onSelectDevice={(device, session, region) => {
                setDraft(d => ({ ...d, cloud_region: region, print_host: region === 'china' ? 'api.crealitycloud.cn' : 'api.crealitycloud.com',
                  printhost_user: session.userId, printhost_apikey: session.token, serial: device.dn, cloud_device_id: device.tbId }));
                setResult({ ok: true, text: device.name });
              }} />
          ) : isPrusaConnect ? (
            <PrusaConnectLogin
              key={`${draft.id}:${!!reusedSession}`}
              initialSession={reusedSession?.provider === 'prusaconnect' ? reusedSession.data : undefined}
              gatewayTarget={{ print_host: draft.print_host,
                cloud_region: draft.cloud_region, cloud_account: draft.cloud_account }}
              selectedDeviceId={draft.cloud_device_id}
              onSelectPrinter={(printer, tokens, teamId, accountName) => {
                setDraft((d) => ({
                  ...d,
                  name: d.name.trim() ? d.name : printer.name,
                  serial: printer.name,
                  cloud_device_id: printer.uuid,
                  cloud_team_id: String(teamId),
                  cloud_account: accountName,
                  printhost_apikey: tokens.access_token,
                  cloud_refresh_token: tokens.refresh_token,
                  print_host: 'connect.prusa3d.com',
                  use_gateway: true
                }));
                setResult({ ok: true, text: `${printer.name} (${printer.uuid})` });
              }}
            />
          ) : isBambuCloud ? (
            <>
              <Field label="Account (Email)">
                <MobileInput id="pc-cloud-account" className="ds-input" value={cloudAccount} onChange={(e) => set('cloud_account', e.target.value)} />
              </Field>
              {reusedSession?.provider !== 'bambu-cloud' && <><div className="printer-field-pair">
                <Field label="Password (or)">
                  <MobileInput id="pc-cloud-password" type="password" className="ds-input" value={cloudPassword} onChange={(e) => { setCloudPassword(e.target.value); setCloudCode(''); }} />
                </Field>
                <Field label="Verification Code">
                  <MobileInput id="pc-cloud-code" type="text" className="ds-input" value={cloudCode} onChange={(e) => { setCloudCode(e.target.value); setCloudPassword(''); }} />
                </Field>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 4, marginBottom: 8 }}>
                <button className="ds-btn" onClick={loginToCloud} disabled={!cloudAccount || (!cloudPassword && !cloudCode) || testing}>
                  {translate('Log in / Get devices')}
                </button>
              </div>
              </>}
              <Field label="Device">
                {cloudDevices.length > 0 ? (
                  <MobileSelect id="pc-serial-select" className="ds-input" value={draft.serial ?? ''} onValueChange={(value) => set('serial', value)}>
                    <option value="">{translate("(Select device)")}</option>
                    {cloudDevices.map(d => <option key={d.dev_id} value={d.dev_id}>{d.name} ({d.dev_id})</option>)}
                  </MobileSelect>
                ) : (
                  <MobileInput id="pc-serial" className="ds-input" value={draft.serial ?? ''} onChange={(e) => set('serial', e.target.value)} placeholder="Log in to see devices, or enter serial manually" />
                )}
              </Field>
            </>
          ) : (isBambu || isFlashforge) ? (
            <>
              <Field label="Serial number">
                <MobileInput id="pc-serial" className="ds-input" value={draft.serial ?? ''} onChange={(e) => set('serial', e.target.value)} />
              </Field>
              <Field label="Access code"><MobileInput id="pc-apikey" className="ds-input" type="password" value={draft.printhost_apikey ?? ''} onChange={(e) => set('printhost_apikey', e.target.value)} /></Field>
            </>
          ) : (
            <>
              <Field label="API key" hint={draft.host_type === 'moonraker' ? 'Only needed if Moonraker requires one. Printers on your network usually do not.' : undefined}>
                <MobileInput id="pc-apikey" className="ds-input" type="password" value={draft.printhost_apikey ?? ''} onChange={(e) => set('printhost_apikey', e.target.value)} />
              </Field>
              {isPrusaLink && (
                <div className="printer-field-pair">
                  <Field label="User"><MobileInput id="pc-user" className="ds-input" value={draft.printhost_user ?? ''} onChange={(e) => set('printhost_user', e.target.value)} placeholder="maker" /></Field>
                  <Field label="Password"><MobileInput id="pc-password" className="ds-input" type="password" value={draft.printhost_password ?? ''} onChange={(e) => set('printhost_password', e.target.value)} /></Field>
                </div>
              )}
            </>
          )}

          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: '0.75rem' }}>
            <span>
              {translate("Connect through this app's server (gateway)")}
              <br /><span id="pc-gateway-status" style={{ color: 'var(--text-secondary)', fontSize: '0.6875rem' }}>{translate(gatewayNote)}</span>
            </span>
          </label>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.6875rem' }}>
            {translate('The API key and passwords are stored in this browser only.')}
          </div>

          {isSaved && <details><summary>OctoEverywhere</summary><OctoEverywhereConnection key={draft.id} printer={draft} onChange={updated => setDraft(current => current === draft ? updated : current)} /></details>}
          {result && (
            <div id="pc-test-result" data-ok={result.ok} className="printer-result">
              {result.ok ? '✓ ' : '✗ '}{translate(result.text)}
            </div>
          )}
          </div>
          {error && (Boolean(editingId) || step === 1 || attempted) && <div id="pc-validation" role="alert" className="printer-warning">{translate(error)}</div>}

        </div>
        </div>
          <footer className="ds-dialog__foot">
            {isSaved && (
              <button className="ds-btn" id="pc-delete" style={{ marginRight: 'auto' }} onClick={() => { deletePrinter(draft.id); closeDialog(); }}>{translate("Delete")}</button>
            )}
            {!editingId && step === 1 && <button className="ds-btn" id="pc-back" onClick={() => { setStep(0); setAttempted(false); requestAnimationFrame(() => document.getElementById('pc-name')?.focus()); }}>{translate('Back')}</button>}
            {(editingId || step === 1) && <button className="ds-btn" id="pc-test" onClick={test} disabled={!!error || testing}>{translate(testing ? 'Testing...' : 'Test connection')}</button>}
            <button className="ds-btn" id="pc-cancel" onClick={closeDialog}>{translate("Cancel")}</button>
            {!editingId && step === 0 ? <button className="ds-btn ds-btn--primary" id="pc-next" onClick={() => {
              if (!draft.name.trim()) { setAttempted(true); return; }
              setStep(1); setAttempted(false);
              requestAnimationFrame(() => document.querySelector<HTMLElement>('#pc-connection-step input, #pc-connection-step select, #pc-connection-step button')?.focus());
            }}>{translate('Next')}</button> : <button className="ds-btn ds-btn--primary" id="pc-save" onClick={save} disabled={!!error}>{translate("Save")}</button>}
          </footer>
      </div>
    </Dialog>
  );
};
