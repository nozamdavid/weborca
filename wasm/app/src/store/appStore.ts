import { isNoRuleFix } from '../engine/ruleFixes';
import type { EngineLoadProgress } from '../engine/orcaEngine';
import { usePrinterConnectionStore } from '../printers/connectionStore';
import { findSystemProfileVendor, systemProfiles } from '../presets/systemProfiles';
import { loadPrinterCatalog, usePrinterCatalog } from '../presets/printerCatalog';
import { slicePrerequisites } from '../shell/slicePrerequisites';
import { showToast } from '../shell/toastStore';
import { storeRecentFile } from '../shell/recentFiles';
import { clearExportGcodeCache } from '../shell/gcodeThumbnails';
/**
 * @file appStore.ts
 * Zustand state store for OrcaSlicer Web.
 */

import { create } from 'zustand';
import { resolveSlicingThreads } from '../prefs/slicingThreads';
import type { PlateObject } from '../plate/types';
import {
  getEngine,
  disposeEngine,
  onEngineLoadProgress,
  loadVendors,
  listPresets,
  getCompatiblePresets,
  selectPresets,
  getConfig,
  getConfigDef,
  evaluateRules,
  setOptions,
  setOption,
  getOption,
  resetOptions,
  addModel,
  slice
} from '../engine/orcaEngine';
import type {
  PresetItem,
  VendorInfo,
  ModelObjectInfo,
  SliceResult,
  ProgressNotification,
  ConfigOptionDef,
  FieldState,
  RuleFix,
  StepImportOptions,
} from '../engine/types';
import type { SettingsLayout, SettingsMode } from '../settings/types';
import type { UserPreset, PresetKind, ConflictStrategy, PresetBundle, ImportBundleResult } from '../presets/types';
import { loadUserPresets } from '../presets/presetStorage';
import { effectivePreset } from '../presets/effectivePreset';
import {
  saveCurrentUserPresetHelper,
  duplicateUserPresetHelper,
  deleteUserPresetHelper,
  renameUserPresetHelper,
  importUserPresetsHelper,
  exportUserPresetsHelper,
  exportDesktopArchiveHelper
} from '../presets/presetActions';

export function pendingOptionKey(kind: 'print' | 'filament' | 'printer', key: string, filamentIndex?: number, layoutIndex?: number): string {
  return `${kind}:${key}:${filamentIndex ?? ''}:${layoutIndex ?? ''}`;
}

let optionRequestId = 0;
let startupGeneration = 0;
export function stopAppStartup(): void {
  startupGeneration++;
  disposeEngine();
  useAppStore.setState({ isEngineReady: false, isEngineInitializing: false });
}

export interface AppState {
  // Cross-origin isolation
  isIsolated: boolean;

  // Engine lifecycle
  isEngineInitializing: boolean;
  isEngineReady: boolean;
  engineLoad: EngineLoadProgress;
  engineError: string | null;
  setEngineError: (error: string | null) => void;

  // Presets & vendors
  vendors: VendorInfo[];
  selectedVendor: string;
  printers: PresetItem[];
  selectedPrinter: string;
  processes: PresetItem[];
  selectedProcess: string;
  filaments: PresetItem[];
  selectedFilament: string;
  selectedFilaments: string[];
  isSelectingPreset: boolean;

  // Model state
  modelFile: { name: string; size: number } | null;
  modelObjects: ModelObjectInfo[] | null;
  isModelLoading: boolean;

  // Slicing state
  isSlicing: boolean;
  slicePercent: number;
  sliceStatusText: string;
  sliceResult: SliceResult | null;
  sessionRecovery: 'idle' | 'restoring' | 'restored';
  gcodeUrl: string | null;
  abortController: AbortController | null;

  // Settings layout & config
  layout: SettingsLayout | null;
  configDefs: Record<string, ConfigOptionDef>;
  presetConfig: Record<string, string>;
  currentConfig: Record<string, string>;
  /** Requested UI values awaiting the engine; excluded from slicing and persistence. */
  pendingOptions: Record<string, { value: string; requestId: number }>;

  // Per-kind overrides (kept separate so changing filament doesn't drop process edits)
  processOverrides: Record<string, string>;
  filamentOverrides: Record<string, string>;
  printerOverrides: Record<string, string>;

  // User presets
  userPresets: UserPreset[];
  activeUserPreset: {
    process: string | null;
    filament: string | null;
    printer: string | null;
  };

  // Settings UI state
  settingsMode: SettingsMode;
  setSettingsMode: (mode: SettingsMode) => void;
  activePrintPage: string;
  setActivePrintPage: (page: string) => void;
  activePrinterPage: string;
  setActivePrinterPage: (page: string) => void;
  activeFilamentPage: string;
  setActiveFilamentPage: (page: string) => void;

  // Rules & Fixes
  rulesState: {
    fields: Record<string, FieldState>;
    fixes: RuleFix[];
    messages: string[];
  };
  pendingFixes: RuleFix[] | null;
  pendingFixReason: string | null;
  pendingFixTriggerKey: string | null;

  // Dialogs
  activeDialog: 'printer' | 'filament' | null;
  activeFilamentSlot: number;
  openDialog: (dialog: 'printer' | 'filament', slotIndex?: number) => void;
  closeDialog: () => void;

  savePresetDialogTarget: { kind: PresetKind; baseName: string } | null;
  openSavePresetDialog: (kind: PresetKind, slotIndex?: number) => void;
  closeSavePresetDialog: () => void;
  managePresetsDialogTarget: { kind: PresetKind; initialAction?: 'manage' | 'duplicate' | 'rename'; targetPresetName?: string } | null;
  openManagePresetsDialog: (kind: PresetKind, initialAction?: 'manage' | 'duplicate' | 'rename', targetPresetName?: string) => void;
  closeManagePresetsDialog: () => void;

  // Search
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  highlightedKey: string | null;
  jumpToOption: (key: string) => void;

  // Core Actions
  initApp: () => Promise<void>;
  chooseVendor: (vendor: string) => Promise<void>;
  choosePrinter: (printer: string) => Promise<void>;
  chooseProcess: (process: string) => Promise<void>;
  chooseFilament: (filament: string, slotIndex?: number) => Promise<void>;
  addFilamentSlot: (presetName?: string) => Promise<void>;
  removeFilamentSlot: (slotIndex?: number) => Promise<void>;
  setSlotColor: (slotIndex: number, color: string) => Promise<void>;
  stepImportState: { file: File } | null;
  setStepImportState: (state: { file: File } | null) => void;
  requestImportFile: (file: File) => void;
  importModelFile: (file: File, options?: StepImportOptions, inArchive?: boolean, context?: { source: 'builtin-handy' }) => Promise<void>;
  openProjectFile: (file: File) => Promise<void>;
  saveProjectFile: (fileName?: string) => Promise<Uint8Array | null>;
  openGcodeFile: (file: File) => Promise<void>;
  startSlice: () => Promise<void>;
  cancelSlice: () => void;
  invalidateSlicePreview: () => void;

  // Settings Actions
  applyOptionChange: (key: string, value: string, explicitKind?: 'print' | 'filament' | 'printer', layoutIndex?: number, filamentSlot?: number | null) => Promise<void>;
  resetOption: (key: string, kind?: 'print' | 'filament' | 'printer', layoutIndex?: number) => Promise<void>;
  applyFixes: (branch: 'yes' | 'no') => Promise<void>;
  closeFixesDialog: () => void;

  // User Preset Actions
  selectUserPreset: (kind: PresetKind, name: string, slotIndex?: number) => Promise<void>;
  importPresetBundleAction: (bundleData: unknown, strategy?: ConflictStrategy) => Promise<ImportBundleResult>;
  exportPresetBundleAction: (kinds?: PresetKind[], description?: string) => PresetBundle;
  exportDesktopArchiveAction: (archiveType?: 'printer' | 'filament' | 'all', targetName?: string) => Promise<Uint8Array>;
  saveCurrentUserPreset: (kind: PresetKind, name: string) => Promise<void>;
  deleteUserPresetAction: (kind: PresetKind, name: string) => Promise<void>;
  renameUserPresetAction: (kind: PresetKind, oldName: string, newName: string) => Promise<void>;
  duplicateUserPresetAction: (kind: PresetKind, sourceName: string, newName: string) => Promise<void>;
}

function resolveSystemPreset(
  kind: PresetKind,
  name: string,
  userPresets: UserPreset[]
): string {
  return effectivePreset(kind, name, userPresets).preset;
}

/** Migrate stored web maps before filtering keys or constructing reset values. */
async function normalizePersistedOptions(options: Record<string, string>): Promise<Record<string, string>> {
  const result = await (await getEngine()).call('normalizeOptions', { options }) as {
    options: Record<string, string>; errors: { key: string; error: string; fatal: boolean }[];
  };
  const fatal = result.errors.filter(error => error.fatal);
  if (fatal.length) throw new Error(fatal.map(error => `${error.key}: ${error.error}`).join('; '));
  return result.options;
}

async function canonicalPresetName(kind: PresetKind, name: string): Promise<string | undefined> {
  try {
    const result = await (await getEngine()).call('resolvePreset', { kind, name }) as { name: string };
    return result.name;
  } catch { return undefined; }
}

function profileHasName(profile: { name: string; renamed_from?: string | string[] }, name: string): boolean {
  return profile.name === name || (Array.isArray(profile.renamed_from)
    ? profile.renamed_from.includes(name) : profile.renamed_from === name);
}

/** Rename metadata only locates a bundle; native collections resolve the name after loading. */
async function findPresetVendor(directory: 'machine' | 'process' | 'filament', name: string, vendors: string[], preferred?: string): Promise<string | undefined> {
  const exact = await findSystemProfileVendor(directory, name, vendors, preferred);
  if (exact) return exact;
  for (const vendor of vendors) {
    const profiles = await systemProfiles(vendor, directory).catch(() => []);
    if (profiles.some(profile => profileHasName(profile, name))) return vendor;
  }
  return undefined;
}

/** Merge each user filament into its own slot using the desktop config composer. */
async function reapplyPresetOverrides(filaments: string[], overrides: Record<string, string>): Promise<void> {
  const users = useAppStore.getState().userPresets;
  const slots = filaments.map(name => {
    return effectivePreset('filament', name, users);
  });
  const userValues = slots.some(slot => Object.keys(slot.values).length)
    ? await (await getEngine()).call('mergeFilamentPresets', { slots }) as Record<string, string>
    : {};
  const options = await normalizePersistedOptions({ ...userValues, ...overrides });
  if (Object.keys(options).length) await setOptions(options);
}

/** Saved web presets are the reset baseline; their system parents only supply inherited values. */
async function computeBaselineConfig(
  filaments: string[],
  userPresets: UserPreset[],
  activeOverrides?: { printer?: string | null; process?: string | null; filament?: string | null }
): Promise<Record<string, string>> {
  const systemBaselineConfig = await getConfig();
  const active = activeOverrides || useAppStore.getState().activeUserPreset;
  const printer = userPresets.find(preset => preset.kind === 'printer' && preset.name === active.printer);
  const process = userPresets.find(preset => preset.kind === 'process' && preset.name === active.process);
  const slots = filaments.map(name => {
    return effectivePreset('filament', name, userPresets);
  });
  const userValues = slots.some(slot => Object.keys(slot.values).length)
    ? await (await getEngine()).call('mergeFilamentPresets', { slots }) as Record<string, string>
    : {};

  const baseline: Record<string, string> = { ...systemBaselineConfig };
  const mergeKnown = async (src?: Record<string, string>) => {
    if (!src) return;
    for (const [k, v] of Object.entries(await normalizePersistedOptions(src))) {
      if (k in systemBaselineConfig) {
        baseline[k] = v;
      }
    }
  };
  if (printer) await mergeKnown(effectivePreset('printer', printer.name, userPresets).values);
  if (process) await mergeKnown(effectivePreset('process', process.name, userPresets).values);
  await mergeKnown(userValues);
  return baseline;
}

/** Pause UI actions and autosave while a managed preset is persisted and applied. */
async function runPresetManagementAction(action: () => Promise<void>): Promise<void> {
  if (useAppStore.getState().isSelectingPreset) throw new Error('A preset operation is already in progress.');
  useAppStore.setState({ isSelectingPreset: true });
  try { await action(); }
  finally { useAppStore.setState({ isSelectingPreset: false }); }
}

async function storeImportedRecentFile(file: File, type: 'project' | 'model'): Promise<void> {
  const { usePrefsStore } = await import('../prefs/prefsStore');
  if (!usePrefsStore.getState().general.rememberRecentFiles) return;
  // The upload buffer was transferred to the worker; reread the immutable original.
  const bytes = new Uint8Array(await file.arrayBuffer());
  await storeRecentFile(file.name, bytes, type);
}

let projectExportId = 0;

export const useAppStore = create<AppState>((set, get) => ({
  isIsolated: typeof window !== 'undefined' ? !!window.crossOriginIsolated : false,

  isEngineInitializing: false,
  isEngineReady: false,
  engineLoad: { phase: 'checking' },
  engineError: null,
  setEngineError: (error) => set({ engineError: error }),

  vendors: [],
  selectedVendor: '',
  printers: [],
  selectedPrinter: '',
  processes: [],
  selectedProcess: '',
  filaments: [],
  selectedFilament: '',
  selectedFilaments: [],
  isSelectingPreset: false,

  modelFile: null,
  modelObjects: null,
  isModelLoading: false,

  isSlicing: false,
  slicePercent: 0,
  sliceStatusText: '',
  sliceResult: null,
  sessionRecovery: 'idle',
  gcodeUrl: null,
  abortController: null,

  layout: null,
  configDefs: {},
  presetConfig: {},
  currentConfig: {},
  pendingOptions: {},

  processOverrides: {},
  filamentOverrides: {},
  printerOverrides: {},

  userPresets: [],
  activeUserPreset: {
    process: null,
    filament: null,
    printer: null
  },

  settingsMode: 'advanced',
  setSettingsMode: (mode) => set({ settingsMode: mode }),
  activePrintPage: 'Quality',
  setActivePrintPage: (page) => set({ activePrintPage: page }),
  activePrinterPage: 'Basic information',
  setActivePrinterPage: (page) => set({ activePrinterPage: page }),
  activeFilamentPage: 'Filament',
  setActiveFilamentPage: (page) => set({ activeFilamentPage: page }),

  rulesState: {
    fields: {},
    fixes: [],
    messages: []
  },
  pendingFixes: null,
  pendingFixReason: null,
  pendingFixTriggerKey: null,

  activeDialog: null,
  activeFilamentSlot: 0,
  openDialog: async (dialog, slotIndex = 0) => {
    set({ activeDialog: dialog, activeFilamentSlot: slotIndex });
    // Evaluate rules for the opened dialog
    const kind = dialog === 'printer' ? 'printer' : 'filament';
    try {
      const res = await evaluateRules({ kind, filamentIndex: get().activeFilamentSlot || 0 });
      set((state) => ({
        rulesState: {
          fields: { ...state.rulesState.fields, ...res.fields },
          fixes: res.fixes || [],
          messages: res.messages || []
        }
      }));
    } catch (_) {}
  },
  closeDialog: () => {
    set({ activeDialog: null });
    // Re-evaluate print rules
    try {
      evaluateRules({ kind: 'print', filamentIndex: get().activeFilamentSlot || 0 }).then((res) => {
        set((state) => ({
          rulesState: {
            fields: { ...state.rulesState.fields, ...res.fields },
            fixes: res.fixes || [],
            messages: res.messages || []
          }
        }));
      });
    } catch (_) {}
  },

  savePresetDialogTarget: null,
  openSavePresetDialog: (kind, slotIndex) => {
    const { selectedPrinter, selectedProcess, selectedFilament, selectedFilaments, activeFilamentSlot } = get();
    const filamentSlot = slotIndex ?? activeFilamentSlot;
    let baseName = '';
    if (kind === 'process') baseName = selectedProcess;
    else if (kind === 'filament') baseName = selectedFilaments[filamentSlot] || selectedFilament;
    else if (kind === 'printer') baseName = selectedPrinter;
    set({ savePresetDialogTarget: { kind, baseName }, ...(kind === 'filament' ? { activeFilamentSlot: filamentSlot } : {}) });
  },
  closeSavePresetDialog: () => set({ savePresetDialogTarget: null }),
  managePresetsDialogTarget: null,
  openManagePresetsDialog: (kind, initialAction = 'manage', targetPresetName) => set({ managePresetsDialogTarget: { kind, initialAction, targetPresetName } }),
  closeManagePresetsDialog: () => set({ managePresetsDialogTarget: null }),

  searchQuery: '',
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  highlightedKey: null,
  jumpToOption: (key) => {
    const { layout } = get();
    if (!layout) return;

    const currentDialog = get().activeDialog;
    const preferredTabId = currentDialog === 'printer' ? 'printer' : currentDialog === 'filament' ? 'filament' : 'print';
    const sortedTabs = [...layout.tabs].sort((a, b) => (a.id === preferredTabId ? -1 : b.id === preferredTabId ? 1 : 0));

    for (const tab of sortedTabs) {
      for (const page of tab.pages) {
        for (const group of page.groups) {
          for (const line of group.lines) {
            const matches = line.key === key || (line.options && line.options.includes(key));
            if (matches) {
              if (tab.id === 'print') {
                set({ activePrintPage: page.title, highlightedKey: key });
              } else if (tab.id === 'printer') {
                set({ activeDialog: 'printer', activePrinterPage: page.title, highlightedKey: key });
              } else if (tab.id === 'filament') {
                set({ activeDialog: 'filament', activeFilamentPage: page.title, highlightedKey: key });
              }
              setTimeout(() => {
                const el = document.getElementById(`setting-row-${key}`) ||
                  document.getElementById(`setting-input-${key}`)?.closest('.setting-row') ||
                  document.querySelector(`[data-testid="setting-row-${key}"]`);
                if (el) {
                  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
              }, 100);
              return;
            }
          }
        }
      }
    }
  },

  initApp: async () => {
    if (get().isEngineInitializing || get().isEngineReady) return;
    const current = ++startupGeneration;
    const check = () => { if (current !== startupGeneration) throw new Error('Startup canceled'); };
    const isIsolated = typeof window !== 'undefined' ? !!window.crossOriginIsolated : false,
      setIsolated = isIsolated;
    set({ isIsolated: setIsolated });
    if (!isIsolated) return;

    set({ isEngineInitializing: true, engineError: null, engineLoad: { phase: 'checking' } });
    onEngineLoadProgress(engineLoad => set({ engineLoad }));

    try {
      // None of these need the engine, so they download while the WASM module loads.
      const layoutFetch = fetch('/settings/layout.json').then((r) => r.json());
      const userPresetsLoad = loadUserPresets();
      // A failure surfaces through the awaits below; this only avoids an unhandled rejection while the engine loads.
      const metadata = Promise.all([layoutFetch, userPresetsLoad]).then(([layout, userPresets]) => {
        check();
        set({ layout: layout as SettingsLayout, userPresets });
      });
      metadata.catch(() => undefined);
      await Promise.all([getEngine(), metadata]);
      check();
      set({ engineLoad: { phase: 'initializing' } });
      const configDefs = await getConfigDef();
      check();
      set({ configDefs });

      try {
        const { useHistoryStore } = await import('../history');
        await useHistoryStore.getState().initHistory();
      } catch (_) {}
      check();

      // Pick default vendor
      const defaultVendor = 'Voron';

      // The last used device decides the printer; otherwise the default vendor's.
      const device = selectedDevice();
      const deviceVendor = device ? await resolveDeviceVendor(device) : undefined;
      check();
      let savedVendor: string | undefined;
      if (!device?.preset) {
        let saved: { printer?: string; vendor?: string } | null = null;
        try { saved = JSON.parse(localStorage.getItem('orca.lastSetup') || 'null'); } catch {}
        if (saved?.printer) savedVendor = await resolveDeviceVendor({ id: '', ...saved, preset: saved.printer });
      }
      check();
      const startVendor = device?.preset && deviceVendor ? deviceVendor : savedVendor || defaultVendor;
      if (startVendor) {
        await get().chooseVendor(startVendor);
      }
      if (device?.preset && deviceVendor === startVendor) {
        const userPrinter = get().userPresets.find((p) => p.kind === 'printer' && p.name === device.preset);
        await get().choosePrinter(userPrinter?.inherits || device.preset);
        if (userPrinter) await get().selectUserPreset('printer', device.preset);
      }
      if (!device?.preset) await restoreLastSetup();
      await restoreDeviceFilaments();
      check();
      if (get().engineError) throw new Error(get().engineError!);
      applyingDevice = false;
      const { initializeAutosaveSession } = await import('../shell/autosave');
      check();
      await initializeAutosaveSession();
      check();
      set({ isEngineReady: true, isEngineInitializing: false });
    } catch (err: any) {
      if (current !== startupGeneration) return;
      disposeEngine();
      set({
        isEngineInitializing: false,
        engineError: `Engine initialization failed: ${err.message || String(err)}`
      });
    }
  },

  chooseVendor: async (vendor: string) => {
    if (!vendor) return;
    const current = startupGeneration;
    set({ selectedVendor: vendor, engineError: null });

    try {
      await loadVendors([vendor]);
      if (current !== startupGeneration) return;
      const printers = await listPresets('printer', { compatibleOnly: false });
      if (current !== startupGeneration) return;

      let chosenPrinter = printers[0]?.name || '';
      if (vendor === 'Voron' && printers.some((p) => p.name === 'Voron 2.4 300 0.4 nozzle')) {
        chosenPrinter = 'Voron 2.4 300 0.4 nozzle';
      } else if (vendor === 'BBL' && printers.some((p) => p.name === 'Bambu Lab X1 Carbon 0.4 nozzle')) {
        chosenPrinter = 'Bambu Lab X1 Carbon 0.4 nozzle';
      }

      set(state => ({ printers, selectedPrinter: chosenPrinter,
        vendors: state.vendors.some(v => v.name === vendor) ? state.vendors : [...state.vendors, { name: vendor, bytes: 0 }] }));

      if (chosenPrinter) {
        await get().choosePrinter(chosenPrinter);
      }
    } catch (err: any) {
      if (current !== startupGeneration) return;
      set({ engineError: `Failed to load vendor '${vendor}': ${err.message || String(err)}` });
    }
  },

  choosePrinter: async (printer: string) => {
    if (!printer) return;
    const current = startupGeneration;
    set({ selectedPrinter: printer, engineError: null });

    try {
      // Defaults come from what is compatible with this printer: the engine keeps every brand loaded so far.
      const everyProcess = await listPresets('process', { compatibleOnly: false });
      const everyFilament = await listPresets('filament', { compatibleOnly: false });
      const compatible = await getCompatiblePresets({ printer });
      if (current !== startupGeneration) return;
      const onlyCompatible = <T extends { name: string }>(all: T[], names: string[]) => {
        const kept = all.filter((p) => names.includes(p.name));
        return kept.length > 0 ? kept : all;
      };
      const allProcesses = onlyCompatible(everyProcess, compatible.compatibleProcesses);
      const allFilaments = onlyCompatible(everyFilament, compatible.compatibleFilaments);

      let defaultProc = '';
      if (printer.includes('Voron')) {
        const found = allProcesses.find((p) => p.name === '0.20mm Standard @Voron') || allProcesses.find((p) => p.name.includes('@Voron'));
        if (found) defaultProc = found.name;
      } else if (printer.includes('BBL') || printer.includes('Bambu')) {
        const found = allProcesses.find((p) => p.name === '0.20mm Standard @BBL X1C') || allProcesses.find((p) => p.name.includes('@BBL'));
        if (found) defaultProc = found.name;
      } else if (printer.includes('Prusa')) {
        const found = allProcesses.find((p) => p.name.includes('@Prusa'));
        if (found) defaultProc = found.name;
      }
      if (!defaultProc) {
        defaultProc = allProcesses.find((p) => /^0\.20mm Standard/.test(p.name))?.name || allProcesses[0]?.name || '';
      }

      let defaultFilament = '';
      if (printer.includes('Voron')) {
        const found = allFilaments.find((f) => f.name === 'Generic PLA @System') || allFilaments.find((f) => f.name.includes('@System'));
        if (found) defaultFilament = found.name;
      } else if (printer.includes('BBL') || printer.includes('Bambu')) {
        const found = allFilaments.find((f) => f.name === 'Bambu PLA Basic @BBL X1C') || allFilaments.find((f) => f.name.includes('Bambu PLA Basic'));
        if (found) defaultFilament = found.name;
      }
      if (!defaultFilament) {
        defaultFilament = allFilaments.find((f) => f.name === 'Generic PLA @System')?.name || allFilaments[0]?.name || '';
      }

      if (printer && defaultProc && defaultFilament) {
        // Clear overrides and user presets when choosing a new printer preset
        set({
          printerOverrides: {},
          activeUserPreset: { process: null, filament: null, printer: null }
        });

        await selectPresets({
          printer,
          process: defaultProc,
          filaments: [defaultFilament]
        });

        // Capture pristine baseline preset config
        const baselineConfig = await getConfig();

        // Re-apply remaining process & filament overrides
        const { processOverrides, filamentOverrides } = get();
        const activeOverrides = { ...processOverrides, ...filamentOverrides };
        await reapplyPresetOverrides([defaultFilament], activeOverrides);

        const effectiveConfig = await getConfig();

        const rulesRes = await evaluateRules({ kind: 'print', filamentIndex: get().activeFilamentSlot || 0 });

        let processes = await listPresets('process', { compatibleOnly: true });
        if (processes.length === 0) processes = allProcesses;
        if (!processes.some((p) => p.name === defaultProc)) {
          defaultProc = processes[0]?.name || defaultProc;
        }

        let filaments = await listPresets('filament', { compatibleOnly: true });
        if (current !== startupGeneration) return;
        if (filaments.length === 0) filaments = allFilaments;
        if (!filaments.some((f) => f.name === defaultFilament)) {
          defaultFilament = filaments[0]?.name || defaultFilament;
        }

        set({
          processes,
          selectedProcess: defaultProc,
          filaments,
          selectedFilament: defaultFilament,
          selectedFilaments: [defaultFilament],
          presetConfig: baselineConfig,
          currentConfig: effectiveConfig,
          rulesState: {
            fields: rulesRes.fields || {},
            fixes: rulesRes.fixes || [],
            messages: rulesRes.messages || []
          }
        });
      }
    } catch (err: any) {
      if (current !== startupGeneration) return;
      set({ engineError: `Failed to select printer '${printer}': ${err.message || String(err)}` });
    }
  },

  chooseProcess: async (process: string) => {
    if (!process) return;
    const { selectedPrinter, selectedFilament, selectedFilaments, userPresets } = get();
    set({ selectedProcess: process, engineError: null });

    try {
      if (selectedPrinter && (selectedFilament || (selectedFilaments && selectedFilaments.length > 0))) {
        // Clear process overrides when selecting a new system process
        set((state) => ({
          processOverrides: {},
          activeUserPreset: { ...state.activeUserPreset, process: null }
        }));

        const systemPrinter = resolveSystemPreset('printer', selectedPrinter, userPresets);
        const filamentsList = selectedFilaments && selectedFilaments.length > 0 ? selectedFilaments : [selectedFilament];
        const systemFilaments = filamentsList.map((f) => resolveSystemPreset('filament', f, userPresets));

        await selectPresets({
          printer: systemPrinter,
          process,
          filaments: systemFilaments
        });

        const baselineConfig = await computeBaselineConfig(filamentsList, userPresets);

        // Re-apply remaining filament and printer overrides
        const { filamentOverrides, printerOverrides } = get();
        const activeOverrides = { ...filamentOverrides, ...printerOverrides };
        await reapplyPresetOverrides(filamentsList, activeOverrides);

        const effectiveConfig = await getConfig();

        const rulesRes = await evaluateRules({ kind: 'print', filamentIndex: get().activeFilamentSlot || 0 });

        const filaments = await listPresets('filament', { compatibleOnly: true });
        if (filaments.length > 0) {
          const keepFilament = filaments.some((f) => f.name === selectedFilament)
            ? selectedFilament
            : filaments[0].name;
          set({ filaments, selectedFilament: keepFilament });
        }

        set({
          presetConfig: baselineConfig,
          currentConfig: effectiveConfig,
          rulesState: {
            fields: rulesRes.fields || {},
            fixes: rulesRes.fixes || [],
            messages: rulesRes.messages || []
          }
        });
      }
    } catch (err: any) {
      set({ engineError: `Failed to select process '${process}': ${err.message || String(err)}` });
    }
  },

  chooseFilament: async (filament: string, slotIndex: number = 0) => {
    if (!filament) return;
    if (get().isSlicing) get().cancelSlice();
    get().invalidateSlicePreview();
    const { selectedPrinter, selectedProcess, selectedFilaments, selectedFilament, userPresets } = get();
    const currentList = selectedFilaments && selectedFilaments.length > 0 ? [...selectedFilaments] : [selectedFilament || filament];
    if (slotIndex < currentList.length) {
      currentList[slotIndex] = filament;
    } else {
      currentList.push(filament);
    }
    const prevColours = (get().currentConfig['filament_colour'] || '').split(';').map((c) => c.trim());
    const prevCount = selectedFilaments && selectedFilaments.length > 0 ? selectedFilaments.length : 1;
    const firstFilament = currentList[0];
    set({
      selectedFilament: firstFilament,
      selectedFilaments: currentList,
      engineError: null
    });

    try {
      if (selectedPrinter && selectedProcess) {
        const systemPrinter = resolveSystemPreset('printer', selectedPrinter, userPresets);
        const systemProcess = resolveSystemPreset('process', selectedProcess, userPresets);
        const systemFilaments = currentList.map((f) => resolveSystemPreset('filament', f, userPresets));

        await selectPresets({
          printer: systemPrinter,
          process: systemProcess,
          filaments: systemFilaments
        });

        const baselineConfig = await computeBaselineConfig(currentList, userPresets);

        // A slot keeps its colour when only its filament preset changes
        const baseColours = (baselineConfig['filament_colour'] || '').split(';').map((c) => c.trim());
        const keptColours = currentList.map((_, i) => (i < prevCount && prevColours[i]) || baseColours[i] || '');

        const { processOverrides, printerOverrides, filamentOverrides } = get();
        let nextFilOverrides = { ...filamentOverrides };
        if (keptColours.every(Boolean)) {
          nextFilOverrides['filament_colour'] = keptColours.join(';');
        }

        // Reset ONLY chosen slot cells preserving others via native vector projection
        const resetRes = await resetOptions({
          filamentIndex: slotIndex,
          overrides: nextFilOverrides,
          baseline: baselineConfig
        });
        if (resetRes && resetRes.filamentOverrides) {
          nextFilOverrides = resetRes.filamentOverrides;
        }
        // Slot colors belong to the project, not the preset being reset.
        if (keptColours.every(Boolean)) nextFilOverrides.filament_colour = keptColours.join(';');

        // Re-apply process, printer and filament overrides
        const activeOverrides = { ...processOverrides, ...printerOverrides, ...nextFilOverrides };
        await reapplyPresetOverrides(currentList, activeOverrides);

        const effectiveConfig = await getConfig();

        const rulesRes = await evaluateRules({ kind: 'print', filamentIndex: get().activeFilamentSlot || 0 });

        set((state) => ({
          filamentOverrides: nextFilOverrides,
          presetConfig: baselineConfig,
          currentConfig: effectiveConfig,
          activeUserPreset: {
            ...state.activeUserPreset,
            filament: slotIndex === 0 ? null : state.activeUserPreset.filament
          },
          rulesState: {
            fields: rulesRes.fields || {},
            fixes: rulesRes.fixes || [],
            messages: rulesRes.messages || []
          }
        }));
      }
    } catch (err: any) {
      set({ engineError: `Failed to select filament '${filament}': ${err.message || String(err)}` });
    }
  },

  addFilamentSlot: async (presetName?: string) => {
    const { selectedFilaments, selectedFilament, filaments, selectedPrinter, selectedProcess, userPresets } = get();
    const candidate = presetName || (selectedFilaments[selectedFilaments.length - 1] || selectedFilament || (filaments[0]?.name ?? 'Generic PLA'));
    const nextList = [...(selectedFilaments.length > 0 ? selectedFilaments : [selectedFilament]), candidate];
    if (nextList.length > 16) return;
    if (get().isSlicing) get().cancelSlice();
    get().invalidateSlicePreview();

    try {
      if (selectedPrinter && selectedProcess) {
        const systemPrinter = resolveSystemPreset('printer', selectedPrinter, userPresets);
        const systemProcess = resolveSystemPreset('process', selectedProcess, userPresets);
        const systemFilaments = nextList.map((f) => resolveSystemPreset('filament', f, userPresets));

        await selectPresets({
          printer: systemPrinter,
          process: systemProcess,
          filaments: systemFilaments
        });

        const baselineConfig = await computeBaselineConfig(nextList, userPresets);

        const { processOverrides, printerOverrides, filamentOverrides } = get();
        const nextFilOverrides = { ...filamentOverrides };
        if (nextFilOverrides['filament_colour']) {
          const colors = nextFilOverrides['filament_colour'].split(';').map(c => c.trim()).filter(Boolean);
          const baselineColors = (baselineConfig['filament_colour'] || '').split(';').map(c => c.trim()).filter(Boolean);
          while (colors.length < nextList.length) {
            colors.push(baselineColors[colors.length] || colors[colors.length - 1] || '#009688');
          }
          nextFilOverrides['filament_colour'] = colors.slice(0, nextList.length).join(';');
        }
        const activeOverrides = { ...processOverrides, ...printerOverrides, ...nextFilOverrides };
        await reapplyPresetOverrides(nextList, activeOverrides);

        const effectiveConfig = await getConfig();

        const rulesRes = await evaluateRules({ kind: 'print', filamentIndex: get().activeFilamentSlot || 0 });

        set({
          selectedFilaments: nextList,
          selectedFilament: nextList[0],
          filamentOverrides: nextFilOverrides,
          presetConfig: baselineConfig,
          currentConfig: effectiveConfig,
          rulesState: {
            fields: rulesRes.fields || {},
            fixes: rulesRes.fixes || [],
            messages: rulesRes.messages || []
          }
        });
      } else {
        set({
          selectedFilaments: nextList,
          selectedFilament: nextList[0]
        });
      }
    } catch (err: any) {
      set({ engineError: 'Failed to add filament slot: ' + (err.message || String(err)) });
    }
  },

  removeFilamentSlot: async (slotIndex?: number) => {
    const { selectedPrinter, selectedProcess, selectedFilaments, selectedFilament, userPresets } = get();
    const currentList = selectedFilaments && selectedFilaments.length > 0 ? [...selectedFilaments] : [selectedFilament];
    if (currentList.length <= 1) return;

    const removedSlot = Number.isInteger(slotIndex) && slotIndex! >= 0 && slotIndex! < currentList.length
      ? slotIndex! : currentList.length - 1;
    const nextList = currentList.filter((_, i) => i !== removedSlot);
    const previousActive = get().activeFilamentSlot;
    const nextActive = Math.min(previousActive > removedSlot ? previousActive - 1 : previousActive, nextList.length - 1);
    const nextUserPreset = {
      ...get().activeUserPreset,
      filament: userPresets.some(p => p.kind === 'filament' && p.name === nextList[0]) ? nextList[0] : null
    };
    if (nextList.length === 0) return;
    if (get().isSlicing) get().cancelSlice();

    try {
      if (selectedPrinter && selectedProcess) {
        const { processOverrides, printerOverrides, filamentOverrides } = get();
        const overrides = { ...processOverrides, ...printerOverrides, ...filamentOverrides };
        // Imported maps/colors may exist only in native project settings.
        for (const key of ['filament_map', 'filament_volume_map', 'filament_nozzle_map', 'filament_colour']) {
          if (!(key in overrides) && get().currentConfig[key] !== undefined) overrides[key] = get().currentConfig[key];
        }
        const systemPrinter = resolveSystemPreset('printer', selectedPrinter, userPresets);
        const systemProcess = resolveSystemPreset('process', selectedProcess, userPresets);
        const systemFilaments = nextList.map((f) => resolveSystemPreset('filament', f, userPresets));
        const baselineOverrides = {
          ...effectivePreset('printer', selectedPrinter, userPresets).values,
          ...effectivePreset('process', selectedProcess, userPresets).values
        };
        // Native stages selection, typed vectors, model painting and plate maps
        // together. A validation/remap failure leaves the current project intact.
        const result = await (await getEngine()).call('removeFilamentSlot', {
          filamentIndex: removedSlot, activeFilamentIndex: nextActive,
          selection: { printer: systemPrinter, process: systemProcess, filaments: systemFilaments },
          slots: nextList.map(name => effectivePreset('filament', name, userPresets)),
          baselineOverrides, overrides
        }) as { baseline: Record<string, string>; config: Record<string, string>;
          overrides: Record<string, string>; rules: AppState['rulesState'] };
        const nextProcessOverrides: Record<string, string> = {};
        const nextPrinterOverrides: Record<string, string> = {};
        const nextFilOverrides: Record<string, string> = {};
        for (const [key, value] of Object.entries(result.overrides)) {
          if (key in filamentOverrides || key === 'filament_colour') nextFilOverrides[key] = value;
          else if (key in printerOverrides) nextPrinterOverrides[key] = value;
          else nextProcessOverrides[key] = value;
        }
        get().invalidateSlicePreview();
        set({
          selectedFilaments: nextList,
          selectedFilament: nextList[0],
          activeFilamentSlot: nextActive,
          activeUserPreset: nextUserPreset,
          processOverrides: nextProcessOverrides,
          printerOverrides: nextPrinterOverrides,
          filamentOverrides: nextFilOverrides,
          presetConfig: result.baseline,
          currentConfig: result.config,
          rulesState: {
            fields: result.rules.fields || {},
            fixes: result.rules.fixes || [],
            messages: result.rules.messages || []
          }
        });
      } else {
        set({
          selectedFilaments: nextList,
          selectedFilament: nextList[0],
          activeFilamentSlot: nextActive,
          activeUserPreset: nextUserPreset
        });
      }
    } catch (err: any) {
      set({ engineError: 'Failed to remove filament slot: ' + (err.message || String(err)) });
    }
  },
  setSlotColor: async (slotIndex: number, newColor: string) => {
    // setOption edits one native vector cell; passing the serialized color
    // vector here would store that entire vector as a single slot's color.
    await get().applyOptionChange('filament_colour', newColor.toUpperCase(), 'filament', undefined, slotIndex);
  },

  stepImportState: null,
  setStepImportState: (state) => set({ stepImportState: state }),
  requestImportFile: (file: File) => {
    if (!get().isEngineReady) { showToast('Wait for the current operation to finish.', 'error'); return; }
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext === "step" || ext === "stp") {
      get().setStepImportState({ file });
    } else {
      get().importModelFile(file);
    }
  },
  openProjectFile: async (file: File) => {
    if (!get().isEngineReady) { showToast('Wait for the current operation to finish.', 'error'); return; }
    if (!file) return;
    set({
      isModelLoading: true,
      engineError: null,
      sliceResult: null,
      sliceStatusText: `Opening project ${file.name}...`
    });

    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const engine = await getEngine();
      const vfsPath = `/models/${file.name}`;
      await engine.writeFile(vfsPath, bytes);
      const res = await engine.call('openProject', { path: vfsPath });

      if (res.selectedPresets) {
        const { printer, process, filaments } = res.selectedPresets;
        set((state) => {
          const loadedFilaments = Array.isArray(filaments) && filaments.length > 0
            ? filaments
            : (typeof filaments === 'string' && filaments ? [filaments] : (state.selectedFilaments.length > 0 ? state.selectedFilaments : [state.selectedFilament]));
          return {
            selectedPrinter: printer || state.selectedPrinter,
            selectedProcess: process || state.selectedProcess,
            selectedFilaments: loadedFilaments,
            selectedFilament: loadedFilaments[0] || state.selectedFilament
          };
        });
        // Native project loading replaces edited presets and clears native overrides.
        // Rebuild the web maps too, or the next preset selection reapplies the
        // previous project's edits and drops the newly imported ones.
        const importedConfig = await getConfig();
        const loaded = get();
        const selection = { printer: loaded.selectedPrinter, process: loaded.selectedProcess, filaments: loaded.selectedFilaments };
        const [processConfig, printerConfig, filamentConfig] = await Promise.all([
          engine.call('getPresetConfig', { kind: 'process', name: selection.process }),
          engine.call('getPresetConfig', { kind: 'printer', name: selection.printer }),
          engine.call('getPresetConfig', { kind: 'filament', name: selection.filaments[0] })
        ]);
        await selectPresets(selection);
        const baselineConfig = await getConfig();
        const processOverrides: Record<string, string> = {};
        const filamentOverrides: Record<string, string> = {};
        const printerOverrides: Record<string, string> = {};
        const importedOverrides: Record<string, string> = {};
        for (const [key, value] of Object.entries(importedConfig)) {
          if (value === baselineConfig[key]) continue;
          importedOverrides[key] = value;
          const target = key === 'filament_colour' || key in filamentConfig ? filamentOverrides
            : key in printerConfig && !(key in processConfig) ? printerOverrides : processOverrides;
          target[key] = value;
        }
        await setOptions(importedOverrides);
        set({ currentConfig: await getConfig(), presetConfig: baselineConfig,
          processOverrides, filamentOverrides, printerOverrides,
          activeFilamentSlot: 0, activeUserPreset: { printer: null, process: null, filament: null } });
      }

      try {
        const { usePlateStore } = await import('../plate/plateStore');
        await usePlateStore.getState().refreshObjects();
      } catch (_) {}
      try {
        const { useObjectListStore } = await import('../objectlist/objectListStore');
        await useObjectListStore.getState().refreshTree();
      } catch (_) {}
      try {
        const { usePlatesStore } = await import('../plates/platesStore');
        await usePlatesStore.getState().fetchPlates();
      } catch (_) {}

      set({
        modelFile: { name: file.name, size: file.size },
        modelObjects: res.objects,
        isModelLoading: false,
        sliceStatusText: `Opened project ${file.name}`
      });

      try {
        const { useHistoryStore } = await import('../history');
        await useHistoryStore.getState().commitTransaction(`Open project ${file.name}`);
      } catch (_) {}

      showToast(`Opened project: ${file.name}`, 'success');
      try {
        await storeImportedRecentFile(file, 'project');
      } catch (_) {}
    } catch (err: any) {
      set({
        isModelLoading: false,
        engineError: `Failed to open project '${file.name}': ${err.message || String(err)}`,
        sliceStatusText: 'Project loading failed'
      });
      showToast(`Failed to open project: ${err.message || String(err)}`, 'error');
    }
  },

  saveProjectFile: async (fileName?: string) => {
    const { modelFile } = get();
    try {
      const engine = await getEngine();
      const defaultName = modelFile?.name
        ? (modelFile.name.toLowerCase().endsWith('.3mf')
            ? modelFile.name
            : `${modelFile.name.substring(0, modelFile.name.lastIndexOf('.')) || modelFile.name}.3mf`)
        : 'project.3mf';
      const outName = fileName || defaultName;
      const vfsPath = `/out/web_project_export_${++projectExportId}.3mf`;

      let bytes: Uint8Array;
      try {
        await engine.call('saveProject', { path: vfsPath });
        bytes = await engine.readFile(vfsPath);
        try {
          const { useObjectListStore } = await import('../objectlist/objectListStore');
          const { buildLayerConfigRangesXml } = await import('../objectlist/layerRangeSync');
          const objects = useObjectListStore.getState().objects;
          const xml = buildLayerConfigRangesXml(objects);
          if (xml) {
            const { unzipSync, zipSync, strToU8 } = await import('fflate');
            const unzipped = unzipSync(bytes);
            unzipped['Metadata/layer_config_ranges.xml'] = strToU8(xml);
            bytes = zipSync(unzipped);
          }
        } catch (err) {
          console.warn('[project] Failed to inject layer ranges to saved 3MF:', err);
        }
      } finally {
        // readFile copies the worker file; downloads and recent files own those bytes.
        try {
          await engine.writeFile(vfsPath, new Uint8Array());
        } catch (error) {
          console.warn('[project] Failed to release export staging:', error);
        }
      }

      const blob = new Blob([bytes as any], {
        type: 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml'
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = outName;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      void import('../shell/autosave').then((m) => m.clearAutosave());
      showToast(`Saved project: ${outName}`, 'success');
      try {
        await storeRecentFile(outName, bytes, 'project');
      } catch (_) {}
      return bytes;
    } catch (err: any) {
      showToast(`Failed to save project: ${err.message || String(err)}`, 'error');
      throw err;
    }
  },

  openGcodeFile: async (file: File) => {
    if (!get().isEngineReady) { showToast('Wait for the current operation to finish.', 'error'); return; }
    if (!file) return;
    if (get().isSlicing) get().cancelSlice();
    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);

      const { usePreviewStore } = await import('../preview/previewStore');
      let stats: any;
      try {
        stats = await usePreviewStore.getState().loadGcodeBytes(bytes, file.name);
      } catch (_) {}

      const { usePlatesStore } = await import('../plates/platesStore');
      const oldUrl = get().gcodeUrl;
      if (oldUrl) URL.revokeObjectURL(oldUrl);
      set({
        gcodeUrl: URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'text/plain' })),
        sliceResult: {
          plateIndex: usePlatesStore.getState().activePlateIndex,
          gcode: bytes,
          gcodePath: file.name,
          gcodeBytes: bytes.byteLength,
          layers: stats?.layers || 0,
          printTimeS: stats?.timeS ?? stats?.printTimeS ?? 0,
          filamentMm: stats?.filamentMm || 0,
          filamentG: stats?.filamentG || 0,
          warnings: []
        },
        sessionRecovery: 'idle',
        modelFile: { name: file.name, size: file.size }
      });

      showToast(`Loaded G-code: ${file.name}`, 'success');
      try {
        await storeRecentFile(file.name, bytes, 'gcode');
      } catch (_) {}
    } catch (err: any) {
      showToast(`Failed to load G-code: ${err.message || String(err)}`, 'error');
    }
  },

  importModelFile: async (file: File, options?: StepImportOptions, inArchive = false, context?: { source: 'builtin-handy' }) => {
    if (!get().isEngineReady) { showToast('Wait for the current operation to finish.', 'error'); return; }
    if (!file) return;
    if (!inArchive && /\.zip$/i.test(file.name)) {
      const { usePlateStore } = await import('../plate/plateStore');
      const knownArchiveIds = new Set(usePlateStore.getState().objects.map(o => o.id));
      set({ isModelLoading: true, engineError: null, sliceResult: null, sliceStatusText: `Opening ${file.name}...` });
      let imported = 0;
      try {
        const { readArchiveModels } = await import('../shell/archiveModels');
        const models = await readArchiveModels(new Uint8Array(await file.arrayBuffer()));
        for (const [index, model] of models.entries()) {
          set({ sliceStatusText: `Importing ${index + 1}/${models.length}: ${model.name}` });
          await get().importModelFile(new File([model.bytes as BlobPart], model.name), options, true, context);
          if (get().engineError) throw new Error(get().engineError!);
          imported++;
        }
        const { useHistoryStore } = await import('../history');
        if (!inArchive) await useHistoryStore.getState().commitTransaction(`Import ${file.name}`);
        showToast(`Imported ${models.length} models from ${file.name}`, 'success');
      } catch (error) {
        if (imported) {
          const { useHistoryStore } = await import('../history');
          await useHistoryStore.getState().commitTransaction(`Import ${imported} models from ${file.name}`);
        }
        set({ engineError: `ZIP import failed after ${imported} models: ${error instanceof Error ? error.message : String(error)}`, sliceStatusText: 'ZIP import failed' });
      } finally { set({ isModelLoading: false }); }
      if (imported && context?.source !== 'builtin-handy') {
        const { useEditOpsStore } = await import('../editops/editOpsStore');
        void useEditOpsStore.getState().offerImportSimplification(usePlateStore.getState().objects.filter(o => !knownArchiveIds.has(o.id)).map(o => o.id));
      }
      return;
    }
    const knownObjectIds = new Set((await import('../plate/plateStore')).usePlateStore.getState().objects.map((o) => o.id));
    set({
      isModelLoading: true,
      engineError: null,
      sliceResult: null,
      sliceStatusText: `Loading ${file.name}...`
    });

    try {
      const ext = file.name.split('.').pop()?.toLowerCase();
      let res: any;
      if (ext === 'svg') {
        const text = await file.text();
        const engine = await getEngine();
        await engine.call('addSvg', { svgText: text, name: file.name });
        const objs = await engine.listObjects();
        res = { objects: objs };
      } else {
        const buffer = await file.arrayBuffer();
        res = await addModel(file.name, new Uint8Array(buffer), options);
      }

      const { usePlateStore } = await import('../plate/plateStore');
      const { usePlatesStore } = await import('../plates/platesStore');
      const engine = await getEngine();
      const added = (await engine.listObjects()).filter((obj: PlateObject) => !knownObjectIds.has(obj.id));
      if (added.length) {
        await engine.call('placeObjects', { objectIds: added.map((obj: PlateObject) => obj.id), plateIndex: usePlatesStore.getState().activePlateIndex });
      }
      await usePlateStore.getState().refreshObjects();

      set({
        modelFile: { name: file.name, size: file.size },
        modelObjects: res.objects,
        isModelLoading: inArchive,
        sliceStatusText: `Loaded ${file.name}`
      });

      try {
        const { usePrefsStore } = await import('../prefs/prefsStore');
        if (usePrefsStore.getState().general.autoArrangeOnImport) {
          const { usePlateStore } = await import('../plate/plateStore');
          await usePlateStore.getState().arrange(true);
        }
      } catch (_) {}

      try {
        const { useHistoryStore } = await import('../history');
        if (!inArchive) await useHistoryStore.getState().commitTransaction(`Import ${file.name}`);
      } catch (_) {}

      showToast(`Imported ${file.name}`, 'success');
      if (!inArchive && context?.source !== 'builtin-handy') {
        const { useEditOpsStore } = await import('../editops/editOpsStore');
        void useEditOpsStore.getState().offerImportSimplification(added.map((obj: PlateObject) => obj.id));
      }
      try {
        await storeImportedRecentFile(file, 'model');
      } catch (_) {}
    } catch (err: any) {
      set({
        isModelLoading: inArchive,
        engineError: `Failed to load model '${file.name}': ${err.message || String(err)}`,
        sliceStatusText: 'Model loading failed'
      });
      showToast(`Failed to load model '${file.name}': ${err.message || String(err)}`, 'error');
    }
  },

  startSlice: async () => {
    // A queued setting may be waiting behind a large autosave export.
    // Slice only after its acknowledgement, using the confirmed configuration.
    if (Object.keys(get().pendingOptions).length) {
      await new Promise<void>(resolve => {
        const unsubscribe = useAppStore.subscribe(state => {
          if (!Object.keys(state.pendingOptions).length) { unsubscribe(); resolve(); }
        });
      });
      if (get().engineError) return;
    }
    const { useHistoryStore: history } = await import('../history');
    if (slicePrerequisites(get(), history.getState().isRestoring)) {
      return;
    }

    const abortController = new AbortController();
    set({
      isSlicing: true,
      slicePercent: 0,
      sliceStatusText: 'Starting slice...',
      sliceResult: null,
      engineError: null,
      abortController
    });

    try {
      const { usePrefsStore } = await import('../prefs/prefsStore');
      if (usePrefsStore.getState().general.autosave) {
        try {
          const { writeAutosave } = await import('../shell/autosave');
          await writeAutosave();
        } catch (err) {
          console.warn('[autosave] backup before slicing failed:', err);
        }
      }
      if (abortController.signal.aborted) throw new DOMException('Slicing canceled', 'AbortError');

      let currentPlateIndex: number | undefined;
      try {
        const { usePlatesStore } = await import("../plates/platesStore");
        const pIdx = usePlatesStore.getState().activePlateIndex;
        if (typeof pIdx === "number" && pIdx >= 0) {
          currentPlateIndex = pIdx;
        }
      } catch (_) {}

      try {
        const { useObjectListStore } = await import('../objectlist/objectListStore');
        const listState = useObjectListStore.getState();
        const hasRanges = listState.objects.some((o) => o.layerRanges && o.layerRanges.length > 0);
        if (hasRanges) {
          const { syncLayerRangesToEngine } = await import('../objectlist/layerRangeSync');
          await syncLayerRangesToEngine(listState.objects);
        }
      } catch (err) {
        console.warn('[slice] syncLayerRangesToEngine before slice failed:', err);
      }

      const result = await slice({
        plateIndex: currentPlateIndex,
        threads: resolveSlicingThreads(usePrefsStore.getState().general.slicingThreads),
        signal: abortController.signal,
        onProgress: (prog: ProgressNotification) => {
          const pct = Math.max(0, Math.min(100, prog.percent ?? 0));
          set({
            slicePercent: pct,
            sliceStatusText: prog.text ? `Slicing: ${prog.text} (${pct}%)` : `Slicing (${pct}%)`
          });
        }
      });

      if (abortController.signal.aborted) throw new DOMException('Slicing canceled', 'AbortError');
      performance.mark('orca-slice-end');
      if (typeof window !== 'undefined') {
        (window as any)._orcaSliceEndTime = performance.now();
      }

      const { gcodeUrl: oldUrl } = get();
      if (oldUrl) URL.revokeObjectURL(oldUrl);

      const blob = new Blob([result.gcode as unknown as BlobPart], { type: 'text/plain;charset=utf-8' });
      const gcodeUrl = URL.createObjectURL(blob);

      set({
        isSlicing: false,
        slicePercent: 100,
        sliceStatusText: 'Slicing complete!',
        sliceResult: { ...result, plateIndex: currentPlateIndex ?? 0 },
        sessionRecovery: 'idle',
        gcodeUrl,
        abortController: null
      });
    } catch (err: any) {
      const isCanceled = err.name === 'AbortError' || err.canceled || err.message === 'canceled';
      if (isCanceled) {
        set({
          isSlicing: false,
          slicePercent: 0,
          sliceStatusText: 'Slicing canceled.',
          abortController: null
        });
      } else {
        set({
          isSlicing: false,
          slicePercent: 0,
          sliceStatusText: 'Slicing failed.',
          engineError: `Slicing failed: ${err.message || String(err)}`,
          abortController: null
        });
      }
    }
  },

  cancelSlice: () => {
    const { abortController } = get();
    if (abortController) {
      abortController.abort();
    }
  },

  invalidateSlicePreview: () => {
    const { gcodeUrl } = get();
    if (gcodeUrl) {
      try {
        URL.revokeObjectURL(gcodeUrl);
      } catch (_) {}
    }
    set({
      sliceResult: null,
      gcodeUrl: null,
      slicePercent: 0,
      sliceStatusText: ''
    });
  },

  applyOptionChange: async (key: string, value: string, explicitKind, layoutIndex?: number, filamentSlot?: number | null) => {
    const { layout, activeDialog, activeFilamentSlot } = get();
    let kind: 'print' | 'filament' | 'printer' = explicitKind || (activeDialog === 'printer' ? 'printer' : activeDialog === 'filament' ? 'filament' : 'print');

    // Auto-detect kind from layout if not explicitly provided
    if (!explicitKind && layout) {
      for (const tab of layout.tabs) {
        for (const page of tab.pages) {
          for (const group of page.groups) {
            for (const line of group.lines) {
              if (line.key === key || (line.options && line.options.includes(key))) {
                kind = tab.id;
                break;
              }
            }
          }
        }
      }
    }

    // The G-code no longer matches the settings: drop a finished slice and stop one in progress.
    if (get().isSlicing) get().cancelSlice();
    get().invalidateSlicePreview();

    const isFilament = kind === 'filament' || activeDialog === 'filament';
    const filIndex = isFilament && filamentSlot !== null ? (filamentSlot ?? activeFilamentSlot ?? 0) : undefined;
    const pendingKey = pendingOptionKey(kind, key, filIndex, layoutIndex);
    const requestId = ++optionRequestId;
    set(state => ({ pendingOptions: { ...state.pendingOptions, [pendingKey]: { value, requestId } } }));
    try {
      // A null target edits a project-wide vector (for example the flush
      // matrix); a numeric target edits one physical filament slot.
      if (layoutIndex !== undefined || isFilament || get().configDefs[key]?.type === 'string') {
        await setOption({ key, value, filamentIndex: filIndex, layoutIndex });
      } else {
        await setOptions({ [key]: value });
      }
      const effectiveConfig = await getConfig();

      // Record override for this kind with the exact effective string to preserve other-slot manual edits
      if (kind === 'print') {
        set((state) => ({ processOverrides: { ...state.processOverrides, [key]: effectiveConfig[key] } }));
      } else if (kind === 'filament') {
        set((state) => ({ filamentOverrides: { ...state.filamentOverrides, [key]: effectiveConfig[key] } }));
      } else if (kind === 'printer') {
        set((state) => ({ printerOverrides: { ...state.printerOverrides, [key]: effectiveConfig[key] } }));
      }



      const ruleKind = kind === 'printer' ? 'printer' : kind === 'filament' ? 'filament' : 'print';
      const rulesRes = await evaluateRules({ kind: ruleKind, filamentIndex: get().activeFilamentSlot || 0 });

      set((state) => ({
        currentConfig: effectiveConfig,
        engineError: null,
        rulesState: {
          fields: { ...state.rulesState.fields, ...rulesRes.fields },
          fixes: rulesRes.fixes || [],
          messages: rulesRes.messages || []
        }
      }));

      // Check for fixes/dialog prompts (e.g. spiral vase)
      if (rulesRes.fixes && rulesRes.fixes.length > 0) {
        // Find general reason or first fix reason
        const reason = rulesRes.fixes[0]?.reason.split('[')[0]?.trim() || rulesRes.fixes[0]?.reason;
        set({
          pendingFixes: rulesRes.fixes,
          pendingFixReason: reason,
          pendingFixTriggerKey: key
        });
      }

      try {
        const { usePrefsStore } = await import('../prefs/prefsStore');
        if (usePrefsStore.getState().general.autoSliceAfterChange) {
          void get().startSlice();
        }
      } catch (_) {}
    } catch (err: any) {
      set({ engineError: `Failed to set option '${key}': ${err.message || String(err)}` });
    } finally {
      // An older reply must not remove a newer edit to the same control.
      if (get().pendingOptions[pendingKey]?.requestId === requestId) {
        set(state => {
          const pendingOptions = { ...state.pendingOptions };
          delete pendingOptions[pendingKey];
          return { pendingOptions };
        });
      }
    }
  },

  resetOption: async (key: string, explicitKind, layoutIndex?: number) => {
    const { presetConfig, layout, activeDialog } = get();
    let kind: 'print' | 'filament' | 'printer' = explicitKind || (activeDialog === 'printer' ? 'printer' : activeDialog === 'filament' ? 'filament' : 'print');

    if (!explicitKind && layout) {
      for (const tab of layout.tabs) {
        for (const page of tab.pages) {
          for (const group of page.groups) {
            for (const line of group.lines) {
              if (line.key === key || (line.options && line.options.includes(key))) {
                kind = tab.id;
                break;
              }
            }
          }
        }
      }
    }

    if (get().isSlicing) get().cancelSlice();
    get().invalidateSlicePreview();

    try {
      const isFilament = kind === 'filament' || activeDialog === 'filament';
      const filamentIndex = isFilament ? get().activeFilamentSlot : undefined;
      const fullPresetVal = presetConfig[key];

      // Fetch native projected baseline for slot and layout using full preset baseline vector
      const baselineRes = await getOption({
        key,
        filamentIndex,
        layoutIndex,
        serializedValue: fullPresetVal
      });
      const projectedBaseline = baselineRes.value;

      if (layoutIndex !== undefined || isFilament || get().configDefs[key]?.type === 'string') {
        await setOption({ key, value: projectedBaseline, filamentIndex, layoutIndex });
      } else {
        await setOptions({ [key]: projectedBaseline });
      }
      const effectiveConfig = await getConfig();

      if (kind === 'print') {
        const savedName = get().activeUserPreset.process;
        const savedValues = savedName ? await normalizePersistedOptions(effectivePreset('process', savedName, get().userPresets).values) : {};
        set((state) => {
          const next = { ...state.processOverrides };
          // The native engine loads the system parent, so saved user values
          // must remain in the effective override map after a reset.
          if (savedValues[key] !== undefined || effectiveConfig[key] !== presetConfig[key]) next[key] = effectiveConfig[key];
          else delete next[key];
          return { processOverrides: next };
        });
      } else if (kind === 'filament') {
        set((state) => {
          const next = { ...state.filamentOverrides };
          const baseFull = presetConfig[key];
          if (baseFull !== undefined && effectiveConfig[key] === baseFull) {
            delete next[key];
          } else {
            next[key] = effectiveConfig[key];
          }
          return { filamentOverrides: next };
        });
      } else if (kind === 'printer') {
        const savedName = get().activeUserPreset.printer;
        const savedValues = savedName ? await normalizePersistedOptions(effectivePreset('printer', savedName, get().userPresets).values) : {};
        set((state) => {
          const next = { ...state.printerOverrides };
          if (savedValues[key] !== undefined || effectiveConfig[key] !== presetConfig[key]) next[key] = effectiveConfig[key];
          else delete next[key];
          return { printerOverrides: next };
        });
      }

        const ruleKind = kind === 'printer' ? 'printer' : kind === 'filament' ? 'filament' : 'print';
        const rulesRes = await evaluateRules({ kind: ruleKind, filamentIndex: get().activeFilamentSlot || 0 });

        set((state) => ({
          currentConfig: effectiveConfig,
          rulesState: {
            fields: { ...state.rulesState.fields, ...rulesRes.fields },
            fixes: rulesRes.fixes || [],
            messages: rulesRes.messages || []
          }
        }));
      } catch (err: any) {
        set({ engineError: `Failed to reset option '${key}': ${err.message || String(err)}` });
      }
  },

  applyFixes: async (branch: 'yes' | 'no') => {
    const { pendingFixes, pendingFixTriggerKey, activeDialog } = get();
    if (!pendingFixes || pendingFixes.length === 0) {
      set({ pendingFixes: null, pendingFixReason: null, pendingFixTriggerKey: null });
      return;
    }

    try {
      const overridesUpdate: Record<string, string> = {};
      if (branch === 'yes') {
        // Apply all Yes fixes (or all fixes that are not explicitly the No alternative)
        const yesFixes = pendingFixes.filter((f) => !isNoRuleFix(f));
        for (const f of yesFixes) {
          overridesUpdate[f.key] = f.value;
        }
        await setOptions(overridesUpdate);
      } else {
        // User canceled / rejected -> apply No fix (e.g. spiral_mode = 0)
        const noFixes = pendingFixes.filter(isNoRuleFix);
        if (noFixes.length) {
          for (const fix of noFixes) overridesUpdate[fix.key] = fix.value;
          await setOptions(overridesUpdate);
        } else if (pendingFixTriggerKey) {
          const { presetConfig } = get();
          const restoreVal = presetConfig[pendingFixTriggerKey] || '0';
          overridesUpdate[pendingFixTriggerKey] = restoreVal;
          await setOptions({ [pendingFixTriggerKey]: restoreVal });
        }
      }

      const effectiveConfig = await getConfig();

      const kind = activeDialog === 'printer' ? 'printer' : activeDialog === 'filament' ? 'filament' : 'print';
      const rulesRes = await evaluateRules({ kind, filamentIndex: get().activeFilamentSlot || 0 });

      set((state) => {
        const nextOverrides = { ...state.processOverrides };
        if (branch === 'yes') {
          Object.assign(nextOverrides, overridesUpdate);
        } else {
          const saved = state.userPresets.find(preset => preset.kind === 'process' && preset.name === state.activeUserPreset.process);
          for (const k of Object.keys(overridesUpdate)) {
            if (saved?.values[k] !== undefined) nextOverrides[k] = effectiveConfig[k];
            else delete nextOverrides[k];
          }
        }
        return {
          processOverrides: nextOverrides,
          currentConfig: effectiveConfig,
          rulesState: {
            fields: { ...state.rulesState.fields, ...rulesRes.fields },
            fixes: rulesRes.fixes || [],
            messages: rulesRes.messages || []
          },
          pendingFixes: null,
          pendingFixReason: null,
          pendingFixTriggerKey: null
        };
      });
    } catch (err: any) {
      set({ engineError: `Failed to apply rule fixes: ${err.message || String(err)}` });
    }
  },

  closeFixesDialog: () => {
    set({ pendingFixes: null, pendingFixReason: null, pendingFixTriggerKey: null });
  },

  selectUserPreset: async (kind: PresetKind, name: string, slotIndex: number = 0) => {
    const { userPresets, selectedPrinter, selectedProcess, selectedFilament } = get();
    const preset = userPresets.find((p) => p.kind === kind && p.name === name);
    if (!preset) return;
    if (get().isSlicing) get().cancelSlice();
    get().invalidateSlicePreview();

    // Snapshot existing valid state to preserve on failure
    const prevState = {
      activeUserPreset: { ...get().activeUserPreset },
      selectedPrinter: get().selectedPrinter,
      selectedProcess: get().selectedProcess,
      selectedFilament: get().selectedFilament,
      selectedFilaments: [...get().selectedFilaments],
      processOverrides: { ...get().processOverrides },
      filamentOverrides: { ...get().filamentOverrides },
      printerOverrides: { ...get().printerOverrides },
      presetConfig: { ...get().presetConfig },
      currentConfig: { ...get().currentConfig },
    };

    try {
      let systemParent = resolveSystemPreset(kind, name, userPresets);
      systemParent = await canonicalPresetName(kind, systemParent) || systemParent;
      const loadedParents = await listPresets(kind, { compatibleOnly: false });
      const loadedParent = loadedParents.find(parent => parent.name === systemParent);
      let parentVendor = loadedParent?.vendor;
      if (loadedParent && kind === 'printer' && !get().vendors.some(vendor => vendor.name === parentVendor)) {
        // Native vendor display names can differ from packaged bundle identifiers (for example BBL).
        parentVendor = await findPresetVendor('machine', systemParent, get().vendors.map(vendor => vendor.name));
      }
      if (!loadedParent) {
        parentVendor = await findPresetVendor(
          kind === 'printer' ? 'machine' : kind, systemParent,
          get().vendors.map(vendor => vendor.name), get().selectedVendor,
        );
        if (!parentVendor) throw new Error(`Unknown ${kind} preset: ${systemParent}`);
        // Loading a dependency must not choose defaults or clear saved overrides.
        await loadVendors([parentVendor]);
        systemParent = await canonicalPresetName(kind, systemParent) || systemParent;
      }

      if (kind === 'process') {
        const targetActive = { ...prevState.activeUserPreset, process: name };
        const systemPrinter = resolveSystemPreset('printer', selectedPrinter, userPresets);
        const { selectedFilaments: curFils } = get();
        const filamentsList = curFils && curFils.length > 0 ? curFils : [selectedFilament];
        const systemFilaments = filamentsList.map((f) => resolveSystemPreset('filament', f, userPresets));

        await selectPresets({
          printer: systemPrinter,
          process: systemParent,
          filaments: systemFilaments
        });

        const baselineConfig = await computeBaselineConfig(filamentsList, userPresets, targetActive);
        const nextProcessOverrides = await normalizePersistedOptions(effectivePreset(kind, name, userPresets).values);
        const { filamentOverrides, printerOverrides } = get();
        const allOverrides = { ...nextProcessOverrides, ...filamentOverrides, ...printerOverrides };
        await reapplyPresetOverrides(filamentsList, allOverrides);

        const effectiveConfig = await getConfig();

        // Canonicalize baseline values with native effective values for known keys
        for (const [k, v] of Object.entries(nextProcessOverrides)) {
          if (k in effectiveConfig && !(k in filamentOverrides) && !(k in printerOverrides)) {
            baselineConfig[k] = effectiveConfig[k];
          }
        }

        const rulesRes = await evaluateRules({ kind: 'print', filamentIndex: get().activeFilamentSlot || 0 });

        set({
          activeUserPreset: targetActive,
          selectedProcess: name,
          processOverrides: nextProcessOverrides,
          presetConfig: baselineConfig,
          currentConfig: effectiveConfig,
          engineError: null,
          rulesState: {
            fields: rulesRes.fields || {},
            fixes: rulesRes.fixes || [],
            messages: rulesRes.messages || []
          }
        });
      } else if (kind === 'filament') {
        // Recovery may select a saved preset into a slot that does not exist
        // yet. Create it before resetting that slot's native override cells.
        if (slotIndex === get().selectedFilaments.length) await get().addFilamentSlot();
        const { selectedFilaments: curFils, filamentOverrides: curFilOverrides } = get();
        const currentList = curFils && curFils.length > 0 ? [...curFils] : [name];
        currentList[slotIndex] = name;

        const targetActive = {
          ...prevState.activeUserPreset,
          filament: userPresets.some(user => user.kind === 'filament' && user.name === currentList[0]) ? currentList[0] : null
        };

        const projectColours = get().currentConfig.filament_colour;
        const systemPrinter = resolveSystemPreset('printer', selectedPrinter, userPresets);
        const systemProcess = resolveSystemPreset('process', selectedProcess, userPresets);
        const systemFilaments = currentList.map((f) => resolveSystemPreset('filament', f, userPresets));

        await selectPresets({
          printer: systemPrinter,
          process: systemProcess,
          filaments: systemFilaments
        });

        const baselineConfig = await computeBaselineConfig(currentList, userPresets, targetActive);

        // Replace only this slot's manual cells with its saved preset values.
        // A sibling override must not reintroduce this slot's system defaults.
        const resetRes = await resetOptions({
          filamentIndex: slotIndex,
          overrides: curFilOverrides,
          baseline: baselineConfig
        });
        const nextFilOverrides = resetRes.filamentOverrides || { ...curFilOverrides };
        if (projectColours) nextFilOverrides.filament_colour = projectColours;

        const { processOverrides, printerOverrides } = get();
        const allOverrides = { ...processOverrides, ...nextFilOverrides, ...printerOverrides };
        await reapplyPresetOverrides(currentList, allOverrides);

        const effectiveConfig = await getConfig();

        const rulesRes = await evaluateRules({ kind: 'print', filamentIndex: get().activeFilamentSlot || 0 });

        set({
          activeUserPreset: targetActive,
          selectedFilament: currentList[0],
          selectedFilaments: currentList,
          filamentOverrides: nextFilOverrides,
          presetConfig: baselineConfig,
          currentConfig: effectiveConfig,
          engineError: null,
          rulesState: {
            fields: rulesRes.fields || {},
            fixes: rulesRes.fixes || [],
            messages: rulesRes.messages || []
          }
        });
      } else if (kind === 'printer') {
        const targetActive = { ...prevState.activeUserPreset, printer: name };
        const systemProcess = resolveSystemPreset('process', selectedProcess, userPresets);
        const { selectedFilaments: curFils } = get();
        const filamentsList = curFils && curFils.length > 0 ? curFils : [selectedFilament];
        const systemFilaments = filamentsList.map((f) => resolveSystemPreset('filament', f, userPresets));

        await selectPresets({
          printer: systemParent,
          process: systemProcess,
          filaments: systemFilaments
        });

        const baselineConfig = await computeBaselineConfig(filamentsList, userPresets, targetActive);
        const nextPrinterOverrides = await normalizePersistedOptions(effectivePreset(kind, name, userPresets).values);
        const { processOverrides, filamentOverrides } = get();
        const allOverrides = { ...processOverrides, ...filamentOverrides, ...nextPrinterOverrides };
        await reapplyPresetOverrides(filamentsList, allOverrides);

        const effectiveConfig = await getConfig();

        for (const [k, v] of Object.entries(nextPrinterOverrides)) {
          if (k in effectiveConfig && !(k in processOverrides) && !(k in filamentOverrides)) {
            baselineConfig[k] = effectiveConfig[k];
          }
        }

        const rulesRes = await evaluateRules({ kind: 'print', filamentIndex: get().activeFilamentSlot || 0 });

        // Update compatible processes and filaments for this printer base
        const [compProcesses, compFilaments, printers] = await Promise.all([
          listPresets('process', { compatibleOnly: true }),
          listPresets('filament', { compatibleOnly: true }),
          listPresets('printer', { compatibleOnly: false })
        ]);

        set({
          selectedVendor: parentVendor || get().selectedVendor,
          printers,
          ...(compProcesses.length > 0 ? { processes: compProcesses } : {}),
          ...(compFilaments.length > 0 ? { filaments: compFilaments } : {}),
          activeUserPreset: targetActive,
          selectedPrinter: name,
          printerOverrides: nextPrinterOverrides,
          presetConfig: baselineConfig,
          currentConfig: effectiveConfig,
          engineError: null,
          rulesState: {
            fields: rulesRes.fields || {},
            fixes: rulesRes.fixes || [],
            messages: rulesRes.messages || []
          }
        });
      }
    } catch (err: any) {
      // Revert native engine back to previous valid selection and overrides
      try {
        const prevSystemPrinter = resolveSystemPreset('printer', prevState.selectedPrinter, userPresets);
        const prevSystemProcess = resolveSystemPreset('process', prevState.selectedProcess, userPresets);
        const prevFilaments = prevState.selectedFilaments && prevState.selectedFilaments.length > 0
          ? prevState.selectedFilaments : [prevState.selectedFilament];
        const prevSystemFilaments = prevFilaments.map((f) => resolveSystemPreset('filament', f, userPresets));
        await selectPresets({
          printer: prevSystemPrinter,
          process: prevSystemProcess,
          filaments: prevSystemFilaments
        });
        const prevAllOverrides = {
          ...prevState.processOverrides,
          ...prevState.filamentOverrides,
          ...prevState.printerOverrides
        };
        if (Object.keys(prevAllOverrides).length > 0) {
          await reapplyPresetOverrides(prevFilaments, prevAllOverrides);
        }
      } catch (_) {}

      // Preserve previous valid selection and baseline in Zustand store, and surface engineError
      set({
        ...prevState,
        engineError: `Failed to select user preset '${name}': ${err.message || String(err)}`
      });
    }
  },

  saveCurrentUserPreset: async (kind: PresetKind, name: string) =>
    runPresetManagementAction(() => saveCurrentUserPresetHelper(get, set, kind, name)),
  duplicateUserPresetAction: async (kind: PresetKind, sourceName: string, newName: string) =>
    runPresetManagementAction(() => duplicateUserPresetHelper(get, set, kind, sourceName, newName)),
  deleteUserPresetAction: async (kind: PresetKind, name: string) =>
    runPresetManagementAction(() => deleteUserPresetHelper(get, set, kind, name)),
  renameUserPresetAction: async (kind: PresetKind, oldName: string, newName: string) =>
    renameUserPresetHelper(get, set, kind, oldName, newName),
  importPresetBundleAction: async (bundleData: unknown, strategy: ConflictStrategy = 'overwrite') =>
    importUserPresetsHelper(get, set, bundleData, strategy),
  exportPresetBundleAction: (kinds?: PresetKind[], description?: string) =>
    exportUserPresetsHelper(get, kinds, description),
  exportDesktopArchiveAction: async (archiveType?: 'printer' | 'filament' | 'all', targetName?: string) =>
    await exportDesktopArchiveHelper(get, archiveType, targetName)
}));

if (typeof window !== 'undefined') {
  (window as any).__appStore = useAppStore;
}

usePrinterCatalog.subscribe(({ vendors }) => {
  if (vendors.length) useAppStore.setState({ vendors });
});

const selectedDevice = () => {
  const { printers, selectedPrinterId } = usePrinterConnectionStore.getState();
  return printers.find((p) => p.id === selectedPrinterId);
};

let applyingDevice = true;

/** Older saved devices did not record a brand. Resolve it without changing the engine. */
export async function resolveDeviceVendor(device: { id: string; preset?: string; vendor?: string }): Promise<string | undefined> {
  if (device.vendor || !device.preset) return device.vendor;
  const state = useAppStore.getState();
  const targetPreset = resolveSystemPreset('printer', device.preset, state.userPresets);
  // New selections remember their vendor. Older browser data can usually be
  // resolved from one named bundle, without downloading the discovery index.
  let saved: { printer?: string; vendor?: string } | null = null;
  try { saved = JSON.parse(localStorage.getItem('orca.lastSetup') || 'null'); } catch {}
  const hint = saved?.printer === device.preset && saved.vendor ? saved.vendor :
    targetPreset.startsWith('Bambu ') ? 'BBL' : targetPreset.startsWith('Original Prusa ') ? 'Prusa' : targetPreset.split(' ')[0];
  const matches = await systemProfiles(hint, 'machine').catch(() => []);
  // The index fallback migrates old names whose brand cannot be inferred. It is
  // not needed again after the successful selection records the actual vendor.
  const vendor = matches.some(p => profileHasName(p, targetPreset)) ? hint :
    await findPresetVendor('machine', targetPreset, (await loadPrinterCatalog()).map(v => v.name));
  if (vendor) {
    const store = usePrinterConnectionStore.getState();
    const saved = store.printers.find((p) => p.id === device.id);
    if (saved) usePrinterConnectionStore.setState({ printers: store.printers.map((p) => p.id === device.id ? { ...p, vendor } : p) });
    return vendor;
  }
  return undefined;
}

const LAST_SETUP_KEY = 'orca.lastSetup';

/** Restores the printer, process and filaments picked last time when no device decides them. */
async function restoreLastSetup() {
  let saved: { printer?: string; process?: string; filaments?: string[] } | null = null;
  try { saved = JSON.parse(localStorage.getItem(LAST_SETUP_KEY) || 'null'); } catch { /* ignore */ }
  if (!saved?.printer) return;
  const app = () => useAppStore.getState();
  const userOf = (kind: PresetKind, name: string) => app().userPresets.find((p) => p.kind === kind && p.name === name);
  const userPrinter = userOf('printer', saved.printer);
  const systemPrinter = resolveSystemPreset('printer', saved.printer, app().userPresets);
  const vendor = await resolveDeviceVendor({ id: '', preset: saved.printer });
  if (!vendor) return;
  if (vendor !== app().selectedVendor) await app().chooseVendor(vendor);
  const canonicalPrinter = await canonicalPresetName('printer', systemPrinter);
  if (!canonicalPrinter) return;
  await app().choosePrinter(canonicalPrinter);
  if (userPrinter) await app().selectUserPreset('printer', saved.printer);
  if (saved.process) {
    if (userOf('process', saved.process)) await app().selectUserPreset('process', saved.process);
    else {
      const canonical = await canonicalPresetName('process', saved.process);
      if (canonical) await app().chooseProcess(canonical);
    }
  }
  for (const [slot, name] of (saved.filaments || []).entries()) {
    if (slot > 0 && slot >= app().selectedFilaments.length) await app().addFilamentSlot();
    if (userOf('filament', name)) await app().selectUserPreset('filament', name, slot);
    else {
      const canonical = await canonicalPresetName('filament', name);
      if (canonical) await app().chooseFilament(canonical, slot);
    }
  }
}

useAppStore.subscribe((state, previous) => {
  if (applyingDevice || !state.isEngineReady || state.isModelLoading || state.engineError || !state.selectedPrinter) return;
  if (state.selectedPrinter === previous.selectedPrinter && state.selectedProcess === previous.selectedProcess &&
      state.selectedFilaments === previous.selectedFilaments) return;
  try {
    localStorage.setItem(LAST_SETUP_KEY, JSON.stringify({
      printer: state.selectedPrinter, vendor: state.selectedVendor, process: state.selectedProcess, filaments: state.selectedFilaments
    }));
  } catch { /* storage unavailable */ }
});

async function restoreDeviceFilaments() {
  const device = selectedDevice();
  if (!device?.filamentPresets?.length) return;
  const app = useAppStore.getState();
  const fallback = app.selectedFilaments[0] || app.selectedFilament;
  // Keep physical slot indices and colors together even if a saved preset
  // was deleted. That slot falls back to the selected printer's default.
  const valid = await Promise.all(device.filamentPresets.map(async name =>
    app.userPresets.some(preset => preset.kind === 'filament' && preset.name === name)
      ? name : await canonicalPresetName('filament', name) || fallback));
  // Use the normal preset path so all per-slot settings reach the engine, not just the dropdowns.
  for (let i = 0; i < valid.length; i++) {
    const user = useAppStore.getState().userPresets.find((p) => p.kind === 'filament' && p.name === valid[i]);
    if (user) await useAppStore.getState().selectUserPreset('filament', valid[i], i);
    else await useAppStore.getState().chooseFilament(valid[i], i);
  }
  while (useAppStore.getState().selectedFilaments.length > valid.length) await useAppStore.getState().removeFilamentSlot();
  for (let i = 0; i < valid.length; i++) {
    if (device.filamentColors?.[i]) await useAppStore.getState().setSlotColor(i, device.filamentColors[i]);
  }
}

/** Selects the connected device's printer and filament setup. */
async function applyDevicePreset() {
  const device = selectedDevice();
  const state = useAppStore.getState();
  if (!state.isEngineReady || !device?.preset) return;
  applyingDevice = true;
  useAppStore.setState({ isEngineReady: false, isEngineInitializing: true });
  try {
    const vendor = await resolveDeviceVendor(device);
    const isUser = state.userPresets.some((p) => p.kind === 'printer' && p.name === device.preset);
    if (vendor && vendor !== state.selectedVendor) {
      await state.chooseVendor(vendor);
    }
    const curState = useAppStore.getState();
    const canonicalPrinter = isUser ? undefined : await canonicalPresetName('printer', device.preset);
    if (!isUser && !canonicalPrinter) return;
    if (isUser && !curState.userPresets.some((p) => p.kind === 'printer' && p.name === device.preset)) return;
    // Two devices can share a machine profile and have different spools.
    // Start from its default rather than inheriting the previous device's slots.
    useAppStore.setState({ filamentOverrides: {}, activeFilamentSlot: 0 });
    if (isUser) {
      await useAppStore.getState().choosePrinter(resolveSystemPreset('printer', device.preset, curState.userPresets));
      await useAppStore.getState().selectUserPreset('printer', device.preset);
    } else {
      await useAppStore.getState().choosePrinter(canonicalPrinter!);
    }
    await restoreDeviceFilaments();
  } finally {
    applyingDevice = false;
    useAppStore.setState({ isEngineReady: true, isEngineInitializing: false });
  }
}

let lastDeviceId = usePrinterConnectionStore.getState().selectedPrinterId;
let deviceSwitch = Promise.resolve();
let selectingPrinterProfile = false;

/** Keep a complete UI printer pick ahead of queued device switches and out of spool persistence. */
export function withPrinterProfileSelection(select: () => Promise<void>): Promise<void> {
  const selection = deviceSwitch.then(async () => {
    selectingPrinterProfile = true;
    try {
      await select();
    } finally {
      selectingPrinterProfile = false;
    }
  });
  // A failed pick must not prevent the next device switch; the caller receives the failure.
  deviceSwitch = selection.catch(() => {});
  return selection;
}

usePrinterConnectionStore.subscribe((s) => {
  if (s.selectedPrinterId === lastDeviceId) return;
  lastDeviceId = s.selectedPrinterId;
  deviceSwitch = deviceSwitch.then(applyDevicePreset).catch((err) => {
    useAppStore.setState({ engineError: String(err) });
  });
});

useAppStore.subscribe((state, previous) => {
  if (previous.gcodeUrl && previous.gcodeUrl !== state.gcodeUrl)
    URL.revokeObjectURL(previous.gcodeUrl);
  if (!state.sliceResult && state.gcodeUrl)
    useAppStore.setState({ gcodeUrl: null });
  if (state.sliceResult?.gcode !== previous.sliceResult?.gcode)
    clearExportGcodeCache(state.sliceResult?.gcode ?? null);
  if (applyingDevice || selectingPrinterProfile || !state.isEngineReady || state.isModelLoading || state.engineError) return;
  const device = selectedDevice();
  if (!device || device.preset !== state.selectedPrinter) return;
  if (state.selectedFilaments === previous.selectedFilaments && state.currentConfig.filament_colour === previous.currentConfig.filament_colour) return;
  usePrinterConnectionStore.getState().saveFilaments(device.id, [...state.selectedFilaments], (state.currentConfig.filament_colour || '').split(';'));
});
