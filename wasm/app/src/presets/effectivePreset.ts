import type { PresetKind, UserPreset } from './types.ts';

/** Include the preset itself so parent pickers can reject both self and descendants. */
export function presetDescendsFrom(kind: PresetKind, name: string, ancestor: string, users: UserPreset[]): boolean {
  const visited = new Set<string>();
  while (name && !visited.has(name)) {
    if (name === ancestor) return true;
    visited.add(name);
    name = users.find(p => p.kind === kind && p.name === name)?.inherits || '';
  }
  return false;
}

/** Native selection uses the system root; web user values compose parent first. */
export function effectivePreset(kind: PresetKind, name: string, users: UserPreset[]): { preset: string; values: Record<string, string> } {
  const chain: UserPreset[] = [];
  const visited = new Set<string>();
  let cursor = name;
  while (cursor) {
    const user = users.find(p => p.kind === kind && p.name === cursor);
    if (!user) break;
    if (visited.has(cursor)) throw new Error('Preset inheritance cycle.');
    visited.add(cursor);
    chain.push(user);
    cursor = user.inherits;
  }
  return { preset: cursor, values: Object.assign({}, ...chain.reverse().map(p => p.values)) };
}
