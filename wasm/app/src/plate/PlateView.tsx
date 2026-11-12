import React, { useEffect, useRef, useState, useCallback } from 'react';
import { usePlateStore } from './plateStore';
import { PlateScene } from './PlateScene';
import { useAppStore } from '../store/appStore';
import { useObjectListStore } from '../objectlist/objectListStore';
import { PlateContextMenu } from './PlateContextMenu';
import { ContextMenu } from '../objectlist/ContextMenu';
import { exportGcode } from '../shell/exportGcode';
import { Dialog } from '../components/Dialog';
import { PlateRenameDialog } from './PlateRenameDialog';
import { isDefaultPlateName } from '../plates/plateName';
import { usePlatesStore } from '../plates/platesStore';
import { addBoxSelection } from './boxSelection';
import { PlateSelectorBar } from '../plates/PlateSelectorBar';
import { usePaintToolsStore, PaintToolsPanel, StrokeCollector } from '../paint-tools';
import { useLayersStore, LayerHeightPanel } from '../layers';
import { getPaintOverlay, parsePaintOverlayBinary } from '../paint-tools/paintToolsApi';
import type { PaintState, ParsedPaintOverlay } from '../paint-tools/types';
import { getEngine } from '../engine/orcaEngine';
import { useHistoryStore } from '../history';
import { TextPanel, useTextStore } from '../text';
import { CutPanel, useCutStore } from '../cut';
import { NumericTransform, GroupScale } from './NumericTransform';
import { ArrangeDialog } from './ArrangeDialog';
import { MeasurePanel } from '../measure';
import { ExplodePanel } from './ExplodePanel';
import { ViewCube } from './ViewCube';
import { usePrefsStore } from '../prefs/prefsStore';
import { resolveBedAssets } from './bedAssets';
import { RepairBadge, useRepairStore } from '../repair';
import { useEditOpsStore, FlattenPanel, BrimEarsPanel } from '../editops';
import { CanvasToolbar, ViewButtons } from '../shell/CanvasToolbar';
import type { CanvasTool } from '../shell/CanvasToolbar';
import { registerCameraHandler, registerCameraOrbitHandler, setCameraView } from '../shell/cameraBridge';
import type { CameraView } from '../shell/cameraBridge';
import { RedoIcon, UndoIcon } from '../shell/glyphs';
import { useTranslation } from "../i18n";
import { ChevronDown, ChevronRight } from '../objectlist/Icons';
import './selectionPanel.css';

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
    const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<PlateScene | null>(null);
  const assigningFilament = useRef(false);
  const [selectionCollapsed, setSelectionCollapsed] = useState(false);

  const showNavigator = usePrefsStore((s) => s.display.showNavigator);
  const getCameraQuaternion = useCallback(() => sceneRef.current?.getCameraQuaternion(), []);

  // Plate Store
  const objects = usePlateStore((s) => s.objects);
  const selectedObjectId = usePlateStore((s) => s.selectedObjectId);
  const selectedInstanceId = usePlateStore((s) => s.selectedInstanceId);
  const selectedPartId = useObjectListStore((s) => s.selectedVolumeId);
  const gizmoMode = usePlateStore((s) => s.gizmoMode);
  const bedConfig = usePlateStore((s) => s.bedConfig);
  const isLoading = usePlateStore((s) => s.isLoading);

  const refreshObjects = usePlateStore((s) => s.refreshObjects);
  const selectObject = usePlateStore((s) => s.selectObject);
  const extraSelection = usePlateStore((s) => s.extraSelection);
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
  const isModelLoading = useAppStore((s) => s.isModelLoading);
  const isEngineReady = useAppStore((s) => s.isEngineReady);
  const slicePercent = useAppStore((s) => s.slicePercent);
  const sliceStatusText = useAppStore((s) => s.sliceStatusText);
  const sliceResult = useAppStore((s) => s.sliceResult);
  const gcodeUrl = useAppStore((s) => s.gcodeUrl);
  const modelFile = useAppStore((s) => s.modelFile);

  const currentConfig = useAppStore((s) => s.currentConfig);
  const bedConfigLoading = useAppStore((s) => !s.isEngineReady || s.isSelectingPreset || s.isModelLoading);
  const activePlateIndex = usePlatesStore((s) => s.activePlateIndex);

  const [isDragOver, setIsDragOver] = useState(false);
  const [renamingPlate, setRenamingPlate] = useState<{ index: number; x: number; y: number; value: string } | null>(null);
  const [plateMenu, setPlateMenu] = useState<{ x: number; y: number; plateIndex: number } | null>(null);
  const [objectMenu, setObjectMenu] = useState<{
    x: number;
    y: number;
    objectId: number;
    volumeId?: number;
    isObject: boolean;
    isMulti?: boolean;
  } | null>(null);
  const [renamingItem, setRenamingItem] = useState<{
    objectId: number;
    volumeId?: number;
    name: string;
  } | null>(null);

  // Sync Bed Dimensions when active printer config changes
  useEffect(() => {
    if (currentConfig) {
      initBedConfig(currentConfig.printable_area, currentConfig.printable_height);
    }
  }, [currentConfig.printable_area, currentConfig.printable_height, initBedConfig]);

  // Initialize Three.js Scene
  useEffect(() => {
    if (!containerRef.current) return;

    const scene = new PlateScene(containerRef.current, bedConfig, {
      onBoxSelect: (refs) => {
        const plates = usePlatesStore.getState();
        const members = plates.plates.find(p => p.index === plates.activePlateIndex)?.instances ?? [];
        const initial = usePlateStore.getState();
        const current = initial.selectedObjectId !== null && initial.selectedInstanceId !== null
          ? [{ objectId: initial.selectedObjectId, instanceId: initial.selectedInstanceId }, ...initial.extraSelection] : [];
        for (const ref of addBoxSelection(current, refs)) {
          if (!members.some(m => m.objectId === ref.objectId && m.instanceId === ref.instanceId)) continue;
          const state = usePlateStore.getState();
          if (state.selectedObjectId === ref.objectId && state.selectedInstanceId === ref.instanceId ||
              state.extraSelection.some(r => r.objectId === ref.objectId && r.instanceId === ref.instanceId)) continue;
          state.toggleSelect(ref.objectId, ref.instanceId);
        }
        useObjectListStore.getState().selectItem(usePlateStore.getState().selectedObjectId, null);
      },
      canMoveObjects: () => {
        const app = useAppStore.getState();
        return app.isEngineReady && !app.isSlicing && !app.isModelLoading && !app.isSelectingPreset && !useHistoryStore.getState().isRestoring;
      },
      onSelect: (objId, instId, additive, volumeId) => {
        if (additive && objId !== null && instId !== null) {
          usePlateStore.getState().toggleSelect(objId, instId);
        } else {
          selectObject(objId, instId);
          const currentSelectedObj = usePlateStore.getState().selectedObjectId;
          const obj = useObjectListStore.getState().objects.find((o) => o.id === objId);
          if (currentSelectedObj === objId && obj && obj.volumes.length > 1 && volumeId !== undefined) {
            useObjectListStore.getState().selectItem(objId, volumeId);
          } else {
            useObjectListStore.getState().selectItem(objId, null);
          }
        }
      },
      onTransformMany: (entries) => {
        void usePlateStore.getState().setInstanceTransforms(entries);
      },
      onTransformChange: (objId, instId, trafo) => {
        setInstanceTransform(objId, instId, trafo);
      },
      getViewerMesh: (objId) => usePlateStore.getState().getViewerMesh(objId),
      onVolumeTransformChange: (objId, volumeId, trafo) => {
        void usePlateStore.getState().setVolumeTransform(objId, volumeId, trafo);
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
      onMeasureChange: (points) => usePlateStore.getState().setMeasurePoints(points),
      onBrimEarClick: (position, clickedEarIndex) => {
        const store = useEditOpsStore.getState();
        if (typeof clickedEarIndex === 'number') {
          void store.removeBrimEar(clickedEarIndex);
        } else {
          void store.addBrimEar(position);
        }
      }
    });

    if (!useAppStore.getState().isEngineReady) scene.setBedLoading(false);
    sceneRef.current = scene;
    if (typeof window !== 'undefined') {
      (window as any).__plateScene = scene;
    }

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

  // Mount the JS viewer immediately. Query native geometry only after startup
  // has selected the printer; an early empty query
  // must not replace existing/recovered objects or clear their mesh cache.
  useEffect(() => {
    if (isEngineReady) void refreshObjects();
  }, [isEngineReady, refreshObjects]);

  // Update bed in scene when config changes
  useEffect(() => {
    if (sceneRef.current) {
      sceneRef.current.updateBedConfig(bedConfig);
    }
  }, [bedConfig]);

  const vendor = useAppStore((s) => s.selectedVendor);
  const printer = useAppStore((s) => s.selectedPrinter);
  const userPrinters = useAppStore((s) => s.userPresets);
  // While native startup is pending, show the JS bed/grid already built by
  // PlateScene. Once ready, replace it with the selected printer's artwork.
  // Invalidate older asynchronous artwork loads before the next paint.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || bedConfigLoading || !printer) return;
    let cancelled = false;
    scene.setBedLoading(true);
    const systemPrinter = userPrinters.find((p) => p.kind === 'printer' && p.name === printer)?.inherits || printer;
    void resolveBedAssets(vendor, systemPrinter, { model: currentConfig.bed_custom_model || undefined, texture: currentConfig.bed_custom_texture || undefined })
      .then((assets) => { if (!cancelled) return scene.setBedAssets(assets); })
      .catch((error) => {
        console.warn('[Bed assets]', error);
        if (!cancelled) scene.setBedLoading(false);
      });
    return () => { cancelled = true; scene.setBedLoading(true); };
  }, [bedConfigLoading, vendor, printer, userPrinters, bedConfig, currentConfig.bed_custom_model, currentConfig.bed_custom_texture]);

  const objectTree = useObjectListStore((s) => s.objects);
  const selectedRangeIndex = useObjectListStore((s) => s.selectedRangeIndex);
  useEffect(() => {
    if (!isEngineReady) return;
    let cancelled = false;
    void getEngine().then((engine) => engine.call('getWipeTowerPreview', { plateIndex: activePlateIndex }))
      .then((tower: any) => {
        const origin = usePlatesStore.getState().plates.find((p) => p.index === activePlateIndex)?.origin ?? [0, 0, 0];
        if (!cancelled) sceneRef.current?.setWipeTowerPreview(tower, origin as [number, number, number]);
      }).catch(() => { if (!cancelled) sceneRef.current?.setWipeTowerPreview({ enabled: false }); });
    return () => { cancelled = true; };
  }, [isEngineReady, currentConfig, activePlateIndex, objects, objectTree, paintOverlayRevision]);

  // Each part takes the colour of the filament it is assigned to (extruder 0 means the first filament).
  const filamentColours = useAppStore((s) => s.currentConfig['filament_colour']);
  useEffect(() => {
    const palette = (filamentColours || '').split(';').map((c) => c.trim().slice(0, 7));
    const colors = new Map<number, Map<number, string>>();
    for (const obj of objectTree) {
      const parts = new Map<number, string>();
      for (const vol of obj.volumes) {
        const colour = palette[Math.max(1, vol.extruder) - 1];
        if (colour) parts.set(vol.id, colour);
      }
      colors.set(obj.id, parts);
    }
    sceneRef.current?.setVolumeColors(colors);
  }, [objectTree, filamentColours, objects]);

  const measureActive = usePlateStore((s) => s.measureActive);
  useEffect(() => { sceneRef.current?.setMeasureActive(measureActive); }, [measureActive]);

  const explodeActive = usePlateStore((s) => s.explodeActive);
  const explodeFactor = usePlateStore((s) => s.explodeFactor);
  useEffect(() => { sceneRef.current?.setExplodeActive(explodeActive); }, [explodeActive]);
  useEffect(() => { sceneRef.current?.setExplodeFactor(explodeFactor); }, [explodeFactor]);

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
      const scene = sceneRef.current;
      let cancelled = false;
      void scene.setObjects(objects).then((accepted) => {
        if (accepted && !cancelled && sceneRef.current === scene) setMeshRevision((revision) => revision + 1);
      }).catch((error) => console.error("[PlateView] Scene update failed:", error));
      return () => { cancelled = true; };
    }
  }, [objects]);

  // Update selection in scene and stores
  useEffect(() => {
    if (sceneRef.current) {
      sceneRef.current.setSelection(selectedObjectId, selectedInstanceId, extraSelection, selectedPartId);
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
  }, [selectedObjectId, selectedInstanceId, extraSelection, selectedPartId]);

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

  // Refresh attachment when movement becomes available again after a busy operation.
  useEffect(() => {
    if (sceneRef.current) {
      sceneRef.current.setGizmoMode(gizmoMode);
    }
  }, [gizmoMode, bedConfigLoading, isSlicing, isRestoring]);

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
    } else if (!isPaintingActive && isEngineReady && scene) {
      // Tool annotations are temporary; filament regions also belong in Prepare.
      // Overlay coordinates are already in merged object space. Combine volumes
      // before updating the scene, whose overlay update replaces the previous one.
      const colors = (filamentColours || '').split(';').map(c => c.trim().slice(0, 7));
      for (const object of objectTree) {
        void Promise.all(object.volumes.map(async volume => {
          const result = await getPaintOverlay({ objectId: object.id, volumeId: volume.id, layer: 'color' });
          return result.buffer ? parsePaintOverlayBinary(result.buffer, result.states) : null;
        })).then(results => {
          if (cancelled) return;
          const overlays = results.filter((overlay): overlay is ParsedPaintOverlay => overlay !== null);
          const vertexCount = overlays.reduce((sum, overlay) => sum + overlay.vertexCount, 0);
          const triangleCount = overlays.reduce((sum, overlay) => sum + overlay.triangleCount, 0);
          if (!triangleCount) return;
          const merged: ParsedPaintOverlay = {
            vertexCount, triangleCount, positions: new Float32Array(vertexCount * 3),
            indices: new Uint32Array(triangleCount * 3), states: [],
          };
          let vertexOffset = 0, triangleOffset = 0;
          for (const overlay of overlays) {
            merged.positions.set(overlay.positions, vertexOffset * 3);
            merged.indices.set(overlay.indices.map(index => index + vertexOffset), triangleOffset * 3);
            merged.states.push(...overlay.states.map(state => ({ ...state, firstTriangle: state.firstTriangle + triangleOffset })));
            vertexOffset += overlay.vertexCount;
            triangleOffset += overlay.triangleCount;
          }
          scene.updateToolOverlay(object.id, merged, 'color', colors);
        }).catch(console.error);
      }
    }
    return () => { cancelled = true; };
  }, [selectedObjectId, selectedVolumeId, paintLayer, isPaintingActive, meshRevision, paintOverlayRevision, isEngineReady, objectTree, filamentColours]);

  useEffect(() => {
    const targetObj = objectTree.find((o) => o.id === selectedObjectId);
    sceneRef.current?.updateLayerRangeOverlays(selectedObjectId, targetObj?.layerRanges, selectedRangeIndex);
  }, [selectedObjectId, objectTree, selectedRangeIndex]);

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
      const app = useAppStore.getState();
      if (!app.isEngineReady || app.isSlicing || app.isModelLoading || useHistoryStore.getState().isRestoring) return;
      if (e.key === 'Escape') {
        if (usePlateStore.getState().explodeActive) {
          usePlateStore.getState().setExplodeActive(false);
          return;
        }
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
        const target = e.target as HTMLElement | null;
        if (!target?.closest?.('input, textarea, select, [contenteditable="true"], [role="dialog"]') && !isTextActive && !isLayersActive && !isCutting && !isRepairing && !isOperatingEdit) {
          selectObject(null, null);
          setGizmoMode(null);
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

      // With a selection, number keys target filament IDs instead of camera views.
      // Keypad digits also report a numeric key when Num Lock is enabled.
      if (/^[1-9]$/.test(e.key)) {
        if (containerRef.current?.closest('[hidden]')) return;
        const plate = usePlateStore.getState();
        if (plate.selectedObjectId !== null) {
          if (e.defaultPrevented || e.isComposing || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
          const editOps = useEditOpsStore.getState();
          const tree = useObjectListStore.getState();
          if (app.isSelectingPreset || plate.isLoading || tree.isLoading ||
              usePaintToolsStore.getState().isActive || useTextStore.getState().isOpen ||
              useLayersStore.getState().isLayersActive || useCutStore.getState().isCutActive || useCutStore.getState().isCutting || useCutStore.getState().isCutting ||
              useRepairStore.getState().isRepairing || editOps.isOperating || editOps.activeTool || editOps.activeDialog ||
              plate.measureActive || plate.explodeActive ||
              document.querySelector('[role="dialog"], [role="alertdialog"], .modal-backdrop')) return;
          e.preventDefault();
          const extruder = Number(e.key);
          if (e.repeat || assigningFilament.current || extruder > app.selectedFilaments.length) return;
          const objectIds = new Set([plate.selectedObjectId, ...plate.extraSelection.map(s => s.objectId)]);
          const volumeId = plate.extraSelection.length === 0 && tree.selectedObjectId === plate.selectedObjectId
            ? tree.selectedVolumeId : null;
          assigningFilament.current = true;
          void (async () => {
            for (const objectId of objectIds) {
              const object = tree.objects.find(o => o.id === objectId);
              const volumes = volumeId === null ? object?.volumes : object?.volumes.filter(v => v.id === volumeId);
              if (!volumes?.length || volumes.every(v => v.extruder === extruder)) continue;
              if (volumeId !== null) await tree.setVolumeExtruder(objectId, volumeId, extruder);
              else await tree.setObjectExtruder(objectId, extruder);
            }
          })().catch(console.error).finally(() => { assigningFilament.current = false; });
          return;
        }
      }

      if (e.ctrlKey || e.metaKey) {
        if (['c', 'x', 'v'].includes(e.key.toLowerCase())) {
          const plate = usePlateStore.getState();
          const editOps = useEditOpsStore.getState();
          if (e.defaultPrevented || e.isComposing || e.altKey || containerRef.current?.closest('[hidden]') ||
              app.isSelectingPreset || plate.isLoading || useObjectListStore.getState().isLoading ||
              usePaintToolsStore.getState().isActive || useTextStore.getState().isOpen ||
              useLayersStore.getState().isLayersActive || useCutStore.getState().isCutActive || useCutStore.getState().isCutting ||
              useRepairStore.getState().isRepairing || editOps.isOperating || editOps.activeTool || editOps.activeDialog ||
              document.querySelector('[role="dialog"], [role="alertdialog"], .modal-backdrop')) return;
        }
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
          usePlateStore.getState().selectAll();
          return;
        }
        if ((e.key === 'x' || e.key === 'X') && !e.shiftKey && !isPaintingActive && !isOperatingEdit) {
          e.preventDefault();
          void usePlateStore.getState().cutSelected();
          return;
        }
        if ((e.key === 'c' || e.key === 'C') && !e.shiftKey && !isPaintingActive && !isOperatingEdit) {
          if (document.getSelection()?.toString()) return;
          e.preventDefault();
          void usePlateStore.getState().copySelected();
          return;
        }
        if ((e.key === 'v' || e.key === 'V') && !isPaintingActive && !isOperatingEdit) {
          e.preventDefault();
          void usePlateStore.getState().pasteClipboard();
          return;
        }
        if ((e.key === 'k' || e.key === 'K') && !isPaintingActive && !isOperatingEdit) {
          e.preventDefault();
          void usePlateStore.getState().duplicateSelected();
          return;
        }
        if ((e.key === 'd' || e.key === 'D') && !isPaintingActive && !isOperatingEdit) {
          e.preventDefault();
          void usePlateStore.getState().deleteAll();
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
        case 'u':
        case 'U':
          if (!isPaintingActive && !isCutting && !isTextActive && !isOperatingEdit) usePlateStore.getState().setMeasureActive(!usePlateStore.getState().measureActive);
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
  useEffect(() => registerCameraOrbitHandler((dx, dy) => sceneRef.current?.orbitCamera(dx, dy)), []);

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

    const app = useAppStore.getState();
    if (!app.isEngineReady || app.isSlicing || app.isModelLoading || useHistoryStore.getState().isRestoring) return;
    const file = e.dataTransfer.files?.[0];
    if (file) {
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (ext && ['stl', 'obj', '3mf', 'amf', 'step', 'stp', 'svg', 'zip'].includes(ext)) {
        await useAppStore.getState().requestImportFile(file);
      }
    }
  };

  const selectedObject = objects.find((o) => o.id === selectedObjectId);
  const selectedInstance = selectedObject?.instances.find((i) => i.id === selectedInstanceId);

  const downloadFileName = modelFile
    ? `${modelFile.name.substring(0, modelFile.name.lastIndexOf('.')) || modelFile.name}.gcode`
    : 'plate.gcode';

  const busy = isRestoring || isSlicing || isModelLoading || !isEngineReady;
  const toolGroups: CanvasTool[][] = [
    [
      {
        id: 'tool-undo-btn', testId: 'tool-undo-btn', label: t("Undo"), shortcut: 'Ctrl+Z', icon: <UndoIcon />,
        disabled: !canUndo || busy || isCutting || isRepairing || isOperatingEdit, data: { 'can-undo': canUndo, 'is-restoring': isRestoring }, onClick: () => undo()
      },
      {
        id: 'tool-redo-btn', testId: 'tool-redo-btn', label: t("Redo"), shortcut: 'Ctrl+Shift+Z', icon: <RedoIcon />,
        disabled: !canRedo || busy || isCutting || isRepairing || isOperatingEdit, data: { 'can-redo': canRedo, 'is-restoring': isRestoring }, onClick: () => redo()
      }
    ],
    [
      ...([['translate', 'move', 'Move', 'M'], ['rotate', 'rotate', 'Rotate', 'R'], ['scale', 'scale', 'Scale', 'S']] as const).map(([mode, key, label, shortcut]): CanvasTool => ({
        id: `tool-${key}-btn`, label, shortcut, icon: `toolbar_${key}`, active: gizmoMode === mode && !isPaintingActive && !activeEditTool, disabled: busy || isOperatingEdit,
        onClick: () => {
          if (isPaintingActive) stopPainting();
          if (activeEditTool === 'flatten') useEditOpsStore.getState().stopFlatten();
          if (activeEditTool === 'brimears') useEditOpsStore.getState().stopBrimEars();
          setGizmoMode(usePlateStore.getState().gizmoMode === mode ? null : mode);
        }
      })),
      {
        id: 'tool-orient-btn',
        testId: 'tool-orient-btn',
        label: t("Auto-orient"),
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
        label: t("Place on face"),
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
      },
      {
        id: 'tool-measure-btn',
        testId: 'tool-measure-btn',
        label: t("Measure"),
        shortcut: 'U',
        icon: 'toolbar_measure',
        active: measureActive,
        disabled: busy || isOperatingEdit,
        onClick: () => {
          if (!measureActive) {
            stopPainting();
            useEditOpsStore.getState().stopFlatten();
            useEditOpsStore.getState().stopBrimEars();
          }
          usePlateStore.getState().setMeasureActive(!measureActive);
        }
      },
      {
        id: 'tool-explode-btn',
        testId: 'tool-explode-btn',
        label: t("Explode view"),
        icon: (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="4" y1="12" x2="9" y2="12" />
            <line x1="20" y1="12" x2="15" y2="12" />
            <line x1="12" y1="4" x2="12" y2="9" />
            <line x1="12" y1="20" x2="12" y2="15" />
            <circle cx="12" cy="12" r="2" />
          </svg>
        ),
        active: explodeActive,
        disabled: busy || isOperatingEdit,
        onClick: () => {
          if (!explodeActive) {
            stopPainting();
            useEditOpsStore.getState().stopFlatten();
            useEditOpsStore.getState().stopBrimEars();
          }
          usePlateStore.getState().setExplodeActive(!explodeActive);
        }
      }
    ],
    [
      { id: 'tool-cut-btn', testId: 'tool-cut-btn', label: t("Cut"), shortcut: 'C', icon: 'toolbar_cut', active: isCutActive, disabled: !selectedObject || busy || isCutting || isRepairing || isOperatingEdit,
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
      { id: 'tool-meshboolean-btn', testId: 'tool-meshboolean-btn', label: t("Mesh boolean"), icon: 'toolbar_meshboolean', active: activeEditDialog === 'boolean', disabled: objects.length < 2 || busy || isOperatingEdit,
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
      { id: 'tool-brimears-btn', testId: 'tool-brimears-btn', label: t("Brim ears"), icon: 'toolbar_brimears', active: activeEditTool === 'brimears', disabled: !selectedObject || busy || isOperatingEdit,
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
      { id: 'tool-text-btn', testId: 'tool-text-btn', label: t("Text"), icon: 'toolbar_text', active: isTextActive, disabled: busy || isOperatingEdit,
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
      { id: 'tool-svg-btn', testId: 'tool-svg-btn', label: t("Add SVG"), icon: 'toolbar_svg', active: activeEditDialog === 'svg', disabled: busy || isOperatingEdit,
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
      { id: 'tool-varlayer-btn', label: t("Variable layer height"), icon: 'toolbar_variable_layer_height', active: isLayersActive, disabled: !selectedObject || busy || isOperatingEdit,
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
      { id: 'tool-paint-btn', label: t("Support painting"), shortcut: 'P', icon: 'toolbar_support', active: isPaintingActive && paintLayer === 'support', disabled: !selectedObject || busy || isOperatingEdit, onClick: handleTogglePainting },
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
      { id: 'tool-arrange-btn', label: t("Arrange"), shortcut: 'A', icon: 'toolbar_arrange', disabled: busy || isOperatingEdit, onClick: () => arrange(true) },
      { id: 'tool-delete-btn', label: t("Delete"), shortcut: 'Del', icon: 'delete', danger: true, disabled: !selectedObject || busy || isOperatingEdit, onClick: () => deleteSelected() }
    ]
  ];

  // Every plate is drawn beside the others, with its number and title.
  const plates = usePlatesStore((s) => s.plates);
  useEffect(() => {
    sceneRef.current?.setPlates(plates.map((p) => ({ index: p.index, name: p.name, origin: p.origin })), activePlateIndex);
  }, [plates, activePlateIndex, meshRevision]);
  const previousPlate = useRef(activePlateIndex);
  const pickedInView = useRef(false); // clicking a plate in the view must not also move the camera
  useEffect(() => {
    if (previousPlate.current !== activePlateIndex && !pickedInView.current) sceneRef.current?.focusPlate(activePlateIndex);
    pickedInView.current = false;
    previousPlate.current = activePlateIndex;
  }, [activePlateIndex]);

  // A right-click on the empty plate opens its menu. Dragging with the right button pans, so the menu opens on release
  // when the pointer barely moved (browsers fire `contextmenu` on press on Linux and macOS, on release on Windows).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let down: { x: number; y: number; button: number } | null = null;
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'touch' || e.target !== sceneRef.current?.renderer.domElement) return;
      down = { x: e.clientX, y: e.clientY, button: e.button };
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      if (e.button === 0 && down?.button === 0 && Math.hypot(e.clientX - down.x, e.clientY - down.y) <= 4 && container.contains(e.target as Node)) {
        // A click on a plate's title renames it; on the plate itself (off the objects) it makes that plate active.
        const scene = sceneRef.current;
        const title = scene?.titleAt(e.clientX, e.clientY);
        if (title) {
          const current = usePlatesStore.getState().plates.find((p) => p.index === title.index)?.name ?? '';
          setRenamingPlate({ ...title, value: isDefaultPlateName(current, title.index) ? '' : current });
          return;
        }
        const picked = scene && !usePaintToolsStore.getState().isActive && !scene.isObjectAt(e.clientX, e.clientY) ? scene.plateAt(e.clientX, e.clientY) : null;
        if (picked !== null && picked !== usePlatesStore.getState().activePlateIndex) {
          pickedInView.current = true;
          usePlatesStore.getState().setActivePlate(picked);
        }
      }
      if (e.button !== 2 || !down || down.button !== 2) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved > 4 || usePaintToolsStore.getState().isActive || !container.contains(e.target as Node)) return;
      openMenu(e.clientX, e.clientY);
    };
    const openMenu = (clientX: number, clientY: number) => {
      const e = { clientX, clientY };
      const hit = sceneRef.current?.hitTest(e.clientX, e.clientY);
      if (!hit) {
        setObjectMenu(null);
        const plateIndex = sceneRef.current?.plateAt(e.clientX, e.clientY)
          ?? usePlatesStore.getState().activePlateIndex;
        setPlateMenu({ x: e.clientX, y: e.clientY, plateIndex });
        return;
      }

      setPlateMenu(null);
      const plate = usePlateStore.getState();
      const objStore = useObjectListStore.getState();
      const objects = objStore.objects;
      const hitObj = objects.find((o) => o.id === hit.objectId);
      const volumes = hitObj?.volumes ?? [];

      const isMulti = plate.extraSelection.length > 0;
      const isHitInSelection =
        (plate.selectedObjectId === hit.objectId && plate.selectedInstanceId === hit.instanceId) ||
        plate.extraSelection.some((s) => s.objectId === hit.objectId && s.instanceId === hit.instanceId);

      if (isMulti && isHitInSelection) {
        setObjectMenu({
          x: e.clientX,
          y: e.clientY,
          objectId: hit.objectId,
          volumeId: undefined,
          isObject: true,
          isMulti: true
        });
        return;
      }

      const hitVol = hit.volumeId !== undefined ? volumes.find((v) => v.id === hit.volumeId) : undefined;
      const hasMultipleVolumes = volumes.length > 1;

      let isObjectTarget = true;
      let targetVolumeId: number | undefined = undefined;

      if (objStore.selectedObjectId === hit.objectId && objStore.selectedVolumeId !== null && objStore.selectedVolumeId === hit.volumeId) {
        // A specific volume of this object is currently selected -> target that volume
        isObjectTarget = false;
        targetVolumeId = objStore.selectedVolumeId;
      } else if (!hasMultipleVolumes) {
        isObjectTarget = true;
      } else if (hitVol && hitVol.type !== 'part') {
        isObjectTarget = false;
        targetVolumeId = hitVol.id;
      } else if (hitVol && volumes.indexOf(hitVol) > 0) {
        isObjectTarget = false;
        targetVolumeId = hitVol.id;
      } else {
        isObjectTarget = true;
      }

      if (isObjectTarget) {
        plate.selectObject(hit.objectId, hit.instanceId);
        objStore.selectItem(hit.objectId, null);
      } else {
        plate.selectObject(hit.objectId, hit.instanceId);
        objStore.selectItem(hit.objectId, targetVolumeId);
      }

      setObjectMenu({
        x: e.clientX,
        y: e.clientY,
        objectId: hit.objectId,
        volumeId: targetVolumeId,
        isObject: isObjectTarget,
        isMulti: false
      });
    };
    const onLongpress = (event: Event) => {
      const { x, y } = (event as CustomEvent<{ x: number; y: number }>).detail;
      openMenu(x, y);
    };
    const onTouchTap = (event: Event) => {
      const { x, y } = (event as CustomEvent<{ x: number; y: number }>).detail;
      const scene = sceneRef.current;
      const title = scene?.titleAt(x, y);
      if (title) {
        const current = usePlatesStore.getState().plates.find(p => p.index === title.index)?.name ?? '';
        setRenamingPlate({ ...title, value: isDefaultPlateName(current, title.index) ? '' : current });
        return;
      }
      const plate = scene && !scene.isObjectAt(x, y) ? scene.plateAt(x, y) : null;
      if (plate !== null && plate !== usePlatesStore.getState().activePlateIndex) {
        pickedInView.current = true;
        usePlatesStore.getState().setActivePlate(plate);
      }
    };
    const onMenu = (e: MouseEvent) => e.preventDefault();
    container.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    container.addEventListener('contextmenu', onMenu);
    container.addEventListener('canvas-longpress', onLongpress);
    container.addEventListener('canvas-touch-tap', onTouchTap);
    return () => {
      container.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      container.removeEventListener('contextmenu', onMenu);
      container.removeEventListener('canvas-longpress', onLongpress);
      container.removeEventListener('canvas-touch-tap', onTouchTap);
    };
  }, []);

  return (
    <div
      className={`plate-view ${isDragOver ? 'drag-over' : ''}`}
      style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}
      onDragOver={handleDragOver}
      onDragEnter={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <ArrangeDialog />
      <MeasurePanel />
      <ExplodePanel />
      {showNavigator && <ViewCube getCameraQuaternion={getCameraQuaternion} />}

      {/* 3D WebGL Canvas Container */}
      <div
        id="plate-canvas-container"
        ref={containerRef}
        tabIndex={-1}
        onPointerDownCapture={(e) => {
          // Model dragging prevents the canvas's default focus change. Leave text editing when entering the viewer.
          if (e.target instanceof HTMLCanvasElement) e.currentTarget.focus({ preventScroll: true });
        }}
        style={{ width: '100%', height: '100%', outline: 'none', cursor: isPaintingActive ? 'crosshair' : 'grab' }}
      />

      <CanvasToolbar groups={toolGroups} />
      {objects.length === 0 && !busy && <div className="desktop-prepare-empty">
        <button className="ds-btn ds-btn--primary" onClick={() => document.getElementById('model-file')?.click()}>{t('Add model')}</button>
        <p>{t('Or drop a model onto the plate')}</p>
      </div>}
      <ViewButtons />

      <PaintToolsPanel />
      <LayerHeightPanel objectMeshes={sceneRef.current?.getObjectMeshes()} />
      <TextPanel />
      <CutPanel />
      <FlattenPanel />
      <BrimEarsPanel />

      {/* Selection Info Panel (shown when not in painting mode) */}
      {selectedObject && !isPaintingActive && !isCutActive && !isTextActive && !measureActive && !explodeActive && !isLayersActive && !activeEditTool && (
        <div
          id="selection-panel"
          className="selection-panel"
        >
          <div className="selection-panel-header">
            <strong id="selected-object-name" title={selectedObject.name}>
              {selectedObject.name}
            </strong>
            <span id="selection-count">{extraSelection.length > 0 ? `+${extraSelection.length} more selected` : `ID: ${selectedObject.id}`}</span>
            <button
              id="selection-panel-toggle"
              className="selection-panel-toggle"
              type="button"
              title={selectionCollapsed ? t("Expand") : t("Collapse")}
              aria-label={selectionCollapsed ? t("Expand") : t("Collapse")}
              aria-expanded={!selectionCollapsed}
              aria-controls="selection-panel-body"
              onClick={() => setSelectionCollapsed((collapsed) => !collapsed)}
            >
              <span aria-hidden="true">{selectionCollapsed ? <ChevronRight /> : <ChevronDown />}</span>
            </button>
          </div>
          <div id="selection-panel-body" className="selection-panel-body" hidden={selectionCollapsed}>
            <div id="selected-object-size">
              <span className="selection-panel-label">{t("Size:")}</span>
              <span>
                {selectedObject.size[0].toFixed(1)} × {selectedObject.size[1].toFixed(1)} ×{' '}
                {selectedObject.size[2].toFixed(1)} {t("mm")}</span>
            </div>
            {selectedInstance && extraSelection.length === 0 && (
              <>
                <NumericTransform object={selectedObject} instance={selectedInstance} />
              </>
            )}
            {selectedInstance && extraSelection.length > 0 && gizmoMode === 'scale' &&
              <GroupScale disabled={busy || isLoading || isCutting || isRepairing || isOperatingEdit || isPaintingActive || isTextActive || isLayersActive} />}

            {/* Mesh Health and Repair Badge */}
            <div className="selection-panel-health">
              <span className="selection-panel-label">{t("Mesh Health:")}</span>
              <RepairBadge />
            </div>
          </div>
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
          <span>{t("Processing model...")}</span>
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
      {renamingPlate && (
        <PlateRenameDialog
          index={renamingPlate.index}
          initial={renamingPlate.value}
          onClose={() => setRenamingPlate(null)}
          onSubmit={(title) => {
            const { index } = renamingPlate;
            setRenamingPlate(null);
            void usePlatesStore.getState().setPlateConfig(index, {}, title);
          }}
        />
      )}
      {plateMenu && <PlateContextMenu x={plateMenu.x} y={plateMenu.y} plateIndex={plateMenu.plateIndex}
        busy={busy || bedConfigLoading || isLoading || isOperatingEdit || isCutting || isRepairing}
        onClose={() => setPlateMenu(null)} />}
      {objectMenu && (
        <ContextMenu
          x={objectMenu.x}
          y={objectMenu.y}
          isObject={objectMenu.isObject}
          objectId={objectMenu.objectId}
          volumeId={objectMenu.volumeId}
          isMulti={objectMenu.isMulti}
          onClose={() => setObjectMenu(null)}
          onRename={() => {
            const obj = useObjectListStore.getState().objects.find((o) => o.id === objectMenu.objectId);
            const vol = objectMenu.volumeId !== undefined ? obj?.volumes?.find((v) => v.id === objectMenu.volumeId) : undefined;
            const currentName = objectMenu.isObject ? (obj?.name ?? '') : (vol?.name ?? '');
            setRenamingItem({
              objectId: objectMenu.objectId,
              volumeId: objectMenu.volumeId,
              name: currentName
            });
            setObjectMenu(null);
          }}
        />
      )}
      {renamingItem && (
        <Dialog
          id="item-rename-dialog"
          role="dialog"
          aria-label={t("Rename")}
          onClose={() => setRenamingItem(null)}
          dirty={false}
          dirtyWhat="name"
        >
          <div className="ds-dialog ds-dialog--sm">
            <h2 className="ds-title--dialog">{renamingItem.volumeId !== undefined ? t("Rename part") : t("Rename object")}</h2>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {t("Name")}<input
                id="item-rename-input"
                data-testid="item-rename-input"
                autoFocus
                defaultValue={renamingItem.name}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') {
                    const val = (e.target as HTMLInputElement).value.trim();
                    if (val) {
                      if (renamingItem.volumeId !== undefined) {
                        void useObjectListStore.getState().renameVolume(renamingItem.objectId, renamingItem.volumeId, val);
                      } else {
                        void useObjectListStore.getState().renameObject(renamingItem.objectId, val);
                      }
                    }
                    setRenamingItem(null);
                  }
                  if (e.key === 'Escape') setRenamingItem(null);
                }}
                style={{ padding: '8px 10px', fontSize: '0.875rem', background: 'var(--canvas-bg)', color: 'var(--text-color)', border: '1px solid var(--border-color)', borderRadius: 6, outline: 'none' }}
              />
            </label>
            <div className="ds-dialog__foot">
              <button className="ds-btn" id="item-rename-cancel" onClick={() => setRenamingItem(null)}>{t("Cancel")}</button>
              <button className="ds-btn ds-btn--primary" id="item-rename-ok" onClick={(e) => {
                const input = (e.currentTarget.parentElement?.previousElementSibling?.querySelector('input') as HTMLInputElement);
                const val = input?.value.trim();
                if (val) {
                  if (renamingItem.volumeId !== undefined) {
                    void useObjectListStore.getState().renameVolume(renamingItem.objectId, renamingItem.volumeId, val);
                  } else {
                    void useObjectListStore.getState().renameObject(renamingItem.objectId, val);
                  }
                }
                setRenamingItem(null);
              }}>{t("OK")}</button>
            </div>
          </div>
        </Dialog>
      )}

      {/* Slicing Results & Statistics */}
      {sliceResult && !isSlicing && (
        <div className="stats-section" id="stats-section">
          <div className="stats-header">
            <h3>{t("Slicing Results")}</h3>
            <span className="stats-status" id="status-text">
              {sliceStatusText}
            </span>
          </div>
          <div className="stats-grid">
            <div className="stat-card">
              <span className="stat-label">{t("Total Layers")}</span>
              <span className="stat-value" id="stat-layers">
                {sliceResult.layers}
              </span>
            </div>
            <div className="stat-card">
              <span className="stat-label">{t("Estimated Time")}</span>
              <span className="stat-value" id="stat-time">
                {formatPrintTime(sliceResult.printTimeS)}
              </span>
            </div>
            <div className="stat-card">
              <span className="stat-label">{t("Filament Length")}</span>
              <span className="stat-value" id="stat-filament-mm">
                {sliceResult.filamentMm ? `${sliceResult.filamentMm.toFixed(1)} mm` : '-'}
              </span>
            </div>
            <div className="stat-card">
              <span className="stat-label">{t("Filament Weight")}</span>
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
                onClick={(event) => { event.preventDefault(); void exportGcode(); }}
                download={downloadFileName}
                className="btn btn-download"
              >
                {t("⬇️ Download G-code")}</a>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
