/** Documentation links of options (wasm/app/src/settings/settingDocs.ts, generated map from desktop's Tab.cpp). */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getLineDocUrl, getSettingDocUrl } from '../../app/src/settings/settingDocs.ts';

test('an option links to the page and anchor desktop uses', () => {
  assert.equal(getSettingDocUrl('wall_loops'), 'https://www.orcaslicer.com/wiki/strength_settings_walls#wall-loops');
  assert.equal(getSettingDocUrl('layer_height'), 'https://www.orcaslicer.com/wiki/quality_settings_layer_height');
});

test('options without a desktop page have no link', () => {
  assert.equal(getSettingDocUrl('not_an_option'), undefined);
  assert.equal(getSettingDocUrl(undefined), undefined);
});

test('a row of several options links to the first documented one', () => {
  assert.equal(getLineDocUrl(['not_an_option', 'wall_loops']), getSettingDocUrl('wall_loops'));
  assert.equal(getLineDocUrl(['not_an_option']), undefined);
});
