import * as THREE from 'three';
import type { CutConnectorDef } from '../cut/types';
import type { ConnectorIssue } from './cutSection';
import { insideSection, sectionLoops, signedArea, type SectionLoop } from './cutSection';

export interface CutPreviewState {
  z: number;
  rotX?: number;
  rotY?: number;
  rotZ?: number;
  flipPlane: boolean;
  keepUpper: boolean;
  keepLower: boolean;
  connectorMode: boolean;
  connectors: CutConnectorDef[];
  selectedConnectorIndex: number | null;
  issues: ConnectorIssue[];
}

export type CutPick = { connector: number } | { point: [number, number] } | null;

const UPPER_TINT = 0xffb27a;
const LOWER_TINT = 0x7ab8ff;
const SEGMENTS = { circle: 32, hexagon: 6, square: 4, triangle: 3 } as const;

/**
 * Editor-only cut preview for one object instance: the cut plane, the two halves tinted and clipped at
 * the plane, the new flat faces, and connector markers. Nothing here enters objectMeshes, the engine,
 * exports or thumbnails; the target mesh keeps its geometry and transform and is only hidden from view.
 */
export class CutPreview {
  readonly group = new THREE.Group();
  private target: THREE.Mesh | null = null;
  private targetMaterial: THREE.Material | THREE.Material[] | null = null;
  private hiddenChildren = new Map<THREE.Object3D, boolean>();
  private readonly hidden = new THREE.MeshBasicMaterial({ visible: false });
  private readonly empty = new THREE.BufferGeometry();
  private readonly upperPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  private readonly lowerPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
  private readonly upper: THREE.Mesh;
  private readonly lower: THREE.Mesh;
  private readonly plane: THREE.Mesh;
  private readonly planeEdge: THREE.LineLoop;
  private readonly caps = new THREE.Group();
  private readonly markers = new THREE.Group();
  private state: CutPreviewState | null = null;
  private loops: SectionLoop[] = [];
  private sectionKey = '';
  private world: Float32Array | null = null;
  private worldKey = '';
  private worldBox = new THREE.Box3();
  private gap = 0;

  constructor() {
    this.group.name = 'cut-preview';
    this.group.visible = false;
    const half = (color: number, plane: THREE.Plane) => {
      const mesh = new THREE.Mesh(this.empty, new THREE.MeshLambertMaterial({
        color, vertexColors: true, flatShading: true, side: THREE.DoubleSide, clippingPlanes: [plane]
      }));
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
      return mesh;
    };
    this.upper = half(UPPER_TINT, this.upperPlane);
    this.upper.name = 'cut-preview-upper';
    this.lower = half(LOWER_TINT, this.lowerPlane);
    this.lower.name = 'cut-preview-lower';
    this.plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      color: 0x38bdf8, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false
    }));
    this.plane.name = 'cut-preview-plane';
    this.planeEdge = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]].map(([x, y]) => new THREE.Vector3(x, y, 0))),
      new THREE.LineBasicMaterial({ color: 0x7dd3fc })
    );
    this.plane.add(this.planeEdge);
    this.group.add(this.plane, this.caps, this.markers);
  }

  get active(): boolean {
    return this.target !== null;
  }

  get connectorMode(): boolean {
    return this.target !== null && !!this.state?.connectorMode;
  }

  /**
   * Shows the preview of `target` (null removes it). Returns the cut face loops when they were
   * recomputed, so the caller can hand them to the cut store; undefined when unchanged.
   */
  update(target: THREE.Mesh | null, state: CutPreviewState | null): SectionLoop[] | undefined {
    if (target !== this.target) this.release();
    if (!target || !state) {
      this.state = null;
      this.group.visible = false;
      return undefined;
    }
    this.target = target;
    this.state = state;
    this.group.visible = true;
    this.frame();
    const changed = this.refreshSection();
    this.layout();
    return changed ? this.loops : undefined;
  }

  /** Keeps the halves on the target's live transform and the target itself out of view; call per frame. */
  frame(): void {
    const target = this.target;
    if (!target || !this.state) return;
    if (target.material !== this.hidden) {
      this.targetMaterial = target.material;
      target.material = this.hidden;
    }
    for (const child of target.children) {
      if (!this.hiddenChildren.has(child)) this.hiddenChildren.set(child, child.visible);
      child.visible = false;
    }
    target.updateMatrixWorld(true);
    this.upper.geometry = this.lower.geometry = target.geometry;
    this.lower.matrix.copy(target.matrixWorld);
    const rotX = this.state?.rotX ?? 0;
    const rotY = this.state?.rotY ?? 0;
    const rotZ = this.state?.rotZ ?? 0;
    const radX = (rotX * Math.PI) / 180;
    const radY = (rotY * Math.PI) / 180;
    const radZ = (rotZ * Math.PI) / 180;
    const euler = new THREE.Euler(radX, radY, radZ, 'XYZ');
    const normal = new THREE.Vector3(0, 0, 1).applyEuler(euler).normalize();
    if (this.state?.flipPlane) normal.negate();
    const gapVec = normal.clone().multiplyScalar(this.gap);
    this.upper.matrix.makeTranslation(gapVec.x, gapVec.y, gapVec.z).multiply(target.matrixWorld);
    this.lower.matrixWorldNeedsUpdate = this.upper.matrixWorldNeedsUpdate = true;
  }

  /** Thumbnails render the real object only. */
  setSuspended(suspended: boolean): void {
    if (!this.target) return;
    this.group.visible = !suspended;
    if (suspended) this.restoreTarget();
    else this.frame();
  }

  pick(raycaster: THREE.Raycaster): CutPick {
    if (!this.target) return null;
    const marker = raycaster.intersectObjects(this.markers.children, false)[0];
    if (marker) return { connector: marker.object.userData.connectorIndex as number };
    const cap = raycaster.intersectObjects(this.caps.children, false)[0];
    if (cap) return { point: [cap.point.x, cap.point.y] };
    return null;
  }

  dispose(): void {
    this.release();
    this.group.removeFromParent();
    this.hidden.dispose();
    for (const mesh of [this.upper, this.lower]) (mesh.material as THREE.Material).dispose();
    this.plane.geometry.dispose();
    (this.plane.material as THREE.Material).dispose();
    this.planeEdge.geometry.dispose();
    (this.planeEdge.material as THREE.Material).dispose();
    this.clear(this.caps);
    this.clear(this.markers);
  }

  private restoreTarget(): void {
    if (this.target && this.target.material === this.hidden && this.targetMaterial) this.target.material = this.targetMaterial;
    for (const [child, visible] of this.hiddenChildren) child.visible = visible;
    this.hiddenChildren.clear();
  }

  private release(): void {
    this.restoreTarget();
    this.target = null;
    this.targetMaterial = null;
    this.world = null;
    this.worldKey = '';
    this.sectionKey = '';
    this.loops = [];
    // Drop the caps, markers and the borrowed object geometry so a closed tool holds nothing.
    this.clear(this.caps);
    this.clear(this.markers);
    this.upper.geometry = this.lower.geometry = this.empty;
  }

  private refreshSection(): boolean {
    const target = this.target!;
    const position = target.geometry.getAttribute('position') as THREE.BufferAttribute;
    const index = target.geometry.index;
    if (!position || !index) return false;
    const worldKey = `${target.geometry.uuid}:${position.version}:${index.version}:${target.matrixWorld.elements.join(',')}`;
    if (worldKey !== this.worldKey) {
      const world = new Float32Array(position.count * 3);
      const v = new THREE.Vector3();
      for (let i = 0; i < position.count; i++) v.fromBufferAttribute(position, i).applyMatrix4(target.matrixWorld).toArray(world, i * 3);
      this.world = world;
      this.worldKey = worldKey;
      this.worldBox.setFromArray(world);
    }
    const sectionKey = `${this.worldKey}@${this.state!.z}:${this.state!.rotX ?? 0}:${this.state!.rotY ?? 0}:${this.state!.rotZ ?? 0}:${this.state!.flipPlane}`;
    if (sectionKey === this.sectionKey) return false;
    this.sectionKey = sectionKey;

    const rotX = this.state!.rotX ?? 0;
    const rotY = this.state!.rotY ?? 0;
    const rotZ = this.state!.rotZ ?? 0;

    if (rotX === 0 && rotY === 0 && rotZ === 0) {
      this.loops = sectionLoops(this.world!, index.array, this.state!.z);
      this.buildCaps();
      return true;
    }

    const radX = (rotX * Math.PI) / 180;
    const radY = (rotY * Math.PI) / 180;
    const radZ = (rotZ * Math.PI) / 180;
    const euler = new THREE.Euler(radX, radY, radZ, 'XYZ');
    const normal = new THREE.Vector3(0, 0, 1).applyEuler(euler).normalize();
    if (this.state!.flipPlane) normal.negate();

    const center = this.worldBox.getCenter(new THREE.Vector3());
    const planePoint = new THREE.Vector3(center.x, center.y, this.state!.z);

    let u = new THREE.Vector3();
    if (Math.abs(normal.z) < 0.99) {
      u.crossVectors(normal, new THREE.Vector3(0, 0, 1)).normalize();
    } else {
      u.crossVectors(normal, new THREE.Vector3(0, 1, 0)).normalize();
    }
    const v = new THREE.Vector3().crossVectors(normal, u).normalize();

    const world = this.world!;
    const count = world.length / 3;
    const transformed = new Float32Array(world.length);
    const p = new THREE.Vector3();

    for (let i = 0; i < count; i++) {
      p.set(world[i * 3] - planePoint.x, world[i * 3 + 1] - planePoint.y, world[i * 3 + 2] - planePoint.z);
      transformed[i * 3] = u.dot(p);
      transformed[i * 3 + 1] = v.dot(p);
      transformed[i * 3 + 2] = normal.dot(p);
    }

    this.loops = sectionLoops(transformed, index.array, 0);
    this.buildRotatedCaps(planePoint, u, v, normal);
    return true;
  }

  private layout(): void {
    const state = this.state!;
    const box = this.worldBox;
    const height = box.max.z - box.min.z;
    this.gap = state.connectorMode ? THREE.MathUtils.clamp(height * 0.4, 6, 40) : 0;
    this.frame();
    // The normal points into the upper half; flipping it swaps which physical side is "upper".
    const topTint = state.flipPlane ? LOWER_TINT : UPPER_TINT;
    const bottomTint = state.flipPlane ? UPPER_TINT : LOWER_TINT;
    const keepTop = state.flipPlane ? state.keepLower : state.keepUpper;
    const keepBottom = state.flipPlane ? state.keepUpper : state.keepLower;
    const style = (mesh: THREE.Mesh, tint: number, kept: boolean, ghost: boolean) => {
      const material = mesh.material as THREE.MeshLambertMaterial;
      material.color.setHex(kept ? tint : 0x8a8a8a);
      material.opacity = !kept ? 0.3 : ghost ? 0.45 : 1;
      material.transparent = material.opacity < 1;
      material.depthWrite = !material.transparent;
    };
    const rotX = state.rotX ?? 0;
    const rotY = state.rotY ?? 0;
    const rotZ = state.rotZ ?? 0;
    const radX = (rotX * Math.PI) / 180;
    const radY = (rotY * Math.PI) / 180;
    const radZ = (rotZ * Math.PI) / 180;
    const euler = new THREE.Euler(radX, radY, radZ, 'XYZ');
    const normal = new THREE.Vector3(0, 0, 1).applyEuler(euler).normalize();
    if (state.flipPlane) normal.negate();

    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const planePoint = new THREE.Vector3(center.x, center.y, state.z);

    // Sync plane center to cutStore
    try {
      (window as any).__cutStore?.getState()?.setPlaneCenter([center.x, center.y, center.z]);
    } catch (_) {}

    // While placing connectors the lifted top half is see-through so the lower face stays clickable from above.
    style(this.upper, topTint, keepTop, state.connectorMode);
    style(this.lower, bottomTint, keepBottom, false);

    this.upperPlane.normal.copy(normal);
    this.upperPlane.constant = -normal.dot(planePoint) - this.gap;
    this.lowerPlane.normal.copy(normal).negate();
    this.lowerPlane.constant = normal.dot(planePoint);

    const maxDim = Math.max(size.x, size.y, size.z, 1);
    const planeDim = maxDim * 1.5 + 4;
    this.plane.visible = !state.connectorMode;
    this.plane.position.copy(planePoint);
    this.plane.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    this.plane.scale.set(planeDim, planeDim, 1);
    if (rotX === 0 && rotY === 0 && rotZ === 0) {
      const [lowerCap, upperCap] = this.caps.children as THREE.Mesh[];
      if (lowerCap) lowerCap.position.z = state.z + 0.01;
      if (upperCap) {
        upperCap.position.z = state.z + this.gap - 0.01;
        upperCap.visible = state.connectorMode;
      }
    }
    this.buildMarkers(topTint === UPPER_TINT);
  }

  /** The new flat faces: the lower half's cap faces up, the upper half's cap (shown when separated) faces down. */
  private buildRotatedCaps(planePoint: THREE.Vector3, u: THREE.Vector3, v: THREE.Vector3, normal: THREE.Vector3): void {
    this.clear(this.caps);
    if (this.loops.length === 0) return;
    const area = this.loops.map(signedArea);
    const outlines = this.loops.map((_, i) => i).filter((i) => area[i] > 0);
    const shapes = outlines.map((i) => new THREE.Shape(this.loops[i].map(([x, y]) => new THREE.Vector2(x, y))));
    this.loops.forEach((loop, i) => {
      if (area[i] > 0) return;
      let owner = -1;
      outlines.forEach((o, k) => {
        if (insideSection([this.loops[o]], loop[0][0], loop[0][1]) && (owner < 0 || area[o] < area[outlines[owner]])) owner = k;
      });
      if (owner >= 0) shapes[owner].holes.push(new THREE.Path(loop.map(([x, y]) => new THREE.Vector2(x, y))));
    });
    if (shapes.length === 0) return;

    const geometry = new THREE.ShapeGeometry(shapes);
    const material = (color: number) => new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });

    const rotMatrix = new THREE.Matrix4().makeBasis(u, v, normal);
    const quat = new THREE.Quaternion().setFromRotationMatrix(rotMatrix);

    const lowerCap = new THREE.Mesh(geometry, material(LOWER_TINT));
    lowerCap.quaternion.copy(quat);
    lowerCap.position.copy(planePoint).addScaledVector(normal, 0.01);

    const upperCap = new THREE.Mesh(geometry, material(UPPER_TINT));
    upperCap.quaternion.copy(quat);
    upperCap.position.copy(planePoint).addScaledVector(normal, this.gap - 0.01);
    upperCap.visible = !!this.state?.connectorMode;

    this.caps.add(lowerCap, upperCap);
  }

  private buildCaps(): void {
    this.clear(this.caps);
    if (this.loops.length === 0) return;
    // Orientation decides outer boundaries and holes; each hole belongs to the smallest outline around it.
    const area = this.loops.map(signedArea);
    const outlines = this.loops.map((_, i) => i).filter((i) => area[i] > 0);
    const shapes = outlines.map((i) => new THREE.Shape(this.loops[i].map(([x, y]) => new THREE.Vector2(x, y))));
    this.loops.forEach((loop, i) => {
      if (area[i] > 0) return;
      let owner = -1;
      outlines.forEach((o, k) => {
        if (insideSection([this.loops[o]], loop[0][0], loop[0][1]) && (owner < 0 || area[o] < area[outlines[owner]])) owner = k;
      });
      if (owner >= 0) shapes[owner].holes.push(new THREE.Path(loop.map(([x, y]) => new THREE.Vector2(x, y))));
    });
    const geometry = new THREE.ShapeGeometry(shapes);
    // Each face is drawn and picked only from its open side, so the lifted upper face never hides the lower one.
    const cap = (color: number, side: THREE.Side, name: string) => {
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, side }));
      mesh.name = name;
      this.caps.add(mesh);
    };
    cap(0xdbeafe, THREE.FrontSide, 'cut-preview-cap-lower');
    cap(0xffedd5, THREE.BackSide, 'cut-preview-cap-upper');
  }

  private buildMarkers(topIsUpper: boolean): void {
    this.clear(this.markers);
    const state = this.state!;
    const top = state.z + this.gap;
    state.connectors.forEach((connector, i) => {
      const attrs = connector.attrs ?? {};
      const radius = attrs.radius ?? (attrs.size ?? attrs.diameter ?? 3) / 2;
      const depth = attrs.depthRatio ?? attrs.depth ?? attrs.height ?? 4;
      const segments = SEGMENTS[attrs.shape ?? 'circle'] ?? 32;
      const tip = attrs.style === 'frustum' ? radius * 0.6 : radius;
      const color = state.issues[i] ? 0xef4444 : state.selectedConnectorIndex === i ? 0xfacc15 : 0x0ea5e9;
      const material = new THREE.MeshLambertMaterial({ color });
      const turn = THREE.MathUtils.degToRad(-(attrs.rotationDeg ?? attrs.rotation ?? attrs.angle ?? 0)) + (attrs.shape === 'square' ? Math.PI / 4 : 0);
      const add = (geometry: THREE.BufferGeometry, z: number) => {
        geometry.rotateZ(turn);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(connector.pos[0], connector.pos[1], z);
        mesh.userData.connectorIndex = i;
        this.markers.add(mesh);
      };
      // CylinderGeometry runs along Y with radiusTop at +Y; rotating X maps it to Z, pointing up or down.
      const peg = (up: boolean, from: number, length: number) =>
        add(new THREE.CylinderGeometry(tip, radius, length, segments).rotateX(up ? Math.PI / 2 : -Math.PI / 2), from + (up ? length / 2 : -length / 2));
      const socket = (z: number) => add(new THREE.CylinderGeometry(radius, radius, 0.3, segments).rotateX(Math.PI / 2), z);
      if (attrs.type === 'dowel') {
        // The engine doubles a prism dowel's depth and centres both on the plane.
        const each = attrs.style === 'frustum' ? depth / 2 : depth;
        peg(true, state.z, each);
        peg(false, top, each);
        return;
      }
      const plugOnTop = ((attrs.targetHalf ?? (attrs.type === 'snap' ? 'lower' : 'upper')) === 'upper') === topIsUpper;
      if (plugOnTop) { peg(false, top, depth); socket(state.z + 0.15); }
      else { peg(true, state.z, depth); socket(top - 0.15); }
    });
  }

  private clear(group: THREE.Group): void {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    for (const child of group.children as THREE.Mesh[]) {
      geometries.add(child.geometry);
      materials.add(child.material as THREE.Material);
    }
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    group.clear();
  }
}
