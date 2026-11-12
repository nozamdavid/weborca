import { execFileSync } from "node:child_process";
import test from 'node:test';
import assert from 'node:assert/strict';
import { build, transform } from '../../app/node_modules/esbuild/lib/main.js';
import { readFileSync } from 'node:fs';
const source=readFileSync('wasm/app/src/plate/PlateScene.ts','utf8');
const names=[...source.matchAll(/import \{([^}]+)\} from '(\.[^']+)'/g)];
const result=await build({entryPoints:['wasm/app/src/plate/PlateScene.ts'],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'boundaries',setup(b){b.onResolve({filter:/^\./},a=>a.importer.endsWith('PlateScene.ts')?{path:a.path,namespace:'stub'}:undefined);b.onLoad({filter:/.*/,namespace:'stub'},({path})=>({contents:(names.find(m=>m[2]===path)?.[1]??'').split(',').map(n=>n.trim()).filter(n=>n&&!n.startsWith('type ')).map(n=>`export const ${n}={getState:()=>({})};`).join('\n')}));}}]});
const arrows = [...source.matchAll(/private (syncAnimation|animate) = ([\s\S]*?\n  };)/g)].map(([,n,b])=>`this.${n} = ${b}`).join("\n");
const bound = await transform(`export function bind() { ${arrows} }`, {loader:"ts",format:"esm"});
const {bind} = await import(`data:text/javascript;base64,${Buffer.from(bound.code).toString("base64")}`);
const {PlateScene}=await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
globalThis.document={hidden:false,documentElement:{dataset:{}}};
let queue=new Map(), next=0;
globalThis.requestAnimationFrame=f=>{queue.set(++next,f);return next;};
globalThis.cancelAnimationFrame=id=>queue.delete(id);
const tick=()=>{const work=[...queue.values()];queue.clear();work.forEach(f=>f());};
function fixture(){const s=Object.create(PlateScene.prototype);let frames=0; Object.assign(s,{objectGeneration:0,isDestroyed:false,hasVisibleSize:true,isInViewport:true,animationFrameId:null,scene:{userData:{lightTheme:false}},camera:{position:{z:1}},orbitControls:{update:()=>false},cutPreview:{frame(){}},updateSelectionOutline(){},updateVolumeMaterials(){},renderer:{render(){frames++;}},finishGroupDrag(){},geometries:new Map(),objectMeshes:new Map(),volumeMeshes:new Map(),meshVolumes:new Map(),updateLabels(){},syncCutPreview(){},updateViewerVisibility(){},updateTransformControls(){}});bind.call(s);return {s,frames:()=>frames};}
test('idle stops; changes coalesce and damping continues',()=>{queue.clear();const {s,frames}=fixture();s.requestDraw();s.requestDraw();tick();assert.equal(frames(),1);assert.equal(queue.size,0);let damping=2;s.orbitControls.update=()=>damping-->0;s.requestDraw();tick();tick();tick();assert.equal(queue.size,0);assert.equal(frames(),4);});
test('stale and destroyed retrievals never enter scene commit',async()=>{for(const destroyed of [false,true]){const {s}=fixture();let resolve;s.callbacks={getMesh:()=>new Promise(r=>resolve=r),getViewerMesh:async()=>null};const a=s.setObjects([{id:1}]);if(destroyed)s.isDestroyed=true;else assert.equal(await s.setObjects([]),true);resolve({});assert.equal(await a,false);assert.equal(s.geometries.size,0);}});
test('store transforms reuse both binary caches; geometry refresh invalidates both',async()=>{
 globalThis.__sceneEngine={calls:0,bytes:0,async call(method){if(method==='getMesh'){this.calls++;this.bytes+=bytes.length;return {buffer:bytes,volumes:[]};}if(method==='listObjects')return [];},};
 const bytes=new Uint8Array(16+36+12), view=new DataView(bytes.buffer);view.setUint32(0,0x4D455348,true);view.setUint32(4,3,true);view.setUint32(8,1,true);
 const stubs={
 "../objectlist/objectListStore":"export const useObjectListStore={getState:()=>({})};",
 '../engine/orcaEngine':'export const getEngine=async()=>globalThis.__sceneEngine; export const addModel=()=>{};',
 '../plates/platesStore':'export const usePlatesStore={getState:()=>({fetchPlates:async()=>[]})};',
 '../store/appStore':'export const useAppStore={setState(){},getState:()=>({})};',
 '../history':'export const useHistoryStore={getState:()=>({commitTransaction:async()=>{}})};',
 '../engine/stepModule':'export const isStepFileName=()=>false;',
 './multiScale':'export const groupScaleEntries=()=>[];',
 };
 const bundle=await build({entryPoints:['wasm/app/src/plate/plateStore.ts'],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'store-boundaries',setup(b){if(process.env.SCENE_BASELINE)b.onLoad({filter:/plateStore\.ts$/},()=>({contents:execFileSync("git",["show","8e21361611:wasm/app/src/plate/plateStore.ts"],{encoding:"utf8"}),loader:"ts"}));b.onResolve({filter:/^\./},a=>a.importer.endsWith('plateStore.ts')&&stubs[a.path]?{path:a.path,namespace:'stub'}:undefined);b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:stubs[a.path]}));}}]});
 const {usePlateStore}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
 const s=usePlateStore.getState(), start=performance.now();
 let cacheNotifications=0;
 const unsubscribe=usePlateStore.subscribe((state,previous)=>{if(state.meshCache!==previous.meshCache)cacheNotifications++;});
 const mesh=await s.getMesh(1), viewer=await s.getViewerMesh(1);
 assert.equal(cacheNotifications,1,'mesh completion publishes volume metadata to paint controls');
 unsubscribe();
 const warm=globalThis.__sceneEngine.calls;
 for(let i=0;i<20;i++){await s.setInstanceTransform(1,0,{offset:[i,0,0]});const m=await s.getMesh(1),v=await s.getViewerMesh(1);if(!process.env.SCENE_BASELINE){assert.equal(m,mesh);assert.equal(v,viewer);}}
 if(!process.env.SCENE_BASELINE)assert.equal(globalThis.__sceneEngine.calls,warm);
 await s.refreshObjects();const m=await s.getMesh(1),v=await s.getViewerMesh(1);if(!process.env.SCENE_BASELINE){assert.notEqual(m,mesh);assert.notEqual(v,viewer);}
 assert.equal(globalThis.__sceneEngine.calls,process.env.SCENE_BASELINE?23:4);
 console.log(JSON.stringify({workload:'20 transforms + geometry refresh',calls:globalThis.__sceneEngine.calls,bytes:globalThis.__sceneEngine.bytes,ms:performance.now()-start}));
});
test('accepted refresh keeps scene geometry identity for cached mesh data',async()=>{
 const T=await import('../../app/node_modules/three/build/three.module.js');
 const {s}=fixture();Object.assign(s,{objectsGroup:new T.Group(),defaultMaterial:new T.MeshBasicMaterial(),selectedMaterial:new T.MeshBasicMaterial(),extraKeys:new Set(),applyVolumeColors(){}});
 let data={positions:new Float32Array([0,0,0,1,0,0,0,1,0]),indices:new Uint32Array([0,1,2])};
 s.callbacks={getMesh:async()=>data,getViewerMesh:async()=>null};
 const objects=[{id:1,name:'Triangle',instances:[{id:0,offset:[0,0,0],rotation:[0,0,0],scale:[1,1,1]}]}];
 assert.equal(await s.setObjects(objects),true);const geo=s.geometries.get(1),mesh=s.objectMeshes.get('1_0');
 objects[0].instances[0].offset=[5,0,0];assert.equal(await s.setObjects(objects),true);assert.equal(s.geometries.get(1),geo);assert.equal(s.objectMeshes.get('1_0'),mesh);assert.equal(mesh.position.x,5);
 data={...data,positions:new Float32Array([0,0,0,2,0,0,0,1,0])};assert.equal(await s.setObjects(objects),true);assert.equal(mesh.geometry.attributes.position.getX(1),2);
});
test('fixed idle scheduler workload before and after',{skip:!process.env.SCENE_COMPARE_BASELINE},async()=>{
 const original=execFileSync('git',['show','8e21361611:wasm/app/src/plate/PlateScene.ts'],{encoding:'utf8'});
 const oldArrows=[...original.matchAll(/private (syncAnimation|animate) = ([\s\S]*?\n  };)/g)].map(([,n,b])=>`this.${n} = ${b}`).join('\n');
 const compiled=await transform(`export function bind(){${oldArrows}}`,{loader:'ts',format:'esm'});
 const old=await import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`);
 const counts=[];
 for(const baseline of [true,false]){queue.clear();const {s,frames}=fixture();if(baseline)old.bind.call(s);s.requestDraw();for(let i=0;i<20;i++)tick();counts.push({baseline,rendered:frames(),pending:queue.size});}
 assert.deepEqual(counts.map(c=>c.rendered),[20,1]);assert.deepEqual(counts.map(c=>c.pending),[1,0]);console.log(JSON.stringify({idleTicks:20,counts}));
});
