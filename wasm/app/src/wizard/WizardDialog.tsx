import { MobileInput } from '../mobile/MobileInput';
import { MobileSelect } from '../mobile/MobileSelect';
import React, { useEffect, useMemo, useState } from 'react';
import { getCompatiblePresets, listPresets, loadVendors } from '../engine/orcaEngine';
import type { PresetItem } from '../engine/types';
import { useAppStore } from '../store/appStore';
import './wizard.css';
import { useWizardStore } from './wizardStore';
import { Dialog } from '../components/Dialog';
import { useTranslation } from "../i18n";
import { generateCircularPrintableArea, validatePolygon } from './polygonValidation';
import { openCloudAccount } from '../orcaCloud/account';
import { loadPrinterCatalog, usePrinterCatalog } from '../presets/printerCatalog';

const FILAMENT_TYPES = [
  'PLA-CF', 'PETG-CF', 'PA-CF', 'ABS-GF', 'PETG-Metal', 'PLA+', 'PLA',
  'PETG', 'ABS', 'ASA', 'TPU', 'PC', 'PA', 'PVA', 'HIPS', 'BVOH', 'PP'
];

function safeId(str: string): string {
  return str.replace(/[^a-zA-Z0-9_-]/g, '-');
}

/** Per-build id: the hashed entry chunk changes with every deployment, so a
 * dismissal recorded for one build does not suppress the wizard on the next. */
function deploymentId(): string {
  if (typeof document === 'undefined') return 'ssr';
  const src = document.querySelector('script[type="module"][src]')?.getAttribute('src') || '';
  return src.match(/assets\/[A-Za-z0-9_.-]+-([A-Za-z0-9_-]+)\.(?:js|mjs)/)?.[1] || 'dev';
}

const WIZARD_DISMISSED_KEY = 'orca.wizard-dismissed';

function recordDismissal() {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(WIZARD_DISMISSED_KEY, JSON.stringify({ deployment: deploymentId(), dismissedAt: new Date().toISOString() }));
  } catch (_) {}
}

function dismissedForThisDeployment(): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    const record: unknown = JSON.parse(localStorage.getItem(WIZARD_DISMISSED_KEY) || 'null');
    return !!record && typeof record === 'object' && (record as { deployment?: string }).deployment === deploymentId();
  } catch (_) { return false; }
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

export const WizardDialog: React.FC<{ autoOpen?: boolean }> = ({ autoOpen = true }) => {
  const { t } = useTranslation();
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

  const { vendors, loading: catalogLoading, error: catalogError } = usePrinterCatalog();
  const isEngineReady = useAppStore((s) => s.isEngineReady);

  const [hasAutoChecked, setHasAutoChecked] = useState(false);
  const [vendorPrinters, setVendorPrinters] = useState<PresetItem[]>([]);
  const [printerSearch, setPrinterSearch] = useState('');
  const [compatibleFilaments, setCompatibleFilaments] = useState<PresetItem[]>([]);
  const [filamentSearch, setFilamentSearch] = useState('');
  const [customPrinter, setCustomPrinter] = useState(false);
  const [customName, setCustomName] = useState('My custom printer');
  const [customSize, setCustomSize] = useState({ x: 220, y: 220, z: 250, nozzle: 0.4 });
  const [customShape, setCustomShape] = useState<'rectangular' | 'circular' | 'polygonal'>('rectangular');
  const [customPolygon, setCustomPolygon] = useState('0x0,220x0,220x220,0x220');
  const [customFlavor, setCustomFlavor] = useState('klipper');
  const [finishError, setFinishError] = useState('');
  const [isFinishing, setIsFinishing] = useState(false);

  useEffect(() => { if (open) void loadPrinterCatalog().catch(() => {}); }, [open]);

  const handleClose = () => {
    setFinishError('');
    setIsFinishing(false);
    setCustomPrinter(false);
    setCustomShape('rectangular');
    setCustomName('My custom printer');
    setCustomSize({ x: 220, y: 220, z: 250, nozzle: 0.4 });
    setCustomPolygon('0x0,220x0,220x220,0x220');
    recordDismissal();
    setOpen(false);
  };

  // Auto-open on first run (no 'orca.wizard' key and no saved prefs)
  // Skip when navigator.webdriver is true (automated tests)
  useEffect(() => {
    if (!autoOpen || !isEngineReady || hasAutoChecked) return;
    setHasAutoChecked(true);
    if (typeof navigator !== 'undefined' && navigator.webdriver) return;
    try {
      if (typeof localStorage !== 'undefined') {
        const hasWizard = !!localStorage.getItem('orca.wizard');
        const hasPrefs = !!localStorage.getItem('orcaslicer_preferences_v1');
        if (!hasWizard && !hasPrefs && !dismissedForThisDeployment()) {
          setOpen(true);
        }
      }
    } catch (_) {}
  }, [autoOpen, isEngineReady, hasAutoChecked, setOpen]);

  // Load printer presets whenever vendor changes in Step 1
  useEffect(() => {
    if (!open || !selectedVendor || !isEngineReady) return;
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
  }, [open, selectedVendor, isEngineReady]);

  // Load compatible filaments when entering Step 2
  useEffect(() => {
    if (!open || step !== 2 || !isEngineReady) return;
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
  }, [open, step, selectedPrinters, selectAllFilaments, isEngineReady]); // eslint-disable-line react-hooks/exhaustive-deps

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
    setFinishError('');
    try {
      let areaStr = '';
      if (customPrinter) {
        if (!customName.trim()) throw new Error(t('Enter a printer name.'));
        if (!Number.isFinite(customSize.z) || customSize.z <= 0) throw new Error(t('Enter a positive build height.'));
        if (!Number.isFinite(customSize.nozzle) || customSize.nozzle <= 0) throw new Error(t('Enter a positive nozzle diameter.'));

        if (customShape === 'rectangular') {
          if (!Number.isFinite(customSize.x) || customSize.x <= 0 || !Number.isFinite(customSize.y) || customSize.y <= 0) {
            throw new Error(t('Enter positive dimensions for X and Y.'));
          }
          areaStr = `0x0,${customSize.x}x0,${customSize.x}x${customSize.y},0x${customSize.y}`;
        } else if (customShape === 'circular') {
          if (!Number.isFinite(customSize.x) || customSize.x <= 0) {
            throw new Error(t('Enter a positive diameter.'));
          }
          areaStr = generateCircularPrintableArea(customSize.x);
        } else if (customShape === 'polygonal') {
          const polyRes = validatePolygon(customPolygon);
          if (!polyRes.valid) {
            throw new Error(t(polyRes.error!));
          }
          areaStr = polyRes.areaStr!;
        }
      }

      if (!customPrinter) {
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
      } else if (selectedPrinters.length > 0) {
        const basePrinter = selectedPrinters[0];
        let vendorToUse = selectedVendor;
        const found = vendorPrinters.find((p) => p.name === basePrinter);
        if (found?.vendor) {
          vendorToUse = found.vendor;
        } else if (basePrinter.includes('Voron')) {
          vendorToUse = 'Voron';
        } else if (basePrinter.includes('Bambu') || basePrinter.includes('BBL')) {
          vendorToUse = 'BBL';
        } else if (basePrinter.includes('Prusa')) {
          vendorToUse = 'Prusa';
        }

        if (vendorToUse && useAppStore.getState().selectedVendor !== vendorToUse) {
          await useAppStore.getState().chooseVendor(vendorToUse);
        }
        await useAppStore.getState().choosePrinter(basePrinter);
      }

      if (customPrinter) {
        const app = useAppStore.getState();
        await app.applyOptionChange('printable_area', areaStr, 'printer');
        await app.applyOptionChange('printable_height', String(customSize.z), 'printer');
        await app.applyOptionChange('nozzle_diameter', String(customSize.nozzle), 'printer');
        await app.applyOptionChange('gcode_flavor', customFlavor, 'printer');
        if (useAppStore.getState().engineError) throw new Error(useAppStore.getState().engineError || 'Could not configure printer');
        await app.saveCurrentUserPreset('printer', customName.trim());
        if (useAppStore.getState().engineError) throw new Error(useAppStore.getState().engineError!);
      }
      if (selectedFilaments.length > 0) {
        await useAppStore.getState().chooseFilament(selectedFilaments[0], 0);
      }

      const wizardData = {
        printers: selectedPrinters,
        filaments: selectedFilaments,
        completedAt: new Date().toISOString()
      };
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('orca.wizard', JSON.stringify(wizardData));
      }
      useWizardStore.getState().setAddedPrinters(selectedPrinters);
      useWizardStore.getState().setAddedFilaments(selectedFilaments);

      handleClose();
    } catch (err) {
      setFinishError(err instanceof Error ? err.message : String(err));
      console.error('Wizard finish error:', err);
    } finally {
      setIsFinishing(false);
    }
  };

  if (!open) return null;

  return (
    <Dialog className="ds-scrim" onClose={handleClose} id="wizard-dialog" role="dialog" aria-modal="true" aria-label={t("Configuration wizard")}>
      <div className="wizard-modal ds-dialog ds-dialog--lg">
        {/* Header */}
        <div className="wizard-header ds-dialog__head">
          <h2 className="ds-title ds-title--dialog">{t("Configuration Wizard")}</h2>
          <button
            id="wizard-close-x"
            className="ds-btn ds-btn--icon"
            onClick={handleClose}
            aria-label={t("Close")}
          >
            ✕
          </button>
        </div>

        {/* Steps indicator */}
        <div className="wizard-steps-bar" id="wizard-step-indicator">
          <div className={`wizard-step-pill ${step === 1 ? 'active' : step > 1 ? 'completed' : ''}`}>
            <span>1</span> {t("Printers & Nozzles")}</div>
          <span style={{ color: 'var(--text-secondary)' }}>›</span>
          <div className={`wizard-step-pill ${step === 2 ? 'active' : step > 2 ? 'completed' : ''}`}>
            <span>2</span> {t("Filaments")}</div>
          <span style={{ color: 'var(--text-secondary)' }}>›</span>
          <div className={`wizard-step-pill ${step === 3 ? 'active' : ''}`}>
            <span>3</span> {t("Summary")}</div>
        </div>

        {finishError && <p id="wizard-error" role="alert" className="wizard-error" style={{ color: 'var(--danger-fg)', margin: '8px 0', fontSize: '0.8125rem', fontWeight: 500 }}>{finishError}</p>}
        {catalogLoading && <p role="status">{t('Loading...')}</p>}
        {catalogError && <div role="alert"><p>{t('Failed to load printer catalog. Check your connection and retry.')}</p><button className="ds-btn" onClick={() => void loadPrinterCatalog().catch(() => {})}>{t('Retry')}</button></div>}
        {/* Step 1: Printers & Nozzles */}
        {step === 1 && (
          <div className="wizard-body" id="wizard-step-1">
            <button id="wizard-orca-cloud" className="ds-btn ds-btn--primary" onClick={openCloudAccount}>{t('Cloud add printer choice')}</button>
            <label><MobileInput id="wizard-custom-printer" type="checkbox" checked={customPrinter} onChange={(e) => setCustomPrinter(e.target.checked)} /> {t("Create a custom printer from the current printer profile")}</label>
            {customPrinter && <fieldset style={{ display: 'grid', gap: 8 }}>
              <legend>{t("Custom printer")}</legend>
              <label>{t("Name")} <MobileInput id="wizard-custom-name" value={customName} onChange={(e) => setCustomName(e.target.value)} /></label>

              <label>{t("Bed shape")}
                <MobileSelect
                  id="wizard-custom-shape"
                  value={customShape}
                  onValueChange={(value) => {
                    const nextShape = value as 'rectangular' | 'circular' | 'polygonal';
                    setCustomShape(nextShape);
                    if (nextShape === 'circular') {
                      setCustomSize((prev) => ({ ...prev, y: prev.x }));
                    }
                  }}
                >
                  <option value="rectangular">{t("Rectangular")}</option>
                  <option value="circular">{t("Circular")}</option>
                  <option value="polygonal">{t("Polygonal")}</option>
                </MobileSelect>
              </label>

              {customShape === 'rectangular' && (
                <>
                  <label>{t("Build volume X (mm)")} <MobileInput id="wizard-custom-x" type="number" min={1} step={1} value={customSize.x} onChange={(e) => setCustomSize({ ...customSize, x: Number(e.target.value) })} /></label>
                  <label>{t("Build volume Y (mm)")} <MobileInput id="wizard-custom-y" type="number" min={1} step={1} value={customSize.y} onChange={(e) => setCustomSize({ ...customSize, y: Number(e.target.value) })} /></label>
                </>
              )}
              {customShape === 'circular' && (
                <label>{t("Diameter (mm)")} <MobileInput id="wizard-custom-diameter" data-testid="wizard-custom-diameter" className="wizard-custom-x" type="number" min={1} step={1} value={customSize.x} onChange={(e) => setCustomSize({ ...customSize, x: Number(e.target.value), y: Number(e.target.value) })} /></label>
              )}
              {customShape === 'polygonal' && (
                <label>{t("Printable area (x1xy1,x2xy2...)")}
                  <textarea className="ds-input"                     id="wizard-custom-polygon"
                    rows={3}
                    style={{width: '100%', boxSizing: 'border-box', marginTop: 4}}
                    value={customPolygon}
                    onChange={(e) => setCustomPolygon(e.target.value)}
                    placeholder="0x0,200x0,200x200,0x200"
                  />
                  {customPolygon.trim() && !validatePolygon(customPolygon).valid && (
                    <span id="wizard-polygon-error" style={{ fontSize: '0.6875rem', color: 'var(--danger-fg)', display: 'block', marginTop: 2 }}>
                      {t(validatePolygon(customPolygon).error!)}
                    </span>
                  )}
                </label>
              )}

              <label>{t("Build volume Z (mm)")} <MobileInput id="wizard-custom-z" type="number" min={1} step={1} value={customSize.z} onChange={(e) => setCustomSize({ ...customSize, z: Number(e.target.value) })} /></label>
              <label>{t("Nozzle diameter")} (mm) <MobileInput id="wizard-custom-nozzle" type="number" min={0.1} step={0.05} value={customSize.nozzle} onChange={(e) => setCustomSize({ ...customSize, nozzle: Number(e.target.value) })} /></label>
              <label>{t("Firmware")} <MobileSelect id="wizard-custom-firmware" value={customFlavor} onValueChange={(value) => setCustomFlavor(value)}>
                <option value="klipper">Klipper</option><option value="marlin2">Marlin 2</option><option value="reprapfirmware">RepRapFirmware</option>
              </MobileSelect></label>
              <p>{t("Review start/end G-code in Printer Settings before printing.")}</p>
            </fieldset>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: '0.8125rem', fontWeight: 600 }}>{t("Select Printer Brand")}</label>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <MobileSelect
                  id="wizard-vendor-select"
                  aria-label={t("Printer Brand")}
                  value={selectedVendor}
                  onValueChange={(value) => setSelectedVendor(value)}
                  style={{ minWidth: 160, padding: '6px 10px', background: 'var(--panel-bg)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: 4 }}
                >
                  {vendors.map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name}
                    </option>
                  ))}
                </MobileSelect>
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
              <MobileInput
                id="wizard-printer-search"
                type="search"
                className="wizard-search-box ds-input"
                placeholder={t("Filter models or nozzle sizes...")}
                value={printerSearch}
                onChange={(e) => setPrinterSearch(e.target.value)}
              />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                {selectedPrinters.length} {t("selected")}</span>
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
                          <MobileInput
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
              <MobileInput
                id="wizard-filament-search"
                type="search"
                className="wizard-search-box ds-input"
                style={{ maxWidth: 360 }}
                placeholder={t("Search filaments (name, brand, material)...")}
                value={filamentSearch}
                onChange={(e) => setFilamentSearch(e.target.value)}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  id="wizard-filament-select-all"
                  type="button"
                  className="ds-btn"
                  onClick={() => selectAllFilaments(allVisibleFilamentNames)}
                >
                  {t("Select All")}</button>
                <button
                  id="wizard-filament-select-none"
                  type="button"
                  className="ds-btn"
                  onClick={selectNoneFilaments}
                >
                  {t("Select None")}</button>
              </div>
            </div>

            <div className="wizard-filament-groups">
              {filamentGroups.map(([brand, items]) => (
                <div key={brand} className="wizard-filament-group">
                  <div className="wizard-group-title">{brand}</div>
                  <div className="wizard-filament-grid">
                    {items.map((item) => {
                      const id = `wizard-filament-${safeId(item.name)}`;
                      const checked = selectedFilaments.includes(item.name);
                      return (
                        <label key={item.name} htmlFor={id} className="wizard-filament-item" title={item.name}>
                          <MobileInput
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
              <div className="wizard-summary-title">{t("Printers to Install")}</div>
              {customPrinter ? (
                <div className="wizard-summary-list">
                  <div>★ {customName.trim() || t("Custom printer")} ({t("Custom")})</div>
                  {selectedPrinters.map((p) => (
                    <div key={p}>• {p}</div>
                  ))}
                </div>
              ) : selectedPrinters.length === 0 ? (
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>{t("No printers selected.")}</div>
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
                {t("Curated Filaments (")}{selectedFilaments.length})
              </div>
              {selectedFilaments.length === 0 ? (
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>{t("No filaments selected.")}</div>
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

            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 4 }}>
              {t("Clicking")} <strong>{t("Finish")}</strong> {t("will apply the first selected printer and filament to your workspace, and save your configuration choices.")}</div>
          </div>
        )}

        {/* Footer */}
        <div className="wizard-footer ds-dialog__foot">
          <button
            id="wizard-cancel-btn"
            type="button"
            className="ds-btn"
            onClick={handleClose}
          >
            {t("Cancel")}</button>
          <div className="wizard-footer-right">
            {step > 1 && (
              <button
                id="wizard-back-btn"
                type="button"
                className="ds-btn"
                onClick={() => setStep((step - 1) as 1 | 2 | 3)}
              >
                {t("Back")}</button>
            )}
            {step < 3 && (
              <button
                id="wizard-next-btn"
                type="button"
                className="ds-btn ds-btn--primary"
                onClick={() => setStep((step + 1) as 1 | 2 | 3)}
                disabled={!isEngineReady || (step === 1 && !customPrinter && selectedPrinters.length === 0)}
              >
                {t("Next")}</button>
            )}
            {step === 3 && (
              <button
                id="wizard-finish-btn"
                type="button"
                className="ds-btn ds-btn--primary"
                onClick={handleFinish}
                disabled={!isEngineReady || isFinishing || (!customPrinter && selectedPrinters.length === 0)}
              >
                {isFinishing ? 'Applying...' : 'Finish'}
              </button>
            )}
          </div>
        </div>
      </div>
    </Dialog>
  );
};
