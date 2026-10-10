import { create } from 'zustand';

export const PREFS_STORAGE_KEY = 'orcaslicer_preferences_v1';

export interface GeneralPreferences {
  language: string;
  units: 'metric' | 'imperial';
  rememberRecentFiles: boolean;
  autoArrangeOnImport: boolean;
  autoSliceAfterChange: boolean;
  /** Back the project up every minute so a closed tab can be recovered. */
  autosave: boolean;
}

export interface CameraPreferences {
  invertMouseWheelZoom: boolean;
  invertOrbitHorizontal: boolean;
  invertOrbitVertical: boolean;
  rotateSensitivity: number;
  zoomSpeed: number;
  defaultCameraType: 'perspective' | 'orthographic';
}

export interface DisplayPreferences {
  showGrid: boolean;
  showAxes: boolean;
  showLabels: boolean;
  showBuildVolume: boolean;
  showWireframe: boolean;
  showNavigator: boolean;
  cameraType: 'perspective' | 'orthographic';
  showSidebar: boolean;
  theme: 'dark' | 'light';
}

export interface PreferencesData {
  general: GeneralPreferences;
  camera: CameraPreferences;
  display: DisplayPreferences;
}

export const DEFAULT_PREFERENCES: PreferencesData = {
  general: {
    language: 'en',
    units: 'metric',
    rememberRecentFiles: true,
    autoArrangeOnImport: false,
    autoSliceAfterChange: false,
    autosave: true
  },
  camera: {
    invertMouseWheelZoom: false,
    invertOrbitHorizontal: false,
    invertOrbitVertical: false,
    rotateSensitivity: 1.0,
    zoomSpeed: 1.0,
    defaultCameraType: 'perspective'
  },
  display: {
    showGrid: true,
    showAxes: true,
    showLabels: false,
    showBuildVolume: true,
    showWireframe: false,
    showNavigator: true,
    cameraType: 'perspective',
    showSidebar: true,
    theme: 'dark'
  }
};

function loadStoredPreferences(): PreferencesData {
  if (typeof window === 'undefined' || !window.localStorage) {
    return DEFAULT_PREFERENCES;
  }
  try {
    const raw = window.localStorage.getItem(PREFS_STORAGE_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    const parsed = JSON.parse(raw);
    return {
      general: { ...DEFAULT_PREFERENCES.general, ...(parsed.general || {}) },
      camera: { ...DEFAULT_PREFERENCES.camera, ...(parsed.camera || {}) },
      display: { ...DEFAULT_PREFERENCES.display, ...(parsed.display || {}) }
    };
  } catch (err) {
    console.warn('[PrefsStore] Failed to load preferences from localStorage:', err);
    return DEFAULT_PREFERENCES;
  }
}

function saveStoredPreferences(data: PreferencesData): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(data));
  } catch (err) {
    console.warn('[PrefsStore] Failed to persist preferences to localStorage:', err);
  }
}

export type PrefsTabId = 'general' | 'camera' | 'display';

export interface PrefsStoreState extends PreferencesData {
  dialogOpen: boolean;
  activeDialogTab: PrefsTabId;

  // Dialog actions
  openDialog: (tab?: PrefsTabId) => void;
  closeDialog: () => void;
  setActiveDialogTab: (tab: PrefsTabId) => void;

  // Setting actions
  setGeneralPref: <K extends keyof GeneralPreferences>(key: K, value: GeneralPreferences[K]) => void;
  setCameraPref: <K extends keyof CameraPreferences>(key: K, value: CameraPreferences[K]) => void;
  setDisplayPref: <K extends keyof DisplayPreferences>(key: K, value: DisplayPreferences[K]) => void;

  // Quick toggles
  toggleShowGrid: () => void;
  toggleShowAxes: () => void;
  toggleShowLabels: () => void;
  toggleShowBuildVolume: () => void;
  toggleShowWireframe: () => void;
  toggleCameraType: () => void;
  toggleSidebar: () => void;

  // Reset
  resetDefaults: () => void;
}

const initialData = loadStoredPreferences();

export const usePrefsStore = create<PrefsStoreState>((set, get) => ({
  general: initialData.general,
  camera: initialData.camera,
  display: initialData.display,
  dialogOpen: false,
  activeDialogTab: 'general',

  openDialog: (tab = 'general') => set({ dialogOpen: true, activeDialogTab: tab }),
  closeDialog: () => set({ dialogOpen: false }),
  setActiveDialogTab: (tab) => set({ activeDialogTab: tab }),

  setGeneralPref: (key, value) => {
    set((state) => {
      const nextGeneral = { ...state.general, [key]: value };
      saveStoredPreferences({ general: nextGeneral, camera: state.camera, display: state.display });
      return { general: nextGeneral };
    });
  },

  setCameraPref: (key, value) => {
    set((state) => {
      const nextCamera = { ...state.camera, [key]: value };
      saveStoredPreferences({ general: state.general, camera: nextCamera, display: state.display });
      return { camera: nextCamera };
    });
  },

  setDisplayPref: (key, value) => {
    set((state) => {
      const nextDisplay = { ...state.display, [key]: value };
      saveStoredPreferences({ general: state.general, camera: state.camera, display: nextDisplay });
      return { display: nextDisplay };
    });
  },

  toggleShowGrid: () => {
    const cur = get().display.showGrid;
    get().setDisplayPref('showGrid', !cur);
  },

  toggleShowAxes: () => {
    const cur = get().display.showAxes;
    get().setDisplayPref('showAxes', !cur);
  },

  toggleShowLabels: () => {
    const cur = get().display.showLabels;
    get().setDisplayPref('showLabels', !cur);
  },

  toggleShowBuildVolume: () => {
    const cur = get().display.showBuildVolume;
    get().setDisplayPref('showBuildVolume', !cur);
  },

  toggleShowWireframe: () => {
    const cur = get().display.showWireframe;
    get().setDisplayPref('showWireframe', !cur);
  },

  toggleCameraType: () => {
    const cur = get().display.cameraType;
    const next = cur === 'perspective' ? 'orthographic' : 'perspective';
    get().setDisplayPref('cameraType', next);
  },

  toggleSidebar: () => {
    const cur = get().display.showSidebar;
    get().setDisplayPref('showSidebar', !cur);
  },

  resetDefaults: () => {
    saveStoredPreferences(DEFAULT_PREFERENCES);
    set({
      general: { ...DEFAULT_PREFERENCES.general },
      camera: { ...DEFAULT_PREFERENCES.camera },
      display: { ...DEFAULT_PREFERENCES.display }
    });
  }
}));

if (typeof window !== 'undefined') {
  (window as any).__prefsStore = usePrefsStore;
}
