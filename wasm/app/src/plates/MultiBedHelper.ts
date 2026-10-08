import * as THREE from 'three';
import type { BedConfig } from '../plate/types';
import type { PlateInfo } from './types';

export class MultiBedHelper {
  public static createPlateLabel(name: string, isActive: boolean): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = isActive ? 'rgba(0, 150, 136, 0.85)' : 'rgba(39, 39, 42, 0.85)';
      ctx.roundRect ? ctx.roundRect(0, 0, 256, 64, 12) : ctx.fillRect(0, 0, 256, 64);
      ctx.fill();

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.lineWidth = 4;
      ctx.stroke();

      ctx.font = 'bold 28px sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(name, 128, 32);
    }

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture, depthTest: false });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(40, 10, 1);
    return sprite;
  }

  public static buildPlatesBeds(
    plates: PlateInfo[],
    activePlateIndex: number,
    bedConfig: BedConfig
  ): THREE.Group {
    const group = new THREE.Group();
    group.name = 'multi-plates-group';

    const { width, depth, height, center, points } = bedConfig;
    const [cx, cy] = center;

    // Materials
    const floorMat = new THREE.MeshBasicMaterial({
      color: 0x222226,
      side: THREE.DoubleSide
    });
    const activeFloorMat = new THREE.MeshBasicMaterial({
      color: 0x27272a,
      side: THREE.DoubleSide
    });

    const outlineMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, linewidth: 2 });
    const inactiveOutlineMat = new THREE.LineBasicMaterial({ color: 0x475569, linewidth: 1 });

    const boxMat = new THREE.LineBasicMaterial({
      color: 0x64748b,
      transparent: true,
      opacity: 0.2
    });

    plates.forEach((plate) => {
      const plateGroup = new THREE.Group();
      plateGroup.name = `plate-bed-${plate.index}`;
      const [ox, oy, oz] = plate.origin;
      const isActive = plate.index === activePlateIndex;

      // 1. Bed floor plate
      const floorGeo = new THREE.PlaneGeometry(width, depth);
      const floorMesh = new THREE.Mesh(floorGeo, isActive ? activeFloorMat : floorMat);
      floorMesh.position.set(ox + cx, oy + cy, oz - 0.1);
      plateGroup.add(floorMesh);

      // 2. Bed Grid
      const gridSize = Math.max(width, depth);
      const gridDivisions = Math.round(gridSize / 10);
      const grid = new THREE.GridHelper(
        gridSize,
        gridDivisions,
        isActive ? 0x475569 : 0x334155,
        isActive ? 0x334155 : 0x1e293b
      );
      grid.rotation.x = Math.PI / 2;
      grid.position.set(ox + cx, oy + cy, oz);
      plateGroup.add(grid);

      // 3. Bed boundary outline
      if (points.length >= 3) {
        const outlinePoints: THREE.Vector3[] = points.map(
          ([x, y]) => new THREE.Vector3(ox + x, oy + y, oz + 0.2)
        );
        outlinePoints.push(outlinePoints[0].clone());
        const outlineGeo = new THREE.BufferGeometry().setFromPoints(outlinePoints);
        const outlineLine = new THREE.Line(outlineGeo, isActive ? outlineMat : inactiveOutlineMat);
        plateGroup.add(outlineLine);
      }

      // 4. Origin Axes Helper
      const axesHelper = new THREE.AxesHelper(30);
      axesHelper.position.set(ox, oy, oz + 0.5);
      plateGroup.add(axesHelper);

      // 5. Printable height bounding box
      const boxGeo = new THREE.BoxGeometry(width, depth, height);
      const edgesGeo = new THREE.EdgesGeometry(boxGeo);
      const boxLines = new THREE.LineSegments(edgesGeo, boxMat);
      boxLines.position.set(ox + cx, oy + cy, oz + height / 2);
      plateGroup.add(boxLines);

      // 6. Plate number tab / label at the front edge of the bed
      const label = MultiBedHelper.createPlateLabel(plate.name || `Plate ${plate.index + 1}`, isActive);
      label.position.set(ox + cx, oy - 15, oz + 5);
      plateGroup.add(label);

      group.add(plateGroup);
    });

    return group;
  }
}
