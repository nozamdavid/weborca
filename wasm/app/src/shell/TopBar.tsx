import { useCompareStore } from '../settings/ComparePresetsDialog';
import { useWizardStore } from '../wizard';
import { confirmDialog } from '../components/ModalBackdrop';
import React, { useEffect, useRef, useState } from 'react';
import { useCalibrationStore } from '../calibration/calibrationStore';
import { useInputShapingStore } from '../calibration/inputShapingStore';
import { useOtherCalibrationStore } from '../calibration/otherCalibrationStore';
import { useHistoryStore } from '../history';
import { restorePlatesOnEmptyCanvas } from '../history/historyStore';
import { getEngine } from '../engine/orcaEngine';
import { usePlateStore } from '../plate/plateStore';
import { usePlatesStore } from '../plates/platesStore';
import { useAppStore } from '../store/appStore';
import { useEditOpsStore } from '../editops';
import { CAMERA_VIEWS, setCameraView } from './cameraBridge';
import { exportGcode, exportGcodeToFile } from './exportGcode';
import { exportPlateAsStl, exportModels } from './exportStl';
import { exportPlateSlicedFile, exportAllPlateSlicedFiles } from './exportPlateSlicedFile';
import { getRecentFiles, openRecentFile } from './recentFiles';
import { ImportIcon, RedoIcon, UndoIcon } from './glyphs';
import { useHelpStore } from './HelpDialogs';
import { useProjectNotesStore } from './ProjectNotesDialog';
import { usePrefsStore } from '../prefs/prefsStore';
import { usePreviewStore } from '../preview/previewStore';
import { useTranslation } from "../i18n";
import { AutosaveStatus } from './AutosaveStatus';

export type TabId = 'prepare' | 'preview' | 'device' | 'calibration';

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'prepare', label: "Prepare" },
  { id: 'preview', label: "Preview" },
  { id: 'device', label: "Device" },
  { id: 'calibration', label: "Calibration" }
];

interface Item {
  label: string;
  id?: string;
  keys?: string;
  disabled?: boolean;
  checked?: boolean;
  onClick?: () => void;
  submenu?: Item[];
}
type Entry = Item | 'sep';

const Menu: React.FC<{
  label: string;
  entries: Entry[];
  openMenu: string | null;
  setOpenMenu: (m: string | null) => void;
}> = ({ label, entries, openMenu, setOpenMenu }) => {
    const { t } = useTranslation();
  const open = openMenu === label;
  const positionSubmenu = (event: React.SyntheticEvent<HTMLDivElement>) => {
    const popup = event.currentTarget.querySelector<HTMLElement>('.menu-subpopup');
    if (!popup) return;
    const rect = event.currentTarget.getBoundingClientRect();
    popup.style.left = `${Math.max(4, Math.min(rect.right, window.innerWidth - popup.offsetWidth - 8))}px`;
    popup.style.top = `${Math.max(4, Math.min(rect.top, window.innerHeight - popup.scrollHeight - 8))}px`;
  };
  return (
    <div className={`menu ${open ? 'open' : ''}`} onMouseEnter={() => openMenu && setOpenMenu(label)}>
      <button
        className="menu-label"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpenMenu(open ? null : label)}
      >
        {label}
      </button>
      {open && (
        <div className="menu-popup" role="menu">
          {entries.map((e, i) => {
            if (e === 'sep') return <div className="menu-sep" key={i} />;
            if (e.submenu) {
              return (
                <div key={e.label} className="menu-item menu-submenu" role="menuitem" aria-haspopup="true" tabIndex={0}
                  onMouseEnter={positionSubmenu} onFocus={positionSubmenu}>
                  <span>{e.label}</span>
                  <span className="submenu-arrow">▶</span>
                  <div className="menu-subpopup" role="menu">
                    {e.submenu.map((sub, si) => (
                      <button
                        key={sub.label + si}
                        className="menu-item"
                        role="menuitem"
                        disabled={sub.disabled}
                        onClick={() => {
                          setOpenMenu(null);
                          sub.onClick?.();
                        }}
                      >
                        <span title={sub.label}>{sub.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            }
            const isCheckbox = e.checked !== undefined;
            return (
              <button
                key={e.label}
                id={e.id}
                className={`menu-item ${isCheckbox ? 'menu-item-checkbox' : ''}`}
                role={isCheckbox ? 'menuitemcheckbox' : 'menuitem'}
                aria-checked={e.checked}
                disabled={e.disabled}
                onClick={() => {
                  setOpenMenu(null);
                  e.onClick?.();
                }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {isCheckbox ? (
                    <span
                      className="menu-check"
                      aria-hidden="true"
                      style={{
                        display: 'inline-block',
                        width: 14,
                        textAlign: 'center',
                        color: 'var(--accent-color)',
                        fontWeight: 'bold',
                        fontSize: 12
                      }}
                    >
                      {e.checked ? '✓' : ''}
                    </span>
                  ) : null}
                  <span>{e.label}</span>
                </span>
                {e.keys && <kbd>{e.keys}</kbd>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export const TopBar: React.FC<{ activeTab: TabId; setActiveTab: (t: TabId) => void }> = ({
  activeTab,
  setActiveTab
}) => {
    const { t } = useTranslation();
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const barRef = useRef<HTMLElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const projectFileInput = useRef<HTMLInputElement>(null);
  const gcodeFileInput = useRef<HTMLInputElement>(null);

  const requestImportFile = useAppStore((s) => s.requestImportFile);
  const openProjectFile = useAppStore((s) => s.openProjectFile);
  const saveProjectFile = useAppStore((s) => s.saveProjectFile);
  const openGcodeFile = useAppStore((s) => s.openGcodeFile);
  const openManagePresetsDialog = useAppStore((s) => s.openManagePresetsDialog);
  const activePlateIndex = usePlatesStore((s) => s.activePlateIndex);
  const slicedPlate = useAppStore((s) => s.sliceResult);
  const hasGcode = !!slicedPlate?.gcode && slicedPlate.plateIndex === activePlateIndex;
  const hasPlateObjects = usePlateStore((s) => (s.objects?.length ?? 0) > 0);
  const hasModelFile = useAppStore((s) => !!s.modelFile);
  const hasObjects = hasPlateObjects || hasModelFile;
  const objectCount = usePlateStore((s) => (s.objects?.length ?? 0));
  const isWorking = useAppStore((s) => s.isSlicing || s.isModelLoading || !s.isEngineReady || s.isSelectingPreset);
  const isRestoring = useHistoryStore((s) => s.isRestoring);
  const isBusy = isWorking || isRestoring;
  const canUndo = useHistoryStore((s) => s.canUndo);
  const canRedo = useHistoryStore((s) => s.canRedo);
  const undo = useHistoryStore((s) => s.undo);
  const redo = useHistoryStore((s) => s.redo);
  const hasSelection = usePlateStore((s) => s.selectedObjectId != null);
  const hasClipboard = usePlateStore((s) => s.clipboard.length > 0);
  const explodeActive = usePlateStore((s) => s.explodeActive);

  // Preferences & View Store
  const prefsDisplay = usePrefsStore((s) => s.display);
  const openPrefs = usePrefsStore((s) => s.openDialog);
  const toggleShowGrid = usePrefsStore((s) => s.toggleShowGrid);
  const toggleShowAxes = usePrefsStore((s) => s.toggleShowAxes);
  const toggleShowLabels = usePrefsStore((s) => s.toggleShowLabels);
  const toggleShowBuildVolume = usePrefsStore((s) => s.toggleShowBuildVolume);
  const toggleShowWireframe = usePrefsStore((s) => s.toggleShowWireframe);
  const toggleCameraType = usePrefsStore((s) => s.toggleCameraType);
  const toggleSidebar = usePrefsStore((s) => s.toggleSidebar);

  // Preview options & legend
  const previewLegend = usePreviewStore((s) => s.legend);
  const toggleOption = usePreviewStore((s) => s.toggleOptionAction);
  const toggleExtrusionRole = usePreviewStore((s) => s.toggleExtrusionRoleAction);

  const travelOpt = previewLegend.options?.find((o) => o.name.toLowerCase().includes('travel'));
  const retractOpt = previewLegend.options?.find((o) => o.name.toLowerCase().includes('retract'));
  const wipeOpt = previewLegend.options?.find((o) => o.name.toLowerCase().includes('wipe'));
  const shellsItem = previewLegend.items?.find(
    (i) =>
      i.name.toLowerCase().includes('outer wall') ||
      i.name.toLowerCase().includes('inner wall') ||
      i.name.toLowerCase().includes('perimeter')
  );

  // Fullscreen state
  const [isFullscreen, setIsFullscreen] = useState(
    typeof document !== 'undefined' && !!document.fullscreenElement
  );

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  };

  useEffect(() => {
    if (!openMenu) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !barRef.current?.contains(e.target as Node))
        setOpenMenu(null);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [openMenu]);

  const importModel = () => fileInput.current?.click();
  const openProject = () => projectFileInput.current?.click();
  const saveProject = () => void saveProjectFile();
  const saveProjectAs = () => void saveProjectFile();
  const openGcode = () => gcodeFileInput.current?.click();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea, select')) {
        return;
      }

      // Check for Preferences: Ctrl+P
      if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        openPrefs();
        return;
      }

      // Show object labels: Ctrl+E
      if ((e.ctrlKey || e.metaKey) && (e.key === 'e' || e.key === 'E')) {
        e.preventDefault();
        toggleShowLabels();
        return;
      }

      // Zoom to bed: Ctrl+0
      if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault();
        setActiveTab('prepare');
        setCameraView('BED');
        return;
      }

      // Camera type toggle: K
      if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        toggleCameraType();
        return;
      }

      // Sidebar toggle: Shift+Tab
      if (e.shiftKey && e.key === 'Tab') {
        e.preventDefault();
        toggleSidebar();
        return;
      }

      // Existing Ctrl shortcuts
      if (!(e.ctrlKey || e.metaKey)) return;

      const appState = useAppStore.getState();
      const busy =
        appState.isSlicing ||
        !appState.isEngineReady ||
        appState.isModelLoading ||
        useHistoryStore.getState().isRestoring;
      const objs =
        (usePlateStore.getState().objects?.length ?? 0) > 0 ||
        !!appState.modelFile;
      const gcode = !!appState.sliceResult?.gcode;

      if (e.key === 'o' || e.key === 'O') {
        e.preventDefault();
        if (!busy) openProject();
      } else if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        if (!busy && objs) saveProject();
      } else if (e.key === 'i' || e.key === 'I') {
        e.preventDefault();
        if (!busy) importModel();
      } else if (e.key === 'g' || e.key === 'G') {
        e.preventDefault();
        if (gcode && !busy) exportGcode();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openPrefs, toggleShowLabels, toggleCameraType, toggleSidebar, setActiveTab]);

  const recentFiles = getRecentFiles();
  const other = useOtherCalibrationStore.getState;
  const inPreview = activeTab === 'preview';

  /** Empties the plate and the extra plates, like desktop's File > New project. */
  const newProject = async () => {
    if (!(await confirmDialog({ title: t("Close the current project?"), message: 'Unsaved changes are lost.', confirmLabel: 'Close project', cancelLabel: 'Cancel' }))) return;
    await usePlateStore.getState().deleteAll();
    await restorePlatesOnEmptyCanvas(await getEngine());
    await useAppStore.getState().applyOptionChange('notes', '', 'print');
    useAppStore.setState({ modelFile: null, modelObjects: null, sliceResult: null, gcodeUrl: null });
    usePreviewStore.getState().resetGcodeAction();
    await useHistoryStore.getState().initHistory();
    await (await import('./autosave')).clearAutosave();
  };

  const menus: Array<[string, Entry[]]> = [
    [
      'File',
      [
        { label: t("New project"), disabled: isBusy, onClick: newProject },
        { label: t("Open project..."), keys: 'Ctrl+O', disabled: isBusy, onClick: openProject },
        { label: t("Save project"), keys: 'Ctrl+S', disabled: isBusy || !hasObjects, onClick: saveProject },
        { label: t("Project notes..."), disabled: isBusy, onClick: () => useProjectNotesStore.getState().setOpen(true) },
        { label: t("Save project as..."), disabled: isBusy || !hasObjects, onClick: saveProjectAs },
        {
          label: t("Recent files"),
          submenu:
            recentFiles.length > 0
              ? recentFiles.map((rf) => ({
                  label: rf.name,
                  onClick: () =>
                    openRecentFile(rf, (name) => {
                      if (name.toLowerCase().endsWith('.3mf')) projectFileInput.current?.click();
                      else if (name.toLowerCase().endsWith('.gcode')) gcodeFileInput.current?.click();
                      else fileInput.current?.click();
                    })
                }))
              : [{ label: t("No recent files"), disabled: true }]
        },
        'sep',
        { label: t("Import model..."), keys: 'Ctrl+I', disabled: isBusy, onClick: importModel },
        { label: t("Import ZIP Archive..."), disabled: isBusy, onClick: importModel },
        { label: t("Open G-code..."), disabled: isBusy, onClick: openGcode },
        'sep',
        { label: t("Export plate as STL..."), disabled: isBusy || !hasObjects, onClick: () => void exportPlateAsStl() },
        { label: t("Export all objects as one STL..."), disabled: isBusy || !hasObjects, onClick: () => void exportModels('stl') },
        { label: t("Export objects as STLs..."), disabled: isBusy || !hasObjects, onClick: () => void exportModels('stl', true) },
        { label: t("Export all objects as one DRC..."), disabled: isBusy || !hasObjects, onClick: () => void exportModels('drc') },
        { label: t("Export objects as DRCs..."), disabled: isBusy || !hasObjects, onClick: () => void exportModels('drc', true) },
        { label: t("Export Generic 3MF..."), disabled: isBusy || !hasObjects, onClick: () => void exportModels('3mf') },
        { label: t("Export G-code"), keys: 'Ctrl+G', disabled: !hasGcode || isBusy, onClick: exportGcode },
        { label: t("Export G-code to drive..."), disabled: !hasGcode || isBusy, onClick: () => void exportGcodeToFile() },
        { label: t("Export plate sliced file"), disabled: !hasGcode || isBusy || useAppStore.getState().sliceResult?.plateIndex !== usePlatesStore.getState().activePlateIndex, onClick: () => void exportPlateSlicedFile() },
        { label: t("Export all plates sliced file..."), disabled: isBusy || !hasObjects, onClick: () => void exportAllPlateSlicedFiles() },
        'sep',
        { label: t("Printer presets..."), onClick: () => openManagePresetsDialog('printer') },
        { label: t("Filament presets..."), onClick: () => openManagePresetsDialog('filament') },
        { label: t("Process presets..."), onClick: () => openManagePresetsDialog('process') },
        { label: t("Compare presets..."), onClick: () => useCompareStore.getState().setOpen(true) },
        { label: t("Configuration wizard..."), onClick: () => useWizardStore.getState().setOpen(true) },
        'sep',
        { label: t("Preferences..."), keys: 'Ctrl+P', onClick: () => openPrefs('general') }
      ]
    ],
    [
      'Edit',
      [
        { label: t("Undo"), keys: 'Ctrl+Z', disabled: !canUndo || isBusy, onClick: () => undo() },
        { label: t("Redo"), keys: 'Ctrl+Y', disabled: !canRedo || isBusy, onClick: () => redo() },
        'sep',
        { label: t("Select all"), keys: 'Ctrl+A', disabled: isBusy || !hasObjects, onClick: () => usePlateStore.getState().selectAll() },
        { label: t("Deselect all"), keys: 'Esc', disabled: !hasSelection, onClick: () => usePlateStore.getState().selectObject(null) },
        { label: t("Cut"), keys: 'Ctrl+X', disabled: isBusy || !hasSelection, onClick: () => void usePlateStore.getState().cutSelected() },
        { label: t("Copy"), keys: 'Ctrl+C', disabled: isBusy || !hasSelection, onClick: () => void usePlateStore.getState().copySelected() },
        { label: t("Paste"), keys: 'Ctrl+V', disabled: isBusy || !hasClipboard, onClick: () => void usePlateStore.getState().pasteClipboard() },
        { label: t("Duplicate Current Plate"), disabled: isBusy, onClick: () => void usePlatesStore.getState().duplicatePlate(usePlatesStore.getState().activePlateIndex) },
        { label: t("Clone"), keys: 'Ctrl+K', disabled: isBusy || !hasSelection, onClick: () => void usePlateStore.getState().duplicateSelected() },
        { label: t("Mirror X"), disabled: isBusy || !hasSelection, onClick: () => void usePlateStore.getState().mirrorSelected(0) },
        { label: t("Mirror Y"), disabled: isBusy || !hasSelection, onClick: () => void usePlateStore.getState().mirrorSelected(1) },
        { label: t("Mirror Z"), disabled: isBusy || !hasSelection, onClick: () => void usePlateStore.getState().mirrorSelected(2) },
        { label: t("Delete all"), keys: 'Ctrl+D', disabled: isBusy || !hasObjects, onClick: () => void usePlateStore.getState().deleteAll() },
        'sep',
        { label: t("Auto-orient"), keys: 'A', disabled: isBusy || !hasSelection, onClick: () => void useEditOpsStore.getState().autoOrient() },
        { label: t("Place on face"), keys: 'F', disabled: isBusy || !hasSelection, onClick: () => void useEditOpsStore.getState().startFlatten() },
        { label: t("Arrange options..."), disabled: isBusy, onClick: () => usePlateStore.getState().setArrangeDialogOpen(true) },
        { label: t("Arrange"), disabled: isBusy, onClick: () => void usePlateStore.getState().arrange(true) },
        {
          label: t("Delete"),
          keys: 'Del',
          disabled: isBusy || !hasSelection,
          onClick: () => void usePlateStore.getState().deleteSelected()
        },
        'sep',
        { label: t("Split to objects"), disabled: isBusy || !hasSelection, onClick: () => void useEditOpsStore.getState().splitSelectedObject() },
        { label: t("Split to parts"), disabled: isBusy || !hasSelection, onClick: () => void useEditOpsStore.getState().splitSelectedVolume() },
        { label: t("Simplify..."), disabled: isBusy || !hasSelection, onClick: () => void useEditOpsStore.getState().openSimplifyDialog() },
        { label: t("Mesh boolean..."), disabled: isBusy || objectCount < 2, onClick: () => void useEditOpsStore.getState().openBooleanDialog() },
        { label: t("Brim ears..."), disabled: isBusy || !hasSelection, onClick: () => void useEditOpsStore.getState().startBrimEars() },
        { label: t("Add SVG..."), disabled: isBusy, onClick: () => void useEditOpsStore.getState().openSvgDialog() },
        'sep',
        { label: t("Preferences..."), keys: 'Ctrl+P', onClick: () => openPrefs('general') }
      ]
    ],
    [
      'View',
      [
        ...CAMERA_VIEWS.map((v): Item => ({
          label: t(v.label),
          keys: v.key,
          onClick: () => {
            setActiveTab('prepare');
            setCameraView(v.view);
          }
        })),
        'sep',
        {
          label: t("Zoom to selection"),
          keys: 'Z',
          onClick: () => {
            setActiveTab('prepare');
            setCameraView('Z');
          }
        },
        {
          label: t("Zoom to bed"),
          keys: 'Ctrl+0',
          onClick: () => {
            setActiveTab('prepare');
            setCameraView('BED');
          }
        },
        'sep',
        {
          label: t("Orthographic camera"),
          keys: 'K',
          checked: prefsDisplay.cameraType === 'orthographic',
          onClick: toggleCameraType
        },
        {
          label: t("Auto Perspective"),
          checked: prefsDisplay.autoPerspective,
          onClick: () => usePrefsStore.getState().setDisplayPref('autoPerspective', !prefsDisplay.autoPerspective)
        },
        'sep',
        {
          label: t("Bed grid"),
          checked: prefsDisplay.showGrid,
          onClick: toggleShowGrid
        },
        {
          label: t("Show Overhang"),
          checked: prefsDisplay.showOverhang,
          onClick: () => usePrefsStore.getState().setDisplayPref('showOverhang', !prefsDisplay.showOverhang)
        },
        {
          label: t("3D navigator"),
          checked: prefsDisplay.showNavigator,
          onClick: () => usePrefsStore.getState().setDisplayPref('showNavigator', !prefsDisplay.showNavigator)
        },
        {
          label: t("Axes"),
          checked: prefsDisplay.showAxes,
          onClick: toggleShowAxes
        },
        {
          label: t("Object labels"),
          keys: 'Ctrl+E',
          checked: prefsDisplay.showLabels,
          onClick: toggleShowLabels
        },
        {
          label: t("Build volume wireframe"),
          checked: prefsDisplay.showBuildVolume,
          onClick: toggleShowBuildVolume
        },
        {
          label: t("Wireframe objects"),
          keys: 'Ctrl+Shift+Enter',
          checked: prefsDisplay.showWireframe,
          onClick: toggleShowWireframe
        },
        'sep',
        {
          label: t("Explode view"),
          id: 'menu-view-explode',
          checked: explodeActive,
          onClick: () => usePlateStore.getState().setExplodeActive(!explodeActive)
        },
        'sep',
        {
          label: t("Show shells"),
          checked: shellsItem ? shellsItem.visible : true,
          disabled: !inPreview || !shellsItem,
          onClick: () => {
            if (shellsItem) toggleExtrusionRole(shellsItem.id);
          }
        },
        {
          label: t("Show travel moves"),
          checked: travelOpt ? travelOpt.visible : true,
          disabled: !inPreview || !travelOpt,
          onClick: () => {
            if (travelOpt) toggleOption(travelOpt.id);
          }
        },
        {
          label: t("Show retractions"),
          checked: retractOpt ? retractOpt.visible : true,
          disabled: !inPreview || !retractOpt,
          onClick: () => {
            if (retractOpt) toggleOption(retractOpt.id);
          }
        },
        {
          label: t("Show wipe moves"),
          checked: wipeOpt ? wipeOpt.visible : true,
          disabled: !inPreview || !wipeOpt,
          onClick: () => {
            if (wipeOpt) toggleOption(wipeOpt.id);
          }
        },
        'sep',
        {
          label: t("Show sidebar"),
          keys: 'Shift+Tab',
          checked: prefsDisplay.showSidebar,
          onClick: toggleSidebar
        },
        {
          label: t("Fullscreen"),
          keys: 'F11',
          checked: isFullscreen,
          onClick: toggleFullscreen
        }
      ]
    ],
    [
      'Calibration',
      [
        { label: t("Flow rate..."), onClick: () => useCalibrationStore.getState().openDialog() },
        { label: t("Temperature..."), onClick: () => other().openDialog('temp') },
        { label: t("Pressure advance (line)..."), onClick: () => other().openDialog('pa_line') },
        { label: t("Pressure advance (pattern)..."), onClick: () => other().openDialog('pa_pattern') },
        { label: t("Pressure advance (tower)..."), onClick: () => other().openDialog('pa_tower') },
        { label: t("Retraction..."), onClick: () => other().openDialog('retraction') },
        { label: t("Max volumetric speed..."), onClick: () => other().openDialog('max_vol') },
        { label: t("VFA..."), onClick: () => other().openDialog('vfa') },
        'sep',
        { label: t("Input shaping frequency..."), onClick: () => useInputShapingStore.getState().openDialog('freq') },
        { label: t("Input shaping damping..."), onClick: () => useInputShapingStore.getState().openDialog('damp') },
        { label: t("Cornering..."), onClick: () => useInputShapingStore.getState().openDialog('cornering') }
      ]
    ],
    [
      'Help',
      [
        { label: t("Configuration wizard..."), onClick: () => useWizardStore.getState().setOpen(true) },
        { label: t("Calibration Guide"), onClick: () => window.open('https://www.orcaslicer.com/wiki/calibration_guide', '_blank', 'noopener,noreferrer') },
        {
          label: t("OrcaSlicer Wiki"),
          onClick: () => window.open('https://github.com/OrcaSlicer/OrcaSlicer/wiki', '_blank', 'noopener,noreferrer')
        },
        {
          label: t("OrcaSlicer GitHub"),
          onClick: () => window.open('https://github.com/OrcaSlicer/OrcaSlicer', '_blank', 'noopener,noreferrer')
        },
        'sep',
        { label: t("Keyboard shortcuts"), onClick: () => useHelpStore.getState().open('shortcuts') },
        { label: t("About OrcaSlicer Web"), onClick: () => useHelpStore.getState().open('about') }
      ]
    ]
  ];

  return (
    <header className="topbar" ref={barRef}>
      <div className="topbar-left">
        <div className="topbar-logo">
          <img src="/icons/OrcaSlicer.svg" alt="" />
          {t("OrcaSlicer Web")}</div>
        {menus.map(([label, entries]) => (
          <Menu key={label} label={t(label)} entries={entries} openMenu={openMenu} setOpenMenu={setOpenMenu} />
        ))}
      </div>

      <nav className="tabs" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            id={`tab-${tab.id}`}
            data-testid={`tab-${tab.id}`}
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {t(tab.label)}
          </button>
        ))}
      </nav>

      <div className="topbar-right">
        <AutosaveStatus />
        <input
          type="file"
          id="project-file-input"
          data-testid="project-file-input"
          ref={projectFileInput}
          style={{ display: 'none' }}
          accept=".3mf"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void openProjectFile(file);
            e.target.value = '';
          }}
        />
        <input
          type="file"
          id="model-file"
          data-testid="model-file"
          ref={fileInput}
          style={{ display: 'none' }}
          accept=".stl,.obj,.3mf,.amf,.step,.stp,.svg,.zip"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) requestImportFile(file);
            e.target.value = '';
          }}
        />
        <input
          type="file"
          id="gcode-file-input"
          data-testid="gcode-file-input"
          ref={gcodeFileInput}
          style={{ display: 'none' }}
          accept=".gcode"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void openGcodeFile(file);
            e.target.value = '';
          }}
        />
        <button
          className="icon-btn"
          id="import-btn"
          title={t("Import model (Ctrl+I)")}
          aria-label={t("Import model")}
          disabled={isBusy}
          onClick={importModel}
        >
          <ImportIcon />
        </button>
        <button
          className="icon-btn"
          id="undo-btn"
          data-testid="undo-btn"
          title={t("Undo (Ctrl+Z)")}
          aria-label={t("Undo")}
          disabled={!canUndo || isBusy}
          onClick={() => undo()}
        >
          <UndoIcon />
        </button>
        <button
          className="icon-btn"
          id="redo-btn"
          data-testid="redo-btn"
          title={t("Redo (Ctrl+Y)")}
          aria-label={t("Redo")}
          disabled={!canRedo || isBusy}
          onClick={() => redo()}
        >
          <RedoIcon />
        </button>
      </div>
    </header>
  );
};
