import React, { useEffect, useMemo, useState } from 'react';
import { getCompatiblePresets, listPresets, loadVendors } from '../engine/orcaEngine';
import type { PresetItem } from '../engine/types';
import { useAppStore } from '../store/appStore';
import './wizard.css';
import { useWizardStore } from './wizardStore';

const FILAMENT_TYPES = [
  'PLA-CF', 'PETG-CF', 'PA-CF', 'ABS-GF', 'PETG-Metal', 'PLA+', 'PLA',
  'PETG', 'ABS', 'ASA', 'TPU', 'PC', 'PA', 'PVA', 'HIPS', 'BVOH', 'PP'
];

function safeId(str: string): string {
  return str.replace(/[^a-zA-Z0-9_-]/g, '-');
}

function parseFilament(p: PresetItem) {
  const clean = p.name.replace(/@.*$/, '').trim();
  const matchedType = FILAMENT_TYPES.find((t) =>
    new RegExp(`\\b${t.replace('+', '\\+').replace('-', '\\-')}\\b`, 'i').test(clean)
  ) || 'Other';
  let vendor = p.vendor;
  if (!vendor || vendor === 'OrcaFilamentLibrary' || vendor === 'System') {
    vendor = clean.split(' ')[0] || 'Generic';
  }
  return {
    name: p.name,
    vendor,
    type: matchedType
  };
}

export const WizardDialog: React.FC = () => {
  const open = useWizardStore((s) => s.open);
  const setOpen = useWizardStore((s) => s.setOpen);
  const step = useWizardStore((s) => s.step);
  const setStep = useWizardStore((s) => s.setStep);
  const selectedVendor = useWizardStore((s) => s.selectedVendor);
  const setSelectedVendor = useWizardStore((s) => s.setSelectedVendor);
  const selectedPrinters = useWizardStore((s) => s.selectedPrinters);
  const togglePrinter = useWizardStore((s) => s.togglePrinter);
  const selectedFilaments = useWizardStore((s) => s.selectedFilaments);
  const toggleFilament = useWizardStore((s) => s.toggleFilament);
  const selectAllFilaments = useWizardStore((s) => s.selectAllFilaments);
  const selectNoneFilaments = useWizardStore((s) => s.selectNoneFilaments);

  const vendors = useAppStore((s) => s.vendors);
  const isEngineReady = useAppStore((s) => s.isEngineReady);

  const [hasAutoChecked, setHasAutoChecked] = useState(false);
  const [vendorPrinters, setVendorPrinters] = useState<PresetItem[]>([]);
  const [printerSearch, setPrinterSearch] = useState('');
  const [compatibleFilaments, setCompatibleFilaments] = useState<PresetItem[]>([]);
  const [filamentSearch, setFilamentSearch] = useState('');
  const [isFinishing, setIsFinishing] = useState(false);

  // Auto-open on first run (no 'orca.wizard' key and no saved prefs)
  // Skip when navigator.webdriver is true (automated tests)
  useEffect(() => {
    if (!isEngineReady || hasAutoChecked) return;
    setHasAutoChecked(true);
    if (typeof navigator !== 'undefined' && navigator.webdriver) return;
    try {
      if (typeof localStorage !== 'undefined') {
        const hasWizard = !!localStorage.getItem('orca.wizard');
        const hasPrefs = !!localStorage.getItem('orcaslicer_preferences_v1');
        if (!hasWizard && !hasPrefs) {
          setOpen(true);
        }
      }
    } catch (_) {}
  }, [isEngineReady, hasAutoChecked, setOpen]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  // Load printer presets whenever vendor changes in Step 1
  useEffect(() => {
    if (!open || !selectedVendor) return;
    let cancelled = false;
    (async () => {
      try {
        await loadVendors([selectedVendor]);
        const list = await listPresets('printer', { compatibleOnly: false });
        if (cancelled) return;
        const filtered = list.filter(
          (p) =>
            !p.vendor ||
            p.vendor === selectedVendor ||
            (selectedVendor === 'Voron' && p.name.includes('Voron')) ||
            (selectedVendor === 'BBL' && (p.name.includes('Bambu') || p.name.includes('BBL'))) ||
            (selectedVendor === 'Prusa' && p.name.includes('Prusa'))
        );
        setVendorPrinters(filtered.length > 0 ? filtered : list);
      } catch (err) {
        console.error('Failed to load vendor printers:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, selectedVendor]);

  // Load compatible filaments when entering Step 2
  useEffect(() => {
    if (!open || step !== 2) return;
    let cancelled = false;
    (async () => {
      try {
        const printer = selectedPrinters[0] || useAppStore.getState().selectedPrinter;
        let compNames: string[] = [];
        if (printer) {
          try {
            const res = await getCompatiblePresets({ printer });
            compNames = res.compatibleFilaments || [];
          } catch (_) {}
        }
        let list = await listPresets('filament', { compatibleOnly: false });
        if (compNames.length > 0) {
          const set = new Set(compNames);
          list = list.filter((f) => set.has(f.name));
        } else {
          const compOnly = await listPresets('filament', { compatibleOnly: true });
          if (compOnly.length > 0) list = compOnly;
        }
        if (!cancelled) {
          setCompatibleFilaments(list);
          // If no filaments selected yet, pre-select compatible ones or generic
          if (selectedFilaments.length === 0 && list.length > 0) {
            const defaults = list.filter((f) => f.name.includes('Generic')).map((f) => f.name);
            selectAllFilaments(defaults.length > 0 ? defaults : list.slice(0, 5).map((f) => f.name));
          }
        }
      } catch (err) {
        console.error('Failed to load compatible filaments:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, step, selectedPrinters, selectAllFilaments]); // eslint-disable-line react-hooks/exhaustive-deps

  // Group printers by Model
  const printerModels = useMemo(() => {
    const q = printerSearch.trim().toLowerCase();
    const map = new Map<string, Array<{ presetName: string; nozzleLabel: string }>>();
    for (const p of vendorPrinters) {
      if (q && !p.name.toLowerCase().includes(q)) continue;
      const match = p.name.match(/^(.*?)\s+\(?((?:HF\s*)?[\d\.]+\s*nozzle[^)]*)\)?$/i);
      const model = match ? match[1].trim() : p.name;
      const nozzle = match ? match[2].trim() : '0.4 nozzle';
      if (!map.has(model)) map.set(model, []);
      map.get(model)!.push({ presetName: p.name, nozzleLabel: nozzle });
    }
    return Array.from(map.entries()).map(([modelName, nozzles]) => ({
      modelName,
      nozzles
    }));
  }, [vendorPrinters, printerSearch]);

  // Group filaments by Vendor
  const filamentGroups = useMemo(() => {
    const q = filamentSearch.trim().toLowerCase();
    const map = new Map<string, Array<{ name: string; vendor: string; type: string }>>();
    for (const f of compatibleFilaments) {
      const parsed = parseFilament(f);
      if (
        q &&
        !parsed.name.toLowerCase().includes(q) &&
        !parsed.vendor.toLowerCase().includes(q) &&
        !parsed.type.toLowerCase().includes(q)
      ) {
        continue;
      }
      if (!map.has(parsed.vendor)) map.set(parsed.vendor, []);
      map.get(parsed.vendor)!.push(parsed);
    }
    const entries = Array.from(map.entries());
    entries.sort((a, b) => {
      if (a[0] === 'Generic') return -1;
      if (b[0] === 'Generic') return 1;
      return a[0].localeCompare(b[0]);
    });
    return entries;
  }, [compatibleFilaments, filamentSearch]);

  const allVisibleFilamentNames = useMemo(() => {
    return filamentGroups.flatMap(([, items]) => items.map((i) => i.name));
  }, [filamentGroups]);

  const handleFinish = async () => {
    setIsFinishing(true);
    try {
      const wizardData = {
        printers: selectedPrinters,
        filaments: selectedFilaments,
        completedAt: new Date().toISOString()
      };
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('orca.wizard', JSON.stringify(wizardData));
      }
      useWizardStore.getState().setAddedPrinters(selectedPrinters);

      const firstPrinter = selectedPrinters[0];
      if (firstPrinter) {
        let vendorToUse = selectedVendor;
        const found = vendorPrinters.find((p) => p.name === firstPrinter);
        if (found?.vendor) {
          vendorToUse = found.vendor;
        } else if (firstPrinter.includes('Voron')) {
          vendorToUse = 'Voron';
        } else if (firstPrinter.includes('Bambu') || firstPrinter.includes('BBL')) {
          vendorToUse = 'BBL';
        } else if (firstPrinter.includes('Prusa')) {
          vendorToUse = 'Prusa';
        }

        if (vendorToUse && useAppStore.getState().selectedVendor !== vendorToUse) {
          await useAppStore.getState().chooseVendor(vendorToUse);
        }
        await useAppStore.getState().choosePrinter(firstPrinter);
      }

      if (selectedFilaments.length > 0) {
        await useAppStore.getState().chooseFilament(selectedFilaments[0], 0);
      }

      setOpen(false);
    } catch (err) {
      console.error('Wizard finish error:', err);
    } finally {
      setIsFinishing(false);
    }
  };

  if (!open) return null;

  return (
    <div className="modal-backdrop" id="wizard-dialog" role="dialog" aria-label="Configuration wizard">
      <div className="wizard-modal">
        {/* Header */}
        <div className="wizard-header">
          <h3>Configuration Wizard</h3>
          <button
            id="wizard-close-x"
            className="modal-close-btn"
            onClick={() => setOpen(false)}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Steps indicator */}
        <div className="wizard-steps-bar" id="wizard-step-indicator">
          <div className={`wizard-step-pill ${step === 1 ? 'active' : step > 1 ? 'completed' : ''}`}>
            <span>1</span> Printers & Nozzles
          </div>
          <span style={{ color: '#555' }}>›</span>
          <div className={`wizard-step-pill ${step === 2 ? 'active' : step > 2 ? 'completed' : ''}`}>
            <span>2</span> Filaments
          </div>
          <span style={{ color: '#555' }}>›</span>
          <div className={`wizard-step-pill ${step === 3 ? 'active' : ''}`}>
            <span>3</span> Summary
          </div>
        </div>

        {/* Step 1: Printers & Nozzles */}
        {step === 1 && (
          <div className="wizard-body" id="wizard-step-1">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 600 }}>Select Printer Brand</label>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <select
                  id="wizard-vendor-select"
                  aria-label="Printer Brand"
                  value={selectedVendor}
                  onChange={(e) => setSelectedVendor(e.target.value)}
                  style={{ minWidth: 160, padding: '6px 10px', background: '#27272a', color: '#fff', border: '1px solid #444', borderRadius: 4 }}
                >
                  {vendors.map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name}
                    </option>
                  ))}
                </select>
                {vendors.length <= 8 && <div className="wizard-vendor-tabs">
                  {vendors.map((v) => (
                    <button
                      key={v.name}
                      type="button"
                      id={`wizard-vendor-tab-${v.name}`}
                      className={`wizard-vendor-btn ${selectedVendor === v.name ? 'active' : ''}`}
                      onClick={() => setSelectedVendor(v.name)}
                    >
                      {v.name}
                    </button>
                  ))}
                </div>}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <input
                id="wizard-printer-search"
                type="search"
                className="wizard-search-box"
                placeholder="Filter models or nozzle sizes..."
                value={printerSearch}
                onChange={(e) => setPrinterSearch(e.target.value)}
              />
              <span style={{ fontSize: 12, color: '#aaa', whiteSpace: 'nowrap' }}>
                {selectedPrinters.length} selected
              </span>
            </div>

            <div className="wizard-models-grid">
              {printerModels.map(({ modelName, nozzles }) => (
                <div key={modelName} className="wizard-model-card">
                  <img
                    className="wizard-model-img"
                    src={`/profiles/covers/${encodeURIComponent(selectedVendor)}/${encodeURIComponent(modelName)}_cover.png`}
                    alt={modelName}
                    loading="lazy"
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  />
                  <div className="wizard-model-title">{modelName}</div>
                  <div className="wizard-nozzle-options">
                    {nozzles.map(({ presetName, nozzleLabel }) => {
                      const id = `wizard-printer-${safeId(presetName)}`;
                      const checked = selectedPrinters.includes(presetName);
                      return (
                        <label
                          key={presetName}
                          htmlFor={id}
                          className="wizard-nozzle-item"
                          title={presetName}
                        >
                          <input
                            type="checkbox"
                            id={id}
                            value={presetName}
                            checked={checked}
                            onChange={() => togglePrinter(presetName)}
                          />
                          <span style={{ fontWeight: 500 }}>{presetName}</span>
                          <span className="wizard-type-tag">{nozzleLabel}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Step 2: Filament Curation */}
        {step === 2 && (
          <div className="wizard-body" id="wizard-step-2">
            <div className="wizard-toolbar">
              <input
                id="wizard-filament-search"
                type="search"
                className="wizard-search-box"
                style={{ maxWidth: 360 }}
                placeholder="Search filaments (name, brand, material)..."
                value={filamentSearch}
                onChange={(e) => setFilamentSearch(e.target.value)}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  id="wizard-filament-select-all"
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => selectAllFilaments(allVisibleFilamentNames)}
                >
                  Select All
                </button>
                <button
                  id="wizard-filament-select-none"
                  type="button"
                  className="btn btn-secondary"
                  onClick={selectNoneFilaments}
                >
                  Select None
                </button>
                <span style={{ fontSize: 12, color: '#aaa', marginLeft: 6 }}>
                  {selectedFilaments.length} selected
                </span>
              </div>
            </div>

            <div className="wizard-filament-sections">
              {filamentGroups.map(([vendor, items]) => (
                <div key={vendor} className="wizard-vendor-group">
                  <div className="wizard-vendor-group-title">
                    <span>{vendor}</span>
                    <span style={{ fontSize: 11, color: '#999' }}>{items.length} presets</span>
                  </div>
                  <div className="wizard-filament-list">
                    {items.map((item) => {
                      const id = `wizard-filament-${safeId(item.name)}`;
                      const checked = selectedFilaments.includes(item.name);
                      return (
                        <label key={item.name} htmlFor={id} className="wizard-filament-item" title={item.name}>
                          <input
                            type="checkbox"
                            id={id}
                            value={item.name}
                            checked={checked}
                            onChange={() => toggleFilament(item.name)}
                          />
                          <span className="wizard-filament-name">{item.name}</span>
                          <span className="wizard-type-tag">{item.type}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Step 3: Summary */}
        {step === 3 && (
          <div className="wizard-body" id="wizard-step-3">
            <div className="wizard-summary-card">
              <div className="wizard-summary-title">Printers to Install</div>
              {selectedPrinters.length === 0 ? (
                <div style={{ color: '#a0a0a0', fontSize: 13 }}>No printers selected.</div>
              ) : (
                <div className="wizard-summary-list">
                  {selectedPrinters.map((p, idx) => (
                    <div key={p}>
                      {idx === 0 ? '★ ' : '• '} {p} {idx === 0 ? '(Default)' : ''}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="wizard-summary-card">
              <div className="wizard-summary-title">
                Curated Filaments ({selectedFilaments.length})
              </div>
              {selectedFilaments.length === 0 ? (
                <div style={{ color: '#a0a0a0', fontSize: 13 }}>No filaments selected.</div>
              ) : (
                <div className="wizard-summary-list">
                  {selectedFilaments.map((f, idx) => (
                    <div key={f}>
                      {idx === 0 ? '★ ' : '• '} {f} {idx === 0 ? '(Default)' : ''}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
              Clicking <strong>Finish</strong> will apply the first selected printer and filament to your workspace,
              and save your configuration choices.
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="wizard-footer">
          <button
            id="wizard-cancel-btn"
            type="button"
            className="btn btn-secondary"
            onClick={() => setOpen(false)}
          >
            Cancel
          </button>
          <div className="wizard-footer-right">
            {step > 1 && (
              <button
                id="wizard-back-btn"
                type="button"
                className="btn btn-secondary"
                onClick={() => setStep((step - 1) as 1 | 2 | 3)}
              >
                Back
              </button>
            )}
            {step < 3 && (
              <button
                id="wizard-next-btn"
                type="button"
                className="btn btn-primary"
                onClick={() => setStep((step + 1) as 1 | 2 | 3)}
                disabled={step === 1 && selectedPrinters.length === 0}
              >
                Next
              </button>
            )}
            {step === 3 && (
              <button
                id="wizard-finish-btn"
                type="button"
                className="btn btn-primary"
                onClick={handleFinish}
                disabled={isFinishing || selectedPrinters.length === 0}
              >
                {isFinishing ? 'Applying...' : 'Finish'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
