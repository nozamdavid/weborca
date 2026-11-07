import type { UserPreset } from '../presets/types.ts';
export interface CloudProfile {
  id: string;
  name: string;
  content: Record<string, unknown>;
  updated_time: number;
  created_time?: number;
}
export interface CloudRecord {
  id: string;
  preset: UserPreset;
  raw: Record<string, unknown>;
  /** Server-facing identity, independent of a local collision display alias. */
  serverName?: string;
  serverInherits?: string;
  parentId?: string;
  revision?: number;
  dirty: boolean;
  deleted?: boolean;
  /** Presence means unresolved; null means a cloud tombstone. */
  conflict?: { server: CloudProfile | null; response?: unknown };
  force?: boolean;
}
export interface CloudAccount { cursor?: number; records: Record<string, CloudRecord> }
export interface CloudJournal { activeAccount?: string; accounts: Record<string, CloudAccount> }
export interface PresetStorageEnvelope {
  version: number;
  updatedAt: number;
  presets: UserPreset[];
  cloud: CloudJournal;
}
export interface SyncReply { status: number; data: unknown }
export interface CloudPresetApi {
  pull(cursor?: number): Promise<SyncReply>;
  push(body: { id: string; name: string; content: Record<string, unknown>; original_updated_time?: string }, force?: boolean): Promise<SyncReply>;
  delete(id: string): Promise<SyncReply>;
}
export interface CloudStorage {
  transaction<T>(work: (state: PresetStorageEnvelope) => Promise<T> | T): Promise<T>;
}
