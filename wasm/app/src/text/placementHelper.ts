/**
 * @file placementHelper.ts
 * Placement helper for the 3D click-to-place text flow on the print plate.
 */

import { useTextStore } from './textStore';
import type { PlaceTextAtHitOptions } from './types';

/**
 * Places or anchors text at a 3D raycast hit point on a model surface or the build bed.
 * Converts positions and normals into engine world coordinates and opens the text panel.
 *
 * @param options Click hit coordinates, normal vector, and optional target object ID.
 */
export function placeTextAtHit(options: PlaceTextAtHitOptions): {
  position: [number, number, number];
  normal: [number, number, number];
} {
  const rawHit = options.hit;
  const position: [number, number, number] = Array.isArray(rawHit)
    ? [rawHit[0], rawHit[1], rawHit[2]]
    : [rawHit.x, rawHit.y, rawHit.z];

  let normal: [number, number, number] = [0, 0, 1];
  if (options.normal) {
    const rawNormal = options.normal;
    normal = Array.isArray(rawNormal)
      ? [rawNormal[0], rawNormal[1], rawNormal[2]]
      : [rawNormal.x, rawNormal.y, rawNormal.z];
  }

  const store = useTextStore.getState();
  store.setPlacement(position, normal);

  if (options.objectId !== undefined && options.objectId !== null) {
    store.setTargetObject(options.objectId);
  }

  // Open the panel for adding or updating text
  store.setIsOpen(true);

  // If already editing an existing text volume, trigger a live debounced update
  if (store.targetVolumeId !== null && store.targetObjectId !== null) {
    store.debouncedUpdateText();
  }

  return { position, normal };
}
