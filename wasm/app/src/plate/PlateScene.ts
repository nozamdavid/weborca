import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { createBedGeometry } from './bedGeometry';
import { displayBedOutline, loadBedModelOutline } from './bedModelOutline';
import { plateTitle } from '../plates/plateName';
import { usePlatesStore } from '../plates/platesStore';
import type { PlateObject, BedConfig, GizmoMode, MeshBufferData, MeshVolumePartition } from './types';
import type { SupportPaintingData } from '../painting/types';
import { renderPaintOverlay, clearPaintOverlay } from '../paint-tools/overlayRenderer';
import type { ParsedPaintOverlay, PaintLayer } from '../paint-tools/types';
import type { PaintTool } from '../paint-tools/types';
import { createPaintCursor, type PaintCursor } from '../paint-tools/paintCursor';
import { usePrefsStore } from '../prefs/prefsStore';
import type { CameraView } from '../shell/cameraBridge';
import { encodeQoi, bytesToBase64 } from '../shell/gcodeThumbnails';
import { useObjectListStore } from '../objectlist/objectListStore';

export interface PlateSceneCallbacks {
  canMoveObjects?: () => boolean;
  onSelect: (objectId: number | null, instanceId: number | null, additive?: boolean, volumeId?: number) => void;
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
  onMeasureChange?: (points: Array<[number, number, number]>) => void;
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

  /** Short white bounding-box corners for the current selection, independent of transform tools. */
  // Viewer-only lines: never added to objectMeshes, the engine, or exported model data.
  public selectionOutline = new LineSegments2(
    new LineSegmentsGeometry(),
    // Let the scene depth hide corners behind the model as the camera orbits.
    new LineMaterial({ color: 0xffffff, linewidth: 2.5, depthTest: true, depthWrite: false, toneMapped: false })
  );
  private selectionBounds = new THREE.Box3();
  private outlineBounds = new THREE.Box3();
  private meshBounds = new THREE.Box3();
  private outlineSize = new THREE.Vector3();

  private bedGroup: THREE.Group;
  private towerPreview: THREE.Mesh | null = null;
  private bedAssetRevision = 0;
  private bedTexture: THREE.Texture | null = null;
  private bedModelPoints: [number, number][] | null = null;
  private objectsGroup: THREE.Group;
  private bedGridHelper: THREE.LineSegments | null = null;
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
  private measureActive = false;
  private measurePoints: THREE.Vector3[] = [];
  private measureGroup = new THREE.Group();
  private explodeActive = false;
  private explodeFactor = 0;

  private objectMeshes: Map<string, THREE.Mesh> = new Map();
  private overlayMeshes: Map<string, THREE.Mesh> = new Map();
  private geometries: Map<number, THREE.BufferGeometry> = new Map();
  private meshVolumes: Map<number, MeshVolumePartition[]> = new Map();
  /** Colour of each part: the filament it is assigned to. Parts without one use the fallback blue. */
  private volumeColors: Map<number, Map<number, string>> = new Map();

  private selectedObjectId: number | null = null;
  /** `objectId_instanceId` of the other selected instances; they follow the primary while it is dragged. */
  private extraKeys = new Set<string>();
  private dragStart: { primary: THREE.Vector3; extras: Map<THREE.Mesh, THREE.Vector3> } | null = null;
  private planeDrag: {
    pointerId: number; target: THREE.Mesh; plane: THREE.Plane; start: THREE.Vector3;
    origins: Map<THREE.Mesh, THREE.Vector3>; moved: boolean;
    orbitEnabled: boolean; transformEnabled: boolean;
  } | null = null;
  private selectedInstanceId: number | null = null;
  private gizmoMode: GizmoMode = null;
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
  private overhangHighlight = { value: false };

  // Scene view & camera preferences
  public showGrid = true;
  public showAxes = true;
  public showLabels = false;
  public showBuildVolume = true;
  public showWireframe = false;
  public cameraType: 'perspective' | 'orthographic' = 'perspective';
  private perspectiveOnOrbit = false;
  public invertMouseWheelZoom = false;
  public invertOrbitHorizontal = false;
  public invertOrbitVertical = false;
  public rotateSensitivity = 1.0;
  public zoomSpeed = 1.0;

  private unsubscribePrefs: (() => void) | null = null;
  private resizeObserver: ResizeObserver;

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
      if (this.perspectiveOnOrbit && usePrefsStore.getState().display.autoPerspective) {
        this.setCameraType('perspective');
        usePrefsStore.getState().setDisplayPref('cameraType', 'perspective');
        this.perspectiveOnOrbit = false;
      }
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
        if (target) this.commitMeshTransforms([target, ...(drag?.extras.keys() ?? [])]);
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
    this.selectionOutline.name = 'selection-outline';
    this.selectionOutline.visible = false;
    this.selectionOutline.renderOrder = 1000;
    this.selectionOutline.frustumCulled = false;
    this.selectionOutline.geometry.setPositions(new Float32Array(8 * 3 * 2 * 3));
    this.scene.add(this.selectionOutline);
    this.scene.add(this.flattenGroup);
    this.scene.add(this.brimEarsGroup);
    this.scene.add(this.measureGroup);
    this.scene.add(this.labelsGroup);
    this.scene.add(this.plateLabelGroup);
    this.scene.add(this.extraBedsGroup);
    this.setBedLoading(true);
    this.rebuildPlates();

    // 8. Materials
    // Matte and flat-shaded like desktop: no reflections, and every facet keeps its own brightness so edges read.
    this.defaultMaterial = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      vertexColors: true,
      flatShading: true,
      wireframe: this.showWireframe
    });

    this.selectedMaterial = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      vertexColors: true,
      flatShading: true,
      wireframe: this.showWireframe
    });

    // Evaluate the flat face normal in view space against world Z. This follows
    // instance rotation and nonuniform scale without changing mesh/painter colours.
    this.overhangHighlight.value = prefs.display.showOverhang;
    for (const material of [this.defaultMaterial, this.selectedMaterial]) {
      material.onBeforeCompile = shader => {
        shader.uniforms.orcaShowOverhang = this.overhangHighlight;
        const varyings = 'varying vec3 orcaWorldUp; varying float orcaWorldHeight;\n';
        shader.vertexShader = varyings + shader.vertexShader.replace('#include <project_vertex>',
          '#include <project_vertex>\n' +
          'orcaWorldUp = mat3(viewMatrix) * vec3(0.0, 0.0, 1.0);\n' +
          'orcaWorldHeight = (modelMatrix * vec4(transformed, 1.0)).z;');
        shader.fragmentShader = 'uniform bool orcaShowOverhang;\n' + varyings +
          shader.fragmentShader.replace('#include <normal_fragment_begin>',
            '#include <normal_fragment_begin>\n' +
            'if (orcaShowOverhang && dot(normal, normalize(orcaWorldUp)) < -0.70710678 && orcaWorldHeight > 0.15) {\n' +
            '  diffuseColor.rgb = vec3(1.0, 0.22, 0.12);\n' +
            '}');
      };
      material.customProgramCacheKey = () => 'orca-overhang';
    }

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
      if (state.display.showOverhang !== prevState.display.showOverhang) {
        this.overhangHighlight.value = state.display.showOverhang;
      }
      if (state.display.cameraType !== prevState.display.cameraType) {
        this.perspectiveOnOrbit = false;
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
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown, true);
    this.renderer.domElement.addEventListener('pointermove', this.onPointerMove);
    this.renderer.domElement.addEventListener('pointerup', this.onPointerUp);
    this.renderer.domElement.addEventListener('pointerleave', this.onPointerLeave);
    this.renderer.domElement.addEventListener('pointercancel', this.onPointerCancel);
    this.renderer.domElement.addEventListener('lostpointercapture', this.onPointerCancel);
    this.renderer.domElement.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('resize', this.onWindowResize);
    this.resizeObserver = new ResizeObserver(this.onWindowResize);
    this.resizeObserver.observe(container);

    // Start render loop
    this.animate();
  }

  private buildBed(): void {
    // Clear existing bed
    this.disposeChildren(this.bedGroup);
    this.bedFloorMaterial?.dispose();
    this.bedGridHelper = null;
    this.axesHelper = null;
    this.buildVolumeHelper = null;

    const { width, depth, height, center } = this.bedConfig;
    const cx = center[0];
    const cy = center[1];
    const points = this.bedOutline();
    const { floor: floorGeo, grid: gridGeo } = createBedGeometry(this.bedConfig, points);

    // 1. Bed Floor Mesh (slightly below Z=0 to prevent z-fighting with models)
    const floorMat = new THREE.MeshBasicMaterial({
      color: this.bedTexture ? 0xffffff : 0x24242b,
      map: this.bedTexture,
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false
    });
    this.bedFloorMaterial = floorMat;
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.position.set(cx, cy, -0.1);
    this.bedGroup.add(floorMesh);

    // 2. Bed Grid (in XY plane at Z=0)
    const grid = new THREE.LineSegments(gridGeo, new THREE.LineBasicMaterial({ color: 0x334155 }));
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

  public setWipeTowerPreview(tower: { enabled: boolean; width?: number; depth?: number; height?: number; x?: number; y?: number; rotation?: number }, origin: [number, number, number] = [0, 0, 0]): void {
    if (this.towerPreview) {
      this.scene.remove(this.towerPreview);
      this.towerPreview.geometry.dispose();
      (this.towerPreview.material as THREE.Material).dispose();
      this.towerPreview = null;
    }
    if (!tower.enabled || !tower.width || !tower.depth || !tower.height) return;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(tower.width, tower.depth, tower.height),
      new THREE.MeshLambertMaterial({ color: 0x009688, flatShading: true }));
    const rotation = (tower.rotation || 0) * Math.PI / 180;
    const localCenter = new THREE.Vector3(tower.width / 2, tower.depth / 2, tower.height / 2).applyAxisAngle(new THREE.Vector3(0, 0, 1), rotation);
    mesh.position.set(origin[0] + (tower.x || 0) + localCenter.x, origin[1] + (tower.y || 0) + localCenter.y, origin[2] + localCenter.z);
    mesh.rotation.z = rotation;
    mesh.name = 'prime-tower-preview';
    this.towerPreview = mesh;
    this.scene.add(mesh);
  }

  /** Hide every plate surface until its outline and artwork are ready together. */
  public setBedLoading(loading: boolean): void {
    if (loading) this.bedAssetRevision++;
    this.bedGroup.visible = !loading;
    this.extraBedsGroup.visible = !loading;
    this.plateLabelGroup.visible = !loading;
  }

  /** Decorative bed assets are kept outside object picking and never enter the slicing model. */
  public async setBedAssets(assets: { model?: string; texture?: string }): Promise<void> {
    this.setBedLoading(true);
    const revision = this.bedAssetRevision;
    delete this.scene.userData.lightTheme;
    this.bedTexture?.dispose();
    this.bedTexture = null;
    this.bedModelPoints = null;
    this.buildBed();
    this.rebuildPlates();
    if (this.bedFloorMaterial) { this.bedFloorMaterial.map = null; this.bedFloorMaterial.needsUpdate = true; }
    const tasks: Promise<void>[] = [];
    if (assets.texture) tasks.push(new THREE.TextureLoader().loadAsync(assets.texture).then((texture) => {
      if (revision !== this.bedAssetRevision || this.isDestroyed) { texture.dispose(); return; }
      // Rasterize image textures before uploading: SVG images without explicit dimensions
      // can decode correctly yet fail WebGL's immutable texture upload in Chromium.
      const image = texture.image as HTMLImageElement;
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 4096 / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d');
      if (!context) { texture.dispose(); throw new Error('Cannot render the bed texture.'); }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      texture.dispose();
      const bedTexture = new THREE.CanvasTexture(canvas);
      bedTexture.colorSpace = THREE.SRGBColorSpace;
      this.bedTexture = bedTexture;
      if (this.bedFloorMaterial) { this.bedFloorMaterial.map = bedTexture; this.bedFloorMaterial.color.setHex(0xffffff); this.bedFloorMaterial.needsUpdate = true; }
    }));
    if (assets.model) tasks.push(loadBedModelOutline(assets.model).then((points) => {
      if (revision !== this.bedAssetRevision || this.isDestroyed) return;
      this.bedModelPoints = points;
      this.buildBed();
      this.rebuildPlates();
    }));
    for (const result of await Promise.allSettled(tasks)) if (result.status === 'rejected') console.warn('[Bed assets]', result.reason);
    if (revision === this.bedAssetRevision && !this.isDestroyed) this.setBedLoading(false);
  }

  private bedOutline(): [number, number][] {
    return displayBedOutline(this.bedConfig.points, this.bedModelPoints);
  }

  public setShowGrid(visible: boolean): void {
    this.showGrid = visible;
    if (this.bedGridHelper) {
      this.bedGridHelper.visible = visible;
    }
    for (const child of this.extraBedsGroup.children) {
      if (child.userData.bedGrid) child.visible = visible;
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
          const map = (m as THREE.MeshBasicMaterial).map;
          if (map !== this.bedTexture) map?.dispose();
          m.dispose();
        }
      }
    }
  }

  private rebuildPlates(): void {
    this.disposeChildren(this.plateLabelGroup);
    this.disposeChildren(this.extraBedsGroup);
    const { width, depth, center } = this.bedConfig;
    const points = this.bedOutline();
    const [cx, cy] = center;
    const size = Math.min(width, depth);
    const minX = Math.min(...points.map(p => p[0]));
    const maxX = Math.max(...points.map(p => p[0]));
    const minY = Math.min(...points.map(p => p[1]));
    const maxY = Math.max(...points.map(p => p[1]));
    const labelGap = size * 0.025;

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
      const number = text(String(plate.index + 1).padStart(2, '0'), 'bold 96px sans-serif', size * 0.1, orange(active), 'right', ox + maxX, oy + minY - size * 0.05 - labelGap);
      number.position.z = oz + 0.05;
      this.plateLabelGroup.add(number);
      const title = plateTitle(plate.name, plate.index);
      const shown = title.length > 40 ? `${title.slice(0, 38)}...` : title;
      const label = text(shown, 'bold 64px sans-serif', size * 0.075, orange(active), 'left', ox + minX, oy + maxY + size * 0.0375 + labelGap, true);
      label.name = 'plate-title';
      label.userData.plateIndex = plate.index;
      label.position.z = oz + 0.05;
      this.plateLabelGroup.add(label);

      if (plate.index === 0) continue; // the main bed has its own, richer drawing
      const bedGeometry = createBedGeometry(this.bedConfig, points);
      const floor = new THREE.Mesh(bedGeometry.floor, this.bedFloorMaterial ?? new THREE.MeshBasicMaterial({ color: 0x24242b, side: THREE.DoubleSide }));
      floor.position.set(ox + cx, oy + cy, oz - 0.1);
      this.extraBedsGroup.add(floor);
      const grid = new THREE.LineSegments(bedGeometry.grid, new THREE.LineBasicMaterial({ color: 0x334155 }));
      grid.position.set(ox + cx, oy + cy, oz);
      grid.visible = this.showGrid;
      grid.userData.bedGrid = true;
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
    this.perspectiveOnOrbit = false;
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

  /** Sets the colour of each part of each object (`volumeId` to a CSS colour) and repaints the meshes. */
  public setVolumeColors(colors: Map<number, Map<number, string>>): void {
    this.volumeColors = colors;
    for (const objectId of this.geometries.keys()) this.applyVolumeColors(objectId);
  }

  private applyVolumeColors(objectId: number): void {
    const geo = this.geometries.get(objectId);
    const index = geo?.index;
    const position = geo?.attributes.position;
    if (!geo || !index || !position) return;
    const fallback = new THREE.Color(0x3b82f6);
    const colors = new Float32Array(position.count * 3);
    for (let v = 0; v < position.count; v++) fallback.toArray(colors, v * 3);
    const parts = this.meshVolumes.get(objectId) ?? [];
    const byVolume = this.volumeColors.get(objectId);
    const color = new THREE.Color();
    for (const part of parts) {
      const css = byVolume?.get(part.volumeId);
      if (!css) continue;
      color.set(css);
      for (let f = part.firstFacet; f < part.firstFacet + part.facetCount; f++) {
        for (let k = 0; k < 3; k++) color.toArray(colors, index.getX(f * 3 + k) * 3);
      }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }

  public updateBedConfig(bedConfig: BedConfig): void {
    this.bedConfig = bedConfig;
    this.buildBed();
    delete this.scene.userData.lightTheme;
    this.rebuildPlates();
    this.orbitControls.target.set(bedConfig.center[0], bedConfig.center[1], 0);
  }

  public async setObjects(objects: PlateObject[]): Promise<void> {
    const activeKeys = new Set<string>();

    for (const obj of objects) {
      let geo = this.geometries.get(obj.id);
      if (geo?.userData.explodeOriginal) {
        (geo.getAttribute('position') as THREE.BufferAttribute).copyArray(geo.userData.explodeOriginal);
        delete geo.userData.explodeOriginal;
      }
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

      this.applyVolumeColors(obj.id);

      for (const inst of obj.instances) {
        const key = `${obj.id}_${inst.id}`;
        activeKeys.add(key);

        let mesh = this.objectMeshes.get(key);
        const isPrimary = this.selectedObjectId === obj.id && this.selectedInstanceId === inst.id;
        const isSelected = isPrimary || this.extraKeys.has(key);

        if (!mesh) {
          mesh = new THREE.Mesh(geo, isSelected ? this.selectedMaterial : this.defaultMaterial);
          mesh.userData = { objectId: obj.id, instanceId: inst.id, name: obj.name, baseOffset: [...inst.offset] };
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          this.objectsGroup.add(mesh);
          this.objectMeshes.set(key, mesh);
        } else {
          mesh.geometry = geo;
          mesh.userData = { ...mesh.userData, name: obj.name, baseOffset: [...inst.offset] };
          mesh.material = isSelected ? this.selectedMaterial : this.defaultMaterial;
        }

        // Apply instance transforms from Engine
        mesh.position.set(inst.offset[0], inst.offset[1], inst.offset[2]);
        mesh.rotation.set(inst.rotation[0], inst.rotation[1], inst.rotation[2]);
        const mirror = inst.mirror ?? [1, 1, 1];
        mesh.scale.set(inst.scale[0] * mirror[0], inst.scale[1] * mirror[1], inst.scale[2] * mirror[2]);

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

    if (this.explodeActive && this.explodeFactor > 0) {
      this.applyExplode(this.explodeFactor);
    }
    this.updateLabels();
    this.updateTransformControls();
    this.updateSelectionOutline();
  }

  public setSelection(objectId: number | null, instanceId: number | null, extras: { objectId: number; instanceId: number }[] = []): void {
    this.selectedObjectId = objectId;
    this.selectedInstanceId = instanceId;
    this.extraKeys = new Set(extras.map((e) => `${e.objectId}_${e.instanceId}`));

    for (const mesh of this.objectMeshes.values()) {
      const isSelected =
        objectId !== null &&
        instanceId !== null &&
        mesh.userData.objectId === objectId &&
        mesh.userData.instanceId === instanceId;

      mesh.material = isSelected || this.extraKeys.has(`${mesh.userData.objectId}_${mesh.userData.instanceId}`) ? this.selectedMaterial : this.defaultMaterial;
    }

    this.updateTransformControls();
    this.updateSelectionOutline();
  }

  private updateTransformControls(): void {
    const selected = this.getSelectedMesh();
    // Other selected instances follow translation; rotate and scale apply to a single selection.
    if (this.gizmoMode !== null && selected && !this.isPaintingActive && !this.measureActive && !this.explodeActive &&
        (this.extraKeys.size === 0 || this.gizmoMode === 'translate')) {
      this.transformControls.attach(selected);
    } else {
      this.transformControls.detach();
      this.transformControls.axis = null;
    }
  }

  private updateSelectionOutline(): void {
    const bounds = this.selectionBounds.makeEmpty();
    const selected = this.getSelectedMesh();
    if (!selected && this.extraKeys.size === 0) { this.selectionOutline.visible = false; this.outlineBounds.makeEmpty(); return; }
    for (const [key, mesh] of this.objectMeshes) {
      if (!mesh.visible || (mesh !== selected && !this.extraKeys.has(key))) continue;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      if (!mesh.geometry.boundingBox) continue;
      mesh.updateMatrixWorld(true);
      bounds.union(this.meshBounds.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld));
    }
    this.selectionOutline.visible = !bounds.isEmpty();
    if (bounds.isEmpty()) { this.outlineBounds.makeEmpty(); return; }
    // Keep the markers clear of the surface on large models as well as small ones.
    const size = bounds.getSize(this.outlineSize);
    bounds.expandByScalar(Math.max(1, Math.min(size.x, size.y, size.z) * 0.035));
    if (bounds.equals(this.outlineBounds)) return;
    this.outlineBounds.copy(bounds);
    const min = bounds.min.toArray();
    const max = bounds.max.toArray();
    const positions = new Float32Array(8 * 3 * 2 * 3);
    let vertex = 0;
    for (let corner = 0; corner < 8; corner++) {
      const point = min.map((value, axis) => corner & (1 << axis) ? max[axis] : value);
      for (let axis = 0; axis < 3; axis++) {
        positions.set(point, vertex++ * 3);
        const end = [...point];
        end[axis] += (corner & (1 << axis) ? -1 : 1) * (max[axis] - min[axis]) * 0.18;
        positions.set(end, vertex++ * 3);
      }
    }
    this.selectionOutline.geometry.setPositions(positions);
  }

  public setGizmoMode(mode: GizmoMode): void {
    this.gizmoMode = mode;
    if (mode !== null) this.transformControls.setMode(mode);
    this.updateTransformControls();
  }

  public setPaintingActive(active: boolean, volumeId?: number | null): void {
    this.isPaintingActive = active;
    this.paintingVolumeId = active ? (volumeId ?? null) : null;
    this.updateTransformControls();
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

  public hitTest(clientX: number, clientY: number): {
    objectId: number;
    instanceId: number;
    volumeId?: number;
    mesh: THREE.Mesh;
    faceIndex?: number;
  } | null {
    if (!this.container || this.isDestroyed) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, this.camera);
    const intersects = raycaster.intersectObjects(Array.from(this.objectMeshes.values()).filter(mesh => mesh.visible), false);
    if (intersects.length === 0) return null;

    const hit = intersects[0];
    const mesh = hit.object as THREE.Mesh;
    const objectId = mesh.userData?.objectId;
    const instanceId = mesh.userData?.instanceId;
    if (typeof objectId !== 'number') return null;

    let volumeId: number | undefined;
    const partitions = this.meshVolumes.get(objectId);
    if (partitions && partitions.length > 0 && typeof hit.faceIndex === 'number') {
      const faceIndex = hit.faceIndex;
      const partition = partitions.find(
        (p) => faceIndex >= p.firstFacet && faceIndex < p.firstFacet + p.facetCount
      );
      if (partition) {
        volumeId = partition.volumeId;
      }
    }

    return { objectId, instanceId, volumeId, mesh, faceIndex: hit.faceIndex ?? undefined };
  }

  /** True when an object lies under the given client position, so a right-click there is not on empty plate. */
  public isObjectAt(clientX: number, clientY: number): boolean {
    return this.hitTest(clientX, clientY) !== null;
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

  /** Explode view spreads objects and their individual parts without changing engine transforms. */
  public setExplodeActive(active: boolean): void {
    if (this.explodeActive === active) return;
    this.explodeActive = active;
    if (active) {
      this.transformControls.detach();
      this.applyExplode(this.explodeFactor);
    } else {
      this.applyExplode(0);
      this.setSelection(
        this.selectedObjectId,
        this.selectedInstanceId,
        [...this.extraKeys].map((k) => {
          const [objectId, instanceId] = k.split('_').map(Number);
          return { objectId, instanceId };
        })
      );
      this.updateLabels();
    }
  }

  public setExplodeFactor(factor: number): void {
    this.explodeFactor = factor;
    if (this.explodeActive) {
      this.applyExplode(factor);
    }
  }

  private applyExplode(factor: number): void {
    // Mesh partitions identify each part's facets in the merged geometry. Translate their vertices in the
    // display buffer only; restore the original buffer before refreshing meshes or leaving the tool.
    for (const [objectId, geometry] of this.geometries) {
      const position = geometry.getAttribute('position') as THREE.BufferAttribute;
      const original = geometry.userData.explodeOriginal as Float32Array | undefined;
      if (original) position.copyArray(original);
      const partitions = this.meshVolumes.get(objectId) ?? [];
      if (factor > 0 && partitions.length > 1 && geometry.index) {
        const base = original ?? (position.array as Float32Array).slice();
        geometry.userData.explodeOriginal = base;
        const parts = partitions.map((partition) => {
          const vertices = new Set<number>();
          const bounds = new THREE.Box3();
          const point = new THREE.Vector3();
          for (let facet = partition.firstFacet; facet < partition.firstFacet + partition.facetCount; facet++) {
            for (let corner = 0; corner < 3; corner++) {
              const vertex = geometry.index!.getX(facet * 3 + corner);
              vertices.add(vertex);
              bounds.expandByPoint(point.fromArray(base, vertex * 3));
            }
          }
          return { vertices, center: bounds.getCenter(new THREE.Vector3()) };
        });
        const center = parts.reduce((sum, part) => sum.add(part.center), new THREE.Vector3()).divideScalar(parts.length);
        parts.forEach((part, i) => {
          const direction = part.center.clone().sub(center);
          if (direction.lengthSq() < 1e-8) direction.set(Math.cos(i * 2 * Math.PI / parts.length), Math.sin(i * 2 * Math.PI / parts.length), 0);
          const offset = direction.normalize().multiplyScalar(40 * factor / 100);
          for (const vertex of part.vertices) position.setXYZ(vertex, base[vertex * 3] + offset.x, base[vertex * 3 + 1] + offset.y, base[vertex * 3 + 2] + offset.z);
        });
      } else if (factor <= 0) delete geometry.userData.explodeOriginal;
      position.needsUpdate = true;
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
    }
    const meshes = Array.from(this.objectMeshes.values());
    if (meshes.length === 0) return;

    if (factor <= 0) {
      for (const mesh of meshes) {
        const base = mesh.userData.baseOffset as [number, number, number] | undefined;
        if (base) {
          mesh.position.set(base[0], base[1], base[2]);
        }
      }
      this.updateLabels();
      return;
    }

    const center = new THREE.Vector3();
    for (const mesh of meshes) {
      const base = (mesh.userData.baseOffset as [number, number, number] | undefined) ?? [
        mesh.position.x,
        mesh.position.y,
        mesh.position.z
      ];
      center.add(new THREE.Vector3(base[0], base[1], base[2]));
    }
    center.divideScalar(meshes.length);

    const t = factor / 100;
    meshes.forEach((mesh, index) => {
      const base = (mesh.userData.baseOffset as [number, number, number] | undefined) ?? [
        mesh.position.x,
        mesh.position.y,
        mesh.position.z
      ];
      const basePos = new THREE.Vector3(base[0], base[1], base[2]);
      const dir = basePos.clone().sub(center);
      const dist = dir.length();

      let radialDir: THREE.Vector3;
      if (dist > 1e-4) {
        radialDir = dir.normalize();
      } else {
        const angle = (index / meshes.length) * 2 * Math.PI;
        radialDir = new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0);
      }

      const displacement = (dist * 1.0 + 40) * t;
      mesh.position.copy(basePos).addScaledVector(radialDir, displacement);
    });

    this.updateLabels();
  }

  /** Measure mode: two clicks on the model surface mark a segment; a third click starts a new one. */
  public setMeasureActive(active: boolean): void {
    if (this.measureActive === active) return;
    this.measureActive = active;
    if (active) this.transformControls.detach();
    else this.clearMeasure();
    this.setSelection(this.selectedObjectId, this.selectedInstanceId, [...this.extraKeys].map((k) => { const [objectId, instanceId] = k.split('_').map(Number); return { objectId, instanceId }; }));
  }

  public clearMeasure(): void {
    this.measurePoints = [];
    this.drawMeasure();
    this.callbacks.onMeasureChange?.([]);
  }

  private drawMeasure(): void {
    while (this.measureGroup.children.length > 0) {
      const child = this.measureGroup.children[0] as THREE.Mesh;
      child.geometry.dispose();
      (child.material as THREE.Material).dispose();
      this.measureGroup.remove(child);
    }
    const marker = Math.max(1, this.camera.position.distanceTo(this.orbitControls.target) / 120);
    for (const p of this.measurePoints) {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(marker, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffb300, depthTest: false }));
      dot.position.copy(p);
      dot.renderOrder = 10;
      this.measureGroup.add(dot);
    }
    if (this.measurePoints.length === 2) {
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(this.measurePoints), new THREE.LineBasicMaterial({ color: 0xffb300, depthTest: false }));
      line.renderOrder = 10;
      this.measureGroup.add(line as unknown as THREE.Mesh);
    }
  }

  private pickMeasurePoint(e: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), this.camera);
    const hit = raycaster.intersectObjects(Array.from(this.objectMeshes.values()), false)[0];
    if (!hit) return;
    this.measurePoints = this.measurePoints.length >= 2 ? [hit.point.clone()] : [...this.measurePoints, hit.point.clone()];
    this.drawMeasure();
    this.callbacks.onMeasureChange?.(this.measurePoints.map((p) => [p.x, p.y, p.z]));
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

    // Body dragging translates in XY independently of the active gizmo mode.
    // Tool handles and tools that operate on the surface retain their own gestures.
    if (e.button === 0 && !e.shiftKey && !e.ctrlKey && !e.metaKey && !this.isPaintingActive &&
        !this.measureActive && !this.explodeActive && !this.brimEarsActive && !this.flattenClusters.length &&
        !this.transformControls.dragging && !this.transformControls.axis && this.callbacks.canMoveObjects?.() !== false) {
      const raycaster = this.pointerRay(e);
      const hit = raycaster.intersectObjects([...this.objectMeshes.values()].filter(mesh => mesh.visible), false)[0];
      if (hit) {
        const target = hit.object as THREE.Mesh;
        const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -hit.point.z);
        const selected = target.userData.objectId === this.selectedObjectId && target.userData.instanceId === this.selectedInstanceId ||
          this.extraKeys.has(`${target.userData.objectId}_${target.userData.instanceId}`);
        const origins = new Map([[target, target.position.clone()]]);
        if (selected) for (const mesh of this.objectMeshes.values()) {
          if (mesh === this.getSelectedMesh() || this.extraKeys.has(`${mesh.userData.objectId}_${mesh.userData.instanceId}`)) origins.set(mesh, mesh.position.clone());
        }
        this.planeDrag = { pointerId: e.pointerId, target, plane, start: hit.point.clone(), origins, moved: false,
          orbitEnabled: this.orbitControls.enabled, transformEnabled: this.transformControls.enabled };
        this.orbitControls.enabled = false;
        this.transformControls.enabled = false;
        this.renderer.domElement.setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
      }
    }

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
    const drag = this.planeDrag;
    if (drag && drag.pointerId === e.pointerId) {
      if (!drag.moved && Math.hypot(e.clientX - this.pointerDownPos.x, e.clientY - this.pointerDownPos.y) <= 5) return;
      const point = this.pointerRay(e).ray.intersectPlane(drag.plane, new THREE.Vector3());
      if (!point) return;
      if (!drag.moved) {
        drag.moved = true;
        if (drag.origins.size === 1) this.callbacks.onSelect(drag.target.userData.objectId, drag.target.userData.instanceId);
      }
      const delta = point.sub(drag.start);
      delta.z = 0;
      for (const [mesh, origin] of drag.origins) mesh.position.copy(origin).add(delta);
      return;
    }
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
    if (this.planeDrag?.pointerId === e.pointerId) {
      const moved = this.planeDrag.moved;
      this.finishPlaneDrag(true);
      if (moved) return;
    }
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

    if (this.measureActive) {
      this.pickMeasurePoint(e);
      return;
    }

    if (this.explodeActive) {
      return;
    }

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

    if (!this.isPaintingActive && e.button === 0) {
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
          const objectId = hit.userData.objectId;
          let volumeId: number | undefined;
          const partitions = this.meshVolumes.get(objectId);
          if (partitions && partitions.length > 0) {
            const partition = partitions.find(
              (p) => intersects[0].faceIndex! >= p.firstFacet && intersects[0].faceIndex! < p.firstFacet + p.facetCount
            );
            if (partition) volumeId = partition.volumeId;
          }
          this.callbacks.onSelect(objectId, hit.userData.instanceId, e.shiftKey || e.ctrlKey || e.metaKey, volumeId);
        }
      } else if (!(e.shiftKey || e.ctrlKey || e.metaKey)) {
        this.callbacks.onSelect(null, null);
      }
    }
  };

  private pointerRay(e: PointerEvent): THREE.Raycaster {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(
      (e.clientX - rect.left) / rect.width * 2 - 1,
      -(e.clientY - rect.top) / rect.height * 2 + 1
    ), this.camera);
    return raycaster;
  }

  private finishPlaneDrag(commit: boolean): void {
    const drag = this.planeDrag;
    if (!drag) return;
    this.planeDrag = null;
    this.orbitControls.enabled = drag.orbitEnabled;
    this.transformControls.enabled = drag.transformEnabled;
    if (this.renderer.domElement.hasPointerCapture(drag.pointerId)) this.renderer.domElement.releasePointerCapture(drag.pointerId);
    if (!commit) for (const [mesh, origin] of drag.origins) mesh.position.copy(origin);
    if (!commit || !drag.moved) return;
    this.commitMeshTransforms([...drag.origins.keys()]);
  }

  private commitMeshTransforms(meshes: THREE.Object3D[]): void {
    const entries = meshes.map(mesh => ({
      objectId: mesh.userData.objectId as number, instanceId: mesh.userData.instanceId as number,
      offset: mesh.position.toArray() as [number, number, number],
      rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z] as [number, number, number],
      scale: [Math.abs(mesh.scale.x), Math.abs(mesh.scale.y), Math.abs(mesh.scale.z)] as [number, number, number]
    }));
    if (entries.length > 1 && this.callbacks.onTransformMany) this.callbacks.onTransformMany(entries);
    else for (const entry of entries) this.callbacks.onTransformChange(entry.objectId, entry.instanceId, entry);
  }

  private onPointerCancel = (): void => {
    this.finishPlaneDrag(false);
    this.onPointerLeave();
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
    e.preventDefault();
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
    this.updateSelectionOutline();
    const light = document.documentElement.dataset.theme === 'light';
    if (this.scene.userData.lightTheme !== light) {
      this.scene.userData.lightTheme = light;
      (this.scene.background as THREE.Color).setHex(light ? 0xe7e9ec : 0x1e1e24);
      this.bedFloorMaterial?.color.setHex(this.bedTexture ? 0xffffff : light ? 0xd4d8dd : 0x27272a);
    }
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

    if (usePrefsStore.getState().display.autoPerspective) {
      const type = view === 0 ? 'perspective' : 'orthographic';
      this.setCameraType(type);
      usePrefsStore.getState().setDisplayPref('cameraType', type);
      this.perspectiveOnOrbit = view !== 0;
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

  /**
   * Renders a real 3D model thumbnail for a specific plate without bed or UI elements.
   * Reuses the existing Three.js renderer and scene geometry.
   */
  public renderThumbnail(params: {
    width: number;
    height: number;
    plateIndex?: number;
    format?: 'PNG' | 'JPG' | 'QOI';
  }): string | null {
    if (this.isDestroyed || !this.renderer) return null;

    // 1. Save visibility of scene elements and overlays
    const savedBedVisible = this.bedGroup.visible;
    const savedGridVisible = this.bedGridHelper ? this.bedGridHelper.visible : false;
    const savedAxesVisible = this.axesHelper ? this.axesHelper.visible : false;
    const savedBuildVolumeVisible = this.buildVolumeHelper ? this.buildVolumeHelper.visible : false;
    const savedLabelsVisible = this.plateLabelGroup.visible;
    const savedObjectLabelsVisible = this.labelsGroup.visible;
    const savedExtraBedsVisible = this.extraBedsGroup.visible;
    const savedFlattenVisible = this.flattenGroup.visible;
    const savedBrimEarsVisible = this.brimEarsGroup.visible;
    const savedMeasureVisible = this.measureGroup.visible;
    const savedControlsVisible = this.transformControls.getHelper().visible;
    const savedOutlineVisible = this.selectionOutline.visible;
    const savedTowerVisible = this.towerPreview ? this.towerPreview.visible : false;

    // Save every cursor visibility
    const savedCircleCursor = this.paintCursor.circleMesh.visible;
    const savedDiskCursor = this.paintCursor.diskMesh.visible;
    const savedSphereCursor = this.paintCursor.sphereMesh.visible;
    const savedPointerCursor = this.paintCursor.pointerMesh.visible;

    const savedBackground = this.scene.background;
    const savedOverhang = this.overhangHighlight.value;

    // Save paint overlays visibility
    const savedOverlays = new Map<string, boolean>();
    for (const [k, ov] of this.overlayMeshes.entries()) {
      savedOverlays.set(k, ov.visible);
      ov.visible = false;
    }

    // Save child overlays attached to meshes
    const savedChildOverlays = new Map<THREE.Object3D, boolean>();
    for (const mesh of this.objectMeshes.values()) {
      for (const child of mesh.children) {
        if (child.name === '__paint_overlay_container__' || child.name.includes('overlay')) {
          savedChildOverlays.set(child, child.visible);
          child.visible = false;
        }
      }
    }

    // Save renderer state
    const prevRenderTarget = this.renderer.getRenderTarget();
    const prevClearColor = new THREE.Color();
    this.renderer.getClearColor(prevClearColor);
    const prevClearAlpha = this.renderer.getClearAlpha();

    // Hide bed and UI elements
    this.bedGroup.visible = false;
    if (this.bedGridHelper) this.bedGridHelper.visible = false;
    if (this.axesHelper) this.axesHelper.visible = false;
    if (this.buildVolumeHelper) this.buildVolumeHelper.visible = false;
    this.plateLabelGroup.visible = false;
    this.labelsGroup.visible = false;
    this.extraBedsGroup.visible = false;
    this.flattenGroup.visible = false;
    this.brimEarsGroup.visible = false;
    this.measureGroup.visible = false;
    this.transformControls.getHelper().visible = false;
    this.selectionOutline.visible = false;
    if (this.towerPreview) this.towerPreview.visible = false;

    this.paintCursor.circleMesh.visible = false;
    this.paintCursor.diskMesh.visible = false;
    this.paintCursor.sphereMesh.visible = false;
    this.paintCursor.pointerMesh.visible = false;

    this.scene.background = null;
    this.overhangHighlight.value = false;

    const targetPlateIndex = params.plateIndex ?? this.activePlateIndex;
    const plate = usePlatesStore.getState().plates.find(p => p.index === targetPlateIndex);
    const allowedKeys = plate?.instances.length
      ? new Set(plate.instances.map(i => `${i.objectId}_${i.instanceId}`)) : null;
    // The sidebar plate membership can lag a model import. Until refreshed, use
    // the displayed plate's bounds rather than treating a newly occupied bed as empty.
    const origin = this.plates.find(p => p.index === targetPlateIndex)?.origin ?? plate?.origin ?? [0, 0, 0];
    const centerX = origin[0] + this.bedConfig.center[0];
    const centerY = origin[1] + this.bedConfig.center[1];

    // Exclude non-printable objects (modifier / negative / support blocker / enforcer)
    const nonPrintableObjIds = new Set<number>();
    try {
      const treeObjects = useObjectListStore.getState().objects || [];
      for (const to of treeObjects) {
        if (to.volumes && to.volumes.length > 0 && to.volumes.every((v) => v.type !== 'part')) {
          nonPrintableObjIds.add(to.id);
        }
      }
    } catch (_) {}

    const savedMeshStates = new Map<string, { visible: boolean; material: THREE.Material | THREE.Material[] }>();
    const bbox = new THREE.Box3();
    let visibleCount = 0;

    for (const [key, mesh] of this.objectMeshes.entries()) {
      savedMeshStates.set(key, { visible: mesh.visible, material: mesh.material });

      const objId = mesh.userData?.objectId;

      if (objId !== undefined && nonPrintableObjIds.has(objId)) {
        mesh.visible = false;
        continue;
      }

      const shouldBeVisible = allowedKeys ? allowedKeys.has(key) :
        Math.abs(mesh.position.x - centerX) <= this.bedConfig.width / 2 + 10 &&
        Math.abs(mesh.position.y - centerY) <= this.bedConfig.depth / 2 + 10;
      mesh.visible = shouldBeVisible;
      if (shouldBeVisible) {
        mesh.material = this.defaultMaterial;
        bbox.expandByObject(mesh);
        visibleCount++;
      }
    }

    let renderTarget: THREE.WebGLRenderTarget | null = null;
    let thumbCamera: THREE.PerspectiveCamera | null = null;
    let camLight: THREE.DirectionalLight | null = null;

    try {
      if (visibleCount === 0 || bbox.isEmpty()) {
        return null;
      }

      const width = params.width;
      const height = params.height;
      const aspect = width / height;

      thumbCamera = new THREE.PerspectiveCamera(40, aspect, 0.1, 10000);
      thumbCamera.up.set(0, 0, 1);

      camLight = new THREE.DirectionalLight(0xffffff, 1.2);
      camLight.position.set(0.5, 0.5, 1);
      thumbCamera.add(camLight);
      this.scene.add(thumbCamera);

      const center = bbox.getCenter(new THREE.Vector3());
      const sphere = bbox.getBoundingSphere(new THREE.Sphere());
      const radius = Math.max(sphere.radius, 10);

      // Frame non-square dimensions correctly (respect horizontal and vertical FOV)
      const vFovHalf = THREE.MathUtils.degToRad(thumbCamera.fov) / 2;
      const hFovHalf = Math.atan(Math.tan(vFovHalf) * aspect);
      const minFovHalf = Math.min(vFovHalf, hFovHalf);
      const dist = (radius / Math.sin(minFovHalf)) * 1.35;

      // Standard OrcaSlicer isometric camera angle
      const dir = new THREE.Vector3(0.65, -0.75, 0.7).normalize();
      thumbCamera.position.copy(center).addScaledVector(dir, dist);
      thumbCamera.lookAt(center);
      thumbCamera.updateProjectionMatrix();

      renderTarget = new THREE.WebGLRenderTarget(width, height, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        colorSpace: THREE.SRGBColorSpace,
      });

      this.renderer.setRenderTarget(renderTarget);
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.clear();
      this.renderer.render(this.scene, thumbCamera);

      const pixels = new Uint8Array(width * height * 4);
      this.renderer.readRenderTargetPixels(renderTarget, 0, 0, width, height, pixels);

      // Vertically flip OpenGL bottom-up pixels to raster top-down
      const clamped = new Uint8ClampedArray(width * height * 4);
      const rowSize = width * 4;
      for (let y = 0; y < height; y++) {
        const srcY = height - 1 - y;
        clamped.set(pixels.subarray(srcY * rowSize, (srcY + 1) * rowSize), y * rowSize);
      }

      if (params.format === 'QOI') {
        const qoiBytes = encodeQoi(clamped, width, height);
        return 'data:image/qoi;base64,' + bytesToBase64(qoiBytes);
      }

      if (typeof document !== 'undefined') {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const imgData = new ImageData(clamped, width, height);
          ctx.putImageData(imgData, 0, 0);
          const mime = params.format === 'JPG' ? 'image/jpeg' : 'image/png';
          const quality = params.format === 'JPG' ? 0.85 : undefined;
          return canvas.toDataURL(mime, quality);
        }
      }
      return null;
    } catch (err) {
      console.error('[PlateScene] Error rendering thumbnail:', err);
      return null;
    } finally {
      if (thumbCamera) {
        if (camLight) {
          thumbCamera.remove(camLight);
          camLight.dispose();
        }
        this.scene.remove(thumbCamera);
      }

      // Restore renderer renderTarget and clearColor
      if (this.renderer) {
        this.renderer.setRenderTarget(prevRenderTarget);
        this.renderer.setClearColor(prevClearColor, prevClearAlpha);
      }
      if (renderTarget) {
        renderTarget.dispose();
      }

      // Restore element visibilities
      this.bedGroup.visible = savedBedVisible;
      if (this.bedGridHelper) this.bedGridHelper.visible = savedGridVisible;
      if (this.axesHelper) this.axesHelper.visible = savedAxesVisible;
      if (this.buildVolumeHelper) this.buildVolumeHelper.visible = savedBuildVolumeVisible;
      this.plateLabelGroup.visible = savedLabelsVisible;
      this.labelsGroup.visible = savedObjectLabelsVisible;
      this.extraBedsGroup.visible = savedExtraBedsVisible;
      this.flattenGroup.visible = savedFlattenVisible;
      this.brimEarsGroup.visible = savedBrimEarsVisible;
      this.measureGroup.visible = savedMeasureVisible;
      this.transformControls.getHelper().visible = savedControlsVisible;
      this.selectionOutline.visible = savedOutlineVisible;
      if (this.towerPreview) this.towerPreview.visible = savedTowerVisible;

      // Restore all cursor meshes
      this.paintCursor.circleMesh.visible = savedCircleCursor;
      this.paintCursor.diskMesh.visible = savedDiskCursor;
      this.paintCursor.sphereMesh.visible = savedSphereCursor;
      this.paintCursor.pointerMesh.visible = savedPointerCursor;

      this.scene.background = savedBackground;
      this.overhangHighlight.value = savedOverhang;

      for (const [k, ov] of this.overlayMeshes.entries()) {
        const wasVis = savedOverlays.get(k);
        if (wasVis !== undefined) ov.visible = wasVis;
      }

      for (const [child, wasVis] of savedChildOverlays.entries()) {
        child.visible = wasVis;
      }

      for (const [key, state] of savedMeshStates.entries()) {
        const mesh = this.objectMeshes.get(key);
        if (mesh) {
          mesh.visible = state.visible;
          mesh.material = state.material;
        }
      }
    }
  }

  public destroy(): void {
    this.setWipeTowerPreview({ enabled: false });
    this.bedAssetRevision++;
    this.bedTexture?.dispose();
    this.isDestroyed = true;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
    }

    this.unsubscribePrefs?.();
    this.unsubscribePrefs = null;

    this.finishPlaneDrag(false);
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown, true);
    this.renderer.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.renderer.domElement.removeEventListener('pointerup', this.onPointerUp);
    this.renderer.domElement.removeEventListener('pointerleave', this.onPointerLeave);
    this.renderer.domElement.removeEventListener('pointercancel', this.onPointerCancel);
    this.renderer.domElement.removeEventListener('lostpointercapture', this.onPointerCancel);
    this.renderer.domElement.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('resize', this.onWindowResize);
    this.resizeObserver.disconnect();

    this.selectionOutline.geometry.dispose();
    this.selectionOutline.material.dispose();
    this.scene.remove(this.selectionOutline);
    this.transformControls.dispose();
    this.orbitControls.dispose();
    this.paintCursor.dispose();

    this.clearFlattenClusters();
    this.clearBrimEarsOverlay();
    this.scene.remove(this.flattenGroup);
    this.scene.remove(this.brimEarsGroup);
    this.clearMeasure();
    this.scene.remove(this.measureGroup);

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
