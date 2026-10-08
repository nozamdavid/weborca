import React, { useEffect, useRef, useState, useCallback } from 'react';
import { usePlateStore } from './plateStore';
import { PlateScene } from './PlateScene';
import { useAppStore } from '../store/appStore';
import { PlateSelectorBar } from '../plates/PlateSelectorBar';
import { usePaintingStore, SupportPaintingPanel } from '../painting';
import { getEngine } from '../engine/orcaEngine';

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
  const importFile = usePlateStore((s) => s.importFile);
  const initBedConfig = usePlateStore((s) => s.initBedConfig);

  // Support Painting Store
  const isPaintingActive = usePaintingStore((s) => s.isPaintingActive);
  const paintingData = usePaintingStore((s) => s.paintingData);
  const selectedVolumeId = usePaintingStore((s) => s.selectedVolumeId);
  const paintingError = usePaintingStore((s) => s.error);
  const startPainting = usePaintingStore((s) => s.startPainting);
  const stopPainting = usePaintingStore((s) => s.stopPainting);
  const loadPaintingForObject = usePaintingStore((s) => s.loadPaintingForObject);

  // App Store (for Slicing progress & printer selection)
  const isSlicing = useAppStore((s) => s.isSlicing);
  const slicePercent = useAppStore((s) => s.slicePercent);
  const sliceStatusText = useAppStore((s) => s.sliceStatusText);
  const sliceResult = useAppStore((s) => s.sliceResult);
  const gcodeUrl = useAppStore((s) => s.gcodeUrl);
  const modelFile = useAppStore((s) => s.modelFile);

  const currentConfig = useAppStore((s) => s.currentConfig);

  const [isDragOver, setIsDragOver] = useState(false);

  // Initialize bed config from printer config when available
  useEffect(() => {
    if (currentConfig?.printable_area || currentConfig?.printable_height) {
      initBedConfig(currentConfig.printable_area, currentConfig.printable_height);
    }
  }, [currentConfig?.printable_area, currentConfig?.printable_height, initBedConfig]);

  // Mount 3D Scene
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
      onPaintBegin: () => {
        usePaintingStore.getState().beginStroke();
      },
      onPaintFacet: (facetId) => {
        usePaintingStore.getState().paintFacet(facetId);
      },
      onPaintEnd: () => {
        usePaintingStore.getState().endStroke();
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
      usePaintingStore.getState().cancelStroke();
      usePaintingStore.getState().stopPainting();
    };
  }, []);

  // Update bed in scene when config changes
  useEffect(() => {
    if (sceneRef.current) {
      sceneRef.current.updateBedConfig(bedConfig);
    }
  }, [bedConfig]);

  // Update scene objects when objects change
  useEffect(() => {
    if (sceneRef.current) {
      const paintState = usePaintingStore.getState();
      if (paintState.isPaintingActive && paintState.selectedObjectId !== null) {
        if (!objects.some((o) => o.id === paintState.selectedObjectId)) {
          paintState.cancelStroke();
          paintState.stopPainting();
        }
      }
      sceneRef.current.setObjects(objects);
    }
  }, [objects]);

  // Update selection in scene
  useEffect(() => {
    if (sceneRef.current) {
      sceneRef.current.setSelection(selectedObjectId, selectedInstanceId);
    const paintState = usePaintingStore.getState();
    if (paintState.isPaintingActive) {
      if (!selectedObjectId || selectedObjectId !== paintState.selectedObjectId) {
        paintState.cancelStroke();
        if (selectedObjectId) {
          paintState.startPainting(selectedObjectId);
        } else {
          paintState.stopPainting();
        }
      }
    }
    }
  }, [selectedObjectId, selectedInstanceId]);


  // Stop painting if slicing starts
  useEffect(() => {
    if (isSlicing && usePaintingStore.getState().isPaintingActive) {
      usePaintingStore.getState().cancelStroke();
      usePaintingStore.getState().stopPainting();
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
      sceneRef.current.setPaintingActive(isPaintingActive && !paintingError, selectedVolumeId);
    }
  }, [isPaintingActive, paintingError, selectedVolumeId]);

  // Sync painting overlay to scene
  useEffect(() => {
    if (sceneRef.current) {
      const paintStoreObjId = usePaintingStore.getState().selectedObjectId;
      if (selectedObjectId && paintStoreObjId === selectedObjectId) {
        sceneRef.current.updatePaintingOverlay(selectedObjectId, paintingData, selectedVolumeId);
      } else if (selectedObjectId) {
        sceneRef.current.updatePaintingOverlay(selectedObjectId, null, selectedVolumeId);
      }
    }
  }, [selectedObjectId, paintingData, selectedVolumeId]);

  // Check and display existing annotations on loaded objects (e.g. 3MF load)
  useEffect(() => {
    if (selectedObjectId) {
      loadPaintingForObject(selectedObjectId).then((data) => {
        if (data && sceneRef.current) {
          sceneRef.current.updatePaintingOverlay(selectedObjectId, data, data.volumeId);
        }
      });
    }
  }, [selectedObjectId, loadPaintingForObject]);

  // Toggle painting mode
  const handleTogglePainting = useCallback(() => {
    if (isPaintingActive) {
      stopPainting();
    } else if (selectedObjectId) {
      startPainting(selectedObjectId);
    }
  }, [isPaintingActive, selectedObjectId, startPainting, stopPainting]);

  // Keyboard shortcuts matching desktop OrcaSlicer
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Ignore if typing in an input / textarea
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        if (objects.length > 0) {
          selectObject(objects[0].id, objects[0].instances[0]?.id);
        }
        return;
      }

      if (e.key === 'Escape' && isPaintingActive) {
        usePaintingStore.getState().cancelStroke();
        stopPainting();
        return;
      }

      switch (e.key) {
        case 'p':
        case 'P':
          if (selectedObjectId) {
            handleTogglePainting();
          }
          break;
        case 'm':
        case 'M':
          if (!isPaintingActive) setGizmoMode('translate');
          break;
        case 'r':
        case 'R':
          if (!isPaintingActive) setGizmoMode('rotate');
          break;
        case 's':
        case 'S':
          if (!isPaintingActive) setGizmoMode('scale');
          break;
        case 'a':
        case 'A':
          if (!isPaintingActive) arrange(true);
          break;
        case 'Delete':
        case 'Backspace':
          if (!isPaintingActive) deleteSelected();
          break;
      }
    },
    [objects, selectObject, setGizmoMode, arrange, deleteSelected, isPaintingActive, selectedObjectId, handleTogglePainting, stopPainting]
  );

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
      if (ext && ['stl', 'obj', '3mf', 'amf'].includes(ext)) {
        await importFile(file);
      }
    }
  };

  const selectedObject = objects.find((o) => o.id === selectedObjectId);
  const selectedInstance = selectedObject?.instances.find((i) => i.id === selectedInstanceId);

  const downloadFileName = modelFile
    ? `${modelFile.name.substring(0, modelFile.name.lastIndexOf('.')) || modelFile.name}.gcode`
    : 'plate.gcode';

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

      {/* Floating Plate Toolbar */}
      <div
        id="plate-toolbar"
        style={{
          position: 'absolute',
          top: 16,
          left: 16,
          display: 'flex',
          gap: 6,
          background: 'rgba(30, 30, 36, 0.85)',
          backdropFilter: 'blur(8px)',
          padding: '6px 8px',
          borderRadius: 8,
          border: '1px solid rgba(255, 255, 255, 0.1)',
          zIndex: 10
        }}
      >
        <button
          id="tool-move-btn"
          className={`btn-tool ${gizmoMode === 'translate' && !isPaintingActive ? 'active' : ''}`}
          onClick={() => {
            if (isPaintingActive) stopPainting();
            setGizmoMode('translate');
          }}
          title="Move tool (M)"
          style={{
            background: gizmoMode === 'translate' && !isPaintingActive ? '#2563eb' : 'transparent',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            padding: '6px 10px',
            fontSize: '0.85rem',
            cursor: 'pointer',
            fontWeight: 500
          }}
        >
          ✋ Move [M]
        </button>
        <button
          id="tool-rotate-btn"
          className={`btn-tool ${gizmoMode === 'rotate' && !isPaintingActive ? 'active' : ''}`}
          onClick={() => {
            if (isPaintingActive) stopPainting();
            setGizmoMode('rotate');
          }}
          title="Rotate tool (R)"
          style={{
            background: gizmoMode === 'rotate' && !isPaintingActive ? '#2563eb' : 'transparent',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            padding: '6px 10px',
            fontSize: '0.85rem',
            cursor: 'pointer',
            fontWeight: 500
          }}
        >
          🔄 Rotate [R]
        </button>
        <button
          id="tool-scale-btn"
          className={`btn-tool ${gizmoMode === 'scale' && !isPaintingActive ? 'active' : ''}`}
          onClick={() => {
            if (isPaintingActive) stopPainting();
            setGizmoMode('scale');
          }}
          title="Scale tool (S)"
          style={{
            background: gizmoMode === 'scale' && !isPaintingActive ? '#2563eb' : 'transparent',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            padding: '6px 10px',
            fontSize: '0.85rem',
            cursor: 'pointer',
            fontWeight: 500
          }}
        >
          📐 Scale [S]
        </button>
        <div style={{ width: 1, background: 'rgba(255,255,255,0.15)', margin: '2px 4px' }} />
        {/* Support Face Painting tool button */}
        <button
          id="tool-paint-btn"
          className={`btn-tool ${isPaintingActive ? 'active' : ''}`}
          onClick={handleTogglePainting}
          disabled={!selectedObject}
          title="Support Face Painting (P)"
          style={{
            background: isPaintingActive ? '#009688' : 'transparent',
            color: selectedObject ? '#fff' : '#64748b',
            border: 'none',
            borderRadius: 6,
            padding: '6px 10px',
            fontSize: '0.85rem',
            cursor: selectedObject ? 'pointer' : 'default',
            fontWeight: isPaintingActive ? 600 : 500
          }}
        >
          🖌️ Face Paint [P]
        </button>
        <div style={{ width: 1, background: 'rgba(255,255,255,0.15)', margin: '2px 4px' }} />
        <button
          id="tool-arrange-btn"
          onClick={() => arrange(true)}
          title="Arrange objects on bed (A)"
          style={{
            background: 'transparent',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            padding: '6px 10px',
            fontSize: '0.85rem',
            cursor: 'pointer'
          }}
        >
          🧩 Arrange [A]
        </button>
        <button
          id="tool-delete-btn"
          onClick={() => deleteSelected()}
          disabled={!selectedObject}
          title="Delete selected object (Delete)"
          style={{
            background: 'transparent',
            color: selectedObject ? '#ef4444' : '#64748b',
            border: 'none',
            borderRadius: 6,
            padding: '6px 10px',
            fontSize: '0.85rem',
            cursor: selectedObject ? 'pointer' : 'default'
          }}
        >
          🗑️ Delete
        </button>
      </div>

      {/* Support Face Painting Panel Overlay */}
      <SupportPaintingPanel />

      {/* Selection Info Panel (shown when not in painting mode) */}
      {selectedObject && !isPaintingActive && (
        <div
          id="selection-panel"
          style={{
            position: 'absolute',
            bottom: 24,
            left: 24,
            background: 'rgba(24, 24, 27, 0.9)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: 10,
            padding: '12px 16px',
            color: '#e4e4e7',
            minWidth: 260,
            fontSize: '0.85rem',
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            zIndex: 10
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
