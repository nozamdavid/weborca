import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from '../../app/node_modules/esbuild/lib/main.js';
import { readFileSync } from "node:fs";
const text = readFileSync("wasm/app/src/plate/PlateScene.ts", "utf8");
const names = [...text.matchAll(/import \{([^}]+)\} from '(\.[^']+)'/g)];
// Bind the actual arrow handlers without constructing WebGLRenderer in Node.
const handlers = [...text.matchAll(/private (on(?:Transform)?Pointer\w+|cancelPlaneKey) = ([\s\S]*?\n  };)/g)]
 .map(([,name,body])=>`this.${name} = ${body}`).join('\n');
const wiring = text.slice(text.indexOf("    this.transformControls.addEventListener('objectChange'"), text.indexOf('    // 6. Lighting'));
const { transform } = await import('../../app/node_modules/esbuild/lib/main.js');
const seam = await transform(`export function bindHandlers(THREE) { ${handlers}\n${wiring} }`, {loader:'ts',format:'esm'});
// Scene methods remain bundled below; this seam only installs constructor callbacks.
const result = await build({entryPoints:["wasm/app/src/plate/PlateScene.ts"],bundle:true,write:false,platform:"node",format:"esm",plugins:[{name:"boundaries",setup(b){b.onResolve({filter:/^\./},args=>args.importer.endsWith("PlateScene.ts")?{path:args.path,namespace:"stub"}:undefined);b.onLoad({filter:/.*/,namespace:"stub"},({path})=>({contents:(names.find(m=>m[2]===path)?.[1]??"").split(",").map(n=>n.trim()).filter(n=>n&&!n.startsWith("type ")).map(n=>`export const ${n}={getState:()=>({resetSelection(){}})};`).join("\n")}));}}]});
const { PlateScene } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
globalThis.window = { addEventListener(){}, removeEventListener(){} };
import * as T from "../../app/node_modules/three/build/three.module.js";
import { TransformControls } from '../../app/node_modules/three/examples/jsm/controls/TransformControls.js';
const { bindHandlers } = await import(`data:text/javascript;base64,${Buffer.from(seam.code).toString('base64')}`);
function fixture(mode) {
 const a = new T.Mesh(new T.BoxGeometry(2,2,2)), b=a.clone(), other=a.clone();
 a.userData={objectId:1,instanceId:0}; b.userData={objectId:1,instanceId:1};
 a.rotation.order=b.rotation.order='ZYX'; a.rotation.set(.2,.4,.7); a.scale.set(-1,2,3); b.position.x=10; other.position.x=40;
 const s=Object.create(PlateScene.prototype), batches=[];
 Object.assign(s,{requestDraw(){},scene:new T.Scene(),groupProxy:new T.Object3D(),groupDrag:null,dragStart:null,objectMeshes:new Map([['1_0',a],['1_1',b],['1_2',other]]),extraKeys:new Set(['1_1']),selectedVolumeId:null,gizmoMode:mode,cutPreview:{active:false},getSelectedMesh:()=>a,orbitControls:{enabled:true},callbacks:{canMoveObjects:()=>true,onTransformMany:entries=>batches.push(entries)},measureActive:false,clearMeasure(){},measureSessionId:0,transformControls:{attach(o){this.object=o;},detach(){this.object=null;},dragging:false,axis:'X'}});
 s.updateTransformControls(); return {s,a,b,other,batches};
}
test('group scale and rotate attach, transform all selected instances and commit once',()=>{
 for(const mode of ['scale','rotate']) {
 const {s,a,b,other,batches}=fixture(mode); assert.equal(s.transformControls.object,s.groupProxy,'group handles need a shared proxy');
 const distance=a.position.distanceTo(b.position), scale=a.scale.clone(), q=a.quaternion.clone();
 s.beginGroupDrag();
 if(mode==='scale') s.groupProxy.scale.set(2,1,1); else s.groupProxy.quaternion.setFromAxisAngle(new T.Vector3(0,0,1),Math.PI/2);
 s.changeGroupDrag();
 assert.ok(Math.abs(a.position.distanceTo(b.position)-distance*(mode==='scale'?2:1))<1e-8);
 if(mode==='scale') assert.deepEqual(a.scale.toArray(),scale.multiplyScalar(2).toArray());
 else { assert.deepEqual(a.scale.toArray(),scale.toArray()); assert.ok(a.quaternion.angleTo(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,0,1),Math.PI/2).multiply(q))<1e-7); }
 assert.equal(other.position.x,40); s.finishGroupDrag(true); s.finishGroupDrag(true); assert.equal(batches.length,1); assert.deepEqual(batches[0].map(e=>e.instanceId),[0,1]); assert.ok(batches[0].every(e=>e.scale.every(v=>v>0)));
 }
});
test('cancel and busy commit restore signed scales, orientation, positions and orbit',()=>{
 for(const busy of [false,true]) {const {s,a,b,batches}=fixture('rotate'); const position=b.position.clone(),q=a.quaternion.clone(); s.beginGroupDrag(); s.groupProxy.quaternion.setFromAxisAngle(new T.Vector3(0,1,0),1); s.changeGroupDrag(); if(busy)s.callbacks.canMoveObjects=()=>false; s.finishGroupDrag(busy); assert.ok(b.position.equals(position)); assert.ok(a.quaternion.angleTo(q)<1e-7); assert.equal(a.scale.x,-1); assert.equal(batches.length,0); assert.equal(s.orbitControls.enabled,true); }
});

test('group and touch rollback request a frame after restoring transforms',()=>{
 const {s,b}=fixture('rotate'); let draws=0; s.requestDraw=()=>draws++;
 s.beginGroupDrag(); s.groupProxy.quaternion.setFromAxisAngle(new T.Vector3(0,0,1),1); s.changeGroupDrag();
 draws=0; s.finishGroupDrag(false); assert.ok(draws>0);
 s.renderer={domElement:{hasPointerCapture:()=>false}};
 s.planeDrag={pointerId:1,orbitEnabled:true,transformEnabled:true,origins:new Map([[b,new T.Vector3(10,0,0)]]),moved:true};
 b.position.set(20,30,0); draws=0; s.finishPlaneDrag(false);
 assert.deepEqual(b.position.toArray(),[10,0,0]); assert.equal(draws,1);
});

test('Escape rolls back a body drag and consumes its release without clearing selection',()=>{
 const {s,a,batches}=fixture('translate'); let draws=0, stopped=0;
 Object.assign(s,{requestDraw(){draws++;},renderer:{domElement:{hasPointerCapture:()=>false}},consumedTransformReleases:new WeakSet()});
 s.transformControls.addEventListener=()=>{};
 bindHandlers.call(s,T);
 const origin=a.position.clone(); a.position.x+=20;
 s.planeDrag={pointerId:7,target:a,origins:new Map([[a,origin]]),moved:true,orbitEnabled:true,transformEnabled:true};
 s.orbitControls.enabled=false; s.transformControls.enabled=false;
 s.cancelPlaneKey({key:'Escape',preventDefault(){},stopImmediatePropagation(){stopped++;}});
 assert.ok(a.position.equals(origin)); assert.equal(s.planeDrag,null); assert.equal(stopped,1);
 assert.equal(s.orbitControls.enabled,true); assert.equal(s.transformControls.enabled,true); assert.ok(draws>0);
 const up={pointerId:7,pointerType:'mouse'};
 s.onTransformPointerUp(up); s.onPointerUp(up);
 assert.equal(s.transformPointerId,null); assert.equal(batches.length,0);
 assert.equal(s.consumedTransformReleases.has(up),false);
});

test('TransformControls release before viewer picking preserves selection; next background click clears',()=>{
 for (const mode of ['translate','rotate','scale']) for (const group of [false,true]) {
  const {s,a,batches}=fixture(mode), selections=[];
  const element={style:{},ownerDocument:{},addEventListener(){},removeEventListener(){},releasePointerCapture(){},getBoundingClientRect:()=>({left:0,top:0,width:100,height:100})};
  const camera=new T.PerspectiveCamera(); camera.position.z=10; camera.updateMatrixWorld();
  const controls=new TransformControls(camera,element);
  Object.assign(s,{transformControls:controls,renderer:{domElement:element},camera,flattenClusters:[],viewerTargets:()=>[],paintCursor:{setVisible(){}},consumedTransformReleases:new WeakSet(),callbacks:{...s.callbacks,onSelect:(...v)=>selections.push(v),onTransformChange:()=>batches.push('single')}});
  if(!group)s.extraKeys.clear();
  controls.attach(group && mode !== 'translate'?s.groupProxy:a);
  bindHandlers.call(s,T);
  const event=(pointerId=1)=>({pointerId,pointerType:'mouse',button:0,clientX:150,clientY:150,preventDefault(){},stopImmediatePropagation(){}});
  for(let i=0;i<2;i++) {
   const up=event(i+1);
   controls.axis='X'; s.onPointerDown(up); controls.dragging=true;
   if(i===1) s.onPointerCancel(up);
   s.onTransformPointerUp?.(up); // capture phase precedes Three's registered bubble listener
   controls._onPointerUp(up);
   assert.equal(controls.dragging,false); assert.equal(controls.axis,null);
   s.onPointerUp(up);
   assert.deepEqual(selections,[],`${mode}/${group}: transform release must not deselect`);
   const click=event(10+i); s.onPointerDown(click); s.onTransformPointerUp?.(click); controls._onPointerUp(click); s.onPointerUp(click);
   assert.deepEqual(selections,[[null,null]],'independent background click still deselects'); selections.length=0;
  }
  assert.equal(batches.length,group && mode !== 'translate'?1:2,'each completed transform commits once; group cancel rolls back');
  assert.equal(s.orbitControls.enabled,true);
  // A canceled capture may have no subsequent up; a fresh down starts a new gesture.
  controls.axis='X'; s.onPointerDown(event(30)); controls.dragging=true; s.onPointerCancel(event(30)); controls.pointerUp({button:0});
  const fresh=event(31); s.onPointerDown(fresh); s.onTransformPointerUp(fresh); controls._onPointerUp(fresh); s.onPointerUp(fresh);
  assert.deepEqual(selections,[[null,null]]);
  selections.length=0;
  const shifted={...event(32),shiftKey:true}; s.onTransformPointerUp(shifted); controls._onPointerUp(shifted); s.onPointerUp(shifted);
  assert.deepEqual(selections,[],'modified background release preserves selection');
 }
});
