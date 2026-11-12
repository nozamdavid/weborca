// Bounded oracle: native Print computes expected toolpaths from the selected config.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createEngineCore } from '../../web/engine-core.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const out = path.join(root, 'wasm/build/review-native-oracle/cube');
fs.mkdirSync(out, { recursive: true });
const modulePath = path.resolve(process.env.ORCA_ENGINE_MODULE);
const native = path.resolve(process.env.NATIVE_DRIVER);
const mod = await import(modulePath);
const core = await createEngineCore({ moduleFactory: mod.createOrcaEngine || mod.default, threads: 4 });
try {
  for (const name of ['resources.json', 'profiles/OrcaFilamentLibrary.json', 'profiles/Voron.json']) {
    await core.addVendorBundle(JSON.parse(fs.readFileSync(path.join(root, 'wasm/build/tests-node', name))));
  }
  await core.call('init', { resourcesDir: '/resources', dataDir: '/data' });
  await core.call('loadVendors', {});
  await core.call('selectPresets', {
    printer: 'Voron 2.4 300 0.4 nozzle', process: '0.20mm Standard @Voron',
    filaments: ['Generic PLA @System'],
  });
  // Only configuration crosses runtimes. Expected G-code is produced by native Print.
  const config = await core.call('getConfig', {});
  fs.writeFileSync(path.join(out, 'config.json'), JSON.stringify(config, null, 2));
  fs.writeFileSync(path.join(out, 'config.ini'), Object.entries(config).map(([k, v]) => `${k} = ${v}`).join('\n') + '\n');
  const model = path.join(root, 'tests/data/20mm_cube.obj');
  execFileSync(native, [model, path.join(out, 'native.gcode'), path.join(out, 'config.ini'), path.join(root, 'resources')], { stdio: 'inherit' });
  for (const name of ['cube', 'recovery-cube']) {
    if (name === 'recovery-cube') {
      await core.loadModel('3DBenchy.stl', fs.readFileSync(path.join(root, 'wasm/build/models/3DBenchy.stl')));
      await core.call('arrange', {});
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 300);
      let canceled = false;
      try {
        const result = await core.call('slice', { outPath: '/out/canceled.gcode', threads: 4 }, { signal: controller.signal });
        canceled = !!result?.canceled;
      } catch (error) {
        if (!(error.canceled || error.name === 'AbortError' || error.message?.includes('canceled'))) throw error;
        canceled = true;
      } finally { clearTimeout(timer); }
      if (!canceled) throw new Error('Recovery prerequisite: Benchy slice was not canceled');
    }
    await core.loadModel('20mm_cube.obj', fs.readFileSync(model));
    await core.call('arrange', {});
    await core.call('slice', { outPath: `/out/${name}.gcode`, threads: 4 });
    const output = path.join(out, `${name}.gcode`);
    fs.writeFileSync(output, core.readFile(`/out/${name}.gcode`));
    execFileSync('bash', [path.join(root, 'wasm/spike/compare_gcode.sh'), path.join(out, 'native.gcode'), output], { stdio: 'inherit' });
  }
} finally {
  core.dispose();
}
