import type { PresetStorageEnvelope, CloudAccount } from './types.ts';
import type { UserPreset } from '../presets/types.ts';
export const presetKey = (p: UserPreset) => `${p.kind}\u0000${p.name}`;
export function accountState(state: PresetStorageEnvelope, accountId: string): CloudAccount {
  if (!accountId) throw new Error('Orca account is required.');
  return state.cloud.accounts[accountId] ??= { records: {} };
}
/** Called inside the same durable write as preset actions. No journal after-the-fact. */
export function journalLocalChanges(state: PresetStorageEnvelope, next: UserPreset[]): void {
  const previous = new Map(state.presets.map(p => [presetKey(p), p]));
  const oldPreset = (p: UserPreset) => p.cloudRef
    ? state.presets.find(old => old.cloudRef?.accountId === p.cloudRef!.accountId && old.cloudRef.id === p.cloudRef!.id) ?? previous.get(presetKey(p))
    : previous.get(presetKey(p));
  // Rename references to the actual local name, never to the colliding server name.
  for (const p of next) {
    const old = oldPreset(p);
    if (!old || old.name === p.name) continue;
    if (p.cloudRef) {
      const record = accountState(state, p.cloudRef.accountId).records[p.cloudRef.id];
      if (record) record.serverName = p.name;
    }
    for (const child of next) if (child.kind === p.kind && child.inherits === old.name) child.inherits = p.name;
  }
  for (const p of next) {
    const old = oldPreset(p);
    p.cloudRef ??= old?.cloudRef;
    if (JSON.stringify(old) === JSON.stringify(p)) continue;
    const owner = p.cloudRef?.accountId ?? state.cloud.activeAccount;
    if (!owner) continue;
    const account = accountState(state, owner);
    const id = p.cloudRef?.id ?? crypto.randomUUID();
    p.cloudRef = { accountId: owner, id };
    const record = account.records[id];
    const parent = next.find(parent => parent.kind === p.kind && parent.name === p.inherits && parent.cloudRef?.accountId === owner);
    const changedParent = !record || old?.inherits !== p.inherits;
    account.records[id] = { ...record, id, preset: structuredClone(p), raw: record?.raw ?? {},
      serverName: record?.serverName ?? (typeof record?.raw.name === 'string' ? record.raw.name : p.name),
      serverInherits: changedParent ? (parent ? account.records[parent.cloudRef!.id]?.serverName ?? parent.name : p.inherits) : record.serverInherits ?? (typeof record.raw.inherits === 'string' ? record.raw.inherits : p.inherits),
      parentId: changedParent ? parent?.cloudRef?.id : record.parentId,
      dirty: true, deleted: false };
  }
  const present = new Set(next.map(p => p.cloudRef ? `${p.cloudRef.accountId}/${p.cloudRef.id}` : ''));
  for (const p of state.presets) {
    if (!p.cloudRef || present.has(`${p.cloudRef.accountId}/${p.cloudRef.id}`)) continue;
    const record = accountState(state, p.cloudRef.accountId).records[p.cloudRef.id];
    if (record) { record.deleted = true; record.dirty = true; }
  }
  state.presets = next;
}
