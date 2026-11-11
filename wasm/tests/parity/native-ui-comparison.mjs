import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const root=process.cwd(),out=root+'/wasm/build/sample-parity-20261107/helium-ui';
for(const name of ['obj_1_Corner bracket.stl','obj_1_Ribbed_Christmas_Tree_Flat_48.stl','obj_1_lily.stl'])for(let trial=0;trial<4;trial++){
 const dir=out+'/native-final-'+name.replace(/[^a-z0-9]/gi,'_')+'-'+trial;fs.mkdirSync(dir,{recursive:true});
 const args=['run','--user','--env=LD_PRELOAD='+out+'/log-probe.so','com.orcaslicer.OrcaSlicer','--datadir',dir+'/data','--debug','3','--logfile',dir+'/engine.log','--slice','0','--outputdir',dir,'--load-settings',root+'/resources/profiles/Voron/machine/Voron 2.4 300 0.4 nozzle.json;'+root+'/resources/profiles/Voron/process/0.20mm Standard @Voron.json','--load-filaments',root+'/resources/profiles/OrcaFilamentLibrary/filament/Generic PLA @System.json','--extruder-colour','#26A69A','--filament-colour','#26A69A','--flush-volumes-vector','140,140','/mnt/appdata/workspace/OrcaSlicer/samples/'+name];
 fs.writeFileSync(dir+'/command.json',JSON.stringify(['flatpak',...args],null,2));
 const p=spawnSync('flatpak',args,{encoding:'utf8',maxBuffer:64*1024*1024});fs.writeFileSync(dir+'/stdout.log',p.stdout+p.stderr);console.log(name,trial,p.status);if(p.status)process.exit(p.status);
}
