import React, { useEffect, useRef, useState } from 'react';
import { useCalibrationStore } from '../calibration/calibrationStore';
import { useInputShapingStore } from '../calibration/inputShapingStore';
import { useOtherCalibrationStore } from '../calibration/otherCalibrationStore';
import { useHistoryStore } from '../history';
import { usePlateStore } from '../plate/plateStore';
import { useAppStore } from '../store/appStore';
import { useEditOpsStore } from '../editops';
import { CAMERA_VIEWS, setCameraView } from './cameraBridge';
import { exportGcode } from './exportGcode';
import { exportPlateAsStl } from './exportStl';
import { exportPlateSlicedFile } from './exportPlateSlicedFile';
import { getRecentFiles, openRecentFile } from './recentFiles';
import { ImportIcon, RedoIcon, UndoIcon } from './glyphs';
import { useHelpStore } from './HelpDialogs';

export type TabId = 'prepare' | 'preview' | 'device' | 'calibration';

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'prepare', label: 'Prepare' },
  { id: 'preview', label: 'Preview' },
  { id: 'device', label: 'Device' },
  { id: 'calibration', label: 'Calibration' }
];

interface Item {
  label: string;
  keys?: string;
  disabled?: boolean;
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
  const open = openMenu === label;
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
                <div key={e.label} className="menu-item menu-submenu" role="menuitem" aria-haspopup="true">
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
            return (
              <button
                key={e.label}
                className="menu-item"
                role="menuitem"
                disabled={e.disabled}
                onClick={() => {
                  setOpenMenu(null);
                  e.onClick?.();
                }}
              >
                <span>{e.label}</span>
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
  const hasGcode = useAppStore((s) => !!s.sliceResult?.gcode);
  const hasPlateObjects = usePlateStore((s) => (s.objects?.length ?? 0) > 0);
  const hasModelFile = useAppStore((s) => !!s.modelFile);
  const hasObjects = hasPlateObjects || hasModelFile;
  const objectCount = usePlateStore((s) => (s.objects?.length ?? 0));
  const isWorking = useAppStore((s) => s.isSlicing || s.isModelLoading);
  const isRestoring = useHistoryStore((s) => s.isRestoring);
  const isBusy = isWorking || isRestoring;
  const canUndo = useHistoryStore((s) => s.canUndo);
  const canRedo = useHistoryStore((s) => s.canRedo);
  const undo = useHistoryStore((s) => s.undo);
  const redo = useHistoryStore((s) => s.redo);
  const hasSelection = usePlateStore((s) => s.selectedObjectId != null);

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
      if (
        !(e.ctrlKey || e.metaKey) ||
        (e.target as HTMLElement | null)?.closest?.('input, textarea, select')
      )
        return;
      const appState = useAppStore.getState();
      const busy =
        appState.isSlicing ||
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
  }, []);

  const recentFiles = getRecentFiles();
  const other = useOtherCalibrationStore.getState;
  const menus: Array<[string, Entry[]]> = [
    [
      'File',
      [
        { label: 'Open project...', keys: 'Ctrl+O', disabled: isBusy, onClick: openProject },
        { label: 'Save project', keys: 'Ctrl+S', disabled: isBusy || !hasObjects, onClick: saveProject },
        { label: 'Save project as...', disabled: isBusy || !hasObjects, onClick: saveProjectAs },
        {
          label: 'Recent files',
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
              : [{ label: 'No recent files', disabled: true }]
        },
        'sep',
        { label: 'Import model...', keys: 'Ctrl+I', disabled: isBusy, onClick: importModel },
        { label: 'Open G-code...', disabled: isBusy, onClick: openGcode },
        'sep',
        { label: 'Export plate as STL...', disabled: isBusy || !hasObjects, onClick: () => void exportPlateAsStl() },
        { label: 'Export G-code', keys: 'Ctrl+G', disabled: !hasGcode || isBusy, onClick: exportGcode },
        { label: 'Export plate sliced file', disabled: !hasGcode || isBusy, onClick: () => void exportPlateSlicedFile() },
        'sep',
        { label: 'Printer presets...', onClick: () => openManagePresetsDialog('printer') },
        { label: 'Filament presets...', onClick: () => openManagePresetsDialog('filament') },
        { label: 'Process presets...', onClick: () => openManagePresetsDialog('process') }
      ]
    ],
    [
      'Edit',
      [
        { label: 'Undo', keys: 'Ctrl+Z', disabled: !canUndo || isBusy, onClick: () => undo() },
        { label: 'Redo', keys: 'Ctrl+Y', disabled: !canRedo || isBusy, onClick: () => redo() },
        'sep',
        { label: 'Auto-orient', keys: 'A', disabled: isBusy || !hasSelection, onClick: () => void useEditOpsStore.getState().autoOrient() },
        { label: 'Place on face', keys: 'F', disabled: isBusy || !hasSelection, onClick: () => void useEditOpsStore.getState().startFlatten() },
        { label: 'Arrange', disabled: isBusy, onClick: () => void usePlateStore.getState().arrange(true) },
        {
          label: 'Delete',
          keys: 'Del',
          disabled: isBusy || !hasSelection,
          onClick: () => void usePlateStore.getState().deleteSelected()
        },
        'sep',
        { label: 'Split to objects', disabled: isBusy || !hasSelection, onClick: () => void useEditOpsStore.getState().splitSelectedObject() },
        { label: 'Split to parts', disabled: isBusy || !hasSelection, onClick: () => void useEditOpsStore.getState().splitSelectedVolume() },
        { label: 'Simplify...', disabled: isBusy || !hasSelection, onClick: () => void useEditOpsStore.getState().openSimplifyDialog() },
        { label: 'Mesh boolean...', disabled: isBusy || objectCount < 2, onClick: () => void useEditOpsStore.getState().openBooleanDialog() },
        { label: 'Brim ears...', disabled: isBusy || !hasSelection, onClick: () => void useEditOpsStore.getState().startBrimEars() },
        { label: 'Add SVG...', disabled: isBusy, onClick: () => void useEditOpsStore.getState().openSvgDialog() }
      ]
    ],
    [
      'View',
      [
        ...CAMERA_VIEWS.map((v): Item => ({
          label: v.label,
          keys: v.key,
          onClick: () => {
            setActiveTab('prepare');
            setCameraView(v.view);
          }
        })),
        'sep',
        {
          label: 'Zoom to selection',
          keys: 'Z',
          onClick: () => {
            setActiveTab('prepare');
            setCameraView('Z');
          }
        }
      ]
    ],
    [
      'Calibration',
      [
        { label: 'Flow rate...', onClick: () => useCalibrationStore.getState().openDialog() },
        { label: 'Temperature...', onClick: () => other().openDialog('temp') },
        { label: 'Pressure advance (line)...', onClick: () => other().openDialog('pa_line') },
        { label: 'Pressure advance (pattern)...', onClick: () => other().openDialog('pa_pattern') },
        { label: 'Pressure advance (tower)...', onClick: () => other().openDialog('pa_tower') },
        { label: 'Retraction...', onClick: () => other().openDialog('retraction') },
        { label: 'Max volumetric speed...', onClick: () => other().openDialog('max_vol') },
        { label: 'VFA...', onClick: () => other().openDialog('vfa') },
        'sep',
        { label: 'Input shaping frequency...', onClick: () => useInputShapingStore.getState().openDialog('freq') },
        { label: 'Input shaping damping...', onClick: () => useInputShapingStore.getState().openDialog('damp') },
        { label: 'Cornering...', onClick: () => useInputShapingStore.getState().openDialog('cornering') }
      ]
    ],
    [
      'Help',
      [
        { label: 'Keyboard shortcuts', onClick: () => useHelpStore.getState().open('shortcuts') },
        { label: 'About OrcaSlicer Web', onClick: () => useHelpStore.getState().open('about') }
      ]
    ]
  ];

  return (
    <header className="topbar" ref={barRef}>
      <div className="topbar-left">
        <div className="topbar-logo">
          <img src="/icons/OrcaSlicer.svg" alt="" />
          OrcaSlicer Web
        </div>
        {menus.map(([label, entries]) => (
          <Menu key={label} label={label} entries={entries} openMenu={openMenu} setOpenMenu={setOpenMenu} />
        ))}
      </div>

      <nav className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            id={`tab-${t.id}`}
            data-testid={`tab-${t.id}`}
            role="tab"
            aria-selected={activeTab === t.id}
            className={`tab ${activeTab === t.id ? 'active' : ''}`}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="topbar-right">
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
          accept=".stl,.obj,.3mf,.amf,.step,.stp,.svg"
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
          title="Import model (Ctrl+I)"
          aria-label="Import model"
          disabled={isBusy}
          onClick={importModel}
        >
          <ImportIcon />
        </button>
        <button
          className="icon-btn"
          id="undo-btn"
          data-testid="undo-btn"
          title="Undo (Ctrl+Z)"
          aria-label="Undo"
          disabled={!canUndo || isBusy}
          onClick={() => undo()}
        >
          <UndoIcon />
        </button>
        <button
          className="icon-btn"
          id="redo-btn"
          data-testid="redo-btn"
          title="Redo (Ctrl+Y)"
          aria-label="Redo"
          disabled={!canRedo || isBusy}
          onClick={() => redo()}
        >
          <RedoIcon />
        </button>
      </div>
    </header>
  );
};
