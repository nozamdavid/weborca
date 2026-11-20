import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from '../../app/node_modules/esbuild/lib/main.js';

test('Add filament opens a standalone picker seeded with saved filaments', async () => {
  const bundle = await build({
    stdin: {
      contents: `export {openAddFilament} from './src/wizard/addFilament';
        export {useWizardStore} from './src/wizard/wizardStore';`,
      resolveDir: new URL('../../app/', import.meta.url).pathname,
    },
    bundle: true, write: false, platform: 'node', format: 'esm',
  });
  const { openAddFilament, useWizardStore } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
  useWizardStore.setState({ addedFilaments: ['Existing PLA'], selectedFilaments: ['Unsaved PLA'] });
  openAddFilament();
  const state = useWizardStore.getState();
  assert.equal(state.open, true);
  assert.equal(state.filamentsOnly, true);
  assert.equal(state.step, 2);
  assert.deepEqual(state.selectedFilaments, ['Existing PLA']);
  state.setOpen(false);
  state.setOpen(true);
  assert.equal(useWizardStore.getState().filamentsOnly, false);
  assert.equal(useWizardStore.getState().step, 1);
});
