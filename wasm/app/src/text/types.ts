/**
 * @file types.ts
 * Type definitions for the 3D Text & Emboss tool in OrcaSlicer Web.
 */

export interface FontItem {
  id: string;
  name: string;
  fileName: string;
  url: string;
  license?: string;
  bytes?: Uint8Array;
}

export type TextVolumeType = 'part' | 'negative' | 'modifier' | 'new_object';

export interface TextAlignment {
  horizontal: 'left' | 'center' | 'right';
  vertical: 'top' | 'center' | 'bottom';
}

export interface AddTextParams {
  objectId?: number;
  volumeType?: TextVolumeType;
  text: string;
  fontData?: string;
  fontPath?: string;
  fontName?: string;
  size?: number; // mm
  depth?: number; // mm
  charGap?: number;
  lineGap?: number;
  boldness?: number;
  skew?: number;
  align?: TextAlignment | string;
  useSurface?: boolean;
  position?: [number, number, number];
  normal?: [number, number, number];
  rotation?: number;
  name?: string;
}

export interface UpdateTextParams extends Partial<AddTextParams> {
  objectId: number;
  volumeId: number;
}

export interface GetTextParams {
  objectId: number;
  volumeId: number;
}

export interface TextResult {
  objectId: number;
  volumeId: number;
  name: string;
  triangleCount: number;
  boundingBox: [number, number, number, number, number, number];
}

export interface GetTextResult {
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
  align: TextAlignment;
  rotation?: number;
}

export interface PlaceTextAtHitOptions {
  objectId?: number | null;
  hit: [number, number, number] | { x: number; y: number; z: number };
  normal?: [number, number, number] | { x: number; y: number; z: number };
}
