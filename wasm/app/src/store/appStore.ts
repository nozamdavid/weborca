import { showToast } from '../shell/toastStore';
import { storeRecentFile } from '../shell/recentFiles';
/**
 * @file appStore.ts
 * Zustand state store for OrcaSlicer Web.
 */

import { create } from 'zustand';
import {
  getEngine,
  loadVendors,
  listPresets,
  selectPresets,
  getConfig,
  getConfigDef,
  evaluateRules,
  setOptions,
  addModel,
  arrange,
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
import {
  saveCurrentUserPresetHelper,
  duplicateUserPresetHelper,
  deleteUserPresetHelper,
  renameUserPresetHelper,
  importUserPresetsHelper,
  exportUserPresetsHelper,
  exportDesktopArchiveHelper
} from '../presets/presetActions';

export interface AppState {
  // Cross-origin isolation
  isIsolated: boolean;

  // Engine lifecycle
  isEngineInitializing: boolean;
  isEngineReady: boolean;
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

  // Model state
  modelFile: { name: string; size: number } | null;
  modelObjects: ModelObjectInfo[] | null;
  isModelLoading: boolean;

  // Slicing state
  isSlicing: boolean;
  slicePercent: number;
  sliceStatusText: string;
  sliceResult: SliceResult | null;
  gcodeUrl: string | null;
  abortController: AbortController | null;

  // Settings layout & config
  layout: SettingsLayout | null;
  configDefs: Record<string, ConfigOptionDef>;
  presetConfig: Record<string, string>;
  currentConfig: Record<string, string>;

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
  openDialog: (dialog: 'printer' | 'filament') => void;
  closeDialog: () => void;

  savePresetDialogTarget: { kind: PresetKind; baseName: string } | null;
  openSavePresetDialog: (kind: PresetKind) => void;
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
  chooseFilament: (filament: string) => Promise<void>;
  stepImportState: { file: File } | null;
  setStepImportState: (state: { file: File } | null) => void;
  requestImportFile: (file: File) => void;
  importModelFile: (file: File, options?: StepImportOptions) => Promise<void>;
  openProjectFile: (file: File) => Promise<void>;
  saveProjectFile: (fileName?: string) => Promise<Uint8Array | null>;
  openGcodeFile: (file: File) => Promise<void>;
  startSlice: () => Promise<void>;
  cancelSlice: () => void;
  invalidateSlicePreview: () => void;

  // Settings Actions
  applyOptionChange: (key: string, value: string, kind?: 'print' | 'filament' | 'printer') => Promise<void>;
  resetOption: (key: string, kind?: 'print' | 'filament' | 'printer') => Promise<void>;
  applyFixes: (branch: 'yes' | 'no') => Promise<void>;
  closeFixesDialog: () => void;

  // User Preset Actions
  selectUserPreset: (kind: PresetKind, name: string) => Promise<void>;
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
  if (!name) return '';
  const user = userPresets.find((p) => p.kind === kind && p.name === name);
  return user ? user.inherits : name;
}

export const useAppStore = create<AppState>((set, get) => ({
  isIsolated: typeof window !== 'undefined' ? !!window.crossOriginIsolated : false,

  isEngineInitializing: false,
  isEngineReady: false,
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

  modelFile: null,
  modelObjects: null,
  isModelLoading: false,

  isSlicing: false,
  slicePercent: 0,
  sliceStatusText: '',
  sliceResult: null,
  gcodeUrl: null,
  abortController: null,

  layout: null,
  configDefs: {},
  presetConfig: {},
  currentConfig: {},

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
  openDialog: async (dialog) => {
    set({ activeDialog: dialog });
    // Evaluate rules for the opened dialog
    const kind = dialog === 'printer' ? 'printer' : 'filament';
    try {
      const res = await evaluateRules({ kind, filamentIndex: 0 });
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
      evaluateRules({ kind: 'print', filamentIndex: 0 }).then((res) => {
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
  openSavePresetDialog: (kind) => {
    const { selectedPrinter, selectedProcess, selectedFilament } = get();
    let baseName = '';
    if (kind === 'process') baseName = selectedProcess;
    else if (kind === 'filament') baseName = selectedFilament;
    else if (kind === 'printer') baseName = selectedPrinter;
    set({ savePresetDialogTarget: { kind, baseName } });
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

    for (const tab of layout.tabs) {
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
                const el = document.getElementById(`setting-row-${key}`);
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
    const isIsolated = typeof window !== 'undefined' ? !!window.crossOriginIsolated : false,
      setIsolated = isIsolated;
    set({ isIsolated: setIsolated });
    if (!isIsolated) return;

    set({ isEngineInitializing: true, engineError: null });

    try {
      await getEngine();

      // Fetch layout and configDefs in parallel
      const [indexRes, layoutRes, configDefs, userPresets] = await Promise.all([
        fetch('/profiles/index.json').then((r) => r.json()),
        fetch('/settings/layout.json').then((r) => r.json()),
        getConfigDef(),
        loadUserPresets()
      ]);

      const vendors: VendorInfo[] = (indexRes as VendorInfo[]).filter((v) => v.name !== 'OrcaFilamentLibrary');

      set({
        vendors,
        layout: layoutRes as SettingsLayout,
        configDefs,
        userPresets,
        isEngineReady: true,
        isEngineInitializing: false
      });

      try {
        const { useHistoryStore } = await import('../history');
        await useHistoryStore.getState().initHistory();
      } catch (_) {}

      // Pick default vendor
      const defaultVendor = vendors.some((v) => v.name === 'Voron')
        ? 'Voron'
        : vendors[0]?.name || '';

      if (defaultVendor) {
        await get().chooseVendor(defaultVendor);
      }
    } catch (err: any) {
      set({
        isEngineInitializing: false,
        engineError: `Engine initialization failed: ${err.message || String(err)}`
      });
    }
  },

  chooseVendor: async (vendor: string) => {
    if (!vendor) return;
    set({ selectedVendor: vendor, engineError: null });

    try {
      await loadVendors([vendor]);
      const printers = await listPresets('printer', { compatibleOnly: false });

      let chosenPrinter = printers[0]?.name || '';
      if (vendor === 'Voron' && printers.some((p) => p.name === 'Voron 2.4 300 0.4 nozzle')) {
        chosenPrinter = 'Voron 2.4 300 0.4 nozzle';
      } else if (vendor === 'BBL' && printers.some((p) => p.name === 'Bambu Lab X1 Carbon 0.4 nozzle')) {
        chosenPrinter = 'Bambu Lab X1 Carbon 0.4 nozzle';
      }

      set({ printers, selectedPrinter: chosenPrinter });

      if (chosenPrinter) {
        await get().choosePrinter(chosenPrinter);
      }
    } catch (err: any) {
      set({ engineError: `Failed to load vendor '${vendor}': ${err.message || String(err)}` });
    }
  },

  choosePrinter: async (printer: string) => {
    if (!printer) return;
    set({ selectedPrinter: printer, engineError: null });

    try {
      const allProcesses = await listPresets('process', { compatibleOnly: false });
      const allFilaments = await listPresets('filament', { compatibleOnly: false });

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
        defaultProc = allProcesses[0]?.name || '';
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
        if (Object.keys(activeOverrides).length > 0) {
          await setOptions(activeOverrides);
        }

        const effectiveConfig = await getConfig();
        const rulesRes = await evaluateRules({ kind: 'print', filamentIndex: 0 });

        let processes = await listPresets('process', { compatibleOnly: true });
        if (processes.length === 0) processes = allProcesses;
        if (!processes.some((p) => p.name === defaultProc)) {
          defaultProc = processes[0]?.name || defaultProc;
        }

        let filaments = await listPresets('filament', { compatibleOnly: true });
        if (filaments.length === 0) filaments = allFilaments;
        if (!filaments.some((f) => f.name === defaultFilament)) {
          defaultFilament = filaments[0]?.name || defaultFilament;
        }

        set({
          processes,
          selectedProcess: defaultProc,
          filaments,
          selectedFilament: defaultFilament,
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
      set({ engineError: `Failed to select printer '${printer}': ${err.message || String(err)}` });
    }
  },

  chooseProcess: async (process: string) => {
    if (!process) return;
    const { selectedPrinter, selectedFilament, userPresets } = get();
    set({ selectedProcess: process, engineError: null });

    try {
      if (selectedPrinter && selectedFilament) {
        // Clear process overrides when selecting a new system process
        set((state) => ({
          processOverrides: {},
          activeUserPreset: { ...state.activeUserPreset, process: null }
        }));

        const systemPrinter = resolveSystemPreset('printer', selectedPrinter, userPresets);
        const systemFilament = resolveSystemPreset('filament', selectedFilament, userPresets);

        await selectPresets({
          printer: systemPrinter,
          process,
          filaments: [systemFilament]
        });

        const baselineConfig = await getConfig();

        // Re-apply remaining filament and printer overrides
        const { filamentOverrides, printerOverrides } = get();
        const activeOverrides = { ...filamentOverrides, ...printerOverrides };
        if (Object.keys(activeOverrides).length > 0) {
          await setOptions(activeOverrides);
        }

        const effectiveConfig = await getConfig();
        const rulesRes = await evaluateRules({ kind: 'print', filamentIndex: 0 });

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

  chooseFilament: async (filament: string) => {
    if (!filament) return;
    const { selectedPrinter, selectedProcess, userPresets } = get();
    set({ selectedFilament: filament, engineError: null });

    try {
      if (selectedPrinter && selectedProcess) {
        // Clear filament overrides when selecting a new system filament
        set((state) => ({
          filamentOverrides: {},
          activeUserPreset: { ...state.activeUserPreset, filament: null }
        }));

        const systemPrinter = resolveSystemPreset('printer', selectedPrinter, userPresets);
        const systemProcess = resolveSystemPreset('process', selectedProcess, userPresets);

        await selectPresets({
          printer: systemPrinter,
          process: systemProcess,
          filaments: [filament]
        });

        const baselineConfig = await getConfig();

        // Re-apply process and printer overrides
        const { processOverrides, printerOverrides } = get();
        const activeOverrides = { ...processOverrides, ...printerOverrides };
        if (Object.keys(activeOverrides).length > 0) {
          await setOptions(activeOverrides);
        }

        const effectiveConfig = await getConfig();
        const rulesRes = await evaluateRules({ kind: 'print', filamentIndex: 0 });

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
      set({ engineError: `Failed to select filament '${filament}': ${err.message || String(err)}` });
    }
  },

  stepImportState: null,
  setStepImportState: (state) => set({ stepImportState: state }),
  requestImportFile: (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext === "step" || ext === "stp") {
      get().setStepImportState({ file });
    } else {
      get().importModelFile(file);
    }
  },
  openProjectFile: async (file: File) => {
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
        set((state) => ({
          selectedPrinter: printer || state.selectedPrinter,
          selectedProcess: process || state.selectedProcess,
          selectedFilament: Array.isArray(filaments) && filaments.length > 0
            ? filaments[0]
            : (filaments || state.selectedFilament)
        }));
        try {
          const cfg = await getConfig(); set({ currentConfig: cfg });
        } catch (_) {}
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
        await storeRecentFile(file.name, bytes, 'project');
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
      const vfsPath = `/out/${outName}`;

      await engine.call('saveProject', { path: vfsPath });
      const bytes = await engine.readFile(vfsPath);

      const blob = new Blob([bytes as any], {
        type: 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml'
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = outName;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);

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
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);

      const { usePreviewStore } = await import('../preview/previewStore');
      let stats: any;
      try {
        stats = await usePreviewStore.getState().loadGcodeBytes(bytes, file.name);
      } catch (_) {}

      set({
        sliceResult: {
          gcode: bytes,
          gcodePath: file.name,
          gcodeBytes: bytes.byteLength,
          layers: stats?.layers || 0,
          printTimeS: stats?.printTimeS || 0,
          filamentMm: stats?.filamentMm || 0,
          filamentG: stats?.filamentG || 0,
          warnings: []
        },
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

  importModelFile: async (file: File, options?: StepImportOptions) => {
    if (!file) return;
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
        await arrange();
        const objs = await engine.listObjects();
        res = { objects: objs };
      } else {
        const buffer = await file.arrayBuffer();
        res = await addModel(file.name, new Uint8Array(buffer), options);
        await arrange();
      }

      try {
        const { usePlateStore } = await import('../plate/plateStore');
        await usePlateStore.getState().refreshObjects();
      } catch (_) {}

      set({
        modelFile: { name: file.name, size: file.size },
        modelObjects: res.objects,
        isModelLoading: false,
        sliceStatusText: `Loaded and arranged ${file.name}`
      });
      try {
        const { useHistoryStore } = await import('../history');
        await useHistoryStore.getState().commitTransaction(`Import ${file.name}`);
      } catch (_) {}

      showToast(`Imported ${file.name}`, 'success');
      try {
        const buffer = await file.arrayBuffer();
        await storeRecentFile(file.name, new Uint8Array(buffer), 'model');
      } catch (_) {}
    } catch (err: any) {
      set({
        isModelLoading: false,
        engineError: `Failed to load model '${file.name}': ${err.message || String(err)}`,
        sliceStatusText: 'Model loading failed'
      });
      showToast(`Failed to load model '${file.name}': ${err.message || String(err)}`, 'error');
    }
  },

  startSlice: async () => {
    const { isEngineReady, isSlicing, modelFile, selectedPrinter, selectedProcess, selectedFilament } = get();
    try {
      const { useHistoryStore } = await import('../history');
      if (useHistoryStore.getState().isRestoring) {
        return;
      }
    } catch (_) {}
    if (!isEngineReady || isSlicing || !modelFile || !selectedPrinter || !selectedProcess || !selectedFilament) {
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
      const threads = Math.min(
        typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4,
        8
      );

      let currentPlateIndex: number | undefined;
      try {
        const { usePlatesStore } = await import("../plates/platesStore");
        const pIdx = usePlatesStore.getState().activePlateIndex;
        if (typeof pIdx === "number" && pIdx >= 0) {
          currentPlateIndex = pIdx;
        }
      } catch (_) {}

      const result = await slice({
        plateIndex: currentPlateIndex,
        threads,
        signal: abortController.signal,
        onProgress: (prog: ProgressNotification) => {
          const pct = Math.max(0, Math.min(100, prog.percent ?? 0));
          set({
            slicePercent: pct,
            sliceStatusText: prog.text ? `Slicing: ${prog.text} (${pct}%)` : `Slicing (${pct}%)`
          });
        }
      });

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
        sliceResult: result,
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

  applyOptionChange: async (key: string, value: string, explicitKind) => {
    const { layout, activeDialog } = get();
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

    // Record override for this kind
    if (kind === 'print') {
      set((state) => ({ processOverrides: { ...state.processOverrides, [key]: value } }));
    } else if (kind === 'filament') {
      set((state) => ({ filamentOverrides: { ...state.filamentOverrides, [key]: value } }));
    } else if (kind === 'printer') {
      set((state) => ({ printerOverrides: { ...state.printerOverrides, [key]: value } }));
    }

    try {
      await setOptions({ [key]: value });
      const effectiveConfig = await getConfig();

      const ruleKind = kind === 'printer' ? 'printer' : kind === 'filament' ? 'filament' : 'print';
      const rulesRes = await evaluateRules({ kind: ruleKind, filamentIndex: 0 });

      set((state) => ({
        currentConfig: effectiveConfig,
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
    } catch (err: any) {
      set({ engineError: `Failed to set option '${key}': ${err.message || String(err)}` });
    }
  },

  resetOption: async (key: string, explicitKind) => {
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

    // Remove from overrides
    if (kind === 'print') {
      set((state) => {
        const next = { ...state.processOverrides };
        delete next[key];
        return { processOverrides: next };
      });
    } else if (kind === 'filament') {
      set((state) => {
        const next = { ...state.filamentOverrides };
        delete next[key];
        return { filamentOverrides: next };
      });
    } else if (kind === 'printer') {
      set((state) => {
        const next = { ...state.printerOverrides };
        delete next[key];
        return { printerOverrides: next };
      });
    }

    const baselineVal = presetConfig[key];
    if (baselineVal !== undefined) {
      try {
        await setOptions({ [key]: baselineVal });
        const effectiveConfig = await getConfig();

        const ruleKind = kind === 'printer' ? 'printer' : kind === 'filament' ? 'filament' : 'print';
        const rulesRes = await evaluateRules({ kind: ruleKind, filamentIndex: 0 });

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
        const yesFixes = pendingFixes.filter((f) => !f.reason.includes('[No:'));
        for (const f of yesFixes) {
          overridesUpdate[f.key] = f.value;
        }
        await setOptions(overridesUpdate);
      } else {
        // User canceled / rejected -> apply No fix (e.g. spiral_mode = 0)
        const noFix = pendingFixes.find((f) => f.reason.includes('[No:'));
        if (noFix) {
          overridesUpdate[noFix.key] = noFix.value;
          await setOptions({ [noFix.key]: noFix.value });
        } else if (pendingFixTriggerKey) {
          const { presetConfig } = get();
          const restoreVal = presetConfig[pendingFixTriggerKey] || '0';
          overridesUpdate[pendingFixTriggerKey] = restoreVal;
          await setOptions({ [pendingFixTriggerKey]: restoreVal });
        }
      }

      const effectiveConfig = await getConfig();
      const kind = activeDialog === 'printer' ? 'printer' : activeDialog === 'filament' ? 'filament' : 'print';
      const rulesRes = await evaluateRules({ kind, filamentIndex: 0 });

      set((state) => {
        const nextOverrides = { ...state.processOverrides };
        if (branch === 'yes') {
          Object.assign(nextOverrides, overridesUpdate);
        } else {
          for (const k of Object.keys(overridesUpdate)) {
            delete nextOverrides[k];
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

  selectUserPreset: async (kind: PresetKind, name: string) => {
    const { userPresets, selectedPrinter, selectedProcess, selectedFilament } = get();
    const preset = userPresets.find((p) => p.kind === kind && p.name === name);
    if (!preset) return;

    try {
      if (kind === 'process') {
        set((state) => ({
          activeUserPreset: { ...state.activeUserPreset, process: name },
          selectedProcess: name,
          processOverrides: { ...preset.values }
        }));

        const systemPrinter = resolveSystemPreset('printer', selectedPrinter, userPresets);
        const systemFilament = resolveSystemPreset('filament', selectedFilament, userPresets);

        await selectPresets({
          printer: systemPrinter,
          process: preset.inherits,
          filaments: [systemFilament]
        });

        const baselineConfig = await getConfig();
        const { processOverrides, filamentOverrides, printerOverrides } = get();
        const allOverrides = { ...processOverrides, ...filamentOverrides, ...printerOverrides };
        if (Object.keys(allOverrides).length > 0) {
          await setOptions(allOverrides);
        }

        const effectiveConfig = await getConfig();
        const rulesRes = await evaluateRules({ kind: 'print', filamentIndex: 0 });

        set({
          presetConfig: baselineConfig,
          currentConfig: effectiveConfig,
          rulesState: {
            fields: rulesRes.fields || {},
            fixes: rulesRes.fixes || [],
            messages: rulesRes.messages || []
          }
        });
      } else if (kind === 'filament') {
        set((state) => ({
          activeUserPreset: { ...state.activeUserPreset, filament: name },
          selectedFilament: name,
          filamentOverrides: { ...preset.values }
        }));

        const systemPrinter = resolveSystemPreset('printer', selectedPrinter, userPresets);
        const systemProcess = resolveSystemPreset('process', selectedProcess, userPresets);

        await selectPresets({
          printer: systemPrinter,
          process: systemProcess,
          filaments: [preset.inherits]
        });

        const baselineConfig = await getConfig();
        const { processOverrides, filamentOverrides, printerOverrides } = get();
        const allOverrides = { ...processOverrides, ...filamentOverrides, ...printerOverrides };
        if (Object.keys(allOverrides).length > 0) {
          await setOptions(allOverrides);
        }

        const effectiveConfig = await getConfig();
        const rulesRes = await evaluateRules({ kind: 'print', filamentIndex: 0 });

        set({
          presetConfig: baselineConfig,
          currentConfig: effectiveConfig,
          rulesState: {
            fields: rulesRes.fields || {},
            fixes: rulesRes.fixes || [],
            messages: rulesRes.messages || []
          }
        });
      } else if (kind === 'printer') {
        set((state) => ({
          activeUserPreset: { ...state.activeUserPreset, printer: name },
          selectedPrinter: name,
          printerOverrides: { ...preset.values }
        }));

        const systemProcess = resolveSystemPreset('process', selectedProcess, userPresets);
        const systemFilament = resolveSystemPreset('filament', selectedFilament, userPresets);

        await selectPresets({
          printer: preset.inherits,
          process: systemProcess,
          filaments: [systemFilament]
        });

        const baselineConfig = await getConfig();
        const { processOverrides, filamentOverrides, printerOverrides } = get();
        const allOverrides = { ...processOverrides, ...filamentOverrides, ...printerOverrides };
        if (Object.keys(allOverrides).length > 0) {
          await setOptions(allOverrides);
        }

        const effectiveConfig = await getConfig();
        const rulesRes = await evaluateRules({ kind: 'print', filamentIndex: 0 });

        // Update compatible processes and filaments for this printer base
        const [compProcesses, compFilaments] = await Promise.all([
          listPresets('process', { compatibleOnly: true }),
          listPresets('filament', { compatibleOnly: true })
        ]);

        set({
          ...(compProcesses.length > 0 ? { processes: compProcesses } : {}),
          ...(compFilaments.length > 0 ? { filaments: compFilaments } : {}),
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
      set({ engineError: `Failed to select user preset '${name}': ${err.message || String(err)}` });
    }
  },

  saveCurrentUserPreset: async (kind: PresetKind, name: string) =>
    saveCurrentUserPresetHelper(get, set, kind, name),
  duplicateUserPresetAction: async (kind: PresetKind, sourceName: string, newName: string) =>
    duplicateUserPresetHelper(get, set, kind, sourceName, newName),
  deleteUserPresetAction: async (kind: PresetKind, name: string) =>
    deleteUserPresetHelper(get, set, kind, name),
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
