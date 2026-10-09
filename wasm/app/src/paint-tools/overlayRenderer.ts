/**
 * @file overlayRenderer.ts
 * Renders split-triangle paint overlays over model meshes in Three.js.
 * Triangles are grouped by state and colored per desktop specifications.
 */

import * as THREE from 'three';
import type { ParsedPaintOverlay, PaintLayer } from './types';

const OVERLAY_CONTAINER_NAME = '__paint_overlay_container__';

// Desktop colors
const COLOR_ENFORCER = 0x22c55e; // Green
const COLOR_BLOCKER = 0xef4444;  // Red
const COLOR_FUZZY = 0x22c55e;    // Green (desktop enforcers_color)

/**
 * Converts a hex string ('#RRGGBB' or 'RRGGBB') to a numeric 0xRRGGBB.
 */
export function hexToNumber(hex: string, fallback = 0x38bdf8): number {
  if (!hex) return fallback;
  const clean = hex.startsWith('#') ? hex.slice(1) : hex;
  const val = parseInt(clean, 16);
  return isNaN(val) ? fallback : val;
}

/**
 * Returns the THREE.Color or hex number for a painted state.
 */
export function getColorForState(
  state: string | number,
  layer: PaintLayer,
  filamentColors: string[] = []
): number {
  const stateStr = String(state).toLowerCase();

  if (layer === 'support' || layer === 'seam') {
    if (stateStr === 'enforcer' || stateStr === '1') return COLOR_ENFORCER;
    if (stateStr === 'blocker' || stateStr === '2') return COLOR_BLOCKER;
    return 0x94a3b8;
  }

  if (layer === 'fuzzy') {
    return COLOR_FUZZY;
  }

  if (layer === 'color') {
    const slot = parseInt(stateStr, 10);
    if (!isNaN(slot) && slot >= 1) {
      const colorIndex = (slot - 1) % (filamentColors.length || 1);
      return hexToNumber(filamentColors[colorIndex] || '#ffffff');
    }
  }

  return 0x38bdf8;
}

/**
 * Clears any existing paint overlay attached to parentMesh.
 */
export function clearPaintOverlay(parentMesh: THREE.Mesh): void {
  const existing = parentMesh.getObjectByName(OVERLAY_CONTAINER_NAME);
  if (existing) {
    parentMesh.remove(existing);
    existing.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry?.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material?.dispose();
        }
      }
    });
  }
}

/**
 * Renders split-triangle overlays onto parentMesh as child meshes with polygon offset.
 */
export function renderPaintOverlay(
  parentMesh: THREE.Mesh,
  overlay: ParsedPaintOverlay | null,
  layer: PaintLayer,
  filamentColors: string[] = []
): THREE.Group | null {
  clearPaintOverlay(parentMesh);

  if (!overlay || overlay.triangleCount === 0 || overlay.states.length === 0) {
    return null;
  }

  const container = new THREE.Group();
  container.name = OVERLAY_CONTAINER_NAME;

  const { positions, indices, states } = overlay;

  for (const st of states) {
    const stateStr = String(st.state).toLowerCase();
    if (stateStr === 'none' || stateStr === '0' || st.triangleCount <= 0) {
      continue;
    }

    const startIdx = st.firstTriangle * 3;
    const endIdx = startIdx + st.triangleCount * 3;
    if (startIdx >= indices.length) continue;

    const subIndices = indices.slice(startIdx, Math.min(endIdx, indices.length));
    if (subIndices.length === 0) continue;

    const subGeo = new THREE.BufferGeometry();
    subGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    subGeo.setIndex(new THREE.BufferAttribute(subIndices, 1));
    subGeo.computeVertexNormals();

    const color = getColorForState(st.state, layer, filamentColors);

    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.35,
      metalness: 0.1,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1.0,
      polygonOffsetUnits: -1.0
    });

    const subMesh = new THREE.Mesh(subGeo, mat);
    subMesh.raycast = () => {}; // Never intercept raycasting!
    container.add(subMesh);
  }

  parentMesh.add(container);
  return container;
}
