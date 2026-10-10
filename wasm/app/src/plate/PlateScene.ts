import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { plateTitle } from '../plates/plateName';
import type { PlateObject, BedConfig, GizmoMode, MeshBufferData, MeshVolumePartition } from './types';
import type { SupportPaintingData } from '../painting/types';
import { renderPaintOverlay, clearPaintOverlay } from '../paint-tools/overlayRenderer';
import type { ParsedPaintOverlay, PaintLayer } from '../paint-tools/types';
import type { PaintTool } from '../paint-tools/types';
import { createPaintCursor, type PaintCursor } from '../paint-tools/paintCursor';
import { usePrefsStore } from '../prefs/prefsStore';
import type { CameraView } from '../shell/cameraBridge';

export interface PlateSceneCallbacks {
  onSelect: (objectId: number | null, instanceId: number | null, additive?: boolean) => void;
  /** The whole selection moved together: absolute transforms of the primary and every other selected instance. */
  onTransformMany?: (
    entries: { objectId: number; instanceId: number; offset: [number, number, number]; rotation: [number, number, number]; scale: [number, number, number] }[]
  ) => void;
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
  onToolPaintBegin?: (hit: [number, number, number], facet: number, button: number, erase: boolean, cameraPos: [number, number, number]) => void;
  onToolPaintPoint?: (hit: [number, number, number], facet: number) => void;
  onToolPaintEnd?: () => void;
  onFlattenFacetClick?: (facetIndex: number) => void;
  onBrimEarClick?: (position: [number, number, number], clickedEarIndex?: number) => void;
}

export class PlateScene {
  private container: HTMLElement;
  private scene: THREE.Scene;
  public perspectiveCamera: THREE.PerspectiveCamera;
  public orthographicCamera: THREE.OrthographicCamera;
  public camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  public renderer: THREE.WebGLRenderer;
  private orbitControls: OrbitControls;
  private transformControls: TransformControls;

  private bedGroup: THREE.Group;
  private objectsGroup: THREE.Group;
  private bedGridHelper: THREE.GridHelper | null = null;
  private axesHelper: THREE.AxesHelper | null = null;
  private buildVolumeHelper: THREE.LineSegments | null = null;
  private labelsGroup: THREE.Group;
  public plateLabelGroup = new THREE.Group();
  /** Every plate lies beside the others; the first is the main bed (buildBed), the rest are drawn plainly here. */
  public extraBedsGroup = new THREE.Group();
  private plates: { index: number; name: string; origin: [number, number, number] }[] = [{ index: 0, name: '', origin: [0, 0, 0] }];
  private activePlateIndex = 0;
  private labelSprites: Map<string, THREE.Sprite> = new Map();

  private flattenClusters: Array<{ normal: [number, number, number]; center: [number, number, number]; area: number; outline: Array<[number, number, number]> }> = [];
  private flattenGroup: THREE.Group;
  private brimEarsGroup: THREE.Group;
  private brimEarsActive = false;

  private objectMeshes: Map<string, THREE.Mesh> = new Map();
  private overlayMeshes: Map<string, THREE.Mesh> = new Map();
  private geometries: Map<number, THREE.BufferGeometry> = new Map();
  private meshVolumes: Map<number, MeshVolumePartition[]> = new Map();

  private selectedObjectId: number | null = null;
  /** `objectId_instanceId` of the other selected instances; they follow the primary while it is dragged. */
  private extraKeys = new Set<string>();
  private dragStart: { primary: THREE.Vector3; extras: Map<THREE.Mesh, THREE.Vector3> } | null = null;
  private selectedInstanceId: number | null = null;
  private gizmoMode: GizmoMode = 'translate';
  private bedConfig: BedConfig;
  private callbacks: PlateSceneCallbacks;

  public bedFloorMaterial: THREE.MeshBasicMaterial | null = null;
  public brimEarPoints: Array<{ position: [number, number, number]; radius: number }> = [];
  private isPaintingActive = false;
  private paintingVolumeId: number | null = null;
  private isPaintingStroke = false;
  private advancedPainting = false;
  private paintCursor: PaintCursor;
  private cursorRadius = 1;
  private cursorTool: PaintTool = 'circle';
  private pointerDownPos = { x: 0, y: 0 };
  private isDestroyed = false;
  private animationFrameId: number | null = null;

  // Materials
  private defaultMaterial: THREE.MeshLambertMaterial;
  private selectedMaterial: THREE.MeshLambertMaterial;

  // Scene view & camera preferences
  public showGrid = true;
  public showAxes = true;
  public showLabels = false;
  public showBuildVolume = true;
  public showWireframe = false;
  public cameraType: 'perspective' | 'orthographic' = 'perspective';
  public invertMouseWheelZoom = false;
  public invertOrbitHorizontal = false;
  public invertOrbitVertical = false;
  public rotateSensitivity = 1.0;
  public zoomSpeed = 1.0;

  private unsubscribePrefs: (() => void) | null = null;

  constructor(container: HTMLElement, bedConfig: BedConfig, callbacks: PlateSceneCallbacks) {
    this.container = container;
    this.bedConfig = bedConfig;
    this.callbacks = callbacks;

    // Load initial preferences
    const prefs = usePrefsStore.getState();
    this.showGrid = prefs.display.showGrid;
    this.showAxes = prefs.display.showAxes;
    this.showLabels = prefs.display.showLabels;
    this.showBuildVolume = prefs.display.showBuildVolume;
    this.showWireframe = prefs.display.showWireframe;
    this.cameraType = prefs.display.cameraType || prefs.camera.defaultCameraType || 'perspective';
    this.invertMouseWheelZoom = prefs.camera.invertMouseWheelZoom;
    this.invertOrbitHorizontal = prefs.camera.invertOrbitHorizontal;
    this.invertOrbitVertical = prefs.camera.invertOrbitVertical;
    this.rotateSensitivity = prefs.camera.rotateSensitivity;
    this.zoomSpeed = prefs.camera.zoomSpeed;

    // 1. Scene setup
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1e1e24);
    this.paintCursor = createPaintCursor(this.scene);

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 600;
    const aspect = width / height;

    // 2. Camera setup: Z is UP (matching Slic3r world coordinates)
    const cx = bedConfig.center[0];
    const cy = bedConfig.center[1];
    const span = Math.max(bedConfig.width, bedConfig.depth);

    this.perspectiveCamera = new THREE.PerspectiveCamera(45, aspect, 1, 5000);
    this.perspectiveCamera.up.set(0, 0, 1);
    this.perspectiveCamera.position.set(cx, cy - span * 1.5, span * 1.2);
    this.perspectiveCamera.lookAt(cx, cy, 0);

    const d = this.perspectiveCamera.position.distanceTo(new THREE.Vector3(cx, cy, 0));
    const halfHeight = d * Math.tan(THREE.MathUtils.degToRad(45 / 2));
    const halfWidth = halfHeight * aspect;

    this.orthographicCamera = new THREE.OrthographicCamera(-halfWidth, halfWidth, halfHeight, -halfHeight, 1, 5000);
    this.orthographicCamera.up.set(0, 0, 1);
    this.orthographicCamera.position.copy(this.perspectiveCamera.position);
    this.orthographicCamera.lookAt(cx, cy, 0);

    this.camera = this.cameraType === 'orthographic' ? this.orthographicCamera : this.perspectiveCamera;

    // 3. Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.domElement.style.display = 'block';
    container.appendChild(this.renderer.domElement);

    // 4. OrbitControls: left rotate, right/middle pan, wheel zoom (matching desktop GLCanvas3D)
    this.orbitControls = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbitControls.target.set(cx, cy, 0);
    this.orbitControls.enableDamping = true;
    this.orbitControls.dampingFactor = 0.1;
    this.orbitControls.zoomSpeed = this.zoomSpeed;
    this.orbitControls.rotateSpeed = this.rotateSensitivity;
    this.orbitControls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.PAN
    };

    // OrbitControls customizations for mouse wheel zoom inversion and orbit axis inversion
    const origHandleMouseWheel = (this.orbitControls as any)._handleMouseWheel.bind(this.orbitControls);
    (this.orbitControls as any)._handleMouseWheel = (event: any) => {
      if (this.invertMouseWheelZoom) {
        const invertedEvent = {
          ...event,
          deltaY: -event.deltaY,
          clientX: event.clientX,
          clientY: event.clientY
        };
        origHandleMouseWheel(invertedEvent);
      } else {
        origHandleMouseWheel(event);
      }
    };

    const origRotate = (this.orbitControls as any)._handleMouseMoveRotate.bind(this.orbitControls);
    (this.orbitControls as any)._handleMouseMoveRotate = (event: any) => {
      if (!this.invertOrbitHorizontal && !this.invertOrbitVertical) {
        origRotate(event);
        return;
      }
      const ctrl = this.orbitControls as any;
      ctrl._rotateEnd.set(event.clientX, event.clientY);
      ctrl._rotateDelta.subVectors(ctrl._rotateEnd, ctrl._rotateStart).multiplyScalar(ctrl.rotateSpeed);
      const element = ctrl.domElement;
      const factorX = this.invertOrbitHorizontal ? -1 : 1;
      const factorY = this.invertOrbitVertical ? -1 : 1;
      ctrl._rotateLeft((factorX * 2 * Math.PI * ctrl._rotateDelta.x) / element.clientHeight);
      ctrl._rotateUp((factorY * 2 * Math.PI * ctrl._rotateDelta.y) / element.clientHeight);
      ctrl._rotateStart.copy(ctrl._rotateEnd);
      ctrl.update();
    };

    this.orbitControls.update();

    // 5. TransformControls
    this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
    this.transformControls.setMode(this.gizmoMode);
    this.scene.add(this.transformControls.getHelper());

    this.transformControls.addEventListener('objectChange', () => {
      const target = this.transformControls.object;
      if (!target || !this.dragStart) return;
      const delta = target.position.clone().sub(this.dragStart.primary);
      for (const [mesh, origin] of this.dragStart.extras) mesh.position.copy(origin).add(delta);
    });

    this.transformControls.addEventListener('dragging-changed', (event) => {
      this.orbitControls.enabled = !event.value;
      if (event.value) {
        const target = this.transformControls.object;
        const extras = new Map<THREE.Mesh, THREE.Vector3>();
        if (target) for (const mesh of this.objectMeshes.values()) if (this.extraKeys.has(`${mesh.userData.objectId}_${mesh.userData.instanceId}`)) extras.set(mesh, mesh.position.clone());
        this.dragStart = target ? { primary: target.position.clone(), extras } : null;
      }
      if (!event.value) {
        const target = this.transformControls.object;
        const drag = this.dragStart;
        this.dragStart = null;
        if (target && drag && drag.extras.size > 0 && this.callbacks.onTransformMany) {
          const entry = (m: THREE.Object3D) => ({
            objectId: m.userData.objectId as number, instanceId: m.userData.instanceId as number,
            offset: [m.position.x, m.position.y, m.position.z] as [number, number, number],
            rotation: [m.rotation.x, m.rotation.y, m.rotation.z] as [number, number, number],
            scale: [m.scale.x, m.scale.y, m.scale.z] as [number, number, number]
          });
          this.callbacks.onTransformMany([entry(target), ...[...drag.extras.keys()].map(entry)]);
        } else if (target && target.userData) {
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
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
    this.scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 2.6);
    dirLight1.position.set(cx + 150, cy - 250, 350);
    this.scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0xa5c4d4, 0.9);
    dirLight2.position.set(cx - 200, cy + 200, 200);
    this.scene.add(dirLight2);

    // 7. Groups
    this.bedGroup = new THREE.Group();
    this.objectsGroup = new THREE.Group();
    this.flattenGroup = new THREE.Group();
    this.brimEarsGroup = new THREE.Group();
    this.labelsGroup = new THREE.Group();
    this.labelsGroup.visible = this.showLabels;

    this.scene.add(this.bedGroup);
    this.scene.add(this.objectsGroup);
    this.scene.add(this.flattenGroup);
    this.scene.add(this.brimEarsGroup);
    this.scene.add(this.labelsGroup);
    this.scene.add(this.plateLabelGroup);
    this.scene.add(this.extraBedsGroup);
    this.rebuildPlates();

    // 8. Materials
    // Matte and flat-shaded like desktop: no reflections, and every facet keeps its own brightness so edges read.
    this.defaultMaterial = new THREE.MeshLambertMaterial({
      color: 0x3b82f6,
      flatShading: true,
      wireframe: this.showWireframe
    });

    this.selectedMaterial = new THREE.MeshLambertMaterial({
      color: 0x10b981,
      emissive: 0x064e3b,
      emissiveIntensity: 0.35,
      flatShading: true,
      wireframe: this.showWireframe
    });

    // Build bed
    this.buildBed();

    // Subscribe to preferences store changes
    this.unsubscribePrefs = usePrefsStore.subscribe((state, prevState) => {
      if (state.display.showGrid !== prevState.display.showGrid) {
        this.setShowGrid(state.display.showGrid);
      }
      if (state.display.showAxes !== prevState.display.showAxes) {
        this.setShowAxes(state.display.showAxes);
      }
      if (state.display.showLabels !== prevState.display.showLabels) {
        this.setShowLabels(state.display.showLabels);
      }
      if (state.display.showBuildVolume !== prevState.display.showBuildVolume) {
        this.setShowBuildVolume(state.display.showBuildVolume);
      }
      if (state.display.showWireframe !== prevState.display.showWireframe) {
        this.setShowWireframe(state.display.showWireframe);
      }
      if (state.display.cameraType !== prevState.display.cameraType) {
        this.setCameraType(state.display.cameraType);
      }
      if (state.camera.invertMouseWheelZoom !== prevState.camera.invertMouseWheelZoom) {
        this.invertMouseWheelZoom = state.camera.invertMouseWheelZoom;
      }
      if (state.camera.invertOrbitHorizontal !== prevState.camera.invertOrbitHorizontal) {
        this.invertOrbitHorizontal = state.camera.invertOrbitHorizontal;
      }
      if (state.camera.invertOrbitVertical !== prevState.camera.invertOrbitVertical) {
        this.invertOrbitVertical = state.camera.invertOrbitVertical;
      }
      if (state.camera.rotateSensitivity !== prevState.camera.rotateSensitivity) {
        this.rotateSensitivity = state.camera.rotateSensitivity;
        this.orbitControls.rotateSpeed = this.rotateSensitivity;
      }
      if (state.camera.zoomSpeed !== prevState.camera.zoomSpeed) {
        this.zoomSpeed = state.camera.zoomSpeed;
        this.orbitControls.zoomSpeed = this.zoomSpeed;
      }
    });

    // Event listeners
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.addEventListener('pointermove', this.onPointerMove);
    this.renderer.domElement.addEventListener('pointerup', this.onPointerUp);
    this.renderer.domElement.addEventListener('pointerleave', this.onPointerLeave);
    this.renderer.domElement.addEventListener('pointercancel', this.onPointerLeave);
    this.renderer.domElement.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('resize', this.onWindowResize);

    // Start render loop
    this.animate();
  }

  private buildBed(): void {
    // Clear existing bed
    while (this.bedGroup.children.length > 0) {
      const child = this.bedGroup.children[0] as THREE.Mesh;
      if (child.geometry) child.geometry.dispose();
      this.bedGroup.remove(child);
    }
    this.bedGridHelper = null;
    this.axesHelper = null;
    this.buildVolumeHelper = null;

    const { width, depth, height, center } = this.bedConfig;
    const shape = (this.bedConfig as any).shape;
    const cx = center[0];
    const cy = center[1];

    let floorGeo: THREE.BufferGeometry;
    let points: Array<[number, number]> = [];

    if (shape === 'circle') {
      const radius = width / 2;
      floorGeo = new THREE.CircleGeometry(radius, 64);
      for (let i = 0; i < 64; i++) {
        const theta = (i / 64) * Math.PI * 2;
        points.push([cx + radius * Math.cos(theta), cy + radius * Math.sin(theta)]);
      }
    } else {
      floorGeo = new THREE.PlaneGeometry(width, depth);
      const halfW = width / 2;
      const halfD = depth / 2;
      points = [
        [cx - halfW, cy - halfD],
        [cx + halfW, cy - halfD],
        [cx + halfW, cy + halfD],
        [cx - halfW, cy + halfD]
      ];
    }

    // 1. Bed Floor Mesh (slightly below Z=0 to prevent z-fighting with models)
    const floorMat = new THREE.MeshBasicMaterial({
      color: 0x24242b,
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false
    });
    this.bedFloorMaterial = floorMat;
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.position.set(cx, cy, -0.1);
    this.bedGroup.add(floorMesh);

    // 2. Bed Grid (in XY plane at Z=0)
    const gridSize = Math.max(width, depth);
    const gridDivisions = Math.round(gridSize / 10);
    const grid = new THREE.GridHelper(gridSize, gridDivisions, 0x475569, 0x334155);
    grid.rotation.x = Math.PI / 2;
    grid.position.set(cx, cy, 0);
    grid.visible = this.showGrid;
    this.bedGridHelper = grid;
    this.bedGroup.add(grid);

    // 3. Bed boundary outline
    if (points.length >= 3) {
      const outlinePoints: THREE.Vector3[] = points.map(([x, y]) => new THREE.Vector3(x, y, 0.2));
      outlinePoints.push(outlinePoints[0].clone());
      const outlineGeo = new THREE.BufferGeometry().setFromPoints(outlinePoints);
      const outlineMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, linewidth: 2 });
      const outlineLine = new THREE.Line(outlineGeo, outlineMat);
      this.bedGroup.add(outlineLine);
    }

    // 4. Origin Axes Helper (Red=X, Green=Y, Blue=Z)
    const axesHelper = new THREE.AxesHelper(40);
    axesHelper.position.set(0, 0, 0.5);
    axesHelper.visible = this.showAxes;
    this.axesHelper = axesHelper;
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
    boxLines.visible = this.showBuildVolume;
    this.buildVolumeHelper = boxLines;
    this.bedGroup.add(boxLines);
  }

  public setShowGrid(visible: boolean): void {
    this.showGrid = visible;
    if (this.bedGridHelper) {
      this.bedGridHelper.visible = visible;
    }
  }
  public getShowGrid(): boolean {
    return this.showGrid;
  }

  public setShowAxes(visible: boolean): void {
    this.showAxes = visible;
    if (this.axesHelper) {
      this.axesHelper.visible = visible;
    }
  }
  public getShowAxes(): boolean {
    return this.showAxes;
  }

  /** All plates with their origin: each gets a bed, its number (printed large in the front-left corner, like desktop) and its custom title. */
  public setPlates(plates: { index: number; name: string; origin: [number, number, number] }[], activeIndex: number): void {
    this.plates = plates.length > 0 ? plates : this.plates;
    this.activePlateIndex = activeIndex;
    this.rebuildPlates();
  }

  /** Moves the view to the given plate, keeping the viewing direction and distance. */
  /** The plate whose bed lies under the given client position, or null when the click is off every bed. */
  public plateAt(clientX: number, clientY: number): number | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1), this.camera);
    const hit = raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), new THREE.Vector3());
    if (!hit) return null;
    const { width, depth, center } = this.bedConfig;
    const plate = this.plates.find((p) => Math.abs(hit.x - (p.origin[0] + center[0])) <= width / 2 && Math.abs(hit.y - (p.origin[1] + center[1])) <= depth / 2);
    return plate ? plate.index : null;
  }

  /** The middle of a plate's bed in world space (test hook for projecting it to the screen). */
  public bedConfigCenterWorld(origin: [number, number, number]): THREE.Vector3 {
    return new THREE.Vector3(origin[0] + this.bedConfig.center[0], origin[1] + this.bedConfig.center[1], origin[2]);
  }

  /** The plate whose title lies under the given client position (to start renaming it), or null. */
  public titleAt(clientX: number, clientY: number): { index: number; x: number; y: number } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1), this.camera);
    const hit = raycaster.intersectObjects(this.plateLabelGroup.children.filter((c) => c.name === 'plate-title'), false)[0];
    if (!hit) return null;
    const corner = new THREE.Vector3(hit.object.position.x - (hit.object as THREE.Mesh<THREE.PlaneGeometry>).geometry.parameters.width / 2, hit.object.position.y, hit.object.position.z).project(this.camera);
    return { index: hit.object.userData.plateIndex, x: rect.left + ((corner.x + 1) / 2) * rect.width, y: rect.top + ((1 - corner.y) / 2) * rect.height };
  }

  public focusPlate(index: number): void {
    const plate = this.plates.find((p) => p.index === index);
    if (!plate) return;
    const [cx, cy] = this.bedConfig.center;
    const target = new THREE.Vector3(plate.origin[0] + cx, plate.origin[1] + cy, this.orbitControls.target.z);
    const delta = target.clone().sub(this.orbitControls.target);
    this.camera.position.add(delta);
    this.perspectiveCamera.position.add(delta);
    this.orthographicCamera.position.add(delta);
    this.orbitControls.target.copy(target);
    this.orbitControls.update();
  }

  private disposeChildren(group: THREE.Group): void {
    for (const child of [...group.children] as THREE.Mesh[]) {
      group.remove(child);
      child.geometry?.dispose();
      const material = child.material as THREE.Material | THREE.Material[] | undefined;
      for (const m of Array.isArray(material) ? material : material ? [material] : []) {
        if (m !== this.bedFloorMaterial) {
          (m as THREE.MeshBasicMaterial).map?.dispose();
          m.dispose();
        }
      }
    }
  }

  private rebuildPlates(): void {
    this.disposeChildren(this.plateLabelGroup);
    this.disposeChildren(this.extraBedsGroup);
    const { width, depth, center, points } = this.bedConfig;
    const [cx, cy] = center;
    const size = Math.min(width, depth);

    // Flat text lying on the ground plane; `pencil` adds the small edit mark desktop shows after a plate's title.
    const text = (value: string, font: string, height: number, color: string, align: 'left' | 'right', x: number, y: number, pencil = false) => {
      const px = parseInt(font.match(/(\d+)px/)![1], 10);
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;
      ctx.font = font;
      const textWidth = Math.ceil(ctx.measureText(value).width);
      const pencilWidth = pencil ? Math.round(px * 1.4) : 0;
      canvas.width = textWidth + pencilWidth + 16;
      canvas.height = Math.round(px * 1.4);
      ctx.font = font;
      ctx.fillStyle = color;
      ctx.strokeStyle = color;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillText(value, 8, canvas.height / 2);
      if (pencil) {
        // The "edit" icon (a square with a pen), drawn from its 24x24 SVG paths.
        const iconSize = px * 0.95;
        ctx.save();
        ctx.translate(8 + textWidth + px * 0.3, (canvas.height - iconSize) / 2);
        ctx.scale(iconSize / 24, iconSize / 24);
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke(new Path2D('M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7'));
        ctx.stroke(new Path2D('M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z'));
        ctx.restore();
      }
      const planeWidth = height * (canvas.width / canvas.height);
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(planeWidth, height),
        new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false, side: THREE.DoubleSide })
      );
      mesh.position.set(align === 'left' ? x + planeWidth / 2 : x - planeWidth / 2, y, 0.05);
      mesh.name = 'plate-label';
      return mesh;
    };

    const orange = (active: boolean) => (active ? '#ff7a45' : 'rgba(255, 122, 69, 0.6)');
    for (const plate of this.plates) {
      const [ox, oy, oz] = plate.origin;
      const active = plate.index === this.activePlateIndex;
      // Like desktop: the two-digit number below the bed's front-right corner, the title above its back-left corner.
      const number = text(String(plate.index + 1).padStart(2, '0'), 'bold 96px sans-serif', size * 0.1, orange(active), 'right', ox + cx + width / 2, oy + cy - depth / 2 - size * 0.07);
      number.position.z = oz + 0.05;
      this.plateLabelGroup.add(number);
      const title = plateTitle(plate.name, plate.index);
      const shown = title.length > 40 ? `${title.slice(0, 38)}...` : title;
      const label = text(shown, 'bold 64px sans-serif', size * 0.075, orange(active), 'left', ox + cx - width / 2, oy + cy + depth / 2 + size * 0.06, true);
      label.name = 'plate-title';
      label.userData.plateIndex = plate.index;
      label.position.z = oz + 0.05;
      this.plateLabelGroup.add(label);

      if (plate.index === 0) continue; // the main bed has its own, richer drawing
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), this.bedFloorMaterial ?? new THREE.MeshBasicMaterial({ color: 0x24242b, side: THREE.DoubleSide }));
      floor.position.set(ox + cx, oy + cy, oz - 0.1);
      this.extraBedsGroup.add(floor);
      const gridSize = Math.max(width, depth);
      const grid = new THREE.GridHelper(gridSize, Math.round(gridSize / 10), 0x475569, 0x334155);
      grid.rotation.x = Math.PI / 2;
      grid.position.set(ox + cx, oy + cy, oz);
      this.extraBedsGroup.add(grid);
      const outline: THREE.Vector3[] = (points.length >= 3 ? points : [[cx - width / 2, cy - depth / 2], [cx + width / 2, cy - depth / 2], [cx + width / 2, cy + depth / 2], [cx - width / 2, cy + depth / 2]])
        .map(([x, y]) => new THREE.Vector3(ox + x, oy + y, oz + 0.2));
      outline.push(outline[0].clone());
      this.extraBedsGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(outline), new THREE.LineBasicMaterial({ color: active ? 0x38bdf8 : 0x475569 })));
    }
  }

  public setShowLabels(visible: boolean): void {
    this.showLabels = visible;
    this.labelsGroup.visible = visible;
    if (visible) {
      this.updateLabels();
    }
  }
  public getShowLabels(): boolean {
    return this.showLabels;
  }

  public setShowBuildVolume(visible: boolean): void {
    this.showBuildVolume = visible;
    if (this.buildVolumeHelper) {
      this.buildVolumeHelper.visible = visible;
    }
  }
  public getShowBuildVolume(): boolean {
    return this.showBuildVolume;
  }

  public setShowWireframe(visible: boolean): void {
    this.showWireframe = visible;
    this.defaultMaterial.wireframe = visible;
    this.selectedMaterial.wireframe = visible;
    this.defaultMaterial.needsUpdate = true;
    this.selectedMaterial.needsUpdate = true;
  }
  public getShowWireframe(): boolean {
    return this.showWireframe;
  }

  public setCameraType(type: 'perspective' | 'orthographic'): void {
    if (
      this.cameraType === type &&
      ((type === 'perspective' && this.camera === this.perspectiveCamera) ||
        (type === 'orthographic' && this.camera === this.orthographicCamera))
    ) {
      return;
    }
    this.cameraType = type;
    const target = this.orbitControls.target.clone();
    const width = this.container.clientWidth || 800;
    const height = this.container.clientHeight || 600;
    const aspect = width / height;

    if (type === 'orthographic') {
      const d = this.perspectiveCamera.position.distanceTo(target);
      const halfHeight = Math.max(10, d * Math.tan(THREE.MathUtils.degToRad(this.perspectiveCamera.fov / 2)));
      const halfWidth = halfHeight * aspect;
      this.orthographicCamera.left = -halfWidth;
      this.orthographicCamera.right = halfWidth;
      this.orthographicCamera.top = halfHeight;
      this.orthographicCamera.bottom = -halfHeight;
      this.orthographicCamera.zoom = 1;
      this.orthographicCamera.position.copy(this.perspectiveCamera.position);
      this.orthographicCamera.quaternion.copy(this.perspectiveCamera.quaternion);
      this.orthographicCamera.updateProjectionMatrix();
      this.camera = this.orthographicCamera;
    } else {
      this.perspectiveCamera.aspect = aspect;
      this.perspectiveCamera.position.copy(this.orthographicCamera.position);
      this.perspectiveCamera.quaternion.copy(this.orthographicCamera.quaternion);
      this.perspectiveCamera.updateProjectionMatrix();
      this.camera = this.perspectiveCamera;
    }

    this.orbitControls.object = this.camera;
    (this.transformControls as any).camera = this.camera;
    this.orbitControls.update();
  }

  public getCameraType(): 'perspective' | 'orthographic' {
    return this.cameraType;
  }

  public toggleCameraType(): void {
    const next = this.cameraType === 'perspective' ? 'orthographic' : 'perspective';
    this.setCameraType(next);
    usePrefsStore.getState().setDisplayPref('cameraType', next);
  }

  /** Centre and longest side of the area all plates cover together; one plate gives the bed itself. */
  private plateLayout(): { cx: number; cy: number; span: number } {
    const { width, depth, center } = this.bedConfig;
    let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const { origin } of this.plates) {
      minX = Math.min(minX, origin[0] + center[0] - width / 2);
      maxX = Math.max(maxX, origin[0] + center[0] + width / 2);
      minY = Math.min(minY, origin[1] + center[1] - depth / 2);
      maxY = Math.max(maxY, origin[1] + center[1] + depth / 2);
    }
    return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, span: Math.max(maxX - minX, maxY - minY) };
  }

  public zoomToBed(): void {
    const { cx, cy, span } = this.plateLayout();
    this.orbitControls.target.set(cx, cy, 0);
    this.camera.position.set(cx, cy - span * 1.5, span * 1.2);
    this.orbitControls.update();
  }

  private createLabelSprite(text: string): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = 'rgba(24, 24, 27, 0.85)';
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(8, 8, 240, 48, 8);
      } else {
        ctx.rect(8, 8, 240, 48);
      }
      ctx.fill();
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.font = 'bold 20px sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const labelText = text.length > 20 ? text.slice(0, 18) + '...' : text;
      ctx.fillText(labelText, 128, 32);
    }
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(30, 8, 1);
    return sprite;
  }

  private updateLabels(): void {
    const activeKeys = new Set<string>();
    for (const [key, mesh] of this.objectMeshes.entries()) {
      activeKeys.add(key);
      let sprite = this.labelSprites.get(key);
      const name = mesh.userData?.name || 'Object';
      if (sprite && sprite.userData.name !== name) {
        this.labelsGroup.remove(sprite);
        sprite.material.map?.dispose();
        sprite.material.dispose();
        sprite = undefined;
      }
      if (!sprite) {
        sprite = this.createLabelSprite(name);
        sprite.userData.name = name;
        this.labelsGroup.add(sprite);
        this.labelSprites.set(key, sprite);
      }
      const box = new THREE.Box3().setFromObject(mesh);
      const center = new THREE.Vector3();
      box.getCenter(center);
      sprite.position.set(center.x, center.y, box.max.z + 10);
    }
    for (const [key, sprite] of Array.from(this.labelSprites.entries())) {
      if (!activeKeys.has(key)) {
        this.labelsGroup.remove(sprite);
        if (sprite.material.map) sprite.material.map.dispose();
        sprite.material.dispose();
        this.labelSprites.delete(key);
      }
    }
  }

  public updateBedConfig(bedConfig: BedConfig): void {
    this.bedConfig = bedConfig;
    this.buildBed();
    this.rebuildPlates();
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
        const isPrimary = this.selectedObjectId === obj.id && this.selectedInstanceId === inst.id;
        const isSelected = isPrimary || this.extraKeys.has(key);

        if (!mesh) {
          mesh = new THREE.Mesh(geo, isSelected ? this.selectedMaterial : this.defaultMaterial);
          mesh.userData = { objectId: obj.id, instanceId: inst.id, name: obj.name };
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          this.objectsGroup.add(mesh);
          this.objectMeshes.set(key, mesh);
        } else {
          mesh.geometry = geo;
          mesh.userData = { ...mesh.userData, name: obj.name };
          mesh.material = isSelected ? this.selectedMaterial : this.defaultMaterial;
        }

        // Apply instance transforms from Engine
        mesh.position.set(inst.offset[0], inst.offset[1], inst.offset[2]);
        mesh.rotation.set(inst.rotation[0], inst.rotation[1], inst.rotation[2]);
        mesh.scale.set(inst.scale[0], inst.scale[1], inst.scale[2]);

        if (isPrimary && !this.isPaintingActive) {
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

    this.updateLabels();
  }

  public setSelection(objectId: number | null, instanceId: number | null, extras: { objectId: number; instanceId: number }[] = []): void {
    this.selectedObjectId = objectId;
    this.selectedInstanceId = instanceId;
    this.extraKeys = new Set(extras.map((e) => `${e.objectId}_${e.instanceId}`));

    let selectedMesh: THREE.Mesh | null = null;
    for (const mesh of this.objectMeshes.values()) {
      const isSelected =
        objectId !== null &&
        instanceId !== null &&
        mesh.userData.objectId === objectId &&
        mesh.userData.instanceId === instanceId;

      mesh.material = isSelected || this.extraKeys.has(`${mesh.userData.objectId}_${mesh.userData.instanceId}`) ? this.selectedMaterial : this.defaultMaterial;
      if (isSelected) {
        selectedMesh = mesh;
      }
    }

    // The other selected instances only follow a move, so rotating or scaling is for a single selection.
    if (selectedMesh && !this.isPaintingActive && (this.extraKeys.size === 0 || this.gizmoMode === 'translate')) {
      this.transformControls.attach(selectedMesh);
    } else {
      this.transformControls.detach();
    }
  }

  public setGizmoMode(mode: GizmoMode): void {
    this.gizmoMode = mode;
    this.transformControls.setMode(mode);
    if (this.extraKeys.size > 0) {
      const selected = this.getSelectedMesh();
      if (mode === 'translate' && selected && !this.isPaintingActive) this.transformControls.attach(selected);
      else this.transformControls.detach();
    }
  }

  public setPaintingActive(active: boolean, volumeId?: number | null): void {
    this.isPaintingActive = active;
    this.paintingVolumeId = active ? (volumeId ?? null) : null;
    if (active) {
      this.transformControls.detach();
    } else {
      const selectedMesh = this.getSelectedMesh();
      if (selectedMesh) {
        this.transformControls.attach(selectedMesh);
      }
    }
  }

  public setAdvancedPainting(active: boolean, volumeId?: number | null): void {
    this.advancedPainting = active;
    this.setPaintingActive(active, volumeId);
    if (!active) this.paintCursor.setVisible(false);
  }

  public setPaintCursor(radius: number, tool: PaintTool): void {
    this.cursorRadius = radius;
    this.cursorTool = tool;
  }

  /** True when an object lies under the given client position, so a right-click there is not on empty plate. */
  public isObjectAt(clientX: number, clientY: number): boolean {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, this.camera);
    return raycaster.intersectObjects(Array.from(this.objectMeshes.values()), false).length > 0;
  }

  public getObjectMeshes(): Map<string, THREE.Mesh> {
    return this.objectMeshes;
  }

  public updateToolOverlay(objectId: number, overlay: ParsedPaintOverlay | null, layer: PaintLayer, colors: string[]): void {
    for (const mesh of this.objectMeshes.values()) {
      if (mesh.userData.objectId === objectId) renderPaintOverlay(mesh, overlay, layer, colors);
    }
  }

  public clearToolOverlays(): void {
    for (const mesh of this.objectMeshes.values()) clearPaintOverlay(mesh);
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

  public showFlattenClusters(clusters: Array<{ normal: [number, number, number]; center: [number, number, number]; area: number; outline: Array<[number, number, number]> }>): void {
    this.clearFlattenClusters();
    this.flattenClusters = clusters;
    const mesh = this.getSelectedMesh();
    if (!mesh) return;

    for (let i = 0; i < clusters.length; i++) {
      const c = clusters[i];
      if (c.outline && c.outline.length >= 3) {
        const pts: THREE.Vector3[] = [];
        const norm = new THREE.Vector3(...c.normal).normalize().applyQuaternion(mesh.quaternion);
        for (const pt of c.outline) {
          const v = new THREE.Vector3(pt[0], pt[1], pt[2]);
          v.applyMatrix4(mesh.matrixWorld);
          v.addScaledVector(norm, 0.2);
          pts.push(v);
        }
        pts.push(pts[0].clone());
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const mat = new THREE.LineBasicMaterial({ color: 0x00e676, linewidth: 2 });
        const line = new THREE.Line(geo, mat);
        line.userData = { clusterIndex: i };
        this.flattenGroup.add(line);
      }
    }
  }

  public clearFlattenClusters(): void {
    while (this.flattenGroup.children.length > 0) {
      const child = this.flattenGroup.children[0] as THREE.Line;
      child.geometry.dispose();
      if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
      else child.material.dispose();
      this.flattenGroup.remove(child);
    }
    this.flattenClusters = [];
  }

  public setBrimEarsActive(active: boolean): void {
    this.brimEarsActive = active;
  }

  public showBrimEars(points: Array<{ position: [number, number, number]; radius: number }>): void {
    this.clearBrimEarsOverlay();
    this.brimEarPoints = points;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const geo = new THREE.CircleGeometry(p.radius, 32);
      const mat = new THREE.MeshBasicMaterial({ color: 0x00bcd4, transparent: true, opacity: 0.6, side: THREE.DoubleSide });
      const disc = new THREE.Mesh(geo, mat);
      disc.position.set(p.position[0], p.position[1], 0.2);
      disc.userData = { brimEarIndex: i };
      this.brimEarsGroup.add(disc);

      const edgeGeo = new THREE.RingGeometry(Math.max(0.1, p.radius - 0.4), p.radius, 32);
      const edgeMat = new THREE.MeshBasicMaterial({ color: 0x00838f, side: THREE.DoubleSide });
      const ring = new THREE.Mesh(edgeGeo, edgeMat);
      ring.position.set(p.position[0], p.position[1], 0.25);
      ring.userData = { brimEarIndex: i };
      this.brimEarsGroup.add(ring);
    }
  }

  public clearBrimEarsOverlay(): void {
    while (this.brimEarsGroup.children.length > 0) {
      const child = this.brimEarsGroup.children[0] as THREE.Mesh;
      child.geometry.dispose();
      if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
      else child.material.dispose();
      this.brimEarsGroup.remove(child);
    }
    this.brimEarPoints = [];
  }

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

    if (!partitions || partitions.length === 0 || volId === null || volId === undefined) {
      return;
    }

    const partition = partitions.find((p) => p.volumeId === volId);
    if (!partition) return;

    for (const [key, mesh] of this.objectMeshes.entries()) {
      if (mesh.userData.objectId !== objectId) continue;

      const overlayKey = `${key}_support_${volId}`;
      let overlay = this.overlayMeshes.get(overlayKey);

      if (!paintingData || (!paintingData.blockers.length && !paintingData.enforcers.length)) {
        if (overlay) {
          mesh.remove(overlay);
          overlay.geometry.dispose();
          if (Array.isArray(overlay.material)) overlay.material.forEach((m) => m.dispose());
          else overlay.material.dispose();
          this.overlayMeshes.delete(overlayKey);
        }
        continue;
      }

      const baseGeo = this.geometries.get(objectId);
      if (!baseGeo || !baseGeo.index) continue;

      const indices = baseGeo.index.array;
      const positions = baseGeo.attributes.position.array;

      const overlayIndices: number[] = [];
      const colors: number[] = [];

      const addFacet = (localIndex: number, colorHex: number) => {
        const mergedIndex = partition.firstFacet + localIndex;
        if (mergedIndex < partition.firstFacet || mergedIndex >= partition.firstFacet + partition.facetCount) {
          return;
        }

        const i0 = indices[mergedIndex * 3];
        const i1 = indices[mergedIndex * 3 + 1];
        const i2 = indices[mergedIndex * 3 + 2];

        overlayIndices.push(i0, i1, i2);
        const color = new THREE.Color(colorHex);
        for (let j = 0; j < 3; j++) {
          colors.push(color.r, color.g, color.b);
        }
      };

      for (const facet of paintingData.blockers) {
        addFacet(facet, 0xef4444);
      }
      for (const facet of paintingData.enforcers) {
        addFacet(facet, 0x3b82f6);
      }

      if (overlayIndices.length === 0) continue;

      const overlayGeo = new THREE.BufferGeometry();
      overlayGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      overlayGeo.setIndex(overlayIndices);
      overlayGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      overlayGeo.computeVertexNormals();

      if (!overlay) {
        const overlayMat = new THREE.MeshBasicMaterial({
          vertexColors: true,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.85,
          depthTest: true,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2
        });

        overlay = new THREE.Mesh(overlayGeo, overlayMat);
        mesh.add(overlay);
        this.overlayMeshes.set(overlayKey, overlay);
      } else {
        overlay.geometry.dispose();
        overlay.geometry = overlayGeo;
      }
    }
  }

  private raycastSelectedMesh(e: PointerEvent): { faceIndex: number; hit: [number, number, number]; normal: THREE.Vector3 } | null {
    const selectedMesh = this.getSelectedMesh();
    if (!selectedMesh || this.selectedObjectId === null) return null;

    const partitions = this.meshVolumes.get(this.selectedObjectId);
    if (!partitions) return null;

    const rect = this.renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, this.camera);

    const intersects = raycaster.intersectObject(selectedMesh, false);
    if (intersects.length > 0 && typeof intersects[0].faceIndex === 'number') {
      let mergedFaceIndex = intersects[0].faceIndex;

      const partition = partitions.find(
        (p) => mergedFaceIndex >= p.firstFacet && mergedFaceIndex < p.firstFacet + p.facetCount
      );

      if (!partition || partition.volumeId !== this.paintingVolumeId) {
        return null;
      }

      const localFacetIndex = mergedFaceIndex - partition.firstFacet;
      const point = intersects[0].point;
      const normal = intersects[0].face?.normal.clone().transformDirection(selectedMesh.matrixWorld) ?? new THREE.Vector3(0, 0, 1);
      return { faceIndex: localFacetIndex, hit: [point.x, point.y, point.z], normal };
    }
    return null;
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.pointerDownPos = { x: e.clientX, y: e.clientY };

    if (this.isPaintingActive && (e.button === 0 || (this.advancedPainting && e.button === 2))) {
      const hit = this.raycastSelectedMesh(e);
      if (hit && typeof hit.faceIndex === 'number') {
        this.isPaintingStroke = true;
        this.orbitControls.enabled = false;
        if (this.advancedPainting) {
          const camera = this.camera.position;
          this.callbacks.onToolPaintBegin?.(hit.hit, hit.faceIndex, e.button, e.shiftKey, [camera.x, camera.y, camera.z]);
        } else if (this.callbacks.onPaintBegin) {
          this.callbacks.onPaintBegin();
        }
        if (!this.advancedPainting && this.callbacks.onPaintFacet) {
          this.callbacks.onPaintFacet(hit.faceIndex);
        }
        e.preventDefault();
      }
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (this.advancedPainting) {
      const hover = this.raycastSelectedMesh(e);
      if (hover) this.paintCursor.update(new THREE.Vector3(...hover.hit), hover.normal, this.cursorRadius, this.cursorTool);
      else this.paintCursor.setVisible(false);
    }
    if (this.isPaintingActive && this.isPaintingStroke) {
      const hit = this.raycastSelectedMesh(e);
      if (hit && typeof hit.faceIndex === 'number') {
        if (this.advancedPainting) this.callbacks.onToolPaintPoint?.(hit.hit, hit.faceIndex);
        else if (this.callbacks.onPaintFacet) {
          this.callbacks.onPaintFacet(hit.faceIndex);
        }
      }
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (this.isPaintingActive && this.isPaintingStroke) {
      this.isPaintingStroke = false;
      this.orbitControls.enabled = true;
      if (this.advancedPainting) this.callbacks.onToolPaintEnd?.();
      else if (this.callbacks.onPaintEnd) {
        this.callbacks.onPaintEnd();
      }
      return;
    }

    const dx = e.clientX - this.pointerDownPos.x;
    const dy = e.clientY - this.pointerDownPos.y;
    if (Math.hypot(dx, dy) > 5) return;

    if (this.transformControls.dragging) return;

    if (this.flattenClusters.length > 0) {
      const selectedMesh = this.getSelectedMesh();
      if (selectedMesh) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        const mouse = new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          -((e.clientY - rect.top) / rect.height) * 2 + 1
        );
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, this.camera);
        const hits = raycaster.intersectObject(selectedMesh, false);
        if (hits.length > 0 && hits[0].face) {
          const hitPoint = hits[0].point;
          const hitNormal = hits[0].face.normal.clone().transformDirection(selectedMesh.matrixWorld);
          let bestIdx = -1;
          let bestDist = Infinity;
          for (let i = 0; i < this.flattenClusters.length; i++) {
            const cl = this.flattenClusters[i];
            const cNorm = new THREE.Vector3(...cl.normal).normalize().applyQuaternion(selectedMesh.quaternion);
            if (hitNormal.dot(cNorm) > 0.8) {
              const cCenter = new THREE.Vector3(...cl.center).applyMatrix4(selectedMesh.matrixWorld);
              const dist = hitPoint.distanceTo(cCenter);
              if (dist < bestDist) {
                bestDist = dist;
                bestIdx = i;
              }
            }
          }
          if (bestIdx >= 0) {
            this.callbacks.onFlattenFacetClick?.(bestIdx);
            return;
          }
        }
      }
    }

    if (this.brimEarsActive) {
      const rect = this.renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, this.camera);
      const earHits = raycaster.intersectObjects(this.brimEarsGroup.children, false);
      if (earHits.length > 0 && typeof earHits[0].object.userData?.brimEarIndex === 'number') {
        this.callbacks.onBrimEarClick?.(
          [earHits[0].point.x, earHits[0].point.y, 0],
          earHits[0].object.userData.brimEarIndex
        );
        return;
      }
      const groundPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
      const hitPoint = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(groundPlane, hitPoint)) {
        this.callbacks.onBrimEarClick?.([hitPoint.x, hitPoint.y, 0]);
        return;
      }
    }

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

      if (intersects.length > 0 && typeof intersects[0].faceIndex === 'number') {
        const hit = intersects[0].object as THREE.Mesh;
        if (hit.userData) {
          this.callbacks.onSelect(hit.userData.objectId, hit.userData.instanceId, e.shiftKey || e.ctrlKey || e.metaKey);
        }
      } else if (!(e.shiftKey || e.ctrlKey || e.metaKey)) {
        this.callbacks.onSelect(null, null);
      }
    }
  };

  private onPointerLeave = (): void => {
    this.paintCursor.setVisible(false);
    if (this.isPaintingStroke) {
      this.isPaintingStroke = false;
      this.orbitControls.enabled = true;
      if (this.advancedPainting) this.callbacks.onToolPaintEnd?.();
      else if (this.callbacks.onPaintEnd) {
        this.callbacks.onPaintEnd();
      }
    }
  };

  private onContextMenu = (e: MouseEvent): void => {
    if (this.advancedPainting) e.preventDefault();
  };

  private onWindowResize = (): void => {
    if (!this.container || this.isDestroyed) return;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    const aspect = width / height;

    this.perspectiveCamera.aspect = aspect;
    this.perspectiveCamera.updateProjectionMatrix();

    const d = this.camera.position.distanceTo(this.orbitControls.target);
    const halfHeight = d * Math.tan(THREE.MathUtils.degToRad(this.perspectiveCamera.fov / 2));
    const halfWidth = halfHeight * aspect;
    this.orthographicCamera.left = -halfWidth;
    this.orthographicCamera.right = halfWidth;
    this.orthographicCamera.top = halfHeight;
    this.orthographicCamera.bottom = -halfHeight;
    this.orthographicCamera.updateProjectionMatrix();

    this.renderer.setSize(width, height);
  };

  private animate = (): void => {
    if (this.isDestroyed) return;
    this.animationFrameId = requestAnimationFrame(this.animate);

    this.orbitControls.update();
    // See-through when the camera is below the bed, so parts stay visible from underneath.
    if (this.bedFloorMaterial) this.bedFloorMaterial.opacity = this.camera.position.z < 0 ? 0.25 : 1;
    this.renderer.render(this.scene, this.camera);
  };

  public getCameraQuaternion(): THREE.Quaternion {
    return this.camera.quaternion;
  }

  public setCameraView(view: CameraView): void {
    if (view === 'BED') {
      this.zoomToBed();
      return;
    }

    const selectedMesh = this.getSelectedMesh();
    let center = new THREE.Vector3(this.bedConfig.center[0], this.bedConfig.center[1], 0);
    let maxDim = Math.max(this.bedConfig.width, this.bedConfig.depth);

    if (view === 'Z') {
      if (selectedMesh) {
        const box = new THREE.Box3().setFromObject(selectedMesh);
        box.getCenter(center);
        const size = box.getSize(new THREE.Vector3());
        maxDim = Math.max(size.x, size.y, size.z);
        this.orbitControls.target.copy(center);
        this.camera.position.set(center.x, center.y - maxDim * 1.5, center.z + maxDim);
      } else {
        const cx = this.bedConfig.center[0];
        const cy = this.bedConfig.center[1];
        const span = Math.max(this.bedConfig.width, this.bedConfig.depth);
        this.orbitControls.target.set(cx, cy, 0);
        this.camera.position.set(cx, cy - span * 1.5, span * 1.2);
      }
      this.orbitControls.update();
      return;
    }

    const { cx, cy, span } = this.plateLayout();
    this.orbitControls.target.set(cx, cy, 0);

    const d = span * 1.8;
    switch (view) {
      case 1:
        this.camera.position.set(cx, cy, d);
        break; // Top
      case 2:
        this.camera.position.set(cx, cy, -d);
        break; // Bottom
      case 3:
        this.camera.position.set(cx, cy - d, 0);
        break; // Front
      case 4:
        this.camera.position.set(cx, cy + d, 0);
        break; // Back
      case 5:
        this.camera.position.set(cx - d, cy, 0);
        break; // Left
      case 6:
        this.camera.position.set(cx + d, cy, 0);
        break; // Right
      case 0:
        this.camera.position.set(cx - span, cy - d, span * 1.2);
        break; // Iso
    }
    this.orbitControls.update();
  }

  public destroy(): void {
    this.isDestroyed = true;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
    }

    this.unsubscribePrefs?.();
    this.unsubscribePrefs = null;

    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.renderer.domElement.removeEventListener('pointerup', this.onPointerUp);
    this.renderer.domElement.removeEventListener('pointerleave', this.onPointerLeave);
    this.renderer.domElement.removeEventListener('pointercancel', this.onPointerLeave);
    this.renderer.domElement.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('resize', this.onWindowResize);

    this.transformControls.dispose();
    this.orbitControls.dispose();
    this.paintCursor.dispose();

    this.clearFlattenClusters();
    this.clearBrimEarsOverlay();
    this.scene.remove(this.flattenGroup);
    this.scene.remove(this.brimEarsGroup);

    for (const sprite of this.labelSprites.values()) {
      if (sprite.material.map) sprite.material.map.dispose();
      sprite.material.dispose();
    }
    this.labelSprites.clear();
    this.scene.remove(this.labelsGroup);

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
