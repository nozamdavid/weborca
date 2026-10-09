/**
 * @file paintCursor.ts
 * Visual brush cursor for 3D painting (circle, sphere, pointer).
 * Operates in Three.js world space on top of the model surface.
 */

import * as THREE from 'three';
import type { PaintTool } from './types';

export interface PaintCursor {
  group: THREE.Group;
  circleMesh: THREE.Mesh;
  diskMesh: THREE.Mesh;
  sphereMesh: THREE.Mesh;
  pointerMesh: THREE.Mesh;
  update: (
    hitPoint: THREE.Vector3,
    normal: THREE.Vector3,
    radius: number,
    tool: PaintTool,
    color?: number
  ) => void;
  setVisible: (visible: boolean) => void;
  dispose: () => void;
}

const DEFAULT_CURSOR_COLOR = 0x38bdf8; // Sky blue

export function createPaintCursor(scene: THREE.Scene): PaintCursor {
  const group = new THREE.Group();
  group.name = '__paint_brush_cursor__';
  group.visible = false;

  // 1. Circle Ring (Unit radius = 1.0)
  const ringGeo = new THREE.RingGeometry(0.92, 1.0, 48);
  const ringMat = new THREE.MeshBasicMaterial({
    color: DEFAULT_CURSOR_COLOR,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.9,
    depthTest: false
  });
  const circleMesh = new THREE.Mesh(ringGeo, ringMat);
  circleMesh.renderOrder = 999;
  circleMesh.raycast = () => {};

  // 2. Disk fill inside circle
  const diskGeo = new THREE.CircleGeometry(0.92, 48);
  const diskMat = new THREE.MeshBasicMaterial({
    color: DEFAULT_CURSOR_COLOR,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.25,
    depthTest: false
  });
  const diskMesh = new THREE.Mesh(diskGeo, diskMat);
  diskMesh.renderOrder = 998;
  diskMesh.raycast = () => {};

  // Group for circle plane
  const circleGroup = new THREE.Group();
  circleGroup.add(circleMesh);
  circleGroup.add(diskMesh);
  group.add(circleGroup);

  // 3. Sphere (Unit radius = 1.0)
  const sphereGeo = new THREE.SphereGeometry(1.0, 24, 16);
  const sphereMat = new THREE.MeshBasicMaterial({
    color: DEFAULT_CURSOR_COLOR,
    transparent: true,
    opacity: 0.35,
    wireframe: true,
    depthTest: false
  });
  const sphereMesh = new THREE.Mesh(sphereGeo, sphereMat);
  sphereMesh.renderOrder = 999;
  sphereMesh.raycast = () => {};
  group.add(sphereMesh);

  // 4. Pointer crosshair / fill target
  const pointerGeo = new THREE.RingGeometry(0.2, 0.4, 24);
  const pointerMat = new THREE.MeshBasicMaterial({
    color: 0xfacc15, // Yellow target
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.9,
    depthTest: false
  });
  const pointerMesh = new THREE.Mesh(pointerGeo, pointerMat);
  pointerMesh.renderOrder = 999;
  pointerMesh.raycast = () => {};
  group.add(pointerMesh);

  scene.add(group);

  const zUp = new THREE.Vector3(0, 0, 1);

  const update = (
    hitPoint: THREE.Vector3,
    normal: THREE.Vector3,
    radius: number,
    tool: PaintTool,
    color = DEFAULT_CURSOR_COLOR
  ) => {
    group.visible = true;
    (ringMat as THREE.MeshBasicMaterial).color.setHex(color);
    (diskMat as THREE.MeshBasicMaterial).color.setHex(color);
    (sphereMat as THREE.MeshBasicMaterial).color.setHex(color);

    if (tool === 'circle') {
      circleGroup.visible = true;
      sphereMesh.visible = false;
      pointerMesh.visible = false;

      // Position circle slightly off surface along surface normal to prevent z-fighting
      circleGroup.position.copy(hitPoint).addScaledVector(normal, 0.08);

      // Align circle perpendicular to surface normal
      if (Math.abs(normal.dot(zUp)) > 0.999) {
        circleGroup.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 0, 1),
          normal.z > 0 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 0, -1)
        );
      } else {
        circleGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
      }
      circleGroup.scale.set(radius, radius, radius);
    } else if (tool === 'sphere') {
      circleGroup.visible = false;
      sphereMesh.visible = true;
      pointerMesh.visible = false;

      sphereMesh.position.copy(hitPoint);
      sphereMesh.scale.set(radius, radius, radius);
    } else {
      // Smart fill, bucket, triangle: show pointer target
      circleGroup.visible = false;
      sphereMesh.visible = false;
      pointerMesh.visible = true;

      pointerMesh.position.copy(hitPoint).addScaledVector(normal, 0.08);
      pointerMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
      pointerMesh.scale.set(1, 1, 1);
    }
  };

  const setVisible = (visible: boolean) => {
    group.visible = visible;
  };

  const dispose = () => {
    scene.remove(group);
    ringGeo.dispose();
    ringMat.dispose();
    diskGeo.dispose();
    diskMat.dispose();
    sphereGeo.dispose();
    sphereMat.dispose();
    pointerGeo.dispose();
    pointerMat.dispose();
  };

  return {
    group,
    circleMesh,
    diskMesh,
    sphereMesh,
    pointerMesh,
    update,
    setVisible,
    dispose
  };
}
