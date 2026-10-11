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
import { getCompatiblePresets, getEngine } from '../engine/orcaEngine';
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
  const activeName = kind === 'filament'
    ? (get().selectedFilaments[get().activeFilamentSlot || 0] || selectedFilament)
    : activeUserPreset[kind];
  if (collision && activeName !== trimmed) {
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
    const { activeFilamentSlot, selectedFilaments } = get();
    const slotIndex = activeFilamentSlot || 0;
    const activeFil = (selectedFilaments && selectedFilaments[slotIndex]) || selectedFilament;
    inherits = activeFil;
    const existingUser = userPresets.find((p) => p.kind === 'filament' && p.name === activeFil);
    if (existingUser) inherits = existingUser.inherits;
    const engine = await getEngine();
    const slotConfig = await engine.call('getConfig', { filamentIndex: slotIndex }) as Record<string, string>;
    const keys = new Set(Object.keys(existingUser?.values || {}).filter((key) => key in slotConfig));
    // The override map also contains project-wide flushing settings and edits
    // from other slots. Use the engine's filament keys to save only this slot.
    for (const key of Object.keys(filamentOverrides)) {
      if (!(key in slotConfig)) continue;
      const serializedValue = get().presetConfig[key];
      const current = await engine.call('getOption', { key, filamentIndex: slotIndex });
      const baseline = await engine.call('getOption', { key, filamentIndex: slotIndex, serializedValue });
      if (current.value !== baseline.value) keys.add(key);
    }
    values = await engine.call('getConfig', { filamentIndex: slotIndex, keys: [...keys] }) as Record<string, string>;
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
    set({
      userPresets: updated,
      engineError: null
    });
    const { activeFilamentSlot, selectedFilaments, selectedFilament } = get();
    const slotIdx = kind === 'filament' ? (activeFilamentSlot || 0) : 0;
    const currentList = selectedFilaments && selectedFilaments.length > 0 ? [...selectedFilaments] : [selectedFilament];
    currentList[slotIdx] = trimmed;
    set((state) => ({
      activeUserPreset: {
        ...state.activeUserPreset,
        ...(kind === 'filament' && slotIdx !== 0 ? {} : { [kind]: trimmed })
      },
      ...(kind === 'process' ? { selectedProcess: trimmed } : {}),
      ...(kind === 'filament' ? {
        selectedFilament: slotIdx === 0 ? trimmed : state.selectedFilament,
        selectedFilaments: currentList
      } : {}),
      ...(kind === 'printer' ? { selectedPrinter: trimmed } : {})
    }));
    await get().selectUserPreset(kind, trimmed, slotIdx);
    set({ savePresetDialogTarget: null });
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

  const { activeFilamentSlot, selectedFilaments } = get();
  const sourceSlot = selectedFilaments[activeFilamentSlot] === sourceName
    ? activeFilamentSlot : selectedFilaments.indexOf(sourceName);
  const slotIndex = kind === 'filament' && sourceSlot >= 0 ? sourceSlot : activeFilamentSlot;
  if (kind === 'filament' && sourceSlot >= 0) {
    // Saving already projects native values to one slot and excludes project
    // settings. Reuse it rather than copying the whole override vector.
    set({ activeFilamentSlot: slotIndex });
    await saveCurrentUserPresetHelper(get, set, kind, trimmed);
    return;
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
    set({
      userPresets: updated,
      engineError: null
    });
    await get().selectUserPreset(kind, trimmed, kind === 'filament' ? slotIndex : undefined);
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
  const { userPresets, selectedProcess, selectedPrinter, selectedFilaments } = get();
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

    const wasSelected = kind === 'process' ? selectedProcess === name
      : kind === 'printer' ? selectedPrinter === name : selectedFilaments.includes(name);
    if (wasSelected) {
      if (kind === 'process') {
        const { processes } = get();
        const target = processes.find((p) => p.name === existing.inherits)?.name || processes[0]?.name;
        if (target) await get().chooseProcess(target);
      } else if (kind === 'filament') {
        const { filaments } = get();
        const target = filaments.find((f) => f.name === existing.inherits)?.name || filaments[0]?.name;
        if (target) {
          for (const [slotIndex, selected] of selectedFilaments.entries()) {
            if (selected === name) await get().chooseFilament(target, slotIndex);
          }
        }
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
      ...(kind === 'filament' ? {
        ...(state.selectedFilament === oldName ? { selectedFilament: trimmed } : {}),
        selectedFilaments: (state.selectedFilaments || []).map((f) => f === oldName ? trimmed : f)
      } : {}),
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
