/**
 * @file exportStl.ts
 * Builds and downloads a single binary STL containing all objects arranged on the plate.
 */

import * as THREE from 'three';
import { usePlateStore } from '../plate/plateStore';
import { useAppStore } from '../store/appStore';
import type { MeshBufferData, PlateInstance } from '../plate/types';
import { showToast } from './toastStore';

export async function exportPlateAsStl(): Promise<void> {
  const { modelFile } = useAppStore.getState();
  const { objects, getMesh } = usePlateStore.getState();

  if (!objects || objects.length === 0) {
    showToast('No objects on plate to export', 'error');
    return;
  }

  try {
    interface MeshWithInstances {
      mesh: MeshBufferData;
      instances: PlateInstance[];
    }
    const meshList: MeshWithInstances[] = [];
    let totalTriangles = 0;

    for (const obj of objects) {
      if (!obj.instances || obj.instances.length === 0) continue;
      const mesh = await getMesh(obj.id);
      if (mesh && mesh.triangleCount > 0) {
        meshList.push({ mesh, instances: obj.instances });
        totalTriangles += mesh.triangleCount * obj.instances.length;
      }
    }

    if (totalTriangles === 0) {
      showToast('No geometry found on plate to export', 'error');
      return;
    }

    // Binary STL size: 84 header/count bytes + 50 bytes per triangle
    const buffer = new ArrayBuffer(84 + 50 * totalTriangles);
    const view = new DataView(buffer);

    // 80-byte header
    const headerStr = 'OrcaSlicer Web arranged plate STL export';
    for (let i = 0; i < headerStr.length && i < 80; i++) {
      view.setUint8(i, headerStr.charCodeAt(i));
    }

    // 4-byte triangle count (uint32 little-endian)
    view.setUint32(80, totalTriangles, true);

    let triIndex = 0;
    for (const { mesh, instances } of meshList) {
      for (const inst of instances) {
        const matrix = new THREE.Matrix4();
        const pos = new THREE.Vector3(inst.offset[0], inst.offset[1], inst.offset[2]);
        const rot = new THREE.Euler(inst.rotation[0], inst.rotation[1], inst.rotation[2], 'XYZ');
        const sc = new THREE.Vector3(inst.scale[0], inst.scale[1], inst.scale[2]);
        const quat = new THREE.Quaternion().setFromEuler(rot);
        matrix.compose(pos, quat, sc);

        for (let t = 0; t < mesh.triangleCount; t++) {
          const i0 = mesh.indices[t * 3];
          const i1 = mesh.indices[t * 3 + 1];
          const i2 = mesh.indices[t * 3 + 2];

          const v0 = new THREE.Vector3(
            mesh.positions[i0 * 3],
            mesh.positions[i0 * 3 + 1],
            mesh.positions[i0 * 3 + 2]
          ).applyMatrix4(matrix);

          const v1 = new THREE.Vector3(
            mesh.positions[i1 * 3],
            mesh.positions[i1 * 3 + 1],
            mesh.positions[i1 * 3 + 2]
          ).applyMatrix4(matrix);

          const v2 = new THREE.Vector3(
            mesh.positions[i2 * 3],
            mesh.positions[i2 * 3 + 1],
            mesh.positions[i2 * 3 + 2]
          ).applyMatrix4(matrix);

          // Compute face normal: (v1 - v0) x (v2 - v0)
          const e1 = new THREE.Vector3().subVectors(v1, v0);
          const e2 = new THREE.Vector3().subVectors(v2, v0);
          const normal = new THREE.Vector3().crossVectors(e1, e2).normalize();
          if (!Number.isFinite(normal.x) || !Number.isFinite(normal.y) || !Number.isFinite(normal.z)) {
            normal.set(0, 0, 0);
          }

          const off = 84 + triIndex * 50;
          // Normal (3 x float32)
          view.setFloat32(off, normal.x, true);
          view.setFloat32(off + 4, normal.y, true);
          view.setFloat32(off + 8, normal.z, true);

          // V0 (3 x float32)
          view.setFloat32(off + 12, v0.x, true);
          view.setFloat32(off + 16, v0.y, true);
          view.setFloat32(off + 20, v0.z, true);

          // V1 (3 x float32)
          view.setFloat32(off + 24, v1.x, true);
          view.setFloat32(off + 28, v1.y, true);
          view.setFloat32(off + 32, v1.z, true);

          // V2 (3 x float32)
          view.setFloat32(off + 36, v2.x, true);
          view.setFloat32(off + 40, v2.y, true);
          view.setFloat32(off + 44, v2.z, true);

          // Attribute byte count (uint16)
          view.setUint16(off + 48, 0, true);

          triIndex++;
        }
      }
    }

    const baseName = modelFile?.name
      ? (modelFile.name.substring(0, modelFile.name.lastIndexOf('.')) || modelFile.name)
      : 'plate';
    const downloadName = `${baseName}_plate.stl`;

    const blob = new Blob([buffer], { type: 'application/sla' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = downloadName;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    showToast(`Exported plate as STL (${totalTriangles} triangles)`, 'success');
  } catch (err: any) {
    showToast(`Failed to export plate as STL: ${err.message || String(err)}`, 'error');
  }
}
