// Browser harnesses run only in the job that provisions Playwright browsers.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const dir = 'wasm/tests/node';
const browser = new Set(['calibration-dialog-validation', 'desktop-design-polish', 'mobile-device-webui', 'mobile-object-spacing', 'mobile-preview-lifecycle', 'mobile-preview', 'preset-inheritance-save', 'ui-section-spacing', 'alpha-access-ui', 'octoeverywhere-ui', 'preview-values', 'wizard-filament-selection']);
const suites = fs.readdirSync(dir).filter(name => name.endsWith('.test.mjs'));
const selected = suites.filter(name => (process.argv.includes('--browser') ? browser.has(name.replace('.test.mjs', '')) : !browser.has(name.replace('.test.mjs', ''))));
console.log('Selected suites:', selected.join(', '));
if (process.argv.includes('--list')) process.exit(0);
const result = spawnSync(process.execPath, ['--experimental-strip-types', '--test', '--test-concurrency=1', ...selected.map(name => `${dir}/${name}`)], { stdio: 'inherit', env: process.env });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
