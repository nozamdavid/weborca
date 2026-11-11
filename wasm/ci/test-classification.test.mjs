import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

test('every browser launcher has exactly one provisioned browser consumer', () => {
  const list = args => execFileSync(process.execPath, ['wasm/ci/run-node-tests.mjs', '--list', ...args], { encoding: 'utf8' });
  const node = list([]), browser = list(['--browser']);
  for (const file of fs.readdirSync('wasm/tests/node').filter(name => name.endsWith('.test.mjs'))) {
    const launches = /chromium\.launch\(/.test(fs.readFileSync(`wasm/tests/node/${file}`, 'utf8'));
    assert.equal(node.includes(file), !launches, file);
    assert.equal(browser.includes(file), launches, file);
  }
  const workflow = fs.readFileSync('.github/workflows/wasm.yml', 'utf8');
  assert.match(workflow.split('  test-browser:')[1], /node wasm\/ci\/run-node-tests.mjs --browser/);
});
