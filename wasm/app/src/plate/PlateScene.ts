import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { PlateObject, BedConfig, GizmoMode, MeshBufferData, MeshVolumePartition } from './types';
import type { SupportPaintingData } from '../painting/types';

export interface PlateSceneCallbacks {
  onSelect: (objectId: number | null, instanceId: number | null) => void;
  onTransformChange: (
    objectId: number,
    instanceId: number,
    transform: {
      offset: [number, number, number];
      rotation: [number, number, number];
      scale: [number, number, number];
    }
  ) => void;
  getMesh: (objectId: number) => Promise<MeshBufferData>;
  onPaintBegin?: () => void;
  onPaintFacet?: (facetId: number) => void;
  onPaintEnd?: () => void;
}

export class PlateScene {
  private container: HTMLElement;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private orbitControls: OrbitControls;
  private transformControls: TransformControls;

  private bedGroup: THREE.Group;
  private objectsGroup: THREE.Group;

  private objectMeshes: Map<string, THREE.Mesh> = new Map();
  private overlayMeshes: Map<string, THREE.Mesh> = new Map();
  private geometries: Map<number, THREE.BufferGeometry> = new Map();
  private meshVolumes: Map<number, MeshVolumePartition[]> = new Map();

  private selectedObjectId: number | null = null;
  private selectedInstanceId: number | null = null;
  private gizmoMode: GizmoMode = 'translate';
  private bedConfig: BedConfig;
  private callbacks: PlateSceneCallbacks;

  private isPaintingActive = false;
  private paintingVolumeId: number | null = null;
  private isPaintingStroke = false;
  private pointerDownPos = { x: 0, y: 0 };
  private isDestroyed = false;
  private animationFrameId: number | null = null;

  // Materials
  private defaultMaterial: THREE.MeshStandardMaterial;
  private selectedMaterial: THREE.MeshStandardMaterial;

  constructor(container: HTMLElement, bedConfig: BedConfig, callbacks: PlateSceneCallbacks) {
    this.container = container;
    this.bedConfig = bedConfig;
    this.callbacks = callbacks;

    // 1. Scene setup
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1e1e24);

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 600;

    // 2. Camera setup: Z is UP (matching Slic3r world coordinates)
    this.camera = new THREE.PerspectiveCamera(45, width / height, 1, 5000);
    this.camera.up.set(0, 0, 1);

    // Initial camera position looking at bed center
    const cx = bedConfig.center[0];
    const cy = bedConfig.center[1];
    const span = Math.max(bedConfig.width, bedConfig.depth);
    this.camera.position.set(cx, cy - span * 1.5, span * 1.2);
    this.camera.lookAt(cx, cy, 0);

    // 3. Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.domElement.style.display = "block";
    container.appendChild(this.renderer.domElement);

    // 4. OrbitControls: left rotate, right/middle pan, wheel zoom (matching desktop GLCanvas3D)
    this.orbitControls = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbitControls.target.set(cx, cy, 0);
    this.orbitControls.enableDamping = true;
    this.orbitControls.dampingFactor = 0.1;
    this.orbitControls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.PAN
    };
    this.orbitControls.update();

    // 5. TransformControls
    this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
    this.transformControls.setMode(this.gizmoMode);
    this.scene.add(this.transformControls.getHelper());

    this.transformControls.addEventListener('dragging-changed', (event) => {
      this.orbitControls.enabled = !event.value;
      if (!event.value) {
        // Drag finished - apply transform to backend
        const target = this.transformControls.object;
        if (target && target.userData) {
          const { objectId, instanceId } = target.userData;
          const pos: [number, number, number] = [target.position.x, target.position.y, target.position.z];
          const rot: [number, number, number] = [target.rotation.x, target.rotation.y, target.rotation.z];
          const sc: [number, number, number] = [target.scale.x, target.scale.y, target.scale.z];
          this.callbacks.onTransformChange(objectId, instanceId, {
            offset: pos,
            rotation: rot,
            scale: sc
          });
        }
      }
    });

    // 6. Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
    this.scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.7);
    dirLight1.position.set(cx + 150, cy - 250, 350);
    this.scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0xa5c4d4, 0.35);
    dirLight2.position.set(cx - 200, cy + 200, 200);
    this.scene.add(dirLight2);

    // 7. Groups
    this.bedGroup = new THREE.Group();
    this.objectsGroup = new THREE.Group();
    this.scene.add(this.bedGroup);
    this.scene.add(this.objectsGroup);

    // 8. Materials
    this.defaultMaterial = new THREE.MeshStandardMaterial({
      color: 0x3b82f6, // Vibrant blue
      roughness: 0.35,
      metalness: 0.1
    });

    this.selectedMaterial = new THREE.MeshStandardMaterial({
      color: 0x10b981, // Vibrant emerald green highlight
      emissive: 0x064e3b,
      emissiveIntensity: 0.35,
      roughness: 0.3,
      metalness: 0.15
    });

    // Build bed
    this.buildBed();

    // Event listeners
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.addEventListener('pointermove', this.onPointerMove);
    this.renderer.domElement.addEventListener('pointerup', this.onPointerUp);
    this.renderer.domElement.addEventListener('pointerleave', this.onPointerLeave);
    this.renderer.domElement.addEventListener('pointercancel', this.onPointerLeave);
    window.addEventListener('resize', this.onWindowResize);

    // Start render loop
    this.animate();
  }

  private buildBed(): void {
    while (this.bedGroup.children.length > 0) {
      const child = this.bedGroup.children[0];
      this.bedGroup.remove(child);
    }

    const { width, depth, height, center, points } = this.bedConfig;
    const [cx, cy] = center;

    // 1. Bed subtle floor plate
    const floorGeo = new THREE.PlaneGeometry(width, depth);
    const floorMat = new THREE.MeshBasicMaterial({
      color: 0x27272a,
      side: THREE.DoubleSide
    });
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.position.set(cx, cy, -0.1);
    this.bedGroup.add(floorMesh);

    // 2. Bed Grid (in XY plane at Z=0)
    const gridSize = Math.max(width, depth);
    const gridDivisions = Math.round(gridSize / 10); // 10mm grid cells
    const grid = new THREE.GridHelper(gridSize, gridDivisions, 0x475569, 0x334155);
    grid.rotation.x = Math.PI / 2;
    grid.position.set(cx, cy, 0);
    this.bedGroup.add(grid);

    // 3. Bed boundary outline
    if (points.length >= 3) {
      const outlinePoints: THREE.Vector3[] = points.map(([x, y]) => new THREE.Vector3(x, y, 0.2));
      outlinePoints.push(outlinePoints[0].clone()); // Close loop
      const outlineGeo = new THREE.BufferGeometry().setFromPoints(outlinePoints);
      const outlineMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, linewidth: 2 });
      const outlineLine = new THREE.Line(outlineGeo, outlineMat);
      this.bedGroup.add(outlineLine);
    }

    // 4. Origin Axes Helper (Red=X, Green=Y, Blue=Z)
    const axesHelper = new THREE.AxesHelper(40);
    axesHelper.position.set(0, 0, 0.5);
    this.bedGroup.add(axesHelper);

    // 5. Printable height faint bounding box
    const boxGeo = new THREE.BoxGeometry(width, depth, height);
    const edgesGeo = new THREE.EdgesGeometry(boxGeo);
    const boxMat = new THREE.LineBasicMaterial({
      color: 0x64748b,
      transparent: true,
      opacity: 0.2
    });
    const boxLines = new THREE.LineSegments(edgesGeo, boxMat);
    boxLines.position.set(cx, cy, height / 2);
    this.bedGroup.add(boxLines);
  }

  public updateBedConfig(bedConfig: BedConfig): void {
    this.bedConfig = bedConfig;
    this.buildBed();
    this.orbitControls.target.set(bedConfig.center[0], bedConfig.center[1], 0);
  }

  public async setObjects(objects: PlateObject[]): Promise<void> {
    const activeKeys = new Set<string>();

    for (const obj of objects) {
      let geo = this.geometries.get(obj.id);
      if (!geo) {
        try {
          const meshData = await this.callbacks.getMesh(obj.id);
          if (meshData.volumes) {
            this.meshVolumes.set(obj.id, meshData.volumes);
          }
          geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.BufferAttribute(meshData.positions, 3));
          geo.setIndex(new THREE.BufferAttribute(meshData.indices, 1));
          geo.computeVertexNormals();
          this.geometries.set(obj.id, geo);
          geo.computeBoundingBox();
          geo.computeBoundingSphere();
        } catch (err) {
          console.error(`[PlateScene] Error loading mesh for object ${obj.id}:`, err);
          continue;
        }
      } else {
        try {
          const meshData = await this.callbacks.getMesh(obj.id);
          if (meshData.volumes) {
            this.meshVolumes.set(obj.id, meshData.volumes);
          }
          const posAttr = geo.attributes.position as THREE.BufferAttribute | undefined;
          const idxAttr = geo.index;
          const posCountMismatch = !posAttr || posAttr.count * 3 !== meshData.positions.length;
          const idxCountMismatch = !idxAttr || idxAttr.count !== meshData.indices.length;

          if (posCountMismatch || idxCountMismatch) {
            geo.dispose();
            geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(meshData.positions, 3));
            geo.setIndex(new THREE.BufferAttribute(meshData.indices, 1));
            geo.computeVertexNormals();
            geo.computeBoundingBox();
            geo.computeBoundingSphere();
            this.geometries.set(obj.id, geo);
          } else {
            // Refresh geometry buffers when positions or indices change even though counts stay equal
            let positionsModified = false;
            const currentPos = posAttr.array;
            for (let i = 0; i < currentPos.length; i++) {
              if (currentPos[i] !== meshData.positions[i]) {
                positionsModified = true;
                break;
              }
            }

            let indicesModified = false;
            const currentIdx = idxAttr.array;
            for (let i = 0; i < currentIdx.length; i++) {
              if (currentIdx[i] !== meshData.indices[i]) {
                indicesModified = true;
                break;
              }
            }

            if (positionsModified || indicesModified) {
              if (positionsModified) {
                posAttr.copyArray(meshData.positions);
                posAttr.needsUpdate = true;
              }
              if (indicesModified) {
                idxAttr.copyArray(meshData.indices);
                idxAttr.needsUpdate = true;
              }
              geo.computeVertexNormals();
              geo.computeBoundingBox();
              geo.computeBoundingSphere();
            }
          }
        } catch (_) {}
      }

      for (const inst of obj.instances) {
        const key = `${obj.id}_${inst.id}`;
        activeKeys.add(key);

        let mesh = this.objectMeshes.get(key);
        const isSelected = this.selectedObjectId === obj.id && this.selectedInstanceId === inst.id;

        if (!mesh) {
          mesh = new THREE.Mesh(geo, isSelected ? this.selectedMaterial : this.defaultMaterial);
          mesh.userData = { objectId: obj.id, instanceId: inst.id, name: obj.name };
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          this.objectsGroup.add(mesh);
          this.objectMeshes.set(key, mesh);
        } else {
          mesh.geometry = geo;
          mesh.material = isSelected ? this.selectedMaterial : this.defaultMaterial;
        }

        // Apply instance transforms from Engine
        mesh.position.set(inst.offset[0], inst.offset[1], inst.offset[2]);
        mesh.rotation.set(inst.rotation[0], inst.rotation[1], inst.rotation[2]);
        mesh.scale.set(inst.scale[0], inst.scale[1], inst.scale[2]);

        if (isSelected && !this.isPaintingActive) {
          this.transformControls.attach(mesh);
        }
      }
    }

    // Remove any meshes that no longer exist
    for (const [key, mesh] of this.objectMeshes.entries()) {
      if (!activeKeys.has(key)) {
        if (this.transformControls.object === mesh) {
          this.transformControls.detach();
        }
        for (const [oKey, overlay] of this.overlayMeshes.entries()) {
          if (oKey.startsWith(key)) {
            mesh.remove(overlay);
            overlay.geometry.dispose();
            this.overlayMeshes.delete(oKey);
          }
        }
        this.objectsGroup.remove(mesh);
        this.objectMeshes.delete(key);
      }
    }

    // Clean up unused geometries and metadata
    const activeObjIds = new Set(objects.map((o) => o.id));
    for (const [objId, geo] of this.geometries.entries()) {
      if (!activeObjIds.has(objId)) {
        geo.dispose();
        this.geometries.delete(objId);
        this.meshVolumes.delete(objId);
      }
    }
  }

  public setSelection(objectId: number | null, instanceId: number | null): void {
    this.selectedObjectId = objectId;
    this.selectedInstanceId = instanceId;

    let selectedMesh: THREE.Mesh | null = null;
    for (const mesh of this.objectMeshes.values()) {
      const isSelected =
        objectId !== null &&
        instanceId !== null &&
        mesh.userData.objectId === objectId &&
        mesh.userData.instanceId === instanceId;

      mesh.material = isSelected ? this.selectedMaterial : this.defaultMaterial;
      if (isSelected) {
        selectedMesh = mesh;
      }
    }

    if (selectedMesh && !this.isPaintingActive) {
      this.transformControls.attach(selectedMesh);
    } else {
      this.transformControls.detach();
    }
  }

  public setGizmoMode(mode: GizmoMode): void {
    this.gizmoMode = mode;
    this.transformControls.setMode(mode);
  }

  public setPaintingActive(active: boolean, volumeId?: number | null): void {
    this.isPaintingActive = active;
    this.paintingVolumeId = active ? (volumeId ?? null) : null;
    if (active) {
      this.transformControls.detach();
    } else {
      // Restore navigation and gizmo on exit/cancel
      this.isPaintingStroke = false;
      this.orbitControls.enabled = true;
      const selectedMesh = this.getSelectedMesh();
      if (selectedMesh) {
        this.transformControls.attach(selectedMesh);
      }
    }
  }

  public setPaintingVolumeId(volumeId: number | null): void {
    this.paintingVolumeId = volumeId;
  }

  public getMeshVolumes(objectId: number): MeshVolumePartition[] | undefined {
    return this.meshVolumes.get(objectId);
  }

  public getSelectedMesh(): THREE.Mesh | null {
    if (this.selectedObjectId === null) return null;
    for (const mesh of this.objectMeshes.values()) {
      if (
        mesh.userData.objectId === this.selectedObjectId &&
        (this.selectedInstanceId === null || mesh.userData.instanceId === this.selectedInstanceId)
      ) {
        return mesh;
      }
    }
    return null;
  }

  /**
   * Calculates viewport screen coordinates (pixels) for a facet's centroid.
   * Useful for deterministic testing with actual browser pointer events.
   */
  public getFacetScreenCoordinates(
    objectId: number,
    facetIndex: number,
    isLocal = false,
    volumeId?: number | null
  ): { x: number; y: number } | null {
    const mesh = this.getSelectedMesh();
    if (!mesh || mesh.userData.objectId !== objectId) return null;

    const baseGeo = this.geometries.get(objectId);
    mesh.updateMatrixWorld(true);
    if (!baseGeo || !baseGeo.index) return null;

    const indices = baseGeo.index.array;
    const positions = baseGeo.attributes.position.array;

    let mergedFacet = facetIndex;
    if (isLocal && typeof volumeId === 'number') {
      const partitions = this.meshVolumes.get(objectId);
      const partition = partitions?.find((p) => p.volumeId === volumeId);
      if (!partition) return null;
      mergedFacet = partition.firstFacet + facetIndex;
    }

    if (mergedFacet < 0 || mergedFacet * 3 + 2 >= indices.length) return null;


    const i0 = indices[mergedFacet * 3];
    const i1 = indices[mergedFacet * 3 + 1];
    const i2 = indices[mergedFacet * 3 + 2];

    const lx = (positions[i0 * 3] + positions[i1 * 3] + positions[i2 * 3]) / 3;
    const ly = (positions[i0 * 3 + 1] + positions[i1 * 3 + 1] + positions[i2 * 3 + 1]) / 3;
    const lz = (positions[i0 * 3 + 2] + positions[i1 * 3 + 2] + positions[i2 * 3 + 2]) / 3;

    const worldPoint = new THREE.Vector3(lx, ly, lz).applyMatrix4(mesh.matrixWorld);
    worldPoint.project(this.camera);

    const rect = this.renderer.domElement.getBoundingClientRect();
    const x = ((worldPoint.x + 1) / 2) * rect.width + rect.left;
    const y = ((-worldPoint.y + 1) / 2) * rect.height + rect.top;

    return { x, y };
  }

  public clearAllOverlays(objectId?: number): void {
    for (const [key, mesh] of this.objectMeshes.entries()) {
      if (typeof objectId === 'number' && mesh.userData.objectId !== objectId) {
        continue;
      }
      for (const [oKey, overlay] of Array.from(this.overlayMeshes.entries())) {
        if (oKey.startsWith(key)) {
          mesh.remove(overlay);
          overlay.geometry.dispose();
          if (Array.isArray(overlay.material)) overlay.material.forEach((m) => m.dispose());
          else overlay.material.dispose();
          this.overlayMeshes.delete(oKey);
        }
      }
    }
  }

  public cancelStroke(): void {
    this.isPaintingStroke = false;
    this.orbitControls.enabled = true;
  }

  public updatePaintingOverlay(
    objectId: number,
    paintingData: SupportPaintingData | null,
    targetVolumeId?: number | null
  ): void {
    const volId = paintingData?.volumeId ?? targetVolumeId;
    const partitions = this.meshVolumes.get(objectId);

    // Never assume volume zero; missing metadata disables overlay safely
    if (!partitions || partitions.length === 0 || typeof volId !== 'number') {
      for (const [key, mesh] of this.objectMeshes.entries()) {
        if (mesh.userData.objectId !== objectId) continue;
        const overlayKey = typeof volId === 'number' ? `${key}_vol_${volId}` : key;
        const overlay = this.overlayMeshes.get(overlayKey);
        if (overlay) {
          mesh.remove(overlay);
          overlay.geometry.dispose();
          if (Array.isArray(overlay.material)) overlay.material.forEach((m) => m.dispose());
          else overlay.material.dispose();
          this.overlayMeshes.delete(overlayKey);
        }
      }
      return;
    }

    const partition = partitions.find((p) => p.volumeId === volId);
    if (!partition) {
      return;
    }

    const enforcers = paintingData?.enforcers || [];
    const blockers = paintingData?.blockers || [];
    const totalPainted = enforcers.length + blockers.length;

    for (const [key, mesh] of this.objectMeshes.entries()) {
      if (mesh.userData.objectId !== objectId) continue;

      const overlayKey = `${key}_vol_${volId}`;
      let overlayMesh = this.overlayMeshes.get(overlayKey);

      if (totalPainted === 0) {
        if (overlayMesh) {
          mesh.remove(overlayMesh);
          overlayMesh.geometry.dispose();
          if (Array.isArray(overlayMesh.material)) {
            overlayMesh.material.forEach((m) => m.dispose());
          } else {
            overlayMesh.material.dispose();
          }
          this.overlayMeshes.delete(overlayKey);
        }
        continue;
      }

      const baseGeo = this.geometries.get(objectId);
      if (!baseGeo || !baseGeo.index) continue;

      const indices = baseGeo.index.array;
      const positions = baseGeo.attributes.position.array;

      const overlayGeo = new THREE.BufferGeometry();
      const posArray = new Float32Array(totalPainted * 9);
      const colArray = new Float32Array(totalPainted * 9);

      let vertexOffset = 0;

      // Enforcer: Green #22c55e -> (0.133, 0.773, 0.369)
      const enfR = 0.133, enfG = 0.773, enfB = 0.369;
      // Blocker: Red #ef4444 -> (0.937, 0.267, 0.267)
      const blkR = 0.937, blkG = 0.267, blkB = 0.267;

      const addFacet = (localFacetId: number, r: number, g: number, b: number) => {
        // Validate local index within volume partition
        if (localFacetId < 0 || localFacetId >= partition.facetCount) return;

        // Overlay local IDs offset to corresponding merged indices
        const mergedFacetIndex = partition.firstFacet + localFacetId;
        if (mergedFacetIndex < 0 || mergedFacetIndex * 3 + 2 >= indices.length) return;

        const i0 = indices[mergedFacetIndex * 3];
        const i1 = indices[mergedFacetIndex * 3 + 1];
        const i2 = indices[mergedFacetIndex * 3 + 2];

        // Vertex 0
        posArray[vertexOffset * 3] = positions[i0 * 3];
        posArray[vertexOffset * 3 + 1] = positions[i0 * 3 + 1];
        posArray[vertexOffset * 3 + 2] = positions[i0 * 3 + 2];
        colArray[vertexOffset * 3] = r;
        colArray[vertexOffset * 3 + 1] = g;
        colArray[vertexOffset * 3 + 2] = b;
        vertexOffset++;

        // Vertex 1
        posArray[vertexOffset * 3] = positions[i1 * 3];
        posArray[vertexOffset * 3 + 1] = positions[i1 * 3 + 1];
        posArray[vertexOffset * 3 + 2] = positions[i1 * 3 + 2];
        colArray[vertexOffset * 3] = r;
        colArray[vertexOffset * 3 + 1] = g;
        colArray[vertexOffset * 3 + 2] = b;
        vertexOffset++;

        // Vertex 2
        posArray[vertexOffset * 3] = positions[i2 * 3];
        posArray[vertexOffset * 3 + 1] = positions[i2 * 3 + 1];
        posArray[vertexOffset * 3 + 2] = positions[i2 * 3 + 2];
        colArray[vertexOffset * 3] = r;
        colArray[vertexOffset * 3 + 1] = g;
        colArray[vertexOffset * 3 + 2] = b;
        vertexOffset++;
      };

      for (const f of enforcers) {
        addFacet(f, enfR, enfG, enfB);
      }
      for (const f of blockers) {
        addFacet(f, blkR, blkG, blkB);
      }

      overlayGeo.setAttribute('position', new THREE.BufferAttribute(posArray.subarray(0, vertexOffset * 3), 3));
      overlayGeo.setAttribute('color', new THREE.BufferAttribute(colArray.subarray(0, vertexOffset * 3), 3));
      overlayGeo.computeVertexNormals();

      if (!overlayMesh) {
        const overlayMat = new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: 0.35,
          metalness: 0.1,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -1.0,
          polygonOffsetUnits: -1.0
        });
        overlayMesh = new THREE.Mesh(overlayGeo, overlayMat);
        overlayMesh.raycast = () => {}; // Never intercept raycasting!
        mesh.add(overlayMesh);
        this.overlayMeshes.set(overlayKey, overlayMesh);
      } else {
        overlayMesh.geometry.dispose();
        overlayMesh.geometry = overlayGeo;
      }
    }
  }

  private raycastSelectedMesh(e: PointerEvent): { faceIndex?: number | null } | null {
    const selectedMesh = this.getSelectedMesh();
    if (!selectedMesh) return null;

    const objId = selectedMesh.userData?.objectId;
    if (typeof objId !== 'number') return null;

    // Never assume volume zero; missing metadata must disable painting safely with clear reason
    const partitions = this.meshVolumes.get(objId);
    if (!partitions || partitions.length === 0 || this.paintingVolumeId === null) {
      return null;
    }

    const rect = this.renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, this.camera);

    const intersects = raycaster.intersectObject(selectedMesh, false);
    if (intersects.length > 0 && typeof intersects[0].faceIndex === "number") {
      let mergedFaceIndex = intersects[0].faceIndex;

      // Find partition containing merged faceIndex
      const partition = partitions.find(
        (p) => mergedFaceIndex >= p.firstFacet && mergedFaceIndex < p.firstFacet + p.facetCount
      );

      // Restrict edits strictly to selected volume!
      if (!partition || partition.volumeId !== this.paintingVolumeId) {
        return null;
      }

      // Map raycast faceIndex -> partition -> volume local index
      const localFacetIndex = mergedFaceIndex - partition.firstFacet;
      return { faceIndex: localFacetIndex };
    }
    return null;
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.pointerDownPos = { x: e.clientX, y: e.clientY };

    if (this.isPaintingActive && e.button === 0) {
      const hit = this.raycastSelectedMesh(e);
      if (hit && typeof hit.faceIndex === 'number') {
        this.isPaintingStroke = true;
        this.orbitControls.enabled = false; // Disable orbit during stroke!
        if (this.callbacks.onPaintBegin) {
          this.callbacks.onPaintBegin();
        }
        if (this.callbacks.onPaintFacet) {
          this.callbacks.onPaintFacet(hit.faceIndex);
        }
        e.preventDefault();
      }
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (this.isPaintingActive && this.isPaintingStroke) {
      const hit = this.raycastSelectedMesh(e);
      if (hit && typeof hit.faceIndex === 'number') {
        if (this.callbacks.onPaintFacet) {
          this.callbacks.onPaintFacet(hit.faceIndex);
        }
      }
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (this.isPaintingActive && this.isPaintingStroke) {
      this.isPaintingStroke = false;
      this.orbitControls.enabled = true; // Restore navigation!
      if (this.callbacks.onPaintEnd) {
        this.callbacks.onPaintEnd();
      }
      return;
    }

    // Only raycast for selection if pointer didn't move much (click, not orbit drag)
    const dx = e.clientX - this.pointerDownPos.x;
    const dy = e.clientY - this.pointerDownPos.y;
    if (Math.hypot(dx, dy) > 5) return;

    // Check if clicking inside TransformControls gizmo
    if (this.transformControls.dragging) return;

    if (!this.isPaintingActive) {
      const rect = this.renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );

      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, this.camera);

      const meshes = Array.from(this.objectMeshes.values());
      const intersects = raycaster.intersectObjects(meshes, false);

      if (intersects.length > 0 && typeof intersects[0].faceIndex === "number") {
        const hit = intersects[0].object as THREE.Mesh;
        if (hit.userData) {
          this.callbacks.onSelect(hit.userData.objectId, hit.userData.instanceId);
        }
      } else {
        // Clicked on empty bed: deselect
        this.callbacks.onSelect(null, null);
      }
    }
  };

  private onPointerLeave = (): void => {
    if (this.isPaintingStroke) {
      this.isPaintingStroke = false;
      this.orbitControls.enabled = true;
      if (this.callbacks.onPaintEnd) {
        this.callbacks.onPaintEnd();
      }
    }
  };

  private onWindowResize = (): void => {
    if (!this.container || this.isDestroyed) return;
    const width = this.container.clientWidth || 800;
    const height = this.container.clientHeight || 600;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  };

  private animate = (): void => {
    if (this.isDestroyed) return;
    this.animationFrameId = requestAnimationFrame(this.animate);

    this.orbitControls.update();
    this.renderer.render(this.scene, this.camera);
  };

  public destroy(): void {
    this.isDestroyed = true;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
    }

    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.renderer.domElement.removeEventListener('pointerup', this.onPointerUp);
    this.renderer.domElement.removeEventListener('pointerleave', this.onPointerLeave);
    this.renderer.domElement.removeEventListener('pointercancel', this.onPointerLeave);
    window.removeEventListener('resize', this.onWindowResize);

    this.transformControls.dispose();
    this.orbitControls.dispose();

    for (const overlay of this.overlayMeshes.values()) {
      overlay.geometry.dispose();
      if (Array.isArray(overlay.material)) overlay.material.forEach((m) => m.dispose());
      else overlay.material.dispose();
    }
    this.overlayMeshes.clear();

    for (const geo of this.geometries.values()) {
      geo.dispose();
    }
    this.geometries.clear();
    this.meshVolumes.clear();

    this.defaultMaterial.dispose();
    this.selectedMaterial.dispose();
    this.renderer.dispose();

    if (this.renderer.domElement.parentElement) {
      this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
    }
  }
}
