import test from 'node:test';
import assert from 'node:assert/strict';
import { createPresetSync } from '../../app/src/orcaCloud/sync.ts';
import { checkPresetContent, decodeProfile, encodeRecord } from '../../app/src/orcaCloud/codec.ts';

test('successful native cloud pull imports all six printer profiles without mutating originals', async () => {
  const native = (id, name, inherits, content, updated_time = 1780927003, created_time = updated_time) => ({
    id, user_id: 'fakeaccount', label: null, name, updated_time, created_time,
    content: { name, type: 'printer', inherits, version: '2.3.1.10', printer_settings_id: name, ...content },
  });
  const snapmaker = (id, name, updated, created) => native(id, name, 'Snapmaker U1 (0.4 nozzle)', {
    print_host: 'http://192.168.1.100', print_host_webui: 'http://192.168.1.100',
    machine_start_gcode: 'START_PRINT\nG28', machine_end_gcode: 'END_PRINT',
    support_multi_bed_types: '1', nozzle_diameter: ['0.4', '0.4', '0.4', '0.4'],
    extruder_offset: ['0x0', '0x0', '0x0', '0x0'],
  }, updated, created);
  const response = { status: 200, data: { next_cursor: 1790531056, deletes: [], upserts: [
    native('fakeprofile1', 'Flashforge AD5X 0.4 nozzle - ZMOD', 'Flashforge AD5X 0.4 nozzle', {
      base_id: 'GM001', z_offset: '-0.06', print_host: 'http://192.168.1.100',
      print_host_webui: 'http://192.168.1.100', machine_start_gcode: 'START_PRINT\nG28', machine_end_gcode: 'END_PRINT',
    }),
    native('fakeprofile2', 'Creality Hi - Copy', 'Creality Hi', { machine_start_gcode: 'G28', machine_end_gcode: 'M84' }, 1780927004),
    snapmaker('fakeprofile3', 'Snapmaker U1 - Copy', 1780927004, 1780927004),
    snapmaker('fakeprofile4', 'Snapmaker U1 - Custom', 1790531056, 1790252748),
    snapmaker('fakeprofile5', 'Snapmaker U1 - Copy 2', 1790531056, 1790252748),
    native('fakeprofile6', 'Flashforge Adventurer 5M Pro 0.25 - Copy', 'Flashforge Adventurer 5M Pro 0.25 nozzle', {
      host_type: 'flashforge', nozzle_diameter: ['0.25'], machine_start_gcode: 'G28', machine_end_gcode: 'M84',
    }, 1790531056, 1790252748),
  ] } };
  const original = { name: 'Existing local printer', kind: 'printer', inherits: 'Local base', values: { z_offset: '0.1' } };
  let state = { version: 2, updatedAt: 0, presets: [structuredClone(original)], cloud: { accounts: {} } };
  const before = structuredClone(response);
  const calls = [];
  const sync = createPresetSync({ transaction: async work => {
    const next = structuredClone(state);
    const result = await work(next);
    state = next;
    return result;
  } }, { pull: async cursor => { calls.push(cursor); return response; } }, 'fakeaccount');

  let result;
  try {
    await assert.doesNotReject(async () => { result = await sync.pull(); }, 'HTTP 200 native printer profiles must import locally');
  } finally {
    assert.deepEqual(response, before, 'pull must not mutate the supplied native profiles');
    assert.deepEqual(state.presets[0], original, 'pull must preserve the existing local preset');
  }
  assert.equal(result.changed, true);
  assert.deepEqual(calls, [undefined]);
  assert.equal(state.cloud.accounts.fakeaccount.cursor, 1790531056);
  const imported = state.presets.filter(p => p.cloudRef?.accountId === 'fakeaccount');
  assert.equal(imported.length, 6);
  for (const remote of response.data.upserts) {
    const local = imported.find(p => p.cloudRef.id === remote.id);
    assert.equal(local.kind, 'printer');
    assert.equal(local.name, remote.name);
    assert.equal(local.inherits, remote.content.inherits);
    assert.equal(local.values.machine_start_gcode, remote.content.machine_start_gcode);
    assert.equal(local.values.machine_end_gcode, remote.content.machine_end_gcode);
    for (const key of ['print_host', 'print_host_webui', 'host_type', 'z_offset', 'support_multi_bed_types']) {
      if (key in remote.content) assert.equal(local.values[key], remote.content[key]);
    }
    const record = state.cloud.accounts.fakeaccount.records[remote.id];
    assert.equal(record.revision, remote.updated_time);
    assert.deepEqual(record.raw, remote.content, 'retain native metadata, arrays and G-code');
  }
});

test('native printer addresses, macros and metadata survive export, import and push encoding', async () => {
  const content = {
    type: 'printer', name: 'Native printer', inherits: 'Native base', version: '2.3.1.10',
    print_host: 'http://192.168.1.100:7125', print_host_webui: 'http://192.168.1.100/ui', host_type: 'flashforge',
    machine_start_gcode: 'START_PRINT\nG28', machine_end_gcode: 'END_PRINT',
    created_time: 1790252748, nozzle_diameter: ['0.4'], custom_meta: { future: true },
  };
  const profile = { id: 'native', user_id: 'fakeaccount', label: null, name: content.name, updated_time: 1790531056, created_time: 1790252748, content };
  const before = structuredClone(profile);
  let state = { version: 2, updatedAt: 0, presets: [], cloud: { accounts: {} } };
  const pushed = [];
  const sync = createPresetSync({ transaction: async work => {
    const next = structuredClone(state);
    const result = await work(next);
    state = next;
    return result;
  } }, { push: async body => { pushed.push(body); return { status: 200, data: { updated_time: 1790531057 } }; } }, 'fakeaccount');
  await sync.importProfiles([profile]);
  assert.equal(state.presets[0].values.print_host, content.print_host);
  assert.equal(state.presets[0].values.print_host_webui, content.print_host_webui);
  assert.deepEqual(state.cloud.accounts.fakeaccount.records.native.raw, content);
  const exported = await sync.exportProfiles();
  assert.deepEqual(exported[0].content, content);
  await sync.importProfiles(exported);
  state.cloud.accounts.fakeaccount.records.native.dirty = true;
  await sync.push();
  assert.deepEqual(pushed[0].content, content);
  assert.deepEqual(state.cloud.accounts.fakeaccount.records.native.raw, content);
  assert.deepEqual(profile, before);
});

test('canonical address exceptions still reject nested credentials and other matching field names', () => {
  for (const key of ['password', 'access_code', 'access_token', 'refresh_token', 'api_key', 'secret', 'credential', 'device_id', 'device_ip', 'printer_ip', 'printer_host', 'print_host_password', 'print_host_webui_token', 'print-host', 'Print_Host', 'ip_address', 'mqtt', 'authorization']) {
    const content = { type: 'printer', print_host: 'http://192.168.1.100', nested: [{ [key]: 'fake-secret' }] };
    assert.throws(() => checkPresetContent(content), /credentials/, key);
    assert.throws(() => decodeProfile({ id: 'native', name: 'Native', updated_time: 1, content }), /credentials/, key);
    assert.throws(() => encodeRecord({ preset: { name: 'Native', kind: 'printer', inherits: '', values: {} }, raw: content }), /credentials/, key);
  }
  assert.throws(() => checkPresetContent({ type: 'printer', print_host: { password: 'fake-secret' } }), /credentials/);
});

test('canonical address fields reject embedded URL credentials on decode and encode', () => {
  for (const key of ['print_host', 'print_host_webui']) {
    for (const address of ['http://user:pass@192.168.1.100', 'https://user@printer.local/ui', 'http://:pass@printer.local', 'user:pass@printer.local:7125', '//user:pass@printer.local']) {
      const content = { type: 'printer', [key]: address };
      assert.throws(() => decodeProfile({ id: 'native', name: 'Native', updated_time: 1, content }), /credentials/, `${key}: ${address}`);
      assert.throws(() => encodeRecord({ preset: { name: 'Native', kind: 'printer', inherits: '', values: { [key]: address } }, raw: { type: 'printer' } }), /credentials/, `${key}: ${address}`);
    }
  }
});
