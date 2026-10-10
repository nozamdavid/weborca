import React, { useEffect, useState } from 'react';
import { useAppStore } from '../store/appStore';
import { createPrinterApi } from './api';
import { usePrinterConnectionStore } from './connectionStore';
import type { GatewayStatus } from './gatewayUrl';
import { DEFAULT_LOCAL_GATEWAY, fetchGatewayStatus, parseHost } from './gatewayUrl';
import type { HostType, PhysicalPrinter } from './types';
import { HOST_TYPE_LABELS } from './types';

const HOST_PLACEHOLDER: Record<HostType, string> = {
  moonraker: '192.168.0.10 or http://printer.local',
  prusalink: '192.168.0.20',
  octoprint: 'http://octopi.local',
  prusaconnect: 'https://connect.prusa3d.com',
  bambu: '192.168.0.30'
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
  if (p.host_type === 'bambu') {
    if (!p.serial?.trim()) return 'Enter the printer\'s serial number (Settings > Device on the printer).';
    if (!p.printhost_apikey?.trim()) return 'Enter the access code shown on the printer\'s LAN settings.';
  }
  if (p.host_type === 'prusaconnect' && !p.printhost_apikey?.trim()) return 'Enter the API key from your printer\'s page in Prusa Connect.';
  return undefined;
}

const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
  <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12 }}>
    <span>{label}</span>
    {children}
    {hint && <span style={{ color: 'var(--text-muted, #a0a0a0)', fontSize: 11 }}>{hint}</span>}
  </label>
);

const inputStyle: React.CSSProperties = {
  background: 'var(--control-bg, #3a3a3a)', color: 'inherit', border: '1px solid var(--border-color, #444)', borderRadius: 4, padding: '5px 8px'
};

/** Add, edit and test physical printers, like desktop's "Physical Printer" dialog. */
export const PrinterConnectionDialog: React.FC = () => {
  const { dialogOpen, editingId, printers, savePrinter, deletePrinter, closeDialog } = usePrinterConnectionStore();
  const presets = useAppStore((s) => s.printers);
  const selectedPreset = useAppStore((s) => s.selectedPrinter);
  const [draft, setDraft] = useState<PhysicalPrinter>(blank);
  const [gateway, setGateway] = useState<GatewayStatus | null | undefined>(undefined);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (!dialogOpen) return;
    const existing = printers.find((p) => p.id === editingId);
    setDraft(existing ?? { ...blank(), preset: selectedPreset || undefined });
    setResult(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialogOpen, editingId]);

  const localBase = draft.use_gateway || draft.host_type === 'bambu' || draft.host_type === 'prusaconnect' ? draft.local_gateway : undefined;
  useEffect(() => {
    if (!dialogOpen) return;
    setGateway(undefined);
    fetchGatewayStatus(localBase).then((s) => setGateway(s ?? null));
  }, [dialogOpen, localBase]);

  if (!dialogOpen) return null;

  const set = <K extends keyof PhysicalPrinter>(key: K, value: PhysicalPrinter[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setResult(null);
  };
  const error = validate(draft);
  const isBambu = draft.host_type === 'bambu';
  const isPrusaLink = draft.host_type === 'prusalink';
  const isCloud = draft.host_type === 'prusaconnect';

  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      setResult({ ok: true, text: await createPrinterApi(draft).test() });
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  };

  const save = () => {
    savePrinter({ ...draft, name: draft.name.trim(), print_host: draft.print_host.trim() });
    closeDialog();
  };

  const gatewayNote = gateway === undefined ? 'Checking the gateway...'
    : gateway === null ? (localBase ? 'The gateway on this computer did not answer.' : 'This server has no printer gateway.')
    : !gateway.enabled ? gateway.message ?? 'The printer gateway is off.'
    : isCloud && !gateway.cloud?.includes('prusa-connect') ? 'This gateway does not allow Prusa Connect. Start it with --cloud prusa-connect (or ORCA_PRINTER_CLOUD=prusa-connect).'
    : `Gateway on: ${gateway.mode === 'private' ? 'private networks only' : gateway.mode === 'cloud' ? 'cloud services only' : 'listed hosts only'}${gateway.readOnly ? ', read-only' : ''}.`;

  return (
    <div className="modal-backdrop" id="printer-connection-dialog" role="dialog" aria-label="Printer connection">
      <div className="modal-content" style={{ width: 'min(760px, 94vw)', display: 'flex', gap: 16, maxHeight: '90vh', overflow: 'auto' }}>
        <div style={{ flex: '0 0 170px', display: 'flex', flexDirection: 'column', gap: 6, borderRight: '1px solid var(--border-color, #444)', paddingRight: 12 }}>
          <strong style={{ fontSize: 12 }}>Printers</strong>
          {printers.map((p) => (
            <button key={p.id} className={`btn ${p.id === draft.id ? 'btn-primary' : 'btn-secondary'}`} style={{ textAlign: 'left' }} onClick={() => usePrinterConnectionStore.getState().openDialog(p.id)}>
              {p.name}
            </button>
          ))}
          <button className="btn btn-secondary" id="pc-add" onClick={() => usePrinterConnectionStore.getState().openDialog(null)}>+ New printer</button>
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
          <h3 style={{ margin: 0 }}>{printers.some((p) => p.id === draft.id) ? 'Edit printer' : 'Add a printer'}</h3>

          <Field label="Name">
            <input id="pc-name" style={inputStyle} value={draft.name} onChange={(e) => set('name', e.target.value)} placeholder="My Voron" />
          </Field>
          <Field label="Printer preset" hint="The slicer's printer profile this machine uses.">
            <select id="pc-preset" style={inputStyle} value={draft.preset ?? ''} onChange={(e) => set('preset', e.target.value || undefined)}>
              <option value="">(none)</option>
              {presets.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Host type">
            <select id="pc-host-type" style={inputStyle} value={draft.host_type} onChange={(e) => {
              const type = e.target.value as HostType;
              setDraft((d) => ({ ...d, host_type: type, ...(type === 'prusaconnect' ? { use_gateway: true, print_host: d.print_host || HOST_PLACEHOLDER.prusaconnect } : {}) }));
              setResult(null);
            }}>
              {(Object.keys(HOST_TYPE_LABELS) as HostType[]).map((t) => <option key={t} value={t}>{HOST_TYPE_LABELS[t]}</option>)}
            </select>
          </Field>
          <Field label="Hostname, IP or URL" hint={isBambu ? 'The printer\'s IP address (LAN mode must be on).' : 'Where the printer\'s API answers. Moonraker is usually the same address as Fluidd/Mainsail.'}>
            <input id="pc-host" style={inputStyle} value={draft.print_host} onChange={(e) => set('print_host', e.target.value)} placeholder={HOST_PLACEHOLDER[draft.host_type]} />
          </Field>
          {!isBambu && !isCloud && (
            <Field label="Device UI" hint="Address of the printer's web UI, shown in the Device tab. Leave empty to use the host.">
              <input id="pc-webui" style={inputStyle} value={draft.print_host_webui ?? ''} onChange={(e) => set('print_host_webui', e.target.value)} placeholder="http://192.168.0.10" />
            </Field>
          )}

          {isBambu ? (
            <>
              <Field label="Serial number"><input id="pc-serial" style={inputStyle} value={draft.serial ?? ''} onChange={(e) => set('serial', e.target.value)} /></Field>
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
            <input id="pc-gateway" type="checkbox" checked={draft.use_gateway || isBambu || isCloud} disabled={isBambu || isCloud} onChange={(e) => set('use_gateway', e.target.checked)} />
            <span>
              Connect through this app's server (gateway)
              <br /><span id="pc-gateway-status" style={{ color: 'var(--text-muted, #a0a0a0)', fontSize: 11 }}>{gatewayNote}</span>
            </span>
          </label>
          {(draft.use_gateway || isBambu || isCloud) && (
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
            The API key and passwords are stored in this browser only.
          </div>

          {result && (
            <div id="pc-test-result" data-ok={result.ok} style={{ color: result.ok ? '#81c784' : '#ef9a9a', fontSize: 12 }}>
              {result.ok ? '✓ ' : '✗ '}{result.text}
            </div>
          )}
          {error && <div id="pc-validation" style={{ color: '#ffb74d', fontSize: 12 }}>{error}</div>}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
            {printers.some((p) => p.id === draft.id) && (
              <button className="btn btn-secondary" id="pc-delete" style={{ marginRight: 'auto' }} onClick={() => { deletePrinter(draft.id); closeDialog(); }}>Delete</button>
            )}
            <button className="btn btn-secondary" id="pc-test" onClick={test} disabled={!!error || testing}>{testing ? 'Testing...' : 'Test connection'}</button>
            <button className="btn btn-secondary" id="pc-cancel" onClick={closeDialog}>Cancel</button>
            <button className="btn btn-primary" id="pc-save" onClick={save} disabled={!!error}>Save</button>
          </div>
        </div>
      </div>
    </div>
  );
};
