// Diagnostic only: deposition segments grouped by layer/role, independent of direction/order.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
export function scan(text, quantum=0.001) {
 let xyz=[0,0,0], e=0, relative=false, layer='startup', role='', arcs=0;
 const segments=new Map(), ordered=[], progressFree=[];
 for(const [index,line] of text.split(/\r?\n/).entries()) {
  if(line.startsWith('; CHANGE_LAYER')) layer=String((Number(layer)||0)+1);
  const z=line.match(/^;(?: Z_HEIGHT: |Z:)(.*)/); if(z)layer=z[1];
  const r=line.match(/^;(?: FEATURE: |TYPE:)(.*)/);if(r)role=r[1];
  const cmd=line.split(';')[0].trim(); if(!cmd)continue;
  if(/^(G91|G20|T[1-9])(?:\s|$)/.test(cmd))throw Error('Relative XYZ, inch units, and multiple tools unsupported');
  if(!cmd.startsWith('M73 '))progressFree.push(cmd);
  if(cmd==='M83')relative=true;if(cmd==='M82')relative=false;
  const op=cmd.split(/\s/)[0],p=Object.fromEntries([...cmd.matchAll(/([XYZE])(-?[\d.]+)/g)].map(m=>[m[1],Number(m[2])]));
  if(op==='G92'){if(p.E!==undefined)e=p.E;for(let j=0;j<3;j++)if(p['XYZ'[j]]!==undefined)xyz[j]=p['XYZ'[j]];continue;}
  if(op==='G2'||op==='G3')arcs++;
  if(!/^G[0123]$/.test(op))continue;
  const next=xyz.map((v,j)=>p['XYZ'[j]]??v),de=p.E===undefined?0:relative?p.E:p.E-e;
  if(p.E!==undefined)e=relative?e+p.E:p.E;
  if(de>0 && next.some((v,j)=>v!==xyz[j]) && layer!=='startup') {
   const endpoints=[xyz,next].map(v=>v.map(n=>Math.round(n/quantum)).join(',')).sort();
   const key=[layer,role,...endpoints].join('|');segments.set(key,(segments.get(key)||0)+1);
   ordered.push({line:index+1,layer,role,from:xyz,to:next,e:de,key});
  }
  xyz=next;
 }
 const hash=s=>createHash('sha256').update(s).digest('hex');
 return {segments,ordered,arcs,rawHash:hash(text),structuralHash:hash(progressFree.join('\n'))};
}
export function compare(a,b,quantum=0.001) {
 const x=scan(a,quantum),y=scan(b,quantum);
 if(x.arcs||y.arcs)throw Error('Arc geometry unsupported');
 const missing=[...x.segments].filter(([k,n])=>n!==(y.segments.get(k)||0));
 const extra=[...y.segments].filter(([k,n])=>n!==(x.segments.get(k)||0));
 const first=x.ordered.findIndex((v,i)=>v.key!==y.ordered[i]?.key);
 return {quantumMm:quantum,nativeRawHash:x.rawHash,webRawHash:y.rawHash,withoutCommentsAndM73Equal:x.structuralHash===y.structuralHash,
  depositionSegments:[x.ordered.length,y.ordered.length],differentNativeSegmentKeys:missing.length,differentWebSegmentKeys:extra.length,
  representativeNativeOnly:missing.slice(0,5),representativeWebOnly:extra.slice(0,5),firstOrderedDifference:first<0?null:{index:first,native:x.ordered[first],web:y.ordered[first]}};
}
if(process.argv.includes('--self-check')) {
 const a='M83\n; Z_HEIGHT: 0.2\n; FEATURE: Outer wall\nG1 X1 E1\nG1 X2 E1\n';
 const b='M83\n; Z_HEIGHT: 0.2\n; FEATURE: Outer wall\nG0 X2\nG1 X1 E1\nG1 X0 E1\n';
 assert.equal(compare(a,a).differentNativeSegmentKeys,0);
 assert.equal(compare(a,b).differentNativeSegmentKeys,0);
 assert(compare(a,b.replace('X2','X2.01')).differentWebSegmentKeys>0);
 assert.throws(()=>compare(a,'G2 X1 I1'));
 console.log('self-check passed (same, reversed/reordered, perturbed, arcs)');
} else if(process.argv[2]) {
 const r=compare(fs.readFileSync(process.argv[2],'utf8'),fs.readFileSync(process.argv[3],'utf8'),Number(process.argv[4]?.startsWith('--')?0.001:process.argv[4]||0.001));
 console.log(JSON.stringify(r,null,2));if(process.argv.includes('--assert-equal')&&(r.differentNativeSegmentKeys||r.differentWebSegmentKeys))process.exitCode=1;
}
