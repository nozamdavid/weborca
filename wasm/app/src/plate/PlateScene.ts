import * as THREE from 'three';
import { createFlattenPatch, hoverFlattenPatch, pickFlattenPatch } from './flattenPatches';
import { boxSelection, selectionRect } from './boxSelection';
import './boxSelection.css';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { createBedGeometry } from './bedGeometry';
import { displayBedOutline, loadBedModelOutline } from './bedModelOutline';
import { plateTitle } from '../plates/plateName';
import { attachHtmlPlateTitle } from './htmlPlateTitle';
import { attachHtmlObjectLabel } from './htmlObjectLabel';
import { translate } from '../i18n';
import { usePlatesStore } from '../plates/platesStore';
import type { PlateObject, BedConfig, GizmoMode, MeshBufferData, MeshVolumePartition, ViewerMeshData } from './types';
import type { SupportPaintingData } from '../painting/types';
import { renderPaintOverlay, clearPaintOverlay } from '../paint-tools/overlayRenderer';
import type { ParsedPaintOverlay, PaintLayer } from '../paint-tools/types';
import type { PaintTool } from '../paint-tools/types';
import { createPaintCursor, type PaintCursor } from '../paint-tools/paintCursor';
import { usePrefsStore } from '../prefs/prefsStore';
import type { CameraView } from '../shell/cameraBridge';
import { encodeQoi, bytesToBase64 } from '../shell/gcodeThumbnails';
import { useObjectListStore } from '../objectlist/objectListStore';
import { useCutStore, getConnectorIssues } from '../cut/cutStore';
import { CutPreview } from './cutPreview';
import { bindCanvasTouch } from '../components/canvasTouch';
import { useMeasureStore, getMeasurementFeature, measureFeatures } from '../measure';

export interface PlateSceneCallbacks {
  onBoxSelect?: (refs: { objectId: number; instanceId: number }[]) => void;
  canMoveObjects?: () => boolean;
  canMoveWipeTower?: (plateIndex: number) => boolean;
  onMoveWipeTower?: (plateIndex: number, x: number, y: number) => Promise<boolean>;
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
  getViewerMesh: (objectId: number) => Promise<ViewerMeshData>;
  onVolumeTransformChange: (objectId: number, volumeId: number, transform: {
    offset?: [number, number, number]; rotation?: [number, number, number]; scale?: [number, number, number];
  }) => void;
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
  private disposeTouch: () => void;
  private transformControls: TransformControls;
  private groupProxy = new THREE.Object3D();
  private groupDrag: { pivot: THREE.Vector3; orbit: boolean; snapshots: { mesh: THREE.Mesh; position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 }[] } | null = null;
  private cancelGroupKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && this.groupDrag) { this.finishGroupDrag(false); event.stopImmediatePropagation(); }
  };

  private beginGroupDrag(): void {
    if (this.callbacks.canMoveObjects?.() === false) { this.transformControls.dragging = false; return; }
    const selected = this.getSelectedMesh();
    const meshes = [...this.objectMeshes].filter(([key, mesh]) => mesh === selected || this.extraKeys.has(key)).map(([, mesh]) => mesh);
    this.groupDrag = { pivot: this.groupProxy.position.clone(), orbit: this.orbitControls.enabled,
      snapshots: meshes.map(mesh => ({ mesh, position: mesh.position.clone(), quaternion: mesh.quaternion.clone(), scale: mesh.scale.clone() })) };
    this.orbitControls.enabled = false;
    window.addEventListener('keydown', this.cancelGroupKey, true);
  }

  private changeGroupDrag(): void {
    const drag = this.groupDrag;
    if (!drag) return;
    if (this.callbacks.canMoveObjects?.() === false) { this.finishGroupDrag(false); return; }
    // Any colored scale handle applies uniform group scale. This cannot introduce shear.
    const axis = this.transformControls.axis ?? 'XYZ';
    const component = axis.includes('X') ? 'x' : axis.includes('Y') ? 'y' : 'z';
    const factor = Math.max(0.001, this.groupProxy.scale[component]);
    for (const { mesh, position, quaternion, scale } of drag.snapshots) {
      mesh.position.copy(position).sub(drag.pivot);
      if (this.gizmoMode === 'scale') {
        mesh.position.multiplyScalar(factor);
        mesh.scale.copy(scale).multiplyScalar(factor);
      } else {
        mesh.position.applyQuaternion(this.groupProxy.quaternion);
        mesh.quaternion.copy(this.groupProxy.quaternion).multiply(quaternion);
      }
      mesh.position.add(drag.pivot);
    }
  }

  private finishGroupDrag(commit: boolean): void {
    const drag = this.groupDrag;
    if (!drag) return;
    this.groupDrag = null;
    window.removeEventListener('keydown', this.cancelGroupKey, true);
    this.transformControls.dragging = false;
    this.transformControls.axis = null;
    this.orbitControls.enabled = drag.orbit;
    if (!commit || this.callbacks.canMoveObjects?.() === false) {
      for (const { mesh, position, quaternion, scale } of drag.snapshots) {
        mesh.position.copy(position); mesh.quaternion.copy(quaternion); mesh.scale.copy(scale);
      }
    } else this.commitMeshTransforms(drag.snapshots.map(s => s.mesh));
    this.updateTransformControls();
    this.requestDraw();
  }

  /** Short white bounding-box corners for the current selection, independent of transform tools. */
  // Viewer-only lines: never added to objectMeshes, the engine, or exported model data.
  public selectionOutline = new LineSegments2(
    new LineSegmentsGeometry(),
    // Let the scene depth hide corners behind the model as the camera orbits. Transparent so they draw after
    // the bed floor, which is transparent and writes no depth: in the opaque pass the floor painted over them.
    new LineMaterial({ color: 0xffffff, linewidth: 2.5, depthTest: true, depthWrite: false, transparent: true, toneMapped: false })
  );
  private selectionBounds = new THREE.Box3();
  private outlineBounds = new THREE.Box3();
  private meshBounds = new THREE.Box3();
  private outlineSize = new THREE.Vector3();

  private bedGroup: THREE.Group;
  private towerPreview: THREE.Mesh | null = null;
  private towerPlacement: { index: number; anchorOffset: THREE.Vector3; width: number; depth: number; brim: number; excludedArea: [number, number][]; signature: string } | null = null;
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
  private canceledBoxPointer: number | null = null;
  private boxDrag: { pointerId: number; start: { x: number; y: number }; end: { x: number; y: number }; overlay: HTMLDivElement; orbit: boolean; moved: boolean } | null = null;
  private cancelBoxKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && this.boxDrag) { this.finishBox(false); e.stopImmediatePropagation(); }
  };

  private finishBox(commit: boolean): boolean {
    const drag = this.boxDrag;
    if (!drag) return false;
    this.boxDrag = null;
    if (!commit) this.canceledBoxPointer = drag.pointerId;
    drag.overlay.remove();
    window.removeEventListener('keydown', this.cancelBoxKey, true);
    this.orbitControls.enabled = drag.orbit;
    const canvas = this.renderer.domElement;
    if (canvas.hasPointerCapture(drag.pointerId)) canvas.releasePointerCapture(drag.pointerId);
    if (commit && drag.moved && this.callbacks.canMoveObjects?.() !== false) this.callbacks.onBoxSelect?.(boxSelection(this.viewerTargets(), this.camera, canvas.getBoundingClientRect(), selectionRect(drag.start, drag.end)));
    return drag.moved;
  }
  private labelSprites: Map<string, THREE.Sprite> = new Map();

  private flattenClusters: Array<{ normal: [number, number, number]; center: [number, number, number]; area: number; outline: Array<[number, number, number]> }> = [];
  private flattenGroup: THREE.Group;
  private brimEarsGroup: THREE.Group;
  private layerRangeOverlays = new THREE.Group();
  private brimEarsActive = false;
  private measureActive = false;
  private measureSessionId = 0;
  private measurePoints: THREE.Vector3[] = [];
  private measureGroup = new THREE.Group();
  private unsubscribeMeasure: (() => void) | null = null;
  private explodeActive = false;
  private explodeFactor = 0;

  private objectMeshes: Map<string, THREE.Mesh> = new Map();
  private volumeMeshes: Map<string, THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>> = new Map();
  private selectedVolumeId: number | null = null;
  private hiddenMaterial = new THREE.MeshBasicMaterial({ visible: false });
  private overlayMeshes: Map<string, THREE.Mesh> = new Map();
  private geometries: Map<number, THREE.BufferGeometry> = new Map();
  private meshVolumes: Map<number, MeshVolumePartition[]> = new Map();
  /** Colour of each part: the filament it is assigned to. Parts without one use the fallback blue. */
  private volumeColors: Map<number, Map<number, string>> = new Map();

  private selectedObjectId: number | null = null;
  /** `objectId_instanceId` of the other selected instances; they follow the primary while it is dragged. */
  private extraKeys = new Set<string>();
  private dragStart: { primary: THREE.Vector3; extras: Map<THREE.Mesh, THREE.Vector3> } | null = null;
  private consumedTransformReleases = new WeakSet<PointerEvent>();
  private pointerDownId: number | null = null;
  private transformPointerId: number | null = null;
  private planeDrag: {
    pointerId: number; target: THREE.Mesh; plane: THREE.Plane; start: THREE.Vector3;
    origins: Map<THREE.Mesh, THREE.Vector3>; moved: boolean;
    orbitEnabled: boolean; transformEnabled: boolean;
    touchScale?: { origin: THREE.Vector3; clientY: number };
  } | null = null;
  private cancelPlaneKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !this.planeDrag) return;
    this.transformPointerId = this.planeDrag.pointerId;
    this.finishPlaneDrag(false);
    event.preventDefault();
    event.stopImmediatePropagation();
  };
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
  private unsubscribeCut: (() => void) | null = null;
  /** Editor-only cut plane, halves and connectors for the cut tool; see cutPreview.ts. */
  private cutPreview = new CutPreview();
  private resizeObserver: ResizeObserver;
  private intersectionObserver: IntersectionObserver;
  private hasVisibleSize = false;
  private initialViewportFit = true;
  private initialBedFit = true;
  private isInViewport = true;

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
    this.renderer.localClippingEnabled = true; // cut preview halves
    this.renderer.domElement.style.display = 'block';
    container.appendChild(this.renderer.domElement);

    // 4. OrbitControls: left rotate, right/middle pan, wheel zoom (matching desktop GLCanvas3D)
    this.orbitControls = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbitControls.target.set(cx, cy, 0);
    this.orbitControls.enableDamping = true;
    this.orbitControls.dampingFactor = 0.1;
    this.orbitControls.addEventListener('start', () => { this.initialBedFit = false; });
    this.orbitControls.addEventListener("change", () => this.requestDraw());
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
    this.scene.add(this.groupProxy);

    this.transformControls.addEventListener('objectChange', () => {
      this.requestDraw();
      if (this.groupDrag) { this.changeGroupDrag(); return; }
      const target = this.transformControls.object;
      if (!target || !this.dragStart) return;
      const delta = target.position.clone().sub(this.dragStart.primary);
      for (const [mesh, origin] of this.dragStart.extras) mesh.position.copy(origin).add(delta);
    });

    this.transformControls.addEventListener('dragging-changed', (event) => {
      if (event.value) this.transformPointerId = this.pointerDownId;
      if (this.transformControls.object === this.groupProxy) {
        if (event.value) this.beginGroupDrag(); else this.finishGroupDrag(true);
        return;
      }
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
    this.scene.add(this.cutPreview.group);
    this.scene.add(this.labelsGroup);
    this.scene.add(this.plateLabelGroup);
    this.scene.add(this.extraBedsGroup);
    this.scene.add(this.layerRangeOverlays);
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
      this.requestDraw();
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

    this.unsubscribeCut = useCutStore.subscribe(() => this.syncCutPreview());
    this.unsubscribeMeasure = useMeasureStore.subscribe((state, prevState) => {
      this.requestDraw();
      if (state.resetGeneration !== prevState.resetGeneration || (!state.feature1 && !state.feature2 && (prevState.feature1 || prevState.feature2))) {
        this.measurePoints = [];
        this.measureSessionId++;
        this.drawMeasure();
        this.callbacks.onMeasureChange?.([]);
      }
    });

    // Event listeners
    let transformEnabled = true;
    this.disposeTouch = bindCanvasTouch(this.renderer.domElement, {
      start: () => {
        transformEnabled = this.planeDrag?.transformEnabled ?? this.transformControls.enabled;
        this.transformControls.enabled = false;
      },
      end: () => { queueMicrotask(() => { this.transformControls.enabled = this.planeDrag ? false : transformEnabled; }); },
      singleStart: (event) => {
        this.onPointerDown(event, true);
        return this.planeDrag?.pointerId === event.pointerId;
      },
      singleMove: (event) => this.onPointerMove(event, true),
      singleEnd: (commit) => this.finishPlaneDrag(commit),
      resumePointer: (event) => (this.orbitControls as any)._onPointerDown(event),
      cancelPointer: (pointerId) => {
        const controls = this.orbitControls as any;
        if (controls._pointers.includes(pointerId)) controls._onPointerUp({ pointerId });
      },
      tap: (event) => {
        const hit = this.hitTest(event.clientX, event.clientY);
        this.callbacks.onSelect(hit?.objectId ?? null, hit?.instanceId ?? null, false, hit?.volumeId);
        this.renderer.domElement.dispatchEvent(new CustomEvent('canvas-touch-tap', { bubbles: true, detail: { x: event.clientX, y: event.clientY } }));
      },
      longpress: (point) => {
        this.renderer.domElement.dispatchEvent(new CustomEvent('canvas-longpress', { bubbles: true, detail: point }));
      }
    });
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown, true);
    this.renderer.domElement.addEventListener('pointermove', this.onPointerMove);
    this.renderer.domElement.addEventListener('pointerup', this.onPointerUp);
    this.renderer.domElement.addEventListener('pointerup', this.onTransformPointerUp, true);
    this.renderer.domElement.addEventListener('pointerleave', this.onPointerLeave);
    this.renderer.domElement.addEventListener('pointercancel', this.onPointerCancel);
    this.renderer.domElement.addEventListener('lostpointercapture', this.onPointerCancel);
    this.renderer.domElement.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('resize', this.onWindowResize);
    this.resizeObserver = new ResizeObserver(this.onWindowResize);
    this.resizeObserver.observe(container);

    // Prepare remains mounted while Preview is open. Cache visibility in observers,
    // so hidden geometry does not consume frames or force layout in the render loop.
    this.intersectionObserver = new IntersectionObserver(([entry]) => {
      this.isInViewport = entry.isIntersecting && entry.intersectionRect.width > 0 && entry.intersectionRect.height > 0;
      this.syncAnimation();
    });
    this.intersectionObserver.observe(container);
    document.addEventListener('visibilitychange', this.syncAnimation);
    this.themeObserver = new MutationObserver(() => this.requestDraw());
    this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    this.onWindowResize();
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
      outlineLine.name = 'bed-boundary';
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

  public setWipeTowerPreview(
    tower: { enabled: boolean; width?: number; depth?: number; height?: number; x?: number; y?: number; rotation?: number; brim?: number },
    origin: [number, number, number] = [0, 0, 0],
    index = 0,
    excludedArea: [number, number][] = [],
  ): void {
    const signature = JSON.stringify([tower, origin, index, excludedArea]);
    // The worker can return the same placement while the user is holding it.
    // Keep the existing mesh and pointer capture for an unchanged preview.
    if (this.towerPlacement?.signature === signature) return;
    this.requestDraw();
    if (this.towerPreview) {
      if (this.planeDrag?.target === this.towerPreview) this.finishPlaneDrag(false);
      this.scene.remove(this.towerPreview);
      this.towerPreview.geometry.dispose();
      (this.towerPreview.material as THREE.Material).dispose();
      this.towerPreview = null;
      this.towerPlacement = null;
    }
    if (!tower.enabled || !tower.width || !tower.depth || !tower.height) return;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(tower.width, tower.depth, tower.height),
      new THREE.MeshLambertMaterial({ color: 0x009688, flatShading: true, transparent: true, opacity: 0.58, depthWrite: false }));
    const rotation = (tower.rotation || 0) * Math.PI / 180;
    const localCenter = new THREE.Vector3(tower.width / 2, tower.depth / 2, tower.height / 2).applyAxisAngle(new THREE.Vector3(0, 0, 1), rotation);
    const anchorOffset = localCenter.add(new THREE.Vector3(...origin));
    mesh.position.copy(anchorOffset).add(new THREE.Vector3(tower.x ?? 0, tower.y ?? 0, 0));
    mesh.rotation.z = rotation;
    mesh.name = 'prime-tower-preview';
    this.towerPreview = mesh;
    this.towerPlacement = { index, anchorOffset, width: tower.width, depth: tower.depth, brim: Math.max(0, tower.brim ?? 0), excludedArea, signature };
    this.scene.add(mesh);
  }

  private towerFitsBed(center: THREE.Vector3): boolean {
    const tower = this.towerPlacement!;
    const anchor = center.clone().sub(tower.anchorOffset);
    const rotation = this.towerPreview!.rotation.z;
    const checkPolygon = (polygon: [number, number][], angle: number, margin: number, excluded = false) => {
      const sin = Math.sin(angle), cos = Math.cos(angle);
      const box = new THREE.Box3(new THREE.Vector3(-margin, -margin, -1),
        new THREE.Vector3(tower.width + margin, tower.depth + margin, 1));
      const points = polygon.map(([x, y]) => {
        const dx = x - anchor.x, dy = y - anchor.y;
        return new THREE.Vector3(dx * cos + dy * sin, dy * cos - dx * sin, 0);
      });
      const middle = box.getCenter(new THREE.Vector3());
      let inside = false;
      const ray = new THREE.Ray();
      const intersection = new THREE.Vector3();
      for (let i = 0; i < points.length; i++) {
        const a = points[i], b = points[(i + 1) % points.length];
        if (box.containsPoint(a)) return false;
        ray.origin.copy(a);
        ray.direction.subVectors(b, a).normalize();
        if (ray.intersectBox(box, intersection) && intersection.distanceToSquared(a) <= a.distanceToSquared(b)) return false;
        if ((a.y > middle.y) !== (b.y > middle.y) &&
            middle.x < a.x + (b.x - a.x) * (middle.y - a.y) / (b.y - a.y)) inside = !inside;
      }
      return inside !== excluded;
    };
    // Native slicing also reserves an unrotated box with a 15 mm automatic placement margin.
    const margin = 15 + tower.brim;
    const bed = this.bedConfig.points;
    return anchor.y >= margin && checkPolygon(bed, 0, margin) &&
      (!rotation || checkPolygon(bed, rotation, tower.brim)) &&
      (tower.excludedArea.length < 3 || checkPolygon(tower.excludedArea, rotation, tower.brim, true));
  }

  /** Invalidate pending artwork without hiding the usable JS bed. */
  public setBedLoading(loading: boolean): void {
    this.requestDraw();
    if (loading) this.bedAssetRevision++;
  }

  /** Decorative bed assets are kept outside object picking and never enter the slicing model. */
  public async setBedAssets(assets: { model?: string; texture?: string }): Promise<void> {
    this.setBedLoading(true);
    const revision = this.bedAssetRevision;
    let nextTexture: THREE.Texture | null = null;
    let nextPoints: [number, number][] | null = null;
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
      nextTexture = bedTexture;
    }));
    if (assets.model) tasks.push(loadBedModelOutline(assets.model).then((points) => {
      if (revision !== this.bedAssetRevision || this.isDestroyed) return;
      nextPoints = points;
    }));
    for (const result of await Promise.allSettled(tasks)) if (result.status === 'rejected') console.warn('[Bed assets]', result.reason);
    if (revision === this.bedAssetRevision && !this.isDestroyed) {
      delete this.scene.userData.lightTheme;
      this.bedTexture?.dispose();
      this.bedTexture = nextTexture;
      this.bedModelPoints = nextPoints;
      this.buildBed();
      this.rebuildPlates();
      this.setBedLoading(false);
      if (this.initialBedFit && this.hasVisibleSize) this.fitBed();
    } else (nextTexture as THREE.Texture | null)?.dispose();
  }

  private bedOutline(): [number, number][] {
    return displayBedOutline(this.bedConfig.points, this.bedModelPoints);
  }

  public setShowGrid(visible: boolean): void {
    this.requestDraw();
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
    this.requestDraw();
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
    this.requestDraw();
    if (this.towerPlacement && this.towerPlacement.index !== activeIndex) this.setWipeTowerPreview({ enabled: false });
    this.plates = plates.length > 0 ? plates : this.plates;
    this.activePlateIndex = activeIndex;
    this.rebuildPlates();
  }

  public orbitCamera(dx: number, dy: number): void {
    this.requestDraw();
    const controls = this.orbitControls as any;
    const height = this.renderer.domElement.clientHeight;
    if (!height || !controls.enabled) return;
    if (this.perspectiveOnOrbit && usePrefsStore.getState().display.autoPerspective) {
      this.setCameraType('perspective');
      usePrefsStore.getState().setDisplayPref('cameraType', 'perspective');
      this.perspectiveOnOrbit = false;
    }
    controls._rotateLeft(2 * Math.PI * dx * controls.rotateSpeed * (this.invertOrbitHorizontal ? -1 : 1) / height);
    controls._rotateUp(2 * Math.PI * dy * controls.rotateSpeed * (this.invertOrbitVertical ? -1 : 1) / height);
    controls.update();
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
    this.requestDraw();
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
    const boundary = this.bedGroup.getObjectByName("bed-boundary") as THREE.Line | undefined;
    if (boundary) (boundary.material as THREE.LineBasicMaterial).color.setHex(this.activePlateIndex === 0 ? 0x38bdf8 : 0x475569);
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
    const text = (value: string, font: string, height: number, color: string, align: 'left' | 'right', x: number, y: number, pencil = false, active = false) => {
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
      let texture = new THREE.CanvasTexture(canvas);
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(planeWidth, height),
        new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide })
      );
      if (pencil) {
        const dispose = attachHtmlPlateTitle(canvas, value, font, color, textWidth, (image) => {
          const imageWidth = height * (image.width / image.height);
          if (mesh.geometry.parameters.width !== imageWidth) {
            mesh.geometry.dispose();
            mesh.geometry = new THREE.PlaneGeometry(imageWidth, height);
          }
          mesh.position.x = align === 'left' ? x + imageWidth / 2 : x - imageWidth / 2;
          // Uploaded texture storage cannot change dimensions. The HTML badge
          // widens the first painted image; fallback can shrink it again.
          if (texture.image.width !== image.width || texture.image.height !== image.height) {
            const previous = texture;
            previous.removeEventListener('dispose', dispose);
            texture = new THREE.CanvasTexture(image);
            texture.addEventListener('dispose', dispose);
            mesh.material.map = texture;
            previous.dispose();
          } else {
            texture.image = image;
          }
          texture.needsUpdate = true;
          this.requestDraw();
        }, { active, activeLabel: translate('Active'), inactiveLabel: translate('Inactive') });
        texture.addEventListener('dispose', dispose);
      }
      mesh.position.set(align === 'left' ? x + planeWidth / 2 : x - planeWidth / 2, y, 0.05);
      mesh.name = 'plate-label';
      return mesh;
    };

    const light = this.isLightTheme();
    const orange = (active: boolean) => light
      ? (active ? '#b8420f' : 'rgba(184, 66, 15, 0.72)')
      : (active ? '#ff7a45' : 'rgba(255, 122, 69, 0.6)');
    for (const plate of this.plates) {
      const [ox, oy, oz] = plate.origin;
      const active = plate.index === this.activePlateIndex;
      // Like desktop: the two-digit number below the bed's front-right corner, the title above its back-left corner.
      const number = text(String(plate.index + 1).padStart(2, '0'), 'bold 96px sans-serif', size * 0.1, orange(active), 'right', ox + maxX, oy + minY - size * 0.05 - labelGap);
      number.position.z = oz + 0.05;
      this.plateLabelGroup.add(number);
      const title = plateTitle(plate.name, plate.index);
      const shown = title.length > 40 ? `${title.slice(0, 38)}...` : title;
      const label = text(shown, 'bold 64px sans-serif', size * 0.075, orange(active), 'left', ox + minX, oy + maxY + size * 0.0375 + labelGap, true, active);
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
    this.requestDraw();
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
    this.requestDraw();
    this.showBuildVolume = visible;
    if (this.buildVolumeHelper) {
      this.buildVolumeHelper.visible = visible;
    }
  }
  public getShowBuildVolume(): boolean {
    return this.showBuildVolume;
  }

  public setShowWireframe(visible: boolean): void {
    this.requestDraw();
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
    this.requestDraw();
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
    this.requestDraw();
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
    this.requestDraw();
    this.initialBedFit = false;
    this.fitBed();
  }

  private fitBed(): void {
    const bounds = new THREE.Box3();
    for (const { origin } of this.plates) {
      for (const [x, y] of this.bedOutline()) bounds.expandByPoint(new THREE.Vector3(x + origin[0], y + origin[1], origin[2]));
    }
    const { span } = this.plateLayout();
    this.fitBounds(bounds, new THREE.Vector3(0, -1.5, 1.2), span * Math.hypot(1.5, 1.2));
  }

  private fitBounds(bounds: THREE.Box3, direction: THREE.Vector3, minimumDistance: number): void {
    if (bounds.isEmpty()) return;
    const center = bounds.getCenter(new THREE.Vector3());
    const aspect = (this.container.clientWidth || 800) / (this.container.clientHeight || 600);
    const tan = Math.tan(THREE.MathUtils.degToRad(this.perspectiveCamera.fov / 2));
    this.orbitControls.target.copy(center);
    this.camera.position.copy(center).add(direction.clone().normalize());
    this.camera.lookAt(center);
    const inverse = this.camera.quaternion.clone().invert();
    let distance = minimumDistance;
    // In camera space each corner needs both horizontal and vertical clearance,
    // including its depth toward the camera. Keep the familiar desktop distance.
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
      const p = new THREE.Vector3(x, y, z).sub(center).applyQuaternion(inverse);
      distance = Math.max(distance, p.z + Math.max(Math.abs(p.x) / (tan * aspect * 0.9), Math.abs(p.y) / (tan * 0.9)));
    }
    this.camera.position.copy(center).addScaledVector(direction.normalize(), distance);
    this.perspectiveCamera.aspect = aspect;
    this.perspectiveCamera.zoom = 1;
    this.perspectiveCamera.updateProjectionMatrix();
    this.orthographicCamera.left = -distance * tan * aspect;
    this.orthographicCamera.right = distance * tan * aspect;
    this.orthographicCamera.top = distance * tan;
    this.orthographicCamera.bottom = -distance * tan;
    this.orthographicCamera.zoom = 1;
    this.orthographicCamera.updateProjectionMatrix();
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
    // Delay DOM allocation until first shown. Static sources request one paint;
    // position updates never recreate sources or request another rasterization.
    sprite.userData.startHtmlLabel = () => {
      sprite.userData.disposeHtmlLabel = attachHtmlObjectLabel(canvas, text, image => {
        texture.image = image;
        texture.needsUpdate = true;
          this.requestDraw();
      });
      delete sprite.userData.startHtmlLabel;
    };
    return sprite;
  }

  private updateLabels(): void {
    const activeKeys = new Set<string>();
    for (const [key, mesh] of this.objectMeshes.entries()) {
      activeKeys.add(key);
      let sprite = this.labelSprites.get(key);
      const name = mesh.userData?.name || 'Object';
      if (sprite && sprite.userData.name !== name) {
        sprite.userData.disposeHtmlLabel?.();
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
      if (this.showLabels) sprite.userData.startHtmlLabel?.();
      const center = new THREE.Vector3();
      box.getCenter(center);
      sprite.position.set(center.x, center.y, box.max.z + 10);
    }
    for (const [key, sprite] of Array.from(this.labelSprites.entries())) {
      if (!activeKeys.has(key)) {
        sprite.userData.disposeHtmlLabel?.();
        this.labelsGroup.remove(sprite);
        if (sprite.material.map) sprite.material.map.dispose();
        sprite.material.dispose();
        this.labelSprites.delete(key);
      }
    }
  }

  /** Sets the colour of each part of each object (`volumeId` to a CSS colour) and repaints the meshes. */
  public setVolumeColors(colors: Map<number, Map<number, string>>): void {
    this.requestDraw();
    this.volumeColors = colors;
    for (const objectId of this.geometries.keys()) this.applyVolumeColors(objectId);
    this.updateVolumeMaterials();
  }

  private updateVolumeMaterials(): void {
    const css = getComputedStyle(document.documentElement);
    for (const mesh of this.volumeMeshes.values()) {
      const { objectId, instanceId, volumeId, type } = mesh.userData;
      const selected = objectId === this.selectedObjectId && instanceId === this.selectedInstanceId &&
        (this.selectedVolumeId === null || volumeId === this.selectedVolumeId);
      const token = type === 'support_blocker' ? '--vp-support-blocker' : type === 'support_enforcer' ? '--vp-support-enforcer' : `--vp-${type}`;
      mesh.material.color.set(type === 'part' ? this.volumeColors.get(objectId)?.get(volumeId) || css.getPropertyValue('--vp-part').trim() : css.getPropertyValue(token).trim());
      mesh.material.emissive.copy(mesh.material.color).multiplyScalar(selected ? 0.25 : 0);
      mesh.material.wireframe = this.showWireframe;
    }
  }

  private viewerTargets(): THREE.Mesh[] {
    const volumes = [...this.volumeMeshes.values()].filter(mesh => mesh.visible && mesh.parent?.visible);
    return volumes.length ? volumes : [...this.objectMeshes.values()].filter(mesh => mesh.visible);
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
    this.requestDraw();
    this.bedConfig = bedConfig;
    this.buildBed();
    delete this.scene.userData.lightTheme;
    this.rebuildPlates();
    this.orbitControls.target.set(bedConfig.center[0], bedConfig.center[1], 0);
  }

  private objectGeneration = 0;

  public async setObjects(
    objects: PlateObject[],
    colorsForCommit?: () => Map<number, Map<number, string>> | null,
  ): Promise<boolean> {
    const generation = ++this.objectGeneration;
    const loaded = new Map();
    for (const obj of objects) {
      const mesh = await this.callbacks.getMesh(obj.id);
      if (this.isDestroyed || generation !== this.objectGeneration) return false;
      let viewer = null;
      try { viewer = await this.callbacks.getViewerMesh(obj.id); }
      catch (error) { console.error("[PlateScene] Viewer mesh unavailable:", error); }
      if (this.isDestroyed || generation !== this.objectGeneration) return false;
      loaded.set(obj.id, { mesh, viewer });
    }
    if (this.isDestroyed || generation !== this.objectGeneration) return false;
    const colors = colorsForCommit?.();
    if (colors === null) return false;
    // No awaits below: publish all scene mutations as one accepted update.
    if (colors) this.volumeColors = colors;
    this.finishGroupDrag(false);
    const activeKeys = new Set<string>();

    for (const obj of objects) {
      let geo = this.geometries.get(obj.id);
      if (geo?.userData.explodeOriginal) {
        (geo.getAttribute('position') as THREE.BufferAttribute).copyArray(geo.userData.explodeOriginal);
        delete geo.userData.explodeOriginal;
      }
      if (!geo) {
        try {
          const meshData = loaded.get(obj.id).mesh;
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
      } else if (geo.userData.meshData !== loaded.get(obj.id).mesh) {
        try {
          const meshData = loaded.get(obj.id).mesh;
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

      geo.userData.meshData = loaded.get(obj.id).mesh;
      this.applyVolumeColors(obj.id);
      const viewer: ViewerMeshData | null = loaded.get(obj.id).viewer;

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
        // Orca composes Rz * Ry * Rx; the gizmo reads the angles back in the same order.
        mesh.rotation.set(inst.rotation[0], inst.rotation[1], inst.rotation[2], 'ZYX');
        const mirror = inst.mirror ?? [1, 1, 1];
        mesh.scale.set(inst.scale[0] * mirror[0], inst.scale[1] * mirror[1], inst.scale[2] * mirror[2]);

        for (const part of viewer?.volumes ?? []) {
          const volumeKey = `${key}_${part.volumeId}`;
          activeKeys.add(volumeKey);
          let node = this.volumeMeshes.get(volumeKey);
          const positions = viewer!.positions.subarray(part.firstVertex * 3, (part.firstVertex + part.vertexCount) * 3);
          const old = node?.geometry.getAttribute('position').array;
          // Transform and colour changes reuse the geometry and its shared position buffer.
          if (!node || !old || node.userData.viewer !== viewer) {
            const indices = viewer!.indices.slice(part.firstFacet * 3, (part.firstFacet + part.facetCount) * 3);
            for (let i = 0; i < indices.length; i++) indices[i] -= part.firstVertex;
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geometry.setIndex(new THREE.BufferAttribute(indices, 1));
            geometry.computeVertexNormals();
            geometry.computeBoundingBox();
            geometry.computeBoundingSphere();
            if (node) { node.geometry.dispose(); node.geometry = geometry; }
            else {
              const translucent = part.type !== 'part';
              node = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({
                // Shared indexed vertices must not smooth lighting across part facets.
                flatShading: true,
                transparent: translucent, opacity: translucent ? 0.35 : 1,
                depthWrite: !translucent, side: THREE.DoubleSide,
              }));
              mesh.add(node);
              this.volumeMeshes.set(volumeKey, node);
            }
          }
          node.userData = { ...part, viewer, objectId: obj.id, instanceId: inst.id };
          node.position.fromArray(part.offset);
          node.rotation.set(...part.rotation, 'ZYX');
          node.scale.set(...part.scale.map((s, i) => s * (part.mirror?.[i] ?? 1)) as [number, number, number]);
        }

      }
    }

    // Remove any meshes that no longer exist
    for (const [key, node] of this.volumeMeshes) if (!activeKeys.has(key)) {
      if (this.transformControls.object === node) this.transformControls.detach();
      node.removeFromParent(); node.geometry.dispose(); node.material.dispose();
      this.volumeMeshes.delete(key);
    }
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
    this.syncCutPreview();
    this.updateViewerVisibility();
    this.updateVolumeMaterials();
    this.updateTransformControls();
    this.updateSelectionOutline();
    this.requestDraw();
    return true;
  }

  public setSelection(objectId: number | null, instanceId: number | null, extras: { objectId: number; instanceId: number }[] = [], volumeId: number | null = null): void {
    this.requestDraw();
    this.finishGroupDrag(false);
    this.selectedObjectId = objectId;
    this.selectedInstanceId = instanceId;
    this.selectedVolumeId = volumeId;
    this.extraKeys = new Set(volumeId === null ? extras.map((e) => `${e.objectId}_${e.instanceId}`) : []);

    for (const mesh of this.objectMeshes.values()) {
      const isSelected =
        objectId !== null &&
        instanceId !== null &&
        mesh.userData.objectId === objectId &&
        mesh.userData.instanceId === instanceId;

      mesh.material = isSelected || this.extraKeys.has(`${mesh.userData.objectId}_${mesh.userData.instanceId}`) ? this.selectedMaterial : this.defaultMaterial;
    }

    this.syncCutPreview();
    this.updateViewerVisibility();
    this.updateVolumeMaterials();
    this.updateTransformControls();
    this.updateSelectionOutline();
  }

  /** Follows the cut tool: preview the open cut on the target instance, and report its cut face to the store. */
  private syncCutPreview(): void {
    this.requestDraw();
    if (this.isDestroyed) return;
    const cut = useCutStore.getState();
    let target: THREE.Mesh | null = null;
    if (cut.isCutActive && !cut.lastResult?.success && cut.selectedObjectId !== null) {
      for (const mesh of this.objectMeshes.values()) {
        if (mesh.userData.objectId !== cut.selectedObjectId) continue;
        if (!target || (this.selectedObjectId === cut.selectedObjectId && mesh.userData.instanceId === this.selectedInstanceId)) target = mesh;
      }
    }
    const wasActive = this.cutPreview.active;
    const loops = this.cutPreview.update(target, target ? { ...cut, issues: getConnectorIssues(cut) } : null);
    if (wasActive && !target) {
      // The preview kept a material that may predate a selection change.
      for (const mesh of this.objectMeshes.values()) {
        const selected = mesh === this.getSelectedMesh() || this.extraKeys.has(`${mesh.userData.objectId}_${mesh.userData.instanceId}`);
        mesh.material = selected ? this.selectedMaterial : this.defaultMaterial;
      }
    }
    if (wasActive !== this.cutPreview.active) this.updateTransformControls();
    if (loops) cut.setSection(loops);
    else if (!target && cut.section) cut.setSection(null);
  }

  private updateTransformControls(): void {
    if (this.groupDrag) this.finishGroupDrag(false);
    const selected = this.getSelectedMesh();
    // Rotate and scale share a group pivot; translation keeps its existing mesh target.
    if (this.gizmoMode !== null && selected && (this.selectedVolumeId === null || selected.userData.volumeId !== undefined) && !this.isPaintingActive && !this.measureActive && !this.explodeActive && !this.cutPreview.active &&
        this.callbacks.canMoveObjects?.() !== false) {
      if (this.extraKeys.size && this.selectedVolumeId === null && this.gizmoMode !== 'translate') {
        const bounds = new THREE.Box3();
        for (const [key, mesh] of this.objectMeshes) if (mesh === selected || this.extraKeys.has(key)) bounds.expandByObject(mesh, true);
        bounds.getCenter(this.groupProxy.position);
        this.groupProxy.position.z = bounds.min.z;
        this.groupProxy.quaternion.identity(); this.groupProxy.scale.setScalar(1);
        this.transformControls.attach(this.groupProxy);
      } else this.transformControls.attach(selected);
    } else {
      this.transformControls.detach();
      this.transformControls.axis = null;
    }
  }

  private updateSelectionOutline(): void {
    const bounds = this.selectionBounds.makeEmpty();
    const selected = this.getSelectedMesh();
    if (selected?.userData.volumeId !== undefined) {
      selected.updateWorldMatrix(true, false);
      bounds.copy(selected.geometry.boundingBox!).applyMatrix4(selected.matrixWorld);
    }
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
    this.requestDraw();
    this.finishGroupDrag(false);
    this.gizmoMode = mode;
    if (mode !== null) this.transformControls.setMode(mode);
    this.updateTransformControls();
  }

  public setPaintingActive(active: boolean, volumeId?: number | null): void {
    this.requestDraw();
    this.isPaintingActive = active;
    this.paintingVolumeId = active ? (volumeId ?? null) : null;
    this.updateViewerVisibility();
    this.updateTransformControls();
  }

  public setAdvancedPainting(active: boolean, volumeId?: number | null): void {
    this.requestDraw();
    this.advancedPainting = active;
    this.setPaintingActive(active, volumeId);
    if (!active) this.paintCursor.setVisible(false);
  }

  public setPaintCursor(radius: number, tool: PaintTool): void {
    this.requestDraw();
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
    const intersects = raycaster.intersectObjects(this.viewerTargets(), false);
    if (intersects.length === 0) return null;

    const hit = intersects[0];
    const mesh = hit.object as THREE.Mesh;
    const objectId = mesh.userData?.objectId;
    const instanceId = mesh.userData?.instanceId;
    if (typeof objectId !== 'number') return null;

    let volumeId: number | undefined = mesh.userData.volumeId;
    const partitions = this.meshVolumes.get(objectId);
    if (volumeId === undefined && partitions && partitions.length > 0 && typeof hit.faceIndex === 'number') {
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
    this.requestDraw();
    for (const mesh of this.objectMeshes.values()) {
      if (mesh.userData.objectId === objectId) renderPaintOverlay(mesh, overlay, layer, colors);
    }
  }

  public clearToolOverlays(): void {
    this.requestDraw();
    for (const mesh of this.objectMeshes.values()) clearPaintOverlay(mesh);
  }

  public setPaintingVolumeId(volumeId: number | null): void {
    this.requestDraw();
    this.paintingVolumeId = volumeId;
  }

  public getMeshVolumes(objectId: number): MeshVolumePartition[] | undefined {
    return this.meshVolumes.get(objectId);
  }

  public getSelectedMesh(): THREE.Mesh | null {
    if (this.selectedObjectId === null) return null;
    if (this.selectedVolumeId !== null && !this.isPaintingActive && !this.cutPreview.active && !this.explodeActive && !this.flattenClusters.length) {
      const volume = this.volumeMeshes.get(`${this.selectedObjectId}_${this.selectedInstanceId}_${this.selectedVolumeId}`);
      if (volume) return volume;
    }
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

  private updateViewerVisibility(): void {
    const combined = this.isPaintingActive || this.cutPreview.active || this.explodeActive || this.flattenClusters.length > 0;
    for (const mesh of this.objectMeshes.values()) {
      const selected = mesh.userData.objectId === this.selectedObjectId && mesh.userData.instanceId === this.selectedInstanceId;
      const hasVolumes = [...this.volumeMeshes.values()].some(node => node.parent === mesh);
      mesh.material = combined || !hasVolumes ? (selected ? this.selectedMaterial : this.defaultMaterial) : this.hiddenMaterial;
    }
    for (const mesh of this.volumeMeshes.values()) mesh.visible = !combined;
  }

  public showFlattenClusters(clusters: Array<{ normal: [number, number, number]; center: [number, number, number]; area: number; outline: Array<[number, number, number]> }>): void {
    this.requestDraw();
    this.clearFlattenClusters();
    this.flattenClusters = clusters;
    this.updateViewerVisibility();
    const mesh = this.getSelectedMesh();
    if (!mesh) return;
    mesh.updateWorldMatrix(true, false);
    for (let i = 0; i < clusters.length; i++) {
      const c = clusters[i];
      if (c.outline && c.outline.length >= 3) {
        const patch = createFlattenPatch(c.outline, mesh.matrixWorld);
        patch.userData = { clusterIndex: i };
        this.flattenGroup.add(patch);
      }
    }
  }

  public clearFlattenClusters(): void {
    this.requestDraw();
    while (this.flattenGroup.children.length > 0) {
      const child = this.flattenGroup.children[0] as THREE.Mesh;
      child.geometry.dispose();
      if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
      else child.material.dispose();
      this.flattenGroup.remove(child);
    }
    this.flattenClusters = [];
    this.updateViewerVisibility();
  }

  /** Explode view spreads objects and their individual parts without changing engine transforms. */
  public setExplodeActive(active: boolean): void {
    this.requestDraw();
    if (this.explodeActive === active) return;
    this.explodeActive = active;
    this.updateViewerVisibility();
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
    this.requestDraw();
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
    this.requestDraw();
    if (this.measureActive === active) return;
    this.measureActive = active;
    if (active) this.transformControls.detach();
    else this.clearMeasure();
    this.setSelection(this.selectedObjectId, this.selectedInstanceId, [...this.extraKeys].map((k) => { const [objectId, instanceId] = k.split('_').map(Number); return { objectId, instanceId }; }));
  }

  public clearMeasure(): void {
    this.requestDraw();
    this.measureSessionId++;
    this.measurePoints = [];
    useMeasureStore.getState().resetSelection();
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

    // Advanced feature highlights
    const { feature1, feature2, result } = useMeasureStore.getState();
    const drawFeature = (feat: any, color: number) => {
      if (!feat) return;
      if (feat.type === 'circle' && feat.circle) {
        const c = feat.circle.center;
        const normArr = feat.circle.normal;
        const r = feat.circle.radius;
        if (!c || !normArr || typeof r !== 'number' || !Number.isFinite(r) || r <= 0) return;
        if (!c.every?.(Number.isFinite) || !normArr.every?.(Number.isFinite)) return;
        const n = new THREE.Vector3(...normArr);
        if (n.lengthSq() < 1e-6) n.set(0, 0, 1);
        else n.normalize();
        const curve = new THREE.EllipseCurve(0, 0, r, r, 0, 2 * Math.PI, false, 0);
        const pts = curve.getPoints(64).map((p) => new THREE.Vector3(p.x, p.y, 0));
        const geom = new THREE.BufferGeometry().setFromPoints(pts);
        const circleLine = new THREE.LineLoop(geom, new THREE.LineBasicMaterial({ color, depthTest: false }));
        circleLine.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
        circleLine.position.set(c[0], c[1], c[2]);
        circleLine.renderOrder = 11;
        this.measureGroup.add(circleLine as unknown as THREE.Mesh);

        const centerDot = new THREE.Mesh(new THREE.SphereGeometry(marker * 0.5, 8, 6), new THREE.MeshBasicMaterial({ color, depthTest: false }));
        centerDot.position.set(c[0], c[1], c[2]);
        centerDot.renderOrder = 11;
        this.measureGroup.add(centerDot);
      } else if (feat.type === 'edge' && feat.edge) {
        const sp = feat.edge.start;
        const ep = feat.edge.end;
        if (!sp || !ep || !sp.every?.(Number.isFinite) || !ep.every?.(Number.isFinite)) return;
        const geom = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(sp[0], sp[1], sp[2]),
          new THREE.Vector3(ep[0], ep[1], ep[2])
        ]);
        const edgeLine = new THREE.Line(geom, new THREE.LineBasicMaterial({ color, depthTest: false }));
        edgeLine.renderOrder = 11;
        this.measureGroup.add(edgeLine as unknown as THREE.Mesh);
      } else if (feat.type === 'plane' && feat.plane) {
        const orig = feat.plane.origin;
        if (!orig || !orig.every?.(Number.isFinite)) return;
        const planeMarker = new THREE.Mesh(new THREE.SphereGeometry(marker * 0.8, 12, 8), new THREE.MeshBasicMaterial({ color, depthTest: false }));
        planeMarker.position.set(orig[0], orig[1], orig[2]);
        planeMarker.renderOrder = 11;
        this.measureGroup.add(planeMarker);
      } else if (feat.type === 'point' && feat.point) {
        const pt = feat.point;
        if (!pt || !pt.every?.(Number.isFinite)) return;
        const ptMarker = new THREE.Mesh(new THREE.SphereGeometry(marker * 0.8, 12, 8), new THREE.MeshBasicMaterial({ color, depthTest: false }));
        ptMarker.position.set(pt[0], pt[1], pt[2]);
        ptMarker.renderOrder = 11;
        this.measureGroup.add(ptMarker);
      }
    };
    if (feature1) drawFeature(feature1, 0x00bcd4);
    if (feature2) drawFeature(feature2, 0x26a69a);

    const distInfo = result?.distanceStrict ?? result?.distanceInfinite;
    if (distInfo && distInfo.from && distInfo.to &&
        distInfo.from.every?.(Number.isFinite) && distInfo.to.every?.(Number.isFinite)) {
      const connGeom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(...distInfo.from),
        new THREE.Vector3(...distInfo.to)
      ]);
      const connLine = new THREE.Line(connGeom, new THREE.LineBasicMaterial({ color: 0x00e676, depthTest: false }));
      connLine.renderOrder = 12;
      this.measureGroup.add(connLine as unknown as THREE.Mesh);
    }
  }

  private pickMeasurePoint(e: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), this.camera);
    const hit = raycaster.intersectObjects(this.viewerTargets(), false)[0];
    if (!hit) return;

    const snapMode = useMeasureStore.getState().snapMode;
    const session = ++this.measureSessionId;

    // Normal point mode preserved
    if (snapMode === 'point') {
      useMeasureStore.getState().setError(null);
      this.measurePoints = this.measurePoints.length >= 2 ? [hit.point.clone()] : [...this.measurePoints, hit.point.clone()];
      this.drawMeasure();
      this.callbacks.onMeasureChange?.(this.measurePoints.map((p) => [p.x, p.y, p.z]));
      return;
    }

    // Explicit or auto feature selection: clear previous error on new click attempt
    useMeasureStore.getState().setError(null);

    const objectId = hit.object.userData?.objectId;
    const instanceId = hit.object.userData?.instanceId;
    const volumeId = hit.object.userData?.volumeId;
    const facetIndex = hit.faceIndex ?? 0;
    const position: [number, number, number] = [hit.point.x, hit.point.y, hit.point.z];

    if (typeof objectId !== 'number') {
      if (snapMode !== 'auto') {
        const label = snapMode === 'circle' ? 'circular' : snapMode === 'edge' ? 'edge' : 'planar';
        useMeasureStore.getState().setError(`No ${label} feature detected at selected position`);
      }
      return;
    }

    getMeasurementFeature({
      objectId,
      instanceId,
      volumeId,
      facetIndex,
      position,
      selection: snapMode,
    }).then(async (res) => {
      if (this.measureSessionId !== session || !this.measureActive) return;

      if (!res.success || !res.feature) {
        if (snapMode !== 'auto') {
          useMeasureStore.getState().setError(res.error || `No ${snapMode === 'circle' ? 'circular' : snapMode === 'edge' ? 'edge' : 'planar'} feature detected on selected face`);
        }
        return;
      }

      const s = useMeasureStore.getState();
      s.setError(null);
      this.measurePoints = []; // Feature mode uses native feature highlights, not basic point clicks

      const curF1 = s.feature1;
      const curF2 = s.feature2;
      if (!curF1 || (curF1 && curF2)) {
        s.setFeature1(res.feature);
        s.setFeature2(null);
        const mRes = await measureFeatures({ first: res.feature });
        if (this.measureSessionId !== session || !this.measureActive) return;
        if (!mRes.success && mRes.error) {
          s.setError(mRes.error);
        }
        useMeasureStore.getState().setResult(mRes);
      } else {
        s.setFeature2(res.feature);
        const mRes = await measureFeatures({ first: curF1, second: res.feature });
        if (this.measureSessionId !== session || !this.measureActive) return;
        if (!mRes.success && mRes.error) {
          s.setError(mRes.error);
        }
        useMeasureStore.getState().setResult(mRes);
      }
      this.drawMeasure();
    }).catch((err: any) => {
      if (this.measureSessionId !== session || !this.measureActive) return;
      if (snapMode !== 'auto') {
        useMeasureStore.getState().setError(err?.message || 'Feature detection failed');
      }
    });
  }

  public setBrimEarsActive(active: boolean): void {
    this.requestDraw();
    this.brimEarsActive = active;
  }

  public showBrimEars(points: Array<{ position: [number, number, number]; radius: number }>): void {
    this.requestDraw();
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
    this.requestDraw();
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
    this.requestDraw();
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
    this.requestDraw();
    this.isPaintingStroke = false;
    this.orbitControls.enabled = true;
  }

  public updatePaintingOverlay(
    objectId: number,
    paintingData: SupportPaintingData | null,
    targetVolumeId?: number | null
  ): void {
    this.requestDraw();
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

  private onPointerDown = (e: PointerEvent, modelTouch = false): void => {
    this.requestDraw();
    if (this.boxDrag) { e.preventDefault(); e.stopImmediatePropagation(); return; }
    this.canceledBoxPointer = null;
    if (e.pointerType === 'touch' && !modelTouch) return;
    if (this.planeDrag) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    this.pointerDownPos = { x: e.clientX, y: e.clientY };
    this.pointerDownId = e.pointerId;
    this.transformPointerId = null;
    if (!modelTouch && e.pointerType !== 'touch' && e.button === 0 && e.shiftKey && this.callbacks.canMoveObjects?.() !== false &&
        !this.isPaintingActive && !this.measureActive && !this.explodeActive && !this.brimEarsActive &&
        !this.flattenClusters.length && !this.cutPreview.active && !this.transformControls.dragging && !this.transformControls.axis) {
      if (this.boxDrag) return;
      const overlay = document.createElement('div');
      overlay.className = 'plate-box-selection';
      overlay.hidden = true;
      overlay.setAttribute('aria-hidden', 'true');
      this.renderer.domElement.parentElement!.append(overlay);
      this.boxDrag = { pointerId: e.pointerId, start: { x: e.clientX, y: e.clientY }, end: { x: e.clientX, y: e.clientY }, overlay, orbit: this.orbitControls.enabled, moved: false };
      this.orbitControls.enabled = false;
      this.renderer.domElement.setPointerCapture(e.pointerId);
      window.addEventListener('keydown', this.cancelBoxKey, true);
      e.preventDefault(); e.stopImmediatePropagation();
      return;
    }

    // Body dragging translates in XY independently of the active gizmo mode.
    // Tool handles and tools that operate on the surface retain their own gestures.
    if (e.button === 0 && !e.shiftKey && !e.ctrlKey && !e.metaKey && !this.isPaintingActive &&
        !this.measureActive && !this.explodeActive && !this.brimEarsActive && !this.flattenClusters.length &&
        !this.transformControls.dragging && (modelTouch || !this.transformControls.axis) && !this.cutPreview.active &&
        this.callbacks.canMoveObjects?.() !== false) {
      const raycaster = this.pointerRay(e);
      const targets = this.viewerTargets();
      if (this.towerPreview?.visible && this.towerPlacement) targets.push(this.towerPreview);
      const hit = raycaster.intersectObjects(targets, false)[0];
      if (hit) {
        const body = hit.object as THREE.Mesh;
        const tower = body === this.towerPreview;
        if (tower) {
          if (!this.callbacks.onMoveWipeTower || this.callbacks.canMoveWipeTower?.(this.towerPlacement!.index) === false) return;
        } else if ((this.selectedVolumeId !== null && body.userData.volumeId === undefined) ||
                   (modelTouch && this.gizmoMode !== null && this.gizmoMode !== 'translate' && this.gizmoMode !== 'scale')) return;
        const target = tower || body.userData.volumeId === undefined || this.selectedVolumeId !== null ? body : body.parent as THREE.Mesh;
        const touchScale = !tower && modelTouch && this.gizmoMode === 'scale';
        if (touchScale && (this.extraKeys.size > 0 || target !== this.getSelectedMesh())) return;
        const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -hit.point.z);
        const selected = target.userData.objectId === this.selectedObjectId && target.userData.instanceId === this.selectedInstanceId ||
          this.extraKeys.has(`${target.userData.objectId}_${target.userData.instanceId}`);
        const origins = new Map([[target, target.position.clone()]]);
        if (!tower && selected) for (const mesh of this.objectMeshes.values()) {
          if (mesh === this.getSelectedMesh() || this.extraKeys.has(`${mesh.userData.objectId}_${mesh.userData.instanceId}`)) origins.set(mesh, mesh.position.clone());
        }
        this.planeDrag = { pointerId: e.pointerId, target, plane, start: hit.point.clone(), origins, moved: false,
          orbitEnabled: this.orbitControls.enabled, transformEnabled: this.transformControls.enabled,
          touchScale: touchScale ? { origin: target.scale.clone(), clientY: e.clientY } : undefined };
        window.addEventListener('keydown', this.cancelPlaneKey, true);
        this.orbitControls.enabled = false;
        this.transformControls.enabled = false;
        this.renderer.domElement.setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
      }
    }

    if (modelTouch) return;

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

  private onPointerMove = (e: PointerEvent, modelTouch = false): void => {
    this.requestDraw();
    if (this.flattenClusters.length) {
      const mesh = this.getSelectedMesh();
      hoverFlattenPatch(this.flattenGroup, mesh ? pickFlattenPatch(this.pointerRay(e), this.flattenGroup, mesh) : null);
    }
    if (this.boxDrag?.pointerId === e.pointerId) {
      const drag = this.boxDrag;
      drag.end = { x: e.clientX, y: e.clientY };
      drag.moved ||= Math.hypot(e.clientX - drag.start.x, e.clientY - drag.start.y) > 5;
      const rect = selectionRect(drag.start, drag.end);
      const parent = drag.overlay.parentElement!.getBoundingClientRect();
      Object.assign(drag.overlay.style, { left: `${rect.left - parent.left}px`, top: `${rect.top - parent.top}px`, width: `${rect.right - rect.left}px`, height: `${rect.bottom - rect.top}px` });
      drag.overlay.hidden = !drag.moved;
      e.preventDefault(); e.stopImmediatePropagation(); return;
    }
    if (e.pointerType === 'touch' && !modelTouch) return;
    const drag = this.planeDrag;
    if (drag && drag.pointerId === e.pointerId) {
      const draggingTower = drag.target === this.towerPreview;
      if (!drag.moved && Math.hypot(e.clientX - this.pointerDownPos.x, e.clientY - this.pointerDownPos.y) <= (draggingTower ? 2 : 5)) return;
      const point = drag.touchScale ? null : this.pointerRay(e).ray.intersectPlane(drag.plane, new THREE.Vector3());
      if (!drag.touchScale && !point) return;
      if (!drag.moved) {
        drag.moved = true;
        if (!draggingTower && drag.origins.size === 1) this.callbacks.onSelect(drag.target.userData.objectId, drag.target.userData.instanceId, false, drag.target.userData.volumeId);
      }
      if (drag.touchScale) {
        // One finger on the selected body scales uniformly around its origin.
        const ratio = Math.exp(Math.max(-4, Math.min(4, (drag.touchScale.clientY - e.clientY) / 150)));
        drag.target.scale.copy(drag.touchScale.origin).multiplyScalar(ratio);
        return;
      }
      const delta = point!.sub(drag.start);
      delta.z = 0;
      if (draggingTower) {
        drag.target.position.copy(drag.origins.get(drag.target)!).add(delta);
        return;
      }
      for (const [mesh, origin] of drag.origins) {
        const localDelta = delta.clone();
        if (mesh.userData.volumeId !== undefined && mesh.parent) {
          mesh.parent.updateWorldMatrix(true, false);
          localDelta.applyMatrix3(new THREE.Matrix3().setFromMatrix4(mesh.parent.matrixWorld).invert());
        }
        mesh.position.copy(origin).add(localDelta);
      }
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

  private onTransformPointerUp = (e: PointerEvent): void => {
    this.requestDraw();
    // Capture runs before Three's pointerup listener ends the drag and clears axis.
    // Consume this event only, so cancellation/outside release cannot eat a later click.
    if (this.transformControls.dragging || this.transformPointerId === e.pointerId) this.consumedTransformReleases.add(e);
    if (this.transformPointerId === e.pointerId) this.transformPointerId = null;
  };

  private onPointerUp = (e: PointerEvent): void => {
    this.requestDraw();
    if (this.consumedTransformReleases.delete(e)) return;
    if (this.canceledBoxPointer === e.pointerId) { e.preventDefault(); e.stopImmediatePropagation(); return; }
    if (this.boxDrag) {
      if (this.boxDrag.pointerId !== e.pointerId) return;
      this.boxDrag.end = { x: e.clientX, y: e.clientY };
      if (this.finishBox(true)) { e.preventDefault(); e.stopImmediatePropagation(); return; }
    }
    if (e.pointerType === 'touch') return;
    if (this.planeDrag && this.planeDrag.pointerId !== e.pointerId) return;
    if (this.planeDrag?.pointerId === e.pointerId) {
      const moved = this.planeDrag.moved || this.planeDrag.target === this.towerPreview;
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

    // Placing connectors: clicks pick connectors or the new flat faces and never change the selection.
    if (this.cutPreview.connectorMode) {
      if (e.button !== 0) return;
      const pick = this.cutPreview.pick(this.pointerRay(e));
      const cut = useCutStore.getState();
      if (pick && 'connector' in pick) cut.selectConnector(pick.connector);
      else if (pick) cut.placeConnectorAt(pick.point[0], pick.point[1]);
      else cut.placeConnectorAt(NaN, NaN); // off the faces: only reports why nothing was placed
      return;
    }

    if (this.measureActive) {
      this.pickMeasurePoint(e);
      return;
    }

    if (this.explodeActive) {
      return;
    }

    if (this.flattenClusters.length > 0) {
      if (e.button !== 0) return;
      const selectedMesh = this.getSelectedMesh();
      if (selectedMesh) {
        const index = pickFlattenPatch(this.pointerRay(e), this.flattenGroup, selectedMesh);
        if (index !== null) this.callbacks.onFlattenFacetClick?.(index);
      }
      return;
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

      const meshes = this.viewerTargets();
      const intersects = raycaster.intersectObjects(meshes, false);

      if (intersects.length > 0 && typeof intersects[0].faceIndex === 'number') {
        const hit = intersects[0].object as THREE.Mesh;
        if (hit.userData) {
          const objectId = hit.userData.objectId;
          let volumeId: number | undefined = hit.userData.volumeId;
          const partitions = this.meshVolumes.get(objectId);
          if (volumeId === undefined && partitions && partitions.length > 0) {
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
    window.removeEventListener('keydown', this.cancelPlaneKey, true);
    this.orbitControls.enabled = drag.orbitEnabled;
    this.transformControls.enabled = drag.transformEnabled;
    if (this.renderer.domElement.hasPointerCapture(drag.pointerId)) this.renderer.domElement.releasePointerCapture(drag.pointerId);
    if (!commit) for (const [mesh, origin] of drag.origins) mesh.position.copy(origin);
    if (!commit && drag.touchScale) drag.target.scale.copy(drag.touchScale.origin);
    this.requestDraw();
    if (!commit || !drag.moved) return;
    if (drag.target === this.towerPreview && this.towerPlacement) {
      const { index, anchorOffset } = this.towerPlacement;
      const start = drag.origins.get(drag.target)!;
      if (start.distanceToSquared(drag.target.position) < 1e-8) return;
      if (this.callbacks.canMoveObjects?.() === false || this.callbacks.canMoveWipeTower?.(index) === false ||
          !this.towerFitsBed(drag.target.position)) {
        drag.target.position.copy(start);
        return;
      }
      const { x, y } = drag.target.position.clone().sub(anchorOffset);
      void this.callbacks.onMoveWipeTower?.(index, x, y).then(saved => {
        if (!saved && this.towerPreview === drag.target) {
          drag.target.position.copy(start);
          this.requestDraw();
        }
      });
      return;
    }
    this.commitMeshTransforms([...drag.origins.keys()], !drag.touchScale);
  }

  private commitMeshTransforms(meshes: THREE.Object3D[], translationOnly = false): void {
    this.measureSessionId++;
    if (this.measureActive) {
      this.clearMeasure();
    } else {
      useMeasureStore.getState().resetSelection();
    }
    for (const mesh of meshes) if (mesh.userData.volumeId !== undefined) {
      const transform = { offset: mesh.position.toArray() as [number, number, number] };
      this.callbacks.onVolumeTransformChange(mesh.userData.objectId, mesh.userData.volumeId,
        translationOnly || this.gizmoMode === 'translate' ? transform : {
          ...transform, rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
          scale: [Math.abs(mesh.scale.x), Math.abs(mesh.scale.y), Math.abs(mesh.scale.z)],
        });
    }
    meshes = meshes.filter(mesh => mesh.userData.volumeId === undefined);
    const entries = meshes.map(mesh => ({
      objectId: mesh.userData.objectId as number, instanceId: mesh.userData.instanceId as number,
      offset: mesh.position.toArray() as [number, number, number],
      rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z] as [number, number, number],
      scale: [Math.abs(mesh.scale.x), Math.abs(mesh.scale.y), Math.abs(mesh.scale.z)] as [number, number, number]
    }));
    if (entries.length > 1 && this.callbacks.onTransformMany) this.callbacks.onTransformMany(entries);
    else for (const entry of entries) this.callbacks.onTransformChange(entry.objectId, entry.instanceId, entry);
  }

  private onPointerCancel = (event?: PointerEvent): void => {
    this.requestDraw();
    this.finishGroupDrag(false);
    if (!event || this.boxDrag?.pointerId === event.pointerId) this.finishBox(false);
    if (event && this.planeDrag && this.planeDrag.pointerId !== event.pointerId) return;
    this.finishPlaneDrag(false);
    this.onPointerLeave();
  };

  private onPointerLeave = (): void => {
    this.requestDraw();
    if (this.flattenClusters.length) hoverFlattenPatch(this.flattenGroup, null);
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
    this.hasVisibleSize = width > 0 && height > 0;
    if (!this.hasVisibleSize) {
      this.syncAnimation();
      return;
    }
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
    if (this.initialViewportFit) {
      this.initialViewportFit = false;
      this.fitBed();
    }
    this.syncAnimation();
  };

  public requestDraw(): void { this.syncAnimation(); }

  private themeObserver: MutationObserver | null = null;

  private syncAnimation = (): void => {
    const visible = !this.isDestroyed && this.hasVisibleSize && this.isInViewport && !document.hidden;
    if (visible && this.animationFrameId === null) {
      this.animationFrameId = requestAnimationFrame(this.animate);
    } else if (!visible && this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  };

  private isLightTheme(): boolean {
    return document.documentElement.dataset.theme === 'light' && !this.container.closest('.wm-viewport');
  }

  private animate = (): void => {
    this.animationFrameId = null;
    if (this.isDestroyed || !this.hasVisibleSize || !this.isInViewport || document.hidden) return;

    const moving = this.orbitControls.update();
    this.cutPreview.frame();
    this.updateSelectionOutline();
    const light = this.isLightTheme();
    if (this.scene.userData.lightTheme !== light) {
      this.scene.userData.lightTheme = light;
      this.updateVolumeMaterials();
      (this.scene.background as THREE.Color).setHex(light ? 0xe7e9ec : 0x1e1e24);
      this.bedFloorMaterial?.color.setHex(this.bedTexture ? 0xffffff : light ? 0xd4d8dd : 0x27272a);
      this.rebuildPlates();
    }
    // See-through when the camera is below the bed, so parts stay visible from underneath.
    if (this.bedFloorMaterial) this.bedFloorMaterial.opacity = this.camera.position.z < 0 ? 0.25 : 1;
    this.renderer.render(this.scene, this.camera);
    if (moving) this.syncAnimation();
  };

  public getCameraQuaternion(): THREE.Quaternion {
    return this.camera.quaternion;
  }

  public setCameraView(view: CameraView): void {
    this.requestDraw();
    this.initialBedFit = false;
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
        const size = box.getSize(new THREE.Vector3());
        maxDim = Math.max(size.x, size.y, size.z);
        this.fitBounds(box, new THREE.Vector3(0, -1.5, 1), maxDim * Math.hypot(1.5, 1));
      } else {
        this.fitBed();
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
    for (const node of this.volumeMeshes.values()) {
      savedChildOverlays.set(node, node.visible);
      node.visible = false;
    }
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
    this.cutPreview.setSuspended(true);
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
      this.cutPreview.setSuspended(false);
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

  public updateLayerRangeOverlays(
    objectId: number | null,
    ranges?: Array<{ minZ: number; maxZ: number }> | null,
    selectedRangeIndex?: number | null
  ): void {
    this.requestDraw();
    while (this.layerRangeOverlays.children.length > 0) {
      const child = this.layerRangeOverlays.children[0] as THREE.Mesh;
      if (child.geometry) child.geometry.dispose();
      if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
      else if (child.material) child.material.dispose();
      this.layerRangeOverlays.remove(child);
    }

    if (objectId === null || !ranges || ranges.length === 0) return;

    let targetMesh: THREE.Mesh | null = null;
    for (const mesh of this.objectMeshes.values()) {
      if (mesh.userData.objectId === objectId) {
        targetMesh = mesh;
        break;
      }
    }
    if (!targetMesh) return;

    targetMesh.geometry.computeBoundingBox();
    const bbox = targetMesh.geometry.boundingBox;
    if (!bbox) return;

    const sizeX = Math.max(1, (bbox.max.x - bbox.min.x) * targetMesh.scale.x);
    const sizeY = Math.max(1, (bbox.max.y - bbox.min.y) * targetMesh.scale.y);
    const posX = targetMesh.position.x + ((bbox.max.x + bbox.min.x) / 2) * targetMesh.scale.x;
    const posY = targetMesh.position.y + ((bbox.max.y + bbox.min.y) / 2) * targetMesh.scale.y;
    const baseZ = targetMesh.position.z;

    ranges.forEach((range, idx) => {
      const rangeHeight = Math.max(0.1, range.maxZ - range.minZ);
      const centerZ = baseZ + range.minZ + rangeHeight / 2;
      const isSelected = selectedRangeIndex === idx;

      const geom = new THREE.BoxGeometry(sizeX * 1.05, sizeY * 1.05, rangeHeight);
      const mat = new THREE.MeshBasicMaterial({
        color: isSelected ? 0x00e5ff : 0x009688,
        transparent: true,
        opacity: isSelected ? 0.35 : 0.18,
        depthWrite: false
      });
      const bandMesh = new THREE.Mesh(geom, mat);
      bandMesh.position.set(posX, posY, centerZ);
      this.layerRangeOverlays.add(bandMesh);

      const edges = new THREE.EdgesGeometry(geom);
      const line = new THREE.LineSegments(
        edges,
        new THREE.LineBasicMaterial({
          color: isSelected ? 0x00ffff : 0x00b4a0,
          transparent: true,
          opacity: isSelected ? 0.8 : 0.4
        })
      );
      line.position.copy(bandMesh.position);
      this.layerRangeOverlays.add(line);
    });
  }

  public destroy(): void {
    this.finishGroupDrag(false);
    this.finishBox(false);
    this.setWipeTowerPreview({ enabled: false });
    this.disposeChildren(this.plateLabelGroup);
    this.bedAssetRevision++;
    this.bedTexture?.dispose();
    this.isDestroyed = true;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    this.themeObserver?.disconnect();
    this.unsubscribePrefs?.();
    this.unsubscribePrefs = null;
    this.unsubscribeCut?.();
    this.unsubscribeCut = null;
    this.unsubscribeMeasure?.();
    this.unsubscribeMeasure = null;
    this.cutPreview.dispose();

    this.finishPlaneDrag(false);
    this.disposeTouch();
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown, true);
    this.renderer.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.renderer.domElement.removeEventListener('pointerup', this.onPointerUp);
    this.renderer.domElement.removeEventListener('pointerup', this.onTransformPointerUp, true);
    this.renderer.domElement.removeEventListener('pointerleave', this.onPointerLeave);
    this.renderer.domElement.removeEventListener('pointercancel', this.onPointerCancel);
    this.renderer.domElement.removeEventListener('lostpointercapture', this.onPointerCancel);
    this.renderer.domElement.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('resize', this.onWindowResize);
    this.resizeObserver.disconnect();
    this.intersectionObserver.disconnect();
    document.removeEventListener('visibilitychange', this.syncAnimation);

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
    this.updateLayerRangeOverlays(null, null);
    this.scene.remove(this.layerRangeOverlays);

    for (const sprite of this.labelSprites.values()) {
      sprite.userData.disposeHtmlLabel?.();
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
    for (const node of this.volumeMeshes.values()) { node.geometry.dispose(); node.material.dispose(); }
    this.volumeMeshes.clear();
    this.hiddenMaterial.dispose();

    this.defaultMaterial.dispose();
    this.selectedMaterial.dispose();
    this.renderer.dispose();

    if (this.renderer.domElement.parentElement) {
      this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
    }
  }
}
