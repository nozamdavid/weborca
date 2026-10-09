/**
 * @file textStore.ts
 * Zustand state store for 3D Text & Emboss tool in OrcaSlicer Web.
 */

import { create } from 'zustand';
import {
  addText as apiAddText,
  updateText as apiUpdateText,
  getText as apiGetText,
  ensureFontLoaded,
  resolveAssetUrl,
  getCachedFont
} from './textApi';
import { getEngine } from '../engine/orcaEngine';
import type {
  FontItem,
  TextVolumeType,
  TextAlignment,
  TextResult,
  AddTextParams,
  UpdateTextParams
} from './types';

export const DEFAULT_FONTS: FontItem[] = [
  {
    id: 'dejavu-sans',
    name: 'DejaVu Sans',
    fileName: 'DejaVuSans.ttf',
    url: '/fonts/DejaVuSans.ttf',
    license: 'Bitstream Vera / Public Domain'
  },
  {
    id: 'dejavu-serif',
    name: 'DejaVu Serif',
    fileName: 'DejaVuSerif.ttf',
    url: '/fonts/DejaVuSerif.ttf',
    license: 'Bitstream Vera / Public Domain'
  },
  {
    id: 'dejavu-mono',
    name: 'DejaVu Sans Mono',
    fileName: 'DejaVuSansMono.ttf',
    url: '/fonts/DejaVuSansMono.ttf',
    license: 'Bitstream Vera / Public Domain'
  },
  {
    id: 'liberation-sans',
    name: 'Liberation Sans',
    fileName: 'LiberationSans-Regular.ttf',
    url: '/fonts/LiberationSans-Regular.ttf',
    license: 'SIL Open Font License 1.1'
  }
];

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let operationSeq = 0;

export interface TextStoreState {
  // Panel visibility & targets
  isOpen: boolean;
  targetObjectId: number | null;
  targetVolumeId: number | null;

  // Emboss text parameters
  text: string;
  selectedFont: FontItem | null;
  size: number; // font height in mm (0.1 - 100)
  depth: number; // extrusion thickness in mm (0.01 - 25)
  charGap: number; // character spacing in font points
  lineGap: number; // line spacing in font points
  boldness: number; // contour offset stroke
  skew: number; // italic CW tilt ratio (-1.0 to 1.0)
  align: TextAlignment;
  useSurface: boolean; // conform to surface (unsupported in Web engine: forced false)
  volumeType: TextVolumeType; // part | negative | modifier | new_object
  position: [number, number, number] | null;
  normal: [number, number, number] | null;
  rotation: number;

  // Mutation tracking & rollback
  initialConfig: UpdateTextParams | null;
  hasDispatchedMutation: boolean;

  // Status & font cache
  fonts: FontItem[];
  isFontsLoaded: boolean;
  isLoading: boolean;
  error: string | null;
  fontMissingName: string | null;
  lastResult: TextResult | null;

  // Actions
  setIsOpen: (isOpen: boolean) => void;
  openForAdd: (
    objectId?: number | null,
    placement?: { position?: [number, number, number]; normal?: [number, number, number] }
  ) => void;
  openForEdit: (objectId: number, volumeId: number) => Promise<void>;
  close: () => Promise<void>;
  setTargetObject: (objectId: number | null) => void;
  setTargetVolume: (volumeId: number | null) => void;
  setPlacement: (
    position: [number, number, number] | null,
    normal?: [number, number, number] | null
  ) => void;

  // Font actions
  loadFonts: () => Promise<void>;
  loadCustomFontFile: (file: File) => Promise<FontItem>;
  setFont: (font: FontItem) => Promise<void>;

  // Parameter setters
  setText: (text: string) => void;
  setSize: (size: number) => void;
  setDepth: (depth: number) => void;
  setCharGap: (gap: number) => void;
  setLineGap: (gap: number) => void;
  setBoldness: (boldness: number) => void;
  setSkew: (skew: number) => void;
  setAlign: (align: TextAlignment) => void;
  setUseSurface: (useSurface: boolean) => void;
  setVolumeType: (volumeType: TextVolumeType) => void;
  setRotation: (rotation: number) => void;
  setError: (error: string | null) => void;
  resetParams: () => Promise<void>;

  // Engine operations
  loadText: (objectId: number, volumeId: number) => Promise<void>;
  addText: () => Promise<TextResult | null>;
  updateText: (commitHistory?: boolean) => Promise<TextResult | null>;
  debouncedUpdateText: () => void;
}

export const useTextStore = create<TextStoreState>((set, get) => ({
  isOpen: false,
  targetObjectId: null,
  targetVolumeId: null,

  text: 'Text',
  selectedFont: DEFAULT_FONTS[0],
  size: 10.0,
  depth: 1.0,
  charGap: 0,
  lineGap: 0,
  boldness: 0.0,
  skew: 0.0,
  align: { horizontal: 'center', vertical: 'center' },
  useSurface: false,
  volumeType: 'new_object',
  position: null,
  normal: null,
  rotation: 0.0,

  initialConfig: null,
  hasDispatchedMutation: false,

  fonts: DEFAULT_FONTS,
  isFontsLoaded: false,
  isLoading: false,
  error: null,
  fontMissingName: null,
  lastResult: null,

  setIsOpen: (isOpen: boolean) => {
    if (!isOpen) {
      void get().close();
    } else {
      set({ isOpen: true });
    }
  },

  openForAdd: (objectId = null, placement) => {
    operationSeq++;
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    const isNew = objectId === null;
    set({
      isOpen: true,
      targetObjectId: objectId,
      targetVolumeId: null,
      volumeType: isNew ? 'new_object' : 'part',
      position: placement?.position ?? null,
      normal: placement?.normal ?? [0, 0, 1],
      rotation: 0.0,
      initialConfig: null,
      hasDispatchedMutation: false,
      error: null
    });
    void get().loadFonts();
  },

  openForEdit: async (objectId: number, volumeId: number) => {
    const opId = ++operationSeq;
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    set({
      isOpen: true,
      targetObjectId: objectId,
      targetVolumeId: volumeId,
      position: null, // Reset position so transformation is preserved unless re-placed!
      normal: null,
      rotation: 0.0,
      initialConfig: null,
      hasDispatchedMutation: false,
      error: null
    });
    await get().loadFonts();
    if (opId !== operationSeq || !get().isOpen) return;
    await get().loadText(objectId, volumeId);
  },

  close: async () => {
    operationSeq++;
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    const state = get();
    // Roll back already dispatched model mutations if user closes without committing
    if (state.hasDispatchedMutation && state.initialConfig) {
      try {
        let rollbackConfig: UpdateTextParams = { ...state.initialConfig };
        if (!rollbackConfig.fontData) {
          const font =
            state.selectedFont ||
            state.fonts.find((f) => f.name.toLowerCase() === (rollbackConfig.fontName || '').toLowerCase()) ||
            state.fonts[0];
          if (font) {
            const loaded = await ensureFontLoaded(font);
            rollbackConfig.fontData = loaded.fontData;
            rollbackConfig.fontPath = loaded.memfsPath;
          }
        }
        await apiUpdateText(rollbackConfig);
        const { usePlateStore } = await import('../plate/plateStore');
        const plate = usePlateStore.getState();
        plate.meshCache.delete(state.initialConfig.objectId);
        usePlateStore.setState({ meshCache: new Map(plate.meshCache) });
        await plate.refreshObjects();
        const { useObjectListStore } = await import("../objectlist/objectListStore");
        await useObjectListStore.getState().refreshTree();
      } catch (_) {}
    }
    set({
      isOpen: false,
      isLoading: false,
      error: null,
      position: null,
      normal: null,
      hasDispatchedMutation: false,
      initialConfig: null
    });
  },

  setTargetObject: (objectId: number | null) => {
    operationSeq++;
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    set((state) => ({
      targetObjectId: objectId,
      volumeType: objectId === null ? 'new_object' : state.volumeType === 'new_object' ? 'part' : state.volumeType
    }));
  },

  setTargetVolume: (volumeId: number | null) => {
    operationSeq++;
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    set({ targetVolumeId: volumeId });
  },

  setPlacement: (pos, norm = [0, 0, 1]) => {
    set({ position: pos, normal: norm ?? [0, 0, 1] });
  },

  loadFonts: async () => {
    try {
      const manifestUrl = resolveAssetUrl("/fonts/manifest.json");
      const resp = await fetch(manifestUrl);
      if (resp.ok) {
        const manifestFonts: FontItem[] = await resp.json();
        set((state) => {
          const customFonts = state.fonts.filter((f) => f.id.startsWith('custom-'));
          const combined = [...manifestFonts, ...customFonts];
          const selected = state.selectedFont
            ? combined.find((f) => f.id === state.selectedFont?.id) || combined[0]
            : combined[0];
          return { fonts: combined, selectedFont: selected, isFontsLoaded: true };
        });
      } else {
        set({ fonts: DEFAULT_FONTS, selectedFont: DEFAULT_FONTS[0], isFontsLoaded: true });
      }
    } catch (_) {
      set({ fonts: DEFAULT_FONTS, selectedFont: DEFAULT_FONTS[0], isFontsLoaded: true });
    }
  },

  loadCustomFontFile: async (file: File) => {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const fontName = file.name.replace(/\.(ttf|otf|ttc)$/i, '');
    const customFont: FontItem = {
      id: `custom-${Date.now()}-${file.name}`,
      name: fontName,
      fileName: file.name,
      url: '',
      bytes
    };

    await ensureFontLoaded(customFont);

    set((state) => ({
      fonts: [...state.fonts, customFont],
      selectedFont: customFont,
      fontMissingName: null,
      error: null
    }));

    get().debouncedUpdateText();
    return customFont;
  },

  setFont: async (font: FontItem) => {
    set({ selectedFont: font, fontMissingName: null, error: null });
    await ensureFontLoaded(font);
    get().debouncedUpdateText();
  },

  setText: (text: string) => {
    set({ text });
    get().debouncedUpdateText();
  },

  setSize: (size: number) => {
    set({ size: Math.max(0.1, Math.min(200, size)) });
    get().debouncedUpdateText();
  },

  setDepth: (depth: number) => {
    set({ depth: Math.max(0.01, Math.min(50, depth)) });
    get().debouncedUpdateText();
  },

  setCharGap: (charGap: number) => {
    set({ charGap });
    get().debouncedUpdateText();
  },

  setLineGap: (lineGap: number) => {
    set({ lineGap });
    get().debouncedUpdateText();
  },

  setBoldness: (boldness: number) => {
    set({ boldness });
    get().debouncedUpdateText();
  },

  setSkew: (skew: number) => {
    set({ skew });
    get().debouncedUpdateText();
  },

  setAlign: (align: TextAlignment) => {
    set({ align });
    get().debouncedUpdateText();
  },

  setUseSurface: (useSurface: boolean) => {
    set({ useSurface });
    get().debouncedUpdateText();
  },

  setVolumeType: (volumeType: TextVolumeType) => {
    set({ volumeType });
  },

  setRotation: (rotation: number) => {
    set({ rotation });
    get().debouncedUpdateText();
  },

  setError: (error: string | null) => {
    set({ error });
  },

  resetParams: async () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    const state = get();
    if (state.targetVolumeId !== null && state.initialConfig) {
      // Revert live uncommitted edits back to initial configuration
      try {
        let rollbackConfig: UpdateTextParams = { ...state.initialConfig };
        if (!rollbackConfig.fontData) {
          const font =
            state.selectedFont ||
            state.fonts.find((f) => f.name.toLowerCase() === (rollbackConfig.fontName || '').toLowerCase()) ||
            state.fonts[0];
          if (font) {
            const loaded = await ensureFontLoaded(font);
            rollbackConfig.fontData = loaded.fontData;
            rollbackConfig.fontPath = loaded.memfsPath;
          }
        }
        await apiUpdateText(rollbackConfig);
        const { usePlateStore } = await import('../plate/plateStore');
        const plate = usePlateStore.getState();
        plate.meshCache.delete(state.initialConfig.objectId);
        usePlateStore.setState({ meshCache: new Map(plate.meshCache) });
        await plate.refreshObjects();
        const { useObjectListStore } = await import("../objectlist/objectListStore");
        await useObjectListStore.getState().refreshTree();
      } catch (_) {}

      set({
        text: state.initialConfig.text ?? 'Text',
        size: state.initialConfig.size ?? 10.0,
        depth: state.initialConfig.depth ?? 1.0,
        charGap: state.initialConfig.charGap ?? 0,
        lineGap: state.initialConfig.lineGap ?? 0,
        boldness: state.initialConfig.boldness ?? 0.0,
        skew: state.initialConfig.skew ?? 0.0,
        align: (state.initialConfig.align as TextAlignment) ?? { horizontal: 'center', vertical: 'center' },
        rotation: 0.0,
        hasDispatchedMutation: false,
        error: null
      });
      return;
    }

    set((s) => ({
      text: 'Text',
      size: 10.0,
      depth: 1.0,
      charGap: 0,
      lineGap: 0,
      boldness: 0.0,
      skew: 0.0,
      align: { horizontal: 'center', vertical: 'center' },
      useSurface: false,
      volumeType: s.targetObjectId !== null ? 'part' : 'new_object',
      rotation: 0.0,
      error: null
    }));
  },

  loadText: async (objectId: number, volumeId: number) => {
    const opId = ++operationSeq;
    try {
      set({ isLoading: true, error: null });
      const info = await apiGetText({ objectId, volumeId });

      if (opId !== operationSeq || !get().isOpen) return;

      const isEmbedded = info.fontPath === '<embedded_font>' || (!info.fontPath && !info.fontName);
      let matchedFont = get().fonts.find(
        (f) =>
          f.name.toLowerCase() === info.fontName.toLowerCase() ||
          (!isEmbedded && info.fontPath && info.fontPath.endsWith(f.fileName))
      );

      const cachedBytes =
        matchedFont?.bytes ||
        getCachedFont(info.fontName) ||
        (!isEmbedded && info.fontPath ? getCachedFont(info.fontPath) : undefined);

      if (!matchedFont && cachedBytes) {
        matchedFont = {
          id: `cached-${Date.now()}-${info.fontName}`,
          name: info.fontName,
          fileName: `${info.fontName}.ttf`,
          url: '',
          bytes: cachedBytes
        };
        set((s) => ({ fonts: [...s.fonts, matchedFont!] }));
      }

      const hasFontBytes = !!(matchedFont?.bytes || cachedBytes || (matchedFont?.url && !matchedFont.url.startsWith('<')));
      const isCustomMissing = (isEmbedded || (!matchedFont && !info.fontPath.startsWith('/fonts/'))) && !hasFontBytes;
      let fontData: string | undefined;
      let memfsPath: string | undefined;

      if (matchedFont && !isCustomMissing) {
        const loaded = await ensureFontLoaded(matchedFont);
        fontData = loaded.fontData;
        memfsPath = loaded.memfsPath;
      }
      if (opId !== operationSeq || !get().isOpen) return;
      const initialConfig: UpdateTextParams = {
        objectId: info.objectId,
        volumeId: info.volumeId,
        text: info.text,
        fontName: info.fontName,
        fontPath: memfsPath || (isEmbedded ? undefined : info.fontPath),
        fontData,
        size: info.size,
        depth: info.depth,
        charGap: info.charGap ?? 0,
        lineGap: info.lineGap ?? 0,
        boldness: info.boldness ?? 0.0,
        skew: info.skew ?? 0.0,
        align: info.align || { horizontal: 'center', vertical: 'center' },
        useSurface: info.useSurface ?? false
      };

      set({
        targetObjectId: info.objectId,
        targetVolumeId: info.volumeId,
        text: info.text,
        selectedFont: isCustomMissing ? null : (matchedFont || null),
        fontMissingName: isCustomMissing ? info.fontName : null,
        size: info.size,
        depth: info.depth,
        charGap: info.charGap ?? 0,
        lineGap: info.lineGap ?? 0,
        boldness: info.boldness ?? 0.0,
        skew: info.skew ?? 0.0,
        align: info.align || { horizontal: 'center', vertical: 'center' },
        useSurface: info.useSurface ?? false,
        rotation: info.rotation ?? 0.0,
        initialConfig,
        hasDispatchedMutation: false,
        isLoading: false
      });
    } catch (err: any) {
      if (opId !== operationSeq || !get().isOpen) return;
      set({
        error: err?.message || `Failed to read text configuration for volume ${volumeId}`,
        isLoading: false
      });
    }
  },

  addText: async () => {
    // Check if history is actively restoring
    try {
      const { useHistoryStore } = await import('../history/historyStore');
      if (useHistoryStore.getState().isRestoring) return null;
    } catch (_) {}

    const opId = ++operationSeq;
    const state = get();
    if (!state.selectedFont) {
      await get().loadFonts();
    }
    const font = get().selectedFont || get().fonts[0];
    if (!font) {
      set({ error: 'No font selected or available' });
      return null;
    }

    set({ isLoading: true, error: null });

    try {
      const { memfsPath, fontData } = await ensureFontLoaded(font);

      const targetObjId = state.targetObjectId;
      const isNewObject = targetObjId === null || state.volumeType === 'new_object';
      const actualVolumeType: TextVolumeType = isNewObject ? 'new_object' : state.volumeType;

      const params: AddTextParams = {
        objectId: !isNewObject && targetObjId !== null ? targetObjId : undefined,
        volumeType: actualVolumeType,
        text: state.text,
        fontName: font.name,
        fontPath: memfsPath,
        fontData,
        size: state.size,
        depth: state.depth,
        charGap: state.charGap,
        lineGap: state.lineGap,
        boldness: state.boldness,
        skew: state.skew,
        align: state.align,
        useSurface: state.useSurface,
        position: state.position ?? undefined,
        normal: state.normal ?? undefined,
        rotation: state.rotation
      };

      const result = await apiAddText(params);

      if (opId !== operationSeq || !get().isOpen) {
        // Stale UI guard cancellation: delete created object if user closed or canceled in flight
        if (isNewObject && result?.objectId) {
          try {
            const engine = await getEngine();
            if (typeof (engine as any).deleteObject === 'function') {
              await (engine as any).deleteObject(result.objectId);
            } else {
              await engine.call('deleteObject', { objectId: result.objectId });
            }
          } catch (_) {}
        }
        return result;
      }

      set({
        isLoading: false,
        lastResult: result,
        targetObjectId: result.objectId,
        targetVolumeId: result.volumeId,
        hasDispatchedMutation: false
      });

      // Invalidate mesh cache in plate store for affected object(s)
      try {
        const { usePlateStore } = await import('../plate/plateStore');
        const plateStore = usePlateStore.getState();
        const affectedIds = new Set<number>();
        if (targetObjId !== null) affectedIds.add(targetObjId);
        if (result?.objectId !== undefined && result.objectId !== null) affectedIds.add(result.objectId);
        for (const id of affectedIds) {
          plateStore.meshCache.delete(id);
        }
        usePlateStore.setState({ meshCache: new Map(plateStore.meshCache) });
        await plateStore.refreshObjects();
      } catch (_) {}

      try {
        const { useObjectListStore } = await import('../objectlist/objectListStore');
        await useObjectListStore.getState().refreshTree();
      } catch (_) {}

      try {
        const { useHistoryStore } = await import('../history/historyStore');
        await useHistoryStore.getState().commitTransaction('Add 3D text');
      } catch (_) {}

      return result;
    } catch (err: any) {
      if (opId !== operationSeq) return null;
      set({
        error: err?.message || 'Failed to generate 3D embossed text',
        isLoading: false
      });
      return null;
    }
  },

  updateText: async (commitHistory = false) => {
    // Check if history is actively restoring
    try {
      const { useHistoryStore } = await import('../history/historyStore');
      if (useHistoryStore.getState().isRestoring) return null;
    } catch (_) {}

    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }

    const state = get();
    if (state.targetObjectId === null || state.targetVolumeId === null) {
      return null;
    }
    if (state.fontMissingName && !state.selectedFont) {
      set({ error: `Please reselect font "${state.fontMissingName}" before updating.` });
      return null;
    }

    const opId = ++operationSeq;
    const targetObjId = state.targetObjectId;
    const targetVolId = state.targetVolumeId;

    const font = state.selectedFont || state.fonts[0];
    set({ isLoading: true, error: null });

    try {
      let memfsPath: string | undefined;
      let fontData: string | undefined;
      if (font) {
        const loaded = await ensureFontLoaded(font);
        memfsPath = loaded.memfsPath;
        fontData = loaded.fontData;
      }

      const params: UpdateTextParams = {
        objectId: targetObjId,
        volumeId: targetVolId,
        text: state.text,
        fontName: font?.name,
        fontPath: memfsPath,
        fontData,
        size: state.size,
        depth: state.depth,
        charGap: state.charGap,
        lineGap: state.lineGap,
        boldness: state.boldness,
        skew: state.skew,
        align: state.align,
        useSurface: state.useSurface
      };

      if (state.position !== null) {
        params.position = state.position;
        params.normal = state.normal ?? undefined;
      }
      // Preserve and propagate rotation even when position is omitted
      if (state.rotation !== 0 || state.position !== null) {
        params.rotation = state.rotation;
      }

      const result = await apiUpdateText(params);

      if (
        opId !== operationSeq ||
        !get().isOpen ||
        get().targetObjectId !== targetObjId ||
        get().targetVolumeId !== targetVolId
      ) {
        // Dispatched mutation is stale: rollback to initial configuration if still uncommitted
        const current = get();
        if (current.hasDispatchedMutation && current.initialConfig && current.targetVolumeId === targetVolId) {
          try {
            await apiUpdateText(current.initialConfig);
          } catch (_) {}
        }
        return result;
      }

      set({
        isLoading: false,
        lastResult: result,
        hasDispatchedMutation: !commitHistory
      });

      // Invalidate mesh cache in plate store for modified object
      try {
        const { usePlateStore } = await import('../plate/plateStore');
        const plateStore = usePlateStore.getState();
        plateStore.meshCache.delete(targetObjId);
        usePlateStore.setState({ meshCache: new Map(plateStore.meshCache) });
        await plateStore.refreshObjects();
      } catch (_) {}

      try {
        const { useObjectListStore } = await import('../objectlist/objectListStore');
        await useObjectListStore.getState().refreshTree();
      } catch (_) {}

      if (commitHistory) {
        set({
          hasDispatchedMutation: false,
          initialConfig: { ...params }
        });
        try {
          const { useHistoryStore } = await import('../history/historyStore');
          await useHistoryStore.getState().commitTransaction('Update 3D text');
        } catch (_) {}
      }

      return result;
    } catch (err: any) {
      if (
        opId !== operationSeq ||
        !get().isOpen ||
        get().targetObjectId !== targetObjId ||
        get().targetVolumeId !== targetVolId
      ) {
        return null;
      }
      set({
        error: err?.message || `Failed to update text volume ${targetVolId}`,
        isLoading: false
      });
      return null;
    }
  },

  debouncedUpdateText: () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    const state = get();
    if (!state.isOpen || state.targetObjectId === null || state.targetVolumeId === null) {
      return;
    }
    if (state.fontMissingName && !state.selectedFont) {
      return;
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      const current = get();
      if (current.isOpen && current.targetObjectId !== null && current.targetVolumeId !== null) {
        void current.updateText(false);
      }
    }, 300);
  }
}));

// Subscribe to history store restoration events to cancel in-flight text updates and close panel
if (typeof window !== 'undefined') {
  (window as any).__textStore = useTextStore;
  import('../history/historyStore')
    .then(({ useHistoryStore }) => {
      useHistoryStore.subscribe((next, prev) => {
        if (next.isRestoring && !prev.isRestoring) {
          if (debounceTimer) {
            clearTimeout(debounceTimer);
            debounceTimer = null;
          }
          operationSeq++;
          useTextStore.setState({
            isOpen: false,
            isLoading: false,
            hasDispatchedMutation: false,
            initialConfig: null
          });
        }
      });
    })
    .catch(() => {});
}
