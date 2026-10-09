/**
 * @file LayerMeshColoring.ts
 * 3D object surface layer-height colorization for Three.js scene.
 */

import * as THREE from 'three';
import type { LayerHeightProfileData } from './types';

// Diverging RdYlGn palette matching libslic3r generate_layer_height_texture
const PALETTE: [number, number, number][] = [
  [0x1a / 255, 0x98 / 255, 0x50 / 255], // dark green (thinnest)
  [0x66 / 255, 0xbd / 255, 0x63 / 255],
  [0xa6 / 255, 0xd9 / 255, 0x6a / 255],
  [0xd9 / 255, 0xf1 / 255, 0xeb / 255],
  [0xfe / 255, 0xe6 / 255, 0xeb / 255],
  [0xfd / 255, 0xae / 255, 0x61 / 255],
  [0xf4 / 255, 0x6d / 255, 0x43 / 255],
  [0xd7 / 255, 0x30 / 255, 0x27 / 255]  // dark red (thickest)
];

function getColorForLayerHeight(
  height: number,
  minH: number,
  maxH: number
): [number, number, number] {
  const span = Math.max(1e-4, maxH - minH);
  const t = Math.max(0, Math.min(1, (height - minH) / span));
  const idxf = t * (PALETTE.length - 1);
  const idx1 = Math.min(Math.floor(idxf), PALETTE.length - 1);
  const idx2 = Math.min(idx1 + 1, PALETTE.length - 1);
  const frac = idxf - idx1;

  const c1 = PALETTE[idx1];
  const c2 = PALETTE[idx2];
  return [
    c1[0] + frac * (c2[0] - c1[0]),
    c1[1] + frac * (c2[1] - c1[1]),
    c1[2] + frac * (c2[2] - c1[2])
  ];
}

export class LayerMeshColoring {
  private overlayMeshes = new Map<string, THREE.Mesh>();

  public apply(
    targetObjectId: number,
    objectMeshes: Map<string, THREE.Mesh>,
    profileData: LayerHeightProfileData | null
  ): void {
    this.clearNonTarget(targetObjectId);

    if (!profileData || !profileData.layers || profileData.layers.length < 2) {
      this.clearAll();
      return;
    }

    const { layers, minLayerHeight, maxLayerHeight } = profileData;
    const layerPairs: { lo: number; hi: number; h: number }[] = [];
    for (let i = 0; i + 1 < layers.length; i += 2) {
      layerPairs.push({
        lo: layers[i],
        hi: layers[i + 1],
        h: layers[i + 1] - layers[i]
      });
    }

    for (const [key, mesh] of objectMeshes.entries()) {
      if (mesh.userData.objectId !== targetObjectId) continue;

      const baseGeo = mesh.geometry;
      if (!baseGeo || !baseGeo.attributes.position) continue;

      const posAttr = baseGeo.attributes.position;
      const count = posAttr.count;

      // Create or update overlay mesh
      let overlay = this.overlayMeshes.get(key);
      if (!overlay) {
        const overlayGeo = baseGeo.clone();
        const colors = new Float32Array(count * 3);

        const posArray = posAttr.array;
        for (let i = 0; i < count; ++i) {
          const z = posArray[i * 3 + 2]; // Z is UP
          // Find corresponding layer
          let foundH = profileData.layerHeight;
          for (let j = 0; j < layerPairs.length; ++j) {
            if (z >= layerPairs[j].lo - 1e-4 && z <= layerPairs[j].hi + 1e-4) {
              foundH = layerPairs[j].h;
              break;
            }
          }
          const [r, g, b] = getColorForLayerHeight(foundH, minLayerHeight, maxLayerHeight);
          colors[i * 3] = r;
          colors[i * 3 + 1] = g;
          colors[i * 3 + 2] = b;
        }

        overlayGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const mat = new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: 0.45,
          metalness: 0.1,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1
        });

        overlay = new THREE.Mesh(overlayGeo, mat);
        overlay.name = `layer_overlay_${key}`;
        mesh.add(overlay);
        this.overlayMeshes.set(key, overlay);
      } else {
        // Update color attribute on existing overlay
        const colors = overlay.geometry.attributes.color?.array as Float32Array;
        const posArray = posAttr.array;
        if (colors) {
          for (let i = 0; i < count; ++i) {
            const z = posArray[i * 3 + 2];
            let foundH = profileData.layerHeight;
            for (let j = 0; j < layerPairs.length; ++j) {
              if (z >= layerPairs[j].lo - 1e-4 && z <= layerPairs[j].hi + 1e-4) {
                foundH = layerPairs[j].h;
                break;
              }
            }
            const [r, g, b] = getColorForLayerHeight(foundH, minLayerHeight, maxLayerHeight);
            colors[i * 3] = r;
            colors[i * 3 + 1] = g;
            colors[i * 3 + 2] = b;
          }
          overlay.geometry.attributes.color.needsUpdate = true;
        }
      }
    }
  }

  public clearNonTarget(targetObjectId: number): void {
    for (const [key, overlay] of this.overlayMeshes.entries()) {
      if (overlay.parent && overlay.parent.userData.objectId !== targetObjectId) {
        overlay.parent.remove(overlay);
        overlay.geometry.dispose();
        if (Array.isArray(overlay.material)) {
          overlay.material.forEach((m) => m.dispose());
        } else {
          overlay.material.dispose();
        }
        this.overlayMeshes.delete(key);
      }
    }
  }

  public clearAll(): void {
    for (const [, overlay] of this.overlayMeshes.entries()) {
      if (overlay.parent) {
        overlay.parent.remove(overlay);
      }
      overlay.geometry.dispose();
      if (Array.isArray(overlay.material)) {
        overlay.material.forEach((m) => m.dispose());
      } else {
        overlay.material.dispose();
      }
    }
    this.overlayMeshes.clear();
  }
}
