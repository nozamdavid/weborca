import type { HostCapabilities } from './types';

export interface OctoEverywhereConnection {
  connectionId: string;
  url: string;
  appApiToken: string;
  auth: { type: 'bearer'; token: string } | { type: 'basic'; username: string; password: string };
  printerName: string;
  userFacingUrl: string;
  printerId?: string;
  nativeApiKey?: string;
}
export interface OctoEverywhereSettings {
  mode: 'local' | 'remote';
  connection?: OctoEverywhereConnection;
  userFacingUrl?: string;
}
export interface OctoEverywhereConfig { enabled: boolean; appId?: string; portalAvailable: boolean }
export interface OctoEverywhereFlow { portalUrl: string; flowId: string; pollToken: string }
export type OctoEverywherePortalResult = { status: 'pending' } | { status: 'complete'; connection: OctoEverywhereConnection } | { status: 'failed'; error: string };
export interface OctoEverywhereInfo {
  PrinterName?: string;
  PrinterLocalIp?: string;
  IsOnline?: boolean;
  LastDisconnectTimeUtc?: string;
  LastConnectionTimeUtc?: string;
  UserFacingPrinterUrl?: string;
  PrinterLimits?: { MaxUploadFileSizeBytes?: number; MaxDownloadFileSizeBytes?: number; MaxSingleWebcamStreamLengthSeconds?: number };
}
export interface OctoEverywhereMaterialSystem {
  Capabilities?: { SupportsMultiMaterial?: boolean; SupportsMultiTool?: boolean; SupportsSourceRouting?: boolean; SupportsDrying?: boolean };
  Sources?: Array<{
    Id: string; Index?: number; Name?: string; UnitId?: string; Position?: number; PrintMappingValue?: number; IsEmpty?: boolean;
    Material?: { Type?: string; Name?: string; ColorHex?: string; RemainingPercent?: number; Manufacturer?: string };
    PlatformDetails?: Record<string, unknown>;
  }>;
  Tools?: Array<{ Id: string; Index?: number; Name?: string; IsActive?: boolean; IsPresent?: boolean; ActualCelsius?: number; TargetCelsius?: number; NozzleDiameterMm?: number; PlatformDetails?: Record<string, unknown> }>;
  Units?: Array<{ Id: string; Index?: number; Name?: string; HumidityPercent?: number; TemperatureCelsius?: number; IsDrying?: boolean; PlatformDetails?: Record<string, unknown> }>;
  Routes?: Array<{ SourceId: string; ToolId: string; State?: string }>;
  PlatformDetails?: Record<string, unknown>;
}
export interface OctoEverywhereCamera { index: number; name: string; enabled?: boolean; flipH?: boolean; flipV?: boolean; rotation?: number }
export interface OctoEverywhereCameraList {
  DefaultIndex?: number;
  Webcams?: Array<{ Name?: string; Enabled?: boolean; FlipH?: boolean; FlipV?: boolean; Rotation?: number; SnapshotUrl?: string | null; StreamUrl?: string | null }>;
}
export interface OctoEverywhereStatus {
  JobStatus?: {
    State?: string; SubState?: string | null; Error?: string | null;
    Lights?: Array<{ Name: string; On?: boolean }> | null;
    CurrentPrint?: {
      Progress?: number | null; DurationSec?: number | null; TimeLeftSec?: number | null; FileName?: string | null;
      CurrentLayer?: number | null; TotalLayers?: number | null; EstTotalFilUsedMm?: number | null; EstTotalFilWeightMg?: number | null;
      Temps?: Partial<Record<'BedActual' | 'BedTarget' | 'HotendActual' | 'HotendTarget' | 'ChamberActual' | 'ChamberTarget', number | null>>;
    };
    MaterialSystem?: OctoEverywhereMaterialSystem | null;
  };
  Features?: number;
  PlatformVersion?: string;
  ListWebcams?: OctoEverywhereCameraList;
  OctoEverywhereStatus?: { MostRecentPrintIdStr?: string; PrintStartTimeSec?: number; Gadget?: Record<string, unknown> };
}
export interface OctoEverywhereCapabilities extends HostCapabilities {
  lights: boolean;
  start: boolean;
  files: boolean;
  rawGcodeUpload: boolean;
  rawGcodeStart: boolean;
  sendReason?: string;
  fileRoots: { list: string[]; upload: string[]; download: string[]; delete: string[]; details: string[] };
}
export type OctoEverywhereRecovery = 'reconnect' | 'supporter' | 'wait' | 'update-plugin' | 'unsupported' | 'limit' | 'check-printer';
export interface OctoEverywhereRemoteState {
  capabilities: OctoEverywhereCapabilities;
  info?: OctoEverywhereInfo;
  health: 'unknown' | 'online' | 'offline' | 'error';
  errorCode?: number;
  recovery?: OctoEverywhereRecovery;
  lights?: Array<{ Name: string; On?: boolean }> | null;
  /** Provider topology retains opaque IDs and unknown fields; never join by array position. */
  materialSystem?: OctoEverywhereMaterialSystem | null;
  cameras: OctoEverywhereCamera[];
  temperatures?: NonNullable<NonNullable<OctoEverywhereStatus['JobStatus']>['CurrentPrint']>['Temps'];
  gadget?: OctoEverywhereGadget;
}
export interface OctoEverywhereFile {
  Type: 'folder' | 'file'; Name: string; VirtualPath: string; PlatformPath?: string;
  SizeBytes?: number; ModifiedTimeSec?: number; Permissions?: string; Children?: OctoEverywhereFile[];
  [key: string]: unknown;
}
export interface OctoEverywhereFileDetails {
  VirtualPath: string; PlatformPath: string; FileName: string;
  SizeBytes?: number; ModifiedTimeSec?: number; EstPrintTimeSec?: number; EstFilamentUsedMm?: number; EstFilamentWeightMg?: number;
  LayerCount?: number; LayerHeightMm?: number; FirstLayerHeightMm?: number; ObjectHeightMm?: number; NozzleDiameterMm?: number;
  FilamentType?: string; FilamentName?: string; BedTempC?: number; HotendTempC?: number; ChamberTempC?: number;
  PrintStartTimeSec?: number; Slicer?: string; SlicerVersion?: string; ThumbnailCount?: number; PlatformDetails?: unknown;
}
export interface OctoEverywhereStartOptions {
  Storage?: string; Plate?: number; UseAms?: boolean; AmsMapping?: number[]; FlowCali?: boolean; Timelapse?: boolean;
  BedLeveling?: boolean; VibrationCali?: boolean; LayerInspect?: boolean;
}
export interface OctoEverywherePauseOptions {
  SmartPause?: boolean; DisableHotend?: boolean; DisableBed?: boolean; ZLiftMm?: number; RetractFilamentMm?: number;
  SuppressNotification?: boolean; ShowSmartPausePopup?: boolean;
}
export interface OctoEverywhereGadget { State: 0 | 1 | 2 | 3 | 4; Status?: string; StatusColor?: 'g' | 'y' | 'r' | 'w'; Rating?: number }
export interface OctoEverywhereLiveOptions { ExpirationHours?: number; EndWhenCurrentPrintIsComplete?: boolean }
export interface OctoEverywhereLiveLink { LiveId: string; Url: string; ShortUrl: string }
export interface OctoEverywhereWebhook { WebhookUrl: string; InclusiveEventTypesFilter?: number[] }
export interface OctoEverywhereTicket { url: string; expiresAt: number }
