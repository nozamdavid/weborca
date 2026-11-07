import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transform } from '../../app/node_modules/esbuild/lib/main.js';
import { effectivePreset } from '../../app/src/presets/effectivePreset.ts';

test('empty-canvas history selects recursive system roots and restores snapshot values', async () => {
  const source = readFileSync('wasm/app/src/history/historyStore.ts', 'utf8');
  const action = source.slice(source.indexOf('async function restoreSettingsOnEmptyCanvas'), source.indexOf('async function restoreSnapshotInternal'));
  const compiled = await transform(`export default function(deps:any){const {useAppStore,selectPresets,getConfig,evaluateRules,effectivePreset}=deps;${action};return restoreSettingsOnEmptyCanvas}`, { loader: 'ts', format: 'esm' });
  const factory = (await import('data:text/javascript;base64,' + Buffer.from(compiled.code).toString('base64'))).default;
  let state = { selectedPrinter: 'Printer', selectedProcess: 'Other', selectedFilaments: ['PLA'], userPresets: [
    {kind:'process',name:'Parent',inherits:'System',values:{layer_height:'0.16'}},
    {kind:'process',name:'Child',inherits:'Parent',values:{wall_loops:'4'}}
  ] };
  const selections = [], calls = [];
  const restore = factory({ effectivePreset, useAppStore: {getState:()=>state,setState:v=>{state={...state,...v}}},
    selectPresets: async v => selections.push(v), getConfig: async()=>({layer_height:'0.12'}), evaluateRules: async()=>null });
  const engine = {call:async (name,args)=>{calls.push([name,args]);return {}}};
  await restore(engine,{printer:'Printer',process:'Child',filaments:['PLA'],options:{layer_height:'0.12'}});
  assert.equal(selections[0].process,'System'); assert.equal(state.selectedProcess,'Child');
  assert.deepEqual(calls.find(([name])=>name==='setOptions')[1],{options:{layer_height:'0.12'}});
  await restore(engine,{printer:'Printer',process:'Other',filaments:['PLA'],options:{}});
  assert.equal(selections[1].process,'Other'); assert.equal(state.selectedProcess,'Other');
});
