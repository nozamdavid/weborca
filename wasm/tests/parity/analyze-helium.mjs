import fs from 'node:fs';
import {compare,normalize} from './sample-compare.mjs';
const out='wasm/build/sample-parity-20261107/helium-ui';
const rows=[];
for(const name of ['obj_1_Corner bracket.stl','obj_1_Ribbed_Christmas_Tree_Flat_48.stl','obj_1_lily.stl'])for(let trial=0;trial<4;trial++){
 const stem=name.replace(/[^a-z0-9]/gi,'_');
 const nativeDir=`${out}/native-final-${stem}-${trial}`;
 const native=fs.readFileSync(`${nativeDir}/plate_1.gcode`,'utf8');
 const shipped=fs.readFileSync(`${out}/trial-${trial}/${stem}.gcode`,'utf8');
 const instrumented=fs.readFileSync(`${out}/trial-instrumented-${trial}/${stem}.gcode`,'utf8');
 const events=JSON.parse(fs.readFileSync(`${out}/trial-instrumented-${trial}/${stem}-slice-events.json`));
 const result=events.find(e=>e.method==='slice'&&e.result?.benchmarkProcessMs!==undefined).result;
 const log=fs.readFileSync(`${nativeDir}/stdout.log`,'utf8');
 const start=Number(log.match(/BENCH_LOG ([\d.]+) Starting the slicing/)?.[1]);
 const end=Number(log.match(/BENCH_LOG ([\d.]+) Slicing process finished/)?.[1]);
 const parity=compare(native,shipped),equality=compare(shipped,instrumented);
 const stripThumbnails=s=>normalize(s).replace(/; thumbnail begin[\s\S]*?; thumbnail end/g,'');
 rows.push({name,trial,nativeLoggedRegionMs:(end-start)*1000,instrumentedWebProcessMs:result.benchmarkProcessMs,shippedInstrumented:{rawIdentical:equality.rawIdentical,normalizedIdentical:equality.normalizedIdentical,commandsIdentical:equality.commandsIdentical,configDifferences:equality.configDifferences,thumbnailStrippedNormalizedIdentical:stripThumbnails(shipped)===stripThumbnails(instrumented)},parity});
 global.gc?.();
}
fs.writeFileSync(`${out}/actual-comparison.json`,JSON.stringify(rows,null,2));
for(const name of [...new Set(rows.map(r=>r.name))]){
 const trials=rows.filter(r=>r.name===name&&r.trial>0);
 const stats=key=>{const v=trials.map(t=>t[key]).sort((a,b)=>a-b);return {median:v[1],min:v[0],max:v[2]};};
 console.log(JSON.stringify({name,native:stats('nativeLoggedRegionMs'),webInstrumented:stats('instrumentedWebProcessMs'),allShippedInstrumentedEqual:trials.every(t=>t.shippedInstrumented.thumbnailStrippedNormalizedIdentical),layers:trials[0].parity.layers,extrusion:trials[0].parity.extrusionMmByTool,travel:trials[0].parity.travelMm,extrudingPath:trials[0].parity.extrudingPathMm,configDifferences:trials[0].parity.configDifferences}));
}
