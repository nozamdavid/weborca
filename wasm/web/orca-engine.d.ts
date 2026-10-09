/**
 * Type declarations for OrcaSlicer WebAssembly page API.
 */

export interface CreateEngineOptions {
  workerUrl?: string;
  moduleUrl?: string;
  profilesUrl?: string;
  threads?: number;
}

export interface VendorSummary {
  name: string;
  printers: number;
  processes: number;
  filaments: number;
}

export interface LoadVendorsResult {
  vendors: VendorSummary[];
}

export interface PresetItem {
  name: string;
  vendor: string;
  isSystem: boolean;
  isCompatible: boolean;
  inherits: string;
}

export interface ListPresetsOptions {
  compatibleOnly?: boolean;
}

export interface SelectPresetsOptions {
  printer: string;
  process: string;
  filaments: string | string[];
}

export interface SelectedPresetsResult {
  printer: string;
  process: string;
  filaments: string[];
}

export interface OptionError {
  key: string;
  error: string;
}

export interface SetOptionsResult {
  errors: OptionError[];
}

export interface ModelObjectInfo {
  name: string;
  instances: number;
  volumes: number;
  size: [number, number, number];
}

export interface LoadModelResult {
  objects: ModelObjectInfo[];
}

export interface ProgressNotification {
  jobId: number;
  percent?: number;
  text?: string;
}

export interface SliceOptions {
  onProgress?: (progress: ProgressNotification) => void;
  signal?: AbortSignal;
  threads?: number;
  outPath?: string;
  plateIndex?: number;
}

export interface SliceResult {
  gcode: Uint8Array;
  gcodePath: string;
  gcodeBytes: number;
  layers: number;
  printTimeS: number;
  filamentMm: number;
  filamentG: number;
  warnings: string[];
}

export interface ConfigOptionDef {
  type: string;
  label?: string;
  fullLabel?: string;
  category?: string;
  tooltip?: string;
  sidetext?: string;
  mode: 'simple' | 'advanced' | 'expert' | 'develop';
  min?: number;
  max?: number;
  default?: string;
  enumValues?: string[];
  enumLabels?: string[];
  nullable?: boolean;
  readonly?: boolean;
  multiline?: boolean;
  guiType?: string;
  guiFlags?: string;
}

export interface FieldState {
  enabled: boolean;
  visible: boolean;
  label?: string;
}

export interface RuleFix {
  key: string;
  value: string;
  reason: string;
}

export interface EvaluateRulesResult {
  fields: Record<string, FieldState>;
  fixes: RuleFix[];
  messages: string[];
  context: any;
}

export interface PlateInstanceRef {
  objectId: number;
  instanceId: number;
  objectIndex: number;
  instanceIndex: number;
}

export interface PlateInfo {
  index: number;
  name: string;
  locked: boolean;
  origin: [number, number, number];
  size: [number, number, number];
  instances: PlateInstanceRef[];
  config: Record<string, string>;
  filamentMaps?: Record<string, string>;
}

export interface FacetAnnotationItem {
  facetId: number;
  state: 'enforcer' | 'blocker' | 'none';
  type: number;
}

export interface SupportPaintingStats {
  enforcersCount: number;
  blockersCount: number;
  totalPainted: number;
}

export interface SupportPaintingInfo {
  objectId: number;
  volumeId: number;
  triangleCount: number;
  hasCustomSupports: boolean;
  enforcers: number[];
  blockers: number[];
  facets: FacetAnnotationItem[];
  queriedFacets?: FacetAnnotationItem[];
  statistics: SupportPaintingStats;
}

export interface SetSupportPaintingParams {
  objectId: number;
  volumeId?: number;
  volumeIndex?: number;
  reset?: boolean;
  facets?: Array<{ facetId: number; state: number | string } | [number, number | string]>;
  enforcers?: number[];
  blockers?: number[];
  clear?: number[];
  facetId?: number;
  state?: number | string;
}

export interface SetSupportPaintingResult {
  updated: boolean;
  objectId: number;
  volumeId: number;
  triangleCount: number;
  enforcersCount: number;
  blockersCount: number;
  modifiedCount: number;
}

export interface ClearSupportPaintingParams {
  objectId: number;
  volumeId?: number;
  volumeIndex?: number;
}

export interface ClearSupportPaintingResult {
  cleared: boolean;
  objectId: number;
  volumeId: number;
}

export interface SeamPaintingStats {
  enforcersCount: number;
  blockersCount: number;
  totalPainted: number;
}

export interface SeamPaintingInfo {
  objectId: number;
  volumeId: number;
  triangleCount: number;
  hasCustomSeam: boolean;
  hasCustomSeams?: boolean;
  enforcers: number[];
  blockers: number[];
  facets: FacetAnnotationItem[];
  queriedFacets?: FacetAnnotationItem[];
  statistics: SeamPaintingStats;
}

export interface SetSeamPaintingParams {
  objectId: number;
  volumeId?: number;
  volumeIndex?: number;
  reset?: boolean;
  facets?: Array<{ facetId: number; state: number | string } | [number, number | string]>;
  enforcers?: number[];
  blockers?: number[];
  clear?: number[];
  facetId?: number;
  state?: number | string;
}

export interface SetSeamPaintingResult {
  updated: boolean;
  objectId: number;
  volumeId: number;
  triangleCount: number;
  enforcersCount: number;
  blockersCount: number;
  modifiedCount: number;
}

export interface ClearSeamPaintingParams {
  objectId: number;
  volumeId?: number;
  volumeIndex?: number;
}

export interface ClearSeamPaintingResult {
  cleared: boolean;
  objectId: number;
  volumeId: number;
}

export interface MeshVolumePartition {
  volumeId: number;
  firstFacet: number;
  facetCount: number;
}

export interface GetMeshResult {
  path: string;
  vertexCount: number;
  triangleCount: number;
  buffer: Uint8Array;
  volumes?: MeshVolumePartition[];
}

export interface CutPlane {
  point: [number, number, number];
  normal: [number, number, number];
}

export interface CutObjectParams {
  objectId: number;
  instanceIndex?: number;
  instanceId?: number;
  z?: number;
  plane?: CutPlane;
  coordinateSystem?: 'world' | 'object';
  keepUpper?: boolean;
  keepLower?: boolean;
  keepMode?: 'both' | 'upper' | 'lower';
  keepAsParts?: boolean;
  placeOnCutUpper?: boolean;
  placeOnCutLower?: boolean;
  flipUpper?: boolean;
  flipLower?: boolean;
  keepPaint?: boolean;
}

export interface CutObjectCreatedItem {
  id: number;
  name: string;
  part: 'upper' | 'lower' | 'parts';
  volume: number;
  openEdges: number;
  boundingBox: {
    min: [number, number, number];
    max: [number, number, number];
  };
  volumes: Array<{
    id: number;
    name: string;
    volume: number;
    openEdges: number;
  }>;
}

export interface CutObjectResult {
  success: boolean;
  error?: string;
  objectId?: number;
  createdObjects?: CutObjectCreatedItem[];
}

export type CutConnectorType = 'plug' | 'dowel' | 'snap';
export type CutConnectorStyle = 'prism' | 'frustum';
export type CutConnectorShape = 'circle' | 'triangle' | 'square' | 'hexagon';

export interface CutConnectorAttributes {
  type?: CutConnectorType;
  style?: CutConnectorStyle;
  shape?: CutConnectorShape;
  size?: number;
  radius?: number;
  diameter?: number;
  depthRatio?: number;
  depth?: number;
  height?: number;
  rotationDeg?: number;
  rotation?: number;
  angle?: number;
  tolerance?: number;
  radiusTolerance?: number;
  heightTolerance?: number;
  targetHalf?: 'upper' | 'lower';
  plugHalf?: 'upper' | 'lower';
}

export interface CutConnectorParam {
  pos?: [number, number, number];
  position?: [number, number, number];
  attrs?: CutConnectorAttributes;
  type?: CutConnectorType;
  style?: CutConnectorStyle;
  shape?: CutConnectorShape;
  size?: number;
  radius?: number;
  diameter?: number;
  depthRatio?: number;
  depth?: number;
  height?: number;
  rotationDeg?: number;
  rotation?: number;
  angle?: number;
  tolerance?: number;
  radiusTolerance?: number;
  heightTolerance?: number;
  targetHalf?: 'upper' | 'lower';
  plugHalf?: 'upper' | 'lower';
}

export interface CutObjectWithConnectorsParams {
  objectId?: number;
  id?: number;
  instanceIndex?: number;
  instanceId?: number;
  z?: number;
  plane?: CutPlane;
  coordinateSystem?: 'world' | 'object';
  keepUpper?: boolean;
  keepLower?: boolean;
  keepMode?: 'both' | 'upper' | 'lower';
  keepAsParts?: boolean;
  placeOnCutUpper?: boolean;
  placeOnCutLower?: boolean;
  flipUpper?: boolean;
  flipLower?: boolean;
  keepPaint?: boolean;
  connectors?: CutConnectorParam[];
}

export interface CutConnectorVolumeInfo {
  id: number;
  name: string;
  type: string;
  volume: number;
  scalingFactor: [number, number, number];
  offset: [number, number, number];
  boundingBox: {
    min: [number, number, number];
    max: [number, number, number];
  };
  openEdges: number;
}

export interface CutConnectorCreatedObject {
  id: number;
  name: string;
  part: 'upper' | 'lower' | 'parts' | 'dowel';
  volume: number;
  volumeIsBooleanResult: false;
  openEdges: number;
  boundingBox: {
    min: [number, number, number];
    max: [number, number, number];
  };
  volumes: CutConnectorVolumeInfo[];
}

export interface CutObjectWithConnectorsResult {
  success: boolean;
  error?: string;
  objectId?: number;
  connectorCount?: number;
  fitValidated: false;
  createdObjects?: CutConnectorCreatedObject[];
}

export interface MeshHealthVolumeInfo {
  volumeId: number;
  volumeIndex: number;
  name: string;
  isManifold: boolean;
  openEdges: number;
  facetsCount: number;
  numberOfParts: number;
  degenerateFacets: number;
  facetsReversed: number;
  edgesFixed: number;
  facetsRemoved: number;
  backwardsEdges: number;
  volume: number;
  boundingBox: [number, number, number, number, number, number];
}

export interface GetMeshHealthParams {
  objectId?: number;
  id?: number;
  volumeId?: number;
  volumeIndex?: number;
}

export interface MeshHealthResult {
  success: boolean;
  objectId: number;
  isManifold: boolean;
  openEdges: number;
  facetsCount: number;
  numberOfParts: number;
  degenerateFacets: number;
  facetsReversed: number;
  edgesFixed: number;
  facetsRemoved: number;
  backwardsEdges: number;
  volume: number;
  boundingBox: [number, number, number, number, number, number];
  volumes: MeshHealthVolumeInfo[];
}

export interface RepairObjectParams {
  objectId?: number;
  id?: number;
  volumeId?: number;
  volumeIndex?: number;
  keepPainting?: boolean;
  splitParts?: boolean;
}

export interface RepairObjectResult {
  success: boolean;
  wasRepaired: boolean;
  objectId: number;
  error?: string;
  isManifold?: boolean;
  openEdgesBefore?: number;
  openEdgesAfter?: number;
  degenerateFacetsBefore?: number;
  degenerateFacetsAfter?: number;
  facetsReversed?: number;
  edgesFixed?: number;
  facetsRemoved?: number;
  facetsBefore?: number;
  facetsAfter?: number;
  volumeBefore?: number;
  volumeAfter?: number;
  numberOfPartsBefore?: number;
  numberOfPartsAfter?: number;
  volumes?: MeshHealthVolumeInfo[];
}


export interface LayerRange {
  bottom: number;
  top: number;
  height: number;
}

export interface LayerHeightProfileResult {
  objectId: number;
  profile: number[];
  layerCount: number;
  layers: number[];
  ranges: LayerRange[];
  success?: boolean;
  cleared?: boolean;
  hasCustomProfile?: boolean;
  minLayerHeight?: number;
  maxLayerHeight?: number;
  nominalHeight?: number;
  firstLayerHeight?: number;
  objectHeight?: number;
}

export interface TextParams {
  objectId?: number;
  volumeType?: 'new_object' | 'part' | 'modifier' | 'negative';
  text: string;
  fontPath?: string;
  fontData?: string;
  fontName?: string;
  size?: number;
  depth?: number;
  position?: [number, number, number];
  normal?: [number, number, number];
  rotation?: number;
  name?: string;
}

export interface TextResult {
  objectId: number;
  volumeId: number;
  name: string;
  triangleCount: number;
  boundingBox: [number, number, number, number, number, number];
}

export interface TextInfo {
  objectId: number;
  volumeId: number;
  name: string;
  text: string;
  fontName: string;
  fontPath: string;
  size: number;
  depth: number;
  useSurface: boolean;
  charGap: number;
  lineGap: number;
  boldness: number;
  skew: number;
  align: { horizontal: 'left' | 'center' | 'right'; vertical: 'top' | 'center' | 'bottom' };
}


export interface LayerEvent {
  printZ: number;
  type: 'pause' | 'custom' | string;
  gcode?: string;
  message?: string;
  extruder?: number;
  color?: string;
  extra?: string;
}

export interface GetLayerEventsParams {
  plateIndex?: number;
}

export interface GetLayerEventsResult {
  plateIndex: number;
  count: number;
  events: LayerEvent[];
}

export interface SetLayerEventsParams {
  plateIndex?: number;
  events: LayerEvent[];
}

export interface SetLayerEventsResult {
  plateIndex: number;
  count: number;
  events: LayerEvent[];
}

export interface ClearLayerEventsParams {
  plateIndex?: number;
  printZ?: number;
  allPlates?: boolean;
}

export interface ClearLayerEventsResult {
  plateIndex?: number;
  allPlates?: boolean;
  clearedCount: number;
  remainingCount: number;
}

export class OrcaEngine {
  protected constructor(worker: Worker, options: CreateEngineOptions);

  static create(options?: CreateEngineOptions): Promise<OrcaEngine>;

  call(method: string, args?: any, options?: any): Promise<any>;

  loadVendors(names?: string[]): Promise<LoadVendorsResult>;

  listPresets(
    kind: 'printer' | 'process' | 'filament',
    options?: ListPresetsOptions
  ): Promise<PresetItem[]>;

  selectPresets(selection: SelectPresetsOptions): Promise<SelectedPresetsResult>;

  getConfig(): Promise<Record<string, string>>;

  getConfigDef(keys?: string[]): Promise<Record<string, ConfigOptionDef>>;

  evaluateRules(options?: {
    kind: 'print' | 'printer' | 'filament' | 'sla_print' | 'sla_material';
    filamentIndex?: number;
  }): Promise<EvaluateRulesResult>;

  setOptions(options: Record<string, string>): Promise<SetOptionsResult>;

  resetOptions(): Promise<Record<string, never>>;

  loadModel(fileName: string, bytes: Uint8Array | ArrayBuffer): Promise<LoadModelResult>;

  addModel(fileName: string, bytes: Uint8Array | ArrayBuffer): Promise<LoadModelResult>;

  listObjects(): Promise<Array<any>>;

  getMesh(objectId: number): Promise<GetMeshResult>;

  setInstanceTransform(params: {
    objectId: number;
    instanceId: number;
    offset?: [number, number, number];
    rotation?: [number, number, number];
    scale?: [number, number, number] | number;
  }): Promise<Record<string, never>>;

  deleteObject(objectId: number): Promise<Record<string, never>>;

  duplicateInstance(objectId: number, instanceId: number): Promise<{ instanceId: number; id: number }>;

  arrange(options?: { useBed?: boolean }): Promise<Record<string, never>>;

  getObjectTree(): Promise<{ objects: Array<any> }>;

  addVolume(params: {
    objectId: number;
    type: string;
    shape: string;
    size?: number[] | number;
    offset?: number[];
    name?: string;
  }): Promise<{ volumeId: number; id: number; name: string }>;

  deleteVolume(objectId: number, volumeId: number): Promise<Record<string, never>>;

  renameObject(objectId: number, name: string): Promise<Record<string, never>>;

  renameVolume(objectId: number, volumeId: number, name: string): Promise<Record<string, never>>;

  setObjectConfig(params: {
    objectId: number;
    volumeId?: number;
    options: Record<string, string>;
  }): Promise<{ errors: Array<{ key: string; error: string }> }>;

  resetObjectConfig(params: {
    objectId: number;
    volumeId?: number;
    keys?: string[];
  }): Promise<Record<string, never>>;

  setVolumeExtruder(objectId: number, volumeId: number, extruder: number): Promise<Record<string, never>>;

  listPlates(): Promise<Array<PlateInfo>>;

  addPlate(params?: { name?: string; config?: Record<string, string> }): Promise<Array<PlateInfo>>;

  deletePlate(plateIndex: number, deleteObjects?: boolean): Promise<Array<PlateInfo>>;

  setPlateConfig(params: {
    plateIndex: number;
    config?: Record<string, string>;
    name?: string;
    locked?: boolean;
  }): Promise<Record<string, never>>;

  getSupportPainting(
    objectId: number | { objectId: number; volumeId?: number; volumeIndex?: number; facetIds?: number[] },
    volumeId?: number
  ): Promise<SupportPaintingInfo>;

  setSupportPainting(params: SetSupportPaintingParams): Promise<SetSupportPaintingResult>;

  clearSupportPainting(
    objectId: number | ClearSupportPaintingParams,
    volumeId?: number
  ): Promise<ClearSupportPaintingResult>;

  getSeamPainting(
    objectId: number | { objectId: number; volumeId?: number; volumeIndex?: number; facetIds?: number[] },
    volumeId?: number
  ): Promise<SeamPaintingInfo>;

  setSeamPainting(params: SetSeamPaintingParams): Promise<SetSeamPaintingResult>;

  clearSeamPainting(
    objectId: number | ClearSeamPaintingParams,
    volumeId?: number
  ): Promise<ClearSeamPaintingResult>;

  cutObject(params: CutObjectParams): Promise<CutObjectResult>;
  cutObjectWithConnectors(params: CutObjectWithConnectorsParams): Promise<CutObjectWithConnectorsResult>;

  getMeshHealth(params: GetMeshHealthParams): Promise<MeshHealthResult>;
  checkMeshHealth(params: GetMeshHealthParams): Promise<MeshHealthResult>;
  repairObject(params: RepairObjectParams): Promise<RepairObjectResult>;
  repairMesh(params: RepairObjectParams): Promise<RepairObjectResult>;


  paintStroke(params: Record<string, unknown>): Promise<{ changed: boolean; stats: Record<string, number> }>;
  getPaintOverlay(params: Record<string, unknown>): Promise<{ path: string; buffer: Uint8Array; states: Array<{ state: string; firstTriangle: number; triangleCount: number }> }>;
  getPaintData(params: Record<string, unknown>): Promise<{ data: string }>;
  setPaintData(params: Record<string, unknown>): Promise<unknown>;
  clearPaint(params: Record<string, unknown>): Promise<unknown>;

  getLayerHeightProfile(params: { objectId: number }): Promise<LayerHeightProfileResult>;
  setLayerHeightProfile(params: { objectId: number; profile: number[] }): Promise<LayerHeightProfileResult>;
  adaptiveLayerHeights(params: { objectId: number; quality?: number }): Promise<LayerHeightProfileResult>;
  smoothLayerHeights(params: { objectId: number; radius?: number; keepMin?: boolean }): Promise<LayerHeightProfileResult>;
  adjustLayerHeights(params: { objectId: number; z: number; delta?: number; bandWidth?: number; action?: 'increase' | 'decrease' | 'smooth' | 'reduce' }): Promise<LayerHeightProfileResult>;
  resetLayerHeights(params: { objectId: number }): Promise<LayerHeightProfileResult>;
  getObjectLayers(params: { objectId: number }): Promise<{ objectId: number; layerCount: number; layers: number[]; ranges: LayerRange[] }>;

  addText(params: TextParams): Promise<TextResult>;
  updateText(params: Partial<TextParams> & { objectId: number; volumeId: number }): Promise<TextResult>;
  getText(params: { objectId: number; volumeId: number }): Promise<TextInfo>;

  getLayerEvents(params?: GetLayerEventsParams): Promise<GetLayerEventsResult>;
  setLayerEvents(params: SetLayerEventsParams): Promise<SetLayerEventsResult>;
  clearLayerEvents(params?: ClearLayerEventsParams): Promise<ClearLayerEventsResult>;

  slice(options?: SliceOptions): Promise<SliceResult>;

  dispose(): void;
}

export default OrcaEngine;
