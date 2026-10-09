import type { AppState } from '../store/appStore';
import type { PresetKind, UserPreset, ConflictStrategy, PresetBundle, ImportBundleResult } from './types';
import {
  saveUserPreset,
  deleteUserPreset,
  renameUserPreset,
  saveUserPresetsBatch
} from './presetStorage';
import {
  exportPresetBundle,
  resolvePresetBundleImport
} from './presetBundle';
import { getCompatiblePresets } from '../engine/orcaEngine';
import {
  parsePresetsFromUniversalInput,
  exportDesktopPrinterBundle,
  exportDesktopFilamentBundle,
  exportDesktopPresetsZip
} from './presetArchive';

type StoreGet = () => AppState;
type StoreSet = (
  partial: AppState | Partial<AppState> | ((state: AppState) => AppState | Partial<AppState>),
  replace?: any
) => void;

export async function saveCurrentUserPresetHelper(
  get: StoreGet,
  set: StoreSet,
  kind: PresetKind,
  name: string
): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) {
    const msg = 'Preset name cannot be empty';
    set({ engineError: msg });
    throw new Error(msg);
  }

  const {
    processes,
    filaments,
    printers,
    selectedPrinter,
    selectedProcess,
    selectedFilament,
    processOverrides,
    filamentOverrides,
    printerOverrides,
    userPresets,
    activeUserPreset
  } = get();

  const systemList = kind === 'process' ? processes : kind === 'filament' ? filaments : printers;
  if (systemList.some((s) => s.name === trimmed)) {
    const msg = `System presets are immutable. Cannot use name '${trimmed}'`;
    set({ engineError: msg });
    throw new Error(msg);
  }

  const collision = userPresets.find((u) => u.kind === kind && u.name === trimmed);
  if (collision && activeUserPreset[kind] !== trimmed) {
    const msg = `Preset '${trimmed}' already exists`;
    set({ engineError: msg });
    throw new Error(msg);
  }

  let inherits = '';
  let values: Record<string, string> = {};

  if (kind === 'process') {
    inherits = selectedProcess;
    const existingUser = userPresets.find((p) => p.kind === 'process' && p.name === selectedProcess);
    if (existingUser) inherits = existingUser.inherits;
    values = { ...processOverrides };
  } else if (kind === 'filament') {
    inherits = selectedFilament;
    const existingUser = userPresets.find((p) => p.kind === 'filament' && p.name === selectedFilament);
    if (existingUser) inherits = existingUser.inherits;
    values = { ...filamentOverrides };
  } else if (kind === 'printer') {
    inherits = selectedPrinter;
    const existingUser = userPresets.find((p) => p.kind === 'printer' && p.name === selectedPrinter);
    if (existingUser) inherits = existingUser.inherits;
    values = { ...printerOverrides };
  }

  const newPreset: UserPreset = {
    name: trimmed,
    kind,
    inherits,
    values
  };

  try {
    const updated = await saveUserPreset(newPreset);
    set((state) => ({
      userPresets: updated,
      savePresetDialogTarget: null,
      engineError: null,
      activeUserPreset: { ...state.activeUserPreset, [kind]: trimmed },
      ...(kind === 'process' ? { selectedProcess: trimmed } : {}),
      ...(kind === 'filament' ? { selectedFilament: trimmed } : {}),
      ...(kind === 'printer' ? { selectedPrinter: trimmed } : {})
    }));
  } catch (err: any) {
    const msg = `Failed to save preset '${trimmed}': ${err.message || String(err)}`;
    set({ engineError: msg });
    throw err;
  }
}

export async function duplicateUserPresetHelper(
  get: StoreGet,
  set: StoreSet,
  kind: PresetKind,
  sourceName: string,
  newName: string
): Promise<void> {
  const trimmed = newName.trim();
  if (!trimmed) {
    const msg = 'Preset name cannot be empty';
    set({ engineError: msg });
    throw new Error(msg);
  }
  if (trimmed === sourceName) {
    const msg = 'Copying requires a distinct name';
    set({ engineError: msg });
    throw new Error(msg);
  }

  const {
    processes,
    filaments,
    printers,
    userPresets,
    processOverrides,
    filamentOverrides,
    printerOverrides,
    activeUserPreset,
    selectedProcess,
    selectedFilament,
    selectedPrinter
  } = get();

  const systemList = kind === 'process' ? processes : kind === 'filament' ? filaments : printers;
  if (systemList.some((s) => s.name === trimmed)) {
    const msg = `System presets are immutable. Cannot use name '${trimmed}'`;
    set({ engineError: msg });
    throw new Error(msg);
  }

  if (userPresets.some((u) => u.kind === kind && u.name === trimmed)) {
    const msg = `Preset '${trimmed}' already exists`;
    set({ engineError: msg });
    throw new Error(msg);
  }

  let inherits = '';
  let values: Record<string, string> = {};

  const existingUser = userPresets.find((u) => u.kind === kind && u.name === sourceName);
  if (existingUser) {
    inherits = existingUser.inherits;
    const currentOverrides =
      kind === 'process' ? processOverrides : kind === 'filament' ? filamentOverrides : printerOverrides;
    values =
      activeUserPreset[kind] === sourceName
        ? { ...existingUser.values, ...currentOverrides }
        : { ...existingUser.values };
  } else {
    inherits = sourceName;
    const isCurrentActive =
      !activeUserPreset[kind] &&
      (kind === 'process' ? selectedProcess : kind === 'filament' ? selectedFilament : selectedPrinter) === sourceName;
    if (isCurrentActive) {
      if (kind === 'process') values = { ...processOverrides };
      else if (kind === 'filament') values = { ...filamentOverrides };
      else values = { ...printerOverrides };
    } else {
      values = {};
    }
  }

  const newPreset: UserPreset = {
    name: trimmed,
    kind,
    inherits,
    values
  };

  try {
    const updated = await saveUserPreset(newPreset);
    set((state) => ({
      userPresets: updated,
      engineError: null,
      activeUserPreset: { ...state.activeUserPreset, [kind]: trimmed },
      ...(kind === 'process' ? { selectedProcess: trimmed } : {}),
      ...(kind === 'filament' ? { selectedFilament: trimmed } : {}),
      ...(kind === 'printer' ? { selectedPrinter: trimmed } : {})
    }));
  } catch (err: any) {
    const msg = `Failed to duplicate preset '${sourceName}': ${err.message || String(err)}`;
    set({ engineError: msg });
    throw err;
  }
}

export async function deleteUserPresetHelper(
  get: StoreGet,
  set: StoreSet,
  kind: PresetKind,
  name: string
): Promise<void> {
  const { userPresets } = get();
  const existing = userPresets.find((u) => u.kind === kind && u.name === name);
  if (!existing) {
    const msg = `Cannot delete immutable system preset '${name}'`;
    set({ engineError: msg });
    throw new Error(msg);
  }

  try {
    const updated = await deleteUserPreset(kind, name);
    set((state) => ({
      userPresets: updated,
      engineError: null,
      activeUserPreset: {
        ...state.activeUserPreset,
        [kind]: state.activeUserPreset[kind] === name ? null : state.activeUserPreset[kind]
      }
    }));

    const { activeUserPreset } = get();
    if (activeUserPreset[kind] === null) {
      if (kind === 'process') {
        const { processes } = get();
        const target = processes.find((p) => p.name === existing.inherits)?.name || processes[0]?.name;
        if (target) await get().chooseProcess(target);
      } else if (kind === 'filament') {
        const { filaments } = get();
        const target = filaments.find((f) => f.name === existing.inherits)?.name || filaments[0]?.name;
        if (target) await get().chooseFilament(target);
      } else if (kind === 'printer') {
        const { printers } = get();
        const target = printers.find((p) => p.name === existing.inherits)?.name || printers[0]?.name;
        if (target) await get().choosePrinter(target);
      }
    }
  } catch (err: any) {
    const msg = `Failed to delete preset '${name}': ${err.message || String(err)}`;
    set({ engineError: msg });
    throw err;
  }
}

export async function renameUserPresetHelper(
  get: StoreGet,
  set: StoreSet,
  kind: PresetKind,
  oldName: string,
  newName: string
): Promise<void> {
  const trimmed = newName.trim();
  if (!trimmed) {
    const msg = 'Preset name cannot be empty';
    set({ engineError: msg });
    throw new Error(msg);
  }
  if (trimmed === oldName) return;

  const { processes, filaments, printers, userPresets } = get();
  const systemList = kind === 'process' ? processes : kind === 'filament' ? filaments : printers;
  if (systemList.some((s) => s.name === trimmed)) {
    const msg = `System presets are immutable. Cannot use name '${trimmed}'`;
    set({ engineError: msg });
    throw new Error(msg);
  }

  if (userPresets.some((u) => u.kind === kind && u.name === trimmed)) {
    const msg = `Preset '${trimmed}' already exists`;
    set({ engineError: msg });
    throw new Error(msg);
  }

  const oldItem = userPresets.find((u) => u.kind === kind && u.name === oldName);
  if (!oldItem) {
    const msg = `Cannot rename non-existent or system preset '${oldName}'`;
    set({ engineError: msg });
    throw new Error(msg);
  }

  try {
    const updated = await renameUserPreset(kind, oldName, trimmed);
    set((state) => ({
      userPresets: updated,
      engineError: null,
      activeUserPreset: {
        ...state.activeUserPreset,
        [kind]: state.activeUserPreset[kind] === oldName ? trimmed : state.activeUserPreset[kind]
      },
      ...(kind === 'process' && state.selectedProcess === oldName ? { selectedProcess: trimmed } : {}),
      ...(kind === 'filament' && state.selectedFilament === oldName ? { selectedFilament: trimmed } : {}),
      ...(kind === 'printer' && state.selectedPrinter === oldName ? { selectedPrinter: trimmed } : {})
    }));
  } catch (err: any) {
    const msg = `Failed to rename preset '${oldName}': ${err.message || String(err)}`;
    set({ engineError: msg });
    throw err;
  }
}

export async function importUserPresetsHelper(
  get: StoreGet,
  set: StoreSet,
  bundleInput: unknown,
  strategy: ConflictStrategy = 'overwrite'
): Promise<ImportBundleResult> {
  let bundleToResolve: PresetBundle;

  try {
    const parsed = await parsePresetsFromUniversalInput(bundleInput);
    if (parsed.kind === 'web-bundle') {
      bundleToResolve = parsed.bundle;
    } else {
      bundleToResolve = {
        format: 'orcaslicer-web-preset-bundle',
        version: 1,
        exportedAt: new Date().toISOString(),
        presets: parsed.presets
      };
    }
  } catch (err: any) {
    const errorMsg = err.message || String(err);
    set({ engineError: errorMsg });
    throw err;
  }

  const { userPresets, processes, filaments, printers } = get();
  const systemPresetNames = {
    process: processes.map((p) => p.name),
    filament: filaments.map((f) => f.name),
    printer: printers.map((p) => p.name)
  };

  try {
    const result = resolvePresetBundleImport(bundleToResolve, userPresets, systemPresetNames, strategy);
    const updated = await saveUserPresetsBatch(result.allPresets);
    set({
      userPresets: updated,
      engineError: null
    });
    return result;
  } catch (err: any) {
    const msg = `Failed to import preset bundle: ${err.message || String(err)}`;
    set({ engineError: msg });
    throw err;
  }
}

export function exportUserPresetsHelper(
  get: StoreGet,
  kinds?: PresetKind[],
  description?: string
): PresetBundle {
  const { userPresets } = get();
  return exportPresetBundle(userPresets, { kinds, description });
}

export async function exportDesktopArchiveHelper(
  get: StoreGet,
  archiveType: 'printer' | 'filament' | 'all' = 'all',
  targetName?: string
): Promise<Uint8Array> {
  const { userPresets, selectedPrinter, selectedFilament } = get();

  if (archiveType === 'printer') {
    const name = targetName || selectedPrinter;
    const printerPreset = userPresets.find((p) => p.kind === 'printer' && p.name === name);
    if (!printerPreset) throw new Error(`"${name}" is not a user printer preset`);

    const candidates = userPresets.flatMap((p) =>
      p.kind === 'filament' || p.kind === 'process' ? [{ ...p, kind: p.kind }] : []
    );
    const { compatibleUserPresets } = await getCompatiblePresets({
      printer: printerPreset.inherits || printerPreset.name,
      printerName: printerPreset.name,
      printerOverrides: printerPreset.values,
      userPresets: candidates
    });

    return exportDesktopPrinterBundle(printerPreset, userPresets, new Set(compatibleUserPresets));
  }

  if (archiveType === 'filament') {
    const name = targetName || selectedFilament;
    const filPreset = userPresets.find((p) => p.kind === 'filament' && p.name === name);
    if (!filPreset) throw new Error(`"${name}" is not a user filament preset`);
    return exportDesktopFilamentBundle(filPreset);
  }

  return exportDesktopPresetsZip(userPresets);
}
