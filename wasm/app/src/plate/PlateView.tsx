import React, { useEffect, useRef, useState, useCallback } from 'react';
import { usePlateStore } from './plateStore';
import { PlateScene } from './PlateScene';
import { useAppStore } from '../store/appStore';
import { PlateSelectorBar } from '../plates/PlateSelectorBar';
import { usePaintToolsStore, PaintToolsPanel, StrokeCollector } from '../paint-tools';
import { useLayersStore, LayerHeightPanel } from '../layers';
import { getPaintOverlay, parsePaintOverlayBinary } from '../paint-tools/paintToolsApi';
import type { PaintState } from '../paint-tools/types';
import { getEngine } from '../engine/orcaEngine';
import { useHistoryStore } from '../history';
import { TextPanel, useTextStore } from '../text';
import { CutPanel, useCutStore } from '../cut';
import { RepairBadge, useRepairStore } from '../repair';
import { useEditOpsStore, FlattenPanel, BrimEarsPanel } from '../editops';
import { CanvasToolbar, ViewButtons } from '../shell/CanvasToolbar';
import type { CanvasTool } from '../shell/CanvasToolbar';
import { registerCameraHandler, setCameraView } from '../shell/cameraBridge';
import type { CameraView } from '../shell/cameraBridge';
import { RedoIcon, UndoIcon } from '../shell/glyphs';

function formatPrintTime(seconds: number): string {
  if (!seconds || seconds <= 0) return '0s';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) {
    return `${hrs}h ${mins}m ${secs}s`;
  }
  if (mins > 0) {
    return `${mins}m ${secs}s`;
  }
  return `${secs}s`;
}

export const PlateView: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<PlateScene | null>(null);

  // Plate Store
  const objects = usePlateStore((s) => s.objects);
  const selectedObjectId = usePlateStore((s) => s.selectedObjectId);
  const selectedInstanceId = usePlateStore((s) => s.selectedInstanceId);
  const gizmoMode = usePlateStore((s) => s.gizmoMode);
  const bedConfig = usePlateStore((s) => s.bedConfig);
  const isLoading = usePlateStore((s) => s.isLoading);

  const refreshObjects = usePlateStore((s) => s.refreshObjects);
  const selectObject = usePlateStore((s) => s.selectObject);
  const setGizmoMode = usePlateStore((s) => s.setGizmoMode);
  const setInstanceTransform = usePlateStore((s) => s.setInstanceTransform);
  const deleteSelected = usePlateStore((s) => s.deleteSelected);
  const arrange = usePlateStore((s) => s.arrange);
  const getMesh = usePlateStore((s) => s.getMesh);
  const initBedConfig = usePlateStore((s) => s.initBedConfig);

  // History / Undo-Redo Store
  const canUndo = useHistoryStore((s) => s.canUndo);
  const canRedo = useHistoryStore((s) => s.canRedo);
  const isRestoring = useHistoryStore((s) => s.isRestoring);
  const undo = useHistoryStore((s) => s.undo);
  const redo = useHistoryStore((s) => s.redo);

  const isPaintingActive = usePaintToolsStore((s) => s.isActive);
  const paintLayer = usePaintToolsStore((s) => s.layer);
  const paintTool = usePaintToolsStore((s) => s.tool);
  const cursorRadius = usePaintToolsStore((s) => s.cursorRadius);
  const selectedVolumeId = usePaintToolsStore((s) => s.selectedVolumeId);
  const paintOverlayRevision = usePaintToolsStore((s) => s.overlayRevision);
  const stopPainting = usePaintToolsStore((s) => s.stopPainting);
  const isLayersActive = useLayersStore((s) => s.isLayersActive);
  const isTextActive = useTextStore((s) => s.isOpen);
  const isCutActive = useCutStore((s) => s.isCutActive);
  const isCutting = useCutStore((s) => s.isCutting);
  const isRepairing = useRepairStore((s) => s.isRepairing);

  // Edit Ops Store
  const activeEditTool = useEditOpsStore((s) => s.activeTool);
  const activeEditDialog = useEditOpsStore((s) => s.activeDialog);
  const isOperatingEdit = useEditOpsStore((s) => s.isOperating);

  const strokeCollector = useRef<StrokeCollector | null>(null);
  if (!strokeCollector.current) strokeCollector.current = new StrokeCollector();
  const [meshRevision, setMeshRevision] = useState(0);

  // App Store (for Slicing progress & printer selection)
  const isSlicing = useAppStore((s) => s.isSlicing);
  const slicePercent = useAppStore((s) => s.slicePercent);
  const sliceStatusText = useAppStore((s) => s.sliceStatusText);
  const sliceResult = useAppStore((s) => s.sliceResult);
  const gcodeUrl = useAppStore((s) => s.gcodeUrl);
  const modelFile = useAppStore((s) => s.modelFile);

  const currentConfig = useAppStore((s) => s.currentConfig);

  const [isDragOver, setIsDragOver] = useState(false);

  // Initialize Bed Config on Mount
  useEffect(() => {
    initBedConfig();
  }, [initBedConfig]);

  // Sync Bed Dimensions when active printer config changes
  useEffect(() => {
    if (currentConfig) {
      initBedConfig();
    }
  }, [currentConfig, initBedConfig]);

  // Initialize Three.js Scene
  useEffect(() => {
    if (!containerRef.current) return;

    const scene = new PlateScene(containerRef.current, bedConfig, {
      onSelect: (objId, instId) => {
        selectObject(objId, instId);
      },
      onTransformChange: (objId, instId, trafo) => {
        setInstanceTransform(objId, instId, trafo);
      },
      getMesh: async (objId) => {
        const mesh = await getMesh(objId);
        if (!mesh.volumes) {
          try {
            const engine = await getEngine();
            let res: any;
            if (typeof (engine as any).getMesh === 'function') {
              res = await (engine as any).getMesh(objId);
            } else {
              res = await engine.call('getMesh', { objectId: objId });
            }
            if (res && res.volumes) {
              mesh.volumes = res.volumes;
            }
          } catch (_) {}
        }
        return mesh;
      },
      onToolPaintBegin: (hit, facet, button, erase, cameraPos) => {
        const paint = usePaintToolsStore.getState();
        if (paint.selectedObjectId === null || paint.selectedVolumeId === null || paint.selectedInstanceId === null) return;
        const state: PaintState = erase ? 'none' : paint.layer === 'color' ? (button === 2 ? 'none' : paint.activeFilament) : paint.layer === 'fuzzy' ? (button === 2 ? 'none' : 'fuzzy') : (button === 2 ? 'blocker' : 'enforcer');
        const collector = strokeCollector.current!;
        collector.beginStroke({ objectId: paint.selectedObjectId, instanceId: paint.selectedInstanceId, volumeId: paint.selectedVolumeId, layer: paint.layer, tool: paint.tool, state, radius: paint.cursorRadius, cameraPos, triangleSplitting: paint.triangleSplitting, overhangAngleDeg: paint.overhangOnly ? paint.overhangAngle : 0, smartFillAngleDeg: paint.smartFillAngle }).catch(console.error);
        collector.addPoint(hit, facet);
      },
      onToolPaintPoint: (hit, facet) => strokeCollector.current?.addPoint(hit, facet),
      onToolPaintEnd: () => { void strokeCollector.current?.endStroke(); },
      onFlattenFacetClick: (facetIndex) => {
        void useEditOpsStore.getState().applyPlaceOnFace(facetIndex);
      },
      onBrimEarClick: (position, clickedEarIndex) => {
        const store = useEditOpsStore.getState();
        if (typeof clickedEarIndex === 'number') {
          void store.removeBrimEar(clickedEarIndex);
        } else {
          void store.addBrimEar(position);
        }
      }
    });

    sceneRef.current = scene;
    if (typeof window !== 'undefined') {
      (window as any).__plateScene = scene;
    }

    // Initial objects load
    refreshObjects();

    return () => {
      scene.destroy();
      sceneRef.current = null;
      if (typeof window !== 'undefined' && (window as any).__plateScene === scene) {
        delete (window as any).__plateScene;
      }
      strokeCollector.current?.cancelStroke();
      usePaintToolsStore.getState().stopPainting();
      useCutStore.getState().closeCut();
      useEditOpsStore.getState().stopFlatten();
      useEditOpsStore.getState().stopBrimEars();
    };
  }, []);

  // Update bed in scene when config changes
  useEffect(() => {
    if (sceneRef.current) {
      sceneRef.current.updateBedConfig(bedConfig);
    }
  }, [bedConfig]);

  // Sync active edit tool with scene overlays
  useEffect(() => {
    if (sceneRef.current) {
      sceneRef.current.setBrimEarsActive(activeEditTool === 'brimears');
      if (activeEditTool !== 'flatten') {
        sceneRef.current.clearFlattenClusters();
      }
      if (activeEditTool !== 'brimears') {
        sceneRef.current.clearBrimEarsOverlay();
      }
    }
  }, [activeEditTool]);

  // Update scene objects when objects change
  useEffect(() => {
    if (sceneRef.current) {
      const paintState = usePaintToolsStore.getState();
      if (paintState.isActive && paintState.selectedObjectId !== null) {
        if (!objects.some((o) => o.id === paintState.selectedObjectId)) {
          strokeCollector.current?.cancelStroke();
          paintState.stopPainting();
        }
      }
      sceneRef.current.setObjects(objects);
      setMeshRevision((revision) => revision + 1);
    }
  }, [objects]);

  // Update selection in scene and stores
  useEffect(() => {
    if (sceneRef.current) {
      sceneRef.current.setSelection(selectedObjectId, selectedInstanceId);
      const paintState = usePaintToolsStore.getState();
      if (paintState.isActive) {
        if (!selectedObjectId || selectedObjectId !== paintState.selectedObjectId) {
          strokeCollector.current?.cancelStroke();
          if (selectedObjectId) {
            const volume = sceneRef.current.getMeshVolumes(selectedObjectId)?.[0]?.volumeId;
            void paintState.startPainting(selectedObjectId, volume, selectedInstanceId);
          } else {
            paintState.stopPainting();
          }
        }
      }
    }
    const cutStore = useCutStore.getState();
    if (cutStore.isCutActive && !cutStore.isCutting && !useHistoryStore.getState().isRestoring && selectedObjectId === null) {
      cutStore.closeCut();
    }
    if (!useRepairStore.getState().isRepairing) {
      void useRepairStore.getState().selectObject(selectedObjectId);
    }
  }, [selectedObjectId, selectedInstanceId]);

  useEffect(() => {
    const layers = useLayersStore.getState();
    if (!layers.isLayersActive || layers.selectedObjectId === selectedObjectId) return;
    if (selectedObjectId === null) layers.stopEditing();
    else void layers.startEditing(selectedObjectId);
  }, [selectedObjectId]);

  // Stop tools if slicing starts
  useEffect(() => {
    if (isSlicing) {
      if (usePaintToolsStore.getState().isActive) {
        strokeCollector.current?.cancelStroke();
        usePaintToolsStore.getState().stopPainting();
      }
      if (useCutStore.getState().isCutActive) {
        useCutStore.getState().closeCut();
      }
      if (useEditOpsStore.getState().activeTool) {
        useEditOpsStore.getState().stopFlatten();
        useEditOpsStore.getState().stopBrimEars();
      }
    }
  }, [isSlicing]);

  // Update gizmo mode in scene
  useEffect(() => {
    if (sceneRef.current) {
      sceneRef.current.setGizmoMode(gizmoMode);
    }
  }, [gizmoMode]);

  // Sync painting active mode and selected volume to scene
  useEffect(() => {
    if (sceneRef.current) {
      sceneRef.current.setAdvancedPainting(isPaintingActive, selectedVolumeId);
    }
  }, [isPaintingActive, selectedVolumeId]);

  useEffect(() => {
    sceneRef.current?.setPaintCursor(cursorRadius, paintTool);
  }, [cursorRadius, paintTool]);

  // Re-query split-triangle overlays on layer, volume, or selection changes.
  useEffect(() => {
    let cancelled = false;
    const scene = sceneRef.current;
    scene?.clearToolOverlays();
    if (isPaintingActive && selectedObjectId && selectedVolumeId && scene) {
      getPaintOverlay({ objectId: selectedObjectId, volumeId: selectedVolumeId, layer: paintLayer }).then((result) => {
        if (!cancelled && result.buffer) scene.updateToolOverlay(selectedObjectId, parsePaintOverlayBinary(result.buffer, result.states), paintLayer, usePaintToolsStore.getState().filamentColors);
      }).catch(console.error);
    }
    return () => { cancelled = true; };
  }, [selectedObjectId, selectedVolumeId, paintLayer, isPaintingActive, meshRevision, paintOverlayRevision]);

  useEffect(() => {
    // Cancel synchronously at the store boundary, before delayed worker replies
    // or pointer-up can apply an old stroke to a new target.
    const unsubscribePaint = usePaintToolsStore.subscribe((next, previous) => {
      if (next.isActive !== previous.isActive || next.layer !== previous.layer ||
          next.selectedObjectId !== previous.selectedObjectId || next.selectedVolumeId !== previous.selectedVolumeId ||
          next.selectedInstanceId !== previous.selectedInstanceId) {
        strokeCollector.current?.cancelStroke();
        sceneRef.current?.cancelStroke();
      }
    });
    const unsubscribeHistory = useHistoryStore.subscribe((next, previous) => {
      if (next.isRestoring && !previous.isRestoring) {
        usePaintToolsStore.getState().stopPainting();
        void useTextStore.getState().close();
        useRepairStore.getState().reset();
        useEditOpsStore.getState().stopFlatten();
        useEditOpsStore.getState().stopBrimEars();
      }
    });
    strokeCollector.current?.setOptions({
      onError: (error) => usePaintToolsStore.setState({ error: error instanceof Error ? error.message : 'Painting failed.' }),
      onOverlayUpdate: (overlay) => {
        const paint = usePaintToolsStore.getState();
        if (paint.isActive && paint.selectedObjectId !== null) sceneRef.current?.updateToolOverlay(paint.selectedObjectId, overlay, paint.layer, paint.filamentColors);
      },
      onStrokeComplete: async (snapshot) => {
        if (snapshot.before !== snapshot.after) {
          useAppStore.getState().invalidateSlicePreview();
          await useHistoryStore.getState().commitTransaction(`${snapshot.layer} paint stroke`);
        }
      }
    });
    return () => { unsubscribePaint(); unsubscribeHistory(); };
  }, []);

  // Toggle painting mode
  const handleTogglePainting = useCallback(() => {
    if (isPaintingActive) {
      stopPainting();
    } else if (selectedObjectId) {
      useCutStore.getState().closeCut();
      useLayersStore.getState().stopEditing();
      void useTextStore.getState().close();
      useEditOpsStore.getState().stopFlatten();
      useEditOpsStore.getState().stopBrimEars();
      usePaintToolsStore.getState().setLayer('support');
      const volume = sceneRef.current?.getMeshVolumes(selectedObjectId)?.[0]?.volumeId;
      void usePaintToolsStore.getState().startPainting(selectedObjectId, volume, selectedInstanceId);
    }
  }, [isPaintingActive, selectedObjectId, selectedInstanceId, stopPainting]);

  // Keyboard shortcuts matching desktop OrcaSlicer
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const editOps = useEditOpsStore.getState();
        if (editOps.activeTool === 'flatten') {
          editOps.stopFlatten();
          return;
        }
        if (editOps.activeTool === 'brimears') {
          editOps.stopBrimEars();
          return;
        }
        if (isPaintingActive) {
          strokeCollector.current?.cancelStroke();
          stopPainting();
          return;
        }
        if (useCutStore.getState().isCutActive) {
          useCutStore.getState().closeCut();
          return;
        }
      }

      // Ignore if typing in an input / textarea / select or contenteditable
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable ||
          Boolean(target.closest?.('input, textarea, select, [contenteditable="true"]')))
      ) {
        return;
      }

      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z' || e.key === 'Z') {
          e.preventDefault();
          if (isCutting || isRepairing || isOperatingEdit) return;
          if (e.shiftKey) {
            redo();
          } else {
            undo();
          }
          return;
        }
        if (e.key === 'y' || e.key === 'Y') {
          e.preventDefault();
          if (isCutting || isRepairing || isOperatingEdit) return;
          redo();
          return;
        }
        if (e.key === 'a' || e.key === 'A') {
          e.preventDefault();
          if (objects.length > 0) {
            selectObject(objects[0].id, objects[0].instances[0]?.id);
          }
          return;
        }
      }

      switch (e.key) {
        case 'p':
        case 'P':
          if (selectedObjectId) {
            handleTogglePainting();
          }
          break;
        case 'c':
        case 'C':
          if (selectedObjectId && !isPaintingActive && !isTextActive && !isLayersActive && !isCutting && !isRepairing && !isOperatingEdit) {
            const cutStore = useCutStore.getState();
            if (cutStore.isCutActive) {
              cutStore.closeCut();
            } else {
              const selectedObj = objects.find((o) => o.id === selectedObjectId);
              const height = selectedObj?.size?.[2] ?? 20.0;
              cutStore.openCut(selectedObjectId, 0, height, height / 2);
            }
          }
          break;
        case 'm':
        case 'M':
          if (!isPaintingActive && !isOperatingEdit) setGizmoMode('translate');
          break;
        case 'r':
        case 'R':
          if (!isPaintingActive && !isOperatingEdit) setGizmoMode('rotate');
          break;
        case 's':
        case 'S':
          if (!isPaintingActive && !isOperatingEdit) setGizmoMode('scale');
          break;
        case 'a':
        case 'A':
          if (!isPaintingActive && !isCutting && !isTextActive && !isOperatingEdit) {
            if (e.shiftKey || !selectedObjectId) {
              arrange(true);
            } else {
              void useEditOpsStore.getState().autoOrient();
            }
          }
          break;
        case 'f':
        case 'F':
          if (!isPaintingActive && !isCutting && !isTextActive && !isOperatingEdit && selectedObjectId) {
            const editOps = useEditOpsStore.getState();
            if (editOps.activeTool === 'flatten') {
              editOps.stopFlatten();
            } else {
              stopPainting();
              useLayersStore.getState().stopEditing();
              useCutStore.getState().closeCut();
              void useTextStore.getState().close();
              void editOps.startFlatten(selectedObjectId);
            }
          }
          break;
        case 'Delete':
        case 'Backspace':
          if (!isPaintingActive && !isOperatingEdit) deleteSelected();
          break;
        case '0': case '1': case '2': case '3': case '4': case '5': case '6':
          setCameraView(Number(e.key) as CameraView);
          break;
        case 'z':
        case 'Z':
          setCameraView('Z');
          break;
      }
    },
    [objects, selectObject, setGizmoMode, arrange, deleteSelected, isPaintingActive, isTextActive, isLayersActive, isCutting, isRepairing, isOperatingEdit, activeEditTool, selectedObjectId, handleTogglePainting, stopPainting, undo, redo]
  );

  useEffect(() => registerCameraHandler((view) => sceneRef.current?.setCameraView(view)), []);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const file = e.dataTransfer.files?.[0];
    if (file) {
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (ext && ['stl', 'obj', '3mf', 'amf', 'step', 'stp'].includes(ext)) {
        await useAppStore.getState().requestImportFile(file);
      }
    }
  };

  const selectedObject = objects.find((o) => o.id === selectedObjectId);
  const selectedInstance = selectedObject?.instances.find((i) => i.id === selectedInstanceId);

  const downloadFileName = modelFile
    ? `${modelFile.name.substring(0, modelFile.name.lastIndexOf('.')) || modelFile.name}.gcode`
    : 'plate.gcode';

  const busy = isRestoring || isSlicing;
  const toolGroups: CanvasTool[][] = [
    [
      {
        id: 'tool-undo-btn', testId: 'tool-undo-btn', label: 'Undo', shortcut: 'Ctrl+Z', icon: <UndoIcon />,
        disabled: !canUndo || isRestoring || isSlicing || isCutting || isRepairing || isOperatingEdit, data: { 'can-undo': canUndo, 'is-restoring': isRestoring }, onClick: () => undo()
      },
      {
        id: 'tool-redo-btn', testId: 'tool-redo-btn', label: 'Redo', shortcut: 'Ctrl+Shift+Z', icon: <RedoIcon />,
        disabled: !canRedo || isRestoring || isSlicing || isCutting || isRepairing || isOperatingEdit, data: { 'can-redo': canRedo, 'is-restoring': isRestoring }, onClick: () => redo()
      }
    ],
    [
      ...([['translate', 'move', 'Move', 'M'], ['rotate', 'rotate', 'Rotate', 'R'], ['scale', 'scale', 'Scale', 'S']] as const).map(([mode, key, label, shortcut]): CanvasTool => ({
        id: `tool-${key}-btn`, label, shortcut, icon: `toolbar_${key}`, active: gizmoMode === mode && !isPaintingActive && !activeEditTool, disabled: busy || isOperatingEdit,
        onClick: () => {
          if (isPaintingActive) stopPainting();
          if (activeEditTool === 'flatten') useEditOpsStore.getState().stopFlatten();
          if (activeEditTool === 'brimears') useEditOpsStore.getState().stopBrimEars();
          setGizmoMode(mode);
        }
      })),
      {
        id: 'tool-orient-btn',
        testId: 'tool-orient-btn',
        label: 'Auto-orient',
        shortcut: 'A',
        icon: 'toolbar_orient',
        disabled: !selectedObject || busy || isOperatingEdit,
        onClick: () => {
          void useEditOpsStore.getState().autoOrient();
        }
      },
      {
        id: 'tool-flatten-btn',
        testId: 'tool-flatten-btn',
        label: 'Place on face',
        shortcut: 'F',
        icon: 'toolbar_flatten',
        active: activeEditTool === 'flatten',
        disabled: !selectedObject || busy || isOperatingEdit,
        onClick: () => {
          const editOps = useEditOpsStore.getState();
          if (editOps.activeTool === 'flatten') {
            editOps.stopFlatten();
          } else if (selectedObjectId) {
            stopPainting();
            useLayersStore.getState().stopEditing();
            useCutStore.getState().closeCut();
            void useTextStore.getState().close();
            void editOps.startFlatten(selectedObjectId);
          }
        }
      }
    ],
    [
      { id: 'tool-cut-btn', testId: 'tool-cut-btn', label: 'Cut', shortcut: 'C', icon: 'toolbar_cut', active: isCutActive, disabled: !selectedObject || busy || isCutting || isRepairing || isOperatingEdit,
        onClick: () => {
          const cutStore = useCutStore.getState();
          if (cutStore.isCutActive) {
            cutStore.closeCut();
          } else if (selectedObjectId) {
            stopPainting();
            useLayersStore.getState().stopEditing();
            void useTextStore.getState().close();
            if (activeEditTool) {
              useEditOpsStore.getState().stopFlatten();
              useEditOpsStore.getState().stopBrimEars();
            }
            const height = selectedObject?.size?.[2] ?? 20.0;
            cutStore.openCut(selectedObjectId, 0, height, height / 2);
          }
        } },
      { id: 'tool-meshboolean-btn', testId: 'tool-meshboolean-btn', label: 'Mesh boolean', icon: 'toolbar_meshboolean', active: activeEditDialog === 'boolean', disabled: objects.length < 2 || busy || isOperatingEdit,
        onClick: () => {
          stopPainting();
          useLayersStore.getState().stopEditing();
          useCutStore.getState().closeCut();
          void useTextStore.getState().close();
          if (activeEditTool) {
            useEditOpsStore.getState().stopFlatten();
            useEditOpsStore.getState().stopBrimEars();
          }
          useEditOpsStore.getState().openBooleanDialog();
        } },
      { id: 'tool-brimears-btn', testId: 'tool-brimears-btn', label: 'Brim ears', icon: 'toolbar_brimears', active: activeEditTool === 'brimears', disabled: !selectedObject || busy || isOperatingEdit,
        onClick: () => {
          const editOps = useEditOpsStore.getState();
          if (editOps.activeTool === 'brimears') {
            editOps.stopBrimEars();
          } else if (selectedObjectId) {
            stopPainting();
            useLayersStore.getState().stopEditing();
            useCutStore.getState().closeCut();
            void useTextStore.getState().close();
            void editOps.startBrimEars(selectedObjectId);
          }
        } },
      { id: 'tool-text-btn', testId: 'tool-text-btn', label: 'Text', icon: 'toolbar_text', active: isTextActive, disabled: busy || isOperatingEdit,
        onClick: () => {
          const textStore = useTextStore.getState();
          if (textStore.isOpen) {
            void textStore.close();
          } else {
            stopPainting();
            useLayersStore.getState().stopEditing();
            useCutStore.getState().closeCut();
            if (activeEditTool) {
              useEditOpsStore.getState().stopFlatten();
              useEditOpsStore.getState().stopBrimEars();
            }
            textStore.openForAdd(selectedObjectId);
          }
        } },
      { id: 'tool-svg-btn', testId: 'tool-svg-btn', label: 'Add SVG', icon: 'toolbar_svg', active: activeEditDialog === 'svg', disabled: busy || isOperatingEdit,
        onClick: () => {
          stopPainting();
          useLayersStore.getState().stopEditing();
          useCutStore.getState().closeCut();
          void useTextStore.getState().close();
          if (activeEditTool) {
            useEditOpsStore.getState().stopFlatten();
            useEditOpsStore.getState().stopBrimEars();
          }
          useEditOpsStore.getState().openSvgDialog();
        } },
      { id: 'tool-varlayer-btn', label: 'Variable layer height', icon: 'toolbar_variable_layer_height', active: isLayersActive, disabled: !selectedObject || busy || isOperatingEdit,
        onClick: () => {
          stopPainting();
          void useTextStore.getState().close();
          useCutStore.getState().closeCut();
          if (activeEditTool) {
            useEditOpsStore.getState().stopFlatten();
            useEditOpsStore.getState().stopBrimEars();
          }
          if (isLayersActive) useLayersStore.getState().stopEditing();
          else void useLayersStore.getState().startEditing(selectedObjectId!);
        } }
    ],
    [
      { id: 'tool-paint-btn', label: 'Support painting', shortcut: 'P', icon: 'toolbar_support', active: isPaintingActive && paintLayer === 'support', disabled: !selectedObject || busy || isOperatingEdit, onClick: handleTogglePainting },
      ...([['seam', 'toolbar_seam', 'Seam painting'], ['color', 'mmu_segmentation', 'Color painting'], ['fuzzy', 'toolbar_fuzzy_skin_paint', 'Fuzzy skin painting']] as const).map(([layer, icon, label]): CanvasTool => ({
        id: `tool-${layer}-paint-btn`, label, icon, active: isPaintingActive && paintLayer === layer, disabled: !selectedObject || busy || isOperatingEdit,
        onClick: () => {
          useCutStore.getState().closeCut();
          void useTextStore.getState().close();
          useLayersStore.getState().stopEditing();
          if (activeEditTool) {
            useEditOpsStore.getState().stopFlatten();
            useEditOpsStore.getState().stopBrimEars();
          }
          usePaintToolsStore.getState().setLayer(layer);
          const volume = sceneRef.current?.getMeshVolumes(selectedObjectId!)?.[0]?.volumeId;
          void usePaintToolsStore.getState().startPainting(selectedObjectId!, volume, selectedInstanceId);
        }
      }))
    ],
    [
      { id: 'tool-arrange-btn', label: 'Arrange', shortcut: 'A', icon: 'toolbar_arrange', disabled: busy || isOperatingEdit, onClick: () => arrange(true) },
      { id: 'tool-delete-btn', label: 'Delete', shortcut: 'Del', icon: 'delete', danger: true, disabled: !selectedObject || busy || isOperatingEdit, onClick: () => deleteSelected() }
    ]
  ];

  return (
    <div
      className={`plate-view ${isDragOver ? 'drag-over' : ''}`}
      style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}
      onDragOver={handleDragOver}
      onDragEnter={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* 3D WebGL Canvas Container */}
      <div
        id="plate-canvas-container"
        ref={containerRef}
        style={{ width: '100%', height: '100%', outline: 'none', cursor: isPaintingActive ? 'crosshair' : 'grab' }}
      />

      <CanvasToolbar groups={toolGroups} />
      <ViewButtons />

      <PaintToolsPanel />
      <LayerHeightPanel objectMeshes={sceneRef.current?.getObjectMeshes()} />
      <TextPanel />
      <CutPanel />
      <FlattenPanel />
      <BrimEarsPanel />

      {/* Selection Info Panel (shown when not in painting mode) */}
      {selectedObject && !isPaintingActive && (
        <div
          id="selection-panel"
          style={{
            position: 'absolute',
            bottom: 64,
            right: 24,
            background: 'rgba(24, 24, 27, 0.9)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: 10,
            padding: '12px 16px',
            color: '#e4e4e7',
            minWidth: 260,
            fontSize: '0.85rem',
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            zIndex: 25
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <strong id="selected-object-name" style={{ fontSize: '0.95rem', color: '#60a5fa' }}>
              {selectedObject.name}
            </strong>
            <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>ID: {selectedObject.id}</span>
          </div>
          <div id="selected-object-size" style={{ marginBottom: 4 }}>
            <span style={{ color: '#94a3b8' }}>Size: </span>
            <span>
              {selectedObject.size[0].toFixed(1)} × {selectedObject.size[1].toFixed(1)} ×{' '}
              {selectedObject.size[2].toFixed(1)} mm
            </span>
          </div>
          {selectedInstance && (
            <>
              <div id="selected-instance-pos" style={{ marginBottom: 4 }}>
                <span style={{ color: '#94a3b8' }}>Position: </span>
                <span>
                  X:{selectedInstance.offset[0].toFixed(1)} Y:{selectedInstance.offset[1].toFixed(1)} Z:
                  {selectedInstance.offset[2].toFixed(1)}
                </span>
              </div>
              <div id="selected-instance-scale" style={{ marginBottom: 4 }}>
                <span style={{ color: '#94a3b8' }}>Scale: </span>
                <span>
                  {(selectedInstance.scale[0] * 100).toFixed(0)}% ×{' '}
                  {(selectedInstance.scale[1] * 100).toFixed(0)}% ×{' '}
                  {(selectedInstance.scale[2] * 100).toFixed(0)}%
                </span>
              </div>
            </>
          )}

          {/* Mesh Health and Repair Badge */}
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(255, 255, 255, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>Mesh Health:</span>
            <RepairBadge />
          </div>
        </div>
      )}

      {/* Empty Plate Prompt if no objects loaded */}
      {objects.length === 0 && !isLoading && (
        <div
          id="empty-plate-prompt"
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            textAlign: 'center',
            color: '#94a3b8',
            pointerEvents: 'none',
            zIndex: 5
          }}
        >
          <div style={{ fontSize: '2.5rem', marginBottom: 8 }}>📦</div>
          <p style={{ margin: '0 0 4px', fontSize: '1rem', fontWeight: 500, color: '#e2e8f0' }}>
            Drag & drop 3D model here
          </p>
          <span style={{ fontSize: '0.8rem' }}>Supports .stl, .obj, .3mf, .amf</span>
        </div>
      )}

      {/* Loading overlay */}
      {isLoading && (
        <div
          style={{
            position: 'absolute',
            top: 24,
            right: 24,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(6px)',
            color: '#fff',
            padding: '8px 16px',
            borderRadius: 8,
            fontSize: '0.85rem',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            zIndex: 15
          }}
        >
          <div className="spinner" style={{ width: 14, height: 14 }} />
          <span>Processing model...</span>
        </div>
      )}

      {/* Slicing Progress Bar */}
      {(isSlicing || (slicePercent > 0 && slicePercent < 100)) && (
        <div className="progress-section" id="progress-container">
          <div className="progress-bar-wrapper">
            <div
              className="progress-bar-fill"
              id="progress-bar"
              style={{ width: `${slicePercent}%` }}
            />
          </div>
          <div className="status-text" id="status-text">
            {sliceStatusText}
          </div>
        </div>
      )}

      {/* Plate Selector Bar */}
      <PlateSelectorBar />

      {/* Slicing Results & Statistics */}
      {sliceResult && !isSlicing && (
        <div className="stats-section" id="stats-section">
          <div className="stats-header">
            <h3>Slicing Results</h3>
            <span className="stats-status" id="status-text">
              {sliceStatusText}
            </span>
          </div>
          <div className="stats-grid">
            <div className="stat-card">
              <span className="stat-label">Total Layers</span>
              <span className="stat-value" id="stat-layers">
                {sliceResult.layers}
              </span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Estimated Time</span>
              <span className="stat-value" id="stat-time">
                {formatPrintTime(sliceResult.printTimeS)}
              </span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Filament Length</span>
              <span className="stat-value" id="stat-filament-mm">
                {sliceResult.filamentMm ? `${sliceResult.filamentMm.toFixed(1)} mm` : '-'}
              </span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Filament Weight</span>
              <span className="stat-value" id="stat-filament-g">
                {sliceResult.filamentG ? `${sliceResult.filamentG.toFixed(2)} g` : '-'}
              </span>
            </div>
          </div>

          {gcodeUrl && (
            <div className="download-container">
              <a
                id="download-link"
                href={gcodeUrl}
                download={downloadFileName}
                className="btn btn-download"
              >
                ⬇️ Download G-code
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
