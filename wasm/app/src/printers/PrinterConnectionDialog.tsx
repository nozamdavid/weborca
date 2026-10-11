import React, { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store/appStore';
import { systemProfiles } from '../presets/systemProfiles';
import type { PresetItem } from '../engine/types';
import { createPrinterApi } from './api';
import { usePrinterConnectionStore } from './connectionStore';
import type { GatewayStatus } from './gatewayUrl';
import type { DiscoveredPrinter } from './gatewayUrl';
import { DEFAULT_LOCAL_GATEWAY, discoverPrinters, fetchGatewayStatus, parseHost } from './gatewayUrl';
import type { HostType, PhysicalPrinter } from './types';
import { HOST_TYPE_LABELS } from './types';
import { CrealityCloudLogin } from './CrealityCloudLogin';
import { loginBambuCloud } from './bambuCloud';
import type { BambuCloudDevice } from './bambuCloud';
import { ModalBackdrop } from '../components/ModalBackdrop';
import { useTranslation } from '../i18n';

const HOST_PLACEHOLDER: Record<HostType, string> = {
  moonraker: '192.168.0.10 or http://printer.local',
  prusalink: '192.168.0.20',
  octoprint: 'http://octopi.local',
  prusaconnect: 'https://connect.prusa3d.com',
  bambu: '192.168.0.30',
  'bambu-cloud': 'api.bambulab.com',
  'creality-cloud': 'api.crealitycloud.com',
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
  if (p.host_type === 'bambu' || p.host_type === 'flashforge') {
    if (!p.serial?.trim()) return 'Enter the printer\'s serial number (Settings > Device on the printer).';
    if (!p.printhost_apikey?.trim()) return 'Enter the access code shown on the printer\'s LAN settings.';
  }
  if (p.host_type === 'prusaconnect' && !p.printhost_apikey?.trim()) return 'Enter the API key from your printer\'s page in Prusa Connect.';
  return undefined;
}

const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => {
  const { t } = useTranslation();
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12 }}>
      <span>{t(label)}</span>
      {children}
      {hint && <span style={{ color: 'var(--text-muted, #a0a0a0)', fontSize: 11 }}>{t(hint)}</span>}
    </label>
  );
};

const inputStyle: React.CSSProperties = {
  background: 'var(--control-bg, #3a3a3a)', color: 'inherit', border: '1px solid var(--border-color, #444)', borderRadius: 4, padding: '5px 8px'
};

/** Add, edit and test physical printers, like desktop's "Physical Printer" dialog. */
export const PrinterConnectionDialog: React.FC = () => {
  const { t: translate } = useTranslation();
  const { dialogOpen, editingId, printers, savePrinter, deletePrinter, closeDialog } = usePrinterConnectionStore();
  const vendors = useAppStore((s) => s.vendors);
  const appPrinters = useAppStore((s) => s.printers);
  const [brand, setBrand] = useState('');
  const [brandPresets, setBrandPresets] = useState<PresetItem[]>([]);
  const selectedPreset = useAppStore((s) => s.selectedPrinter);
  const selectedVendor = useAppStore((s) => s.selectedVendor);
  const [draft, setDraft] = useState<PhysicalPrinter>(blank);
  const [baseline, setBaseline] = useState('');
  const [gateway, setGateway] = useState<GatewayStatus | null | undefined>(undefined);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [cloudPassword, setCloudPassword] = useState('');
  const [cloudCode, setCloudCode] = useState('');
  const [cloudDevices, setCloudDevices] = useState<BambuCloudDevice[]>([]);
  const cloudLoginAbort = useRef<AbortController | null>(null);
  const testGeneration = useRef(0);

  useEffect(() => {
    testGeneration.current++;
    cloudLoginAbort.current?.abort();
    cloudLoginAbort.current = null;
    setTesting(false);
    setCloudPassword('');
    setCloudCode('');
    setCloudDevices([]);
    if (!dialogOpen) return;
    const existing = printers.find((p) => p.id === editingId);
    const initial = existing ?? { ...blank(), preset: selectedPreset || undefined, vendor: selectedVendor || undefined };
    setDraft(initial);
    setBaseline(JSON.stringify(initial));
    setBrand(initial.vendor || selectedVendor);
    setResult(null);
    return () => cloudLoginAbort.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialogOpen, editingId]);

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

  const localBase = draft.use_gateway || draft.host_type === 'bambu' || draft.host_type === 'flashforge' || draft.host_type === 'prusaconnect' || (draft.host_type === 'bambu-cloud' || draft.host_type === 'creality-cloud') ? draft.local_gateway : undefined;
  useEffect(() => {
    if (!dialogOpen) return;
    setGateway(undefined);
    fetchGatewayStatus(localBase).then((s) => setGateway(s ?? null));
  }, [dialogOpen, localBase]);

  const [found, setFound] = useState<DiscoveredPrinter[]>([]);
  const [scan, setScan] = useState<{ running: boolean; error?: string; done?: boolean }>({ running: false });
  const scanAbort = useRef<AbortController | null>(null);
  useEffect(() => () => scanAbort.current?.abort(), []);
  useEffect(() => {
    scanAbort.current?.abort();
    setFound([]);
    setScan({ running: false });
  }, [dialogOpen, editingId]);

  if (!dialogOpen) return null;

  const discover = () => {
    scanAbort.current?.abort();
    const abort = new AbortController();
    scanAbort.current = abort;
    setFound([]);
    setScan({ running: true });
    discoverPrinters(draft.local_gateway || DEFAULT_LOCAL_GATEWAY, (p) => setFound((list) => [...list, p]), abort.signal).then(
      () => !abort.signal.aborted && setScan({ running: false, done: true }),
      (e) => !abort.signal.aborted && setScan({ running: false, error: e instanceof TypeError ? 'The gateway on this computer did not answer. Start it, then try again.' : String(e instanceof Error ? e.message : e) })
    );
  };
  const useFound = (p: DiscoveredPrinter) => {
    setDraft((d) => ({
      ...d, host_type: p.host_type, print_host: p.host, use_gateway: true, local_gateway: d.local_gateway || DEFAULT_LOCAL_GATEWAY,
      name: d.name.trim() ? d.name : p.name || `${HOST_TYPE_LABELS[p.host_type]} ${p.host.replace(/:\d+$/, '')}`,
      serial: p.serial ?? d.serial
    }));
    setResult(null);
  };

  const set = <K extends keyof PhysicalPrinter>(key: K, value: PhysicalPrinter[K]) => {
    testGeneration.current++;
    cloudLoginAbort.current?.abort();
    cloudLoginAbort.current = null;
    setTesting(false);
    setDraft((d) => ({ ...d, [key]: value }));
    setResult(null);
  };
  const error = validate(draft);
  const isBambu = draft.host_type === 'bambu';
  const isFlashforge = draft.host_type === 'flashforge';
  const isPrusaLink = draft.host_type === 'prusalink';
  const isCrealityCloud = draft.host_type === 'creality-cloud';
  const isCloud = draft.host_type === 'prusaconnect' || draft.host_type === 'bambu-cloud' || isCrealityCloud;
  const isBambuCloud = draft.host_type === 'bambu-cloud';

  const cloudAccount = draft.cloud_account ?? (draft.printhost_user?.startsWith('u_') ? '' : draft.printhost_user ?? '');
  const loginToCloud = async () => {
    cloudLoginAbort.current?.abort();
    const controller = new AbortController();
    cloudLoginAbort.current = controller;
    setTesting(true);
    setResult(null);
    try {
      const { token, username, devices } = await loginBambuCloud(draft, cloudAccount,
        { password: cloudPassword, code: cloudCode }, controller.signal);
      if (controller.signal.aborted) return;
      setDraft((d) => ({ ...d, cloud_account: cloudAccount.trim(), printhost_apikey: token, printhost_user: username,
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
    try {
      const text = await createPrinterApi(draft).test();
      if (generation === testGeneration.current) setResult({ ok: true, text });
    } catch (e) {
      if (generation === testGeneration.current) setResult({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      if (generation === testGeneration.current) setTesting(false);
    }
  };

  const save = () => {
    savePrinter({ ...draft, use_gateway: draft.use_gateway || isBambu || isFlashforge || isCloud, name: draft.name.trim(), print_host: draft.print_host.trim() });
    closeDialog();
  };

  const cloudService = isCrealityCloud ? 'creality-cloud' : isBambuCloud ? 'bambu-cloud' : undefined;
  const cloudGatewayMessage = isCrealityCloud
    ? 'This gateway does not allow Creality Cloud. Start it with --cloud creality-cloud (or ORCA_PRINTER_CLOUD=creality-cloud).'
    : 'This gateway does not allow Bambu Cloud. Start it with --cloud bambu-cloud (or ORCA_PRINTER_CLOUD=bambu-cloud).';
  const gatewayNote = gateway === undefined ? 'Checking the gateway...'
    : gateway === null ? (localBase ? 'The gateway on this computer did not answer.' : 'This server has no printer gateway.')
    : cloudService && !gateway.cloud?.includes(cloudService) ? cloudGatewayMessage
    : !gateway.enabled ? gateway.message ?? 'The printer gateway is off.'
    : draft.host_type === 'prusaconnect' && !gateway.cloud?.includes('prusa-connect') ? 'This gateway does not allow Prusa Connect. Start it with --cloud prusa-connect (or ORCA_PRINTER_CLOUD=prusa-connect).'
    : `Gateway on: ${gateway.mode === 'private' ? 'private networks only' : gateway.mode === 'cloud' ? 'cloud services only' : 'listed hosts only'}${gateway.readOnly ? ', read-only' : ''}.`;

  return (
    <ModalBackdrop onClose={closeDialog} dirty={baseline !== '' && JSON.stringify(draft) !== baseline} dirtyWhat={translate("printer changes")} id="printer-connection-dialog" role="dialog" aria-label={translate("Printer connection")}>
      <div className="modal-content" style={{ width: 'min(760px, 94vw)', display: 'flex', gap: 16, maxHeight: '90vh', overflow: 'auto' }}>
        <div style={{ flex: '0 0 170px', display: 'flex', flexDirection: 'column', gap: 6, borderRight: '1px solid var(--border-color, #444)', paddingRight: 12 }}>
          <strong style={{ fontSize: 12 }}>{translate("Printers")}</strong>
          {printers.map((p) => (
            <button key={p.id} className={`btn ${p.id === draft.id ? 'btn-primary' : 'btn-secondary'}`} style={{ textAlign: 'left' }} onClick={() => usePrinterConnectionStore.getState().openDialog(p.id)}>
              {p.name}
            </button>
          ))}
          <button className="btn btn-secondary" id="pc-add" onClick={() => usePrinterConnectionStore.getState().openDialog(null)}>{translate("+ New printer")}</button>
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
          <h3 style={{ margin: 0 }}>{translate(printers.some((p) => p.id === draft.id) ? 'Edit printer' : 'Add a printer')}</h3>

          {!isCloud && !printers.some((p) => p.id === draft.id) && (
            <div id="pc-discover" style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button className="btn btn-secondary" id="pc-discover-btn" onClick={discover} disabled={scan.running}>{translate(scan.running ? 'Searching...' : 'Discover printers in this network')}</button>
                <span style={{ color: 'var(--text-muted, #a0a0a0)', fontSize: 11 }}>{translate("Needs the gateway program running on this computer.")}</span>
              </div>
              {scan.error && <span id="pc-discover-error" style={{ color: 'var(--danger, #e05d5d)' }}>{scan.error}</span>}
              {scan.done && found.length === 0 && <span id="pc-discover-none">{translate("No printers found.")}</span>}
              {found.map((p) => {
                const added = printers.some((x) => x.host_type === p.host_type && x.print_host.replace(/^https?:\/\//, '') === p.host);
                return (
                  <div key={`${p.host_type}/${p.host}`} className="pc-discovered" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ flex: 1, minWidth: 0 }}>{p.name ?? HOST_TYPE_LABELS[p.host_type]} <span style={{ color: 'var(--text-muted, #a0a0a0)' }}>{p.host}{p.detail ? ` · ${p.detail}` : ''}</span></span>
                    {added ? <span style={{ color: 'var(--text-muted, #a0a0a0)' }}>{translate("Already added")}</span> : <button className="btn btn-secondary" onClick={() => useFound(p)}>{translate("Add")}</button>}
                  </div>
                );
              })}
            </div>
          )}

          <Field label="Name">
            <input id="pc-name" style={inputStyle} value={draft.name} onChange={(e) => set('name', e.target.value)} placeholder="My Voron" />
          </Field>
          <Field label="Printer preset" hint="The slicer's printer profile this machine uses.">
            <div style={{ display: 'flex', gap: 6 }}>
              <select id="pc-brand" aria-label="Brand" style={{ ...inputStyle, flex: '0 0 38%' }} value={brand} onChange={(e) => setBrand(e.target.value)}>
                {vendors.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
              </select>
              <select id="pc-preset" style={{ ...inputStyle, flex: 1, minWidth: 0 }} value={draft.preset ?? ''} onChange={(e) => setDraft({ ...draft, preset: e.target.value || undefined, vendor: e.target.value ? brand || undefined : undefined })}>
                <option value="">{translate("(none)")}</option>
                {draft.preset && !brandPresets.some((p) => p.name === draft.preset) && <option value={draft.preset}>{draft.preset}</option>}
                {brandPresets.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
              </select>
            </div>
          </Field>
          <Field label="Host type">
            <select id="pc-host-type" style={inputStyle} value={draft.host_type} onChange={(e) => {
              testGeneration.current++;
              cloudLoginAbort.current?.abort();
              cloudLoginAbort.current = null;
              setCloudDevices([]);
              setTesting(false);
              const type = e.target.value as HostType;
              setDraft((d) => ({ ...d, host_type: type, ...((type === 'prusaconnect' || type === 'bambu' || type === 'flashforge' || type === 'bambu-cloud' || type === 'creality-cloud') ? { use_gateway: true } : {}), ...(type === 'creality-cloud' ? { print_host: 'api.crealitycloud.com', cloud_region: 'global', printhost_user: undefined, printhost_apikey: undefined, serial: undefined, cloud_device_id: undefined } : {}), ...(type === 'bambu-cloud' ? { print_host: 'us.mqtt.bambulab.com' } : {}), ...(type === 'prusaconnect' ? { print_host: d.print_host || HOST_PLACEHOLDER.prusaconnect } : {}) }));
              setResult(null);
            }}>
              {(Object.keys(HOST_TYPE_LABELS) as HostType[]).map((t) => <option key={t} value={t}>{HOST_TYPE_LABELS[t]}</option>)}
            </select>
          </Field>
          {isCrealityCloud ? null : isBambuCloud ? (
            <Field label="Cloud Region" hint="Select the cloud region for your account.">
              <select id="pc-host" style={inputStyle} value={draft.print_host || 'us.mqtt.bambulab.com'} onChange={(e) => set('print_host', e.target.value)}>
                <option value="us.mqtt.bambulab.com">Global / US (us.mqtt.bambulab.com)</option>
                <option value="cn.mqtt.bambulab.com">China (cn.mqtt.bambulab.com)</option>
                <option value="mqtt.bambu-lab.com">Legacy (mqtt.bambu-lab.com)</option>
              </select>
            </Field>
          ) : (
            <Field label="Hostname, IP or URL" hint={isBambu ? 'The printer\'s IP address (LAN mode must be on).' : 'Where the printer\'s API answers. Moonraker is usually the same address as Fluidd/Mainsail.'}>
              <input id="pc-host" style={inputStyle} value={draft.print_host} onChange={(e) => set('print_host', e.target.value)} placeholder={HOST_PLACEHOLDER[draft.host_type]} />
            </Field>
          )}
          {!isBambu && !isBambuCloud && !isFlashforge && !isCloud && (
            <Field label="Device UI" hint="Address of the printer's web UI, shown in the Device tab. Leave empty to use the host.">
              <input id="pc-webui" style={inputStyle} value={draft.print_host_webui ?? ''} onChange={(e) => set('print_host_webui', e.target.value)} placeholder="http://192.168.0.10" />
            </Field>
          )}

          {isCrealityCloud && draft.serial && <Field label="Device"><span id="pc-creality-device">{draft.serial}</span></Field>}
          {isCrealityCloud ? (
            <CrealityCloudLogin key={`${draft.id}:${draft.local_gateway ?? ''}`} initialRegion={draft.cloud_region} gatewayTarget={{ local_gateway: draft.local_gateway }}
              onSelectDevice={(device, session, region) => {
                setDraft(d => ({ ...d, cloud_region: region, print_host: region === 'china' ? 'api.crealitycloud.cn' : 'api.crealitycloud.com',
                  printhost_user: session.userId, printhost_apikey: session.token, serial: device.dn, cloud_device_id: device.tbId }));
                setResult({ ok: true, text: device.name });
              }} />
          ) : isBambuCloud ? (
            <>
              <Field label="Account (Email)">
                <input id="pc-cloud-account" style={inputStyle} value={cloudAccount} onChange={(e) => set('cloud_account', e.target.value)} />
              </Field>
              <div style={{ display: 'flex', gap: 8 }}>
                <Field label="Password (or)">
                  <input id="pc-cloud-password" type="password" style={inputStyle} value={cloudPassword} onChange={(e) => { setCloudPassword(e.target.value); setCloudCode(''); }} />
                </Field>
                <Field label="Verification Code">
                  <input id="pc-cloud-code" type="text" style={inputStyle} value={cloudCode} onChange={(e) => { setCloudCode(e.target.value); setCloudPassword(''); }} />
                </Field>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 4, marginBottom: 8 }}>
                <button className="btn btn-secondary" onClick={loginToCloud} disabled={!cloudAccount || (!cloudPassword && !cloudCode) || testing}>
                  {translate('Log in / Get devices')}
                </button>
              </div>
              <Field label="Device">
                {cloudDevices.length > 0 ? (
                  <select id="pc-serial-select" style={inputStyle} value={draft.serial ?? ''} onChange={(e) => set('serial', e.target.value)}>
                    <option value="">{translate("(Select device)")}</option>
                    {cloudDevices.map(d => <option key={d.dev_id} value={d.dev_id}>{d.name} ({d.dev_id})</option>)}
                  </select>
                ) : (
                  <input id="pc-serial" style={inputStyle} value={draft.serial ?? ''} onChange={(e) => set('serial', e.target.value)} placeholder="Log in to see devices, or enter serial manually" />
                )}
              </Field>
            </>
          ) : (isBambu || isFlashforge) ? (
            <>
              <Field label="Serial number">
                <input id="pc-serial" style={inputStyle} value={draft.serial ?? ''} onChange={(e) => set('serial', e.target.value)} />
              </Field>
              <Field label="Access code"><input id="pc-apikey" style={inputStyle} type="password" value={draft.printhost_apikey ?? ''} onChange={(e) => set('printhost_apikey', e.target.value)} /></Field>
            </>
          ) : (
            <>
              <Field label="API key" hint={draft.host_type === 'moonraker' ? 'Only needed if Moonraker requires one. Printers on your network usually do not.' : undefined}>
                <input id="pc-apikey" style={inputStyle} type="password" value={draft.printhost_apikey ?? ''} onChange={(e) => set('printhost_apikey', e.target.value)} />
              </Field>
              {isPrusaLink && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <Field label="User"><input id="pc-user" style={inputStyle} value={draft.printhost_user ?? ''} onChange={(e) => set('printhost_user', e.target.value)} placeholder="maker" /></Field>
                  <Field label="Password"><input id="pc-password" style={inputStyle} type="password" value={draft.printhost_password ?? ''} onChange={(e) => set('printhost_password', e.target.value)} /></Field>
                </div>
              )}
            </>
          )}

          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12 }}>
            <input id="pc-gateway" type="checkbox" checked={draft.use_gateway || isBambu || isFlashforge || isCloud} disabled={isBambu || isFlashforge || isCloud} onChange={(e) => set('use_gateway', e.target.checked)} />
            <span>
              {translate("Connect through this app's server (gateway)")}
              <br /><span id="pc-gateway-status" style={{ color: 'var(--text-muted, #a0a0a0)', fontSize: 11 }}>{translate(gatewayNote)}</span>
            </span>
          </label>
          {(draft.use_gateway || isBambu || isFlashforge || isCloud) && (
            <>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }}>
                <input id="pc-local-gateway" type="checkbox" checked={draft.local_gateway !== undefined} onChange={(e) => set('local_gateway', e.target.checked ? DEFAULT_LOCAL_GATEWAY : undefined)} />
                <span>Use the gateway program on this computer instead (for a printer the app server cannot reach)</span>
              </label>
              {draft.local_gateway !== undefined && (
                <Field label="Local gateway address" hint={`Run: node orca-gateway.mjs --allow-origin ${window.location.origin} (download it from ${window.location.origin}/orca-gateway.mjs). The browser asks once to allow access to your local network.`}>
                  <input id="pc-local-gateway-url" style={inputStyle} value={draft.local_gateway} onChange={(e) => set('local_gateway', e.target.value)} />
                </Field>
              )}
            </>
          )}
          <div style={{ color: 'var(--text-muted, #a0a0a0)', fontSize: 11 }}>
            {translate('The API key and passwords are stored in this browser only.')}
          </div>

          {result && (
            <div id="pc-test-result" data-ok={result.ok} style={{ color: result.ok ? '#81c784' : '#ef9a9a', fontSize: 12 }}>
              {result.ok ? '✓ ' : '✗ '}{translate(result.text)}
            </div>
          )}
          {error && <div id="pc-validation" style={{ color: '#ffb74d', fontSize: 12 }}>{translate(error)}</div>}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
            {printers.some((p) => p.id === draft.id) && (
              <button className="btn btn-secondary" id="pc-delete" style={{ marginRight: 'auto' }} onClick={() => { deletePrinter(draft.id); closeDialog(); }}>{translate("Delete")}</button>
            )}
            <button className="btn btn-secondary" id="pc-test" onClick={test} disabled={!!error || testing}>{translate(testing ? 'Testing...' : 'Test connection')}</button>
            <button className="btn btn-secondary" id="pc-cancel" onClick={closeDialog}>{translate("Cancel")}</button>
            <button className="btn btn-primary" id="pc-save" onClick={save} disabled={!!error}>{translate("Save")}</button>
          </div>
        </div>
      </div>
    </ModalBackdrop>
  );
};
