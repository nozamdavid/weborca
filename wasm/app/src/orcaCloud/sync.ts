import type { CloudStorage, CloudPresetApi, CloudProfile, CloudRecord, PresetStorageEnvelope } from './types.ts';
import { accountState, journalLocalChanges, presetKey } from './journal.ts';
import { decodeProfile, encodeRecord, revision } from './codec.ts';

function checkCancelled(signal?: AbortSignal) { signal?.throwIfAborted(); }
function linked(p: { cloudRef?: { accountId: string; id: string } }, accountId: string, id: string) {
  return p.cloudRef?.accountId === accountId && p.cloudRef.id === id;
}
function removeLocal(state: PresetStorageEnvelope, accountId: string, id: string) {
  state.presets = state.presets.filter(p => !linked(p, accountId, id));
}
function install(state: PresetStorageEnvelope, accountId: string, profile: CloudProfile): CloudRecord {
  const decoded = decodeProfile(profile);
  removeLocal(state, accountId, profile.id);
  const preset = decoded.preset;
  const original = preset.name;
  let suffix = 1;
  while (state.presets.some(p => presetKey(p) === presetKey(preset))) preset.name = `${original} (cloud ${suffix++})`;
  preset.cloudRef = { accountId, id: profile.id };
  const record: CloudRecord = { id: profile.id, preset, serverName: profile.name, serverInherits: preset.inherits, raw: structuredClone(profile.content), revision: profile.updated_time, dirty: false };
  state.presets.push(structuredClone(preset));
  accountState(state, accountId).records[profile.id] = record;
  return record;
}
/** Resolve only this account's cloud children after the complete batch is installed. */
function bindParents(state: PresetStorageEnvelope, accountId: string) {
  const records = Object.values(accountState(state, accountId).records).filter(r => !r.deleted);
  for (const record of records) {
    record.serverName ??= typeof record.raw.name === 'string' ? record.raw.name : record.preset.name;
    record.serverInherits ??= typeof record.raw.inherits === 'string' ? record.raw.inherits : record.preset.inherits;
  }
  for (const record of records) {
    const parent = records.find(p => p.preset.kind === record.preset.kind && p.serverName === record.serverInherits)
      ?? records.find(p => p.id === record.parentId && p.preset.kind === record.preset.kind);
    record.parentId = parent?.id;
    record.preset.inherits = parent?.preset.name ?? record.serverInherits!;
    const local = state.presets.find(p => linked(p, accountId, record.id));
    if (local) local.inherits = record.preset.inherits;
  }
}
export function createPresetSync(storage: CloudStorage, api: CloudPresetApi, accountId: string) {
  const transaction = <T>(fn: (state: PresetStorageEnvelope) => Promise<T> | T) => storage.transaction(fn);
  async function activate() {
    await transaction(state => { accountState(state, accountId); state.cloud.activeAccount = accountId; });
  }
  async function deactivate() {
    await transaction(state => { if (state.cloud.activeAccount === accountId) delete state.cloud.activeAccount; });
  }
  async function backupLocal() {
    await transaction(state => {
      accountState(state, accountId);
      const next = structuredClone(state.presets);
      for (const p of next) {
        if (p.cloudRef) continue; // another account's IDs never migrate
        p.cloudRef = { accountId, id: crypto.randomUUID() };
      }
      journalLocalChanges(state, next);
    });
  }
  async function pull(signal?: AbortSignal) {
    return transaction(async state => {
      checkCancelled(signal);
      const account = accountState(state, accountId);
      let full = account.cursor === undefined;
      let result = await api.pull(account.cursor);
      if (result.status === 410) { full = true; result = await api.pull(); }
      checkCancelled(signal);
      if (result.status === 304) return { changed: false, presets: state.presets };
      if (result.status !== 200) throw new Error('Cloud pull failed. Local checkpoint retained.');
      const data = result.data as { next_cursor: number; upserts: unknown[]; deletes: string[] };
      if (!data || !Array.isArray(data.upserts) || !Array.isArray(data.deletes) || !data.deletes.every(id => typeof id === 'string' && id)) throw new Error('Invalid cloud pull.');
      revision(data.next_cursor);
      // Validate the whole response before changing any local state.
      const profiles = data.upserts.map(p => decodeProfile(p).profile);
      const ids = new Set(profiles.map(p => p.id));
      if (ids.size !== profiles.length || data.deletes.some(id => ids.has(id))) throw new Error('Ambiguous cloud pull.');
      for (const profile of profiles) {
        const local = account.records[profile.id];
        if (local?.dirty) {
          if (local.revision !== profile.updated_time || local.conflict) local.conflict = { server: profile };
        } else install(state, accountId, profile);
      }
      const deleted = new Set(data.deletes);
      if (full) for (const id of Object.keys(account.records)) if (!ids.has(id)) deleted.add(id);
      for (const id of deleted) {
        const local = account.records[id];
        if (!local) continue;
        if (local.dirty) {
          // A new unsent local profile is absent from every full cloud snapshot.
          if (!full || local.revision !== undefined || local.conflict) local.conflict = { server: null };
        } else { removeLocal(state, accountId, id); delete account.records[id]; }
      }
      bindParents(state, accountId);
      checkCancelled(signal);
      account.cursor = data.next_cursor;
      return { changed: true, presets: state.presets };
    });
  }
  async function push(signal?: AbortSignal) {
    // Commit each acknowledgement independently. Failed later requests retain earlier acknowledgements.
    const ids = await transaction(state => Object.keys(accountState(state, accountId).records));
    for (const id of ids) {
      checkCancelled(signal);
      await transaction(async state => {
        const account = accountState(state, accountId);
        const record = account.records[id];
        if (!record?.dirty || record.conflict) return;
        let result;
        if (record.deleted) {
          if (record.revision === undefined) { delete account.records[id]; return; }
          result = await api.delete(id);
        } else {
          const body = { id, name: record.serverName ?? record.preset.name, content: encodeRecord(record),
            ...(record.revision === undefined ? {} : { original_updated_time: String(record.revision) }) };
          if (new TextEncoder().encode(JSON.stringify(body)).byteLength > 1_048_576) throw new Error('Preset exceeds 1 MiB.');
          result = await api.push(body, record.force === true);
        }
        checkCancelled(signal);
        if (result.status === 409) {
          const response = result.data as { server_profile?: unknown } | null;
          const server = response === null ? null : response?.server_profile;
          if (server === undefined) throw new Error('Cloud conflict is missing its server version. Local work retained.');
          // Partial server envelopes stay reviewable, but cannot be applied until a pull supplies content.
          record.conflict = { server: server as CloudProfile | null, response: structuredClone(result.data) };
          delete record.force;
          return;
        }
        if (record.deleted) {
          if (![200, 204].includes(result.status)) throw new Error('Cloud deletion failed. Local tombstone retained.');
          delete account.records[id]; return;
        }
        if (result.status !== 200) throw new Error('Cloud push failed. Local work retained.');
        const accepted = revision((result.data as { updated_time?: unknown })?.updated_time);
        if (!accepted) throw new Error('Cloud push did not acknowledge a revision.');
        record.revision = accepted; record.dirty = false; record.raw = encodeRecord(record); delete record.force;
      });
    }
  }
  async function resolve(id: string, choice: 'use-cloud' | 'use-local' | 'copy', copyName?: string) {
    return transaction(state => {
      const account = accountState(state, accountId);
      const record = account.records[id];
      if (!record?.conflict) throw new Error('No unresolved conflict.');
      const server = record.conflict.server;
      if (choice === 'use-local') {
        if (record.deleted) {
          if (server === null) delete account.records[id];
          else { record.revision = revision(server.updated_time); delete record.conflict; }
          return state.presets;
        }
        record.force = true; delete record.conflict; return state.presets;
      }
      if (choice === 'copy') {
        if (!copyName?.trim() || state.presets.some(p => p.kind === record.preset.kind && p.name === copyName.trim())) throw new Error('Choose a distinct name for the local copy.');
        const newId = crypto.randomUUID();
        const copy = structuredClone(record);
        copy.id = newId; copy.preset.name = copyName.trim(); copy.preset.cloudRef = { accountId, id: newId };
        copy.serverName = copy.preset.name;
        delete copy.revision; delete copy.conflict; delete copy.force; copy.dirty = true; copy.deleted = false;
        account.records[newId] = copy; state.presets.push(structuredClone(copy.preset));
      }
      if (server === null) { removeLocal(state, accountId, id); delete account.records[id]; }
      else install(state, accountId, server); // rejects incomplete 409 envelopes atomically
      bindParents(state, accountId);
      return state.presets;
    });
  }
  async function snapshot() {
    return transaction(state => structuredClone(accountState(state, accountId)));
  }
  async function importProfiles(profiles: CloudProfile[]) {
    return transaction(state => {
      const decoded = profiles.map(p => decodeProfile(p).profile);
      if (new Set(decoded.map(p => p.id)).size !== decoded.length) throw new Error('Duplicate cloud profile IDs.');
      const account = accountState(state, accountId);
      for (const profile of decoded) {
        const local = account.records[profile.id];
        if (local?.dirty) local.conflict = { server: profile };
        else install(state, accountId, profile);
      }
      bindParents(state, accountId);
      // Offline imports never acknowledge a server cursor or schedule an upload.
      return state.presets;
    });
  }
  async function exportProfiles() {
    return transaction(state => Object.values(accountState(state, accountId).records).filter(r => !r.deleted).map(r => ({
      id: r.id, name: r.serverName ?? r.preset.name, content: encodeRecord(r), updated_time: r.revision ?? 0
    })));
  }
  return { activate, deactivate, backupLocal, pull, push, resolve, snapshot, importProfiles, exportProfiles };
}
