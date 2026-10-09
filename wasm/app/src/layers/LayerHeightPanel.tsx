/**
 * @file LayerHeightPanel.tsx
 * Top-level component for variable layer height tool in the 3D plate view.
 * Accepts the Three.js scene/object meshes to apply dynamic layer colorization.
 */

import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useLayersStore } from './layersStore';
import { LayerHeightBar } from './LayerHeightBar';
import { LayerMeshColoring } from './LayerMeshColoring';

export interface LayerHeightPanelProps {
  scene?: THREE.Scene | null;
  objectMeshes?: Map<string, THREE.Mesh> | null;
}

export const LayerHeightPanel: React.FC<LayerHeightPanelProps> = ({ objectMeshes }) => {
  const isLayersActive = useLayersStore((s) => s.isLayersActive);
  const selectedObjectId = useLayersStore((s) => s.selectedObjectId);
  const profileData = useLayersStore((s) => s.profileData);

  const meshColoringRef = useRef<LayerMeshColoring | null>(null);

  if (!meshColoringRef.current) {
    meshColoringRef.current = new LayerMeshColoring();
  }

  // Synchronize 3D object surface colorization with layer height profile
  useEffect(() => {
    const coloring = meshColoringRef.current;
    if (!coloring) return;

    if (isLayersActive && selectedObjectId !== null && objectMeshes) {
      coloring.apply(selectedObjectId, objectMeshes, profileData);
    } else {
      coloring.clearAll();
    }

    return () => {
      coloring.clearAll();
    };
  }, [isLayersActive, selectedObjectId, profileData, objectMeshes]);

  if (!isLayersActive) {
    return null;
  }

  return <LayerHeightBar />;
};
