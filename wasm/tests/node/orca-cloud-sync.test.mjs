import test from 'node:test';
import assert from 'node:assert/strict';
import { createOrcaCloudClient } from '../../app/src/orcaCloud/client.ts';
import { createPresetSync } from '../../app/src/orcaCloud/sync.ts';
import { decodeProfile, encodeRecord } from '../../app/src/orcaCloud/codec.ts';
import { journalLocalChanges } from '../../app/src/orcaCloud/journal.ts';
import { effectivePreset } from '../../app/src/presets/effectivePreset.ts';
import { transactPresetStorage, saveUserPreset, deleteUserPreset, renameUserPreset, loadUserPresets } from '../../app/src/presets/presetStorage.ts';
const empty = () => ({ version: 2, updatedAt: 0, presets: [], cloud: { accounts: {} } });
test('hosted cloud status and callback completion retain same-origin alpha cookies', async () => {
  const calls = [], storage = new Map();
  const client = createOrcaCloudClient('https://app.example', async (url, init) => {
    calls.push([url.pathname, init]); return new Response('{}', { status: 200 });
  }, { storage: {getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)}, locks:{request:async(_key,fn)=>fn()}, crypto:globalThis.crypto });
  await client.status(); await client.complete('https://app.example/orca-cloud/callback?code=synthetic');
  assert.deepEqual(calls.map(([path])=>path), ['/_orca-cloud/status','/_orca-cloud/complete']);
  assert.ok(calls.every(([,init])=>init.credentials==='same-origin' && init.headers['x-orca-cloud-session']));
});
const profile = (id, type = 'print', rev = 1, name = 'Same name') => ({ id, name, updated_time: rev, created_time: 1, content: { name, type, version: '2.3', inherits: 'Base', base_id: 'base-id', filament_id: 'filament-id', custom_meta: { future: true }, layer_height: '0.2', temperatures: ['200', '210'] } });
function fixture() {
  let state = empty(), fail = false;
  const storage = { transaction: async work => { const next = structuredClone(state); const result = await work(next); if (fail) throw new Error('disk failed'); state = next; return result; } };
  const calls = [];
  let replies = [], pushReply = { status: 200, data: { updated_time: 9 } };
  const api = {
    pull: async cursor => { calls.push(['pull', cursor]); const r = replies.shift(); if (r instanceof Error) throw r; return r; },
    push: async (body, force) => { calls.push(['push', body, force]); return pushReply; },
    delete: async id => { calls.push(['delete', id]); return pushReply; }
  };
  return { storage, api, calls, get state() { return state; }, set fail(v) { fail = v; }, set replies(v) { replies = v; }, set pushReply(v) { pushReply = v; } };
}
const pulled = (upserts, deletes = [], cursor = 4) => ({ status: 200, data: { next_cursor: cursor, upserts, deletes } });
async function dirty(f, id, value = '0.3') {
  await f.storage.transaction(state => {
    const next = structuredClone(state.presets);
    next.find(p => p.cloudRef?.id === id).values.layer_height = value;
    journalLocalChanges(state, next);
  });
}

test('three native kinds, same names across kinds, raw metadata/inheritance round trip, update/delete/304', async () => {
  const f = fixture(), sync = createPresetSync(f.storage, f.api, 'alice');
  f.replies = [pulled([profile('p', 'printer'), profile('f', 'filament'), profile('s', 'print')]), { status: 304, data: null }, pulled([profile('s', 'print', 2)], ['f'], 5)];
  await sync.pull();
  assert.deepEqual(f.state.presets.map(p => p.kind), ['printer', 'filament', 'process']);
  assert.ok(f.state.presets.every(p => p.name === 'Same name' && p.inherits === 'Base'));
  const exported = await sync.exportProfiles();
  assert.equal(exported.length, 3);
  for (const p of exported) assert.deepEqual(p.content, profile(p.id, p.content.type).content);
  const offline = fixture();
  const imported = createPresetSync(offline.storage, offline.api, 'alice');
  await imported.importProfiles(exported);
  assert.equal(offline.state.presets.length, 3);
  assert.deepEqual(await imported.exportProfiles(), exported);
  assert.equal(offline.state.cloud.accounts.alice.cursor, undefined);
  assert.equal((await sync.pull()).changed, false); assert.equal(f.state.cloud.accounts.alice.cursor, 4);
  await sync.pull(); assert.equal(f.state.presets.length, 2); assert.equal(f.state.cloud.accounts.alice.records.s.revision, 2);
  assert.equal(f.state.cloud.accounts.alice.cursor, 5);
  assert.deepEqual(f.calls, [['pull', undefined], ['pull', 4], ['pull', 4]]);
});

test('410 retries full exactly once; reset removes missing clean cloud profiles and preserves dirty', async () => {
  const f = fixture(), sync = createPresetSync(f.storage, f.api, 'alice');
  f.replies = [pulled([profile('dirty'), profile('clean', 'printer')])]; await sync.pull(); await dirty(f, 'dirty');
  f.replies = [{ status: 410 }, pulled([], [], 20)]; await sync.pull();
  assert.deepEqual(f.calls.slice(-2), [['pull', 4], ['pull', undefined]]);
  assert.equal(f.state.cloud.accounts.alice.records.clean, undefined);
  const local = f.state.cloud.accounts.alice.records.dirty;
  assert.equal(local.dirty, true); assert.equal(local.conflict.server, null); assert.equal(local.preset.values.layer_height, '0.3');
  f.replies = [{ status: 410 }, { status: 410 }]; await assert.rejects(sync.pull(), /checkpoint retained/);
  assert.equal(f.state.cloud.accounts.alice.cursor, 20);
});

test('storage failure, cancellation and network failure retain old cursor and local writes', async () => {
  const f = fixture(), sync = createPresetSync(f.storage, f.api, 'alice');
  f.replies = [pulled([profile('s')])]; await sync.pull();
  const before = structuredClone(f.state);
  f.replies = [pulled([profile('new')], ['s'], 8)]; f.fail = true;
  await assert.rejects(sync.pull(), /disk failed/); assert.deepEqual(f.state, before); f.fail = false;
  const abort = new AbortController();
  f.api.pull = async () => { abort.abort(); return pulled([profile('new')], ['s'], 8); };
  await assert.rejects(sync.pull(abort.signal), { name: 'AbortError' }); assert.deepEqual(f.state, before);
  f.api.pull = async () => { throw new Error('offline'); };
  await assert.rejects(sync.pull(), /offline/); assert.deepEqual(f.state, before);
});

test('409 preserves both versions and OCC revision; explicit use-local is the sole force path', async () => {
  const f = fixture(), sync = createPresetSync(f.storage, f.api, 'alice');
  f.replies = [pulled([profile('s')])]; await sync.pull(); await dirty(f, 's');
  f.pushReply = { status: 409, data: { server_profile: profile('s', 'print', 7) } };
  await sync.push();
  let local = f.state.cloud.accounts.alice.records.s;
  assert.equal(local.revision, 1); assert.equal(local.dirty, true); assert.equal(local.preset.values.layer_height, '0.3');
  assert.equal(local.conflict.server.updated_time, 7);
  assert.equal(f.calls.at(-1)[1].original_updated_time, '1'); assert.equal(f.calls.at(-1)[2], false);
  const count = f.calls.length; await sync.push(); assert.equal(f.calls.length, count);
  await sync.resolve('s', 'use-local');
  f.pushReply = { status: 200, data: { updated_time: 9 } }; await sync.push();
  assert.equal(f.calls.at(-1)[2], true); assert.equal(f.state.cloud.accounts.alice.records.s.dirty, false);
  assert.equal(f.state.cloud.accounts.alice.records.s.revision, 9);
});

test('null-root and null-envelope tombstone conflicts, copy and use-cloud preserve or remove intentionally', async () => {
  for (const data of [null, { server_profile: null }]) {
    const f = fixture(), sync = createPresetSync(f.storage, f.api, 'alice');
    f.replies = [pulled([profile('s')])]; await sync.pull(); await dirty(f, 's');
    f.pushReply = { status: 409, data }; await sync.push();
    assert.equal(f.state.cloud.accounts.alice.records.s.conflict.server, null);
    await sync.resolve('s', 'copy', 'Local copy');
    assert.equal(f.state.presets.length, 1); assert.equal(f.state.presets[0].name, 'Local copy');
    const copy = Object.values(f.state.cloud.accounts.alice.records)[0];
    assert.notEqual(copy.id, 's'); assert.equal(copy.revision, undefined); assert.equal(copy.dirty, true);
    assert.equal(copy.preset.values.layer_height, '0.3');
  }
  const f = fixture(), sync = createPresetSync(f.storage, f.api, 'alice');
  f.replies = [pulled([profile('s')])]; await sync.pull(); await dirty(f, 's');
  f.replies = [pulled([profile('s', 'print', 3)], [], 6)]; await sync.pull();
  await sync.resolve('s', 'use-cloud'); assert.equal(f.state.presets[0].values.layer_height, '0.2');
  assert.equal(f.state.cloud.accounts.alice.records.s.revision, 3);
});

test('local deletion tombstones survive remote update and failed delete until acknowledgement', async () => {
  const f = fixture(), sync = createPresetSync(f.storage, f.api, 'alice');
  f.replies = [pulled([profile('s')])]; await sync.pull();
  await f.storage.transaction(state => journalLocalChanges(state, []));
  f.pushReply = { status: 503 }; await assert.rejects(sync.push(), /tombstone retained/);
  assert.equal(f.state.cloud.accounts.alice.records.s.deleted, true);
  f.replies = [pulled([profile('s', 'print', 2)], [], 5)]; await sync.pull();
  assert.equal(f.state.presets.length, 0); assert.equal(f.state.cloud.accounts.alice.records.s.dirty, true);
  await sync.resolve('s', 'use-cloud'); assert.equal(f.state.presets.length, 1);
  await f.storage.transaction(state => journalLocalChanges(state, []));
  f.replies = [pulled([profile('s', 'print', 3)], [], 6)]; await sync.pull();
  await sync.resolve('s', 'use-local');
  assert.equal(f.state.cloud.accounts.alice.records.s.deleted, true);
  f.pushReply = { status: 204, data: null }; await sync.push(); assert.equal(f.state.cloud.accounts.alice.records.s, undefined);
});

test('account separation, stable identity across rename, explicit backup and same-kind collision', async () => {
  const f = fixture(), alice = createPresetSync(f.storage, f.api, 'alice'), bob = createPresetSync(f.storage, f.api, 'bob');
  f.replies = [pulled([profile('same')]), pulled([profile('same')], [], 80)];
  await alice.pull(); await bob.pull();
  assert.equal(f.state.presets.length, 2); assert.notEqual(f.state.presets[0].name, f.state.presets[1].name);
  assert.equal(f.state.cloud.accounts.alice.cursor, 4); assert.equal(f.state.cloud.accounts.bob.cursor, 80);
  await bob.activate(); await dirty(f, 'same');
  assert.equal(f.state.cloud.accounts.alice.records.same.dirty, true); assert.equal(f.state.cloud.accounts.bob.records.same.dirty, false);
  await f.storage.transaction(state => {
    const next = structuredClone(state.presets); next[0].name = 'Renamed'; journalLocalChanges(state, next);
  });
  assert.equal(f.state.cloud.accounts.alice.records.same.preset.name, 'Renamed'); assert.equal(f.state.cloud.accounts.alice.records.same.deleted, false);
  await f.storage.transaction(state => { state.presets.push({ name: 'Unlinked', kind: 'process', inherits: '', values: {} }); });
  await bob.backupLocal();
  assert.equal(Object.keys(f.state.cloud.accounts.alice.records).length, 1); assert.equal(Object.keys(f.state.cloud.accounts.bob.records).length, 2);
  await bob.deactivate(); assert.equal(f.state.cloud.activeAccount, undefined);
});

test('actual fallback storage commits actions and cloud journal together, reloads and rejects failed writes', async () => {
  const data = new Map();
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: { request: async (_name, work) => work() } } });
  globalThis.localStorage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  try {
    const sync = createPresetSync({ transaction: transactPresetStorage }, { pull: async () => pulled([profile('s')]), push: async () => ({ status: 200, data: { updated_time: 2 } }), delete: async () => ({ status: 204 }) }, 'alice');
    await sync.pull(); await sync.activate();
    await renameUserPreset('process', 'Same name', 'Renamed');
    const stored = JSON.parse(data.get('orca_user_presets'));
    assert.equal(stored.cloud.accounts.alice.records.s.preset.name, 'Renamed'); assert.equal(stored.cloud.accounts.alice.records.s.dirty, true);
    await saveUserPreset({ name: 'New', kind: 'filament', inherits: 'Base', values: { temperature: '200' } });
    assert.equal((await loadUserPresets()).length, 2);
    await deleteUserPreset('process', 'Renamed');
    assert.equal(JSON.parse(data.get('orca_user_presets')).cloud.accounts.alice.records.s.deleted, true);
    const before = data.get('orca_user_presets');
    globalThis.localStorage.setItem = () => { throw new Error('quota'); };
    await assert.rejects(saveUserPreset({ name: 'Failed', kind: 'printer', inherits: '', values: {} }), /durably/);
    assert.equal(data.get('orca_user_presets'), before);
  } finally {
    delete globalThis.localStorage;
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else delete globalThis.navigator;
  }
});

test('codec rejects credentials; unchanged raw arrays and metadata survive; push cap retains dirty', async () => {
  assert.throws(() => decodeProfile({ ...profile('s'), content: { type: 'printer', nested: { password: 'secret' } } }), /credentials/);
  const decoded = decodeProfile(profile('s'));
  assert.deepEqual(encodeRecord({ preset: decoded.preset, raw: decoded.profile.content }), profile('s').content);
  const f = fixture(), sync = createPresetSync(f.storage, f.api, 'alice');
  f.replies = [pulled([profile('s')])]; await sync.pull(); await dirty(f, 's', 'x'.repeat(1_048_576));
  await assert.rejects(sync.push(), /1 MiB/); assert.equal(f.state.cloud.accounts.alice.records.s.dirty, true);
  assert.ok(!f.calls.some(c => c[0] === 'push'));
});

test('actual storage binds colliding cloud parents in either batch order for all kinds', async () => {
  const data = new Map();
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: { request: async (_name, work) => work() } } });
  globalThis.localStorage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  try {
    for (const type of ['printer', 'filament', 'print']) for (const childFirst of [false, true]) {
      data.clear();
      const kind = type === 'print' ? 'process' : type;
      const local = { name: 'Parent', kind, inherits: 'System', values: { layer_height: '0.8' } };
      const unrelated = { name: 'Local child', kind, inherits: 'Parent', values: {} };
      await saveUserPreset(local); await saveUserPreset(unrelated);
      const parent = { ...profile('parent', type, 1, 'Parent'), content: { type, name: 'Parent', inherits: 'System', layer_height: '0.12', wall_loops: '2' } };
      const child = { ...profile('child', type, 1, 'Child'), content: { type, name: 'Child', inherits: 'Parent', wall_loops: '7' } };
      const sync = createPresetSync({ transaction: transactPresetStorage }, { pull: async () => pulled(childFirst ? [child, parent] : [parent, child]) }, 'alice');
      await sync.pull();
      const users = await loadUserPresets();
      const cloudParent = users.find(p => p.cloudRef?.id === 'parent');
      assert.equal(users.find(p => p.cloudRef?.id === 'child').inherits, cloudParent.name);
      assert.deepEqual(effectivePreset(kind, 'Child', users), { preset: 'System', values: { layer_height: '0.12', wall_loops: '7' } });
      assert.deepEqual(users.find(p => p.name === 'Parent'), local);
      assert.deepEqual(users.find(p => p.name === 'Local child'), unrelated);
      assert.deepEqual(effectivePreset(kind, 'System', users), { preset: 'System', values: {} });
      const exported = await sync.exportProfiles();
      for (const raw of [parent, child]) {
        const result = exported.find(p => p.id === raw.id);
        assert.equal(result.name, raw.name);
        assert.deepEqual(result.content, raw.content);
      }
      await renameUserPreset(kind, cloudParent.name, 'Deliberately renamed');
      const renamed = await sync.exportProfiles();
      assert.equal(renamed.find(p => p.id === 'parent').name, 'Deliberately renamed');
      assert.equal(renamed.find(p => p.id === 'child').content.inherits, 'Deliberately renamed');
      assert.equal((await loadUserPresets()).find(p => p.name === 'Local child').inherits, 'Parent');
    }
  } finally {
    delete globalThis.localStorage;
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else delete globalThis.navigator;
  }
});

test('account mapping survives split imports; edited aliases push original names, deliberate rename updates children', async () => {
  const f = fixture(), sync = createPresetSync(f.storage, f.api, 'alice');
  await f.storage.transaction(state => { state.presets.push({ name: 'Parent', kind: 'process', inherits: 'System', values: { layer_height: '0.8' } }); });
  const parent = { ...profile('parent', 'print', 1, 'Parent'), content: { type: 'print', name: 'Parent', inherits: 'System', layer_height: '0.12' } };
  const child = { ...profile('child', 'print', 1, 'Child'), content: { type: 'print', name: 'Child', inherits: 'Parent', wall_loops: '7' } };
  await sync.importProfiles([parent]); await sync.importProfiles([child]);
  assert.equal(effectivePreset('process', 'Child', f.state.presets).values.layer_height, '0.12');
  await dirty(f, 'parent', '0.14');
  await f.storage.transaction(state => {
    const next = structuredClone(state.presets); next.find(p => p.cloudRef?.id === 'child').values.wall_loops = '8';
    journalLocalChanges(state, next);
  });
  await sync.push();
  let pushes = f.calls.filter(c => c[0] === 'push').map(c => c[1]);
  assert.equal(pushes.find(p => p.id === 'parent').name, 'Parent');
  assert.equal(pushes.find(p => p.id === 'parent').content.name, 'Parent');
  assert.equal(pushes.find(p => p.id === 'child').content.inherits, 'Parent');
  await f.storage.transaction(state => {
    const next = structuredClone(state.presets); next.find(p => p.cloudRef?.id === 'parent').name = 'Renamed';
    journalLocalChanges(state, next);
  });
  assert.equal(f.state.presets.find(p => p.cloudRef?.id === 'child').inherits, 'Renamed');
  await sync.push();
  pushes = f.calls.filter(c => c[0] === 'push').slice(-2).map(c => c[1]);
  assert.equal(pushes.find(p => p.id === 'parent').name, 'Renamed');
  assert.equal(pushes.find(p => p.id === 'child').content.inherits, 'Renamed');
});
