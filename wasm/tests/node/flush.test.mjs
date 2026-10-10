/** Flush volume estimate (wasm/app/src/flush/flushVolume.ts): the colour-distance fallback of desktop's FlushVolCalc. */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { autoFlushMatrix, flushVolume, parseColour, readFlushMatrix } from '../../app/src/flush/flushVolume.ts';

describe('flush volumes', () => {
  test('colours', () => {
    assert.deepEqual(parseColour('#FF8000'), [255, 128, 0]);
    assert.equal(parseColour('nope'), undefined);
  });

  test('dark to light needs far more than light to dark, identical colours the minimum', () => {
    const black = [0, 0, 0];
    const white = [255, 255, 255];
    assert.equal(flushVolume(white, white), 60);
    assert.ok(flushVolume(black, white) > 3 * flushVolume(white, black), `${flushVolume(black, white)} vs ${flushVolume(white, black)}`);
    assert.ok(flushVolume(black, white) <= 20000);
  });

  test('matrix is square with a zero diagonal', () => {
    const m = autoFlushMatrix(['#000000', '#FFFFFF', '#FF0000']);
    assert.equal(m.length, 9);
    assert.deepEqual([m[0], m[4], m[8]], [0, 0, 0]);
    assert.ok(m[1] > 60 && m[3] > 60);
  });

  test('a stored matrix is resized to the filament count', () => {
    assert.deepEqual(readFlushMatrix('0,100,200,0', 2), [0, 100, 200, 0]);
    assert.deepEqual(readFlushMatrix('0,100,200,0', 3), [0, 100, 280, 200, 0, 280, 280, 280, 0]);
    assert.deepEqual(readFlushMatrix(undefined, 2), [0, 280, 280, 0]);
    assert.deepEqual(readFlushMatrix('0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15', 2), [0, 1, 4, 0]);
  });
});
